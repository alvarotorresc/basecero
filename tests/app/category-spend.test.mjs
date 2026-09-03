import { test } from "node:test";
import assert from "node:assert/strict";
import {
  budgetStatus, pctOf, relativeWidth, limitTotals, sortRootRows, budgetMap, inheritedBudgetsRaw,
} from "../../app/app/js/category-spend.js";

test("budgetStatus: 82% del límite -> ok", () => {
  const s = budgetStatus(82, 100);
  assert.equal(s.level, "ok");
  assert.equal(s.pct, 82);
});

test("budgetStatus: 85% del límite -> warn (umbral inclusivo)", () => {
  const s = budgetStatus(85, 100);
  assert.equal(s.level, "warn");
  assert.equal(s.pct, 85);
});

test("budgetStatus: 92% del límite -> warn", () => {
  const s = budgetStatus(92, 100);
  assert.equal(s.level, "warn");
  assert.equal(s.pct, 92);
});

test("budgetStatus: 100% del límite -> warn (no over todavía)", () => {
  const s = budgetStatus(100, 100);
  assert.equal(s.level, "warn");
  assert.equal(s.pct, 100);
});

test("budgetStatus: 100.1%+ del límite -> over", () => {
  const s = budgetStatus(1001, 1000);
  assert.equal(s.level, "over");
  assert.ok(Math.abs(s.pct - 100.1) < 1e-9);
});

test("budgetStatus: límite 0 -> sin estado (null)", () => {
  assert.equal(budgetStatus(500, 0), null);
});

test("budgetStatus: límite null -> sin estado (null)", () => {
  assert.equal(budgetStatus(500, null), null);
});

test("pctOf: entero redondeado, y 0 cuando no hay límite", () => {
  assert.equal(pctOf(4651, 12000), 39);
  assert.equal(pctOf(5000, 10000), 50);
  assert.equal(pctOf(12500, 10000), 125, "no capa: el número dice el % real");
  assert.equal(pctOf(0, 10000), 0);
  assert.equal(pctOf(500, 0), 0);
  assert.equal(pctOf(500, null), 0);
  assert.equal(pctOf(-500, 10000), -5, "una raíz con más devoluciones que gasto puede dar negativo");
});

test("relativeWidth: proporción sobre el máximo, acotada a 0..100", () => {
  assert.equal(relativeWidth(6000, 12000), 50);
  assert.equal(relativeWidth(12000, 12000), 100);
  assert.equal(relativeWidth(0, 12000), 0);
  assert.equal(relativeWidth(-3000, 12000), 0, "clamp inferior: nunca un width negativo");
  assert.equal(relativeWidth(18000, 12000), 100, "clamp superior");
  assert.equal(relativeWidth(5000, 0), 0, "sin máximo no hay proporción posible");
  assert.equal(relativeWidth(5000, -100), 0);
});

test("limitTotals: suma SOLO las raíces con límite > 0 y las cuenta", () => {
  const rows = [
    { root_id: "cat-casa", name: "Casa", spent_cents: 21050 },
    { root_id: "cat-alimentacion", name: "Alimentación", spent_cents: 15840 },
    { root_id: "cat-ocio", name: "Ocio", spent_cents: 6000 },
    { root_id: "cat-salud", name: "Salud", spent_cents: 3485 },
  ];
  const budgets = { "cat-casa": 45000, "cat-alimentacion": 30000, "cat-ocio": 0 };

  assert.deepEqual(limitTotals(rows, budgets), { spent: 36890, limit: 75000, count: 2 });
  assert.deepEqual(limitTotals(rows, {}), { spent: 0, limit: 0, count: 0 }, "sin ningún límite");
  assert.deepEqual(limitTotals([], budgets), { spent: 0, limit: 0, count: 0 });
});

test("sortRootRows: gasto desc, luego las que tienen límite, luego nombre; sin mutar la entrada", () => {
  const rows = [
    { root_id: "cat-otros", name: "Otros gastos", spent_cents: 0 },
    { root_id: "cat-ocio", name: "Ocio", spent_cents: 6000 },
    { root_id: "cat-casa", name: "Casa", spent_cents: 21050 },
    { root_id: "cat-coche", name: "Coche", spent_cents: 0 },
    { root_id: "cat-ropa", name: "Ropa", spent_cents: 0 },
  ];
  const original = rows.map((r) => r.root_id);
  const budgets = { "cat-ropa": 5000 };

  assert.deepEqual(
    sortRootRows(rows, budgets).map((r) => r.root_id),
    ["cat-casa", "cat-ocio", "cat-ropa", "cat-coche", "cat-otros"],
    "21050 > 6000 > (los tres a 0: primero la que tiene límite, luego Coche y Otros gastos por nombre)",
  );
  assert.deepEqual(rows.map((r) => r.root_id), original, "no muta el array recibido");
});

