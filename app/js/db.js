import { t } from "./i18n/index.js";

let worker = null, seq = 0, deadError = null;
const pending = new Map();

// B3: traduce el código de error crudo del worker a un Error localizado. Pura y exportada
// para poder testear el mapeo sin un Worker real (no disponible en Node — ver db.test.mjs).
export function mapWorkerError(error) {
  if (error.startsWith("unknown_op:")) {
    return new Error(t("errors.worker.unknownOp", { op: error.slice("unknown_op:".length) }));
  }
  if (error === "not_initialized") return new Error(t("errors.worker.notInitialized"));
  return new Error(error);
}

function call(op, extra = {}) {
  // B3: el worker ya murió (worker.onerror) — rechazar de inmediato en vez de postear a un
  // worker roto y dejar la promesa colgada para siempre (botón de guardar bloqueado).
  if (deadError) return Promise.reject(deadError);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, op, ...extra });
  });
}

export function initDb({ seedLang } = {}) {
  deadError = null; // por si initDb se reintenta tras un fallo previo del worker
  worker = new Worker(new URL("./db-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const { id, error, ...rest } = e.data;
    const p = pending.get(id); if (!p) return;
    pending.delete(id);
    if (!error) { p.resolve(rest); return; }
    p.reject(mapWorkerError(error));
  };
  // Sin esto, un fallo al cargar/ejecutar db-worker.js (p.ej. 404) deja las
  // promesas pendientes (incluida la de init) colgadas para siempre.
  worker.onerror = (e) => {
    deadError = new Error(t("errors.worker.failed") + (e.message || t("errors.worker.unknownDetail")));
    for (const [id, p] of pending) { pending.delete(id); p.reject(deadError); }
  };
  return call("init", { seedLang });
}
export const query = (sql, params = []) => call("query", { sql, params }).then((r) => r.rows);
export const exec = (sql, params = []) => call("exec", { sql, params }).then(() => {});
export const execMany = (stmts) => call("execMany", { stmts }).then(() => {});
