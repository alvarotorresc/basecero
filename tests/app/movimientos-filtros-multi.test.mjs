// B-2 · Filtros múltiples de Movimientos (B-Movimientos-Filtros): varias categorías en O, cuenta,
// rango de importe y «solo compartidos», en Y con todo lo demás. movimientos-filter.test.mjs (la
// semántica de siempre) no se toca: estos tests solo añaden los campos nuevos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesFilter, rowAmountCents, amountBoundCents, isFilterActive, activeCategoryCount } from "../../app/app/js/movimientos-filter.js";

const byId = {
  "cat-casa": { id: "cat-casa", parent_id: "" },
  "cat-casa-luz": { id: "cat-casa-luz", parent_id: "cat-casa" },
  "cat-ali": { id: "cat-ali", parent_id: "" },
  "cat-ali-super": { id: "cat-ali-super", parent_id: "cat-ali" },
  "cat-res": { id: "cat-res", parent_id: "" },
};

const row = (over = {}) => ({
  type: "expense", category_id: "cat-ali-super", merchant: "", note: "", tag_id: "",
  account_id: "acc-corr", counter_account_id: "", amount_cents: 2000, my_amount_cents: 2000, is_shared: 0, ...over,
});

// ---- rootCatIds (O entre ellas) -------------------------------------------------------------

test("rootCatIds: casa con cualquiera de las raíces de la lista (O)", () => {
  const f = { rootCatIds: ["cat-casa", "cat-ali"] };
  assert.equal(matchesFilter(row({ category_id: "cat-ali-super" }), f, byId), true);
  assert.equal(matchesFilter(row({ category_id: "cat-casa-luz" }), f, byId), true);
  assert.equal(matchesFilter(row({ category_id: "cat-res" }), f, byId), false);
});

test("rootCatIds vacío o ausente no filtra", () => {
  assert.equal(matchesFilter(row({ category_id: "cat-res" }), { rootCatIds: [] }, byId), true);
  assert.equal(matchesFilter(row({ category_id: "" }), { rootCatIds: [] }, byId), true);
  assert.equal(matchesFilter(row({ type: "transfer", category_id: "" }), {}, byId), true);
});

test("rootCatIds excluye filas sin categoría y transferencias", () => {
  const f = { rootCatIds: ["cat-ali"] };
  assert.equal(matchesFilter(row({ category_id: "" }), f, byId), false);
  assert.equal(matchesFilter(row({ type: "transfer", category_id: "" }), f, byId), false);
});

test("rootCatIds + uncat: «Sin categoría» es una opción más de la sección (O)", () => {
  const f = { rootCatIds: ["cat-ali"], uncat: true };
  assert.equal(matchesFilter(row({ category_id: "cat-ali-super" }), f, byId), true);
  assert.equal(matchesFilter(row({ category_id: "" }), f, byId), true);
  assert.equal(matchesFilter(row({ category_id: "cat-res" }), f, byId), false);
  assert.equal(matchesFilter(row({ type: "transfer", category_id: "" }), f, byId), false);
});

test("uncat con rootCatIds vacío se comporta como siempre", () => {
  const f = { rootCatIds: [], uncat: true };
  assert.equal(matchesFilter(row({ category_id: "" }), f, byId), true);
  assert.equal(matchesFilter(row({ category_id: "cat-ali" }), f, byId), false);
});

test("rootCatIds + query + tagId se combinan en Y", () => {
  const r = row({ category_id: "cat-casa-luz", merchant: "Iberdrola", tag_id: "tag-1" });
  assert.equal(matchesFilter(r, { rootCatIds: ["cat-casa", "cat-res"], query: "iber", tagId: "tag-1" }, byId), true);
  assert.equal(matchesFilter(r, { rootCatIds: ["cat-casa"], query: "endesa" }, byId), false);
  assert.equal(matchesFilter(r, { rootCatIds: ["cat-casa"], tagId: "tag-2" }, byId), false);
});

// ---- accountId -------------------------------------------------------------------------------

test("accountId casa con la cuenta del movimiento", () => {
  assert.equal(matchesFilter(row({ account_id: "acc-corr" }), { accountId: "acc-corr" }, byId), true);
  assert.equal(matchesFilter(row({ account_id: "acc-aho" }), { accountId: "acc-corr" }, byId), false);
});

test("accountId casa también con la cuenta de destino de una transferencia", () => {
  const tr = row({ type: "transfer", category_id: "", account_id: "acc-corr", counter_account_id: "acc-hucha" });
  assert.equal(matchesFilter(tr, { accountId: "acc-hucha" }, byId), true);
  assert.equal(matchesFilter(tr, { accountId: "acc-corr" }, byId), true);
  assert.equal(matchesFilter(tr, { accountId: "acc-aho" }, byId), false);
});

test("accountId null o vacío no filtra", () => {
  assert.equal(matchesFilter(row(), { accountId: null }, byId), true);
  assert.equal(matchesFilter(row(), { accountId: "" }, byId), true);
});

// ---- importe ---------------------------------------------------------------------------------

test("rowAmountCents: la cifra que enseña la fila (mi parte si es compartido), en valor absoluto", () => {
  assert.equal(rowAmountCents(row({ amount_cents: 2400, my_amount_cents: 2400 })), 2400);
  assert.equal(rowAmountCents(row({ amount_cents: 2400, my_amount_cents: 1200, is_shared: 1 })), 1200);
  assert.equal(rowAmountCents(row({ type: "adjustment", category_id: "", amount_cents: -500, my_amount_cents: -500 })), 500);
  assert.equal(rowAmountCents(row({ type: "transfer", category_id: "", amount_cents: 10000, my_amount_cents: undefined })), 10000);
});

