import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { SQL } from "../../app/js/sql.js";
import { seedStatements } from "../../app/js/seeds.js";
import { sha256Hex, externalIdFor } from "../../app/js/n26.js";

const require = createRequire(import.meta.url);
const pure = require("../../apps_script/pure.js");

// app/js/n26.js llama a bcBuildExternalId como GLOBAL (lo carga <script src="vendor/pure.js">
// en el navegador, sin import — ver cabecera de n26.js). apps_script/pure.js es la misma lógica
// pero como módulo CommonJS (require, no globales); aquí se expone la única función de pure.js
// que n26.js invoca de verdad (externalIdFor) para que funcione igual bajo Node.
globalThis.bcBuildExternalId = pure.bcBuildExternalId;

const T = "2026-08-24T18:00:00Z";
const NOW = "2026-08-24T19:00:00Z";
// hash síncrono determinista para los tests que no quieren depender de crypto.subtle (async) —
// mismo patrón que apps_script/tests/pure.test.mjs.
const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");

function db() {
  const d = new DatabaseSync(":memory:");
  d.exec(readFileSync(new URL("../../app/js/schema.sql", import.meta.url), "utf8"));
  for (const { sql, rows } of seedStatements(T)) for (const r of rows) d.prepare(sql).run(...r);
  d.prepare(SQL.insertPeriod).run("p1", "Agosto 2026", "2026-07-27", 60, T, T);
  return d;
}

const CSV_HEADER = '"Booking Date","Value Date","Partner Name","Partner Iban","Type",'
  + '"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"';

function csvRow({ date = "2026-08-20", partner = "MERCADONA", iban = "", type = "Presentment",
  ref = "Compra tarjeta", account = "Cuenta principal", amount = "-45.20" } = {}) {
  return `"${date}","${date}","${partner}","${iban}","${type}","${ref}","${account}","${amount}","","",""`;
}

const CSV_2ROWS = [CSV_HEADER, csvRow(), csvRow({ date: "2026-08-21", partner: "Sara",
  iban: "ES9121000000000000000000", type: "MoneyBeam", ref: "Bizum alquiler", amount: "360.00" })].join("\n");

/** Reproduce el flujo de n26.importN26Csv (app/js/n26.js) contra node:sqlite: no hay Worker
 *  disponible en Node (db.js depende de él), así que — mismo patrón que el resto de
 *  tests/app/*.test.mjs (repo-sql, recurrentes...) — se compone la SQL a mano en vez de invocar
 *  repo.js/n26.js directamente. Usa las MISMAS funciones puras que la implementación real:
 *  pure.bcParseN26Csv/bcDecideImportAction (apps_script/pure.js, idéntico a vendor/pure.js) y el
 *  externalIdFor REAL de n26.js (adaptador de captura incluido). */
async function runImport(d, text, hashFn = sha256hex) {
  const existing = d.prepare(SQL.n26Existing).all("acc-n26").map((t) => ({
    id: t.id, dateIso: t.date, type: t.type,
    amountCents: Math.abs(t.amount_cents) * (t.type === "expense" ? -1 : 1),
    externalId: t.external_id, status: t.status,
  }));
  const rows = pure.bcParseN26Csv(text);
  const res = { created: 0, reconciled: 0, skipped: 0 };
  for (const r of rows) {
    r.externalId = await externalIdFor(r, hashFn);
    const decision = pure.bcDecideImportAction(r, existing);
    if (decision.action === "skip") {
      res.skipped++;
    } else if (decision.action === "reconcile") {
      const match = existing.find((t) => t.id === decision.matchId);
      d.prepare(SQL.reconcileTx).run(r.externalId, NOW, match.id);
      match.externalId = r.externalId;
      res.reconciled++;
    } else {
      const id = "tx" + Math.floor(Math.random() * 1e9);
      const type = r.amountCents < 0 ? "expense" : "income";
      d.prepare(SQL.insertTransaction).run(id, r.bookingDate, "p1", type, Math.abs(r.amountCents),
        "acc-n26", "", "", pure.bcSanitizeCell(r.partnerName), pure.bcSanitizeCell(r.paymentReference),
        0, null, 0, "", "", r.externalId, "reconciled", NOW, NOW);
      existing.push({ id, dateIso: r.bookingDate, type, amountCents: r.amountCents,
        externalId: r.externalId, status: "reconciled" });
      res.created++;
    }
  }
  return res;
}

