import { test } from "node:test";
import assert from "node:assert/strict";
import {
  needsOnboarding, canLeaveAccounts, accountDraft, ACCOUNT_KINDS, accountKindOf, stepProgress, ONB_STEP_COUNT,
  ONB_STEP, onbCategoryRoots, canLeaveCategories, categoryArchiveDiff,
} from "../../app/app/js/onboarding-steps.js";
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

test("accountDraft: la baldosa Hucha crea una savings con familia imp (D-impl-2)", () => {
  assert.deepEqual(accountDraft({ name: "Fondo", type: "hucha", raw: "1250,00" }),
    { name: "Fondo", type: "savings", openingBalanceCents: 125000, fam: "imp" });
});

test("accountDraft: solo la Hucha lleva fam (las demás, sin la clave)", () => {
  for (const type of ["checking", "savings", "liability"]) {
    assert.equal("fam" in accountDraft({ name: "X", type, raw: "1" }), false, type);
  }
});

test("ACCOUNT_KINDS: las cuatro baldosas de B-Onb-Cuentas, en su orden, con tipo de BD válido", () => {
  assert.deepEqual(ACCOUNT_KINDS.map((k) => k.id), ["checking", "savings", "hucha", "liability"]);
  assert.deepEqual(ACCOUNT_KINDS.map((k) => k.type), ["checking", "savings", "savings", "liability"]);
  assert.deepEqual(ACCOUNT_KINDS.map((k) => k.fam), ["tra", "ali", "imp", "coc"]);
});

test("accountKindOf: una savings con familia imp se lee como Hucha; el resto, su tipo", () => {
  assert.equal(accountKindOf({ type: "savings" }, "imp"), "hucha");
  assert.equal(accountKindOf({ type: "savings" }, "ali"), "savings");
  assert.equal(accountKindOf({ type: "checking" }, "imp"), "checking");
  assert.equal(accountKindOf({ type: "liability" }, "coc"), "liability");
});

test("stepProgress: Bienvenida sin progreso; Cuentas, Ajustes, Categorías y Periodo son 1..4 de 4 (B-8)", () => {
  assert.equal(ONB_STEP_COUNT, 4);
  assert.deepEqual(ONB_STEP, { welcome: 0, accounts: 1, prefs: 2, categories: 3, period: 4 });
  assert.equal(stepProgress(0), null);
  assert.deepEqual(stepProgress(1), { current: 1, total: 4 });
  assert.deepEqual(stepProgress(2), { current: 2, total: 4 });
  assert.deepEqual(stepProgress(3), { current: 3, total: 4 });
  assert.deepEqual(stepProgress(4), { current: 4, total: 4 });
});

// ---- B-8: paso «Categorías» (B-Onb-Categorias) — desmarcar = archivar, recuperable en Categorías.

const CATS = [
  { id: "cat-ocio", name: "Ocio", parent_id: "", flow: "expense", is_archived: 0, deleted: 0, display_order: 80 },
  { id: "cat-casa", name: "Casa", parent_id: "", flow: "expense", is_archived: 0, deleted: 0, display_order: 10 },
  { id: "cat-casa-luz", name: "Luz", parent_id: "cat-casa", flow: "expense", is_archived: 0, deleted: 0, display_order: 11 },
  { id: "cat-casa-agua", name: "Agua", parent_id: "cat-casa", flow: "expense", is_archived: 1, deleted: 0, display_order: 12 },
  { id: "cat-casa-vieja", name: "Vieja", parent_id: "cat-casa", flow: "expense", is_archived: 0, deleted: 1, display_order: 13 },
  { id: "cat-regalos", name: "Regalos", parent_id: "", flow: "expense", is_archived: 1, deleted: 0, display_order: 90 },
  { id: "cat-regalos-cumple", name: "Cumple", parent_id: "cat-regalos", flow: "expense", is_archived: 1, deleted: 0, display_order: 91 },
  { id: "cat-nomina", name: "Nómina", parent_id: "", flow: "income", is_archived: 0, deleted: 0, display_order: 100 },
  { id: "cat-borrada", name: "Borrada", parent_id: "", flow: "expense", is_archived: 0, deleted: 1, display_order: 5 },
];

