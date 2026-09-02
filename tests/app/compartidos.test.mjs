import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { SQL } from "../../app/app/js/sql.js";
import {
  sharedFieldsLocked, refundAmountLocked, expenseDeleteLocked, settleAllSharedStmts,
} from "../../app/app/js/repo.js";
import { t } from "../../app/app/js/i18n/index.js";
import { openDb, seedMinimal } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const pure = require("../../app/app/vendor/pure.js");
// repo.js#settleAllSharedStmts llama a bcUlid/bcSanitizeCell como GLOBALES (cargados por
// <script src="vendor/pure.js"> en el navegador, igual que addTransaction/createAccount — ver
// n26.js:5 sobre el mismo patrón, y n26.test.mjs:19 sobre cómo se expone en Node). Se importa
// settleAllSharedStmts REAL (no una reproducción) precisamente porque es la función PURA que
// construye el bind exacto de insertTransaction — la que el brief pide verificar "orden exacto,
// 20 campos"; una copia a mano en el test no detectaría un bug de orden introducido en repo.js.
globalThis.bcUlid = pure.bcUlid;
globalThis.bcSanitizeCell = pure.bcSanitizeCell;

const T = "2026-08-24T18:00:00Z";
const T2 = "2026-08-24T19:00:00Z";

/** Inserta una transacción usando la firma de SQL.insertTransaction (mismo helper que
 *  tests/app/movimientos.test.mjs). */
function ins(db, over = {}) {
  const v = {
    id: "t" + Math.floor(Math.random() * 1e9),
    date: "2026-08-20", period: "per-1", type: "expense", cents: 4520,
    account: "acc-n26", counterAccount: "", category: "cat-casa-alquiler",
    merchant: "", note: "", shared: 0, override: null, paidBy: "me", settled: 0,
    ref: "", rule: "", external: "", status: "pending",
    ...over,
  };
  db.prepare(SQL.insertTransaction).run(
    v.id, v.date, v.period, v.type, v.cents, v.account, v.counterAccount,
    v.category, v.merchant, v.note, v.shared, v.override, v.paidBy, v.settled,
    v.ref, v.rule, v.external, v.status, T, T,
  );
  return v.id;
}

/** Reproduce EXACTAMENTE la secuencia que hace repo.settleShared sobre una fila de dirección
 *  'partner_owes' (un gasto que pagué yo): busca la fila en pendingSettlements (misma fuente de
 *  verdad para el importe/categoría a liquidar, sin duplicar el cálculo del pct), inserta la
 *  devolución ENTRANTE en el periodo abierto y marca settled=1 en el gasto original — el mismo
 *  execMany([insertStmt, updateSettled]) de repo.addTransaction. La otra dirección ('i_owe', que
 *  crea un adjustment de salida) la ejercen los tests que llaman a settleAllSharedStmts REAL. */
function settleShared(db, origId, accountId, now, openPeriodId = "per-1") {
  const row = db.prepare(SQL.pendingSettlements).all().find((r) => r.id === origId);
  if (!row) throw new Error("Gasto compartido no encontrado o ya liquidado");
  const refundId = "refund-" + origId;
  db.prepare(SQL.insertTransaction).run(
    refundId, "2026-08-24", openPeriodId, "refund", row.settle_cents, accountId, "",
    row.category_id, row.merchant, t("liquidar.note"), 0, null, "me", 0, origId, "", "", "pending", now, now,
  );
  db.prepare("UPDATE transactions SET settled=1, updated_at=? WHERE id=?").run(now, origId);
  return refundId;
}

test("pendingSettlements: calcula settle_cents con el pct del PROPIO periodo de cada gasto y con override", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(`INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES ('per-2','Julio 2026','2026-06-27','2026-07-27','closed',50,'',?,?,0)`).run(T, T);

  // per-1 (60/40): sin override → contraparte = 4000
  const a = ins(db, { id: "a", date: "2026-08-10", period: "per-1", cents: 10000, shared: 1 });
  // per-2 (50/50, periodo YA CERRADO): sin override → contraparte = 5000, con SU pct propio, no el de per-1
  const b = ins(db, { id: "b", date: "2026-08-05", period: "per-2", cents: 10000, shared: 1 });
  // per-1 con override=90 → el override manda sobre el pct del periodo: contraparte = 1000
  const c = ins(db, { id: "c", date: "2026-08-15", period: "per-1", cents: 10000, shared: 1, override: 90 });

  // no deben aparecer:
  ins(db, { id: "settled", period: "per-1", cents: 5000, shared: 1, settled: 1 });          // ya liquidado
  ins(db, { id: "noshared", period: "per-1", cents: 5000, shared: 0 });                      // no compartido
  const borrado = ins(db, { id: "borrado", period: "per-1", cents: 5000, shared: 1 });
  db.prepare("UPDATE transactions SET deleted=1 WHERE id=?").run(borrado);                   // borrado
  ins(db, { id: "income", type: "income", period: "per-1", cents: 5000, shared: 1, category: "cat-nomina" }); // no es 'expense'

  const rows = db.prepare(SQL.pendingSettlements).all();

  assert.deepEqual(rows.map((r) => r.id), [b, a, c], "orden por date ASC");
  assert.equal(rows.find((r) => r.id === a).settle_cents, 4000);
  assert.equal(rows.find((r) => r.id === b).settle_cents, 5000);
  assert.equal(rows.find((r) => r.id === c).settle_cents, 1000);

  const net = db.prepare(SQL.pendingSettlementNet).get().net_cents;
  assert.equal(net, 4000 + 5000 + 1000, "el income compartido NO debe sumar al neto pendiente");
});

test("pendingSettlements: un reparto 100/0 (pct del periodo o override) da settle_cents=0 y se excluye", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(`INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES ('per-100','Periodo 100/0','2026-05-27','2026-06-27','closed',100,'',?,?,0)`).run(T, T);

  // periodo con my_share_pct=100 (permitido en el onboarding): contraparte = 0 → no debe aparecer
  const soloYo = ins(db, { id: "solo-yo", period: "per-100", cents: 10000, shared: 1 });
  // per-1 (60/40) pero con override=100: el override manda, contraparte = 0 → tampoco debe aparecer
  const overrideCien = ins(db, { id: "override-cien", period: "per-1", cents: 10000, shared: 1, override: 100 });
  // control: un compartido normal SÍ debe aparecer
  const normal = ins(db, { id: "normal", period: "per-1", cents: 10000, shared: 1 });

  const rows = db.prepare(SQL.pendingSettlements).all();
  assert.deepEqual(rows.map((r) => r.id), [normal]);
  assert.equal(rows.find((r) => r.id === soloYo), undefined);
  assert.equal(rows.find((r) => r.id === overrideCien), undefined);

  const net = db.prepare(SQL.pendingSettlementNet).get().net_cents;
  assert.equal(net, 4000, "solo 'normal' (60/40 de 10000) debe sumar; los 100/0 no aportan nada");
});

