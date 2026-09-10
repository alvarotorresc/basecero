import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION, ACCEPTED_SCHEMA_VERSIONS, MIGRATIONS, pendingMigrations } from "../../app/app/js/migrations.js";
import { readFileSync } from "node:fs";
import { openDb, OLD_TRANSACTIONS_DDL, V2_RULES_DDL } from "./helpers.mjs";

const T = "2026-08-24T18:00:00Z";
const SCHEMA_SQL = readFileSync(new URL("../../app/app/js/schema.sql", import.meta.url), "utf8");

/** BD tal como la deja la versión anterior a esta PR: meta con schema_version='1', transactions
 *  sin paid_by y recurring_rules sin is_subscription/cancelled_at. */
function oldDb(version = "1") {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.prepare(`INSERT INTO meta (key,value) VALUES ('schema_version',?),('currency','EUR')`).run(version);
  db.exec(OLD_TRANSACTIONS_DDL);
  db.exec(V2_RULES_DDL);
  return db;
}

/** BD "v2" real: transactions YA tiene paid_by (schema.sql fresco) pero recurring_rules todavía
 *  no tiene is_subscription/cancelled_at (V2_RULES_DDL, creada ANTES que schema.sql: su CREATE
 *  TABLE IF NOT EXISTS la deja intacta). Es el estado exacto de una BD ya migrada a v2 por
 *  feat/registro-v2 que todavía no vio esta PR. */
function v2Db() {
  const db = new DatabaseSync(":memory:");
  db.exec(V2_RULES_DDL);
  db.exec(SCHEMA_SQL);
  return db;
}

const colNames = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
const versionOf = (db) => db.prepare("SELECT value FROM meta WHERE key='schema_version'").get().value;

/** Aplica los statements igual que el bloque de migraciones de db-worker.js (BEGIN/COMMIT con el
 *  guard B5): el Worker real no es alcanzable en Node. colsByTable se construye iterando las
 *  tablas DISTINTAS que declara MIGRATIONS (db-worker.js:28), no un mapa hardcodeado: así este
 *  helper migra cualquier tabla nueva sin que alguien tenga que acordarse de tocarlo aquí.
 *  Devuelve los statements aplicados. */
