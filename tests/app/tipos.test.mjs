import { test } from "node:test";
import assert from "node:assert/strict";
import { SQL } from "../../app/js/sql.js";
import { openDb, seedMinimal } from "./helpers.mjs";

const T = "2026-08-24T18:00:00Z";

/** Inserta una transacción usando la firma NUEVA (19 posicionales) de SQL.insertTransaction. */
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

test("spentOfPeriod: refund compartido sin ref_id resta solo MY_AMOUNT prorrateado", () => {
  const db = openDb();
  seedMinimal(db);
  ins(db, { type: "expense", cents: 10000, shared: 1 }); // MY_AMOUNT 60% -> 6000
  ins(db, { type: "refund", cents: 1000, shared: 1 });   // MY_AMOUNT 60% -> 600 (no 1000)
  const spent = db.prepare(SQL.spentOfPeriod).get("per-1").spent_cents;
  assert.equal(spent, 5400);
});

test("spentOfPeriod: refund CON ref_id no toca el gasto original", () => {
  const db = openDb();
  seedMinimal(db);
  const gastoId = ins(db, { type: "expense", cents: 90000, shared: 1 }); // MY_AMOUNT -> 54000
  ins(db, { type: "refund", cents: 36000, shared: 1, ref: gastoId });
  const spent = db.prepare(SQL.spentOfPeriod).get("per-1").spent_cents;
  assert.equal(spent, 54000);
});

test("insertTransaction admite transfer con counter_account_id y adjustment negativo", () => {
  const db = openDb();
  seedMinimal(db);
  const trId = ins(db, {
    type: "transfer", cents: 5000, account: "acc-n26", counterAccount: "acc-revolut", category: "",
  });
  const adjId = ins(db, { type: "adjustment", cents: -500, account: "acc-n26", category: "" });
  const transferRow = db.prepare("SELECT * FROM transactions WHERE id=?").get(trId);
  const adjRow = db.prepare("SELECT * FROM transactions WHERE id=?").get(adjId);
  assert.equal(transferRow.counter_account_id, "acc-revolut");
  assert.equal(adjRow.amount_cents, -500);
});

test("CHECK del schema: expense con amount_cents=0 lanza", () => {
  const db = openDb();
  seedMinimal(db);
  assert.throws(() => ins(db, { type: "expense", cents: 0 }));
});
