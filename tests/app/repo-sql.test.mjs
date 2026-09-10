import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { SQL } from "../../app/app/js/sql.js";
import { seedStatements } from "../../app/app/js/seeds.js";
import { prevDayIso } from "../../app/app/js/format.js";

const schema = readFileSync(new URL("../../app/app/js/schema.sql", import.meta.url), "utf8");
const T = "2026-08-24T18:00:00Z";
const T2 = "2026-08-24T19:00:00Z";
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
    note: "", shared: 0, override: null, paidBy: "me", settled: 0, ref: "", rule: "", tag: "", external: "", hasAttachment: 0, status: "pending", ...over };
  d.prepare(SQL.insertTransaction).run(v.id, v.date, v.period, v.type, v.cents, v.account, v.counterAccount,
    v.category, v.merchant, v.note, v.shared, v.override, v.paidBy, v.settled, v.ref, v.rule, v.tag, v.external, v.hasAttachment, v.status, T, T);
  return v.id;
};

// `tag_id` aterriza en medio del bloque de columnas TEXT con default '' (merchant, note, ref_id,
// rule_id, tag_id, external_id): un desplazamiento entre ellas NO revienta ningún CHECK, escribe
// mal en silencio. Un centinela distinto por columna y relectura POR NOMBRE es la única guarda.
test("insertTransaction: cada columna de texto recibe su propio valor", () => {
  const d = db();
  d.prepare(SQL.insertTransaction).run(
    "tx-centinela", "2026-08-20", "p1", "expense", 1000, "acc-n26", "",
    "cat-alimentacion-supermercado", "MERCHANT-X", "NOTE-X", 0, null, "me", 0,
    "REF-X", "RULE-X", "TAG-X", "EXTERNAL-X", 0, "pending", T, T,
  );
  const row = d.prepare(
    "SELECT merchant, note, ref_id, rule_id, tag_id, external_id FROM transactions WHERE id='tx-centinela'",
  ).get();
  assert.equal(row.merchant, "MERCHANT-X");
  assert.equal(row.note, "NOTE-X");
  assert.equal(row.ref_id, "REF-X");
  assert.equal(row.rule_id, "RULE-X");
  assert.equal(row.tag_id, "TAG-X");
  assert.equal(row.external_id, "EXTERNAL-X");
});

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
});

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

// ---- Task 6 (Informe): las consultas del informe funcionan igual sobre un periodo CERRADO -----
// Hoy solo se ejercen sobre el periodo abierto (Inicio, Gasto por categoría); el Informe es el
// primer consumidor que las llama también sobre un periodo ya cerrado.

