import { test } from "node:test";
import assert from "node:assert/strict";
import { fitDimensions, createAttachments, DIR } from "../../app/app/js/attachments.js";

// ---- fitDimensions --------------------------------------------------------

test("fitDimensions: horizontal se escala por el ancho", () => {
  assert.deepEqual(fitDimensions(2560, 1280, 1280), { width: 1280, height: 640 });
});

test("fitDimensions: vertical se escala por el alto", () => {
  assert.deepEqual(fitDimensions(1280, 2560, 1280), { width: 640, height: 1280 });
});

test("fitDimensions: cuadrada se escala por igual en los dos lados", () => {
  assert.deepEqual(fitDimensions(2000, 2000, 1280), { width: 1280, height: 1280 });
});

test("fitDimensions: una imagen ya pequeña NO se amplía", () => {
  assert.deepEqual(fitDimensions(600, 400, 1280), { width: 600, height: 400 });
});

test("fitDimensions: 0 o negativo no revienta y devuelve 0/0", () => {
  assert.deepEqual(fitDimensions(0, 100, 1280), { width: 0, height: 0 });
  assert.deepEqual(fitDimensions(100, -1, 1280), { width: 0, height: 0 });
  assert.deepEqual(fitDimensions(-5, -5, 1280), { width: 0, height: 0 });
});

test("fitDimensions: redondea a entero", () => {
  const r = fitDimensions(1001, 667, 500);
  assert.equal(Number.isInteger(r.width), true);
  assert.equal(Number.isInteger(r.height), true);
  assert.deepEqual(r, { width: 500, height: 333 });
});

// ---- createAttachments, contra un doble de OPFS en memoria ---------------

/** Doble de OPFS con la superficie EXACTA que usa attachments.js:
 *  getDirectoryHandle(name,{create}), getFileHandle(name,{create}), createWritable() ->
 *  {write,close}, getFile(), removeEntry(name), keys() como iterador asíncrono.
 *  La raíz falsa trae un directorio hermano ".basecero" (la BD real del usuario, ver
 *  db-worker.js) para fijar que sweep() NUNCA lo enumera. */
function fakeRoot() {
  const notFound = () => { const e = new Error("NotFoundError"); e.name = "NotFoundError"; return e; };
  function makeDir() {
    const files = new Map();
    return {
      files,
      getFileHandle(name, { create = false } = {}) {
        if (!files.has(name)) {
          if (!create) throw notFound();
          files.set(name, { bytes: null });
        }
        const entry = files.get(name);
        return {
          async createWritable() {
            return {
              async write(data) { entry.bytes = data; },
              async close() {},
            };
          },
          async getFile() {
            if (entry.bytes == null) throw notFound();
            return entry.bytes;
          },
        };
      },
      async removeEntry(name) {
        if (!files.has(name)) throw notFound();
        files.delete(name);
      },
      keys() {
        const it = files.keys();
        return { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve(it.next()) }) };
      },
    };
  }
  const dirs = new Map([[".basecero", makeDir()]]); // el directorio hermano: la BD del usuario
  const getDirectoryCalls = [];
  return {
    getDirectoryCalls,
    async getDirectoryHandle(name, { create = false } = {}) {
      getDirectoryCalls.push(name);
      if (!dirs.has(name)) {
        if (!create) throw notFound();
        dirs.set(name, makeDir());
      }
      return dirs.get(name);
    },
  };
}

test("put: crea attachments/<id>.jpg", async () => {
  const root = fakeRoot();
  const a = createAttachments(() => root);
  await a.put("tx-1", "BYTES-1");
  const dir = await root.getDirectoryHandle(DIR, { create: false });
  assert.ok(dir.files.has("tx-1.jpg"));
  assert.equal(dir.files.get("tx-1.jpg").bytes, "BYTES-1");
});

test("blob: devuelve los mismos bytes que se guardaron con put", async () => {
  const root = fakeRoot();
  const a = createAttachments(() => root);
  await a.put("tx-2", "BYTES-2");
  assert.equal(await a.blob("tx-2"), "BYTES-2");
});

test("blob: de un id que no está devuelve null, sin lanzar (caso normal de una hoja restaurada)", async () => {
  const root = fakeRoot();
  const a = createAttachments(() => root);
  assert.equal(await a.blob("no-existe"), null);
});

test("remove: borra el fichero", async () => {
  const root = fakeRoot();
  const a = createAttachments(() => root);
  await a.put("tx-3", "BYTES-3");
  await a.remove("tx-3");
  assert.equal(await a.blob("tx-3"), null);
});

test("remove: de lo que no está no lanza", async () => {
  const root = fakeRoot();
  const a = createAttachments(() => root);
  await assert.doesNotReject(() => a.remove("no-existe"));
});

test("sweep(liveIds): borra solo los ausentes", async () => {
  const root = fakeRoot();
  const a = createAttachments(() => root);
  await a.put("vivo-1", "A");
  await a.put("vivo-2", "B");
  await a.put("huerfano", "C");
  await a.sweep(["vivo-1", "vivo-2"]);
  assert.equal(await a.blob("vivo-1"), "A");
  assert.equal(await a.blob("vivo-2"), "B");
  assert.equal(await a.blob("huerfano"), null);
});

test("sweep: NUNCA enumera el directorio hermano (.basecero, la BD real del usuario)", async () => {
  const root = fakeRoot();
  const a = createAttachments(() => root);
  await a.put("vivo", "A");
  await a.sweep(["vivo"]);
  assert.deepEqual(root.getDirectoryCalls, Array(root.getDirectoryCalls.length).fill(DIR),
    "sweep solo pide el directorio 'attachments', nunca la raíz ni '.basecero'");
});