/** Fixture de las dos direcciones (per-1 al 60 %):
 *   A = gasto MÍO de 10000 → la contraparte me debe 4000 (partner_owes)
 *   B = gasto de ELLA de 10000, sin cuenta → yo le debo mi parte, 6000 (i_owe)
 *  Neto = 4000 - 6000 = -2000 (en mi contra). */
function seedDosDirecciones(db) {
  const a = ins(db, { id: "gasto-mio", date: "2026-08-10", cents: 10000, shared: 1, merchant: "IKEA" });
  const b = ins(db, { id: "gasto-suyo", date: "2026-08-12", cents: 10000, shared: 1,
    paidBy: "partner", account: "", merchant: "Super" });
  return { a, b };
}

test("pendingSettlements: dirección y settle_cents de cada lado, ordenados por fecha", () => {
  const db = openDb();
  seedMinimal(db);
  const { a, b } = seedDosDirecciones(db);

  const rows = db.prepare(SQL.pendingSettlements).all();
  assert.deepEqual(rows.map((r) => r.id), [a, b], "orden por date ASC");

  const rowA = rows.find((r) => r.id === a);
  assert.equal(rowA.direction, "partner_owes");
  assert.equal(rowA.settle_cents, 4000, "10000 - 60% mío = 4000 que me debe");
  assert.equal(rowA.paid_by, "me");

  const rowB = rows.find((r) => r.id === b);
  assert.equal(rowB.direction, "i_owe");
  assert.equal(rowB.settle_cents, 6000, "mi parte del ticket que pagó ella: 60% de 10000");
  assert.equal(rowB.paid_by, "partner");
  assert.equal(rowB.amount_cents, 10000, "el ticket entero viaja en la fila");
});

test("pendingSettlements: excluye las filas cuyo settle_cents sería 0 en cualquiera de las dos direcciones", () => {
  const db = openDb();
  seedMinimal(db);
  // mío con override=100: ella no debe nada. Suyo con override=0: mi parte es 0.
  ins(db, { id: "mio-100", date: "2026-08-10", cents: 10000, shared: 1, override: 100 });
  ins(db, { id: "suyo-0", date: "2026-08-11", cents: 10000, shared: 1, override: 0, paidBy: "partner", account: "" });
  const normal = ins(db, { id: "normal", date: "2026-08-12", cents: 10000, shared: 1 });

  assert.deepEqual(db.prepare(SQL.pendingSettlements).all().map((r) => r.id), [normal],
    "una fila a 0 no cambia el neto y reventaría el CHECK amount_cents>0 del apunte que crearía");
});

test("pendingSettlementNet: firma el neto según quién debe más", () => {
  const dbAmbos = openDb(); seedMinimal(dbAmbos); seedDosDirecciones(dbAmbos);
  assert.equal(dbAmbos.prepare(SQL.pendingSettlementNet).get().net_cents, -2000, "4000 - 6000");

  const dbMio = openDb(); seedMinimal(dbMio);
  ins(dbMio, { id: "solo-mio", cents: 10000, shared: 1 });
  assert.equal(dbMio.prepare(SQL.pendingSettlementNet).get().net_cents, 4000, "solo lo que me debe");

  const dbSuyo = openDb(); seedMinimal(dbSuyo);
  ins(dbSuyo, { id: "solo-suyo", cents: 10000, shared: 1, paidBy: "partner", account: "" });
  assert.equal(dbSuyo.prepare(SQL.pendingSettlementNet).get().net_cents, -6000, "solo lo que le debo");

  const dbVacia = openDb(); seedMinimal(dbVacia);
  assert.equal(dbVacia.prepare(SQL.pendingSettlementNet).get().net_cents, 0, "sin filas, 0 (no NULL)");
});

test("el neto de SQL es exactamente la suma firmada de las filas que lista pendingSettlements", () => {
  const db = openDb();
  seedMinimal(db);
  seedDosDirecciones(db);
  ins(db, { id: "mio-100", cents: 10000, shared: 1, override: 100 });      // excluida de las dos
  ins(db, { id: "suyo-0", cents: 10000, shared: 1, override: 0, paidBy: "partner", account: "" });

  const rows = db.prepare(SQL.pendingSettlements).all();
  // Misma fórmula que deriva el hero de screens/liquidar.js
  const net = rows.reduce((s, r) => s + (r.direction === "i_owe" ? -r.settle_cents : r.settle_cents), 0);
  assert.equal(db.prepare(SQL.pendingSettlementNet).get().net_cents, net);
});

test("accountBalance: un gasto que pagó la contraparte no mueve NINGUNA cuenta", () => {
  const db = openDb();
  seedMinimal(db);
  ins(db, { id: "suyo", cents: 10000, shared: 1, paidBy: "partner", account: "" });

  assert.equal(db.prepare(SQL.accountBalance).get("2026-12-31", "acc-n26").balance_cents, 100000,
    "account_id='' no es el id de ninguna cuenta: la fila no entra en ninguna suma");
  assert.equal(db.prepare(SQL.accountBalance).get("2026-12-31", "acc-revolut").balance_cents, 50000);
});

test("recentForRefund no ofrece los gastos que pagó la contraparte", () => {
  const db = openDb();
  seedMinimal(db);
  const { a } = seedDosDirecciones(db);

  const rows = db.prepare(SQL.recentForRefund).all("per-1");
  assert.deepEqual(rows.map((r) => r.id), [a],
    "una devolución de tienda sobre lo que pagó ella es dinero que le devuelven a ella, no a mí");
});