test("spentByRootCategory/budgetsOfPeriod/listAllByDay: funcionan igual sobre un periodo CERRADO", () => {
  const d = db();
  d.prepare("UPDATE periods SET status='closed', end_date='2026-08-26' WHERE id='p1'").run();
  d.prepare(SQL.insertBudget).run("bud-1", "p1", "cat-alimentacion", 50000, T, T);
  tx(d, { date: "2026-08-10", cents: 3000, category: "cat-alimentacion-supermercado" });

  const spent = d.prepare(SQL.spentByRootCategory).all("p1").find((r) => r.root_id === "cat-alimentacion");
  assert.equal(spent.spent_cents, 3000, "spentByRootCategory no filtra por status del periodo");

  const budgets = d.prepare(SQL.budgetsOfPeriod).all("p1");
  assert.equal(budgets.length, 1);
  assert.equal(budgets[0].amount_cents, 50000);

  const rows = d.prepare(SQL.listAllByDay).all("p1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount_cents, 3000);
});

// REGRESIÓN del off-by-one: SQL.accountBalance filtra `t.date <= ?` (inclusivo), así que
// balancesAt(start_date) incluiría un movimiento del PRIMER día del periodo en la "apertura".
// repo.reportInputs debe pasar prevDayIso(start_date), no start_date a secas.
test("SQL.accountBalance: prevDayIso(start_date) excluye un movimiento del primer día del periodo", () => {
  const d = db();
  d.prepare(`INSERT INTO accounts (id,name,type,opening_balance_cents,display_order,is_archived,created_at,updated_at,deleted)
    VALUES ('acc-n26','N26','checking',100000,1,0,?,?,0)`).run(T, T);
  // p1 empieza el 2026-07-27 (ver db()): un gasto EN ese día no debe contar en la apertura.
  tx(d, { date: "2026-07-27", cents: 2000 });

  const conFechaDeInicio = d.prepare(SQL.accountBalance).get("2026-07-27", "acc-n26").balance_cents;
  const conDiaAnterior = d.prepare(SQL.accountBalance).get(prevDayIso("2026-07-27"), "acc-n26").balance_cents;

  assert.equal(conFechaDeInicio, 98000, "balancesAt(start_date) YA descontaría el gasto del primer día — la trampa del off-by-one");
  assert.equal(conDiaAnterior, 100000, "el día anterior no ve ningún movimiento del periodo: la apertura correcta");
});

// ---- Etiquetas de proyecto (Task 4): CRUD --------------------------------------------------

test("SQL.insertTag: guarda con budget_cents null (sin límite)", () => {
  const d = db();
  d.prepare(SQL.insertTag).run("tag-japon", "Viaje Japón", null, T, T);
  const row = d.prepare("SELECT * FROM tags WHERE id='tag-japon'").get();
  assert.equal(row.name, "Viaje Japón");
  assert.equal(row.budget_cents, null);
  assert.equal(row.is_archived, 0);
  assert.equal(row.deleted, 0);
});

test("SQL.insertTag: guarda con budget_cents con límite", () => {
  const d = db();
  d.prepare(SQL.insertTag).run("tag-japon", "Viaje Japón", 150000, T, T);
  assert.equal(d.prepare("SELECT budget_cents FROM tags WHERE id='tag-japon'").get().budget_cents, 150000);
});

test("SQL.updateTag: cambia name/budget_cents + updated_at, nunca created_at", () => {
  const d = db();
  d.prepare(SQL.insertTag).run("tag-japon", "Viaje Japón", 150000, T, T);
  d.prepare(SQL.updateTag).run("Viaje a Japón", 200000, T2, "tag-japon");
  const row = d.prepare("SELECT * FROM tags WHERE id='tag-japon'").get();
  assert.equal(row.name, "Viaje a Japón");
  assert.equal(row.budget_cents, 200000);
  assert.equal(row.updated_at, T2);
  assert.equal(row.created_at, T);
});

test("SQL.updateTag: budget_cents a NULL quita el límite", () => {
  const d = db();
  d.prepare(SQL.insertTag).run("tag-japon", "Viaje Japón", 150000, T, T);
  d.prepare(SQL.updateTag).run("Viaje Japón", null, T2, "tag-japon");
  assert.equal(d.prepare("SELECT budget_cents FROM tags WHERE id='tag-japon'").get().budget_cents, null);
});

test("SQL.setTagArchived: marca is_archived + updated_at, en los dos sentidos", () => {
  const d = db();
  d.prepare(SQL.insertTag).run("tag-reforma", "Reforma baño", null, T, T);
  d.prepare(SQL.setTagArchived).run(1, T2, "tag-reforma");
  assert.equal(d.prepare("SELECT is_archived, updated_at FROM tags WHERE id='tag-reforma'").get().is_archived, 1);
  d.prepare(SQL.setTagArchived).run(0, T, "tag-reforma");
  assert.equal(d.prepare("SELECT is_archived FROM tags WHERE id='tag-reforma'").get().is_archived, 0);
});

test("SQL.listTags: deja fuera archivadas y borradas", () => {
  const d = db();
  d.prepare(SQL.insertTag).run("tag-japon", "Viaje Japón", 150000, T, T);
  d.prepare(SQL.insertTag).run("tag-reforma", "Reforma baño", null, T, T);
  d.prepare(SQL.insertTag).run("tag-archivada", "Boda", null, T, T);
  d.prepare(SQL.setTagArchived).run(1, T, "tag-archivada");
  d.prepare(SQL.insertTag).run("tag-borrada", "Vieja", null, T, T);
  d.prepare("UPDATE tags SET deleted=1 WHERE id='tag-borrada'").run();

  const rows = d.prepare(SQL.listTags).all();
  assert.deepEqual(rows.map((r) => r.id).sort(), ["tag-japon", "tag-reforma"]);
});

test("SQL.getTag: trae la fila por id, undefined si no existe o está borrada", () => {
  const d = db();
  d.prepare(SQL.insertTag).run("tag-japon", "Viaje Japón", 150000, T, T);
  assert.equal(d.prepare(SQL.getTag).get("tag-japon").name, "Viaje Japón");
  assert.equal(d.prepare(SQL.getTag).get("no-existe"), undefined);
  d.prepare("UPDATE tags SET deleted=1 WHERE id='tag-japon'").run();
  assert.equal(d.prepare(SQL.getTag).get("tag-japon"), undefined);
});

// ---- createTag/updateTag (reproducidos): el merge-on-current de repo.js, no alcanzable en Node
// sin Worker (mismo criterio que updateCategoryReproduced/updateGoalReproduced en otros ficheros) --

function createTagReproduced(d, { name, budgetCents }, now = T) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new Error("errors.repo.tagNameEmpty");
  const id = "tag-" + Math.floor(Math.random() * 1e9);
  d.prepare(SQL.insertTag).run(id, trimmed, budgetCents ?? null, now, now);
  return id;
}
function updateTagReproduced(d, id, fields, now = T2) {
  const cur = d.prepare(SQL.getTag).get(id);
  if (!cur) throw new Error("errors.repo.tagNotFound");
  let name = cur.name;
  if (fields.name !== undefined) {
    const trimmed = String(fields.name).trim();
    if (!trimmed) throw new Error("errors.repo.tagNameEmpty");
    name = trimmed;
  }
  const budgetCents = fields.budgetCents !== undefined ? fields.budgetCents : cur.budget_cents;
  d.prepare(SQL.updateTag).run(name, budgetCents, now, id);
}

