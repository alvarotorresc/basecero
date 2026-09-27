import { test } from "node:test";
import assert from "node:assert/strict";
import { SQL } from "../../app/app/js/sql.js";
import {
  monthEndDates, signedForAccount, accountFlows, debtProgress,
} from "../../app/app/js/cuenta-logic.js";
import { openDb, seedMinimal } from "./helpers.mjs";

const T = "2026-08-24T18:00:00Z";

function ins(db, over = {}) {
  const v = {
    id: "t" + Math.floor(Math.random() * 1e9),
    date: "2026-08-20", period: "per-1", type: "expense", cents: 4520,
    account: "acc-n26", counterAccount: "", category: "cat-casa-alquiler",
    merchant: "", note: "", shared: 0, override: null, paidBy: "me", settled: 0,
    ref: "", rule: "", tag: "", external: "", hasAttachment: 0, status: "pending",
    ...over,
  };
  db.prepare(SQL.insertTransaction).run(
    v.id, v.date, v.period, v.type, v.cents, v.account, v.counterAccount,
    v.category, v.merchant, v.note, v.shared, v.override, v.paidBy, v.settled,
    v.ref, v.rule, v.tag, v.external, v.hasAttachment, v.status, T, T,
  );
  return v.id;
}

// ---- monthEndDates -------------------------------------------------------------------------

test("monthEndDates: último día de los 5 meses anteriores + hoy, en orden", () => {
  assert.deepEqual(monthEndDates("2026-09-27"),
    ["2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-27"]);
});

test("monthEndDates: cruza el año y respeta el febrero bisiesto", () => {
  assert.deepEqual(monthEndDates("2028-03-01", 4), ["2027-12-31", "2028-01-31", "2028-02-29", "2028-03-01"]);
  assert.deepEqual(monthEndDates("2027-03-15", 2), ["2027-02-28", "2027-03-15"]);
  assert.deepEqual(monthEndDates("2026-01-10", 3), ["2025-11-30", "2025-12-31", "2026-01-10"]);
});

test("monthEndDates: n parametrizable; n=1 es solo hoy; n no válido lanza", () => {
  assert.deepEqual(monthEndDates("2026-09-27", 1), ["2026-09-27"]);
  assert.equal(monthEndDates("2026-09-27", 12).length, 12);
  assert.equal(monthEndDates("2026-09-27", 12)[0], "2025-10-31");
  assert.throws(() => monthEndDates("2026-09-27", 0));
  assert.throws(() => monthEndDates("2026-09-27", 2.5));
});

// ---- signedForAccount ----------------------------------------------------------------------

test("signedForAccount: el signo desde el punto de vista de la cuenta", () => {
  const A = "acc-a";
  assert.equal(signedForAccount({ type: "expense", amount_cents: 500, account_id: A }, A), -500);
  assert.equal(signedForAccount({ type: "income", amount_cents: 500, account_id: A }, A), 500);
  assert.equal(signedForAccount({ type: "refund", amount_cents: 500, account_id: A }, A), 500);
  assert.equal(signedForAccount({ type: "transfer", amount_cents: 500, account_id: A, counter_account_id: "b" }, A), -500);
  assert.equal(signedForAccount({ type: "transfer", amount_cents: 500, account_id: "b", counter_account_id: A }, A), 500);
  assert.equal(signedForAccount({ type: "adjustment", amount_cents: -300, account_id: A }, A), -300);
  assert.equal(signedForAccount({ type: "adjustment", amount_cents: 300, account_id: A }, A), 300);
  assert.equal(signedForAccount({ type: "expense", amount_cents: 500, account_id: "b" }, A), 0);
});

test("signedForAccount: la suma hasta una fecha cuadra con SQL.accountBalance menos el saldo inicial", () => {
  const db = openDb();
  seedMinimal(db);
  ins(db, { date: "2026-08-01", type: "expense", cents: 15000, account: "acc-n26" });
  ins(db, { date: "2026-08-02", type: "income", cents: 200000, account: "acc-n26", category: "cat-nomina" });
  ins(db, { date: "2026-08-03", type: "transfer", cents: 30000, account: "acc-n26", counterAccount: "acc-revolut", category: "" });
  ins(db, { date: "2026-08-04", type: "transfer", cents: 5000, account: "acc-revolut", counterAccount: "acc-n26", category: "" });
  ins(db, { date: "2026-08-05", type: "adjustment", cents: -1234, account: "acc-n26", category: "" });
  ins(db, { date: "2026-08-06", type: "refund", cents: 700, account: "acc-n26" });
  ins(db, { date: "2026-08-07", type: "expense", cents: 2400, account: "acc-n26", shared: 1, paidBy: "partner" });
  ins(db, { date: "2026-08-30", type: "expense", cents: 99999, account: "acc-n26" }); // después de la fecha
  ins(db, { id: "del", date: "2026-08-08", type: "expense", cents: 777, account: "acc-n26" });
  db.prepare("UPDATE transactions SET deleted=1 WHERE id='del'").run();

  const rows = db.prepare(`SELECT * FROM transactions WHERE deleted=0 AND date<='2026-08-24'`).all();
  for (const acc of ["acc-n26", "acc-revolut", "acc-prestamo"]) {
    const opening = db.prepare("SELECT opening_balance_cents AS o FROM accounts WHERE id=?").get(acc).o;
    const balance = db.prepare(SQL.accountBalance).get("2026-08-24", acc).balance_cents;
    const sum = rows.reduce((s, r) => s + signedForAccount(r, acc), 0);
    assert.equal(sum, balance - opening, acc);
  }
});

