import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { SQL } from "../../app/app/js/sql.js";
import { prevDayIso } from "../../app/app/js/format.js";
import { periodStartTooEarly, sweepTransferStmt } from "../../app/app/js/repo.js";
import { openDb, seedMinimal } from "./helpers.mjs";

// repo.js#sweepTransferStmt llama a bcUlid/bcSanitizeCell como GLOBALES (vendor/pure.js), igual
// que settleAllSharedStmts (compartidos.test.mjs:11-20) — se importa la función REAL, no una
// reproducción, precisamente porque es la que el brief pide verificar "orden exacto, 20 campos".
const require = createRequire(import.meta.url);
const pure = require("../../app/app/vendor/pure.js");
globalThis.bcUlid = pure.bcUlid;
globalThis.bcSanitizeCell = pure.bcSanitizeCell;

const T = "2026-08-24T18:00:00Z";
const T2 = "2026-09-05T10:00:00Z";

/** Inserta una transacción usando la firma de SQL.insertTransaction (mismo helper que
 *  tests/app/compartidos.test.mjs y tests/app/movimientos.test.mjs). */
function ins(db, over = {}) {
  const v = {
    id: "t" + Math.floor(Math.random() * 1e9),
    date: "2026-08-20", period: "per-1", type: "expense", cents: 4520,
    account: "acc-n26", counterAccount: "", category: "cat-casa-alquiler",
    merchant: "", note: "", shared: 0, override: null, paidBy: "me", settled: 0,
    ref: "", rule: "", tag: "", external: "", status: "pending",
    ...over,
  };
  db.prepare(SQL.insertTransaction).run(
    v.id, v.date, v.period, v.type, v.cents, v.account, v.counterAccount,
    v.category, v.merchant, v.note, v.shared, v.override, v.paidBy, v.settled,
    v.ref, v.rule, v.tag, v.external, v.status, T, T,
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
/** `sweep`, cuando se pasa: {amountCents, fromAccountId, toAccountId, goalName} — el statement se
 *  construye con la función REAL sweepTransferStmt (repo.js), no una reproducción, exactamente
 *  como repo.openNextPeriod hará: al FINAL del array, con `periodId: newId` y `date: startDate`. */
function openNextPeriodReproduced(db, { name, startDate, sharePct, budgets = [], sweep }, now = T2) {
  const current = db.prepare(SQL.getOpenPeriod).get();
  const newId = "per-new-" + Math.floor(Math.random() * 1e9);
  const stmts = [];
  if (current) stmts.push({ sql: SQL.closePeriod, bind: [prevDayIso(startDate), now, current.id] });
  stmts.push({ sql: SQL.insertPeriod, bind: [newId, name, startDate, sharePct, now, now] });
  for (const b of budgets) {
    stmts.push({ sql: SQL.insertBudget, bind: ["bud-" + Math.floor(Math.random() * 1e9), newId, b.categoryId, b.amountCents, now, now] });
  }
  if (sweep) {
    stmts.push(sweepTransferStmt({
      periodId: newId, date: startDate, amountCents: sweep.amountCents,
      fromAccountId: sweep.fromAccountId, toAccountId: sweep.toAccountId, goalName: sweep.goalName, now,
    }));
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

test("spentByRootCategory: un gasto pagado por la contraparte suma MI parte en su raíz", () => {
  const db = openDb();
  seedMinimal(db);
  ins(db, { id: "suyo", cents: 10000, shared: 1, paidBy: "partner", account: "", category: "cat-casa-alquiler" });

  const rows = db.prepare(SQL.spentByRootCategory).all("per-1");
  assert.equal(rows.find((r) => r.root_id === "cat-casa").spent_cents, 6000);
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
      bind: ["tx-bad", "2026-09-02", "per-2", "expense", 0, "acc-n26", "", "cat-casa-alquiler", "", "", 0, null, "me", 0, "", "", "", "", "pending", T2, T2],
    },
  ];

  assert.throws(() => execManyRaw(db, stmts));

  const per1 = db.prepare("SELECT status, end_date FROM periods WHERE id='per-1'").get();
  assert.equal(per1.status, "open", "el periodo original NO queda cerrado: rollback completo");
  assert.equal(per1.end_date, "", "tampoco se le asigna end_date");

  const per2 = db.prepare("SELECT * FROM periods WHERE id='per-2'").get();
  assert.equal(per2, undefined, "no queda ningún rastro del periodo nuevo");
});

/** Inserta una categoría con la firma literal que usan seedMinimal y los tests vecinos. */
function insCat(db, { id, name, parent = "", flow = "expense", need = "need", order = 9, archived = 0, deleted = 0 }) {
  db.prepare(`INSERT INTO categories (id,name,parent_id,flow,need_type,display_order,is_archived,created_at,updated_at,deleted)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, name, parent, flow, need, order, archived, T, T, deleted);
  return id;
}

test("spentByChildCategory: una fila por la raíz y por cada hija; el gasto directo en la raíz sale en su propia fila y la suma cuadra con spentByRootCategory", () => {
  const db = openDb();
  seedMinimal(db);
  insCat(db, { id: "cat-casa-luz", name: "Luz", parent: "cat-casa", order: 2 });
  insCat(db, { id: "cat-ocio", name: "Ocio", parent: "", need: "want", order: 5 });
  insCat(db, { id: "cat-ocio-viajes", name: "Viajes", parent: "cat-ocio", need: "want", order: 1 });

  ins(db, { id: "g-raiz", category: "cat-casa", cents: 5000, shared: 0 });
  ins(db, { id: "g-alquiler", category: "cat-casa-alquiler", cents: 10000, shared: 1 }); // 60 % -> 6000
  ins(db, { id: "g-luz", category: "cat-casa-luz", cents: 3000, shared: 0 });
  ins(db, { id: "g-otra-raiz", category: "cat-ocio-viajes", cents: 7000, shared: 0 });

  const rows = db.prepare(SQL.spentByChildCategory).all("per-1", "cat-casa", "cat-casa");

  assert.deepEqual(
    rows.map((r) => [r.category_id, r.spent_cents]),
    [["cat-casa-alquiler", 6000], ["cat-casa", 5000], ["cat-casa-luz", 3000]],
    "la raíz y sus dos hijas, ordenadas por spent_cents DESC; nada de la otra raíz",
  );
  assert.equal(rows.find((r) => r.category_id === "cat-casa").name, "Casa", "la fila de la raíz trae su propio nombre");

  const raiz = db.prepare(SQL.spentByRootCategory).all("per-1").find((r) => r.root_id === "cat-casa");
  assert.equal(rows.reduce((s, r) => s + r.spent_cents, 0), raiz.spent_cents, "el desglose suma EXACTAMENTE el total de la raíz");
});

test("spentByChildCategory: prorratea los compartidos al my_share_pct del periodo y resta las devoluciones que no liquidan un compartido", () => {
  const db = openDb();
  seedMinimal(db);
  insCat(db, { id: "cat-casa-luz", name: "Luz", parent: "cat-casa", order: 2 });

  const compartido = ins(db, { id: "g-compartido", category: "cat-casa-alquiler", cents: 10000, shared: 1 }); // 60 % -> 6000
  ins(db, { id: "d-suelta", type: "refund", category: "cat-casa-alquiler", cents: 2000, shared: 1 });         // 60 % -> -1200
  ins(db, { id: "d-liquidacion", type: "refund", category: "cat-casa-alquiler", cents: 4000, shared: 0, ref: compartido }); // liquida un compartido: NO resta
  const propio = ins(db, { id: "g-luz", category: "cat-casa-luz", cents: 3000, shared: 0 });
  ins(db, { id: "d-tienda", type: "refund", category: "cat-casa-luz", cents: 3000, shared: 0, ref: propio });  // devolución real: SÍ resta

  const rows = db.prepare(SQL.spentByChildCategory).all("per-1", "cat-casa", "cat-casa");
  const by = Object.fromEntries(rows.map((r) => [r.category_id, r.spent_cents]));

  assert.equal(by["cat-casa-alquiler"], 4800, "6000 (10000 al 60 %) - 1200 (devolución suelta al 60 %)");
  assert.equal(by["cat-casa-luz"], 0, "3000 - 3000 (devolución enlazada a un gasto NO compartido)");
  assert.equal(by["cat-casa"], 0, "sin gasto directo en la raíz");

  const raiz = db.prepare(SQL.spentByRootCategory).all("per-1").find((r) => r.root_id === "cat-casa");
  assert.equal(rows.reduce((s, r) => s + r.spent_cents, 0), raiz.spent_cents, "mismas reglas que spentByRootCategory: la suma cuadra");
});

test("spentByChildCategory: excluye categorías borradas, movimientos borrados y otros periodos; INCLUYE las hijas archivadas con gasto para que la suma cuadre con la raíz", () => {
  const db = openDb();
  seedMinimal(db);
  insCat(db, { id: "cat-casa-gas", name: "Gas", parent: "cat-casa", order: 3, archived: 1 });
  insCat(db, { id: "cat-casa-agua", name: "Agua", parent: "cat-casa", order: 4, deleted: 1 });
  db.prepare(`INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES ('per-otro','Otro periodo','2026-06-01','2026-06-30','closed',50,'',?,?,0)`).run(T, T);

  ins(db, { id: "g-gas", category: "cat-casa-gas", cents: 2500, shared: 0 });        // hija ARCHIVADA con gasto
  ins(db, { id: "g-agua", category: "cat-casa-agua", cents: 1000, shared: 0 });      // hija BORRADA: su fila no existe
  const borrado = ins(db, { id: "g-borrado", category: "cat-casa-alquiler", cents: 9999, shared: 0 });
  db.prepare("UPDATE transactions SET deleted=1 WHERE id=?").run(borrado);
  ins(db, { id: "g-otro-periodo", period: "per-otro", category: "cat-casa-alquiler", cents: 8888, shared: 0 });

  const rows = db.prepare(SQL.spentByChildCategory).all("per-1", "cat-casa", "cat-casa");
  const by = Object.fromEntries(rows.map((r) => [r.category_id, r.spent_cents]));

  assert.equal(by["cat-casa-gas"], 2500, "una subcategoría archivada conserva su historial y tiene que aparecer");
  assert.equal("cat-casa-agua" in by, false, "una subcategoría BORRADA no aparece");
  assert.equal(by["cat-casa-alquiler"], 0, "el movimiento borrado no cuenta y el de otro periodo tampoco");

  const raiz = db.prepare(SQL.spentByRootCategory).all("per-1").find((r) => r.root_id === "cat-casa");
  assert.equal(rows.reduce((s, r) => s + r.spent_cents, 0), raiz.spent_cents, "invariante: el desglose SIEMPRE suma el total de la raíz, archivadas incluidas");
});

test("spentByChildCategory: una hija NEGATIVA (devolución mayor que su gasto) y la invariante «el desglose suma el total» sigue cuadrando", () => {
  const db = openDb();
  seedMinimal(db);
  insCat(db, { id: "cat-casa-luz", name: "Luz", parent: "cat-casa", order: 2 });

  ins(db, { id: "g-luz", category: "cat-casa-luz", cents: 3000, shared: 0 });
  // Devolución de 5000 sobre un gasto de 3000 en la misma hija: la fila queda a -2000. Ocurre de
  // verdad cuando la tienda reembolsa una compra de un periodo anterior contra la categoría de hoy.
  ins(db, { id: "d-luz", type: "refund", category: "cat-casa-luz", cents: 5000, shared: 0 });
  ins(db, { id: "g-alquiler", category: "cat-casa-alquiler", cents: 10000, shared: 0 });

  const rows = db.prepare(SQL.spentByChildCategory).all("per-1", "cat-casa", "cat-casa");
  const by = Object.fromEntries(rows.map((r) => [r.category_id, r.spent_cents]));
  assert.equal(by["cat-casa-luz"], -2000, "3000 - 5000: la fila puede quedar en negativo");
  assert.equal(by["cat-casa-alquiler"], 10000);
  assert.equal(rows[0].category_id, "cat-casa-alquiler", "ORDER BY spent_cents DESC: la negativa cae al final");
  assert.equal(rows.at(-1).category_id, "cat-casa-luz");

  const raiz = db.prepare(SQL.spentByRootCategory).all("per-1").find((r) => r.root_id === "cat-casa");
  assert.equal(raiz.spent_cents, 8000, "10000 - 2000");
  assert.equal(rows.reduce((s, r) => s + r.spent_cents, 0), raiz.spent_cents,
    "la invariante aguanta con filas negativas: sumar en negativo es sumar igual");
});

test("spentByChildCategory: una raíz SIN hijas devuelve exactamente una fila, la suya", () => {
  const db = openDb();
  seedMinimal(db);
  insCat(db, { id: "cat-ropa", name: "Ropa y cuidado personal", parent: "", need: "want", order: 7 });
  ins(db, { id: "g-ropa", category: "cat-ropa", cents: 4500, shared: 0 });
  ins(db, { id: "g-casa", category: "cat-casa-alquiler", cents: 10000, shared: 0 });

  const rows = db.prepare(SQL.spentByChildCategory).all("per-1", "cat-ropa", "cat-ropa");
  assert.deepEqual(rows.map((r) => [r.category_id, r.spent_cents]), [["cat-ropa", 4500]],
    "sin hijas, todo el gasto es directo: la única fila repetiría la cifra de arriba, por eso la pantalla no pinta desglose");

  const raiz = db.prepare(SQL.spentByRootCategory).all("per-1").find((r) => r.root_id === "cat-ropa");
  assert.equal(rows[0].spent_cents, raiz.spent_cents, "y aun así la invariante se cumple");
});

// ---- Task 14 (Informe/barrido): sweepTransferStmt y openNextPeriod({ sweep }) ------------------

const balance = (db, accountId, dateIso) => db.prepare(SQL.accountBalance).get(dateIso, accountId).balance_cents;
const netWorth = (db, dateIso) => ["acc-n26", "acc-revolut", "acc-prestamo"]
  .reduce((s, id) => s + balance(db, id, dateIso), 0);

test("sweepTransferStmt: los 21 campos de insertTransaction en su orden exacto", () => {
  const { sql, bind } = sweepTransferStmt({
    periodId: "per-2", date: "2026-10-01", amountCents: 35280,
    fromAccountId: "acc-corriente", toAccountId: "acc-fondo", goalName: "Fondo de emergencia", now: T,
  });
  assert.equal(sql, SQL.insertTransaction);
  assert.equal(bind.length, 21);
  assert.equal(bind[1], "2026-10-01"); // date
  assert.equal(bind[2], "per-2");      // period_id: el NUEVO
  assert.equal(bind[3], "transfer");
  assert.equal(bind[4], 35280);
  assert.equal(bind[5], "acc-corriente");
  assert.equal(bind[6], "acc-fondo");
  assert.equal(bind[7], "");           // category_id
  assert.equal(bind[10], 0);           // is_shared
  assert.equal(bind[11], null);        // share_pct_override
  assert.equal(bind[12], "me");        // paid_by
  assert.equal(bind[13], 0);           // settled
  assert.equal(bind[14], "");          // ref_id
  assert.equal(bind[15], "");          // rule_id
  assert.equal(bind[16], "");          // tag_id
  assert.equal(bind[17], "");          // external_id
  assert.equal(bind[18], "pending");   // status
  assert.equal(bind[19], T);           // created_at
  assert.equal(bind[20], T);           // updated_at
});

test("sweepTransferStmt: el nombre del objetivo (comercio) pasa por bcSanitizeCell", () => {
  const { bind } = sweepTransferStmt({
    periodId: "per-2", date: "2026-10-01", amountCents: 1000,
    fromAccountId: "a", toAccountId: "b", goalName: "=HACK()", now: T,
  });
  assert.equal(bind[8], "'=HACK()");
});

test("openNextPeriod con barrido: cierra, abre, presupuesta y transfiere en UNA transaccion", () => {
  const db = openDb();
  seedMinimal(db);

  const newId = openNextPeriodReproduced(db, {
    name: "Septiembre 2026", startDate: "2026-09-01", sharePct: 60,
    budgets: [{ categoryId: "cat-casa", amountCents: 70000 }],
    sweep: { amountCents: 35280, fromAccountId: "acc-n26", toAccountId: "acc-revolut", goalName: "Fondo de emergencia" },
  });

  const old = db.prepare("SELECT * FROM periods WHERE id='per-1'").get();
  assert.equal(old.status, "closed");
  assert.equal(old.end_date, "2026-08-31");

  const nuevo = db.prepare("SELECT * FROM periods WHERE id=?").get(newId);
  assert.equal(nuevo.status, "open");

  const budgets = db.prepare(SQL.budgetsOfPeriod).all(newId);
  assert.equal(budgets.length, 1);

  const transfer = db.prepare("SELECT * FROM transactions WHERE type='transfer'").get();
  assert.equal(transfer.period_id, newId, "el barrido vive en el periodo NUEVO");
  assert.equal(transfer.amount_cents, 35280);
  assert.equal(transfer.account_id, "acc-n26");
  assert.equal(transfer.counter_account_id, "acc-revolut");
  assert.equal(transfer.date, "2026-09-01");
});

// Es la razón de que el barrido vaya al periodo nuevo: el informe del que acabas de leer no se toca.
test("el barrido no mueve spentOfPeriod ni incomeOfPeriod de ninguno de los dos periodos", () => {
  const db = openDb();
  seedMinimal(db);
  const spentAntes = db.prepare(SQL.spentOfPeriod).get("per-1").spent_cents;
  const incomeAntes = db.prepare(SQL.incomeOfPeriod).get("per-1").income_cents;

  const newId = openNextPeriodReproduced(db, {
    name: "Septiembre 2026", startDate: "2026-09-01", sharePct: 60,
    sweep: { amountCents: 20000, fromAccountId: "acc-n26", toAccountId: "acc-revolut", goalName: "Fondo" },
  });

  assert.equal(db.prepare(SQL.spentOfPeriod).get("per-1").spent_cents, spentAntes);
  assert.equal(db.prepare(SQL.incomeOfPeriod).get("per-1").income_cents, incomeAntes);
  assert.equal(db.prepare(SQL.spentOfPeriod).get(newId).spent_cents, 0);
  assert.equal(db.prepare(SQL.incomeOfPeriod).get(newId).income_cents, 0);
});

test("el barrido baja el saldo de origen y sube el de destino por el mismo importe", () => {
  const db = openDb();
  seedMinimal(db);
  const antesOrigen = balance(db, "acc-n26", "2026-09-01");
  const antesDestino = balance(db, "acc-revolut", "2026-09-01");

  openNextPeriodReproduced(db, {
    name: "Septiembre 2026", startDate: "2026-09-01", sharePct: 60,
    sweep: { amountCents: 20000, fromAccountId: "acc-n26", toAccountId: "acc-revolut", goalName: "Fondo" },
  });

  assert.equal(balance(db, "acc-n26", "2026-09-01"), antesOrigen - 20000);
  assert.equal(balance(db, "acc-revolut", "2026-09-01"), antesDestino + 20000);
});

test("el barrido no cambia el patrimonio neto total", () => {
  const db = openDb();
  seedMinimal(db);
  const antes = netWorth(db, "2026-09-01");

  openNextPeriodReproduced(db, {
    name: "Septiembre 2026", startDate: "2026-09-01", sharePct: 60,
    sweep: { amountCents: 20000, fromAccountId: "acc-n26", toAccountId: "acc-revolut", goalName: "Fondo" },
  });

  assert.equal(netWorth(db, "2026-09-01"), antes, "mover dinero de un bolsillo propio a otro no cambia el patrimonio");
});

test("si un statement falla, no se escribe NADA (BEGIN/ROLLBACK del runner)", () => {
  const db = openDb();
  seedMinimal(db);

  const stmts = [
    { sql: SQL.closePeriod, bind: [prevDayIso("2026-09-01"), T2, "per-1"] },
    { sql: SQL.insertPeriod, bind: ["per-nuevo", "Septiembre 2026", "2026-09-01", 60, T2, T2] },
    // violación deliberada: amount_cents=0 con type='transfer' incumple el CHECK (type='adjustment' OR amount_cents>0)
    sweepTransferStmt({ periodId: "per-nuevo", date: "2026-09-01", amountCents: 0, fromAccountId: "acc-n26", toAccountId: "acc-revolut", goalName: "Fondo", now: T2 }),
  ];

  assert.throws(() => execManyRaw(db, stmts));

  const per1 = db.prepare("SELECT status FROM periods WHERE id='per-1'").get();
  assert.equal(per1.status, "open", "rollback completo: el periodo viejo no queda cerrado");
  assert.equal(db.prepare("SELECT * FROM periods WHERE id='per-nuevo'").get(), undefined);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM transactions WHERE type='transfer'").get().c, 0);
});

test("sin sweep, openNextPeriod se comporta exactamente como hoy", () => {
  const db = openDb();
  seedMinimal(db);

  const newId = openNextPeriodReproduced(db, { name: "Septiembre 2026", startDate: "2026-09-01", sharePct: 60, budgets: [] });

  assert.equal(db.prepare("SELECT COUNT(*) c FROM transactions").get().c, 0, "sin sweep, ninguna transacción se escribe");
  const nuevo = db.prepare("SELECT * FROM periods WHERE id=?").get(newId);
  assert.equal(nuevo.status, "open");
});
