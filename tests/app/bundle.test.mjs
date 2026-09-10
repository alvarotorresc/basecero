import { test } from "node:test";
import assert from "node:assert/strict";
import { X } from "./helpers.mjs";
import { isBundle, packBundle, unpackBundle } from "../../app/app/js/bundle.js";
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

test("unpackBundle: bytes truncados -> UserError, nunca el error crudo de la librería", () => {
  const full = packBundle(X.CFB, [{ name: "data.xlsx", data: new Uint8Array(50).fill(7) }]);
  const truncated = full.slice(0, 20);
  assert.throws(() => unpackBundle(X.CFB, truncated), (e) => {
    assert.ok(e instanceof UserError, `esperaba UserError, fue ${e.constructor.name}: ${e.message}`);
    return true;
  });
});
