import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { SQL } from "../../app/app/js/sql.js";
import { seedStatements } from "../../app/app/js/seeds.js";

const schema = readFileSync(new URL("../../app/app/js/schema.sql", import.meta.url), "utf8");
const T = "2026-08-24T18:00:00Z";
function db() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  for (const { sql, rows } of seedStatements(T)) for (const r of rows) d.prepare(sql).run(...r);
  d.prepare(SQL.insertPeriod).run("p1", "Agosto 2026", "2026-07-27", 60, T, T);
  return d;
}
const tx = (d, over = {}) => {
  const v = { id: "t" + Math.floor(Math.random() * 1e9), date: "2026-08-20", period: "p1", type: "expense",
    cents: 4520, account: "acc-n26", counterAccount: "", category: "cat-alimentacion-supermercado", merchant: "Mercadona",
    note: "", shared: 0, override: null, paidBy: "me", settled: 0, ref: "", rule: "", external: "", status: "pending", ...over };
  d.prepare(SQL.insertTransaction).run(v.id, v.date, v.period, v.type, v.cents, v.account, v.counterAccount,
    v.category, v.merchant, v.note, v.shared, v.override, v.paidBy, v.settled, v.ref, v.rule, v.external, v.status, T, T);
  return v.id;
};

test("getOpenPeriod devuelve el periodo abierto con su pct", () => {
  const d = db();
  const p = d.prepare(SQL.getOpenPeriod).get();
  assert.equal(p.name, "Agosto 2026"); assert.equal(p.my_share_pct, 60);
});

test("spent: normal entero, compartido 60 % redondeado, override 50 %", () => {
  const d = db();
  tx(d);                                        // 4520 → 4520
  tx(d, { cents: 4520, shared: 1 });            // 60 % → 2712
  tx(d, { cents: 8000, shared: 1, override: 50 }); // → 4000
  assert.equal(d.prepare(SQL.spentOfPeriod).get("p1").spent_cents, 4520 + 2712 + 4000);
});

test("refund sin ref_id resta; income no toca el gasto", () => {
  const d = db();
  tx(d, { cents: 10000 });
  tx(d, { type: "refund", cents: 2500 });       // devolución de tienda, sin vínculo
  tx(d, { type: "income", cents: 180000, category: "cat-nomina" });
  assert.equal(d.prepare(SQL.spentOfPeriod).get("p1").spent_cents, 7500);
  assert.equal(d.prepare(SQL.incomeOfPeriod).get("p1").income_cents, 180000);
});

test("listByDay: orden descendente, incluye my_amount_cents y excluye borrados", () => {
  const d = db();
  tx(d, { date: "2026-08-19", cents: 1000 });
  const borrar = tx(d, { date: "2026-08-20", cents: 2000 });
  tx(d, { date: "2026-08-21", cents: 3000, shared: 1 });
  d.prepare("UPDATE transactions SET deleted=1 WHERE id=?").run(borrar);
  const rows = d.prepare(SQL.listByDay).all("p1");
  assert.deepEqual(rows.map((r) => r.amount_cents), [3000, 1000]);
  assert.equal(rows[0].my_amount_cents, 1800);
});

test("categorías hoja de gasto para los chips (sin raíces con hijas, sin income)", () => {
  const d = db();
  const rows = d.prepare(SQL.listExpenseLeafCategories).all();
  const names = rows.map((r) => r.name);
  assert.ok(names.includes("Supermercado") && names.includes("Ropa y cuidado personal"));
  assert.ok(!names.includes("Casa") && !names.includes("Ingresos"));
});
