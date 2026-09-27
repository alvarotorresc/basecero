// Cierre tardío con día de cobro (revisión global de la PR de lógica, hallazgo 1; decisión de
// Álvaro 2026-09-27: «mover los apuntes»). Se ejecuta la lista REAL de statements que arma
// repo.openNextPeriodStmts —la misma que openNextPeriod manda a execMany— dentro de BEGIN/COMMIT
// sobre node:sqlite, igual que db-worker.js: sin reproducciones a mano que puedan desviarse.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { openNextPeriodStmts } from "../../app/app/js/repo.js";
import { lateMoveCount, lateMoveCutoff } from "../../app/app/js/pay-day.js";
import { remainderCents } from "../../app/app/js/barrido.js";
import { SQL } from "../../app/app/js/sql.js";
import { openDb, seedMinimal } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const pure = require("../../app/app/vendor/pure.js");
globalThis.bcUlid = pure.bcUlid;
globalThis.bcSanitizeCell = pure.bcSanitizeCell;

const T = "2026-08-01T00:00:00Z";
const NOW = "2026-09-27T10:00:00Z";

/** execMany de db-worker.js: todo o nada. */
function execMany(db, stmts) {
  db.exec("BEGIN");
  try {
    for (const s of stmts) db.prepare(s.sql).run(...(s.bind ?? []));
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  }
}

let seq = 0;
function tx(db, { date, type = "expense", cents = 1000, shared = 0, override = null, deleted = 0 }) {
  const id = `tx-${++seq}`;
  db.prepare(`INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,counter_account_id,category_id,
      merchant,note,is_shared,share_pct_override,paid_by,settled,ref_id,rule_id,tag_id,external_id,has_attachment,status,created_at,updated_at,deleted)
    VALUES (?,?,?,?,?,'acc-n26','','cat-casa','','',?,?,'me',0,'','','','',0,'pending',?,?,?)`)
    .run(id, date, "per-1", type, cents, shared, override, T, T, deleted);
  return id;
}

/** Periodo abierto per-1 desde el 5 de agosto (día de cobro 5) con apuntes a ambos lados del 5 de
 *  septiembre, un compartido que sigue al periodo (override NULL) y uno borrado. */
function setup() {
  const db = openDb();
  seedMinimal(db);
  db.prepare("UPDATE periods SET start_date='2026-08-05' WHERE id='per-1'").run();
  const ids = {
    ago10: tx(db, { date: "2026-08-10" }),
    sep04: tx(db, { date: "2026-09-04", shared: 1 }),
    sep05: tx(db, { date: "2026-09-05", type: "income", cents: 250000 }),
    sep12: tx(db, { date: "2026-09-12", shared: 1 }),
    sep20: tx(db, { date: "2026-09-20", shared: 1, override: 30 }),
    sep27: tx(db, { date: "2026-09-27" }),
    sep15del: tx(db, { date: "2026-09-15", deleted: 1 }),
  };
  return { db, ids, current: db.prepare(SQL.getOpenPeriod).get() };
}
const txRow = (db, id) => db.prepare("SELECT * FROM transactions WHERE id=?").get(id);
const allTx = (db) => db.prepare("SELECT * FROM transactions ORDER BY id").all();
const base = { name: "Septiembre 2026", startDate: "2026-09-05", sharePct: 60, newId: "per-2", now: NOW };

test("pay_day 5, cierre el 27: lo del 5 al 27 pasa al periodo nuevo, lo anterior se queda en el cerrado", () => {
  const { db, ids, current } = setup();
  execMany(db, openNextPeriodStmts({ ...base, current, payDay: 5 }));
  for (const k of ["sep05", "sep12", "sep20", "sep27", "sep15del"]) assert.equal(txRow(db, ids[k]).period_id, "per-2", k);
  for (const k of ["ago10", "sep04"]) assert.equal(txRow(db, ids[k]).period_id, "per-1", k);
  const closed = db.prepare("SELECT * FROM periods WHERE id='per-1'").get();
  assert.equal(closed.status, "closed");
  assert.equal(closed.end_date, "2026-09-04");
  assert.equal(db.prepare(SQL.getOpenPeriod).get().id, "per-2");
});

test("cierre tardío: nada se pierde ni se duplica (mismos ids, importes y filas)", () => {
  const { db, current } = setup();
  const before = allTx(db);
  execMany(db, openNextPeriodStmts({ ...base, current, payDay: 5 }));
  const after = allTx(db);
  assert.equal(after.length, before.length);
  assert.deepEqual(after.map((r) => [r.id, r.date, r.type, r.amount_cents, r.deleted]),
    before.map((r) => [r.id, r.date, r.type, r.amount_cents, r.deleted]));
});

test("cierre tardío: el compartido que pasa conserva el reparto del periodo cerrado; los ya fijados no cambian", () => {
  const { db, ids, current } = setup();
  execMany(db, openNextPeriodStmts({ ...base, current, sharePct: 40, payDay: 5 }));
  assert.equal(txRow(db, ids.sep12).share_pct_override, 60, "congelado en el 60 % del periodo que se cierra");
  assert.equal(txRow(db, ids.sep20).share_pct_override, 30, "el override explícito se respeta");
  assert.equal(txRow(db, ids.sep04).share_pct_override, null, "lo que se queda en el cerrado sigue al periodo");
  assert.equal(txRow(db, ids.sep27).share_pct_override, null, "un no compartido no se toca");
});

