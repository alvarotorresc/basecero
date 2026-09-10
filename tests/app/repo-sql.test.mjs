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

test("listByDay: enseña los DOS apuntes de una liquidación y también un ajuste suelto", () => {
  const d = db();
  // Gasto compartido que pagó ella: mi parte ya contó el día que lo pagó, y al liquidar sale
  // de mi cuenta un adjustment NEGATIVO enlazado (repo.js#settleAllSharedStmts).
  const suyo = tx(d, { date: "2026-08-18", cents: 10000, shared: 1, paidBy: "partner" });
  // Gasto compartido que pagué yo: al liquidar entra una devolución positiva enlazada.
  const mio = tx(d, { date: "2026-08-19", cents: 5000, shared: 1, paidBy: "me" });
  tx(d, { date: "2026-08-20", type: "adjustment", cents: -6000, category: "", merchant: "Liquidación con Ana", ref: suyo });
  tx(d, { date: "2026-08-20", type: "refund", cents: 2000, merchant: "Mercadona", ref: mio });
  // Ajuste suelto, sin ref_id: también mueve dinero de una cuenta, también se lista.
  tx(d, { date: "2026-08-21", type: "adjustment", cents: 300, category: "", merchant: "Cuadre de caja" });
  // Las transferencias siguen fuera: no son ni gasto ni ingreso del periodo.
  tx(d, { date: "2026-08-22", type: "transfer", cents: 9999, category: "", account: "acc-n26", counterAccount: "acc-revolut" });

  const rows = d.prepare(SQL.listByDay).all("p1");
  assert.deepEqual(rows.map((r) => r.type),
    ["adjustment", "adjustment", "refund", "expense", "expense"],
    "orden por fecha DESC; el 21 el ajuste suelto, el 20 los dos apuntes de la liquidación");
  assert.deepEqual(rows.map((r) => r.amount_cents), [300, -6000, 2000, 5000, 10000]);
  // El ajuste saliente conserva su signo también en my_amount_cents (is_shared=0 → 100 %).
  assert.equal(rows[1].my_amount_cents, -6000);
  assert.equal(rows[1].merchant, "Liquidación con Ana");
  // Ningún total cambia por incluirlos: gasto = 10000*60% + 5000*60% - devolución de un gasto
  // compartido (que NO resta: REFUND_REDUCES_SPEND la excluye) = 6000 + 3000.
  assert.equal(d.prepare(SQL.spentOfPeriod).get("p1").spent_cents, 9000);
  assert.equal(d.prepare(SQL.incomeOfPeriod).get("p1").income_cents, 0);
});

test("categorías hoja de gasto para los chips (sin raíces con hijas, sin income)", () => {
  const d = db();
  const rows = d.prepare(SQL.listExpenseLeafCategories).all();
  const names = rows.map((r) => r.name);
  assert.ok(names.includes("Supermercado") && names.includes("Ropa y cuidado personal"));
  assert.ok(!names.includes("Casa") && !names.includes("Ingresos"));
});

// ---- SQL.spentByDayRootCategory / SQL.recentTxDates (plan Inicio v2, Task 3) ----------------

test("spentByDayRootCategory: un gasto en una hija se atribuye a su raíz; uno anotado en la raíz también", () => {
  const d = db();
  tx(d, { date: "2026-08-20", cents: 2000, category: "cat-alimentacion-supermercado" }); // hija
  tx(d, { date: "2026-08-20", cents: 500, category: "cat-alimentacion" });               // raíz directa
  const rows = d.prepare(SQL.spentByDayRootCategory).all("p1", "2026-08-01", "2026-08-31");
  const row = rows.find((r) => r.root_id === "cat-alimentacion");
  assert.equal(row.cents, 2500);
});

test("spentByDayRootCategory: prorratea compartidos igual que spentOfPeriod; una devolución de tienda resta; la de una liquidación no", () => {
  const d = db();
  tx(d, { date: "2026-08-20", cents: 4520, shared: 1, category: "cat-alimentacion-supermercado" }); // 60% -> 2712
  const gastoCompartido = tx(d, { date: "2026-08-20", cents: 3000, shared: 1, category: "cat-alimentacion-supermercado" }); // 60% -> 1800
  tx(d, { date: "2026-08-20", type: "refund", cents: 1000, category: "cat-alimentacion-supermercado" }); // tienda: resta entera (no compartida)
  tx(d, { date: "2026-08-20", type: "refund", cents: 500, category: "cat-alimentacion-supermercado", ref: gastoCompartido }); // liquidación: NO resta
  const rows = d.prepare(SQL.spentByDayRootCategory).all("p1", "2026-08-01", "2026-08-31");
  const row = rows.find((r) => r.root_id === "cat-alimentacion");
  assert.equal(row.cents, 2712 + 1800 - 1000);
});