test("updateTag (reproducido): renombrar NO toca el límite", () => {
  const d = db();
  const id = createTagReproduced(d, { name: "Viaje Japón", budgetCents: 150000 });
  updateTagReproduced(d, id, { name: "Viaje a Japón" });
  const row = d.prepare(SQL.getTag).get(id);
  assert.equal(row.name, "Viaje a Japón");
  assert.equal(row.budget_cents, 150000, "el límite no se toca: la clave budgetCents ni siquiera vino");
});

test("updateTag (reproducido): cambiar solo el límite NO toca el nombre", () => {
  const d = db();
  const id = createTagReproduced(d, { name: "Viaje Japón", budgetCents: 150000 });
  updateTagReproduced(d, id, { budgetCents: 200000 });
  const row = d.prepare(SQL.getTag).get(id);
  assert.equal(row.name, "Viaje Japón");
  assert.equal(row.budget_cents, 200000);
});

test("updateTag (reproducido): budgetCents:null quita el límite explícitamente", () => {
  const d = db();
  const id = createTagReproduced(d, { name: "Viaje Japón", budgetCents: 150000 });
  updateTagReproduced(d, id, { budgetCents: null });
  assert.equal(d.prepare(SQL.getTag).get(id).budget_cents, null);
});

test("createTag (reproducido): rechaza nombre vacío tras el recorte (trim)", () => {
  const d = db();
  assert.throws(() => createTagReproduced(d, { name: "   " }), /tagNameEmpty/);
});

// ---- Etiquetas de proyecto (Task 5): tagTotals / tagTotalsOfPeriod, MISMO criterio de gasto
// que spentByRootCategory (MY_AMOUNT + REFUND_REDUCES_SPEND) --------------------------------

// Segundo periodo, CERRADO, con su PROPIO pct — mismo patrón que compartidos.test.mjs (insertPeriod
// siempre crea uno 'open', y solo puede haber uno vivo a la vez: uno de los dos hay que insertarlo
// a mano ya cerrado).
function addSecondPeriod(d, id = "p2", pct = 50) {
  d.prepare(`INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES (?,'Julio 2026','2026-06-27','2026-07-26','closed',?,'',?,?,0)`).run(id, pct, T, T);
}

test("SQL.tagTotals: mi parte en un compartido al 50 % (no el ticket entero)", () => {
  const d = db();
  d.prepare(SQL.insertTag).run("tag-japon", "Viaje Japón", null, T, T);
  tx(d, { cents: 10000, shared: 1, override: 50, tag: "tag-japon" });
  const row = d.prepare(SQL.tagTotals).all().find((r) => r.id === "tag-japon");
  assert.equal(row.spent_cents, 5000, "50 % de 10000, no el ticket entero");
  assert.equal(row.n, 1);
});

test("SQL.tagTotals: una devolución normal resta", () => {
  const d = db();
  d.prepare(SQL.insertTag).run("tag-japon", "Viaje Japón", null, T, T);
  tx(d, { cents: 10000, shared: 0, tag: "tag-japon" });
  tx(d, { type: "refund", cents: 3000, shared: 0, tag: "tag-japon" });
  const row = d.prepare(SQL.tagTotals).all().find((r) => r.id === "tag-japon");
  assert.equal(row.spent_cents, 7000);
  assert.equal(row.n, 2);
});

