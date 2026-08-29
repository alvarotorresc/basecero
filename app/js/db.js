import { t } from "./i18n/index.js";

let worker = null, seq = 0;
const pending = new Map();

function call(op, extra = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, op, ...extra });
  });
}

export function initDb({ seedLang } = {}) {
  worker = new Worker(new URL("./db-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const { id, error, ...rest } = e.data;
    const p = pending.get(id); if (!p) return;
    pending.delete(id);
    if (!error) { p.resolve(rest); return; }
    const err = error.startsWith("unknown_op:")
      ? new Error(t("errors.worker.unknownOp", { op: error.slice("unknown_op:".length) }))
      : new Error(error);
    p.reject(err);
  };
  // Sin esto, un fallo al cargar/ejecutar db-worker.js (p.ej. 404) deja las
  // promesas pendientes (incluida la de init) colgadas para siempre.
  worker.onerror = (e) => {
    const err = new Error(t("errors.worker.failed") + (e.message || "desconocido"));
    for (const [id, p] of pending) { pending.delete(id); p.reject(err); }
  };
  return call("init", { seedLang });
}
export const query = (sql, params = []) => call("query", { sql, params }).then((r) => r.rows);
export const exec = (sql, params = []) => call("exec", { sql, params }).then(() => {});
export const execMany = (stmts) => call("execMany", { stmts }).then(() => {});