test("settleShared: crea el refund con importe/categoría/comercio de la parte de la contraparte y el original queda settled", () => {
  const db = openDb();
  seedMinimal(db);
  const gastoId = ins(db, {
    id: "gasto-ikea", date: "2026-08-12", period: "per-1", cents: 8000, shared: 1,
    category: "cat-casa-alquiler", merchant: "IKEA",
  });

  const refundId = settleShared(db, gastoId, "acc-n26", T2);

  const refund = db.prepare("SELECT * FROM transactions WHERE id=?").get(refundId);
  assert.equal(refund.type, "refund");
  assert.equal(refund.amount_cents, 3200, "8000 - 60% = 3200 (parte de la contraparte)");
  assert.equal(refund.category_id, "cat-casa-alquiler");
  assert.equal(refund.merchant, "IKEA");
  assert.equal(refund.note, t("liquidar.note"));
  assert.equal(refund.account_id, "acc-n26");
  assert.equal(refund.ref_id, gastoId);
  assert.equal(refund.is_shared, 0, "el refund de liquidación en sí no se marca compartido (ya es el 100% de la contraparte)");

  const gasto = db.prepare("SELECT settled FROM transactions WHERE id=?").get(gastoId);
  assert.equal(gasto.settled, 1);
});

test("pendingSettlementNet: baja a 0 tras liquidar el único gasto pendiente", () => {
  const db = openDb();
  seedMinimal(db);
  const id = ins(db, { id: "unico", date: "2026-08-12", period: "per-1", cents: 5000, shared: 1 });

  assert.equal(db.prepare(SQL.pendingSettlementNet).get().net_cents, 2000);

  settleShared(db, id, "acc-n26", T2);

  assert.equal(db.prepare(SQL.pendingSettlementNet).get().net_cents, 0);
  assert.deepEqual(db.prepare(SQL.pendingSettlements).all(), []);
});

test("el refund de liquidación NO altera spentOfPeriod: tiene ref_id, así que spentOfPeriod SQL lo excluye", () => {
  const db = openDb();
  seedMinimal(db);
  const id = ins(db, { id: "gasto-compartido", date: "2026-08-12", period: "per-1", cents: 10000, shared: 1 });

  const antes = db.prepare(SQL.spentOfPeriod).get("per-1").spent_cents;
  assert.equal(antes, 6000, "60% de 10000");

  settleShared(db, id, "acc-n26", T2);

  const despues = db.prepare(SQL.spentOfPeriod).get("per-1").spent_cents;
  assert.equal(despues, antes, "el refund de liquidación (ref_id != '') no debe restar ni sumar nada");
});

// ---- Task 5 (backlog, liquidar en bloque): repo.settleAllShared -------------------------
// execManyRaw reproduce EXACTAMENTE el op "execMany" de app/js/db-worker.js (BEGIN/COMMIT/
// ROLLBACK) — mismo helper que tests/app/periodos.test.mjs, tests/app/patrimonio.test.mjs y
// tests/app/categorias.test.mjs, necesario porque el Worker real no está disponible en Node.
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

/** Reproduce la ORQUESTACIÓN de repo.settleAllShared (getOpenPeriod, pendingSettlements + filtro
 *  por ids, el guard de "algún id no está pendiente"): repo.settleAllShared en sí no es alcanzable
 *  en Node (depende del Worker vía query/execMany, mismo motivo por el que settleShared/
 *  openNextPeriod de este mismo fichero se reproducen en vez de importarse). El ARRAY de
 *  statements NO se reproduce a mano aquí: se delega en la settleAllSharedStmts REAL importada de
 *  repo.js (arriba) — así un bug en el bind de insertTransaction (orden de los 20 campos) lo
 *  detectaría este test, cosa que una copia manual del bind no podría hacer. "Alex" es el
 *  partner_name que repo.settleAllShared saca de meta y pasa como sexto argumento. */
function settleAllSharedReproduced(db, ids, accountId, now, periodId = "per-1") {
  if (!ids || ids.length === 0) return;
  const idSet = new Set(ids);
  const period = db.prepare(SQL.getOpenPeriod).get();
  if (!period) throw new Error("No hay ningún periodo abierto");
  const pending = db.prepare(SQL.pendingSettlements).all().filter((r) => idSet.has(r.id));
  if (pending.length !== idSet.size) throw new Error("Gasto compartido no encontrado o ya liquidado");
  const stmts = settleAllSharedStmts(pending, accountId, period.id, "2026-08-24", now, "Alex");
  execManyRaw(db, stmts);
  return period.id;
}

test("settleAllShared (reproducido): liquida N pendientes de golpe — N refunds enlazados con el importe/categoría/comercio correctos y N settled=1, todo en UN execMany", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(`INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES ('per-2','Julio 2026','2026-06-27','2026-07-27','closed',50,'',?,?,0)`).run(T, T);

  // a: per-1 (60/40) sin override → contraparte 4000. b: per-2 (50/50, YA CERRADO) → contraparte
  // 4000 con SU PROPIO pct, no el del periodo abierto. c: per-1 con override=90 → contraparte 1000.
  // El merchant de `c` lleva un prefijo de fórmula a propósito: prueba que bcSanitizeCell se aplica
  // igual que en settleShared→addTransaction (mismo criterio que categorias.test.mjs:428).
  const a = ins(db, { id: "gasto-a", date: "2026-08-10", period: "per-1", cents: 10000, shared: 1, category: "cat-casa-alquiler", merchant: "IKEA" });
  const b = ins(db, { id: "gasto-b", date: "2026-08-05", period: "per-2", cents: 8000, shared: 1, category: "cat-casa-alquiler", merchant: "Super" });
  const c = ins(db, { id: "gasto-c", date: "2026-08-15", period: "per-1", cents: 10000, shared: 1, override: 90, category: "cat-casa-alquiler", merchant: "=HACK()" });

  const openPeriodId = settleAllSharedReproduced(db, [a, b, c], "acc-n26", T2);
  assert.equal(openPeriodId, "per-1");

  assert.deepEqual(db.prepare(SQL.pendingSettlements).all(), [], "los 3 quedan liquidados: nada pendiente");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM transactions WHERE type='refund'").get().c, 3);

  for (const id of [a, b, c]) {
    assert.equal(db.prepare("SELECT settled FROM transactions WHERE id=?").get(id).settled, 1, `${id} debe quedar settled=1`);
  }

  const refundOf = (origId) => db.prepare("SELECT * FROM transactions WHERE ref_id=? AND type='refund'").get(origId);

  const refA = refundOf(a);
  assert.equal(refA.amount_cents, 4000, "10000 - 60% = 4000");
  assert.equal(refA.category_id, "cat-casa-alquiler");
  assert.equal(refA.merchant, "IKEA");
  assert.equal(refA.account_id, "acc-n26");
  assert.equal(refA.period_id, "per-1", "el refund se crea en el periodo ABIERTO");
  assert.equal(refA.note, t("liquidar.note"));
  assert.equal(refA.is_shared, 0);
  assert.equal(refA.status, "pending");
  assert.equal(refA.date, "2026-08-24");

  const refB = refundOf(b);
  assert.equal(refB.amount_cents, 4000, "8000 - 50% (pct PROPIO de per-2, cerrado) = 4000");
  assert.equal(refB.period_id, "per-1", "aunque el gasto original sea de per-2 (cerrado), el refund va al periodo ABIERTO");

  const refC = refundOf(c);
  assert.equal(refC.amount_cents, 1000, "10000 - 90% (override) = 1000");
  assert.equal(refC.merchant, "'=HACK()", "bcSanitizeCell antepone ' a un merchant que empieza como fórmula");
});