test("sortRootRows: a igual gasto y mismo estado de límite, desempata el nombre", () => {
  const rows = [
    { root_id: "b", name: "Zapatos", spent_cents: 1000 },
    { root_id: "a", name: "Alquiler", spent_cents: 1000 },
    { root_id: "c", name: "Ocio", spent_cents: 1000 },
  ];
  assert.deepEqual(sortRootRows(rows, {}).map((r) => r.name), ["Alquiler", "Ocio", "Zapatos"]);
});

test("budgetMap: una entrada por categoría, gana la PRIMERA fila (la consulta ya llega por updated_at DESC)", () => {
  assert.deepEqual(budgetMap([
    { id: "b-nueva", category_id: "cat-casa", amount_cents: 30000 },
    { id: "b-vieja", category_id: "cat-casa", amount_cents: 45000 },
    { id: "b-ocio", category_id: "cat-ocio", amount_cents: 12000 },
  ]), { "cat-casa": 30000, "cat-ocio": 12000 }, "Object.fromEntries se quedaría con la VIEJA: aquí gana la primera");
  assert.deepEqual(budgetMap([]), {});
  assert.deepEqual(budgetMap([{ id: "b-x", category_id: "__proto__", amount_cents: 1 }]), {},
    "un category_id «__proto__» (el charset de ids del import admite guiones bajos) se descarta en vez de tocar Object.prototype");
});

test("inheritedBudgetsRaw: euros exactos como string, con céntimos y sin decimales sobrantes", () => {
  const rootRows = [
    { root_id: "cat-casa", name: "Casa", spent_cents: 50000 },
    { root_id: "cat-ocio", name: "Ocio", spent_cents: 0 },
    { root_id: "cat-super", name: "Supermercado", spent_cents: 12000 },
  ];
  const budgetRows = [
    { id: "b1", category_id: "cat-casa", amount_cents: 90000 },   // 900 € justos
    { id: "b2", category_id: "cat-ocio", amount_cents: 12345 },   // 123,45 €
    { id: "b3", category_id: "cat-super", amount_cents: 5 },      // 0,05 €
  ];
  assert.deepEqual(inheritedBudgetsRaw(budgetRows, rootRows), {
    "cat-casa": "900",
    "cat-ocio": "123.45",
    "cat-super": "0.05",
  }, "punto decimal: es lo único que acepta el value de un input numérico");
  // Una raíz sin límite no aparece: el campo se queda vacío, que es «sin límite».
  assert.deepEqual(inheritedBudgetsRaw([], rootRows), {});
  assert.deepEqual(inheritedBudgetsRaw(budgetRows, []), {});
});

test("inheritedBudgetsRaw: fuera las categorías que la pantalla no pinta y los importes que no son límite", () => {
  const rootRows = [{ root_id: "cat-casa", name: "Casa", spent_cents: 0 }];
  const budgetRows = [
    { id: "b1", category_id: "cat-casa", amount_cents: 30000 },
    // Límite de una categoría que NO está en rootRows (una hija, o una raíz que se archivó): si se
    // heredara, sumaría en «Presupuestado» sin fila donde verlo ni quitarlo.
    { id: "b2", category_id: "cat-casa-alquiler", amount_cents: 70000 },
  ];
  assert.deepEqual(inheritedBudgetsRaw(budgetRows, rootRows), { "cat-casa": "300" }); // 30000 céntimos = 300 €
  // Un límite a 0 o negativo (solo alcanzable importando una hoja a mano) es «sin límite» para
  // budgetStatus: tampoco se hereda.
  assert.deepEqual(inheritedBudgetsRaw([{ id: "b3", category_id: "cat-casa", amount_cents: 0 }], rootRows), {});
  assert.deepEqual(inheritedBudgetsRaw([{ id: "b4", category_id: "cat-casa", amount_cents: -500 }], rootRows), {});
  // Duplicados de una hoja editada a mano: manda el mismo criterio que budgetMap (gana la primera,
  // que la consulta ya deja ordenada por updated_at DESC).
  assert.deepEqual(inheritedBudgetsRaw([
    { id: "b5", category_id: "cat-casa", amount_cents: 30000 },
    { id: "b6", category_id: "cat-casa", amount_cents: 99900 },
  ], rootRows), { "cat-casa": "300" });
});