test("sin pay_day (día 1): la lista de statements es la de siempre y no se mueve nada, aunque la fecha sea anterior a hoy", () => {
  for (const payDay of [undefined, 0, 1, "0"]) {
    const { db, current } = setup();
    const stmts = openNextPeriodStmts({ ...base, current, payDay });
    assert.equal(stmts.length, 2, "cerrar + abrir, nada más");
    assert.deepEqual(stmts.map((s) => s.sql), [SQL.closePeriod, SQL.insertPeriod]);
    const before = allTx(db);
    execMany(db, stmts);
    assert.deepEqual(allTx(db), before, `payDay=${payDay}: transacciones intactas`);
  }
});

test("cierre tardío: todo o nada — si falla un statement posterior, nada se mueve ni se cierra", () => {
  const { db, current } = setup();
  const before = allTx(db);
  const stmts = openNextPeriodStmts({
    ...base, current, payDay: 5,
    sweep: { amountCents: 0, fromAccountId: "acc-n26", toAccountId: "acc-revolut", goalName: "Hucha" }, // CHECK amount>0
  });
  assert.throws(() => execMany(db, stmts));
  assert.deepEqual(allTx(db), before);
  assert.equal(db.prepare(SQL.getOpenPeriod).get().id, "per-1");
});

test("cierre tardío: el barrido y los límites van al periodo nuevo como antes", () => {
  const { db, current } = setup();
  execMany(db, openNextPeriodStmts({
    ...base, current, payDay: 5, budgets: [{ categoryId: "cat-casa", amountCents: 50000 }],
    sweep: { amountCents: 10000, fromAccountId: "acc-n26", toAccountId: "acc-revolut", goalName: "Hucha" },
  }));
  assert.equal(db.prepare("SELECT period_id FROM budgets").get().period_id, "per-2");
  const sweep = db.prepare("SELECT * FROM transactions WHERE type='transfer'").get();
  assert.equal(sweep.period_id, "per-2");
  assert.equal(sweep.date, "2026-09-05");
});

test("primer periodo (sin periodo abierto): sin nada que cerrar ni mover", () => {
  const stmts = openNextPeriodStmts({ ...base, current: null, payDay: 5 });
  assert.deepEqual(stmts.map((s) => s.sql), [SQL.insertPeriod]);
});

test("lateMoveCount: lo que dice la pantalla es lo que mueve el SQL (vivos con fecha ≥ inicio)", () => {
  const { db, current } = setup();
  const live = db.prepare(SQL.listAllByDay).all("per-1");
  const n = lateMoveCount({ payDay: 5, rows: live, startIso: "2026-09-05" });
  assert.equal(n, 4);
  execMany(db, openNextPeriodStmts({ ...base, current, payDay: 5 }));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE period_id='per-2' AND deleted=0").get().n, n);
  assert.equal(lateMoveCount({ payDay: 1, rows: live, startIso: "2026-09-05" }), 0, "sin día de cobro no se mueve nada");
  assert.equal(lateMoveCount({ payDay: 5, rows: live, startIso: "2026-09-28" }), 0);
});

// ---- Ronda 2: las cifras del cierre y la sugerencia del barrido EXCLUYEN lo que se va a mover ----
const figuresBefore = (db, pid, cutoff) => ({
  spent: db.prepare(SQL.spentOfPeriodBefore).get(pid, cutoff).spent_cents,
  income: db.prepare(SQL.incomeOfPeriodBefore).get(pid, cutoff).income_cents,
  count: db.prepare(SQL.countOfPeriodBefore).get(pid, cutoff).n,
});
const figuresFull = (db, pid) => ({
  spent: db.prepare(SQL.spentOfPeriod).get(pid).spent_cents,
  income: db.prepare(SQL.incomeOfPeriod).get(pid).income_cents,
  count: db.prepare(SQL.listAllByDay).all(pid).length,
});

test("lateMoveCutoff: el mismo corte para pantalla y escritura; sin día de cobro, ninguno", () => {
  assert.equal(lateMoveCutoff({ payDay: 5, startIso: "2026-09-05" }), "2026-09-05");
  for (const payDay of [undefined, 0, 1, "0"]) assert.equal(lateMoveCutoff({ payDay, startIso: "2026-09-05" }), "");
});

test("cierre tardío pay_day 5: cifras y sugerencia sin los apuntes del 5 en adelante (= lo que queda tras escribir)", () => {
  const { db, current } = setup();
  const cutoff = lateMoveCutoff({ payDay: 5, startIso: "2026-09-05" });
  const shown = figuresBefore(db, "per-1", cutoff);
  // Lo que queda: 10 ago (1000) y 4 sep compartido al 60 % (600); la nómina del 5 se va.
  assert.deepEqual(shown, { spent: 1600, income: 0, count: 2 });
  const full = figuresFull(db, "per-1");
  assert.equal(full.income, 250000, "antes de excluir, la nómina del 5 contaba");
  const sug = remainderCents({ budgetTotalCents: 0, incomeCents: shown.income, spentCents: shown.spent });
  assert.equal(sug.cents, 0, "sin la nómina del periodo nuevo no hay remanente que sugerir");
  execMany(db, openNextPeriodStmts({ ...base, current, payDay: 5 }));
  assert.deepEqual(figuresFull(db, "per-1"), shown, "la pantalla dice lo que queda en el periodo cerrado");
});

test("sin pay_day: sin corte, las cifras son las de siempre (y coinciden con el periodo tras cerrar)", () => {
  const { db, current } = setup();
  assert.equal(lateMoveCutoff({ payDay: undefined, startIso: "2026-09-05" }), "");
  const full = figuresFull(db, "per-1");
  execMany(db, openNextPeriodStmts({ ...base, current }));
  assert.deepEqual(figuresFull(db, "per-1"), full);
});
