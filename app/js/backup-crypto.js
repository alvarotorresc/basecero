/** Contenedor de backup cifrado de BaseCero (v1).
 *  Layout binario (offsets en bytes): magic "BCE1"(0,4) · versión(4,1) · salt(5,16) ·
 *  iteraciones PBKDF2 uint32 BE(21,4) · IV GCM(25,12) · ciphertext+tag(37,resto).
 *  Las iteraciones viajan en la cabecera para poder subir el coste en el futuro sin
 *  romper la lectura de copias antiguas. La passphrase no se persiste jamás. */
import { t } from "./i18n/index.js";

const MAGIC = new Uint8Array([0x42, 0x43, 0x45, 0x31]); // "BCE1"
const VERSION = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = 4 + 1 + SALT_LEN + 4 + IV_LEN; // 37
// Cota superior al leer cabeceras no confiables: evita que un fichero hostil dispare
// una derivación absurdamente cara (paralelo a la validación defensiva de Bito).
const MAX_ITERATIONS = 10_000_000;

export const PBKDF2_ITERATIONS = 600000; // OWASP 2023 para PBKDF2-HMAC-SHA256
export const MIN_PASSPHRASE = 10;

export class BackupFormatError extends Error {
  constructor(message) { super(message); this.name = "BackupFormatError"; }
}
export class WrongPassphraseError extends Error {
  constructor(message) { super(message); this.name = "WrongPassphraseError"; }
}

const toBytes = (data) => (data instanceof Uint8Array ? data : new Uint8Array(data));

export function isEncryptedBackup(data) {
  const b = toBytes(data);
  return b.length >= MAGIC.length && MAGIC.every((v, i) => b[i] === v);
}

async function deriveKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(passphrase.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false, // no extraíble: la clave nunca se materializa como bytes
    ["encrypt", "decrypt"]);
}

export async function encryptBackup(plainData, passphrase, { iterations = PBKDF2_ITERATIONS } = {}) {
  const plain = toBytes(plainData);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(passphrase, salt, iterations);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const out = new Uint8Array(HEADER_LEN + cipher.length);
  out.set(MAGIC, 0);
  out[4] = VERSION;
  out.set(salt, 5);
  new DataView(out.buffer).setUint32(21, iterations); // big-endian
  out.set(iv, 25);
  out.set(cipher, HEADER_LEN);
  return out;
}

export async function decryptBackup(fileData, passphrase) {
  const bytes = toBytes(fileData);
  if (!isEncryptedBackup(bytes)) throw new BackupFormatError(t("errors.backupCrypto.notEncrypted"));
  if (bytes.length < HEADER_LEN + TAG_LEN) throw new BackupFormatError(t("errors.backupCrypto.truncated"));
  if (bytes[4] !== VERSION)
    throw new BackupFormatError(t("errors.backupCrypto.newerVersion", { version: bytes[4] }));
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const iterations = view.getUint32(21);
  if (iterations < 1 || iterations > MAX_ITERATIONS)
    throw new BackupFormatError(t("errors.backupCrypto.invalidHeader"));
  const salt = bytes.slice(5, 21);
  const iv = bytes.slice(25, 37);
  const key = await deriveKey(passphrase, salt, iterations);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, bytes.subarray(HEADER_LEN)));
  } catch {
    // El tag GCM no distingue contraseña mala de datos dañados: un solo error, a propósito.
    throw new WrongPassphraseError(t("errors.backupCrypto.wrongPassphrase"));
  }
}
