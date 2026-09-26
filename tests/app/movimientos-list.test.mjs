// Lista de Movimientos (S5, B-Movimientos): agrupar por día y el total de cada cabecera de día.
// Funciones puras de movimientos-filter.js; movimientos-filter.test.mjs no se toca.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByDay, daySpentCents } from "../../app/app/js/movimientos-filter.js";

test("groupByDay: un bloque por fecha, en el orden de llegada", () => {
  const rows = [
    { id: "a", date: "2026-09-13" }, { id: "b", date: "2026-09-13" },
    { id: "c", date: "2026-09-12" }, { id: "d", date: "2026-09-10" },
  ];
  const g = groupByDay(rows);
  assert.deepEqual(g.map((x) => x.date), ["2026-09-13", "2026-09-12", "2026-09-10"]);
  assert.deepEqual(g[0].rows.map((r) => r.id), ["a", "b"]);
  assert.deepEqual(groupByDay([]), []);
});

test("daySpentCents: suma mi parte de los gastos; ingresos, transferencias y ajustes no cuentan", () => {
  const rows = [
    { type: "expense", amount_cents: 2400, my_amount_cents: 1440 },
    { type: "expense", amount_cents: 1090, my_amount_cents: 1090 },
    { type: "income", amount_cents: 150000, my_amount_cents: 150000 },
    { type: "transfer", amount_cents: 5000, my_amount_cents: 5000 },
    { type: "adjustment", amount_cents: -400, my_amount_cents: -400 },
  ];
  assert.equal(daySpentCents(rows), 2530);
});

test("daySpentCents: la devolución resta, salvo la que liquida un gasto compartido", () => {
  const shared = { id: "g1", type: "expense", is_shared: 1, amount_cents: 6000, my_amount_cents: 3000 };
  const mine = { id: "g2", type: "expense", is_shared: 0, amount_cents: 2000, my_amount_cents: 2000 };
  const byId = { g1: shared, g2: mine };
  assert.equal(daySpentCents([{ type: "refund", ref_id: "g1", my_amount_cents: 3000 }], byId), 0, "liquidación");
  assert.equal(daySpentCents([{ type: "refund", ref_id: "g2", my_amount_cents: 500 }], byId), -500, "tienda");
  assert.equal(daySpentCents([{ type: "refund", ref_id: "", my_amount_cents: 700 }], byId), -700, "sin enlazar");
  assert.equal(daySpentCents([{ type: "refund", ref_id: "fuera", my_amount_cents: 300 }], byId), -300, "gasto de otro periodo");
});

test("daySpentCents: sin my_amount_cents cae al importe entero", () => {
  assert.equal(daySpentCents([{ type: "expense", amount_cents: 999 }]), 999);
});
