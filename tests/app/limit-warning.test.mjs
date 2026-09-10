import { test } from "node:test";
import assert from "node:assert/strict";
import { WARN_FRACTION, limitWarning } from "../../app/app/js/limit-warning.js";

const byId = {
  "cat-restauracion": { id: "cat-restauracion", parent_id: "", name: "Restauración" },
  "cat-restauracion-bares": { id: "cat-restauracion-bares", parent_id: "cat-restauracion", name: "Bares y cafés" },
};

test("sin categoría (null/undefined/vacío) devuelve null", () => {
  assert.equal(limitWarning({ categoryId: null, amountCents: 100, byId, spentByRoot: {}, budgetByCategory: {} }), null);
  assert.equal(limitWarning({ categoryId: "", amountCents: 100, byId, spentByRoot: {}, budgetByCategory: {} }), null);
});

test("categoría sin límite (no hay entrada en budgetByCategory) devuelve null", () => {
  const r = limitWarning({ categoryId: "cat-restauracion-bares", amountCents: 100, byId, spentByRoot: { "cat-restauracion": 5000 }, budgetByCategory: {} });
  assert.equal(r, null);
});

test("límite a 0 devuelve null (coherente con budgetStatus)", () => {
  const r = limitWarning({ categoryId: "cat-restauracion-bares", amountCents: 100, byId, spentByRoot: {}, budgetByCategory: { "cat-restauracion": 0 } });
  assert.equal(r, null);
});

test("una hoja cuenta contra el límite y el gasto de su RAÍZ (rootOf)", () => {
  const r = limitWarning({
    categoryId: "cat-restauracion-bares", amountCents: 1000, byId,
    spentByRoot: { "cat-restauracion": 5000 }, budgetByCategory: { "cat-restauracion": 15000 },
  });
  assert.equal(r.rootId, "cat-restauracion");
  assert.equal(r.rootName, "Restauración");
  assert.equal(r.limitCents, 15000);
  assert.equal(r.spentCents, 5000);
});

test("nivel ok: remainingAfter justo en el 10% del límite (frontera exacta)", () => {
  // limit 1000, spent 0, amount 900 -> remainingAfter = 100 = 10% de 1000
  const r = limitWarning({ categoryId: "cat-restauracion-bares", amountCents: 900, byId, spentByRoot: {}, budgetByCategory: { "cat-restauracion": 1000 } });
  assert.equal(r.remainingAfterCents, 100);
  assert.equal(r.level, "ok");
});

test("nivel warn: remainingAfter justo en 0 (frontera exacta)", () => {
  const r = limitWarning({ categoryId: "cat-restauracion-bares", amountCents: 1000, byId, spentByRoot: {}, budgetByCategory: { "cat-restauracion": 1000 } });
  assert.equal(r.remainingAfterCents, 0);
  assert.equal(r.level, "warn");
});

test("nivel over: remainingAfter justo por encima del límite (un céntimo negativo)", () => {
  const r = limitWarning({ categoryId: "cat-restauracion-bares", amountCents: 1001, byId, spentByRoot: {}, budgetByCategory: { "cat-restauracion": 1000 } });
  assert.equal(r.remainingAfterCents, -1);
  assert.equal(r.level, "over");
});

// SISTEMA.md §5: Restauración 96,30 gastado de 150,00, gasto en curso 45,20 -> quedan 8,50 = 5,7 %.
test("caso de SISTEMA.md §5: 96,30 de 150,00 con 45,20 en curso -> warn, quedan 8,50 €", () => {
  const r = limitWarning({
    categoryId: "cat-restauracion-bares", amountCents: 4520, byId,
    spentByRoot: { "cat-restauracion": 9630 }, budgetByCategory: { "cat-restauracion": 15000 },
  });
  assert.equal(r.remainingAfterCents, 850);
  assert.equal(r.level, "warn");
});

test("un gasto compartido cuenta MI PARTE, no el importe total del ticket", () => {
  const args = { categoryId: "cat-restauracion-bares", byId, spentByRoot: { "cat-restauracion": 0 }, budgetByCategory: { "cat-restauracion": 8000 } };
  // Ticket de 90,40 € compartido al 50 %: mi parte son 45,20 €.
  const conMiParte = limitWarning({ ...args, amountCents: 4520 });
  const conElTicketEntero = limitWarning({ ...args, amountCents: 9040 });
  assert.equal(conMiParte.level, "ok");
  assert.equal(conElTicketEntero.level, "over");
});

test("WARN_FRACTION exportada y en 0.10", () => {
  assert.equal(WARN_FRACTION, 0.10);
});
