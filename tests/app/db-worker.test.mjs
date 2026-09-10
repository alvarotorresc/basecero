// db-worker.js corre en un Worker real (self.onmessage, sqlite3InitModule wasm, OPFS) — no
// alcanzable en Node sin mockear ese entorno (mismo motivo que n26.test.mjs documenta para
// runImportPipeline y periodos.test.mjs para el execMany de openNextPeriod). Este fichero
// reproduce a mano, LÍNEA A LÍNEA, los dos fragmentos exactos que B3/B5 tocan en
// app/js/db-worker.js, para poder ejercer su lógica de verdad sin el Worker:
//   - dispatchOp: el guard `db === null` del self.onmessage (B3a).
//   - execManyGuarded/execManySeedGuarded: el `catch { try{ROLLBACK}catch{} throw e; }` de
//     execMany (línea ~52) y de la transacción de semillas en init() (línea ~23) (B5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "../../app/app/js/migrations.js";

/** Reproduce el guard añadido al principio de self.onmessage en db-worker.js:
 *    if (op !== "init" && db === null) { postMessage({ id, error: "not_initialized" }); return; }
 *  `db` se pasa como parámetro (en vez de leer la variable de módulo) para poder probarlo con
 *  null sin necesitar sqlite3InitModule. */
function dispatchOp(db, op) {
  if (op !== "init" && db === null) return { error: "not_initialized" };
  return { ok: true };
}

test("B3a: mensaje que no es init con db=null responde el código not_initialized, no un TypeError", () => {
  assert.deepEqual(dispatchOp(null, "query"), { error: "not_initialized" });
  assert.deepEqual(dispatchOp(null, "exec"), { error: "not_initialized" });
  assert.deepEqual(dispatchOp(null, "execMany"), { error: "not_initialized" });
});

test("B3a: op=init pasa el guard aunque db sea null (init es quien lo asigna)", () => {
  assert.deepEqual(dispatchOp(null, "init"), { ok: true });
});

test("B3a: con db ya asignada, cualquier op pasa el guard", () => {
  const fakeDb = {};
  assert.deepEqual(dispatchOp(fakeDb, "query"), { ok: true });
});

/** Reproduce EXACTAMENTE el bloque BEGIN/loop/COMMIT/catch de execMany en db-worker.js
 *  ANTES del fix de B5 (ROLLBACK explícito sin guarda). */
function execManyUnguarded(db, stmts) {
  db.exec("BEGIN");
  try {
    for (const s of stmts) db.prepare(s.sql).run(...(s.bind ?? []));
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

/** Reproduce el mismo bloque DESPUÉS del fix de B5 (mismo patrón en init() línea ~23). */
function execManyGuarded(db, stmts) {
  db.exec("BEGIN");
  try {
    for (const s of stmts) db.prepare(s.sql).run(...(s.bind ?? []));
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  }
}

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE t (x INTEGER)");
  return db;
}

// Statements diseñados para reproducir determinísticamente el escenario del hallazgo: la
// transacción ya quedó sin BEGIN activo (aquí, un ROLLBACK explícito en medio del lote — en
// producción sería un auto-rollback de SQLite tras un error I/O) cuando llega el statement que
// falla de verdad. El ROLLBACK explícito del catch entonces choca con "no transaction is active".
const STMTS_TXN_ALREADY_CLOSED = [
  { sql: "ROLLBACK" },
  { sql: "INSERT INTO nonexistent_table VALUES (1)" },
];

test("B5 (reproduce el bug): sin guarda, el ROLLBACK del catch enmascara el error original", () => {
  assert.throws(
    () => execManyUnguarded(freshDb(), STMTS_TXN_ALREADY_CLOSED),
    (e) => {
      assert.match(e.message, /transaction/i, `esperaba el error del ROLLBACK, no: ${e.message}`);
      assert.doesNotMatch(e.message, /nonexistent_table/, "el error real quedó enmascarado");
      return true;
    },
  );
});

test("B5 (fix): con guarda, el error original (no such table) llega intacto al llamante", () => {
  assert.throws(
    () => execManyGuarded(freshDb(), STMTS_TXN_ALREADY_CLOSED),
    (e) => {
      assert.match(e.message, /nonexistent_table/, `esperaba el error original, no: ${e.message}`);
      return true;
    },
  );
});

test("B5 (fix): el camino feliz no cambia — un execMany sin errores sigue committeando", () => {
  const db = freshDb();
  execManyGuarded(db, [{ sql: "INSERT INTO t VALUES (?)", bind: [1] }, { sql: "INSERT INTO t VALUES (?)", bind: [2] }]);
  const rows = db.prepare("SELECT x FROM t ORDER BY x").all();
  assert.deepEqual(rows.map((r) => r.x), [1, 2]);
});

/** Reproduce LÍNEA A LÍNEA el bucle de db-worker.js:27-33 (colsByTable), que hasta esta PR nunca
 *  se había ejercido con más de una tabla (MIGRATIONS solo tenía entradas de "transactions").
 *  Suscripciones (v3) añade una entrada de "recurring_rules", así que este test fija: se consulta
 *  UNA vez cada tabla DISTINTA de MIGRATIONS, y ninguna que MIGRATIONS no declare (goals, aquí,
 *  representa cualquier tabla ajena a las migraciones — no debe consultarse). */
test("init: el bucle del PRAGMA consulta una vez cada tabla que MIGRATIONS declara, ninguna más", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.exec("CREATE TABLE transactions (id TEXT, paid_by TEXT)");
  db.exec("CREATE TABLE recurring_rules (id TEXT, is_subscription INTEGER)");
  db.exec("CREATE TABLE goals (id TEXT)"); // tabla real, pero NINGUNA migración la declara

  const queried = [];
  const colsByTable = {};
  for (const table of [...new Set(MIGRATIONS.map((m) => m.table))]) {
    queried.push(table);
    const cols = [];
    // rowMode:"object" no existe en node:sqlite: se reproduce con .all() + .map(), equivalente
    // a resultRows del sqlite3 wasm real para lo que este test comprueba (qué tablas se consultan).
    for (const c of db.prepare(`PRAGMA table_info(${table})`).all()) cols.push(c.name);
    colsByTable[table] = cols;
  }

  assert.deepEqual([...new Set(queried)].sort(), ["recurring_rules", "transactions"]);
  assert.equal(queried.length, new Set(queried).size, "cada tabla se consulta EXACTAMENTE una vez");
  assert.ok(colsByTable.transactions.includes("paid_by"));
  assert.ok(colsByTable.recurring_rules.includes("is_subscription"));
  assert.ok(!("goals" in colsByTable), "una tabla que MIGRATIONS no declara nunca se consulta");
});
