import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION, ACCEPTED_SCHEMA_VERSIONS, MIGRATIONS, pendingMigrations } from "../../app/app/js/migrations.js";
import { openDb, OLD_TRANSACTIONS_DDL } from "./helpers.mjs";

const T = "2026-08-24T18:00:00Z";

/** BD tal como la deja la versión anterior: meta con schema_version='1' y transactions sin paid_by. */
function oldDb(version = "1") {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.prepare(`INSERT INTO meta (key,value) VALUES ('schema_version',?),('currency','EUR')`).run(version);
  db.exec(OLD_TRANSACTIONS_DDL);
  return db;
}

const colNames = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
const versionOf = (db) => db.prepare("SELECT value FROM meta WHERE key='schema_version'").get().value;

/** Aplica los statements igual que el bloque de migraciones de db-worker.js (BEGIN/COMMIT con el
 *  guard B5): el Worker real no es alcanzable en Node. Devuelve los statements aplicados. */
function runMigrations(db) {
  const stmts = pendingMigrations({ transactions: colNames(db, "transactions") });
  db.exec("BEGIN");
  try {
    for (const s of stmts) (s.bind?.length ? db.prepare(s.sql).run(...s.bind) : db.exec(s.sql));
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  }
  return stmts;
}

const insOld = (db, id) => db.prepare(`INSERT INTO transactions
  (id,date,period_id,type,amount_cents,account_id,status,created_at,updated_at,deleted)
  VALUES (?,'2026-08-20','per-1','expense',1000,'acc-n26','pending',?,?,0)`).run(id, T, T);

test("migración a v2: una BD sin paid_by recibe la columna, el default y la versión 2", () => {
  const db = oldDb();
  insOld(db, "t-vieja");

  const stmts = runMigrations(db);
  assert.equal(stmts.length, 2, "el ALTER TABLE + el upsert de la versión");

  const col = db.prepare("PRAGMA table_info(transactions)").all().find((c) => c.name === "paid_by");
  assert.ok(col, "la columna existe tras el ALTER");
  assert.equal(col.notnull, 1, "sigue siendo NOT NULL");
  assert.equal(col.dflt_value, "'me'");
  assert.equal(db.prepare("SELECT paid_by FROM transactions WHERE id='t-vieja'").get().paid_by, "me",
    "las filas preexistentes quedan en 'me': el mundo que describe una BD v1");
  assert.equal(versionOf(db), "2");
});

test("migración a v2: el CHECK sigue vivo tras el ALTER (no hay que rehacer la tabla)", () => {
  const db = oldDb();
  runMigrations(db);
  assert.throws(() => db.prepare(`INSERT INTO transactions
    (id,date,period_id,type,amount_cents,account_id,paid_by,status,created_at,updated_at,deleted)
    VALUES ('t-mala','2026-08-20','per-1','expense',1000,'acc-n26','ambos','pending',?,?,0)`).run(T, T),
    /CHECK constraint failed/);
});

test("migración a v2: idempotente — la segunda pasada solo reescribe la versión", () => {
  const db = oldDb();
  runMigrations(db);
  const colsTrasPrimera = colNames(db, "transactions");

  const stmts2 = runMigrations(db);
  assert.equal(stmts2.length, 1, "la segunda vez solo queda el upsert de meta.schema_version");
  assert.deepEqual(colNames(db, "transactions"), colsTrasPrimera, "no se añade otra columna");
  assert.equal(versionOf(db), "2");
});

test("migración a v2: una BD nueva de schema.sql no necesita ninguna migración", () => {
  const db = openDb();
  const stmts = pendingMigrations({ transactions: colNames(db, "transactions") });
  assert.equal(stmts.length, 1, "solo el upsert de la versión: la columna ya viene en schema.sql");
  runMigrations(db);
  assert.equal(versionOf(db), "2");
});

test("migración a v2: la versión se recoloca aunque meta.schema_version esté pisada por un import", () => {
  // Estado exacto que dejaría importar una hoja v1 en una BD ya migrada: la columna está, pero
  // meta.schema_version volvió a '1'. `needed` mira PRAGMA table_info, no ese texto.
  const db = openDb();
  db.prepare("UPDATE meta SET value='1' WHERE key='schema_version'").run();
  const stmts = runMigrations(db);
  assert.equal(stmts.length, 1, "no se intenta añadir una columna que ya está");
  assert.equal(versionOf(db), "2");
});

test("MIGRATIONS está ordenada por versión y la última es SCHEMA_VERSION", () => {
  const versions = MIGRATIONS.map((m) => Number(m.version));
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b));
  assert.equal(MIGRATIONS.at(-1).version, SCHEMA_VERSION);
});

// Item 3 (final fix wave): SCHEMA_VERSION debe estar siempre entre las versiones que xlsx.js acepta
// importar (si no, una hoja recién exportada de esta misma app se rechazaría a sí misma al
// reimportarla), y la lista debe leerse ya ordenada ascendente (como strings, que es como se
// compara/renderiza en todo lo demás) sin depender de que alguien la mantenga a mano en ese orden.
test("ACCEPTED_SCHEMA_VERSIONS incluye SCHEMA_VERSION y está ordenada ascendente como strings", () => {
  assert.ok(ACCEPTED_SCHEMA_VERSIONS.includes(SCHEMA_VERSION));
  assert.deepEqual(ACCEPTED_SCHEMA_VERSIONS, [...ACCEPTED_SCHEMA_VERSIONS].sort());
  assert.deepEqual(ACCEPTED_SCHEMA_VERSIONS, ["1", "2"]);
});
