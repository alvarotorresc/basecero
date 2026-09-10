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
const SHEETJS_MARKER = "\x01Sh33tJ5";

// Normaliza cualquier binario razonable (Uint8Array, otro TypedArray, ArrayBuffer suelto) a un
// Uint8Array que comparte el mismo buffer subyacente (sin copiar). `XLSX.write(...,{type:"array"})`
// devuelve un ArrayBuffer crudo, no un Uint8Array: comprobado a mano contra el fichero
// vendorizado, pasarle ese ArrayBuffer directo a `cfb_add` escribe un stream VACIO sin avisar
// (ni tira ni loguea nada), y pasarlo a `CFB.read` revienta con un TypeError interno ajeno. Sin
// este paso, `isBundle` tampoco puede leer `.length` de un ArrayBuffer. NO depende de CFB: es
// aritmetica de buffers pura, cero dependencia de SheetJS.
function toByteView(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return bytes;
}

/** ¿Estos bytes en claro son un paquete (CFB) y no un .xlsx suelto? PURA y SIN NINGUNA dependencia
 *  de SheetJS a propósito: son 8 bytes de magic, y esta función es la que decide si esos bytes
 *  pueden llegar a CFB.read — nunca lanza, ni con menos de 8 bytes, ni si llegan como ArrayBuffer
 *  (p.ej. el `file.arrayBuffer()` del selector de fichero sin cifrar en ajustes.js). */
export function isBundle(bytes) {
  const view = toByteView(bytes);
  if (!view || typeof view.length !== "number" || view.length < CFB_MAGIC.length) return false;
  for (let i = 0; i < CFB_MAGIC.length; i++) if (view[i] !== CFB_MAGIC[i]) return false;
  return true;
}

/** Empaqueta `entries` ([{name, data}], typed arrays o ArrayBuffer) en un CFB y devuelve sus bytes
 *  (Uint8Array). `name` es la ruta dentro del paquete: "data.xlsx" para la hoja,
 *  "attachments/<txId>.jpg" para cada foto — cfb_add crea los directorios intermedios solo. */
export function packBundle(CFB, entries) {
  const cfb = CFB.utils.cfb_new();
  for (const { name, data } of entries) CFB.utils.cfb_add(cfb, name, toByteView(data));
  return CFB.write(cfb, { type: "array" });
}

/** Desempaqueta un CFB en `[{name, data}]`. `CFB.read` es código de una librería que no
 *  controlamos: un fichero truncado o corrupto (o un binario que no es CFB en absoluto) no puede
 *  acabar como un error crudo en un banner, así que se envuelve en UserError. FullPaths y
 *  FileIndex están alineados por índice (verificado contra el fichero vendorizado, ver
 *  bundle.test.mjs): se usa FullPaths para reconstruir el nombre lógico ("data.xlsx",
 *  "attachments/<id>.jpg") porque FileIndex[i].name es solo el último tramo de la ruta, sin el
 *  directorio. */
export function unpackBundle(CFB, bytes) {
  let cfb;
  try {
    cfb = CFB.read(toByteView(bytes), { type: "array" });
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
    entries.push({ name, data: toByteView(entry.content) ?? new Uint8Array(0) });
  });
  return entries;
}

const PHOTO_PREFIX = "attachments/";

/** Punto de entrada de los DOS caminos de restauración (ajustes.js#processImportBuffer,
 *  onboarding.js#parseAndOffer): reciben ya los bytes en claro, y los dos necesitan lo mismo —
 *  el xlsx a parsear y, si los había, los pares {id, data} para volver a escribir en OPFS. Una
 *  copia ANTIGUA (sin paquete, isBundle() a false) descifra directo a un .xlsx: se devuelve tal
 *  cual con `attachments: []`, nunca un error — es el 100% de las copias hechas antes de esta PR. */
export function unpackRestore(CFB, plainBytes) {
  if (!isBundle(plainBytes)) return { xlsx: plainBytes, attachments: [] };
  const parts = unpackBundle(CFB, plainBytes);
  const xlsxPart = parts.find((p) => p.name === "data.xlsx");
  // M-2 (revisión de código): sin esto, un paquete sin data.xlsx dejaba `xlsx: undefined` y el
  // llamante (ajustes.js/onboarding.js) se lo pasaba a XLSX.read(undefined, …), que revienta con
  // el error crudo de la librería — justo lo que el UserError de arriba existe para evitar.
  if (!xlsxPart) throw new UserError(t("errors.attachments.bundleCorrupt"));
  const attachments = parts
    .filter((p) => p.name.startsWith(PHOTO_PREFIX))
    .map((p) => ({ id: p.name.slice(PHOTO_PREFIX.length).replace(/\.jpg$/, ""), data: p.data }));
  return { xlsx: xlsxPart.data, attachments };
}
