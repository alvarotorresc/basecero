// Carga perezosa de pdf-lib (525KB): fuera del critical path del arranque, calco literal de
// xlsx-loader.js. El fichero sigue precacheado en el SW (SHELL), así que offline también
// funciona — solo cambia CUÁNDO se parsea (el primer «Descargar el PDF» de la sesión).
// Se consume como window.PDFLib (global), siempre dentro de handlers async.
let pending = null;
export function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  pending ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/pdf-lib/pdf-lib.min.js";
    s.onload = () => resolve(window.PDFLib);
    s.onerror = () => { pending = null; reject(new Error("pdf-lib load failed")); };
    document.head.appendChild(s);
  });
  return pending;
}
