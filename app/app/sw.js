const CACHE = "bc-v45";
// sqlite3-opfs-async-proxy.js queda fuera a propósito: solo lo usa el VFS "opfs" clásico (requiere COOP/COEP), no el sahpool que usamos.
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon.svg", "icons/icon-maskable.svg",
  "css/tokens.css", "css/app.css", "vendor/pure.js", "vendor/xlsx/xlsx.full.min.js", "vendor/pdf-lib/pdf-lib.min.js", "vendor/fonts/fonts.css",
  "vendor/fonts/schibsted-grotesk-latin.woff2", "vendor/fonts/jetbrains-mono-latin.woff2",
  "js/main.js", "js/tabs.js", "js/back.js", "js/errors.js", "js/toast.js", "js/esc.js", "js/recibo.js", "js/skeleton.js", "js/viewport.js", "js/modal.js", "js/format.js", "js/icons.js", "js/ui.js", "js/share-pct.js", "js/registro-mode.js", "js/migrations.js", "js/i18n/index.js", "js/i18n/es.js", "js/i18n/en.js", "js/db.js", "js/db-worker.js", "js/schema.sql", "js/merchant-memory.js", "js/limit-warning.js", "js/natural.js", "js/speech.js",
  "js/sql.js", "js/seeds.js", "js/category-colors.js", "js/category-order.js", "js/category-spend.js", "js/repo.js",
  "js/account-defaults.js", "js/onboarding-steps.js", "js/contract.js", "js/xlsx.js", "js/xlsx-loader.js", "js/prevision.js", "js/inicio-logic.js", "js/semana-logic.js", "js/charts.js", "js/n26.js", "js/csv-generic.js", "js/backup-crypto.js",
  "js/informe-logic.js", "js/download.js", "js/informe-pdf.js", "js/pdf-loader.js", "js/barrido.js",
  "js/onboarding.js", "js/screens/registro.js", "js/screens/inicio.js", "js/screens/semana.js",
  "js/movimientos-filter.js", "js/open-tx.js", "js/screens/movimientos.js", "js/screens/liquidar.js", "js/screens/periodo-nuevo.js", "js/subscriptions.js", "js/subscription-detect.js",
  "js/screens/gasto-por-categoria.js", "js/screens/recurrentes.js", "js/screens/patrimonio.js", "js/screens/suscripciones.js", "js/screens/informe.js",
  "js/screens/ajustes.js", "js/screens/categorias.js", "js/screens/etiquetas.js", "js/screens/onboarding.js",
  "js/attachments.js", "js/bundle.js",
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
