import { test } from "node:test";
import assert from "node:assert/strict";
import { SQL } from "../../app/app/js/sql.js";
import { prevDayIso } from "../../app/app/js/format.js";
import { periodStartTooEarly } from "../../app/app/js/repo.js";
import { openDb, seedMinimal } from "./helpers.mjs";

const T = "2026-08-24T18:00:00Z";
const T2 = "2026-09-05T10:00:00Z";

/** Inserta una transacción usando la firma de SQL.insertTransaction (mismo helper que
 *  tests/app/compartidos.test.mjs y tests/app/movimientos.test.mjs). */
function ins(db, over = {}) {
  const v = {
    id: "t" + Math.floor(Math.random() * 1e9),
    date: "2026-08-20", period: "per-1", type: "expense", cents: 4520,
    account: "acc-n26", counterAccount: "", category: "cat-casa-alquiler",
    merchant: "", note: "", shared: 0, override: null, settled: 0,
    ref: "", rule: "", external: "", status: "pending",
    ...over,
  };
  db.prepare(SQL.insertTransaction).run(
    v.id, v.date, v.period, v.type, v.cents, v.account, v.counterAccount,
    v.category, v.merchant, v.note, v.shared, v.override, v.settled,
    v.ref, v.rule, v.external, v.status, T, T,
  );
  return v.id;
}

/** Reproduce EXACTAMENTE el op "execMany" de app/js/db-worker.js: BEGIN, ejecuta cada
 *  sentencia, COMMIT; si alguna falla, ROLLBACK y relanza. Sirve para comprobar la
 *  atomicidad que repo.openNextPeriod exige sin depender del Worker (no disponible en Node). */
