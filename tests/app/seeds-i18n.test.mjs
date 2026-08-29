import { test } from "node:test";
import assert from "node:assert/strict";
import { SQL } from "../../app/js/sql.js";
import { seedStatements, SEED_NAMES } from "../../app/js/seeds.js";
import { openDb } from "./helpers.mjs";

const T = "2026-08-24T18:00:00Z";
const T2 = "2026-08-24T19:00:00Z";
const T3 = "2026-08-24T20:00:00Z";

function seed(db, now, lang) {
  for (const { sql, rows } of seedStatements(now, lang))
    for (const r of rows) db.prepare(sql).run(...r);
}

// Reproduce EXACTAMENTE lo que hace repo.retranslateSeedNames (mismo SQL.retranslateCategory,
// mismo bind: cada UPDATE matchea el nombre semilla del OTRO idioma soportado, no un "fromLang"
// explícito — fix round 1, idempotente/basada en estado), pero contra node:sqlite en vez de
// execMany/db.js (que exige el Worker real) — ver nota del brief de Task 6: "the real
// seedStatements + the real sql.js statement".
function retranslate(db, now, toLang) {
  const otherLang = toLang === "es" ? "en" : "es";
  const stmt = db.prepare(SQL.retranslateCategory);
  for (const [id, names] of Object.entries(SEED_NAMES)) {
    stmt.run(names[toLang], now, id, names[otherLang]);
  }
}

const namesById = (db) =>
  Object.fromEntries(db.prepare("SELECT id, name FROM categories").all().map((r) => [r.id, r.name]));

test("seedStatements(now, \"en\"): siembra 41 categorías con nombres en inglés", () => {
  const db = openDb();
  seed(db, T, "en");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM categories").get().c, 41);
  assert.equal(db.prepare("SELECT name FROM categories WHERE id='cat-casa'").get().name, "Home");
  assert.equal(db.prepare("SELECT name FROM categories WHERE id='cat-alimentacion'").get().name, "Groceries");
  assert.equal(db.prepare("SELECT name FROM categories WHERE id='cat-nomina'").get().name, "Income");
});

test("retranslateSeedNames (SQL): es -> en cambia los 41 nombres semilla", () => {
  const db = openDb();
  seed(db, T, "es");
  retranslate(db, T2, "en");
  const names = namesById(db);
  for (const [id, { en }] of Object.entries(SEED_NAMES)) assert.equal(names[id], en, id);
});

test("retranslateSeedNames (SQL): una categoría renombrada por el usuario no se toca (el resto del lote sí)", () => {
  const db = openDb();
  seed(db, T, "es");
  db.prepare("UPDATE categories SET name='Mi casa' WHERE id='cat-casa'").run();
  const before = db.prepare("SELECT updated_at FROM categories WHERE id='cat-casa'").get().updated_at;
  retranslate(db, T2, "en");
  const row = db.prepare("SELECT name, updated_at FROM categories WHERE id='cat-casa'").get();
  assert.equal(row.name, "Mi casa");
  assert.equal(row.updated_at, before);
  // El resto del lote SÍ se retradujo en el mismo paso — la fila renombrada no bloqueó el resto.
  assert.equal(db.prepare("SELECT name FROM categories WHERE id='cat-casa-luz'").get().name, SEED_NAMES["cat-casa-luz"].en);
});

test("retranslateSeedNames (SQL): es -> en -> es vuelve a los nombres originales", () => {
  const db = openDb();
  seed(db, T, "es");
  retranslate(db, T2, "en");
  retranslate(db, T3, "es");
  const names = namesById(db);
  for (const [id, { es }] of Object.entries(SEED_NAMES)) assert.equal(names[id], es, id);
});

// Fix round 1 (gap cerrado): antes, saltarse la retraducción cuando "el idioma no cambiaba"
// (comparado contra prevLang) dejaba una BD sembrada en es sin retraducir si activeLang() YA
// resolvía a en (nada que "cambiar" desde el punto de vista de la UI). Ahora el guard vive en el
// propio UPDATE (estado real de cada fila, no la transición de idioma): llamar dos veces seguidas
// con el mismo toLang debe dejar la segunda llamada como no-op total, incluida updated_at.
test("retranslateSeedNames (SQL): idempotente — dos llamadas seguidas al MISMO toLang, la segunda no cambia nada", () => {
  const db = openDb();
  seed(db, T, "es");
  retranslate(db, T2, "en"); // BD sembrada en es, retraducida a en (aunque nadie "cambiara" de idioma)
  const afterFirst = namesById(db);
  for (const [id, { en }] of Object.entries(SEED_NAMES)) assert.equal(afterFirst[id], en, id);
  const updatedAtAfterFirst = db.prepare("SELECT updated_at FROM categories WHERE id='cat-casa'").get().updated_at;
  assert.equal(updatedAtAfterFirst, T2);

  retranslate(db, T3, "en"); // mismo toLang otra vez: todas las filas ya están en "en", nada matchea
  assert.deepEqual(namesById(db), afterFirst);
  const updatedAtAfterSecond = db.prepare("SELECT updated_at FROM categories WHERE id='cat-casa'").get().updated_at;
  assert.equal(updatedAtAfterSecond, T2, "el segundo retranslate no debe tocar updated_at: ninguna fila matchea");
});
