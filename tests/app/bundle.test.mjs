import { test } from "node:test";
import assert from "node:assert/strict";
import { X } from "./helpers.mjs";
import { isBundle, packBundle, unpackBundle, unpackRestore } from "../../app/app/js/bundle.js";
import { UserError } from "../../app/app/js/errors.js";

// ---- isBundle: pura, sin CFB, sobre el magic crudo -------------------------

test("isBundle: el magic CFB (D0 CF 11 E0 A1 B1 1A E1) es un paquete", () => {
  const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 9, 9]);
  assert.equal(isBundle(bytes), true);
});

test("isBundle: un .bce antiguo (el ZIP del .xlsx, PK\\x03\\x04) NO es un paquete", () => {
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
  assert.equal(isBundle(bytes), false);
});

test("isBundle: reconoce el magic también sobre un ArrayBuffer suelto, no solo Uint8Array", () => {
  const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  assert.equal(isBundle(arrayBuffer), true);
});

test("isBundle: 2 bytes de basura no lanza y devuelve false", () => {
  assert.equal(isBundle(new Uint8Array([1, 2])), false);
  assert.equal(isBundle(new Uint8Array([])), false);
  assert.equal(isBundle(null), false);
  assert.equal(isBundle(undefined), false);
});

// ---- packBundle / unpackBundle, contra el CFB del fichero vendorizado ------

test("round-trip: una entrada, bytes binarios idénticos", () => {
  const data = new Uint8Array([1, 2, 3, 4, 250, 251, 252, 253]);
  const bytes = packBundle(X.CFB, [{ name: "data.xlsx", data }]);
  assert.equal(isBundle(bytes), true, "el paquete empieza por el magic CFB");
  const entries = unpackBundle(X.CFB, bytes);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "data.xlsx");
  assert.deepEqual(new Uint8Array(entries[0].data), data);
});

test("round-trip: varias entradas (hoja + dos fotos), bytes binarios idénticos", () => {
  const xlsx = new Uint8Array([80, 75, 3, 4, 1, 1, 1]); // simula un ZIP de xlsx
  const photo1 = new Uint8Array(300).map((_, i) => i % 256);
  const photo2 = new Uint8Array([255, 0, 128, 64]);
  const bytes = packBundle(X.CFB, [
    { name: "data.xlsx", data: xlsx },
    { name: "attachments/01ARZ3NDEKTSV4RRFFQ69G5FAV.jpg", data: photo1 },
    { name: "attachments/01BXZ9NDEKTSV4RRFFQ69G5FBW.jpg", data: photo2 },
  ]);
  const entries = unpackBundle(X.CFB, bytes);
  assert.equal(entries.length, 3);
  const byName = Object.fromEntries(entries.map((e) => [e.name, e.data]));
  assert.deepEqual(new Uint8Array(byName["data.xlsx"]), xlsx);
  assert.deepEqual(new Uint8Array(byName["attachments/01ARZ3NDEKTSV4RRFFQ69G5FAV.jpg"]), photo1);
  assert.deepEqual(new Uint8Array(byName["attachments/01BXZ9NDEKTSV4RRFFQ69G5FBW.jpg"]), photo2);
});

test("round-trip: datos vacíos sobreviven", () => {
  const bytes = packBundle(X.CFB, [{ name: "data.xlsx", data: new Uint8Array(0) }]);
  const entries = unpackBundle(X.CFB, bytes);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].data.length, 0);
});

// ULID: charset [0-9A-Z]{26} (bcUlid) — el nombre de fichero real que produce attachments.js.
test("round-trip: un nombre de ULID de 26 caracteres sobrevive", () => {
  const id = "01J8Z3NDEKTSV4RRFFQ69G5FAV"; // 26 chars
  assert.equal(id.length, 26);
  const bytes = packBundle(X.CFB, [
    { name: "data.xlsx", data: new Uint8Array([1]) },
    { name: `attachments/${id}.jpg`, data: new Uint8Array([2, 3]) },
  ]);
  const entries = unpackBundle(X.CFB, bytes);
  assert.ok(entries.some((e) => e.name === `attachments/${id}.jpg`));
});

test("unpackBundle: descarta lo que no es un stream de fichero (Root Entry y el marcador de SheetJS)", () => {
  const bytes = packBundle(X.CFB, [{ name: "data.xlsx", data: new Uint8Array([1, 2]) }]);
  const entries = unpackBundle(X.CFB, bytes);
  // Ni el "Root Entry" ni el marcador \x01Sh33tJ5 que SheetJS añade siempre deben aparecer.
  assert.ok(!entries.some((e) => e.name.includes("Root Entry")));
  assert.ok(!entries.some((e) => e.name.includes("Sh33tJ5")));
  assert.deepEqual(entries.map((e) => e.name), ["data.xlsx"]);
});

