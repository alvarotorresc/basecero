import sqlite3InitModule from "../vendor/sqlite-wasm/jswasm/sqlite3.mjs";
import { seedStatements } from "./seeds.js";

let db = null, storage = "opfs";

async function init() {
  const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: console.error });
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "basecero" });
    db = new pool.OpfsSAHPoolDb("/basecero.sqlite3");
  } catch (e) {
    console.warn("OPFS no disponible, usando memoria:", e);
    storage = "memory";
    db = new sqlite3.oo1.DB(":memory:", "c");
  }
  const schema = await (await fetch(new URL("./schema.sql", import.meta.url))).text();
  db.exec(schema);
  const seeded = db.selectValue("SELECT COUNT(*) FROM accounts");
  if (seeded === 0) {
    const now = new Date().toISOString().slice(0, 19) + "Z";
    db.exec("BEGIN");
    try {
      for (const { sql, rows } of seedStatements(now)) for (const r of rows) db.exec({ sql, bind: r });
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return { storage };
}

self.onmessage = async (e) => {
  const { id, op, sql, params, stmts } = e.data;
  try {
    if (op === "init") { const r = await init(); postMessage({ id, ...r }); return; }
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
      } catch (e) { db.exec("ROLLBACK"); throw e; }
      postMessage({ id, rows: [] }); return;
    }
    postMessage({ id, error: "op desconocida: " + op });
  } catch (err) { postMessage({ id, error: String(err && err.message || err) }); }
};
