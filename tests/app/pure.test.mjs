import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const p = require("../../app/vendor/pure.js");

const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const csv = readFileSync(new URL("./fixtures/n26_sample.csv", import.meta.url), "utf8");

test("ulid: 26 chars Crockford y prefijo temporal estable", () => {
  const u = p.bcUlid(1756000000000, () => 128);
  assert.match(u, /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
  assert.equal(u, p.bcUlid(1756000000000, () => 128)); // determinista con rand fijo
});

test("externalId: 16 hex estables", () => {
  const a = p.bcBuildExternalId("2026-08-20", -4520, "MERCADONA", "Compra tarjeta", sha256hex);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, p.bcBuildExternalId("2026-08-20", -4520, "MERCADONA", "Compra tarjeta", sha256hex));
  assert.notEqual(a, p.bcBuildExternalId("2026-08-21", -4520, "MERCADONA", "Compra tarjeta", sha256hex));
});

test("parser N26: 4 filas con céntimos con signo", () => {
  const rows = p.bcParseN26Csv(csv);
  assert.equal(rows.length, 4);
  assert.deepEqual(
    [rows[0].bookingDate, rows[0].partnerName, rows[0].amountCents],
    ["2026-08-20", "MERCADONA", -4520]);
  assert.equal(rows[2].amountCents, 180000);
});

test("decide: skip por externalId, reconcile por pending, create el resto", () => {
  const rows = p.bcParseN26Csv(csv).map((r) => ({
    ...r, externalId: p.bcBuildExternalId(r.bookingDate, r.amountCents, r.partnerName, r.paymentReference, sha256hex)}));
  const existing = [
    { id: "t1", dateIso: "2026-08-19", type: "expense", amountCents: 4520, externalId: "", status: "pending" },
    { id: "t2", dateIso: "2026-08-21", type: "refund", amountCents: 36000, externalId: rows[1].externalId, status: "reconciled" },
  ];
  assert.deepEqual(p.bcDecideImportAction(rows[0], existing), { action: "reconcile", matchId: "t1" });
  assert.deepEqual(p.bcDecideImportAction(rows[1], existing), { action: "skip" });
  assert.deepEqual(p.bcDecideImportAction(rows[2], existing), { action: "create" });
});

test("decide: transferencia pendiente NO es candidata de conciliación (A2) — un abono se crea, no se traga la transferencia", () => {
  // Escenario del hallazgo: transferencia manual pendiente de 500€ (dinero saliente de la
  // cuenta, signo negativo — ver n26.js signedAmountCents) + import de un abono de 500€ a 1 día
  // de diferencia. Antes del fix esto reconciliaba contra la transferencia (mismo importe en
  // valor absoluto y `(t.type === "expense") === quiereGasto` daba true para type≠'expense'
  // cuando el abono es un ingreso). Ahora debe crearse como fila nueva.
  const existing = [
    { id: "tr1", dateIso: "2026-08-19", type: "transfer", amountCents: -50000, externalId: "", status: "pending" },
  ];
  const abono = { bookingDate: "2026-08-20", amountCents: 50000, externalId: "hash-abono-nuevo" };
  assert.deepEqual(p.bcDecideImportAction(abono, existing), { action: "create" });
});

test("decide: expense/income pendientes SIGUEN siendo candidatos de conciliación (pin, sin cambios)", () => {
  const existing = [
    { id: "e1", dateIso: "2026-08-19", type: "expense", amountCents: -4520, externalId: "", status: "pending" },
    { id: "i1", dateIso: "2026-08-19", type: "income", amountCents: 36000, externalId: "", status: "pending" },
  ];
  assert.deepEqual(
    p.bcDecideImportAction({ bookingDate: "2026-08-20", amountCents: -4520, externalId: "x" }, existing),
    { action: "reconcile", matchId: "e1" });
  assert.deepEqual(
    p.bcDecideImportAction({ bookingDate: "2026-08-20", amountCents: 36000, externalId: "y" }, existing),
    { action: "reconcile", matchId: "i1" });
});

test("picker → id", () => {
  const cats = [
    { id: "cat-casa", name: "Casa", parentId: "" },
    { id: "cat-casa-luz", name: "Luz", parentId: "cat-casa" },
    { id: "cat-ropa", name: "Ropa y cuidado personal", parentId: "" },
  ];
  assert.equal(p.bcResolvePickerToId("Casa → Luz", cats), "cat-casa-luz");
  assert.equal(p.bcResolvePickerToId("Ropa y cuidado personal", cats), "cat-ropa");
  assert.equal(p.bcResolvePickerToId("No existe", cats), "");
});

test("firstEmptyIndex: primera posición vacía o length", () => {
  assert.equal(p.bcFirstEmptyIndex(["a", "b", "", "c"]), 2);
  assert.equal(p.bcFirstEmptyIndex([]), 0);
  assert.equal(p.bcFirstEmptyIndex(["a", "b"]), 2);
});

test("normalizeDateIso: Date usa formatFn, string se recorta a YYYY-MM-DD", () => {
  const fakeFormat = (d) => "2026-08-19";
  assert.equal(p.bcNormalizeDateIso(new Date(2026, 7, 19), fakeFormat), "2026-08-19");
  assert.equal(p.bcNormalizeDateIso("2026-08-19T00:00:00", fakeFormat), "2026-08-19");
});

test("sanitizeCell: neutraliza inyección de fórmulas, deja el resto intacto", () => {
  assert.equal(p.bcSanitizeCell("=IMPORTXML(1)"), "'=IMPORTXML(1)");
  assert.equal(p.bcSanitizeCell("Mercadona"), "Mercadona");
  assert.equal(p.bcSanitizeCell(null), "");
});

test("parseN26Csv: cabecera no reconocida lanza error", () => {
  assert.throws(() => p.bcParseN26Csv('"foo","bar"\n"1","2"'));
});
