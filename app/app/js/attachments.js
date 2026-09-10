/** Foto del ticket (N5, Registro v2 §9.3): el fichero comprimido vive en OPFS, NUNCA en SQLite —
 *  transactions.has_attachment (migrations.js v5) es solo una pista, la verdad la tiene el
 *  fichero (ver contract.js y xlsx.js: la columna nunca viaja como dato, solo como booleano).
 *
 *  Por qué esto no choca con la base de datos. Hoy OPFS solo lo toca `db-worker.js:11-12` con
 *  `installOpfsSAHPoolVfs({ name: "basecero" })` + `new pool.OpfsSAHPoolDb("/basecero.sqlite3")`.
 *  Ese VFS (SAHPool) usa *sync access handles*, que SOLO existen dentro de un Worker, y los
 *  mantiene abiertos sobre los ficheros de su propio pool — un directorio que, verificado contra
 *  el fuente vendorizado (`app/app/vendor/sqlite-wasm/jswasm/sqlite3.mjs`), es
 *  `options.directory || "." + vfsName`: con `name:"basecero"` y sin `directory`, es `/.basecero`.
 *  Este módulo usa `attachments/`, un directorio HERMANO en la raíz de OPFS: no hay colisión de
 *  nombres ni de handles porque son dos mundos que nunca se cruzan (este módulo corre en el hilo
 *  principal con la API asíncrona — getDirectoryHandle/getFileHandle/createWritable/getFile/
 *  removeEntry — que nunca pide un sync handle, así que nunca compite con el Worker).
 *
 *  Por qué `blob(id)` devuelve un Blob y no una URL: quien hace `URL.createObjectURL(blob)` es
 *  quien tiene que revocarlo, y este módulo no puede saber cuándo la pantalla ha terminado de
 *  enseñarlo. Devolviendo el Blob, la pantalla es dueña del par crear/revocar y la fuga de memoria
 *  no puede existir por construcción (spec §9.8). `null` cuando el fichero no está es el caso
 *  NORMAL de una hoja .xlsx restaurada (la foto nunca viajó ahí, §9.2), no un error.
 *
 *  Fábrica con dependencia inyectada (patrón back.js/toast.js/viewport.js/recibo.js): `getRoot`
 *  es `() => navigator.storage.getDirectory()` en producción, y un directorio falso en memoria en
 *  los tests — así la lógica se prueba en Node sin un navegador real. */

/** Máximo lado largo y calidad del JPEG. 1280 px es legible para un ticket de súper en pantalla y
 *  en un zoom razonable, y deja la foto en ~150-250 KB frente a los 3-5 MB del original. */
export const MAX_SIDE = 1280;
export const JPEG_QUALITY = 0.8;
export const DIR = "attachments";

/** Puro: dimensiones de destino conservando la proporción, sin AMPLIAR nunca (una foto de 600 px
 *  se queda en 600 px: reescalar hacia arriba solo añade bytes, no detalle). Redondea a entero
 *  (canvas no admite medios píxeles). Con w/h a 0 o negativo devuelve {width:0, height:0} sin
 *  lanzar: es lo que da una imagen que el navegador no supo decodificar. */
export function fitDimensions(w, h, max) {
  if (!(w > 0) || !(h > 0) || !(max > 0)) return { width: 0, height: 0 };
  if (w <= max && h <= max) return { width: Math.round(w), height: Math.round(h) };
  const scale = w >= h ? max / w : max / h;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

const fileName = (id) => `${id}.jpg`;

/** Fábrica: { available(), put(id, blob), blob(id), remove(id), sweep(liveIds) } — todo async
 *  salvo available(). `getRoot` se llama en cada operación (nunca se cachea el directorio): es
 *  barato y evita quedarse con un handle obsoleto si algo lo invalida entre llamadas. */
export function createAttachments(getRoot) {
  async function dirHandle(create) {
    const root = await getRoot();
    return root.getDirectoryHandle(DIR, { create });
  }

  return {
    // Mismo mundo que el fallback a memoria de db-worker.js:13-18: sin
    // navigator.storage.getDirectory no hay OPFS real, y sin OPFS no se ofrece la foto —no hay
    // adjunto "a medias" guardado en otro sitio.
    available() {
      return typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;
    },

    async put(id, blob) {
      const dir = await dirHandle(true);
      const handle = await dir.getFileHandle(fileName(id), { create: true });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    },

    // null cuando el fichero (o el propio directorio `attachments/`) no existe: caso normal, no
    // un error — ver el comentario de cabecera.
    async blob(id) {
      try {
        const dir = await dirHandle(false);
        const handle = await dir.getFileHandle(fileName(id), { create: false });
        return await handle.getFile();
      } catch {
        return null;
      }
    },

    // Borrar lo que no está no lanza: softDeleteTransaction (repo.js) llama aquí sin comprobar
    // antes si la fila tenía foto de verdad.
    async remove(id) {
      try {
        const dir = await dirHandle(false);
        await dir.removeEntry(fileName(id));
      } catch { /* ya no estaba, o el directorio no existe todavía: nada que borrar */ }
    },

    // Recorre SOLO `attachments/` y borra los ficheros cuyo id no esté en liveIds. Jamás toca la
    // raíz de OPFS -ahí vive `/.basecero`, la base de datos real del usuario- porque dirHandle()
    // siempre entra primero en el directorio DIR antes de listar nada.
    async sweep(liveIds) {
      const live = new Set(liveIds);
      const dir = await dirHandle(true);
      const stale = [];
      for await (const name of dir.keys()) {
        const id = name.endsWith(".jpg") ? name.slice(0, -4) : name;
        if (!live.has(id)) stale.push(name);
      }
      for (const name of stale) {
        try { await dir.removeEntry(name); } catch { /* ya no estaba */ }
      }
    },
  };
}

/** Comprime una foto de cámara/galería a JPEG (navegador: createImageBitmap + canvas + toBlob).
 *  Frontera deliberada con lo puro de arriba: esto no se testea en Node (no hay canvas), por eso
 *  vive en su propia función en vez de mezclarse con fitDimensions. */
export async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitDimensions(bitmap.width, bitmap.height, MAX_SIDE);
  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement("canvas"), { width, height });
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
}

// Instancia global null-safe, como toast.js:46, viewport.js y recibo.js:161-163: importar el
// módulo en Node no puede explotar (repo.js lo importa en B8, y repo.js sí se importa en la suite).
const instance = typeof navigator !== "undefined" && navigator.storage?.getDirectory
  ? createAttachments(() => navigator.storage.getDirectory()) : null;
export const attachments = instance;