// XLSX.write(wb, {type:"array"}) devuelve un ArrayBuffer CRUDO, no un Uint8Array (comprobado a
// mano contra el fichero vendorizado) — y ese es exactamente el valor que ajustes.js mete como
// `data` de "data.xlsx" al llamar a packBundle. Sin normalizar antes de cfb_add, ese entry queda
// VACIO sin avisar: no hay excepción, ni test que lo detecte salvo comprobar el tamaño real.
test("round-trip: un ArrayBuffer crudo (lo que devuelve XLSX.write) no se queda vacío", () => {
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["a", "b"], [1, 2]]), "S");
  const arr = X.write(wb, { type: "array", bookType: "xlsx" });
  assert.ok(arr instanceof ArrayBuffer, "sentinela: si SheetJS cambia esto de tipo, este test debe fallar en rojo aquí");
  const bytes = packBundle(X.CFB, [{ name: "data.xlsx", data: arr }]);
  const entries = unpackBundle(X.CFB, bytes);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].data.length, arr.byteLength, "el entry no debe llegar vacío");
});

test("unpackRestore: acepta un ArrayBuffer suelto (no solo Uint8Array) sin perder las fotos", () => {
  const xlsx = new Uint8Array([80, 75, 3, 4, 9, 9]);
  const bytes = packBundle(X.CFB, [
    { name: "data.xlsx", data: xlsx },
    { name: "attachments/01ARZ3NDEKTSV4RRFFQ69G5FAV.jpg", data: new Uint8Array([7, 8]) },
  ]);
  const asArrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  assert.ok(asArrayBuffer instanceof ArrayBuffer);
  const { xlsx: outXlsx, attachments } = unpackRestore(X.CFB, asArrayBuffer);
  assert.deepEqual(new Uint8Array(outXlsx), xlsx);
  assert.equal(attachments.length, 1);
});

test("unpackBundle: bytes truncados -> UserError, nunca el error crudo de la librería", () => {
  const full = packBundle(X.CFB, [{ name: "data.xlsx", data: new Uint8Array(50).fill(7) }]);
  const truncated = full.slice(0, 20);
  assert.throws(() => unpackBundle(X.CFB, truncated), (e) => {
    assert.ok(e instanceof UserError, `esperaba UserError, fue ${e.constructor.name}: ${e.message}`);
    return true;
  });
});

// ---- unpackRestore: el punto de entrada único de los DOS caminos de restauración -------------

test("unpackRestore: unos bytes de paquete devuelven { xlsx, attachments: [{id, data}] }", () => {
  const xlsx = new Uint8Array([80, 75, 3, 4, 9, 9]); // el ZIP simulado del xlsx
  const photo = new Uint8Array([1, 2, 3]);
  const bytes = packBundle(X.CFB, [
    { name: "data.xlsx", data: xlsx },
    { name: "attachments/01ARZ3NDEKTSV4RRFFQ69G5FAV.jpg", data: photo },
  ]);
  const { xlsx: outXlsx, attachments } = unpackRestore(X.CFB, bytes);
  assert.deepEqual(new Uint8Array(outXlsx), xlsx);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].id, "01ARZ3NDEKTSV4RRFFQ69G5FAV");
  assert.deepEqual(new Uint8Array(attachments[0].data), photo);
});

// M-2 (revisión de código): un paquete sin data.xlsx (p.ej. dañado a medias) dejaba
// `xlsxPart?.data` en `undefined`, que XLSX.read(undefined, …) revienta con el error crudo de la
// librería en vez del UserError que unpackBundle ya usa para esto.
test("unpackRestore: un paquete sin data.xlsx -> UserError, nunca el error crudo de la librería", () => {
  const bytes = packBundle(X.CFB, [
    { name: "attachments/01ARZ3NDEKTSV4RRFFQ69G5FAV.jpg", data: new Uint8Array([1, 2]) },
  ]);
  assert.throws(() => unpackRestore(X.CFB, bytes), (e) => {
    assert.ok(e instanceof UserError, `esperaba UserError, fue ${e.constructor.name}: ${e.message}`);
    return true;
  });
});

test("unpackRestore: unos bytes que empiezan por PK (copia antigua, sin paquete) devuelven el xlsx y attachments: []", () => {
  const xlsx = new Uint8Array([80, 75, 3, 4, 5, 5, 5]);
  const { xlsx: outXlsx, attachments } = unpackRestore(X.CFB, xlsx);
  assert.equal(outXlsx, xlsx, "los mismos bytes, sin tocar");
  assert.deepEqual(attachments, []);
});
