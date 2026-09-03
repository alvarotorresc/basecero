import { t } from "./i18n/index.js";
import { UserError } from "./errors.js";

let worker = null, seq = 0, deadError = null;
const pending = new Map();

// B3: traduce el código de error crudo del worker a un Error localizado. Pura y exportada
// para poder testear el mapeo sin un Worker real (no disponible en Node — ver db.test.mjs).
export function mapWorkerError(error) {
  // unknown_op es un bug de programación (una op que este db.js no debería estar posteando): se
  // traduce para el log, pero NO es un UserError — al usuario no le dice nada.
  if (error.startsWith("unknown_op:")) {
    return new Error(t("errors.worker.unknownOp", { op: error.slice("unknown_op:".length) }));
  }
  // Este SÍ: pasa cuando se toca algo mientras la base todavía está abriéndose, y lo que hay que
  // hacer (esperar un momento y volver a intentarlo) cabe en el propio mensaje.
  if (error === "not_initialized") return new UserError(t("errors.worker.notInitialized"));
  // Cualquier otra cosa es el mensaje crudo de SQLite: se conserva entero para console.error
  // (errors.js#userMessage lo loguea) y el usuario ve el texto genérico.
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
