let worker = null, seq = 0;
const pending = new Map();

function call(op, sql, params) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, op, sql, params });
  });
}

export function initDb() {
  worker = new Worker(new URL("./db-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const { id, error, ...rest } = e.data;
    const p = pending.get(id); if (!p) return;
    pending.delete(id);
    error ? p.reject(new Error(error)) : p.resolve(rest);
  };
  return call("init");
}
export const query = (sql, params = []) => call("query", sql, params).then((r) => r.rows);
export const exec = (sql, params = []) => call("exec", sql, params).then(() => {});
