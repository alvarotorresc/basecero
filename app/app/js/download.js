/** El `<a download>` que hasta ahora vivía suelto en ajustes.js:51-54, extraído para que el
 *  Informe (el xlsx y ahora también el PDF) lo reutilicen sin duplicar la implementación.
 *  `createDownloader(doc, urlApi)` recibe sus dependencias por parámetro — mismo patrón que
 *  `createToaster(doc)` en toast.js — así se puede probar en Node con un `document`/`URL` falsos. */
export function createDownloader(doc, urlApi) {
  return function download(blob, filename) {
    const a = Object.assign(doc.createElement("a"), { href: urlApi.createObjectURL(blob), download: filename });
    a.click();
    urlApi.revokeObjectURL(a.href);
  };
}

/** Binding por defecto: `document`/`URL` reales del navegador, resueltos SOLO al llamar (nunca al
 *  importar el módulo) — así este fichero se puede importar en Node, donde `document` no existe,
 *  sin que el import en sí falle. */
export const download = (blob, filename) => createDownloader(document, URL)(blob, filename);
