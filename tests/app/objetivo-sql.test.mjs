// B-7: la consulta de movimientos de la hucha (SQL.goalAccountMovements) contra SQLite real, y que
// las aportaciones por mes de objetivo-logic.js cuadran con el saldo de SQL.accountBalance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { SQL } from "../../app/app/js/sql.js";
import { sweepTransferStmt, goalTransferStmt } from "../../app/app/js/repo.js";
import { contributionsByMonth } from "../../app/app/js/objetivo-logic.js";
import { openDb, seedMinimal } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const pure = require("../../app/app/vendor/pure.js");
globalThis.bcUlid = pure.bcUlid;
globalThis.bcSanitizeCell = pure.bcSanitizeCell;

const NOW = "2026-09-27T10:00:00Z";
const transfer = (db, date, cents, from, to) => {
  const s = sweepTransferStmt({ periodId: "per-1", date, amountCents: cents, fromAccountId: from, toAccountId: to, goalName: "Vacaciones", now: NOW });
  db.prepare(s.sql).run(...s.bind);
};

test("goalAccountMovements: trae lo que entra y sale de la hucha, no lo ajeno ni lo borrado", () => {
  const db = openDb();
  seedMinimal(db);
  transfer(db, "2026-07-28", 15000, "acc-n26", "acc-revolut");
  transfer(db, "2026-08-28", 20000, "acc-n26", "acc-revolut");
  transfer(db, "2026-08-30", 5000, "acc-revolut", "acc-n26");
  transfer(db, "2026-08-31", 7000, "acc-n26", "acc-prestamo");   // ajena a la hucha
  transfer(db, "2026-09-02", 9999, "acc-n26", "acc-revolut");
  db.prepare("UPDATE transactions SET deleted=1 WHERE amount_cents=9999").run();

  const rows = db.prepare(SQL.goalAccountMovements).all("acc-revolut", "acc-revolut");
  assert.deepEqual(rows.map((r) => r.amount_cents), [15000, 20000, 5000]);

  const r = contributionsByMonth({ txs: rows, accountId: "acc-revolut", openingCents: 50000, todayIso: "2026-09-27" });
  assert.equal(r.months.find((m) => m.key === "2026-08").cents, 15000);
  assert.equal(r.totalCents, db.prepare(SQL.accountBalance).get("2026-09-27", "acc-revolut").balance_cents,
    "la suma de «antes» y los meses es el saldo de la hucha");
});

// ---- B-4: goalTransferStmt (lo que ejecuta repo.transferToGoal) contra SQLite real ----------------

const HUCHA_GOAL = { id: "goal-1", name: "Vacaciones", type: "savings_target", account_id: "acc-revolut" };
const bal = (db, id) => db.prepare(SQL.accountBalance).get("2026-12-31", id).balance_cents;
const accountRow = (db, id) => db.prepare(SQL.getAccount).get(id) ?? null;
const run = (db, s) => db.prepare(s.sql).run(...s.bind);
const stmtFor = (db, { from, cents }) => goalTransferStmt({
  goal: HUCHA_GOAL, fromAccount: accountRow(db, from), amountCents: cents,
  periodId: "per-1", date: "2026-08-20", now: NOW,
});

test("goalTransferStmt: tras pasar X, la hucha sube X, el origen baja X y hay una sola transferencia en el periodo", () => {
  const db = openDb();
  seedMinimal(db);
  const [h0, o0] = [bal(db, "acc-revolut"), bal(db, "acc-n26")];
  run(db, stmtFor(db, { from: "acc-n26", cents: 15000 }));
  assert.equal(bal(db, "acc-revolut") - h0, 15000);
  assert.equal(bal(db, "acc-n26") - o0, -15000);
  const rows = db.prepare("SELECT * FROM transactions WHERE period_id='per-1' AND deleted=0").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, "transfer");
  assert.equal(rows[0].account_id, "acc-n26");
  assert.equal(rows[0].counter_account_id, "acc-revolut");
  assert.equal(rows[0].merchant, "Vacaciones");
  assert.equal(rows[0].category_id, "");
  assert.equal(rows[0].is_shared, 0);
});

test("goalTransferStmt: rechaza importe <= 0, origen = hucha y origen inexistente o borrado, sin escribir", () => {
  const db = openDb();
  seedMinimal(db);
  assert.throws(() => stmtFor(db, { from: "acc-n26", cents: 0 }), /mayor que cero/);
  assert.throws(() => stmtFor(db, { from: "acc-n26", cents: -500 }), /mayor que cero/);
  assert.throws(() => stmtFor(db, { from: "acc-revolut", cents: 1000 }), /distinta de la hucha/);
  assert.throws(() => stmtFor(db, { from: "no-existe", cents: 1000 }), /cuenta de la que sale/);
  db.prepare("UPDATE accounts SET deleted=1 WHERE id='acc-n26'").run();
  assert.throws(() => stmtFor(db, { from: "acc-n26", cents: 1000 }), /cuenta de la que sale/);
  assert.throws(() => goalTransferStmt({ goal: { ...HUCHA_GOAL, account_id: "" }, fromAccount: accountRow(db, "acc-prestamo"), amountCents: 1000, periodId: "per-1", date: "2026-08-20", now: NOW }), /no tiene hucha/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions").get().n, 0);
});