test("onbCategoryRoots: raíces de gasto vivas en su orden, marcadas si no están archivadas, con sus subcategorías", () => {
  assert.deepEqual(onbCategoryRoots(CATS), [
    { id: "cat-casa", name: "Casa", subCount: 2, checked: true },
    { id: "cat-ocio", name: "Ocio", subCount: 0, checked: true },
    { id: "cat-regalos", name: "Regalos", subCount: 1, checked: false },
  ]);
});

test("canLeaveCategories: exige al menos una categoría marcada", () => {
  assert.equal(canLeaveCategories(0), false);
  assert.equal(canLeaveCategories(1), true);
});

test("categoryArchiveDiff: archiva las desmarcadas y recupera las que se vuelven a marcar; nada más", () => {
  const roots = onbCategoryRoots(CATS);
  assert.deepEqual(categoryArchiveDiff(roots, new Set(["cat-casa", "cat-ocio"])), { archive: [], restore: [] });
  assert.deepEqual(categoryArchiveDiff(roots, new Set(["cat-casa"])), { archive: ["cat-ocio"], restore: [] });
  // Con 0 periodos solo el propio onboarding puede haber archivado: el estado sale de is_archived
  // de la BD (no de memoria), así que volver a marcar una archivada la recupera aunque se haya
  // recargado la pestaña entre medias.
  assert.deepEqual(categoryArchiveDiff(roots, new Set(["cat-casa", "cat-ocio", "cat-regalos"])),
    { archive: [], restore: ["cat-regalos"] });
});

test("categoryArchiveDiff: tras recargar a mitad (roots releídas de la BD), volver a marcar recupera", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare("UPDATE categories SET is_archived=1 WHERE id IN ('cat-casa','cat-casa-alquiler')").run();
  // Recarga: las raíces se reconstruyen desde la BD, sin ningún estado en memoria.
  const roots = onbCategoryRoots(db.prepare("SELECT * FROM categories").all());
  assert.equal(roots.find((r) => r.id === "cat-casa").checked, false);
  const { restore } = categoryArchiveDiff(roots, new Set(["cat-casa"]));
  assert.deepEqual(restore, ["cat-casa"]);
  for (const id of restore) db.prepare(SQL.restoreCategoryTree).run(T, id, id);
  assert.deepEqual(db.prepare("SELECT is_archived FROM categories WHERE id IN ('cat-casa','cat-casa-alquiler')").all().map((r) => r.is_archived), [0, 0]);
});

// ---- SQL.restoreCategoryTree (B-8): volver a marcar en el onboarding recupera la raíz Y sus hijas
// (archiveCategory las archivó en cascada; unarchiveCategory, a propósito, no las recupera).
test("SQL.restoreCategoryTree: desarchiva la raíz y todas sus hijas vivas, y nada de otras raíces", () => {
  const db = openDb();
  seedMinimal(db); // cat-casa (raíz) + cat-casa-alquiler (hija)
  db.prepare("UPDATE categories SET is_archived=1 WHERE id IN ('cat-casa','cat-casa-alquiler')").run();
  db.prepare(`INSERT INTO categories (id,name,parent_id,flow,need_type,display_order,is_archived,created_at,updated_at,deleted)
    VALUES ('cat-otra','Otra','','expense','want',9,1,?,?,0)`).run(T, T);
  db.prepare(`INSERT INTO categories (id,name,parent_id,flow,need_type,display_order,is_archived,created_at,updated_at,deleted)
    VALUES ('cat-casa-borrada','Borrada','cat-casa','expense','need',3,1,?,?,1)`).run(T, T);
  const T2 = "2026-09-27T10:00:00Z";
  db.prepare(SQL.restoreCategoryTree).run(T2, "cat-casa", "cat-casa");
  const row = (id) => db.prepare("SELECT is_archived, updated_at FROM categories WHERE id=?").get(id);
  assert.equal(row("cat-casa").is_archived, 0);
  assert.equal(row("cat-casa").updated_at, T2);
  assert.equal(row("cat-casa-alquiler").is_archived, 0);
  assert.equal(row("cat-otra").is_archived, 1, "otra raíz no se toca");
  assert.equal(row("cat-casa-borrada").is_archived, 1, "una hija borrada no se toca");
});

// ---- SQL.deleteEmptyAccount (D9): reproduce el statement sobre la BD de helpers.mjs, mismo
// patrón que categorias.test.mjs:49-112. Bind SIEMPRE [id, id, id, id, id, id] (el WHERE hace la
// comprobación en el mismo statement, sin ventana entre comprobar y borrar, contra transactions,
// recurring_rules y goals). Los casos se discriminan por `.changes` (node:sqlite) Y por si la
// fila sobrevive.

