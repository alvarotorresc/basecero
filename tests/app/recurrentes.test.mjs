import { test } from "node:test";
import assert from "node:assert/strict";
import { SQL } from "../../app/app/js/sql.js";
import { openDb, seedMinimal } from "./helpers.mjs";

const T = "2026-08-24T18:00:00Z";
const T2 = "2026-08-24T19:00:00Z";

/** Inserta una regla recurrente usando la firma de SQL.insertRule (mismo patrón que el
 *  helper ins() de tests/app/movimientos.test.mjs para transactions). */
function insRule(db, over = {}) {
  const v = {
    id: "rule" + Math.floor(Math.random() * 1e9),
    name: "Alquiler", type: "expense", cents: 90000,
    category: "cat-casa-alquiler", account: "acc-n26", counterAccount: "",
    frequency: "monthly", dueDay: 1, dueMonth: null,
    shared: 0, active: 1,
    ...over,
  };
  db.prepare(SQL.insertRule).run(
    v.id, v.name, v.type, v.cents, v.category, v.account, v.counterAccount,
    v.frequency, v.dueDay, v.dueMonth, v.shared, v.active, T, T,
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
    "yearly", 10, 6, 1, 0, T2, id,
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