function execManyRaw(db, stmts) {
  db.exec("BEGIN");
  try {
    for (const s of stmts) db.prepare(s.sql).run(...(s.bind ?? []));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Reproduce EXACTAMENTE la secuencia de repo.openNextPeriod: cierra el open (si existe)
 *  con end_date = día anterior a startDate, crea el nuevo periodo y sus budgets, todo en
 *  un único execMany. */
function openNextPeriodReproduced(db, { name, startDate, sharePct, budgets = [] }, now = T2) {
  const current = db.prepare(SQL.getOpenPeriod).get();
  const newId = "per-new-" + Math.floor(Math.random() * 1e9);
  const stmts = [];
  if (current) stmts.push({ sql: SQL.closePeriod, bind: [prevDayIso(startDate), now, current.id] });
  stmts.push({ sql: SQL.insertPeriod, bind: [newId, name, startDate, sharePct, now, now] });
  for (const b of budgets) {
    stmts.push({ sql: SQL.insertBudget, bind: ["bud-" + Math.floor(Math.random() * 1e9), newId, b.categoryId, b.amountCents, now, now] });
  }
  execManyRaw(db, stmts);
  return newId;
}

test("prevDayIso: día anterior, cruzando de mes y de año", () => {
  assert.equal(prevDayIso("2026-09-01"), "2026-08-31");
  assert.equal(prevDayIso("2026-01-01"), "2025-12-31");
  assert.equal(prevDayIso("2026-08-25"), "2026-08-24");
});

test("openNextPeriod: cierra el abierto (end_date = día anterior, cruzando mes), abre el nuevo con sus budgets y one_open_period sigue con un único open", () => {
  const db = openDb();
  seedMinimal(db);

  const newId = openNextPeriodReproduced(db, {
    name: "Septiembre 2026", startDate: "2026-09-01", sharePct: 55,
    budgets: [{ categoryId: "cat-casa", amountCents: 70000 }],
  });

  const old = db.prepare("SELECT * FROM periods WHERE id='per-1'").get();
  assert.equal(old.status, "closed");
  assert.equal(old.end_date, "2026-08-31", "día anterior a 2026-09-01, cruzando de mes");

  const nuevo = db.prepare("SELECT * FROM periods WHERE id=?").get(newId);
  assert.equal(nuevo.status, "open");
  assert.equal(nuevo.name, "Septiembre 2026");
  assert.equal(nuevo.start_date, "2026-09-01");
  assert.equal(nuevo.my_share_pct, 55);

  const budgets = db.prepare(SQL.budgetsOfPeriod).all(newId);
  assert.equal(budgets.length, 1);
  assert.equal(budgets[0].category_id, "cat-casa");
  assert.equal(budgets[0].amount_cents, 70000);

  const openCount = db.prepare("SELECT COUNT(*) c FROM periods WHERE status='open' AND deleted=0").get().c;
  assert.equal(openCount, 1, "one_open_period: solo un periodo abierto tras cerrar+abrir");

  assert.throws(
    () => db.prepare(SQL.insertPeriod).run("intruso", "X", "2026-10-01", 50, T2, T2),
    "el índice UNIQUE one_open_period sigue vigente: no se puede colar un segundo open",
  );
});

test("openNextPeriod en modo 'first' (sin periodo abierto previo): solo crea el nuevo, sin tocar closePeriod", () => {
  const db = openDb(); // solo esquema: sin seedMinimal, no hay ningún periodo

  const newId = openNextPeriodReproduced(db, { name: "Agosto 2026", startDate: "2026-08-01", sharePct: 50, budgets: [] });

  const rows = db.prepare("SELECT * FROM periods").all();
  assert.equal(rows.length, 1, "solo se crea el nuevo: no había nada que cerrar");
  assert.equal(rows[0].id, newId);
  assert.equal(rows[0].status, "open");
  assert.equal(rows[0].my_share_pct, 50);
});

test("periodStartTooEarly (repo.openNextPeriod): guarda contra un rango invertido (end_date < start_date)", () => {
  const open = { start_date: "2026-08-01" };
  assert.equal(periodStartTooEarly(open, "2026-07-31"), true, "startDate ANTES del periodo abierto");
  assert.equal(periodStartTooEarly(open, "2026-08-01"), true, "startDate IGUAL al periodo abierto (end_date quedaría antes de start_date)");
  assert.equal(periodStartTooEarly(open, "2026-08-02"), false, "startDate posterior: caso normal");
  assert.equal(periodStartTooEarly(null, "2026-01-01"), false, "modo 'first' sin periodo abierto: nada que comparar");
});

test("spentByRootCategory: agrega el subárbol, resta refunds sin ref prorrateados, excluye otros periodos/income y ordena por gasto desc", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(`INSERT INTO categories (id,name,parent_id,flow,need_type,display_order,is_archived,created_at,updated_at,deleted)
    VALUES ('cat-ocio','Ocio','','expense','want',5,0,?,?,0)`).run(T, T);
  db.prepare(`INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES ('per-otro','Otro periodo','2026-06-01','2026-06-30','closed',50,'',?,?,0)`).run(T, T);

  // per-1 (60/40): gasto directo en la raíz + gasto en el hijo (cuenta para la raíz) +
  // refund sin ref (resta, prorrateado) + refund CON ref (NO resta: ref_id != '')
  ins(db, { id: "gasto-raiz", period: "per-1", category: "cat-casa", cents: 5000, shared: 0 });
  ins(db, { id: "gasto-hijo", period: "per-1", category: "cat-casa-alquiler", cents: 10000, shared: 1 }); // 60% → 6000
  ins(db, { id: "devol-suelta", period: "per-1", type: "refund", category: "cat-casa-alquiler", cents: 2000, shared: 1 }); // 60% → -1200
  ins(db, { id: "devol-enlazada", period: "per-1", type: "refund", category: "cat-casa-alquiler", cents: 1000, shared: 0, ref: "gasto-raiz" }); // no resta
  ins(db, { id: "otro-periodo", period: "per-otro", category: "cat-casa-alquiler", cents: 99999, shared: 0 }); // otro periodo: excluido
  ins(db, { id: "ingreso", period: "per-1", type: "income", category: "cat-nomina", cents: 200000 }); // income: su raíz no aparece

  const rows = db.prepare(SQL.spentByRootCategory).all("per-1");
  const casa = rows.find((r) => r.root_id === "cat-casa");
  const ocio = rows.find((r) => r.root_id === "cat-ocio");

  assert.equal(casa.spent_cents, 5000 + 6000 - 1200, "5000 (raíz) + 6000 (hijo al 60%) - 1200 (devolución suelta al 60%)");
  assert.equal(ocio.spent_cents, 0, "sin movimientos en el periodo consultado");
  assert.ok(
    rows.findIndex((r) => r.root_id === "cat-casa") < rows.findIndex((r) => r.root_id === "cat-ocio"),
    "ORDER BY spent_cents DESC",
  );
  assert.equal(rows.some((r) => r.root_id === "cat-nomina"), false, "las raíces de income (flow≠expense) no aparecen");
});

test("execMany: una violación de CHECK en el lote de openNextPeriod hace rollback completo (no crea el periodo nuevo)", () => {
  const db = openDb();
  seedMinimal(db);

  const stmts = [
    { sql: SQL.closePeriod, bind: [prevDayIso("2026-09-01"), T2, "per-1"] },
    { sql: SQL.insertPeriod, bind: ["per-2", "Septiembre 2026", "2026-09-01", 60, T2, T2] },
    // violación deliberada: amount_cents=0 con type='expense' incumple el CHECK de transactions
    {
      sql: SQL.insertTransaction,
      bind: ["tx-bad", "2026-09-02", "per-2", "expense", 0, "acc-n26", "", "cat-casa-alquiler", "", "", 0, null, 0, "", "", "", "pending", T2, T2],
    },
  ];

  assert.throws(() => execManyRaw(db, stmts));

  const per1 = db.prepare("SELECT status, end_date FROM periods WHERE id='per-1'").get();
  assert.equal(per1.status, "open", "el periodo original NO queda cerrado: rollback completo");
  assert.equal(per1.end_date, "", "tampoco se le asigna end_date");

  const per2 = db.prepare("SELECT * FROM periods WHERE id='per-2'").get();
  assert.equal(per2, undefined, "no queda ningún rastro del periodo nuevo");
});