test("SQL.tagTotals: una devolución que liquida un compartido NO resta (REFUND_REDUCES_SPEND)", () => {
  const d = db();
  d.prepare(SQL.insertTag).run("tag-japon", "Viaje Japón", null, T, T);
  const gastoId = tx(d, { cents: 10000, shared: 1, override: 50, tag: "tag-japon" }); // mi parte: 5000
  // La liquidación en sí nunca lleva tag_id (Task 3, D6/§6 de la spec) — este tag_id manual
  // reproduce el único camino por el que podría aparecer: una hoja editada a mano.
  tx(d, { type: "refund", cents: 5000, shared: 1, ref: gastoId, tag: "tag-japon" });
  const row = d.prepare(SQL.tagTotals).all().find((r) => r.id === "tag-japon");
  assert.equal(row.spent_cents, 5000, "la devolución de liquidación no resta: mi parte del gasto sigue contando sola");
  assert.equal(row.n, 2, "las dos filas SÍ llevan la etiqueta, aunque la devolución no reste");
});

test("SQL.tagTotals: movimientos borrados fuera", () => {
  const d = db();
  d.prepare(SQL.insertTag).run("tag-japon", "Viaje Japón", null, T, T);
  const id = tx(d, { cents: 10000, shared: 0, tag: "tag-japon" });
  d.prepare("UPDATE transactions SET deleted=1 WHERE id=?").run(id);
  const row = d.prepare(SQL.tagTotals).all().find((r) => r.id === "tag-japon");
  assert.equal(row.spent_cents, 0);
  assert.equal(row.n, 0);
});

test("SQL.tagTotals: suma de VARIOS periodos (D7 — una etiqueta cruza periodos)", () => {
  const d = db();
  addSecondPeriod(d);
  d.prepare(SQL.insertTag).run("tag-japon", "Viaje Japón", null, T, T);
  tx(d, { period: "p1", cents: 10000, shared: 0, tag: "tag-japon" });
  tx(d, { period: "p2", cents: 6000, shared: 0, tag: "tag-japon" });
  const row = d.prepare(SQL.tagTotals).all().find((r) => r.id === "tag-japon");
  assert.equal(row.spent_cents, 16000, "el total NO está acotado a un periodo");
  assert.equal(row.n, 2);
});

test("SQL.tagTotals: etiqueta sin movimientos -> 0 y n=0", () => {
  const d = db();
  d.prepare(SQL.insertTag).run("tag-vacia", "Reforma baño", null, T, T);
  const row = d.prepare(SQL.tagTotals).all().find((r) => r.id === "tag-vacia");
  assert.equal(row.spent_cents, 0);
  assert.equal(row.n, 0);
});

test("SQL.tagTotals: las archivadas van al final", () => {
  const d = db();
  d.prepare(SQL.insertTag).run("tag-activa", "Viaje Japón", null, T, T);
  d.prepare(SQL.insertTag).run("tag-archivada", "Boda", null, T, T);
  d.prepare(SQL.setTagArchived).run(1, T, "tag-archivada");
  tx(d, { cents: 100, shared: 0, tag: "tag-activa" });
  tx(d, { cents: 99999, shared: 0, tag: "tag-archivada" }); // gasto MAYOR, pero archivada: igual va al final
  const ids = d.prepare(SQL.tagTotals).all().map((r) => r.id);
  assert.deepEqual(ids, ["tag-activa", "tag-archivada"]);
});

test("SQL.tagTotalsOfPeriod: acotado al periodo, y una etiqueta archivada con movimientos en el periodo SIGUE apareciendo", () => {
  const d = db();
  addSecondPeriod(d);
  d.prepare(SQL.insertTag).run("tag-japon", "Viaje Japón", null, T, T);
  d.prepare(SQL.setTagArchived).run(1, T, "tag-japon");
  tx(d, { period: "p1", cents: 10000, shared: 0, tag: "tag-japon" });
  tx(d, { period: "p2", cents: 6000, shared: 0, tag: "tag-japon" });

  const ofP1 = d.prepare(SQL.tagTotalsOfPeriod).all("p1").find((r) => r.id === "tag-japon");
  assert.equal(ofP1.spent_cents, 10000, "solo lo de p1, aunque el total de tagTotals sería 16000");
  assert.equal(ofP1.n, 1);
});

test("SQL.listAllByDay trae tag_id", () => {
  const d = db();
  d.prepare(SQL.insertTag).run("tag-japon", "Viaje Japón", null, T, T);
  tx(d, { cents: 1000, tag: "tag-japon" });
  const row = d.prepare(SQL.listAllByDay).all("p1")[0];
  assert.equal(row.tag_id, "tag-japon");
});