function runMigrations(db) {
  const colsByTable = {};
  for (const table of [...new Set(MIGRATIONS.map((m) => m.table))]) colsByTable[table] = colNames(db, table);
  const stmts = pendingMigrations(colsByTable);
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

test("migración: una BD sin paid_by recibe la columna, el default y salta a la versión actual", () => {
  const db = oldDb();
  insOld(db, "t-vieja");

  const stmts = runMigrations(db);
  assert.equal(stmts.length, 4, "el ALTER de paid_by + los dos ALTER de recurring_rules + el upsert de la versión");

  const col = db.prepare("PRAGMA table_info(transactions)").all().find((c) => c.name === "paid_by");
  assert.ok(col, "la columna existe tras el ALTER");
  assert.equal(col.notnull, 1, "sigue siendo NOT NULL");
  assert.equal(col.dflt_value, "'me'");
  assert.equal(db.prepare("SELECT paid_by FROM transactions WHERE id='t-vieja'").get().paid_by, "me",
    "las filas preexistentes quedan en 'me': el mundo que describe una BD v1");
  assert.equal(versionOf(db), SCHEMA_VERSION);
});

test("v3: una BD v1 salta a la 3 de una vez (paid_by + las dos columnas de recurring_rules juntas)", () => {
  const db = oldDb();
  insOld(db, "t-vieja");

  runMigrations(db);

  const rrCols = db.prepare("PRAGMA table_info(recurring_rules)").all();
  const isSub = rrCols.find((c) => c.name === "is_subscription");
  const cancelledAt = rrCols.find((c) => c.name === "cancelled_at");
  assert.ok(isSub, "is_subscription existe tras el ALTER");
  assert.equal(isSub.notnull, 1);
  assert.equal(isSub.dflt_value, "0");
  assert.ok(cancelledAt, "cancelled_at existe tras el ALTER");
  assert.equal(cancelledAt.notnull, 1);
  assert.equal(cancelledAt.dflt_value, "''");
  assert.equal(db.prepare("SELECT paid_by FROM transactions WHERE id='t-vieja'").get().paid_by, "me");
  assert.equal(versionOf(db), "3");
});

test("v3: una BD con recurring_rules sin las columnas las recibe con su default y la versión 3 (dos ALTER + el upsert)", () => {
  const db = v2Db();
  const stmts = runMigrations(db);
  assert.equal(stmts.length, 3, "los dos ALTER de recurring_rules + el upsert: paid_by ya estaba");

  const rrCols = db.prepare("PRAGMA table_info(recurring_rules)").all();
  const isSub = rrCols.find((c) => c.name === "is_subscription");
  const cancelledAt = rrCols.find((c) => c.name === "cancelled_at");
  assert.ok(isSub);
  assert.equal(isSub.notnull, 1);
  assert.equal(isSub.dflt_value, "0");
  assert.ok(cancelledAt);
  assert.equal(cancelledAt.notnull, 1);
  assert.equal(cancelledAt.dflt_value, "''");
  assert.equal(versionOf(db), "3");
});

test("v3: idempotente — la segunda pasada solo reescribe la versión", () => {
  const db = v2Db();
  runMigrations(db);
  const colsTrasPrimera = colNames(db, "recurring_rules");

  const stmts2 = runMigrations(db);
  assert.equal(stmts2.length, 1, "la segunda vez solo queda el upsert de meta.schema_version");
  assert.deepEqual(colNames(db, "recurring_rules"), colsTrasPrimera, "no se añaden más columnas");
  assert.equal(versionOf(db), "3");
});

test("migración a v2: el CHECK sigue vivo tras el ALTER (no hay que rehacer la tabla)", () => {
  const db = oldDb();
  runMigrations(db);
  assert.throws(() => db.prepare(`INSERT INTO transactions
    (id,date,period_id,type,amount_cents,account_id,paid_by,status,created_at,updated_at,deleted)
    VALUES ('t-mala','2026-08-20','per-1','expense',1000,'acc-n26','ambos','pending',?,?,0)`).run(T, T),
    /CHECK constraint failed/);
});

test("migración a v2: idempotente (transactions) — la segunda pasada no añade otra columna", () => {
  const db = oldDb();
  runMigrations(db);
  const colsTrasPrimera = colNames(db, "transactions");

  const stmts2 = runMigrations(db);
  assert.equal(stmts2.length, 1, "la segunda vez solo queda el upsert de meta.schema_version");
  assert.deepEqual(colNames(db, "transactions"), colsTrasPrimera, "no se añade otra columna");
  assert.equal(versionOf(db), "3");
});

test("una BD nueva de schema.sql no necesita ninguna migración", () => {
  const db = openDb();
  const stmts = pendingMigrations({
    transactions: colNames(db, "transactions"),
    recurring_rules: colNames(db, "recurring_rules"),
  });
  assert.equal(stmts.length, 1, "solo el upsert de la versión: las columnas ya vienen en schema.sql");
  runMigrations(db);
  assert.equal(versionOf(db), "3");
});

test("migración a v2: la versión se recoloca aunque meta.schema_version esté pisada por un import", () => {
  // Estado exacto que dejaría importar una hoja v1 en una BD ya migrada: la columna está, pero
  // meta.schema_version volvió a '1'. `needed` mira PRAGMA table_info, no ese texto.
  const db = openDb();
  db.prepare("UPDATE meta SET value='1' WHERE key='schema_version'").run();
  const stmts = runMigrations(db);
  assert.equal(stmts.length, 1, "no se intenta añadir una columna que ya está");
  assert.equal(versionOf(db), "3");
});

test("MIGRATIONS está ordenada por versión y la última es SCHEMA_VERSION", () => {
  const versions = MIGRATIONS.map((m) => Number(m.version));
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b));
  assert.equal(MIGRATIONS.at(-1).version, SCHEMA_VERSION);
});

// Guarda que convierte en rojo una colisión de merge con registro-v2-extras (spec §4.2): el test
// de orden de arriba pasaría EN SILENCIO con dos entradas etiquetadas "3" ([2,3,3] está ordenado y
// la última es "3"). Sin esta aserción de unicidad, dos ramas reclamando la misma versión se cuela.
test("MIGRATIONS: las versiones son ÚNICAS", () => {
  const versions = MIGRATIONS.map((m) => m.version);
  assert.equal(new Set(versions).size, versions.length, `versiones repetidas: ${versions.join(",")}`);
});

// Item 3 (final fix wave): SCHEMA_VERSION debe estar siempre entre las versiones que xlsx.js acepta
// importar (si no, una hoja recién exportada de esta misma app se rechazaría a sí misma al
// reimportarla), y la lista debe leerse ya ordenada ascendente (como strings, que es como se
// compara/renderiza en todo lo demás) sin depender de que alguien la mantenga a mano en ese orden.
test("ACCEPTED_SCHEMA_VERSIONS incluye SCHEMA_VERSION y está ordenada ascendente como strings", () => {
  assert.ok(ACCEPTED_SCHEMA_VERSIONS.includes(SCHEMA_VERSION));
  assert.deepEqual(ACCEPTED_SCHEMA_VERSIONS, [...ACCEPTED_SCHEMA_VERSIONS].sort());
  assert.deepEqual(ACCEPTED_SCHEMA_VERSIONS, ["1", "2", "3"]);
});