test("SQL.deleteEmptyAccount: borra una cuenta que no tiene ningún movimiento", () => {
  const db = openDb();
  seedMinimal(db); // acc-revolut (savings), sin movimientos
  const r = db.prepare(SQL.deleteEmptyAccount).run(
    "acc-revolut", "acc-revolut", "acc-revolut", "acc-revolut", "acc-revolut", "acc-revolut");
  assert.equal(r.changes, 1);
  assert.equal(db.prepare("SELECT * FROM accounts WHERE id='acc-revolut'").get(), undefined);
});

test("SQL.deleteEmptyAccount: NO borra una cuenta con un movimiento en account_id", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(`INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,counter_account_id,created_at,updated_at,deleted)
    VALUES ('tx-1','2026-08-24','per-1','expense',1000,'acc-revolut','',?,?,0)`).run(T, T);
  const r = db.prepare(SQL.deleteEmptyAccount).run(
    "acc-revolut", "acc-revolut", "acc-revolut", "acc-revolut", "acc-revolut", "acc-revolut");
  assert.equal(r.changes, 0);
  assert.ok(db.prepare("SELECT * FROM accounts WHERE id='acc-revolut'").get(), "la fila sobrevive");
});

test("SQL.deleteEmptyAccount: NO borra una cuenta referenciada como counter_account_id (transferencia)", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(`INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,counter_account_id,created_at,updated_at,deleted)
    VALUES ('tx-1','2026-08-24','per-1','transfer',1000,'acc-n26','acc-revolut',?,?,0)`).run(T, T);
  const r = db.prepare(SQL.deleteEmptyAccount).run(
    "acc-revolut", "acc-revolut", "acc-revolut", "acc-revolut", "acc-revolut", "acc-revolut");
  assert.equal(r.changes, 0);
  assert.ok(db.prepare("SELECT * FROM accounts WHERE id='acc-revolut'").get(), "la fila sobrevive");
});

test("SQL.deleteEmptyAccount: SÍ borra si el único movimiento está deleted=1", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(`INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,counter_account_id,created_at,updated_at,deleted)
    VALUES ('tx-1','2026-08-24','per-1','expense',1000,'acc-revolut','',?,?,1)`).run(T, T);
  const r = db.prepare(SQL.deleteEmptyAccount).run(
    "acc-revolut", "acc-revolut", "acc-revolut", "acc-revolut", "acc-revolut", "acc-revolut");
  assert.equal(r.changes, 1);
  assert.equal(db.prepare("SELECT * FROM accounts WHERE id='acc-revolut'").get(), undefined);
});

test("SQL.deleteEmptyAccount: NO borra una cuenta referenciada por una regla recurrente", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(`INSERT INTO recurring_rules (id,name,type,amount_cents,category_id,account_id,counter_account_id,frequency,due_day,due_month,is_shared,is_active,created_at,updated_at,deleted)
    VALUES ('rr-1','Alquiler','expense',50000,'cat-casa-alquiler','acc-revolut','','monthly',1,NULL,0,1,?,?,0)`).run(T, T);
  const r = db.prepare(SQL.deleteEmptyAccount).run(
    "acc-revolut", "acc-revolut", "acc-revolut", "acc-revolut", "acc-revolut", "acc-revolut");
  assert.equal(r.changes, 0);
  assert.ok(db.prepare("SELECT * FROM accounts WHERE id='acc-revolut'").get(), "la fila sobrevive");
});

test("SQL.deleteEmptyAccount: NO borra una cuenta referenciada por un objetivo", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(`INSERT INTO goals (id,name,type,target_amount_cents,target_months,target_pct,target_date,account_id,category_id,is_active,created_at,updated_at,deleted)
    VALUES ('goal-1','Fondo de emergencia','emergency_fund',300000,NULL,NULL,'','acc-revolut','',1,?,?,0)`).run(T, T);
  const r = db.prepare(SQL.deleteEmptyAccount).run(
    "acc-revolut", "acc-revolut", "acc-revolut", "acc-revolut", "acc-revolut", "acc-revolut");
  assert.equal(r.changes, 0);
  assert.ok(db.prepare("SELECT * FROM accounts WHERE id='acc-revolut'").get(), "la fila sobrevive");
});