test("settleAllShared (reproducido): ATOMICIDAD — una fila inválida en MEDIO del lote hace rollback completo, ni siquiera las filas que iban ANTES en el array quedan aplicadas", () => {
  const db = openDb();
  seedMinimal(db);
  const d = ins(db, { id: "gasto-d", date: "2026-08-10", cents: 5000, shared: 1 });
  const e = ins(db, { id: "gasto-e", date: "2026-08-11", cents: 6000, shared: 1 });
  const f = ins(db, { id: "gasto-f", date: "2026-08-12", cents: 7000, shared: 1 });

  const pending = db.prepare(SQL.pendingSettlements).all();
  const rowD = pending.find((r) => r.id === d);
  const rowE = pending.find((r) => r.id === e);
  // fila deliberadamente inválida: settle_cents=0 hace que el INSERT de su devolución incumpla el
  // CHECK (type='adjustment' OR amount_cents>0) de transactions — puesta en MEDIO (no primero)
  // para que el test demuestre un rollback REAL: si solo se comprobara que las filas POSTERIORES a
  // la mala no se aplican, eso sería trivial (nunca se llegó a ejecutarlas); lo que hay que probar
  // es que la fila ANTERIOR (rowD), que sí llegó a ejecutar su INSERT+UPDATE con éxito DENTRO de
  // la misma transacción, también se deshace.
  // La dirección tiene que ser 'partner_owes': su apunte es un refund, y un refund de importe 0 sí
  // viola el CHECK. Un 'i_owe' a 0 se insertaría como adjustment de -0, que el CHECK PERMITE, y no
  // habría rollback que observar.
  const rowBad = { ...pending.find((r) => r.id === f), settle_cents: 0, direction: "partner_owes" };

  const stmts = settleAllSharedStmts([rowD, rowBad, rowE], "acc-n26", "per-1", "2026-08-24", T2, "Alex");
  assert.equal(stmts.length, 6, "3 filas × 2 statements (insert refund + update settled)");

  assert.throws(() => execManyRaw(db, stmts), /CHECK constraint failed/);

  assert.equal(db.prepare("SELECT COUNT(*) c FROM transactions WHERE type='refund'").get().c, 0,
    "ningún refund debe quedar creado, ni siquiera el de rowD (ejecutado ANTES de la fila mala)");
  for (const id of [d, e, f]) {
    assert.equal(db.prepare("SELECT settled FROM transactions WHERE id=?").get(id).settled, 0,
      `${id} debe seguir settled=0: rollback completo`);
  }
  assert.equal(db.prepare(SQL.pendingSettlements).all().length, 3, "los 3 gastos siguen pendientes tras el rollback");
});

