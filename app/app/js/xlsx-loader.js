// Carga perezosa de SheetJS (952KB): fuera del critical path del arranque. El fichero sigue
// precacheado en el SW (SHELL), así que offline también funciona — solo cambia CUÁNDO se parsea.
// Se consume como window.XLSX (global), siempre dentro de handlers async.
let pending = null;
export function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  pending ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/xlsx/xlsx.full.min.js";
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => { pending = null; reject(new Error("xlsx load failed")); };
    document.head.appendChild(s);
  });
  return pending;
}
