// Escritura de límites por categoría y periodo (pantalla «Gasto por categoría»). Las funciones de
// repo (upsertBudget/deleteBudget) dependen del Worker y no son alcanzables en Node: se reproduce
// aquí su secuencia EXACTA sobre node:sqlite, mismo criterio que openNextPeriodReproduced en
// tests/app/periodos.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SQL } from "../../app/app/js/sql.js";
import { openDb, seedMinimal } from "./helpers.mjs";

const T1 = "2026-08-24T18:00:00Z";
const T2 = "2026-09-05T10:00:00Z";
let idSeq = 0;
const nextId = () => `bud-${++idSeq}`;

/** Reproduce EXACTAMENTE repo.upsertBudget: busca la fila viva de (periodo, categoría); si la hay
 *  la actualiza, y si no inserta una nueva. */
function upsertBudgetReproduced(db, periodId, categoryId, amountCents, now = T2) {
  const existing = db.prepare(SQL.budgetOfCategory).get(periodId, categoryId);
  if (existing) db.prepare(SQL.updateBudget).run(amountCents, now, existing.id);
  else db.prepare(SQL.insertBudget).run(nextId(), periodId, categoryId, amountCents, now, now);
}

/** Reproduce EXACTAMENTE repo.deleteBudget: borrado lógico por (periodo, categoría). */
function deleteBudgetReproduced(db, periodId, categoryId, now = T2) {
  db.prepare(SQL.softDeleteBudget).run(now, periodId, categoryId);
}

const allBudgets = (db) => db.prepare("SELECT * FROM budgets ORDER BY created_at, id").all();

test("budgetOfCategory: encuentra la fila viva de (periodo, categoría) y ninguna otra", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(SQL.insertBudget).run("bud-casa", "per-1", "cat-casa", 45000, T1, T1);

  assert.equal(db.prepare(SQL.budgetOfCategory).get("per-1", "cat-casa").amount_cents, 45000);
  assert.equal(db.prepare(SQL.budgetOfCategory).get("per-1", "cat-nomina"), undefined, "otra categoría: nada");
  assert.equal(db.prepare(SQL.budgetOfCategory).get("per-otro", "cat-casa"), undefined, "otro periodo: nada");
});

test("upsertBudget: sin fila previa INSERTA una nueva, y con fila viva la ACTUALIZA sin duplicar", () => {
  const db = openDb();
  seedMinimal(db);

  upsertBudgetReproduced(db, "per-1", "cat-casa", 45000);
  let rows = allBudgets(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount_cents, 45000);
  assert.equal(rows[0].deleted, 0);

  upsertBudgetReproduced(db, "per-1", "cat-casa", 30000, "2026-09-06T11:00:00Z");
  rows = allBudgets(db);
  assert.equal(rows.length, 1, "actualiza la misma fila: no se duplica el límite de una categoría");
  assert.equal(rows[0].amount_cents, 30000);
  assert.equal(rows[0].updated_at, "2026-09-06T11:00:00Z", "updated_at se refresca");
  assert.equal(rows[0].created_at, T2, "created_at NO se toca");
});

test("deleteBudget: borrado lógico — la fila sigue en la tabla pero budgetsOfPeriod ya no la devuelve", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(SQL.insertBudget).run("bud-casa", "per-1", "cat-casa", 45000, T1, T1);

  deleteBudgetReproduced(db, "per-1", "cat-casa");

  const rows = allBudgets(db);
  assert.equal(rows.length, 1, "borrado LÓGICO: la fila sigue ahí para el round-trip del xlsx");
  assert.equal(rows[0].deleted, 1);
  assert.equal(rows[0].updated_at, T2);
  assert.deepEqual(db.prepare(SQL.budgetsOfPeriod).all("per-1"), [], "budgetsOfPeriod solo trae las vivas");
});

