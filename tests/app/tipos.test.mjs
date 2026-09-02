import { test } from "node:test";
import assert from "node:assert/strict";
import { SQL } from "../../app/app/js/sql.js";
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

test("spentOfPeriod: refund vinculado a un gasto COMPARTIDO (liquidación) no toca el gasto original", () => {
  const db = openDb();
  seedMinimal(db);
  const gastoId = ins(db, { type: "expense", cents: 90000, shared: 1 }); // MY_AMOUNT -> 54000
  ins(db, { type: "refund", cents: 36000, shared: 1, ref: gastoId });
  const spent = db.prepare(SQL.spentOfPeriod).get("per-1").spent_cents;
  assert.equal(spent, 54000);
});

test("spentOfPeriod: refund vinculado a un gasto NO compartido resta su importe entero", () => {
  const db = openDb();
  seedMinimal(db);
  const gastoId = ins(db, { type: "expense", cents: 5000, shared: 0 });
  ins(db, { type: "refund", cents: 5000, shared: 0, ref: gastoId });
  const spent = db.prepare(SQL.spentOfPeriod).get("per-1").spent_cents;
  assert.equal(spent, 0);

  const db2 = openDb();
  seedMinimal(db2);
  const gastoId2 = ins(db2, { type: "expense", cents: 5000, shared: 0 });
  ins(db2, { type: "refund", cents: 2000, shared: 0, ref: gastoId2 }); // devolución parcial
  const spent2 = db2.prepare(SQL.spentOfPeriod).get("per-1").spent_cents;
  assert.equal(spent2, 3000);
});

test("spentOfPeriod: refund vinculado a un gasto que ya no existe (ref_id huérfano) resta como suelto", () => {
  const db = openDb();
  seedMinimal(db);
  ins(db, { type: "expense", cents: 5000, shared: 0 });
  ins(db, { type: "refund", cents: 1000, shared: 0, ref: "no-existe" });
  const spent = db.prepare(SQL.spentOfPeriod).get("per-1").spent_cents;
  assert.equal(spent, 4000);
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

test("recentForRefund: expone period_pct y share_pct_override del gasto enlazado (no el pct del periodo abierto)", () => {
  const db = openDb();
  seedMinimal(db);
  // periodo cerrado con reparto distinto (70%) al periodo abierto per-1 (60%)
  db.prepare(`INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES ('per-closed','Julio 2026','2026-06-27','2026-07-27','closed',70,'',?,?,0)`).run(T, T);

  // compartido sin override, en el periodo cerrado (70%) -> parte de la contraparte = 30%
  const closedId = ins(db, { period: "per-closed", type: "expense", cents: 10000, shared: 1 });
  // compartido con override 50%, en el periodo abierto per-1 (60%) -> el override manda -> parte de la contraparte = 50%
  const overrideId = ins(db, { period: "per-1", type: "expense", cents: 8000, shared: 1, override: 50 });

  const rows = db.prepare(SQL.recentForRefund).all("per-1");
  const closedRow = rows.find((r) => r.id === closedId);
  const overrideRow = rows.find((r) => r.id === overrideId);

  assert.equal(closedRow.period_pct, 70);
  assert.equal(closedRow.share_pct_override, null);
  assert.equal(overrideRow.period_pct, 60);
  assert.equal(overrideRow.share_pct_override, 50);
});