// ---- SQL de la pantalla -------------------------------------------------------------------

test("SQL.accountTxOfPeriod: solo los movimientos vivos de esa cuenta en ese periodo (ambos lados de una transferencia)", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(`INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES ('per-0','Julio','2026-06-27','2026-07-26','closed',60,'',?,?,0)`).run(T, T);
  ins(db, { id: "a", type: "expense", account: "acc-n26" });
  ins(db, { id: "b", type: "transfer", account: "acc-revolut", counterAccount: "acc-n26", category: "" });
  ins(db, { id: "c", type: "expense", account: "acc-revolut" });
  ins(db, { id: "d", type: "expense", account: "acc-n26", period: "per-0", date: "2026-07-10" });
  ins(db, { id: "e", type: "expense", account: "acc-n26" });
  db.prepare("UPDATE transactions SET deleted=1 WHERE id='e'").run();
  const ids = db.prepare(SQL.accountTxOfPeriod).all("per-1", "acc-n26", "acc-n26").map((r) => r.id).sort();
  assert.deepEqual(ids, ["a", "b"]);
});

test("SQL.accountRecentTx: los últimos de la cuenta, de cualquier periodo, del más nuevo al más viejo, con límite", () => {
  const db = openDb();
  seedMinimal(db);
  ins(db, { id: "x1", date: "2026-08-01", account: "acc-n26" });
  ins(db, { id: "x2", date: "2026-08-10", account: "acc-revolut", counterAccount: "acc-n26", type: "transfer", category: "" });
  ins(db, { id: "x3", date: "2026-08-05", account: "acc-n26" });
  ins(db, { id: "x4", date: "2026-08-20", account: "acc-revolut" });
  const rows = db.prepare(SQL.accountRecentTx).all("acc-n26", "acc-n26", 2);
  assert.deepEqual(rows.map((r) => r.id), ["x2", "x3"]);
  assert.ok("counter_account_id" in rows[0] && "my_amount_cents" in rows[0] && "category_id" in rows[0]);
});

// ---- accountFlows --------------------------------------------------------------------------

const byId = {
  "cat-casa": { id: "cat-casa", parent_id: "" },
  "cat-casa-alquiler": { id: "cat-casa-alquiler", parent_id: "cat-casa" },
  "cat-ocio": { id: "cat-ocio", parent_id: "" },
};

test("accountFlows: entra y sale del periodo, con lo que sale agrupado por raíz y de mayor a menor", () => {
  const A = "acc-a";
  const rows = [
    { type: "income", amount_cents: 215000, account_id: A },
    { type: "expense", amount_cents: 46800, account_id: A, category_id: "cat-casa-alquiler" },
    { type: "expense", amount_cents: 1200, account_id: A, category_id: "cat-casa" },
    { type: "expense", amount_cents: 8990, account_id: A, category_id: "cat-ocio" },
    { type: "expense", amount_cents: 500, account_id: A, category_id: "" },
    { type: "transfer", amount_cents: 20000, account_id: A, counter_account_id: "b" },
    { type: "transfer", amount_cents: 3000, account_id: "b", counter_account_id: A },
    { type: "refund", amount_cents: 700, account_id: A, category_id: "cat-ocio" },
    { type: "adjustment", amount_cents: -100, account_id: A },
    { type: "expense", amount_cents: 99999, account_id: "b", category_id: "cat-ocio" },
  ];
  const f = accountFlows(rows, A, byId);
  assert.equal(f.inCents, 215000 + 3000 + 700);
  assert.equal(f.outCents, 46800 + 1200 + 8990 + 500 + 20000 + 100);
  assert.deepEqual(f.outGroups, [
    { kind: "category", rootId: "cat-casa", cents: 48000 },
    { kind: "transfer", rootId: null, cents: 20000 },
    { kind: "category", rootId: "cat-ocio", cents: 8990 },
    { kind: "uncategorized", rootId: null, cents: 500 },
    { kind: "adjustment", rootId: null, cents: 100 },
  ]);
});

test("accountFlows: sin filas, todo a cero", () => {
  assert.deepEqual(accountFlows([], "a", {}), { inCents: 0, outCents: 0, outGroups: [] });
});

// ---- debtProgress --------------------------------------------------------------------------

test("debtProgress: pagado desde el saldo inicial y lo que queda", () => {
  assert.deepEqual(debtProgress({ openingCents: -600000, balanceCents: -430000 }), { paidCents: 170000, pendingCents: 430000 });
  assert.deepEqual(debtProgress({ openingCents: -600000, balanceCents: -650000 }), { paidCents: 0, pendingCents: 650000 });
  assert.deepEqual(debtProgress({ openingCents: -600000, balanceCents: 1000 }), { paidCents: 600000, pendingCents: 0 });
  assert.deepEqual(debtProgress({ openingCents: 0, balanceCents: -12000 }), { paidCents: 0, pendingCents: 12000 });
});
