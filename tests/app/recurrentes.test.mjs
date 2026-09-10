import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { SQL } from "../../app/app/js/sql.js";
import { acceptSubscriptionCandidateStmts } from "../../app/app/js/repo.js";
import { openDb, seedMinimal } from "./helpers.mjs";

const T = "2026-08-24T18:00:00Z";
const T2 = "2026-08-24T19:00:00Z";

// repo.js#acceptSubscriptionCandidateStmts llama a bcUlid/bcSanitizeCell como GLOBALES (cargados
// por <script src="vendor/pure.js"> en el navegador) — mismo patrón que
// tests/app/compartidos.test.mjs usa para settleAllSharedStmts: se cargan aquí para poder llamar
// a la función PURA real, no una reproducción a mano.
const pure = createRequire(import.meta.url)("../../app/app/vendor/pure.js");
globalThis.bcUlid = pure.bcUlid;
globalThis.bcSanitizeCell = pure.bcSanitizeCell;

/** Reproduce EXACTAMENTE el op "execMany" de app/js/db-worker.js (igual que periodos.test.mjs). */
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

/** Inserta una regla recurrente usando la firma de SQL.insertRule (mismo patrón que el
 *  helper ins() de tests/app/movimientos.test.mjs para transactions). */
function insRule(db, over = {}) {
  const v = {
    id: "rule" + Math.floor(Math.random() * 1e9),
    name: "Alquiler", type: "expense", cents: 90000,
    category: "cat-casa-alquiler", account: "acc-n26", counterAccount: "",
    frequency: "monthly", dueDay: 1, dueMonth: null,
    shared: 0, active: 1, isSubscription: 0, cancelledAt: "",
    ...over,
  };
  db.prepare(SQL.insertRule).run(
    v.id, v.name, v.type, v.cents, v.category, v.account, v.counterAccount,
    v.frequency, v.dueDay, v.dueMonth, v.shared, v.active, v.isSubscription, v.cancelledAt, T, T,
  );
  return v.id;
}

/** Inserta una transacción usando la firma de SQL.insertTransaction (mismo helper que
 *  tests/app/prevision.test.mjs y tests/app/compartidos.test.mjs). */
function insTx(db, over = {}) {
  const v = {
    id: "t" + Math.floor(Math.random() * 1e9),
    date: "2026-08-20", period: "per-1", type: "expense", cents: 1299,
    account: "acc-n26", counterAccount: "", category: "cat-casa-alquiler",
    merchant: "Spotify", note: "", shared: 0, override: null, paidBy: "me", settled: 0,
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

test("insertRule + listRules: crea una regla mensual de gasto con sus datos completos", () => {
  const db = openDb();
  seedMinimal(db);
  const id = insRule(db, { name: "Alquiler", cents: 90000, dueDay: 1 });

  const rows = db.prepare(SQL.listRules).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].name, "Alquiler");
  assert.equal(rows[0].type, "expense");
  assert.equal(rows[0].amount_cents, 90000);
  assert.equal(rows[0].category_id, "cat-casa-alquiler");
  assert.equal(rows[0].account_id, "acc-n26");
  assert.equal(rows[0].frequency, "monthly");
  assert.equal(rows[0].due_day, 1);
  assert.equal(rows[0].due_month, null);
  assert.equal(rows[0].is_shared, 0);
  assert.equal(rows[0].is_active, 1);
});

test("insertRule: acepta trimestral/anual con due_month", () => {
  const db = openDb();
  seedMinimal(db);
  const id = insRule(db, { name: "Seguro coche", frequency: "quarterly", dueDay: 15, dueMonth: 3 });

  const row = db.prepare(SQL.listRules).all().find((r) => r.id === id);
  assert.equal(row.frequency, "quarterly");
  assert.equal(row.due_month, 3);
});

test("listRules: excluye borradas y ordena por is_active DESC, name", () => {
  const db = openDb();
  seedMinimal(db);
  insRule(db, { name: "Zeta gimnasio", active: 1 });
  insRule(db, { name: "Alpha alquiler", active: 1 });
  insRule(db, { name: "Beta suscripción", active: 0 });
  const borrada = insRule(db, { name: "Gamma borrada", active: 1 });
  db.prepare("UPDATE recurring_rules SET deleted=1 WHERE id=?").run(borrada);

  const rows = db.prepare(SQL.listRules).all();
  assert.deepEqual(rows.map((r) => r.name), ["Alpha alquiler", "Zeta gimnasio", "Beta suscripción"]);
});