test("settleAllShared (reproducido): ids=[] es un no-op — no toca la BD", () => {
  const db = openDb();
  seedMinimal(db);
  const id = ins(db, { id: "gasto-solo", cents: 5000, shared: 1 });

  settleAllSharedReproduced(db, [], "acc-n26", T2);

  assert.equal(db.prepare("SELECT settled FROM transactions WHERE id=?").get(id).settled, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM transactions WHERE type='refund'").get().c, 0);
});

test("settleAllShared (reproducido): un id que no está en pendingSettlements (ya liquidado, borrado o inexistente) se RECHAZA — no liquida un subconjunto en silencio", () => {
  const db = openDb();
  seedMinimal(db);
  const a = ins(db, { id: "gasto-valido", cents: 5000, shared: 1 });
  const yaLiquidado = ins(db, { id: "gasto-ya-liquidado", cents: 3000, shared: 1, settled: 1 });

  assert.throws(
    () => settleAllSharedReproduced(db, [a, yaLiquidado], "acc-n26", T2),
    /Gasto compartido no encontrado o ya liquidado/,
  );

  // nada se aplicó: NI SIQUIERA `a`, que por sí solo era válido — todo o nada, igual que el guard
  // de duplicados de abajo.
  assert.equal(db.prepare("SELECT settled FROM transactions WHERE id=?").get(a).settled, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM transactions WHERE type='refund'").get().c, 0);
});

test("settleAllShared (reproducido): un id duplicado en `ids` no crea dos refunds sobre el mismo gasto", () => {
  const db = openDb();
  seedMinimal(db);
  const a = ins(db, { id: "gasto-duplicado", cents: 5000, shared: 1 });

  settleAllSharedReproduced(db, [a, a], "acc-n26", T2);

  const refunds = db.prepare("SELECT * FROM transactions WHERE type='refund' AND ref_id=?").all(a);
  assert.equal(refunds.length, 1, "un id repetido en la petición no debe generar dos refunds");
  assert.equal(db.prepare("SELECT settled FROM transactions WHERE id=?").get(a).settled, 1);
});

// ---- Task 17 ronda 2 (controller ruling, finding A): guard de "gasto liquidado" ---------

test("SQL.hasActiveLinkedRefund: true solo con un refund ACTIVO que apunte por ref_id", () => {
  const db = openDb();
  seedMinimal(db);
  const gastoId = ins(db, { id: "gasto-1", cents: 8000, shared: 1 });
  const otroGastoId = ins(db, { id: "gasto-2", cents: 3000, shared: 1 });

  // sin ningún refund todavía
  assert.equal(db.prepare(SQL.hasActiveLinkedRefund).get(gastoId), undefined);

  const refundId = settleShared(db, gastoId, "acc-n26", T2);
  assert.ok(db.prepare(SQL.hasActiveLinkedRefund).get(gastoId), "con el refund activo, debe encontrarlo");
  assert.equal(db.prepare(SQL.hasActiveLinkedRefund).get(otroGastoId), undefined, "no debe colarse a otro gasto");

  db.prepare("UPDATE transactions SET deleted=1 WHERE id=?").run(refundId);
  assert.equal(db.prepare(SQL.hasActiveLinkedRefund).get(gastoId), undefined,
    "un refund BORRADO no cuenta como enlace activo (mismo criterio que unsettleIfNoActiveRefunds)");
});

// ---- Task 5 (PR C, contraparte): banner de migración de Inicio ------------------------

test("hasShared: detecta transacciones y reglas compartidas activas (borradas no cuentan)", () => {
  const db = openDb();
  seedMinimal(db);
  const has = () => !!(db.prepare(SQL.hasSharedTx).get() || db.prepare(SQL.hasSharedRule).get());
  assert.equal(has(), false);

  const txId = ins(db, { id: "tx-shared", shared: 1 });
  assert.equal(has(), true, "una transacción compartida activa cuenta");

  db.prepare("UPDATE transactions SET deleted=1 WHERE id=?").run(txId);
  assert.equal(has(), false, "transacción compartida borrada no cuenta");

  db.prepare(SQL.insertRule).run(
    "rule-shared", "Netflix", "expense", 1500, "cat-casa-alquiler", "acc-n26", "",
    "monthly", 1, null, 1, 1, T, T,
  );
  assert.equal(has(), true, "una regla recurrente compartida activa también cuenta");

  db.prepare("UPDATE recurring_rules SET deleted=1 WHERE id=?").run("rule-shared");
  assert.equal(has(), false, "regla compartida borrada no cuenta");
});

test("sharedFieldsLocked: pura, sin DB — replica exactamente lo que updateTransaction debe bloquear", () => {
  const settledExpense = { type: "expense", settled: 1, amount_cents: 4550, is_shared: 1, share_pct_override: null, paid_by: "me" };
  const same = { amountCents: 4550, isShared: true, sharePctOverride: null, paidBy: "me" };

  // no settled → nunca bloquea, aunque cambie el importe
  assert.equal(sharedFieldsLocked({ ...settledExpense, settled: 0 }, { ...same, amountCents: 6000 }), false,
    "un gasto NO liquidado no se bloquea");

  // settled pero type != 'expense' (p.ej. un refund) → nunca bloquea
  assert.equal(sharedFieldsLocked({ ...settledExpense, type: "refund" }, { ...same, amountCents: 6000 }), false,
    "el guard es solo para expense — is_shared/settled también existen en refund/income");

  // settled + expense + MISMO importe/compartido/override/quién pagó → no bloquea
  assert.equal(sharedFieldsLocked(settledExpense, same), false,
    "editar categoría/fecha/nota/comercio sin tocar importe/compartido/reparto debe seguir funcionando");

  assert.equal(sharedFieldsLocked(settledExpense, { ...same, amountCents: 6000 }), true,
    "cambiar el importe de un gasto liquidado debe bloquearse");
  assert.equal(sharedFieldsLocked(settledExpense, { ...same, isShared: false }), true,
    "desmarcar compartido en un gasto liquidado debe bloquearse");
  assert.equal(sharedFieldsLocked(settledExpense, { ...same, sharePctOverride: 90 }), true,
    "cambiar el reparto de un gasto liquidado debe bloquearse");
  assert.equal(sharedFieldsLocked(settledExpense, { ...same, paidBy: "partner" }), true,
    "cambiar quién pagó un gasto liquidado debe bloquearse");
});

// ---- Task 6 (M5, review de seguridad): bloqueo bilateral de gastos liquidados -------------
// El guard de arriba (sharedFieldsLocked) solo mira el LADO DEL GASTO: si en vez de tocar el
// gasto se toca el REFUND enlazado, o se borra el gasto original, nada lo detecta hoy. Los tests
// de este bloque importan refundAmountLocked/expenseDeleteLocked REALES de repo.js (no una
// reimplementación) — en código pre-fix ni siquiera existen esas exportaciones, así que este
// import ya falla en rojo (mismo criterio que repo-i18n-guards.test.mjs señala sobre por qué una
// reproducción manual del guard no habría detectado el bug original).

test("refundAmountLocked: pura — bloquea SOLO un cambio de importe en un refund cuyo gasto enlazado está settled", () => {
  const settledLinked = { settled: 1 };
  const unsettledLinked = { settled: 0 };

  // no es un refund (p.ej. el propio gasto) → nunca bloquea, aunque cambie el importe
  assert.equal(refundAmountLocked(
    { type: "expense", ref_id: "gasto-1", amount_cents: 3200 },
    { amountCents: 500 },
    settledLinked,
  ), false, "el guard es solo para refunds — el lado del gasto ya lo cubre sharedFieldsLocked");

  // refund sin ref_id (refund suelto, no de liquidación) → nunca bloquea
  assert.equal(refundAmountLocked(
    { type: "refund", ref_id: "", amount_cents: 3200 },
    { amountCents: 500 },
    null,
  ), false, "un refund sin ref_id no está enlazado a ningún gasto");

  // ref_id apunta a un gasto que ya no existe/está borrado (getTransaction lo filtraría) → no bloquea
  assert.equal(refundAmountLocked(
    { type: "refund", ref_id: "gasto-borrado", amount_cents: 3200 },
    { amountCents: 500 },
    null,
  ), false, "gasto huérfano de ANTES de este fix: no se migra, ver nota del report");

  // gasto enlazado existe pero NO está settled → no bloquea (no debería pasar en la práctica, pero
  // el guard no debe asumirlo)
  assert.equal(refundAmountLocked(
    { type: "refund", ref_id: "gasto-1", amount_cents: 3200 },
    { amountCents: 500 },
    unsettledLinked,
  ), false);

  // gasto enlazado settled + MISMO importe (solo cambia categoría/nota/fecha) → no bloquea
  assert.equal(refundAmountLocked(
    { type: "refund", ref_id: "gasto-1", amount_cents: 3200 },
    { amountCents: 3200 },
    settledLinked,
  ), false, "editar campos que no son el importe debe seguir funcionando");

  // gasto enlazado settled + importe DISTINTO → bloquea (el caso del hallazgo: 50€ → 5€)
  assert.equal(refundAmountLocked(
    { type: "refund", ref_id: "gasto-1", amount_cents: 3200 },
    { amountCents: 500 },
    settledLinked,
  ), true, "bajar el importe del refund de un gasto liquidado debe bloquearse");
});

test("expenseDeleteLocked: pura — bloquea borrar un gasto con refund activo, SIN mirar cur.settled", () => {
  // cur inexistente (id ya borrado/no encontrado) → no bloquea (softDeleteTransaction ya es un no-op ahí)
  assert.equal(expenseDeleteLocked(null, true), false);

  // no es un gasto (p.ej. el propio refund) → nunca bloquea por esta vía — esa rama la cubre el
  // camino existente de softDeleteTransaction (unsettle al borrar el refund)
  assert.equal(expenseDeleteLocked({ type: "refund", settled: 0 }, true), false);

  // gasto sin ningún refund activo → borrado normal, no bloquea (aunque estuviera settled=1 por
  // un import a mano corrupto: sin refund vivo no hay nada que proteger)
  assert.equal(expenseDeleteLocked({ type: "expense", settled: 1 }, false), false,
    "settled=1 sin refund activo (p.ej. import a mano) no debe dejar el gasto sin ninguna vía de borrado");

  // gasto CON refund activo → bloquea, aunque settled=0 (no debería pasar en la práctica, pero el
  // guard se ancla en el refund vivo, no en el flag, para no depender de que estén sincronizados)
  assert.equal(expenseDeleteLocked({ type: "expense", settled: 0 }, true), true);

  // el caso real del hallazgo: gasto liquidado con su refund de liquidación activo
  assert.equal(expenseDeleteLocked({ type: "expense", settled: 1 }, true), true,
    "borrar el gasto original liquidado debe bloquearse: dejaría el refund huérfano");
});

// Fix round 1 (revisión post-commit a25da8a): los guards protegen CUALQUIER refund enlazado por
// ref_id, sea o no de un gasto compartido — addTransaction({refId}) pone settled=1
// INCONDICIONALMENTE (repo.js:56), y registro.js permite enlazar un refund a un gasto normal vía
// SQL.recentForRefund (devolución de producto, no liquidación entre compartidos). El ruling del
// coordinador es MANTENER ese alcance amplio (no acotar a is_shared=1) porque el invariante "un
// refund enlazado protege a su gasto hasta que se borre/desvincule" es correcto en ambos casos, y
// consistente con que sharedFieldsLocked YA exige type==='expense' && settled sin mirar is_shared.
// Este test prueba explícitamente el caso NO compartido con datos reales de BD (no solo objetos a
// mano), para que quede fijado como comportamiento intencional y no una laguna sin cubrir.
test("refundAmountLocked/expenseDeleteLocked: protegen también un refund NO compartido (p.ej. devolución de producto)", () => {
  const db = openDb();
  seedMinimal(db);
  const gastoId = ins(db, { id: "gasto-zapatillas", cents: 6000, shared: 0 });
  const refundId = ins(db, {
    id: "devolucion-zapatillas", type: "refund", cents: 6000, shared: 0, ref: gastoId,
  });
  // addTransaction({refId}) marca settled=1 sin mirar is_shared — se reproduce igual aquí.
  db.prepare("UPDATE transactions SET settled=1 WHERE id=?").run(gastoId);

  const gasto = db.prepare(SQL.getTransaction).get(gastoId);
  const refund = db.prepare(SQL.getTransaction).get(refundId);
  assert.equal(gasto.is_shared, 0, "control: el gasto NO es compartido");

  assert.equal(
    refundAmountLocked(refund, { amountCents: 1000 }, gasto),
    true,
    "bajar el importe de una devolución enlazada a un gasto ya liquidado se bloquea aunque no sea un compartido",
  );

  const hasActiveRefund = !!db.prepare(SQL.hasActiveLinkedRefund).get(gastoId);
  assert.equal(
    expenseDeleteLocked(gasto, hasActiveRefund),
    true,
    "borrar el gasto original con la devolución activa también se bloquea, sea o no compartido",
  );
});

/** Reproduce la secuencia de repo.updateTransaction (resolución de campos + los dos guards +
 *  UPDATE) usando SQL directo, IGUAL que el resto de este fichero — pero llamando a los guards
 *  REALES (sharedFieldsLocked/refundAmountLocked) importados de repo.js, no una reimplementación.
 *  Necesario porque updateTransaction en sí depende del Worker (query/exec) y no es alcanzable
 *  en Node sin mockearlo (mismo motivo documentado en repo-i18n-guards.test.mjs). */
function updateTransactionReproduced(db, id, fields) {
  const cur = db.prepare(SQL.getTransaction).get(id);
  if (!cur) throw new Error("Movimiento no encontrado");
  const f = {
    amountCents: fields.amountCents ?? cur.amount_cents,
    isShared: fields.isShared ?? !!cur.is_shared,
    sharePctOverride: fields.sharePctOverride !== undefined ? fields.sharePctOverride : cur.share_pct_override,
    paidBy: fields.paidBy ?? cur.paid_by,
  };
  if (sharedFieldsLocked(cur, f) && db.prepare(SQL.hasActiveLinkedRefund).get(id)) {
    throw new Error("LOCKED: gasto liquidado");
  }
  const linked = (cur.type === "refund" || cur.type === "adjustment") && cur.ref_id
    ? db.prepare(SQL.getTransaction).get(cur.ref_id) : null;
  if (refundAmountLocked(cur, f, linked)) {
    throw new Error("LOCKED: refund de un gasto liquidado");
  }
  db.prepare(SQL.updateTransaction).run(
    fields.type ?? cur.type, f.amountCents, fields.date ?? cur.date, fields.categoryId ?? cur.category_id,
    fields.accountId ?? cur.account_id, fields.counterAccountId ?? cur.counter_account_id,
    fields.merchant ?? cur.merchant, fields.note ?? cur.note, f.isShared ? 1 : 0, f.sharePctOverride, f.paidBy,
    fields.refId ?? cur.ref_id, fields.ruleId ?? cur.rule_id, fields.status ?? cur.status, T2, id,
  );
}

/** Reproduce la secuencia de repo.softDeleteTransaction (guard + las dos ramas de execMany), con
 *  el mismo criterio que updateTransactionReproduced de arriba. */
function softDeleteTransactionReproduced(db, id) {
  const cur = db.prepare(SQL.getTransaction).get(id);
  const hasActiveRefund = cur?.type === "expense" && !!db.prepare(SQL.hasActiveLinkedRefund).get(id);
  if (expenseDeleteLocked(cur, hasActiveRefund)) {
    throw new Error("LOCKED: gasto liquidado con refund activo");
  }
  if (cur && (cur.type === "refund" || cur.type === "adjustment") && cur.ref_id) {
    db.prepare(SQL.softDeleteTransaction).run(T2, id);
    db.prepare(SQL.unsettleIfNoActiveRefunds).run(cur.ref_id, id, T2, cur.ref_id);
  } else {
    db.prepare(SQL.softDeleteTransaction).run(T2, id);
  }
}

test("updateTransaction (reproducido): tras liquidar, bajar el importe del refund enlazado se RECHAZA", () => {
  const db = openDb();
  seedMinimal(db);
  const gastoId = ins(db, { id: "gasto-cena", date: "2026-08-12", period: "per-1", cents: 5000, shared: 1 });
  const refundId = settleShared(db, gastoId, "acc-n26", T2);

  const refundAntes = db.prepare("SELECT amount_cents FROM transactions WHERE id=?").get(refundId);
  assert.equal(refundAntes.amount_cents, 2000, "40% de 5000, la parte de la contraparte");

  assert.throws(
    () => updateTransactionReproduced(db, refundId, { amountCents: 200 }),
    /LOCKED/,
    "bajar 20€ → 2€ debe rechazarse: la deuda de 18€ desaparecería en silencio",
  );

  const refundDespues = db.prepare("SELECT amount_cents FROM transactions WHERE id=?").get(refundId);
  assert.equal(refundDespues.amount_cents, 2000, "el importe del refund no debe haber cambiado");
  const gasto = db.prepare("SELECT settled FROM transactions WHERE id=?").get(gastoId);
  assert.equal(gasto.settled, 1, "el gasto original sigue liquidado");
});

test("updateTransaction (reproducido): editar categoría/nota del refund enlazado (sin tocar importe) sigue funcionando", () => {
  const db = openDb();
  seedMinimal(db);
  const gastoId = ins(db, { id: "gasto-cena-2", date: "2026-08-12", period: "per-1", cents: 5000, shared: 1 });
  const refundId = settleShared(db, gastoId, "acc-n26", T2);

  updateTransactionReproduced(db, refundId, { note: "Liquidación de agosto" });

  const refund = db.prepare("SELECT amount_cents, note FROM transactions WHERE id=?").get(refundId);
  assert.equal(refund.note, "Liquidación de agosto");
  assert.equal(refund.amount_cents, 2000, "el importe no debe tocarse por un cambio de nota");
});

test("softDeleteTransaction (reproducido): borrar el gasto original liquidado se RECHAZA mientras el refund siga activo", () => {
  const db = openDb();
  seedMinimal(db);
  const gastoId = ins(db, { id: "gasto-viaje", date: "2026-08-12", period: "per-1", cents: 12000, shared: 1 });
  const refundId = settleShared(db, gastoId, "acc-n26", T2);

  assert.throws(
    () => softDeleteTransactionReproduced(db, gastoId),
    /LOCKED/,
    "borrar el gasto liquidado debe rechazarse: dejaría el refund huérfano",
  );

  const gasto = db.prepare("SELECT deleted, settled FROM transactions WHERE id=?").get(gastoId);
  assert.equal(gasto.deleted, 0, "el gasto NO debe haberse borrado");
  assert.equal(gasto.settled, 1);
  const refund = db.prepare("SELECT deleted FROM transactions WHERE id=?").get(refundId);
  assert.equal(refund.deleted, 0, "el refund sigue vivo, sin tocar");
});

test("softDeleteTransaction (reproducido): la salida existe — borrar primero el refund permite luego borrar el gasto", () => {
  const db = openDb();
  seedMinimal(db);
  const gastoId = ins(db, { id: "gasto-hotel", date: "2026-08-12", period: "per-1", cents: 9000, shared: 1 });
  const refundId = settleShared(db, gastoId, "acc-n26", T2);

  // paso 1: borrar el refund primero — ya funciona hoy, des-liquida el gasto (rama existente)
  softDeleteTransactionReproduced(db, refundId);
  assert.equal(db.prepare("SELECT settled FROM transactions WHERE id=?").get(gastoId).settled, 0);

  // paso 2: ahora el gasto es uno normal, no liquidado — se borra sin problema
  softDeleteTransactionReproduced(db, gastoId);
  const gasto = db.prepare("SELECT deleted FROM transactions WHERE id=?").get(gastoId);
  assert.equal(gasto.deleted, 1, "sin refund activo enlazado, el borrado normal funciona igual que antes");
});

test("softDeleteTransaction (reproducido): borrar un gasto normal (nunca liquidado) no se ve afectado", () => {
  const db = openDb();
  seedMinimal(db);
  const gastoId = ins(db, { id: "gasto-normal", date: "2026-08-12", period: "per-1", cents: 3000 });

  softDeleteTransactionReproduced(db, gastoId);

  const gasto = db.prepare("SELECT deleted FROM transactions WHERE id=?").get(gastoId);
  assert.equal(gasto.deleted, 1);
});

test("settleAllSharedStmts: una devolución entrante por lo que me deben y un ajuste de salida por lo que debo", () => {
  const db = openDb();
  seedMinimal(db);
  const { a, b } = seedDosDirecciones(db);
  const rows = db.prepare(SQL.pendingSettlements).all();

  const stmts = settleAllSharedStmts(rows, "acc-n26", "per-1", "2026-08-24", T2, "Alex");
  assert.equal(stmts.length, 4, "un insert + un settled=1 por cada una de las dos filas");

  // El id es un ULID nuevo: se compara la cola del bind (los otros 19 valores).
  assert.deepEqual(stmts[0].bind.slice(1), [
    "2026-08-24", "per-1", "refund", 4000, "acc-n26", "", "cat-casa-alquiler", "IKEA", t("liquidar.note"),
    0, null, "me", 0, a, "", "", "pending", T2, T2,
  ], "lo que pagué yo: devolución entrante por lo que me debe, con la categoría y el comercio del gasto");
  assert.deepEqual(stmts[1], { sql: "UPDATE transactions SET settled=1, updated_at=? WHERE id=?", bind: [T2, a] });

  assert.deepEqual(stmts[2].bind.slice(1), [
    "2026-08-24", "per-1", "adjustment", -6000, "acc-n26", "", "", "Liquidación con Alex", t("liquidar.note"),
    0, null, "me", 0, b, "", "", "pending", T2, T2,
  ], "lo que pagó ella: apunte de SALIDA negativo, sin categoría (no es gasto: mi parte ya contó)");
  assert.deepEqual(stmts[3], { sql: "UPDATE transactions SET settled=1, updated_at=? WHERE id=?", bind: [T2, b] });
});

test("settleAllSharedStmts: sin partner_name, el comercio del apunte de salida cae al genérico", () => {
  const db = openDb();
  seedMinimal(db);
  ins(db, { id: "suyo", cents: 10000, shared: 1, paidBy: "partner", account: "" });
  const rows = db.prepare(SQL.pendingSettlements).all();

  const [insert] = settleAllSharedStmts(rows, "acc-n26", "per-1", "2026-08-24", T2, "");
  // En `es`, liquidar.outflow.merchantFallback y liquidar.note valen los DOS "Liquidación": afirmar
  // solo bind[8] pasaría igual con el bind desplazado una posición. Se comparan las cuatro
  // posiciones seguidas 6..9 (counter_account_id, categoría VACÍA del ajuste, comercio y nota), que
  // sí distinguen el desplazamiento; el caso en que las dos claves difieren de verdad
  // ("Liquidación con Alex" vs "Liquidación") lo cubre el test anterior.
  assert.deepEqual(insert.bind.slice(6, 10),
    ["", "", t("liquidar.outflow.merchantFallback"), t("liquidar.note")]);
});

test("tras liquidar las dos direcciones, el saldo de la cuenta se mueve exactamente el NETO", () => {
  const db = openDb();
  seedMinimal(db);
  const { a, b } = seedDosDirecciones(db);

  assert.equal(db.prepare(SQL.accountBalance).get("2026-12-31", "acc-n26").balance_cents, 90000,
    "solo el gasto que pagué yo salió de la cuenta (100000 - 10000)");

  settleAllSharedReproduced(db, [a, b], "acc-n26", T2);

  assert.equal(db.prepare(SQL.accountBalance).get("2026-12-31", "acc-n26").balance_cents, 88000,
    "+4000 que me devuelve y -6000 que le pago: el neto de -2000 sobre 90000");
  assert.deepEqual(db.prepare(SQL.pendingSettlements).all(), [], "no queda nada pendiente");
});

test("tras liquidar las dos direcciones, spentOfPeriod no se mueve", () => {
  const db = openDb();
  seedMinimal(db);
  const { a, b } = seedDosDirecciones(db);

  assert.equal(db.prepare(SQL.spentOfPeriod).get("per-1").spent_cents, 12000, "6000 + 6000, mi parte de cada uno");
  settleAllSharedReproduced(db, [a, b], "acc-n26", T2);
  assert.equal(db.prepare(SQL.spentOfPeriod).get("per-1").spent_cents, 12000,
    "la devolución enlazada a un compartido no resta (REFUND_REDUCES_SPEND) y el ajuste no tiene rama");
});

test("borrar el apunte de SALIDA des-liquida el gasto que pagó la contraparte", () => {
  const db = openDb();
  seedMinimal(db);
  const { a, b } = seedDosDirecciones(db);
  settleAllSharedReproduced(db, [b], "acc-n26", T2);
  const ajuste = db.prepare("SELECT * FROM transactions WHERE ref_id=? AND type='adjustment'").get(b);
  assert.ok(ajuste, "la liquidación creó el ajuste");

  softDeleteTransactionReproduced(db, ajuste.id);

  assert.equal(db.prepare("SELECT settled FROM transactions WHERE id=?").get(b).settled, 0);
  // seedDosDirecciones deja DOS gastos y aquí solo se liquidó `b`: al des-liquidarlo vuelven a estar
  // pendientes los dos (el mío nunca se liquidó). Lo que este test afirma es que `b` es uno de ellos.
  const pending = db.prepare(SQL.pendingSettlements).all();
  assert.deepEqual(pending.map((r) => r.id).sort(), [a, b].sort(), "el gasto vuelve a estar pendiente");
});

test("hasActiveLinkedRefund y expenseDeleteLocked ven el ajuste de liquidación", () => {
  const db = openDb();
  seedMinimal(db);
  const { b } = seedDosDirecciones(db);
  settleAllSharedReproduced(db, [b], "acc-n26", T2);

  const hasActiveRefund = !!db.prepare(SQL.hasActiveLinkedRefund).get(b);
  assert.equal(hasActiveRefund, true, "el ajuste enlazado cuenta como apunte de liquidación vivo");
  const gasto = db.prepare(SQL.getTransaction).get(b);
  assert.equal(expenseDeleteLocked(gasto, hasActiveRefund), true,
    "no se puede borrar el gasto mientras su ajuste siga vivo");
});

test("refundAmountLocked: pura — cambiar el importe del ajuste de un gasto liquidado se bloquea", () => {
  const db = openDb();
  seedMinimal(db);
  const { b } = seedDosDirecciones(db);
  settleAllSharedReproduced(db, [b], "acc-n26", T2);
  const ajuste = db.prepare("SELECT * FROM transactions WHERE ref_id=? AND type='adjustment'").get(b);
  const linked = db.prepare(SQL.getTransaction).get(b);

  assert.equal(refundAmountLocked(ajuste, { amountCents: -1000 }, linked), true);
  assert.equal(refundAmountLocked(ajuste, { amountCents: ajuste.amount_cents }, linked), false,
    "editar la nota del ajuste sin tocar el importe sigue funcionando");
});

test("updateTransaction (reproducido): bajar el importe del AJUSTE de liquidación se RECHAZA", () => {
  const db = openDb();
  seedMinimal(db);
  const { b } = seedDosDirecciones(db);
  settleAllSharedReproduced(db, [b], "acc-n26", T2);
  const ajuste = db.prepare("SELECT * FROM transactions WHERE ref_id=? AND type='adjustment'").get(b);

  // Este test pasa por el CAMINO REAL —la resolución de `linked` incluida—, no por la función pura
  // con el argumento ya resuelto: es justo la línea que se olvidaba. Con repo.js:316 cargando el
  // gasto enlazado solo para type='refund', `linked` sería null para un ajuste, el guard nunca
  // dispararía y el test de arriba (que llama a refundAmountLocked con `linked` cargado a mano)
  // seguiría en verde sobre código roto.
  assert.throws(() => updateTransactionReproduced(db, ajuste.id, { amountCents: -1000 }),
    /LOCKED: refund de un gasto liquidado/);
  assert.equal(db.prepare("SELECT amount_cents FROM transactions WHERE id=?").get(ajuste.id).amount_cents, -6000,
    "el importe del ajuste no se movió");

  // La salida sigue existiendo: editar la nota del ajuste, sin tocar el importe, no se bloquea.
  updateTransactionReproduced(db, ajuste.id, { note: "Bizum enviado" });
  assert.equal(db.prepare("SELECT note FROM transactions WHERE id=?").get(ajuste.id).note, "Bizum enviado");
});