test("deleteBudget: es idempotente y no toca otras filas", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(SQL.insertBudget).run("bud-casa", "per-1", "cat-casa", 45000, T1, T1);
  db.prepare(SQL.insertBudget).run("bud-nomina", "per-1", "cat-nomina", 10000, T1, T1);

  deleteBudgetReproduced(db, "per-1", "cat-casa");
  deleteBudgetReproduced(db, "per-1", "cat-casa", "2026-09-07T09:00:00Z");
  deleteBudgetReproduced(db, "per-1", "cat-no-existe");

  const rows = Object.fromEntries(allBudgets(db).map((r) => [r.id, r]));
  assert.equal(rows["bud-casa"].deleted, 1);
  assert.equal(rows["bud-casa"].updated_at, T2, "el segundo borrado no vuelve a tocar la fila ya borrada");
  assert.equal(rows["bud-nomina"].deleted, 0, "la otra categoría no se toca");
});

test("upsertBudget después de un delete: crea una fila NUEVA activa y deja la borrada como estaba", () => {
  const db = openDb();
  seedMinimal(db);

  upsertBudgetReproduced(db, "per-1", "cat-casa", 45000);
  deleteBudgetReproduced(db, "per-1", "cat-casa");
  upsertBudgetReproduced(db, "per-1", "cat-casa", 20000, "2026-09-08T08:00:00Z");

  const rows = allBudgets(db);
  assert.equal(rows.length, 2, "la borrada se queda; la nueva es otra fila");
  assert.equal(rows.filter((r) => r.deleted === 0).length, 1, "solo UNA fila viva por (periodo, categoría)");
  const viva = db.prepare(SQL.budgetsOfPeriod).all("per-1");
  assert.deepEqual(viva.map((r) => r.amount_cents), [20000]);
});

test("budgetsOfPeriod: ignora los límites cuya categoría está archivada o borrada (no pueden sumar en ningún total)", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(`INSERT INTO categories (id,name,parent_id,flow,need_type,display_order,is_archived,created_at,updated_at,deleted)
    VALUES ('cat-ocio','Ocio','','expense','want',5,1,?,?,0)`).run(T1, T1);
  db.prepare(`INSERT INTO categories (id,name,parent_id,flow,need_type,display_order,is_archived,created_at,updated_at,deleted)
    VALUES ('cat-viejo','Viejo','','expense','want',6,0,?,?,1)`).run(T1, T1);
  db.prepare(SQL.insertBudget).run("bud-casa", "per-1", "cat-casa", 45000, T1, T1);
  db.prepare(SQL.insertBudget).run("bud-ocio", "per-1", "cat-ocio", 12000, T1, T1);
  db.prepare(SQL.insertBudget).run("bud-viejo", "per-1", "cat-viejo", 9000, T1, T1);

  assert.deepEqual(db.prepare(SQL.budgetsOfPeriod).all("per-1").map((b) => b.id), ["bud-casa"],
    "la archivada y la borrada no salen: si salieran, el disponible de Inicio descontaría un límite invisible");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM budgets WHERE deleted=0").get().n, 3,
    "las tres filas siguen VIVAS en la tabla: desarchivar la categoría recupera su límite tal cual");
});

test("budgetsOfPeriod y budgetOfCategory: con dos filas vivas duplicadas gana la de updated_at más reciente", () => {
  const db = openDb();
  seedMinimal(db);
  // Estado solo alcanzable importando una hoja editada a mano: upsertBudget actualiza la fila que ya
  // hay, nunca crea una segunda viva para la misma pareja.
  db.prepare(SQL.insertBudget).run("bud-vieja", "per-1", "cat-casa", 45000, T1, T1);
  db.prepare(SQL.insertBudget).run("bud-nueva", "per-1", "cat-casa", 30000, T1, T2);

  assert.equal(db.prepare(SQL.budgetOfCategory).get("per-1", "cat-casa").id, "bud-nueva");
  assert.deepEqual(db.prepare(SQL.budgetsOfPeriod).all("per-1").map((b) => b.id), ["bud-nueva", "bud-vieja"],
    "la más reciente PRIMERO: budgetMap se queda con la primera de cada categoría, el mismo límite que se edita");
});