test("insertRule: una regla de transferencia guarda counter_account_id y no lleva categoría", () => {
  const db = openDb();
  seedMinimal(db);
  const id = insRule(db, {
    name: "Ahorro mensual", type: "transfer", category: "", account: "acc-n26",
    counterAccount: "acc-revolut", cents: 20000,
  });

  const row = db.prepare(SQL.listRules).all().find((r) => r.id === id);
  assert.equal(row.type, "transfer");
  assert.equal(row.category_id, "");
  assert.equal(row.account_id, "acc-n26");
  assert.equal(row.counter_account_id, "acc-revolut");
});

test("updateRule: cambia los campos editables y updated_at, nunca created_at", () => {
  const db = openDb();
  seedMinimal(db);
  const id = insRule(db, { name: "Original", cents: 1000, active: 1 });
  const before = db.prepare("SELECT * FROM recurring_rules WHERE id=?").get(id);

  db.prepare(SQL.updateRule).run(
    "Renombrada", "expense", 2500, "cat-casa-alquiler", "acc-n26", "",
    "yearly", 10, 6, 1, 0, 0, "", T2, id,
  );

  const after = db.prepare("SELECT * FROM recurring_rules WHERE id=?").get(id);
  assert.equal(after.name, "Renombrada");
  assert.equal(after.amount_cents, 2500);
  assert.equal(after.frequency, "yearly");
  assert.equal(after.due_day, 10);
  assert.equal(after.due_month, 6);
  assert.equal(after.is_shared, 1);
  assert.equal(after.is_active, 0);
  assert.equal(after.updated_at, T2);
  assert.equal(after.created_at, before.created_at);
  assert.notEqual(after.updated_at, before.updated_at);
});

// ---- Suscripciones (Task 2): is_subscription / cancelled_at, cancelRule, linkTxsToRule,
// subscriptionCharges ---------------------------------------------------------------------

test("insertRule: guarda is_subscription y cancelled_at; por defecto 0 y ''", () => {
  const db = openDb();
  seedMinimal(db);
  const id = insRule(db, { name: "Spotify" });
  const row = db.prepare(SQL.listRules).all().find((r) => r.id === id);
  assert.equal(row.is_subscription, 0);
  assert.equal(row.cancelled_at, "");
});

test("insertRule: acepta is_subscription=1 y cancelled_at con fecha", () => {
  const db = openDb();
  seedMinimal(db);
  const id = insRule(db, { name: "Spotify", isSubscription: 1, cancelledAt: "2026-06-12" });
  const row = db.prepare(SQL.listRules).all().find((r) => r.id === id);
  assert.equal(row.is_subscription, 1);
  assert.equal(row.cancelled_at, "2026-06-12");
});

test("updateRule: actualiza is_subscription y cancelled_at", () => {
  const db = openDb();
  seedMinimal(db);
  const id = insRule(db, { name: "Spotify" });

  db.prepare(SQL.updateRule).run(
    "Spotify", "expense", 1299, "cat-casa-alquiler", "acc-n26", "",
    "monthly", 14, null, 0, 0, 1, "2026-06-12", T2, id,
  );

  const row = db.prepare("SELECT * FROM recurring_rules WHERE id=?").get(id);
  assert.equal(row.is_subscription, 1);
  assert.equal(row.cancelled_at, "2026-06-12");
});

test("SQL.cancelRule: deja is_active=0 y cancelled_at en el mismo UPDATE, y no toca una regla borrada", () => {
  const db = openDb();
  seedMinimal(db);
  const id = insRule(db, { name: "Spotify", isSubscription: 1, active: 1 });

  db.prepare(SQL.cancelRule).run("2026-06-12", T2, id);
  const row = db.prepare("SELECT * FROM recurring_rules WHERE id=?").get(id);
  assert.equal(row.is_active, 0);
  assert.equal(row.cancelled_at, "2026-06-12");
  assert.equal(row.updated_at, T2);

  const borrada = insRule(db, { name: "Borrada", isSubscription: 1, active: 1 });
  db.prepare("UPDATE recurring_rules SET deleted=1 WHERE id=?").run(borrada);
  db.prepare(SQL.cancelRule).run("2026-06-12", T2, borrada);
  const rowBorrada = db.prepare("SELECT * FROM recurring_rules WHERE id=?").get(borrada);
  assert.equal(rowBorrada.is_active, 1, "una regla borrada no se toca");
  assert.equal(rowBorrada.cancelled_at, "");
});

