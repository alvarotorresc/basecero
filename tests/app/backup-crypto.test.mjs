import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PBKDF2_ITERATIONS, MIN_PASSPHRASE, isEncryptedBackup,
  encryptBackup, decryptBackup, BackupFormatError, WrongPassphraseError,
} from "../../app/js/backup-crypto.js";
import { X } from "./helpers.mjs";

const FAST = { iterations: 1000 };
const sample = () => crypto.getRandomValues(new Uint8Array(256));

test("constantes de producción", () => {
  assert.equal(PBKDF2_ITERATIONS, 600000);
  assert.equal(MIN_PASSPHRASE, 10);
});

test("round-trip: encrypt → decrypt devuelve el plaintext exacto", async () => {
  const plain = sample();
  const enc = await encryptBackup(plain, "contraseña larga", FAST);
  assert.equal(isEncryptedBackup(enc), true);
  const dec = await decryptBackup(enc, "contraseña larga");
  assert.deepEqual(dec, plain);
});

test("acepta ArrayBuffer además de Uint8Array", async () => {
  const plain = sample();
  const enc = await encryptBackup(plain.buffer, "contraseña larga", FAST);
  const dec = await decryptBackup(enc.buffer, "contraseña larga");
  assert.deepEqual(dec, plain);
});

test("cabecera: offsets y valores del contenedor v1", async () => {
  const enc = await encryptBackup(sample(), "contraseña larga", FAST);
  assert.equal(new TextDecoder().decode(enc.slice(0, 4)), "BCE1");
  assert.equal(enc[4], 1); // versión de contenedor
  assert.equal(new DataView(enc.buffer, enc.byteOffset).getUint32(21), 1000); // iteraciones BE
  assert.equal(enc.length, 37 + 256 + 16); // cabecera + plaintext + tag GCM
});

test("cada export usa salt e IV nuevos", async () => {
  const plain = sample();
  const a = await encryptBackup(plain, "contraseña larga", FAST);
  const b = await encryptBackup(plain, "contraseña larga", FAST);
  assert.notDeepEqual(a.slice(5, 21), b.slice(5, 21));   // salt
  assert.notDeepEqual(a.slice(25, 37), b.slice(25, 37)); // IV
});

test("contraseña incorrecta → WrongPassphraseError", async () => {
  const enc = await encryptBackup(sample(), "contraseña larga", FAST);
  await assert.rejects(() => decryptBackup(enc, "otra distinta x"), WrongPassphraseError);
});

test("ciphertext manipulado → WrongPassphraseError (mismo error que contraseña mala)", async () => {
  const enc = await encryptBackup(sample(), "contraseña larga", FAST);
  enc[40] ^= 0xff;
  await assert.rejects(() => decryptBackup(enc, "contraseña larga"), WrongPassphraseError);
});

test("fichero truncado → BackupFormatError", async () => {
  const enc = await encryptBackup(sample(), "contraseña larga", FAST);
  await assert.rejects(() => decryptBackup(enc.slice(0, 30), "contraseña larga"), BackupFormatError);
  await assert.rejects(() => decryptBackup(enc.slice(0, 40), "contraseña larga"), BackupFormatError);
});

test("versión de contenedor desconocida → BackupFormatError", async () => {
  const enc = await encryptBackup(sample(), "contraseña larga", FAST);
  enc[4] = 9;
  await assert.rejects(() => decryptBackup(enc, "contraseña larga"), BackupFormatError);
});

test("iteraciones fuera de rango en cabecera hostil → BackupFormatError", async () => {
  const enc = await encryptBackup(sample(), "contraseña larga", FAST);
  new DataView(enc.buffer, enc.byteOffset).setUint32(21, 0);
  await assert.rejects(() => decryptBackup(enc, "contraseña larga"), BackupFormatError);
  new DataView(enc.buffer, enc.byteOffset).setUint32(21, 100000000);
  await assert.rejects(() => decryptBackup(enc, "contraseña larga"), BackupFormatError);
});

test("un fichero no cifrado no se confunde con uno cifrado", async () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]); // magic de .xlsx (ZIP)
  assert.equal(isEncryptedBackup(zip), false);
  assert.equal(isEncryptedBackup(new Uint8Array(0)), false);
  assert.equal(isEncryptedBackup(new Uint8Array([0x42, 0x43])), false); // más corto que el magic
  await assert.rejects(() => decryptBackup(zip, "contraseña larga"), BackupFormatError);
});

test("round-trip con un .xlsx real de SheetJS", async () => {
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["k", "v"], ["a", 1]]), "Hoja");
  const xlsxBytes = new Uint8Array(X.write(wb, { type: "array", bookType: "xlsx" }));
  const enc = await encryptBackup(xlsxBytes, "contraseña larga", FAST);
  assert.equal(isEncryptedBackup(xlsxBytes), false);
  assert.equal(isEncryptedBackup(enc), true);
  const dec = await decryptBackup(enc, "contraseña larga");
  const wb2 = X.read(dec, { type: "array" });
  assert.deepEqual(X.utils.sheet_to_json(wb2.Sheets.Hoja), [{ k: "a", v: 1 }]);
});
