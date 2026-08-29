import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PBKDF2_ITERATIONS, MIN_PASSPHRASE, isEncryptedBackup,
  encryptBackup, decryptBackup, BackupFormatError, WrongPassphraseError,
} from "../../app/app/js/backup-crypto.js";
import { X } from "./helpers.mjs";

const FAST = { iterations: 1000 };
const sample = () => crypto.getRandomValues(new Uint8Array(256));

// Vector de referencia (known-answer test): contenedor real generado UNA VEZ con
// encryptBackup(new TextEncoder().encode("BaseCero golden vector v1"), "contraseña dorada nº1", { iterations: 1000 }).
// NUNCA regenerar este hex: existe justo para que un refactor futuro (cambiar el hash,
// la codificación de la passphrase o la normalización) no pueda quedar en verde sin más
// que romper la lectura de las copias ya exportadas por usuarios reales. Si este test
// falla, el bug está en el código nuevo, no en el vector.
const GOLDEN_HEX =
  "42434531011301a43f42f4ab8954cb878d73fbe245000003e8d17f4197d20669f72e54fc0c866469e392439afec59d2c3d8277cb50109babd6fef21731329f6b7d96d74ccd0a6fff3a0bbeb57589";
const GOLDEN_PASS = "contraseña dorada nº1";
const GOLDEN_PLAIN = new TextEncoder().encode("BaseCero golden vector v1");
const hexToBytes = (hex) => new Uint8Array(Buffer.from(hex, "hex"));

test("golden vector: un contenedor v1 exportado ayer se sigue descifrando hoy", async () => {
  const vector = hexToBytes(GOLDEN_HEX);
  const dec = await decryptBackup(vector, GOLDEN_PASS);
  assert.deepEqual(dec, GOLDEN_PLAIN);
});

test("golden vector: contraseña equivocada sobre el mismo contenedor → WrongPassphraseError", async () => {
  const vector = hexToBytes(GOLDEN_HEX);
  await assert.rejects(() => decryptBackup(vector, "otra distinta x"), WrongPassphraseError);
});

test("plaintext vacío: round-trip a un Uint8Array de longitud 0", async () => {
  const enc = await encryptBackup(new Uint8Array(0), "contraseña larga", FAST);
  assert.equal(enc.length, 37 + 16); // cabecera + tag GCM, sin plaintext
  assert.equal(isEncryptedBackup(enc), true);
  const dec = await decryptBackup(enc, "contraseña larga");
  assert.deepEqual(dec, new Uint8Array(0));
});

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

test("la passphrase se normaliza a NFC (NFD y NFC son la misma contraseña)", async () => {
  const nfd = "café con leche"; // 'e' + acento combinante (NFD)
  const nfc = "café con leche";  // 'é' precompuesto (NFC)
  const plain = sample();
  const enc = await encryptBackup(plain, nfd, FAST);
  const dec = await decryptBackup(enc, nfc);
  assert.deepEqual(dec, plain);
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
