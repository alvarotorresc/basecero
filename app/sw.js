const CACHE = "bc-v9";
// sqlite3-opfs-async-proxy.js queda fuera a propósito: solo lo usa el VFS "opfs" clásico (requiere COOP/COEP), no el sahpool que usamos.
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon.svg", "icons/icon-maskable.svg",
  "css/tokens.css", "css/app.css", "vendor/pure.js", "vendor/xlsx/xlsx.full.min.js", "vendor/fonts/fonts.css",
  "vendor/fonts/LDIbaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuA_qU79TR_V.woff2",
  "vendor/fonts/LDIbaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuA_m079TR_V.woff2",
  "vendor/fonts/LDIbaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuA_d0n9TR_V.woff2",
  "vendor/fonts/LDIbaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuA_Tkn9TR_V.woff2",
  "vendor/fonts/V8mQoQDjQSkFtoMM3T6r8E7mF71Q-gOoraIAEj7aUXskPMA.woff2",
  "vendor/fonts/V8mQoQDjQSkFtoMM3T6r8E7mF71Q-gOoraIAEj4PVnskPMA.woff2",
  "js/main.js", "js/format.js", "js/db.js", "js/db-worker.js", "js/schema.sql",
  "js/sql.js", "js/seeds.js", "js/category-colors.js", "js/repo.js",
  "js/contract.js", "js/xlsx.js", "js/prevision.js", "js/charts.js", "js/n26.js",
  "js/onboarding.js", "js/screens/registro.js", "js/screens/inicio.js",
  "js/screens/movimientos.js", "js/screens/liquidar.js", "js/screens/periodo-nuevo.js",
  "js/screens/presupuesto.js", "js/screens/recurrentes.js", "js/screens/patrimonio.js",
  "js/screens/ajustes.js",
  "vendor/sqlite-wasm/jswasm/sqlite3.mjs", "vendor/sqlite-wasm/jswasm/sqlite3.wasm"];
self.addEventListener("install", (e) => {
  // cache: "reload" evita que una versión nueva de CACHE reutilice respuestas
  // ya obsoletas de la caché HTTP del navegador para los mismos archivos.
  // Nota: la escritura en caché no es atómica entre archivos; un install fallido puede dejar entradas frescas huérfanas que el siguiente install/activate corrige.
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.all(SHELL.map((url) => fetch(url, { cache: "reload" }).then((r) => {
      if (!r.ok) throw new Error("SHELL fetch " + r.status + ": " + url);
      return c.put(url, r);
    }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) =>
    Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true })
    .then((hit) => hit || fetch(e.request)));
});
