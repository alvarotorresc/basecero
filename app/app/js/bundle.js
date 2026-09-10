/** El paquete que va DENTRO de la copia cifrada (.bce) cuando hay fotos que llevar (Registro v2
 *  §9.6). Hoy el `.bce` es *xlsx cifrado*: `backup-crypto.js` envuelve los bytes del `.xlsx` en el
 *  contenedor `BCE1` y ya está. Para que las fotos viajen también, el texto en claro pasa de «un
 *  xlsx» a «un xlsx + N ficheros» — y ESTE módulo es ese sobre.
 *
 *  Por qué CFB y no un formato propio: `app/app/vendor/xlsx/xlsx.full.min.js` (SheetJS, ya en el
 *  SHELL) expone `XLSX.CFB` con un escritor/lector de contenedores OLE de verdad —
 *  `utils.cfb_new/cfb_add`, `write`, `read`— así que no hace falta escribir ni un byte de framing
 *  binario a mano (longitudes, truncados, `RangeError` de `DataView`…). Restaurar un `.bce` YA
 *  depende de SheetJS hoy (lo de dentro es un `.xlsx`), así que esto no añade ningún punto de
 *  fallo nuevo, y es un formato ESTÁNDAR: un `.bce` descifrado se puede abrir con 7-Zip.
 *
 *  El byte de versión de `BCE1` (backup-crypto.js) NO se toca: el contenedor CFB vive DENTRO del
 *  texto en claro que `BCE1` ya envolvía, es indiferente a lo que hay dentro.
 *
 *  Fábrica con el CFB inyectado (`packBundle(CFB, …)`/`unpackBundle(CFB, …)`): el llamante
 *  (ajustes.js/onboarding.js) ya tiene `XLSX` cargado, así que no hace falta que este módulo lo
 *  importe — mismo motivo que `bundle.test.mjs` toma el `X` del fichero vendorizado vía
 *  `helpers.mjs`, para que una subida de versión de SheetJS que cambiara la API salga en rojo
 *  aquí y no en una copia de seguridad irrecuperable. */
import { t } from "./i18n/index.js";
import { UserError } from "./errors.js";

// Magic de un contenedor CFB/OLE2 (los primeros 8 bytes de cualquier fichero .xls/.doc antiguo,
// y de lo que escribe XLSX.CFB.write aquí). Un .bce ANTIGUO (sin paquete) descifra directo a un
// .xlsx, cuyo ZIP empieza por "PK\x03\x04" — magic totalmente distinto, así que esos bytes NUNCA
// llegan a CFB.read.
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

// Dentro de un CFB de SheetJS, cada entrada real cuelga de "Root Entry/…"; los directorios
// intermedios (p.ej. "attachments/") y el propio "Root Entry" no son streams de fichero.
const ROOT_PREFIX = "Root Entry/";
// Marcador que cfb_add añade SIEMPRE (aunque no se le pida): un stream vacío que identifica el
// contenedor como "de SheetJS" para sus propios lectores. No es uno de nuestros ficheros.
const SHEETJS_MARKER = "Sh33tJ5";

/** ¿Estos bytes en claro son un paquete (CFB) y no un .xlsx suelto? PURA y SIN NINGUNA dependencia
 *  de SheetJS a propósito: son 8 bytes de magic, y esta función es la que decide si esos bytes
 *  pueden llegar a CFB.read — nunca lanza, ni con menos de 8 bytes. */
export function isBundle(bytes) {
  if (!bytes || typeof bytes.length !== "number" || bytes.length < CFB_MAGIC.length) return false;
  for (let i = 0; i < CFB_MAGIC.length; i++) if (bytes[i] !== CFB_MAGIC[i]) return false;
  return true;
}

/** Empaqueta `entries` ([{name, data}], typed arrays) en un CFB y devuelve sus bytes (Uint8Array).
 *  `name` es la ruta dentro del paquete: "data.xlsx" para la hoja, "attachments/<txId>.jpg" para
 *  cada foto — cfb_add crea los directorios intermedios solo. */
export function packBundle(CFB, entries) {
  const cfb = CFB.utils.cfb_new();
  for (const { name, data } of entries) CFB.utils.cfb_add(cfb, name, data);
  return CFB.write(cfb, { type: "array" });
}

/** Desempaqueta un CFB en `[{name, data}]`. `CFB.read` es código de una librería que no
 *  controlamos: un fichero truncado o corrupto no puede acabar como un error crudo en un banner,
 *  así que se envuelve en UserError. FullPaths y FileIndex están alineados por índice (verificado
 *  contra el fichero vendorizado, ver bundle.test.mjs): se usa FullPaths para reconstruir el
 *  nombre lógico ("data.xlsx", "attachments/<id>.jpg") porque FileIndex[i].name es solo el último
 *  tramo de la ruta, sin el directorio. */
export function unpackBundle(CFB, bytes) {
  let cfb;
  try {
    cfb = CFB.read(bytes, { type: "array" });
  } catch {
    throw new UserError(t("errors.attachments.bundleCorrupt"));
  }
  const entries = [];
  cfb.FileIndex.forEach((entry, i) => {
    if (entry.type !== 2) return; // descarta el Root Entry (5) y los directorios (1)
    const fullPath = cfb.FullPaths[i] ?? "";
    if (!fullPath.startsWith(ROOT_PREFIX)) return;
    const name = fullPath.slice(ROOT_PREFIX.length);
    if (name === SHEETJS_MARKER) return;
    entries.push({ name, data: entry.content ?? new Uint8Array(0) });
  });
  return entries;
}