test("SQL.linkTxsToRule: enlaza un cargo con rule_id='', no pisa uno que ya tenía otro rule_id, y es idempotente", () => {
  const db = openDb();
  seedMinimal(db);
  const ruleId = insRule(db, { name: "Netflix" });
  const otherRuleId = insRule(db, { name: "Otra" });
  const txId = insTx(db, { merchant: "Netflix" });
  const txWithOther = insTx(db, { merchant: "Netflix", rule: otherRuleId });

  db.prepare(SQL.linkTxsToRule).run(ruleId, T2, txId);
  assert.equal(db.prepare("SELECT rule_id FROM transactions WHERE id=?").get(txId).rule_id, ruleId);

  db.prepare(SQL.linkTxsToRule).run(ruleId, T2, txWithOther);
  assert.equal(db.prepare("SELECT rule_id FROM transactions WHERE id=?").get(txWithOther).rule_id, otherRuleId,
    "no pisa un rule_id que ya existía");

  // idempotente: volver a enlazar el mismo cargo con la misma regla no falla ni cambia nada
  db.prepare(SQL.linkTxsToRule).run(ruleId, T2, txId);
  assert.equal(db.prepare("SELECT rule_id FROM transactions WHERE id=?").get(txId).rule_id, ruleId);
});

test("SQL.subscriptionCharges: deja fuera borrados, ingresos, transferencias, paid_by='partner', comercio vacío y lo anterior a la ventana; ordena date DESC", () => {
  const db = openDb();
  seedMinimal(db);
  const vivo = insTx(db, { id: "tx-vivo", date: "2026-08-02", merchant: "Netflix" });
  const masReciente = insTx(db, { id: "tx-reciente", date: "2026-09-02", merchant: "Netflix" });
  const borrado = insTx(db, { id: "tx-borrado", date: "2026-08-02", merchant: "Netflix" });
  db.prepare("UPDATE transactions SET deleted=1 WHERE id=?").run(borrado);
  insTx(db, { id: "tx-ingreso", date: "2026-08-02", type: "income", category: "cat-nomina", merchant: "Nomina" });
  insTx(db, { id: "tx-transfer", date: "2026-08-02", type: "transfer", category: "", account: "acc-n26", counterAccount: "acc-revolut", merchant: "Traspaso" });
  insTx(db, { id: "tx-partner", date: "2026-08-02", merchant: "Netflix", shared: 1, paidBy: "partner", account: "" });
  insTx(db, { id: "tx-sin-comercio", date: "2026-08-02", merchant: "" });
  insTx(db, { id: "tx-fuera-ventana", date: "2020-01-01", merchant: "Netflix" });

  const rows = db.prepare(SQL.subscriptionCharges).all("2026-01-01", 100);
  assert.deepEqual(rows.map((r) => r.id), [masReciente, vivo]);
});

test("softDeleteRule: marca deleted+updated_at y desaparece de listRules", () => {
  const db = openDb();
  seedMinimal(db);
  const permanece = insRule(db, { name: "Permanece" });
  const borrar = insRule(db, { name: "Borrar" });

  db.prepare(SQL.softDeleteRule).run(T2, borrar);

  const row = db.prepare("SELECT deleted, updated_at FROM recurring_rules WHERE id=?").get(borrar);
  assert.equal(row.deleted, 1);
  assert.equal(row.updated_at, T2);

  const rows = db.prepare(SQL.listRules).all();
  assert.deepEqual(rows.map((r) => r.id), [permanece]);
});

test("CHECK de frequency inválida lanza", () => {
  const db = openDb();
  seedMinimal(db);
  assert.throws(() => insRule(db, { frequency: "daily" }), /CHECK constraint failed/);
});

test("CHECK de type inválido lanza (recurring_rules solo admite expense/income/transfer)", () => {
  const db = openDb();
  seedMinimal(db);
  assert.throws(() => insRule(db, { type: "refund" }), /CHECK constraint failed/);
});

// ---- Task 7: acceptSubscriptionCandidate ---------------------------------------------------

/** Candidata mínima con la forma exacta de subscription-detect.js#detectSubscriptions. */
function candidate(over = {}) {
  return {
    merchantKey: "netflix", merchant: "Netflix", amountCents: 1299, frequency: "monthly",
    cadenceDays: 30, count: 3, lastDates: ["2026-09-02", "2026-08-02", "2026-07-02"],
    nextEstimated: "2026-10-02", categoryId: "cat-casa-alquiler", accountId: "acc-n26",
    txIds: [], ...over,
  };
}