test("minCents y maxCents son inclusivos", () => {
  const r = row({ amount_cents: 1000, my_amount_cents: 1000 });
  assert.equal(matchesFilter(r, { minCents: 1000 }, byId), true);
  assert.equal(matchesFilter(r, { minCents: 1001 }, byId), false);
  assert.equal(matchesFilter(r, { maxCents: 1000 }, byId), true);
  assert.equal(matchesFilter(r, { maxCents: 999 }, byId), false);
  assert.equal(matchesFilter(r, { minCents: 500, maxCents: 1500 }, byId), true);
});

test("min/max null o undefined no acotan (0 sí es un tope)", () => {
  const r = row({ amount_cents: 1000, my_amount_cents: 1000 });
  assert.equal(matchesFilter(r, { minCents: null, maxCents: null }, byId), true);
  assert.equal(matchesFilter(r, { minCents: undefined, maxCents: undefined }, byId), true);
  assert.equal(matchesFilter(r, { maxCents: 0 }, byId), false);
});

test("importe de un compartido: se compara mi parte", () => {
  const r = row({ amount_cents: 3000, my_amount_cents: 1500, is_shared: 1 });
  assert.equal(matchesFilter(r, { minCents: 2000 }, byId), false);
  assert.equal(matchesFilter(r, { maxCents: 1500 }, byId), true);
});

test("importe de un ajuste negativo: por su valor absoluto", () => {
  const r = row({ type: "adjustment", category_id: "", amount_cents: -2500, my_amount_cents: -2500 });
  assert.equal(matchesFilter(r, { minCents: 2000 }, byId), true);
  assert.equal(matchesFilter(r, { maxCents: 2000 }, byId), false);
});

test("amountBoundCents: vacío es sin tope (null), no 0", () => {
  assert.equal(amountBoundCents(""), null);
  assert.equal(amountBoundCents("   "), null);
  assert.equal(amountBoundCents(null), null);
  assert.equal(amountBoundCents(undefined), null);
  assert.equal(amountBoundCents("10,00"), 1000);
  assert.equal(amountBoundCents("12.5"), 1250);
  assert.equal(amountBoundCents("0"), 0);
  assert.equal(amountBoundCents("-7"), 700);
  assert.equal(amountBoundCents("abc"), null);
});

// ---- solo compartidos ------------------------------------------------------------------------

test("sharedOnly deja solo los compartidos", () => {
  assert.equal(matchesFilter(row({ is_shared: 1 }), { sharedOnly: true }, byId), true);
  assert.equal(matchesFilter(row({ is_shared: 0 }), { sharedOnly: true }, byId), false);
  assert.equal(matchesFilter(row({ is_shared: 0 }), { sharedOnly: false }, byId), true);
});

test("todos los filtros nuevos se combinan en Y", () => {
  const r = row({ category_id: "cat-casa-luz", account_id: "acc-corr", amount_cents: 6000, my_amount_cents: 3000, is_shared: 1 });
  const f = { rootCatIds: ["cat-casa", "cat-ali"], accountId: "acc-corr", minCents: 1000, maxCents: 5000, sharedOnly: true };
  assert.equal(matchesFilter(r, f, byId), true);
  assert.equal(matchesFilter(r, { ...f, accountId: "acc-aho" }, byId), false);
  assert.equal(matchesFilter(r, { ...f, maxCents: 2000 }, byId), false);
  assert.equal(matchesFilter({ ...r, is_shared: 0, my_amount_cents: 6000 }, { ...f, maxCents: 10000 }, byId), false);
  assert.equal(matchesFilter(r, { ...f, rootCatIds: ["cat-res"] }, byId), false);
});

// ---- ayudas de la UI -------------------------------------------------------------------------

test("isFilterActive: falso con el filtro neutro, cierto con cualquier campo puesto (salvo la búsqueda)", () => {
  assert.equal(isFilterActive({ query: "", rootCatIds: [], uncat: false, tagId: null, accountId: null, minCents: null, maxCents: null, sharedOnly: false }), false);
  assert.equal(isFilterActive({ query: "merca" }), false);
  assert.equal(isFilterActive({ rootCatIds: ["cat-ali"] }), true);
  assert.equal(isFilterActive({ rootCatId: "cat-ali" }), true);
  assert.equal(isFilterActive({ uncat: true }), true);
  assert.equal(isFilterActive({ tagId: "t" }), true);
  assert.equal(isFilterActive({ accountId: "a" }), true);
  assert.equal(isFilterActive({ minCents: 0 }), true);
  assert.equal(isFilterActive({ maxCents: 100 }), true);
  assert.equal(isFilterActive({ sharedOnly: true }), true);
  assert.equal(isFilterActive(null), false);
});

test("activeCategoryCount: raíces elegidas más «sin categoría»", () => {
  assert.equal(activeCategoryCount({ rootCatIds: [], uncat: false }), 0);
  assert.equal(activeCategoryCount({ rootCatIds: ["a", "b"], uncat: false }), 2);
  assert.equal(activeCategoryCount({ rootCatIds: ["a"], uncat: true }), 2);
  assert.equal(activeCategoryCount({ rootCatId: "a" }), 1);
  assert.equal(activeCategoryCount({}), 0);
});
