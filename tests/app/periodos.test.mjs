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
  // refund sin ref (resta, prorrateado) + refund enlazado a la liquidación del gasto
  // COMPARTIDO del hijo (NO resta: is_shared=1 en el gasto enlazado)
  ins(db, { id: "gasto-raiz", period: "per-1", category: "cat-casa", cents: 5000, shared: 0 });
  ins(db, { id: "gasto-hijo", period: "per-1", category: "cat-casa-alquiler", cents: 10000, shared: 1 }); // 60% → 6000
  ins(db, { id: "devol-suelta", period: "per-1", type: "refund", category: "cat-casa-alquiler", cents: 2000, shared: 1 }); // 60% → -1200
  ins(db, { id: "devol-enlazada", period: "per-1", type: "refund", category: "cat-casa-alquiler", cents: 1000, shared: 0, ref: "gasto-hijo" }); // liquidación de compartido: no resta
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

test("spentByRootCategory: refund vinculado a gasto NO compartido resta en su raíz; vinculado a compartido no", () => {
  const db = openDb();
  seedMinimal(db);

  const gastoA = ins(db, { id: "gasto-a", period: "per-1", category: "cat-casa-alquiler", cents: 10000, shared: 0 });
  ins(db, { id: "devol-a", period: "per-1", type: "refund", category: "cat-casa-alquiler", cents: 10000, shared: 0, ref: gastoA });

  const gastoB = ins(db, { id: "gasto-b", period: "per-1", category: "cat-casa-alquiler", cents: 10000, shared: 1 }); // 60% → 6000
  ins(db, { id: "devol-b", period: "per-1", type: "refund", category: "cat-casa-alquiler", cents: 4000, shared: 0, ref: gastoB });

  const rows = db.prepare(SQL.spentByRootCategory).all("per-1");
  const casa = rows.find((r) => r.root_id === "cat-casa");

  assert.equal(casa.spent_cents, 6000, "gasto A (10000) - devol-a (10000, gasto NO compartido) + gasto B al 60% (6000) - 0 (devol-b liquida compartido)");
});

test("updatePeriodShare (sentencia sola): cambia my_share_pct/updated_at; sin el freeze previo, los gastos con override NULL seguirían al periodo", () => {
  const db = openDb();
  seedMinimal(db); // per-1 al 60

  const a = ins(db, { id: "a", cents: 10000, shared: 1, override: null });
  const b = ins(db, { id: "b", cents: 10000, shared: 1, override: 90 });

  db.prepare(SQL.updatePeriodShare).run(50, T2, "per-1");

  const per1 = db.prepare("SELECT my_share_pct, updated_at FROM periods WHERE id='per-1'").get();
  assert.equal(per1.my_share_pct, 50);
  assert.equal(per1.updated_at, T2);

  const rows = db.prepare(SQL.listAllByDay).all("per-1");
  assert.equal(rows.find((r) => r.id === a).my_amount_cents, 5000, "sin override: sigue el nuevo pct del periodo (50%)");
  assert.equal(rows.find((r) => r.id === b).my_amount_cents, 9000, "con override=90: no se mueve con el cambio del periodo");
});

test("freezePeriodShareOverrides + updatePeriodShare (mismo execMany, como repo.updatePeriodSharePct): los compartidos con override NULL se congelan en el valor vigente y NO se mueven; los que ya tenían override no se tocan; un gasto nuevo sin override sí sigue al valor nuevo", () => {
  const db = openDb();
  seedMinimal(db); // per-1 al 60

  const a = ins(db, { id: "a", cents: 10000, shared: 1, override: null });
  const b = ins(db, { id: "b", cents: 10000, shared: 1, override: 90 });
  const c = ins(db, { id: "c", cents: 10000, shared: 0, override: null }); // no compartido: debe seguir NULL

  db.prepare(`INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES ('per-2','Otro periodo','2026-06-01','2026-06-30','closed',60,'',?,?,0)`).run(T, T);
  const d = ins(db, { id: "d", period: "per-2", cents: 10000, shared: 1, override: null }); // otro periodo: debe seguir NULL

  execManyRaw(db, [
    { sql: SQL.freezePeriodShareOverrides, bind: ["per-1", T2, "per-1"] },
    { sql: SQL.updatePeriodShare, bind: [50, T2, "per-1"] },
  ]);

  const per1 = db.prepare("SELECT my_share_pct FROM periods WHERE id='per-1'").get();
  assert.equal(per1.my_share_pct, 50);

  const row = (id) => db.prepare("SELECT share_pct_override, updated_at FROM transactions WHERE id=?").get(id);
  assert.equal(row(a).share_pct_override, 60, "congelado en el valor VIGENTE (60) antes de bajar a 50");
  assert.equal(row(a).updated_at, T2);
  assert.equal(row(b).share_pct_override, 90, "ya tenía override: no se toca");
  assert.equal(row(c).share_pct_override, null, "no compartido: el freeze no lo alcanza");
  assert.equal(row(d).share_pct_override, null, "otro periodo: el freeze no lo alcanza");

  const rows = db.prepare(SQL.listAllByDay).all("per-1");
  assert.equal(rows.find((r) => r.id === a).my_amount_cents, 6000, "congelado al 60%: no se mueve con el cambio del periodo a 50%");
  assert.equal(rows.find((r) => r.id === b).my_amount_cents, 9000, "override propio (90%): sin cambios");

  const e = ins(db, { id: "e", cents: 10000, shared: 1, override: null });
  const rows2 = db.prepare(SQL.listAllByDay).all("per-1");
  assert.equal(rows2.find((r) => r.id === e).my_amount_cents, 5000, "gasto NUEVO sin override: sigue el nuevo pct del periodo (50%)");
});

test("el freeze es atómico con el update: si la segunda sentencia falla, no queda ningún override congelado", () => {
  const db = openDb();
  seedMinimal(db); // per-1 al 60

  const a = ins(db, { id: "a", cents: 10000, shared: 1, override: null });

  assert.throws(() => execManyRaw(db, [
    { sql: SQL.freezePeriodShareOverrides, bind: ["per-1", T2, "per-1"] },
    { sql: "INSERT INTO periods (id) VALUES (NULL)" },
  ]));

  const row = db.prepare("SELECT share_pct_override FROM transactions WHERE id=?").get(a);
  assert.equal(row.share_pct_override, null, "rollback completo: el freeze no queda a medias");

  const per1 = db.prepare("SELECT my_share_pct FROM periods WHERE id='per-1'").get();
  assert.equal(per1.my_share_pct, 60, "tampoco se aplicó (nunca se llegó a esa sentencia, y aun así habría hecho rollback)");
});

test("updatePeriodShare: no toca un periodo borrado", () => {
  const db = openDb();
  db.prepare(`INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES ('per-x','Borrado','2026-06-01','2026-06-30','closed',60,'',?,?,1)`).run(T, T);

  db.prepare(SQL.updatePeriodShare).run(50, T2, "per-x");

  const perX = db.prepare("SELECT my_share_pct FROM periods WHERE id='per-x'").get();
  assert.equal(perX.my_share_pct, 60, "deleted=1: el WHERE deleted=0 no lo alcanza");
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
