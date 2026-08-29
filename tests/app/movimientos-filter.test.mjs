import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesFilter, isUncategorized } from "../../app/app/js/movimientos-filter.js";

// byId con una raíz y una hoja bajo ella (mismo shape que allCategoriesById): rootOf necesita
// parent_id para subir hasta la raíz.
const byId = {
  "cat-alimentacion": { id: "cat-alimentacion", parent_id: "" },
  "cat-alimentacion-super": { id: "cat-alimentacion-super", parent_id: "cat-alimentacion" },
  "cat-restauracion": { id: "cat-restauracion", parent_id: "" },
};

const ALL = { query: "", rootCatId: null, uncat: false };

function row(over = {}) {
  return { type: "expense", category_id: "cat-alimentacion-super", merchant: "", note: "", ...over };
}

test("matchesFilter: «Todos» (filtro neutro) hace match con cualquier fila", () => {
  assert.equal(matchesFilter(row(), ALL, byId), true);
  assert.equal(matchesFilter(row({ category_id: "" }), ALL, byId), true);
  assert.equal(matchesFilter(row({ type: "transfer", category_id: "" }), ALL, byId), true);
});

test("matchesFilter: query hace match sobre merchant", () => {
  const r = row({ merchant: "Mercadona" });
  assert.equal(matchesFilter(r, { ...ALL, query: "merca" }, byId), true);
});

test("matchesFilter: query hace match sobre note", () => {
  const r = row({ merchant: "", note: "Compra semanal" });
  assert.equal(matchesFilter(r, { ...ALL, query: "semanal" }, byId), true);
});

test("matchesFilter: query case-insensitive", () => {
  const r = row({ merchant: "MERCADONA" });
  assert.equal(matchesFilter(r, { ...ALL, query: "mercadona" }, byId), true);
  assert.equal(matchesFilter(row({ note: "Nota EN Mayúsculas" }), { ...ALL, query: "mayúsculas" }, byId), true);
});

test("matchesFilter: query sin coincidencia en merchant ni note devuelve false", () => {
  const r = row({ merchant: "Mercadona", note: "compra" });
  assert.equal(matchesFilter(r, { ...ALL, query: "carrefour" }, byId), false);
});

test("matchesFilter: rootCatId hace match con una hoja bajo esa raíz", () => {
  const r = row({ category_id: "cat-alimentacion-super" });
  assert.equal(matchesFilter(r, { ...ALL, rootCatId: "cat-alimentacion" }, byId), true);
});

test("matchesFilter: rootCatId excluye filas de otra raíz", () => {
  const r = row({ category_id: "cat-restauracion" });
  assert.equal(matchesFilter(r, { ...ALL, rootCatId: "cat-alimentacion" }, byId), false);
});

test("matchesFilter: uncat solo hace match con expense/income/refund sin categoría", () => {
  assert.equal(matchesFilter(row({ type: "expense", category_id: "" }), { ...ALL, uncat: true }, byId), true);
  assert.equal(matchesFilter(row({ type: "income", category_id: "" }), { ...ALL, uncat: true }, byId), true);
  assert.equal(matchesFilter(row({ type: "refund", category_id: "" }), { ...ALL, uncat: true }, byId), true);
  assert.equal(matchesFilter(row({ type: "transfer", category_id: "" }), { ...ALL, uncat: true }, byId), false);
  assert.equal(matchesFilter(row({ type: "adjustment", category_id: "" }), { ...ALL, uncat: true }, byId), false);
  assert.equal(matchesFilter(row({ type: "expense", category_id: "cat-alimentacion" }), { ...ALL, uncat: true }, byId), false);
});

test("matchesFilter: query + rootCatId se combinan con AND", () => {
  const r = row({ category_id: "cat-alimentacion-super", merchant: "Mercadona" });
  assert.equal(matchesFilter(r, { query: "merca", rootCatId: "cat-alimentacion", uncat: false }, byId), true);
  assert.equal(matchesFilter(r, { query: "carrefour", rootCatId: "cat-alimentacion", uncat: false }, byId), false);
  assert.equal(matchesFilter(r, { query: "merca", rootCatId: "cat-restauracion", uncat: false }, byId), false);
});

test("matchesFilter: sin filtro (undefined/null) hace match con cualquier fila", () => {
  assert.equal(matchesFilter(row(), undefined, byId), true);
  assert.equal(matchesFilter(row(), null, byId), true);
});

test("isUncategorized: expense/income/refund sin categoría, no transfer/adjustment", () => {
  assert.equal(isUncategorized({ type: "expense", category_id: "" }), true);
  assert.equal(isUncategorized({ type: "income", category_id: "" }), true);
  assert.equal(isUncategorized({ type: "refund", category_id: "" }), true);
  assert.equal(isUncategorized({ type: "transfer", category_id: "" }), false);
  assert.equal(isUncategorized({ type: "adjustment", category_id: "" }), false);
  assert.equal(isUncategorized({ type: "expense", category_id: "cat-alimentacion" }), false);
});