const n26Rows = (d) => d.prepare(`SELECT * FROM transactions WHERE account_id='acc-n26' AND deleted=0`).all();

test("import CSV de 2 filas sobre base vacía: 2 creadas reconciled sin categoría, signo/tipo correctos", async () => {
  const d = db();
  const res = await runImport(d, CSV_2ROWS);
  assert.deepEqual(res, { created: 2, reconciled: 0, skipped: 0 });

  const rows = n26Rows(d);
  assert.equal(rows.length, 2);

  const gasto = rows.find((r) => r.merchant === "MERCADONA");
  assert.equal(gasto.type, "expense");
  assert.equal(gasto.amount_cents, 4520);
  assert.equal(gasto.category_id, "");
  assert.equal(gasto.status, "reconciled");
  assert.equal(gasto.note, "Compra tarjeta");
  assert.equal(gasto.period_id, "p1");
  assert.match(gasto.external_id, /^[0-9a-f]{16}$/);

  const ingreso = rows.find((r) => r.merchant === "Sara");
  assert.equal(ingreso.type, "income");
  assert.equal(ingreso.amount_cents, 36000);
  assert.equal(ingreso.category_id, "");
  assert.equal(ingreso.status, "reconciled");
});

test("re-import del mismo CSV: 2 duplicadas (saltadas), sin filas nuevas", async () => {
  const d = db();
  await runImport(d, CSV_2ROWS);
  const res = await runImport(d, CSV_2ROWS);
  assert.deepEqual(res, { created: 0, reconciled: 0, skipped: 2 });
  assert.equal(n26Rows(d).length, 2);
});

test("fila que casa con un pending manual ≤3 días: reconciled, conserva categoría/comercio, gana external_id", async () => {
  const d = db();
  const T2 = "2026-08-19T10:00:00Z";
  d.prepare(SQL.insertTransaction).run(
    "manual1", "2026-08-19", "p1", "expense", 4520, "acc-n26", "",
    "cat-alimentacion-supermercado", "Compra en tienda", "", 0, null, 0, "", "", "", "pending", T2, T2);

  const res = await runImport(d, CSV_2ROWS);
  // Fila 1 (MERCADONA, -45.20, 2026-08-20) casa con manual1 (mismo importe, expense, 1 día de
  // diferencia); fila 2 (Sara, +360.00) no tiene con qué casar -> create.
  assert.deepEqual(res, { created: 1, reconciled: 1, skipped: 0 });
  assert.equal(n26Rows(d).length, 2);

  const manual = d.prepare(`SELECT * FROM transactions WHERE id='manual1'`).get();
  assert.equal(manual.status, "reconciled");
  assert.equal(manual.category_id, "cat-alimentacion-supermercado");
  assert.equal(manual.merchant, "Compra en tienda");
  assert.equal(manual.amount_cents, 4520);
  assert.equal(manual.date, "2026-08-19");
  assert.match(manual.external_id, /^[0-9a-f]{16}$/);
  assert.equal(manual.updated_at, NOW);
});

test("externalIdFor reproduce el payload de pure.js (mismo hashFn síncrono directo)", async () => {
  const row = { bookingDate: "2026-08-20", amountCents: -4520, partnerName: "MERCADONA", paymentReference: "Compra tarjeta" };
  const expected = pure.bcBuildExternalId(row.bookingDate, row.amountCents, row.partnerName, row.paymentReference, sha256hex);
  const actual = await externalIdFor(row, sha256hex);
  assert.equal(actual, expected);
  assert.match(actual, /^[0-9a-f]{16}$/);
});

test("sha256Hex: vector conocido sha256('abc')", async () => {
  const hex = await sha256Hex("abc");
  assert.ok(hex.startsWith("ba7816bf"));
});

test("parseN26Csv: cabecera no reconocida lanza error (propagado a importN26Csv)", () => {
  assert.throws(() => pure.bcParseN26Csv('"foo","bar"\n"1","2"'), /Cabecera CSV de N26 no reconocida/);
});