test("spentByDayRootCategory: sin categorizar y con la categoría borrada caen en root_id=''", () => {
  const d = db();
  tx(d, { date: "2026-08-20", cents: 700, category: "" });
  d.prepare("UPDATE categories SET deleted=1 WHERE id=?").run("cat-alimentacion-supermercado");
  tx(d, { date: "2026-08-20", cents: 300, category: "cat-alimentacion-supermercado" });
  const rows = d.prepare(SQL.spentByDayRootCategory).all("p1", "2026-08-01", "2026-08-31");
  const row = rows.find((r) => r.root_id === "");
  assert.equal(row.cents, 1000);
});

test("spentByDayRootCategory: invariante — la suma por root_id de un día es exactamente el cents de SQL.spentByDay de ese día", () => {
  const d = db();
  const date = "2026-08-20";
  tx(d, { date, cents: 2000, category: "cat-alimentacion-supermercado" });
  tx(d, { date, cents: 500, category: "" });
  tx(d, { date, type: "refund", cents: 300, category: "cat-alimentacion-supermercado" });
  const totalByDay = d.prepare(SQL.spentByDay).all("p1", date, date).find((r) => r.date === date).cents;
  const totalByRoot = d.prepare(SQL.spentByDayRootCategory).all("p1", date, date)
    .filter((r) => r.date === date).reduce((s, r) => s + r.cents, 0);
  assert.equal(totalByRoot, totalByDay);
});

test("recentTxDates: fechas distintas, DESC, sin borradas ni transfer/adjustment", () => {
  const d = db();
  tx(d, { date: "2026-08-18", cents: 1000 });
  tx(d, { date: "2026-08-18", cents: 2000 }); // misma fecha: no debe duplicarse
  tx(d, { date: "2026-08-20", type: "income", cents: 500, category: "cat-nomina" });
  const borrado = tx(d, { date: "2026-08-21", cents: 100 });
  d.prepare(SQL.softDeleteTransaction).run(T, borrado);
  tx(d, { date: "2026-08-22", type: "transfer", cents: 999, category: "", account: "acc-n26", counterAccount: "acc-revolut" });
  tx(d, { date: "2026-08-23", type: "adjustment", cents: 50, category: "" });
  const rows = d.prepare(SQL.recentTxDates).all();
  assert.deepEqual(rows.map((r) => r.date), ["2026-08-20", "2026-08-18"]);
// Registro v2 §5.3: SQL.merchantHistory, la ventana que merchant-memory.js pliega en memoria.
test("merchantHistory: excluye las filas borradas", () => {
  const d = db();
  const borrar = tx(d, { merchant: "Mercadona" });
  tx(d, { merchant: "Carrefour" });
  d.prepare("UPDATE transactions SET deleted=1 WHERE id=?").run(borrar);
  const merchants = d.prepare(SQL.merchantHistory).all(10).map((r) => r.merchant);
  assert.deepEqual(merchants, ["Carrefour"]);
});

test("merchantHistory: excluye transfer y adjustment (no tienen comercio que recordar)", () => {
  const d = db();
  tx(d, { merchant: "Mercadona" });
  tx(d, { type: "transfer", merchant: "Traspaso", category: "", account: "acc-n26", counterAccount: "acc-revolut" });
  tx(d, { type: "adjustment", merchant: "Cuadre", category: "" });
  const merchants = d.prepare(SQL.merchantHistory).all(10).map((r) => r.merchant);
  assert.deepEqual(merchants, ["Mercadona"]);
});

test("merchantHistory: excluye comercio vacío", () => {
  const d = db();
  tx(d, { merchant: "" });
  tx(d, { merchant: "Mercadona" });
  const merchants = d.prepare(SQL.merchantHistory).all(10).map((r) => r.merchant);
  assert.deepEqual(merchants, ["Mercadona"]);
});

test("merchantHistory: ORDER BY date DESC, id DESC y respeta el LIMIT", () => {
  const d = db();
  tx(d, { date: "2026-08-18", merchant: "Antiguo" });
  tx(d, { date: "2026-08-20", merchant: "Reciente" });
  tx(d, { date: "2026-08-19", merchant: "Intermedio" });
  const merchants = d.prepare(SQL.merchantHistory).all(2).map((r) => r.merchant);
  assert.deepEqual(merchants, ["Reciente", "Intermedio"]);
});
