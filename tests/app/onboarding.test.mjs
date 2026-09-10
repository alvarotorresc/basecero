import { test } from "node:test";
import assert from "node:assert/strict";
import { needsOnboarding, canLeaveAccounts, accountDraft } from "../../app/app/js/onboarding-steps.js";
import { SQL } from "../../app/app/js/sql.js";
import { openDb, seedMinimal } from "./helpers.mjs";

const T = "2026-08-24T18:00:00Z";

test("needsOnboarding: solo con cero periodos", () => {
  assert.equal(needsOnboarding([]), true);
  assert.equal(needsOnboarding([{ id: "per-1", status: "closed" }]), false);
  assert.equal(needsOnboarding([{ id: "per-1", status: "open" }]), false);
});

test("canLeaveAccounts: exige al menos una cuenta", () => {
  assert.equal(canLeaveAccounts(0), false);
  assert.equal(canLeaveAccounts(1), true);
  assert.equal(canLeaveAccounts(3), true);
});

test("accountDraft: nombre obligatorio", () => {
  assert.deepEqual(accountDraft({ name: "  ", type: "checking", raw: "10" }), { error: "Ponle un nombre a la cuenta." });
});

test("accountDraft: parsea coma decimal y respeta el signo", () => {
  assert.deepEqual(accountDraft({ name: "Banco", type: "checking", raw: "1250,50" }),
    { name: "Banco", type: "checking", openingBalanceCents: 125050 });
  assert.deepEqual(accountDraft({ name: "Hucha", type: "savings", raw: "" }),
    { name: "Hucha", type: "savings", openingBalanceCents: 0 });
});

test("accountDraft: liability siempre en negativo", () => {
  assert.equal(accountDraft({ name: "Coche", type: "liability", raw: "300" }).openingBalanceCents, -30000);
  assert.equal(accountDraft({ name: "Coche", type: "liability", raw: "-300" }).openingBalanceCents, -30000);
});

// ---- SQL.deleteEmptyAccount (D9): reproduce el statement sobre la BD de helpers.mjs, mismo
// patrón que categorias.test.mjs:49-112. Bind SIEMPRE [id, id, id] (el WHERE hace la comprobación
// en el mismo statement, sin ventana entre comprobar y borrar). Los cuatro casos se discriminan
// por `.changes` (node:sqlite) Y por si la fila sobrevive.

test("SQL.deleteEmptyAccount: borra una cuenta que no tiene ningún movimiento", () => {
  const db = openDb();
  seedMinimal(db); // acc-revolut (savings), sin movimientos
  const r = db.prepare(SQL.deleteEmptyAccount).run("acc-revolut", "acc-revolut", "acc-revolut");
  assert.equal(r.changes, 1);
  assert.equal(db.prepare("SELECT * FROM accounts WHERE id='acc-revolut'").get(), undefined);
});

test("SQL.deleteEmptyAccount: NO borra una cuenta con un movimiento en account_id", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(`INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,counter_account_id,created_at,updated_at,deleted)
    VALUES ('tx-1','2026-08-24','per-1','expense',1000,'acc-revolut','',?,?,0)`).run(T, T);
  const r = db.prepare(SQL.deleteEmptyAccount).run("acc-revolut", "acc-revolut", "acc-revolut");
  assert.equal(r.changes, 0);
  assert.ok(db.prepare("SELECT * FROM accounts WHERE id='acc-revolut'").get(), "la fila sobrevive");
});

test("SQL.deleteEmptyAccount: NO borra una cuenta referenciada como counter_account_id (transferencia)", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(`INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,counter_account_id,created_at,updated_at,deleted)
    VALUES ('tx-1','2026-08-24','per-1','transfer',1000,'acc-n26','acc-revolut',?,?,0)`).run(T, T);
  const r = db.prepare(SQL.deleteEmptyAccount).run("acc-revolut", "acc-revolut", "acc-revolut");
  assert.equal(r.changes, 0);
  assert.ok(db.prepare("SELECT * FROM accounts WHERE id='acc-revolut'").get(), "la fila sobrevive");
});

test("SQL.deleteEmptyAccount: SÍ borra si el único movimiento está deleted=1", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(`INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,counter_account_id,created_at,updated_at,deleted)
    VALUES ('tx-1','2026-08-24','per-1','expense',1000,'acc-revolut','',?,?,1)`).run(T, T);
  const r = db.prepare(SQL.deleteEmptyAccount).run("acc-revolut", "acc-revolut", "acc-revolut");
  assert.equal(r.changes, 1);
  assert.equal(db.prepare("SELECT * FROM accounts WHERE id='acc-revolut'").get(), undefined);
});
