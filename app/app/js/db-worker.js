import sqlite3InitModule from "../vendor/sqlite-wasm/jswasm/sqlite3.mjs";
import { seedStatements } from "./seeds.js";
import { classifyStorageFailure } from "./format.js";
import { pendingMigrations } from "./migrations.js";

let db = null, storage = "opfs";

async function init(seedLang = "es") {
  const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: console.error });
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "basecero" });
    db = new pool.OpfsSAHPoolDb("/basecero.sqlite3");
  } catch (e) {
    console.warn("OPFS no disponible, usando memoria:", e);
    // "locked" = otra pestaña/PWA tiene la BD abierta (recuperable); el resto, sin soporte real.
    storage = classifyStorageFailure(e) === "locked" ? "locked" : "memory";
    db = new sqlite3.oo1.DB(":memory:", "c");
  }
  const schema = await (await fetch(new URL("./schema.sql", import.meta.url))).text();
  db.exec(schema);
  // Migraciones de una BD ya existente (schema.sql no altera tablas ya creadas) — ver migrations.js.
  // PRAGMA table_info se lee con la MISMA forma que el op "query" de este worker (db-worker.js:65).
  // Va DESPUÉS del esquema (la tabla meta tiene que existir) y ANTES de las semillas.
  const cols = [];
  db.exec({ sql: "PRAGMA table_info(transactions)", rowMode: "object", resultRows: cols });
  const stmts = pendingMigrations({ transactions: cols.map((c) => c.name) });
  db.exec("BEGIN");
  try {
    for (const s of stmts) db.exec({ sql: s.sql, bind: s.bind });
    db.exec("COMMIT");
  } catch (e) {
    // Mismo guard B5 que el bloque de semillas: un ROLLBACK sin transacción activa no debe
    // enmascarar el error real.
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  }
  const seeded = db.selectValue("SELECT COUNT(*) FROM categories");
  if (seeded === 0) {
    const now = new Date().toISOString().slice(0, 19) + "Z";
    db.exec("BEGIN");
    try {
      for (const { sql, rows } of seedStatements(now, seedLang)) for (const r of rows) db.exec({ sql, bind: r });
      db.exec("COMMIT");
    } catch (e) {
      // B5: si el fallo original ya provocó un auto-rollback de SQLite (p.ej. error I/O), este
      // ROLLBACK explícito lanza "no transaction is active" y sustituye el mensaje real — se
      // ignora su propio error y se relanza SIEMPRE el original.
      try { db.exec("ROLLBACK"); } catch {}
      throw e;
    }
  }
  return { storage };
}

self.onmessage = async (e) => {
  const { id, op, sql, params, stmts, seedLang } = e.data;
  try {
    // B3: una consulta que llega durante el init async (aún no asignó `db`) o tras un init
    // fallido daba un TypeError crudo ("Cannot read properties of null"); ahora responde un
    // código que db.js traduce como los demás (unknown_op:, ver mapWorkerError).
    if (op !== "init" && db === null) { postMessage({ id, error: "not_initialized" }); return; }
    if (op === "init") { const r = await init(seedLang); postMessage({ id, ...r }); return; }
    if (op === "query") {
      const rows = [];
      db.exec({ sql, bind: params ?? [], rowMode: "object", resultRows: rows });
      postMessage({ id, rows }); return;
    }
    if (op === "exec") { db.exec({ sql, bind: params ?? [] }); postMessage({ id, rows: [] }); return; }
    if (op === "execMany") {
      db.exec("BEGIN");
      try {
        for (const s of stmts) db.exec({ sql: s.sql, bind: s.bind ?? [] });
        db.exec("COMMIT");
      } catch (e) {
        // B5: mismo guard que en init() — no dejar que un ROLLBACK sin transacción activa
        // enmascare el error real del statement que falló.
        try { db.exec("ROLLBACK"); } catch {}
        throw e;
      }
      postMessage({ id, rows: [] }); return;
    }
    postMessage({ id, error: "unknown_op:" + op });
  } catch (err) { postMessage({ id, error: String(err && err.message || err) }); }
};