test("acceptSubscriptionCandidate: la regla se crea con is_subscription=1, is_active=1, cancelled_at='', is_shared=0 SIEMPRE, y frecuencia/día deducidos", () => {
  const db = openDb();
  seedMinimal(db);
  const tx1 = insTx(db, { id: "tx1", date: "2026-09-02", merchant: "Netflix" });
  const tx2 = insTx(db, { id: "tx2", date: "2026-08-02", merchant: "Netflix" });

  const stmts = acceptSubscriptionCandidateStmts(candidate({ txIds: [tx1, tx2] }), "acc-fallback");
  execManyRaw(db, stmts);

  const rule = db.prepare(SQL.listRules).all()[0];
  assert.equal(rule.name, "Netflix");
  assert.equal(rule.type, "expense");
  assert.equal(rule.amount_cents, 1299);
  assert.equal(rule.category_id, "cat-casa-alquiler");
  assert.equal(rule.account_id, "acc-n26");
  assert.equal(rule.frequency, "monthly");
  assert.equal(rule.due_day, 2, "día del mes del cargo MÁS RECIENTE (lastDates[0])");
  assert.equal(rule.due_month, null, "solo se rellena en yearly");
  assert.equal(rule.is_shared, 0);
  assert.equal(rule.is_active, 1);
  assert.equal(rule.is_subscription, 1);
  assert.equal(rule.cancelled_at, "");
});

test("acceptSubscriptionCandidate: yearly deduce también due_month del cargo más reciente", () => {
  const db = openDb();
  seedMinimal(db);
  const tx1 = insTx(db, { id: "tx1", date: "2026-09-02" });
  const tx2 = insTx(db, { id: "tx2", date: "2025-09-02" });
  execManyRaw(db, acceptSubscriptionCandidateStmts(
    candidate({ frequency: "yearly", lastDates: ["2026-09-02", "2025-09-02"], txIds: [tx1, tx2] }),
    "acc-fallback",
  ));
  const rule = db.prepare(SQL.listRules).all()[0];
  assert.equal(rule.due_day, 2);
  assert.equal(rule.due_month, 9);
});

test("acceptSubscriptionCandidate: los cargos de txIds quedan con el rule_id nuevo", () => {
  const db = openDb();
  seedMinimal(db);
  const tx1 = insTx(db, { id: "tx1", date: "2026-09-02" });
  const tx2 = insTx(db, { id: "tx2", date: "2026-08-02" });
  execManyRaw(db, acceptSubscriptionCandidateStmts(candidate({ txIds: [tx1, tx2] }), "acc-fallback"));

  const ruleId = db.prepare(SQL.listRules).all()[0].id;
  assert.equal(db.prepare("SELECT rule_id FROM transactions WHERE id=?").get(tx1).rule_id, ruleId);
  assert.equal(db.prepare("SELECT rule_id FROM transactions WHERE id=?").get(tx2).rule_id, ruleId);
});

test("acceptSubscriptionCandidate: un cargo que ya tenía otro rule_id no se toca", () => {
  const db = openDb();
  seedMinimal(db);
  const otraRegla = insRule(db, { name: "Otra" });
  const tx1 = insTx(db, { id: "tx1", date: "2026-09-02" });
  const txAjeno = insTx(db, { id: "tx-ajeno", date: "2026-08-02", rule: otraRegla });
  execManyRaw(db, acceptSubscriptionCandidateStmts(candidate({ txIds: [tx1, txAjeno] }), "acc-fallback"));

  assert.equal(db.prepare("SELECT rule_id FROM transactions WHERE id=?").get(txAjeno).rule_id, otraRegla,
    "el cargo ya enlazado a OTRA regla no se pisa");
});

test("acceptSubscriptionCandidate: una candidata sin accountId cae al accountId de respaldo", () => {
  const db = openDb();
  seedMinimal(db);
  const tx1 = insTx(db, { id: "tx1", date: "2026-09-02" });
  execManyRaw(db, acceptSubscriptionCandidateStmts(candidate({ accountId: "", txIds: [tx1] }), "acc-revolut"));
  assert.equal(db.prepare(SQL.listRules).all()[0].account_id, "acc-revolut");
});

test("acceptSubscriptionCandidate: tras aceptar, SQL.paidRuleIds marca la regla como pagada en el periodo del cargo (efecto buscado en Previsión)", () => {
  const db = openDb();
  seedMinimal(db);
  const tx1 = insTx(db, { id: "tx1", date: "2026-09-02", period: "per-1" });
  execManyRaw(db, acceptSubscriptionCandidateStmts(candidate({ txIds: [tx1] }), "acc-fallback"));

  const ruleId = db.prepare(SQL.listRules).all()[0].id;
  const paidIds = db.prepare(SQL.paidRuleIds).all("per-1").map((r) => r.rule_id);
  assert.deepEqual(paidIds, [ruleId], "el cargo enlazado marca la regla como pagada este periodo");
});
