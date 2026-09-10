import { test } from "node:test";
import assert from "node:assert/strict";
import { MEMORY_WINDOW, normalizeMerchant, merchantMemory, memoryPatch } from "../../app/app/js/merchant-memory.js";

test("MEMORY_WINDOW es 500", () => {
  assert.equal(MEMORY_WINDOW, 500);
});

test("normalizeMerchant: quita acentos", () => {
  assert.equal(normalizeMerchant("Café Núñez"), "cafe nunez");
});

test("normalizeMerchant: mayúsculas a minúsculas", () => {
  assert.equal(normalizeMerchant("MERCADONA"), "mercadona");
});

test("normalizeMerchant: colapsa espacios dobles y recorta los extremos", () => {
  assert.equal(normalizeMerchant("  Bar  La   Plaza  "), "bar la plaza");
});

test("normalizeMerchant: cadena vacía o nula da cadena vacía", () => {
  assert.equal(normalizeMerchant(""), "");
  assert.equal(normalizeMerchant(null), "");
  assert.equal(normalizeMerchant(undefined), "");
});

test("merchantMemory: gana la PRIMERA fila de cada comercio (rows de más reciente a más antigua)", () => {
  const rows = [
    { merchant: "Mercadona", category_id: "cat-alimentacion-super", account_id: "acc-1", is_shared: 0, share_pct_override: null, paid_by: "me", date: "2026-09-05", type: "expense" },
    { merchant: "Mercadona", category_id: "cat-alimentacion-antigua", account_id: "acc-2", is_shared: 1, share_pct_override: 50, paid_by: "partner", date: "2026-08-01", type: "expense" },
  ];
  const mem = merchantMemory(rows);
  assert.equal(mem["mercadona"].categoryId, "cat-alimentacion-super");
  assert.equal(mem["mercadona"].accountId, "acc-1");
  assert.equal(mem["mercadona"].isShared, false);
});

test("merchantMemory: count cuenta TODAS las apariciones dentro de la ventana", () => {
  const rows = [
    { merchant: "Mercadona", category_id: "c1", account_id: "a1", is_shared: 0, share_pct_override: null, paid_by: "me", date: "2026-09-05", type: "expense" },
    { merchant: "MERCADONA", category_id: "c1", account_id: "a1", is_shared: 0, share_pct_override: null, paid_by: "me", date: "2026-09-01", type: "expense" },
    { merchant: "mercadona ", category_id: "c1", account_id: "a1", is_shared: 0, share_pct_override: null, paid_by: "me", date: "2026-08-01", type: "expense" },
  ];
  assert.equal(merchantMemory(rows)["mercadona"].count, 3);
});

test("merchantMemory: display conserva la escritura original de la aparición MÁS RECIENTE", () => {
  const rows = [
    { merchant: "Bar La Plaza", category_id: "c1", account_id: "a1", is_shared: 0, share_pct_override: null, paid_by: "me", date: "2026-09-05", type: "expense" },
    { merchant: "bar la plaza", category_id: "c1", account_id: "a1", is_shared: 0, share_pct_override: null, paid_by: "me", date: "2026-08-01", type: "expense" },
  ];
  assert.equal(merchantMemory(rows)["bar la plaza"].display, "Bar La Plaza");
});

test("merchantMemory: filas sin comercio se ignoran", () => {
  const rows = [
    { merchant: "", category_id: "c1", account_id: "a1", is_shared: 0, share_pct_override: null, paid_by: "me", date: "2026-09-05", type: "expense" },
    { merchant: "   ", category_id: "c1", account_id: "a1", is_shared: 0, share_pct_override: null, paid_by: "me", date: "2026-09-05", type: "expense" },
  ];
  assert.deepEqual(merchantMemory(rows), {});
});

test("merchantMemory: un comercio llamado __proto__ no envenena el mapa", () => {
  const rows = [
    { merchant: "__proto__", category_id: "c1", account_id: "a1", is_shared: 0, share_pct_override: null, paid_by: "me", date: "2026-09-05", type: "expense" },
  ];
  const mem = merchantMemory(rows);
  assert.equal(Object.getPrototypeOf(mem), Object.prototype);
  assert.equal(mem.polluted, undefined);
  assert.ok(!Object.hasOwn(mem, "__proto__"));
});

test("memoryPatch: no pisa los campos que ya están en touched", () => {
  const entry = { categoryId: "cat-restauracion-bares", accountId: "acc-1", isShared: true, paidBy: "me", sharePct: 50 };
  const touched = new Set(["categoryId"]);
  const patch = memoryPatch(entry, touched);
  assert.ok(!("categoryId" in patch));
  assert.equal(patch.accountId, "acc-1");
  assert.equal(patch.isShared, true);
});

test("memoryPatch: devuelve un parche nuevo sin mutar entry", () => {
  const entry = { categoryId: "cat-restauracion-bares", accountId: "acc-1", isShared: false, paidBy: "me", sharePct: null };
  const before = JSON.stringify(entry);
  const patch = memoryPatch(entry, new Set());
  assert.notEqual(patch, entry);
  assert.equal(JSON.stringify(entry), before);
});

test("memoryPatch: sin entry devuelve un parche vacío", () => {
  assert.deepEqual(memoryPatch(null, new Set()), {});
});

// sql.js#merchantHistory lee expense+income+refund del mismo comercio (un "Mercadona" puede
// aparecer como gasto y, rarísimo pero posible, como una devolución de nómina registrada como
// ingreso): la categoría que ganó merchantMemory() puede pertenecer a un tipo de movimiento
// distinto al que se está rellenando ahora mismo. Sin este filtro, escribir el comercio en un
// Gasto podía colar una categoría de Ingreso (o viceversa) — pasaba la validación (que solo mira
// truthiness) y se guardaba un category_id que no aparece marcado en la rejilla ni cuenta para
// los límites de su raíz real.
test("memoryPatch: descarta categoryId si no está entre las categorías válidas del tipo actual", () => {
  const entry = { categoryId: "cat-nomina", accountId: "acc-1", isShared: false, paidBy: "me", sharePct: null };
  const patch = memoryPatch(entry, new Set(), ["cat-alimentacion-supermercado", "cat-restauracion-bares"]);
  assert.ok(!("categoryId" in patch));
  assert.equal(patch.accountId, "acc-1");
});

test("memoryPatch: conserva categoryId si SÍ está entre las categorías válidas del tipo actual", () => {
  const entry = { categoryId: "cat-restauracion-bares", accountId: "acc-1", isShared: true, paidBy: "me", sharePct: 50 };
  const patch = memoryPatch(entry, new Set(), ["cat-alimentacion-supermercado", "cat-restauracion-bares"]);
  assert.equal(patch.categoryId, "cat-restauracion-bares");
});

test("memoryPatch: sin lista de categorías válidas (tercer argumento omitido) no filtra nada", () => {
  const entry = { categoryId: "cat-nomina", accountId: "acc-1", isShared: false, paidBy: "me", sharePct: null };
  const patch = memoryPatch(entry, new Set());
  assert.equal(patch.categoryId, "cat-nomina");
});
