import { test } from "node:test";
import assert from "node:assert/strict";
import { quickRegisterEnabled, detailsOpen, foldedSummaryParts, visibleCategories } from "../../app/app/js/registro-mode.js";

test("quickRegisterEnabled: ausente, vacío, \"1\" y basura son ON (default de producto)", () => {
  assert.equal(quickRegisterEnabled(undefined), true);
  assert.equal(quickRegisterEnabled(""), true);
  assert.equal(quickRegisterEnabled("1"), true);
  assert.equal(quickRegisterEnabled("loquesea"), true);
});

test("quickRegisterEnabled: solo \"0\" es OFF", () => {
  assert.equal(quickRegisterEnabled("0"), false);
});

test("detailsOpen: los cuatro cruces quick×expanded para un gasto normal", () => {
  assert.equal(detailsOpen({ quick: true, expanded: false, tipo: "expense" }), false);
  assert.equal(detailsOpen({ quick: true, expanded: true, tipo: "expense" }), true);
  assert.equal(detailsOpen({ quick: false, expanded: false, tipo: "expense" }), true);
  assert.equal(detailsOpen({ quick: false, expanded: true, tipo: "expense" }), true);
});

test("detailsOpen: transfer y adjustment siempre abiertos, aunque quick esté puesto y expanded no", () => {
  assert.equal(detailsOpen({ quick: true, expanded: false, tipo: "transfer" }), true);
  assert.equal(detailsOpen({ quick: true, expanded: false, tipo: "adjustment" }), true);
});

test("detailsOpen: refund siempre abierto en modo rápido — sin esto no hay selector de enlace", () => {
  assert.equal(detailsOpen({ quick: true, expanded: false, tipo: "refund" }), true);
  assert.equal(detailsOpen({ quick: true, expanded: true, tipo: "refund" }), true);
  assert.equal(detailsOpen({ quick: false, expanded: false, tipo: "refund" }), true);
});

test("foldedSummaryParts devuelve un array, nunca un string con separador ·", () => {
  const tr = (key) => key;
  const parts = foldedSummaryParts({ accountName: "Cuenta corriente", dateLabel: "hoy", hasNote: false, hasPhoto: false, sharedLabel: "" }, tr);
  assert.ok(Array.isArray(parts));
  assert.ok(parts.every((p) => !String(p).includes("·")));
  assert.deepEqual(parts, ["Cuenta corriente", "hoy", "registro.more.summaryNoNote"]);
});

test("foldedSummaryParts: con foto usa la pista de foto en vez de la de \"sin nota ni foto\"", () => {
  const tr = (key) => key;
  const parts = foldedSummaryParts({ accountName: "Cuenta corriente", dateLabel: "hoy", hasNote: false, hasPhoto: true, sharedLabel: "" }, tr);
  assert.deepEqual(parts, ["Cuenta corriente", "hoy", "registro.more.summaryPhoto"]);
});

test("foldedSummaryParts: con nota (sin foto) no añade ninguna de las dos pistas de nota/foto", () => {
  const tr = (key) => key;
  const parts = foldedSummaryParts({ accountName: "Cuenta corriente", dateLabel: "hoy", hasNote: true, hasPhoto: false, sharedLabel: "" }, tr);
  assert.deepEqual(parts, ["Cuenta corriente", "hoy"]);
});

test("foldedSummaryParts: el reparto se añade al final cuando hay sharedLabel", () => {
  const tr = (key) => key;
  const parts = foldedSummaryParts({ accountName: "Cuenta corriente", dateLabel: "hoy", hasNote: false, hasPhoto: false, sharedLabel: "compartido con Marta" }, tr);
  assert.deepEqual(parts, ["Cuenta corriente", "hoy", "registro.more.summaryNoNote", "compartido con Marta"]);
});

test("visibleCategories: con menos categorías que el límite, se enseñan todas y hidden es 0", () => {
  const cats = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(visibleCategories(cats, null, 8), { shown: cats, hidden: 0 });
});

test("visibleCategories: con más categorías que el límite, se corta a las primeras y cuenta las que quedan", () => {
  const cats = Array.from({ length: 10 }, (_, i) => ({ id: "c" + i }));
  const { shown, hidden } = visibleCategories(cats, null, 8);
  assert.equal(shown.length, 8);
  assert.equal(hidden, 2);
  assert.deepEqual(shown, cats.slice(0, 8));
});

test("visibleCategories: la seleccionada fuera de las primeras `limit` entra igualmente", () => {
  const cats = Array.from({ length: 10 }, (_, i) => ({ id: "c" + i }));
  const { shown, hidden } = visibleCategories(cats, "c9", 8);
  assert.equal(shown.length, 8);
  assert.equal(hidden, 2);
  assert.ok(shown.some((c) => c.id === "c9"));
});
