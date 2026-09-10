import { test } from "node:test";
import assert from "node:assert/strict";
import { SQL } from "../../app/app/js/sql.js";
import { openDb, seedMinimal } from "./helpers.mjs";

const T = "2026-08-24T18:00:00Z";

/** Inserta una transacción usando la firma NUEVA (22 posicionales) de SQL.insertTransaction. */
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

test("spentOfPeriod: refund vinculado a un gasto COMPARTIDO ya borrado (deleted=1) resta como huérfano", () => {
  const db = openDb();
  seedMinimal(db);
  const gastoId = ins(db, { type: "expense", cents: 10000, shared: 1 }); // MY_AMOUNT 60% -> 6000 mientras vive
  ins(db, { type: "refund", cents: 4000, shared: 0, ref: gastoId });
  db.prepare("UPDATE transactions SET deleted=1 WHERE id=?").run(gastoId);
  const spent = db.prepare(SQL.spentOfPeriod).get("per-1").spent_cents;
  assert.equal(spent, -4000, "el gasto borrado ya no cuenta; el refund (is_shared=0) resta su importe entero como huérfano");
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

test("spentOfPeriod: un gasto que pagó la contraparte cuenta MI parte igual que uno mío", () => {
  const db = openDb();
  seedMinimal(db);
  ins(db, { id: "suyo", cents: 10000, shared: 1, paidBy: "partner", account: "" });
  assert.equal(db.prepare(SQL.spentOfPeriod).get("per-1").spent_cents, 6000, "60% de 10000, lo pague quien lo pague");
});

test("spentOfPeriod: el apunte de salida de la liquidación (adjustment) no lo toca", () => {
  const db = openDb();
  seedMinimal(db);
  const suyo = ins(db, { id: "suyo", cents: 10000, shared: 1, paidBy: "partner", account: "" });
  ins(db, { id: "liq", type: "adjustment", cents: -6000, category: "", ref: suyo });
  assert.equal(db.prepare(SQL.spentOfPeriod).get("per-1").spent_cents, 6000,
    "spentOfPeriod solo tiene ramas para expense y refund: cualquier otro tipo cae en ELSE 0");
});

test("recentForRefund: refunded_cents suma las devoluciones y los ajustes VIVOS enlazados a cada gasto", () => {
  const db = openDb();
  seedMinimal(db);
  ins(db, { id: "g-tienda", date: "2026-08-20", cents: 5000 });
  ins(db, { id: "g-limpio", date: "2026-08-19", cents: 3000 });
  ins(db, { id: "d-parcial", type: "refund", date: "2026-08-21", cents: 2000, ref: "g-tienda" });
  ins(db, { id: "d-otra", type: "refund", date: "2026-08-22", cents: 500, ref: "g-tienda" });
  ins(db, { id: "d-borrada", type: "refund", date: "2026-08-23", cents: 1000, ref: "g-tienda" });
  db.prepare("UPDATE transactions SET deleted=1 WHERE id='d-borrada'").run();

  const by = Object.fromEntries(db.prepare(SQL.recentForRefund).all("per-1").map((r) => [r.id, r.refunded_cents]));
  assert.equal(by["g-tienda"], 2500, "2000 + 500; la devolución BORRADA no cuenta");
  assert.equal(by["g-limpio"], 0, "un gasto sin devoluciones trae 0, nunca null");
});

test("recentForRefund: los gastos ya devueltos van al FINAL, y dentro de cada grupo sigue mandando la fecha", () => {
  const db = openDb();
  seedMinimal(db);
  ins(db, { id: "g-nuevo", date: "2026-08-22", cents: 5000 });
  ins(db, { id: "g-viejo", date: "2026-08-18", cents: 4000 });
  ins(db, { id: "g-devuelto", date: "2026-08-21", cents: 6000 });
  ins(db, { id: "g-liquidado", date: "2026-08-23", cents: 10000, shared: 1, settled: 1 });
  ins(db, { id: "d-tienda", type: "refund", date: "2026-08-24", cents: 6000, ref: "g-devuelto" });
  // Ajuste de liquidación: settleAllSharedStmts lo guarda con importe NEGATIVO. Aquí solo puede
  // llegar de una hoja editada a mano (el ajuste real enlaza gastos con paid_by='partner', que esta
  // consulta excluye), y sirve para fijar que el ABS del SUM lo cuenta como devuelto igualmente.
  ins(db, { id: "a-liq", type: "adjustment", date: "2026-08-24", cents: -4000, category: "", ref: "g-liquidado" });

  const rows = db.prepare(SQL.recentForRefund).all("per-1");
  assert.deepEqual(rows.map((r) => r.id), ["g-nuevo", "g-viejo", "g-liquidado", "g-devuelto"],
    "primero los que no tienen nada devuelto (fecha desc), y detrás los que sí (también fecha desc)");
  assert.equal(rows.find((r) => r.id === "g-liquidado").refunded_cents, 4000, "ABS: el ajuste negativo cuenta en positivo");
});
