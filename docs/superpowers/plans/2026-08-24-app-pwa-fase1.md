# BaseCero App — Fase 1 PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PWA instalable y offline (móvil/PC) con SQLite local: onboarding de primer periodo, pantalla de Registro rápido del diseño aprobado, e Inicio con gastado del periodo y movimientos.

**Architecture:** HTML/CSS/ES modules vanilla sin build step. SQLite WASM oficial vendorizado corriendo en un Worker dedicado con VFS `opfs-sahpool` (sin COOP/COEP → compatible GitHub Pages) y fallback a memoria; el hilo principal habla con el worker por un puente de promesas. El esquema sale 1:1 del contrato (`contract.py`); `apps_script/pure.js` se reutiliza como script clásico (define globales `bc*`).

**Tech Stack:** Vanilla JS (ES modules) · @sqlite.org/sqlite-wasm vendorizado · node:sqlite para tests (`node --test --experimental-sqlite`) · Playwright MCP para el QA E2E.

**Spec:** `docs/specs/2026-08-24-app-pwa-fase1-design.md` (y contrato: `docs/specs/2026-08-24-basecero-hoja-calculo-design.md`; referencia visual: `design/*.dc.html` + canvas aprobado).

## Global Constraints

- CERO dependencias de runtime salvo `app/vendor/` (sqlite-wasm y fuentes woff2 auto-hospedadas). CERO npm/package.json. CERO build step.
- Paleta EXACTA del canvas: fondo `#0b0c0e`, tarjeta `#151719`, borde `#23272b`, texto `#e7e9ec`/`#9aa1a9`/`#656c74`, acento `#2f6bff`, gasto/rojo `#f87171`, ingreso/verde `#4ade80`. Colores de categoría (raíz): casa `#8b9ff5`, alimentacion `#58d68d`, restauracion `#f0a868`, transporte `#56c6de`, coche `#ddb455`, ocio `#e68ab0`, salud `#ec8a84`, suscripciones `#b08be8`, resto `#5c646d`. Radios 20-22px. Tipos: Plus Jakarta Sans (UI) y Space Grotesk (importes, `font-variant-numeric: tabular-nums`).
- Toda la UI en español con tildes correctas; importes formato español (`1.234,56 €`) via `Intl.NumberFormat('es-ES', {style:'currency', currency:'EUR'})` sobre céntimos/100.
- Importes en céntimos INTEGER en SQLite (`amount_cents`, `opening_balance_cents`, …); fechas TEXT ISO `YYYY-MM-DD`; timestamps ISO con hora; booleanos INTEGER 0/1; enums con CHECK idénticos al contrato; ids TEXT (ULID de `bcUlid()` o slugs semilla).
- Borrado lógico (`deleted`) en todas las tablas; máximo un periodo `open` (índice parcial único).
- Tests de datos: `node --test --experimental-sqlite tests/app/`; el SQL de producción y el de los tests sale de LOS MISMOS archivos (`app/js/schema.sql`, `app/js/sql.js`).
- Commits terminan con: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- El servidor local de pruebas es `python3 -m http.server 8765 -d app` (OPFS funciona en localhost).

## File Structure

```
app/
├── index.html            # shell + tab bar + FAB; carga pure.js clásico y js/main.js módulo
├── manifest.webmanifest
├── sw.js                 # precache del shell (cache-first, versión BC_CACHE_V1)
├── icons/icon.svg        # icono maskable simple (B sobre fondo #0b0c0e con acento azul)
├── css/tokens.css        # variables de la paleta/tipos/radios (Global Constraints)
├── css/app.css           # layout, tab bar, tarjetas, chips, teclado, listas
├── js/main.js            # arranque: db.init → onboarding si no hay periodo → router de pestañas
├── js/format.js          # fmtEUR(cents), fmtDate, hoyISO
├── js/db.js              # puente de promesas con el worker (init/exec/query)
├── js/db-worker.js       # sqlite-wasm + opfs-sahpool (fallback memoria), aplica schema+seeds
├── js/schema.sql         # DDL completo del contrato
├── js/sql.js             # TODAS las sentencias SQL nombradas (compartidas con tests)
├── js/seeds.js           # cuentas + categorías (port 1:1 de seeds.py)
├── js/category-colors.js # mapa raíz→color + resolución para hojas
├── js/repo.js            # API de dominio sobre db.js usando sql.js + bcUlid
├── js/screens/registro.js
├── js/screens/inicio.js
├── js/screens/placeholder.js  # Movimientos/Patrimonio "próximamente"; Ajustes con export JSON
├── js/onboarding.js      # diálogo "Abrir primer periodo"
└── vendor/
    ├── sqlite-wasm/jswasm/   # sqlite3.mjs + sqlite3.wasm (+ ficheros que el dist requiera)
    ├── fonts/                # woff2 de Plus Jakarta Sans (400,500,600,700) y Space Grotesk (500,700)
    └── pure.js               # symlink NO: copia comentada "fuente: apps_script/pure.js" (GitHub Pages no sigue symlinks)
tests/app/
├── schema.test.mjs
└── repo-sql.test.mjs
```

`app/vendor/` SÍ se commitea (es parte del deploy). Regla de sincronía: si `apps_script/pure.js` cambia, `app/vendor/pure.js` se recopia (nota en README, tarea 5).

---

### Task 1: Vendor (sqlite-wasm + fuentes) y shell estático con tokens del canvas

**Files:**
- Create: `app/index.html`, `app/manifest.webmanifest`, `app/sw.js`, `app/icons/icon.svg`, `app/css/tokens.css`, `app/css/app.css`, `app/vendor/**`, `app/js/format.js`
- Test: inspección + `node --check` no aplica a HTML; verificación de vendor por listado de archivos

**Interfaces:**
- Produces: tokens CSS `--bg --card --border --text --text-2 --text-3 --accent --red --green --radius` + clases `card`, `tabbar`, `fab`, `chip`, `btn-primary`; `fmtEUR(cents)`, `hoyISO()`, `nowIso()` en `js/format.js`; el shell tiene `<main id="screen">` donde cada pantalla se monta y una tab bar con `data-tab="inicio|movimientos|patrimonio|ajustes"` + botón `#btn-registro`.

- [ ] **Step 1: Vendorizar sqlite-wasm**

```bash
cd ~/Documents/apps/BaseCero
TARBALL=$(curl -s https://registry.npmjs.org/@sqlite.org/sqlite-wasm | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['versions'][d['dist-tags']['latest']]['dist']['tarball'])")
curl -sL "$TARBALL" -o /tmp/sqlite-wasm.tgz && mkdir -p /tmp/sqlite-wasm && tar xzf /tmp/sqlite-wasm.tgz -C /tmp/sqlite-wasm
mkdir -p app/vendor/sqlite-wasm/jswasm
cp /tmp/sqlite-wasm/package/sqlite-wasm/jswasm/sqlite3.mjs app/vendor/sqlite-wasm/jswasm/
cp /tmp/sqlite-wasm/package/sqlite-wasm/jswasm/sqlite3.wasm app/vendor/sqlite-wasm/jswasm/
ls -la app/vendor/sqlite-wasm/jswasm/   # deben estar ambos; si el dist trae más .mjs auxiliares que sqlite3.mjs importe, cópialos también
```

- [ ] **Step 2: Vendorizar fuentes woff2**

```bash
mkdir -p app/vendor/fonts
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
curl -s -A "$UA" "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap" -o /tmp/fonts.css
grep -o 'https://fonts.gstatic.com[^)]*' /tmp/fonts.css | sort -u | while read u; do curl -s "$u" -o "app/vendor/fonts/$(basename $u)"; done
ls app/vendor/fonts/ | wc -l   # >= 4 archivos woff2 (latin de cada familia/peso como mínimo)
```
Escribe `app/vendor/fonts/fonts.css` con los `@font-face` del `/tmp/fonts.css` reescribiendo cada `src: url(...)` a la ruta local `./<basename>` (conserva unicode-range del subset latin; puedes omitir los subsets no latinos y sus @font-face).

- [ ] **Step 3: `css/tokens.css` y `css/app.css`**

`tokens.css` (completo):

```css
@import url("../vendor/fonts/fonts.css");
:root {
  --bg: #0b0c0e; --card: #151719; --border: #23272b;
  --text: #e7e9ec; --text-2: #9aa1a9; --text-3: #656c74;
  --accent: #2f6bff; --red: #f87171; --green: #4ade80; --amber: #fbbf24;
  --radius: 20px; --radius-sm: 14px;
  --font-ui: "Plus Jakarta Sans", system-ui, sans-serif;
  --font-num: "Space Grotesk", var(--font-ui);
}
* { box-sizing: border-box; margin: 0; }
html { background: var(--bg); }
body { font-family: var(--font-ui); color: var(--text); background: var(--bg); }
.num { font-family: var(--font-num); font-variant-numeric: tabular-nums; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; }
.btn-primary { background: var(--accent); color: #fff; border: 0; border-radius: var(--radius-sm);
  padding: 16px; width: 100%; font: 600 16px var(--font-ui); cursor: pointer; }
.text-red { color: var(--red); } .text-green { color: var(--green); }
```

`app.css`: layout móvil-first (max-width 480px centrado en PC), `main#screen` con padding y scroll, tab bar fija abajo (4 botones icono+etiqueta, activo en `--accent`, resto `--text-3`) con el botón de registro circular azul 56px a la derecha (según canvas `Main.dc.html` — consúltalo en `design/` para spacing), chips de categoría (contenedor redondeado, icono con fondo tinte al 18 % del color de categoría), teclado numérico en grid 3×4 (botones 64px, `--card` con borde), filas de movimiento (icono 40px con tinte, comercio + categoría en gris, importe `.num` a la derecha). Escribe CSS real y completo para esas clases: `tabbar`, `tab`, `tab.active`, `fab`, `chip`, `chip.active`, `keypad`, `key`, `tx-row`, `tx-icon`, `screen-header`, `field`, `toggle` (interruptor CSS puro con `input[type=checkbox]`).

- [ ] **Step 4: `index.html`, `manifest.webmanifest`, `sw.js`, `icons/icon.svg`, `js/format.js`**

`index.html`:

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0c0e">
<title>BaseCero</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="css/tokens.css">
<link rel="stylesheet" href="css/app.css">
<script src="vendor/pure.js"></script>
</head>
<body>
<main id="screen" aria-live="polite"></main>
<nav class="tabbar">
  <button class="tab active" data-tab="inicio">Inicio</button>
  <button class="tab" data-tab="movimientos">Movimientos</button>
  <button class="tab" data-tab="patrimonio">Patrimonio</button>
  <button class="tab" data-tab="ajustes">Ajustes</button>
  <button class="fab" id="btn-registro" aria-label="Registrar gasto">＋</button>
</nav>
<script type="module" src="js/main.js"></script>
<script>
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
</script>
</body>
</html>
```

(Los iconos de las pestañas: SVG inline sencillos dentro de cada botón — casa, lista, gráfica, engranaje — dibujados a mano de 20×20, trazo 1.5, `currentColor`.)

`manifest.webmanifest`:

```json
{
  "name": "BaseCero", "short_name": "BaseCero", "lang": "es",
  "start_url": ".", "scope": ".", "display": "standalone",
  "background_color": "#0b0c0e", "theme_color": "#0b0c0e",
  "icons": [{ "src": "icons/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }]
}
```

`icons/icon.svg`: cuadrado 512 redondeado `#0b0c0e` con "B" en Space Grotesk… las fuentes no cargan en un SVG suelto: usa un path/texto con `font-family="sans-serif" font-weight="700"` fill `#2f6bff`, y un punto/acento verde. Simple y legible.

`sw.js` (completo):

```js
const CACHE = "bc-v1";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon.svg",
  "css/tokens.css", "css/app.css", "vendor/pure.js", "vendor/fonts/fonts.css",
  "js/main.js", "js/format.js", "js/db.js", "js/db-worker.js", "js/schema.sql",
  "js/sql.js", "js/seeds.js", "js/category-colors.js", "js/repo.js",
  "js/onboarding.js", "js/screens/registro.js", "js/screens/inicio.js",
  "js/screens/placeholder.js",
  "vendor/sqlite-wasm/jswasm/sqlite3.mjs", "vendor/sqlite-wasm/jswasm/sqlite3.wasm"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
```
(Las fuentes woff2 no van en SHELL: se cachean on-miss… NO — cache-first sin escritura no las guardaría. Mantenlo simple y determinista: AÑADE los woff2 de `app/vendor/fonts/` a SHELL con sus nombres reales tras el Step 2.)

`js/format.js` (completo):

```js
const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
export const fmtEUR = (cents) => eur.format((cents ?? 0) / 100);
export const hoyISO = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD en hora local
export const nowIso = () => new Date().toISOString().slice(0, 19) + "Z";
export const fmtDiaLargo = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
```

- [ ] **Step 5: Copiar pure.js al vendor y verificar**

```bash
{ echo "// Copia de apps_script/pure.js — NO editar aquí; fuente única en apps_script/. Regenerar: cp apps_script/pure.js app/vendor/pure.js (conservando esta cabecera)"; cat apps_script/pure.js; } > app/vendor/pure.js
node --check app/vendor/pure.js && echo OK
python3 -m http.server 8765 -d app &  # arrancar, comprobar con curl que index.html y sqlite3.wasm sirven 200, matar el server
curl -so /dev/null -w "%{http_code}\n" http://localhost:8765/vendor/sqlite-wasm/jswasm/sqlite3.wasm
```

- [ ] **Step 6: Commit**

```bash
git add app && git commit -m "feat(app): shell PWA, tokens del canvas, vendor sqlite-wasm y fuentes"
```

### Task 2: `schema.sql`, `seeds.js`, `category-colors.js` + tests con node:sqlite

**Files:**
- Create: `app/js/schema.sql`, `app/js/seeds.js`, `app/js/category-colors.js`
- Test: `tests/app/schema.test.mjs`

**Interfaces:**
- Produces: `schema.sql` (DDL completo, idempotente con `IF NOT EXISTS`); `seeds.js` exporta `SEED_ACCOUNTS` (array de arrays `[id,name,type,opening_balance_cents,display_order]`) y `SEED_CATEGORIES` (`[id,name,parent_id,flow,need_type,display_order]`, `parent_id` `""` en raíces) y `SEED_SQL` (string con los INSERT parametrizables… no: exporta `seedStatements(nowIso)` que devuelve `[{sql, rows}]` listos para ejecutar); `category-colors.js` exporta `colorForCategory(catId, categoriesById) -> "#rrggbb"` (hoja hereda color de su raíz) y `CATEGORY_ICONS` (mapa raíz→emoji o path SVG simple para el MVP: usa emoji: casa 🏠, alimentacion 🛒, restauracion 🍽️, transporte 🚌, coche 🚗, salud ❤️‍🩹, suscripciones 📺, ocio 🎉, ropa 👕, regalos 🎁, impuestos 🧾, otros ▫️, ingresos 💶).

- [ ] **Step 1: Test que fija el esquema y las semillas (falla)**

`tests/app/schema.test.mjs` (ejecutar siempre como `node --test --experimental-sqlite tests/app/`):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { seedStatements, SEED_ACCOUNTS, SEED_CATEGORIES } from "../../app/js/seeds.js";

const schema = readFileSync(new URL("../../app/js/schema.sql", import.meta.url), "utf8");
function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  for (const { sql, rows } of seedStatements("2026-08-24T18:00:00Z"))
    for (const r of rows) db.prepare(sql).run(...r);
  return db;
}

test("esquema aplica y las 8 tablas existen", () => {
  const db = freshDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
  for (const t of ["meta","accounts","categories","periods","transactions","recurring_rules","goals","budgets"])
    assert.ok(tables.includes(t), t);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='schema_version'").get().value, "1");
});

test("semillas: 4 cuentas y 41 categorías con integridad", () => {
  const db = freshDb();
  assert.equal(db.prepare("SELECT COUNT(*) c FROM accounts").get().c, 4);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM categories").get().c, 41);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM categories WHERE parent_id<>'' AND parent_id NOT IN (SELECT id FROM categories)").get().c, 0);
  assert.equal(db.prepare("SELECT name FROM accounts WHERE id='acc-n26'").get().name, "N26");
});

test("CHECKs de enums y de importes positivos", () => {
  const db = freshDb();
  assert.throws(() => db.prepare(
    "INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,status,created_at,updated_at,deleted) VALUES ('x','2026-08-24','p','trampa',100,'acc-n26','pending','t','t',0)").run());
  assert.throws(() => db.prepare(
    "INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,status,created_at,updated_at,deleted) VALUES ('x','2026-08-24','p','expense',-5,'acc-n26','pending','t','t',0)").run());
});

test("solo un periodo open", () => {
  const db = freshDb();
  const ins = db.prepare("INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,?,?,?,0)");
  ins.run("p1","Agosto","2026-08-01","","open",60,"","t","t");
  assert.throws(() => ins.run("p2","Sept","2026-09-01","","open",60,"","t","t"));
});

test("colores: hoja hereda de la raíz", async () => {
  const { colorForCategory } = await import("../../app/js/category-colors.js");
  const byId = Object.fromEntries(SEED_CATEGORIES.map((c) => [c[0], { id: c[0], parent_id: c[2] }]));
  assert.equal(colorForCategory("cat-casa-luz", byId), colorForCategory("cat-casa", byId));
  assert.match(colorForCategory("cat-casa", byId), /^#[0-9a-f]{6}$/i);
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `node --test --experimental-sqlite tests/app/`
Expected: FAIL (archivos no existen). Si tu Node rechaza el flag, prueba sin él (`node:sqlite` puede venir habilitado); documenta en el report cuál funcionó.

- [ ] **Step 3: Implementar `schema.sql`**

DDL completo (transcribir tal cual; tipos y CHECKs son el contrato):

```sql
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version','1'),('currency','EUR'),('created_with','basecero-pwa');

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('checking','savings','liability')),
  opening_balance_cents INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  parent_id TEXT NOT NULL DEFAULT '',
  flow TEXT NOT NULL CHECK (flow IN ('expense','income')),
  need_type TEXT NOT NULL DEFAULT '' CHECK (need_type IN ('need','want','savings','')),
  display_order INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS periods (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('open','closed')),
  my_share_pct REAL NOT NULL DEFAULT 100,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_period ON periods (status) WHERE status='open' AND deleted=0;

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, date TEXT NOT NULL,
  period_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense','income','transfer','refund','adjustment')),
  amount_cents INTEGER NOT NULL CHECK (type='adjustment' OR amount_cents > 0),
  account_id TEXT NOT NULL,
  counter_account_id TEXT NOT NULL DEFAULT '',
  category_id TEXT NOT NULL DEFAULT '',
  merchant TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  is_shared INTEGER NOT NULL DEFAULT 0,
  share_pct_override REAL,
  settled INTEGER NOT NULL DEFAULT 0,
  ref_id TEXT NOT NULL DEFAULT '', rule_id TEXT NOT NULL DEFAULT '',
  external_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reconciled')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS tx_period ON transactions (period_id, deleted);
CREATE INDEX IF NOT EXISTS tx_date ON transactions (date);
CREATE INDEX IF NOT EXISTS tx_category ON transactions (category_id);

CREATE TABLE IF NOT EXISTS recurring_rules (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense','income','transfer')),
  amount_cents INTEGER NOT NULL,
  category_id TEXT NOT NULL DEFAULT '', account_id TEXT NOT NULL,
  counter_account_id TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','yearly')),
  due_day INTEGER, due_month INTEGER,
  is_shared INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('emergency_fund','savings_target','spending_cap','savings_rate','provision')),
  target_amount_cents INTEGER, target_months INTEGER, target_pct REAL, target_date TEXT NOT NULL DEFAULT '',
  account_id TEXT NOT NULL DEFAULT '', category_id TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY, period_id TEXT NOT NULL, category_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
```

- [ ] **Step 4: Implementar `seeds.js` y `category-colors.js`**

`seeds.js`: portar las semillas 1:1 desde `generator/basecero_generator/seeds.py` (fuente canónica en el repo). Mapeo: mismos ids-slug, mismos nombres/parent/flow/need_type/display_order; `opening_balance` → `opening_balance_cents` (0). Estructura exacta:

```js
export const SEED_ACCOUNTS = [
  ["acc-n26", "N26", "checking", 0, 1],
  ["acc-revolut", "Revolut", "savings", 0, 2],
  ["acc-traderepublic", "Trade Republic", "savings", 0, 3],
  ["acc-prestamo-coche", "Préstamo coche", "liability", 0, 4],
];
export const SEED_CATEGORIES = [
  ["cat-casa", "Casa", "", "expense", "need", 10],
  ["cat-casa-alquiler", "Alquiler/Hipoteca", "cat-casa", "expense", "need", 11],
  // …TODAS las filas de seeds.py, en su mismo orden, hasta las 3 de income (41 en total)
];
export function seedStatements(now) {
  return [
    { sql: "INSERT INTO accounts (id,name,type,opening_balance_cents,display_order,is_archived,created_at,updated_at,deleted) VALUES (?,?,?,?,?,0,'" + now + "','" + now + "',0)", rows: SEED_ACCOUNTS },
    { sql: "INSERT INTO categories (id,name,parent_id,flow,need_type,display_order,is_archived,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,0,'" + now + "','" + now + "',0)", rows: SEED_CATEGORIES },
  ];
}
```
(El comentario `// …TODAS las filas` es instrucción de porte desde seeds.py, no una elipsis a dejar: el archivo final contiene las 41 filas literales. El test de 41 lo garantiza.)

`category-colors.js` (completo):

```js
const ROOT_COLORS = {
  "cat-casa": "#8b9ff5", "cat-alimentacion": "#58d68d", "cat-restauracion": "#f0a868",
  "cat-transporte": "#56c6de", "cat-coche": "#ddb455", "cat-ocio": "#e68ab0",
  "cat-salud": "#ec8a84", "cat-suscripciones": "#b08be8",
};
const DEFAULT_COLOR = "#5c646d";
export const CATEGORY_ICONS = {
  "cat-casa": "🏠", "cat-alimentacion": "🛒", "cat-restauracion": "🍽️", "cat-transporte": "🚌",
  "cat-coche": "🚗", "cat-salud": "❤️‍🩹", "cat-suscripciones": "📺", "cat-ocio": "🎉",
  "cat-ropa": "👕", "cat-regalos": "🎁", "cat-impuestos": "🧾", "cat-otros": "▫️",
  "cat-nomina": "💶", "cat-puntuales": "💶", "cat-intereses": "💶",
};
export function rootOf(catId, byId) {
  let c = byId[catId];
  while (c && c.parent_id) c = byId[c.parent_id];
  return c ? c.id : catId;
}
export const colorForCategory = (catId, byId) => ROOT_COLORS[rootOf(catId, byId)] ?? DEFAULT_COLOR;
export const iconForCategory = (catId, byId) => CATEGORY_ICONS[rootOf(catId, byId)] ?? "▫️";
```

- [ ] **Step 5: Verificar en verde y commit**

Run: `node --test --experimental-sqlite tests/app/` → 5 tests PASS. Los tests Node previos del repo (`node --test apps_script/tests/pure.test.mjs`) siguen en verde.

```bash
git add app/js tests/app && git commit -m "feat(app): esquema SQLite del contrato, semillas y colores de categoría"
```

### Task 3: Worker SQLite + puente + `sql.js` + `repo.js`, con tests de las queries

**Files:**
- Create: `app/js/sql.js`, `app/js/db-worker.js`, `app/js/db.js`, `app/js/repo.js`
- Test: `tests/app/repo-sql.test.mjs`

**Interfaces:**
- Consumes: `schema.sql`, `seeds.js` (Task 2); globales `bcUlid` (vendor/pure.js) en el hilo principal.
- Produces: `db.js` → `initDb() -> Promise<{storage:"opfs"|"memory"}>`, `query(sql, params) -> Promise<rows>`, `exec(sql, params) -> Promise<void>`. `repo.js` → `getOpenPeriod()`, `openFirstPeriod({name,startDate,sharePct})`, `addTransaction({type,amountCents,date,categoryId,accountId,merchant,note,isShared})`, `spentOfPeriod(pid)`, `incomeOfPeriod(pid)`, `listByDay(pid)`, `listExpenseLeafCategories()`, `listIncomeCategories()`, `listAccounts()`, `exportAllJson()`. `sql.js` → objeto `SQL` con todas las sentencias (única fuente de SQL).

- [ ] **Step 1: Test de las queries (falla)**

`tests/app/repo-sql.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { SQL } from "../../app/js/sql.js";
import { seedStatements } from "../../app/js/seeds.js";

const schema = readFileSync(new URL("../../app/js/schema.sql", import.meta.url), "utf8");
const T = "2026-08-24T18:00:00Z";
function db() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  for (const { sql, rows } of seedStatements(T)) for (const r of rows) d.prepare(sql).run(...r);
  d.prepare(SQL.insertPeriod).run("p1", "Agosto 2026", "2026-07-27", 60, T, T);
  return d;
}
const tx = (d, over = {}) => {
  const v = { id: "t" + Math.floor(Math.random() * 1e9), date: "2026-08-20", period: "p1", type: "expense",
    cents: 4520, account: "acc-n26", category: "cat-alimentacion-supermercado", merchant: "Mercadona",
    note: "", shared: 0, override: null, ...over };
  d.prepare(SQL.insertTransaction).run(v.id, v.date, v.period, v.type, v.cents, v.account,
    v.category, v.merchant, v.note, v.shared, v.override, T, T);
  return v.id;
};

test("getOpenPeriod devuelve el periodo abierto con su pct", () => {
  const d = db();
  const p = d.prepare(SQL.getOpenPeriod).get();
  assert.equal(p.name, "Agosto 2026"); assert.equal(p.my_share_pct, 60);
});

test("spent: normal entero, compartido 60 % redondeado, override 50 %", () => {
  const d = db();
  tx(d);                                        // 4520 → 4520
  tx(d, { cents: 4520, shared: 1 });            // 60 % → 2712
  tx(d, { cents: 8000, shared: 1, override: 50 }); // → 4000
  assert.equal(d.prepare(SQL.spentOfPeriod).get("p1").spent_cents, 4520 + 2712 + 4000);
});

test("refund sin ref_id resta; income no toca el gasto", () => {
  const d = db();
  tx(d, { cents: 10000 });
  tx(d, { type: "refund", cents: 2500 });       // devolución de tienda, sin vínculo
  tx(d, { type: "income", cents: 180000, category: "cat-nomina" });
  assert.equal(d.prepare(SQL.spentOfPeriod).get("p1").spent_cents, 7500);
  assert.equal(d.prepare(SQL.incomeOfPeriod).get("p1").income_cents, 180000);
});

test("listByDay: orden descendente, incluye my_amount_cents y excluye borrados", () => {
  const d = db();
  tx(d, { date: "2026-08-19", cents: 1000 });
  const borrar = tx(d, { date: "2026-08-20", cents: 2000 });
  tx(d, { date: "2026-08-21", cents: 3000, shared: 1 });
  d.prepare("UPDATE transactions SET deleted=1 WHERE id=?").run(borrar);
  const rows = d.prepare(SQL.listByDay).all("p1");
  assert.deepEqual(rows.map((r) => r.amount_cents), [3000, 1000]);
  assert.equal(rows[0].my_amount_cents, 1800);
});

test("categorías hoja de gasto para los chips (sin raíces con hijas, sin income)", () => {
  const d = db();
  const rows = d.prepare(SQL.listExpenseLeafCategories).all();
  const names = rows.map((r) => r.name);
  assert.ok(names.includes("Supermercado") && names.includes("Ropa y cuidado personal"));
  assert.ok(!names.includes("Casa") && !names.includes("Nómina"));
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `node --test --experimental-sqlite tests/app/` → FAIL (`sql.js` no existe); los de Task 2 siguen en verde.

- [ ] **Step 3: Implementar `sql.js`**

```js
const MY_AMOUNT = `CAST(ROUND(t.amount_cents * (CASE WHEN t.is_shared=1
  THEN COALESCE(t.share_pct_override, p.my_share_pct, 100) ELSE 100 END) / 100.0) AS INTEGER)`;

export const SQL = {
  getOpenPeriod: `SELECT * FROM periods WHERE status='open' AND deleted=0 LIMIT 1`,
  insertPeriod: `INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES (?,?,?,'','open',?,'',?,?,0)`,
  insertTransaction: `INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,counter_account_id,
    category_id,merchant,note,is_shared,share_pct_override,settled,ref_id,rule_id,external_id,status,created_at,updated_at,deleted)
    VALUES (?,?,?,?,?,?,'',?,?,?,?,?,0,'','','','pending',?,?,0)`,
  spentOfPeriod: `SELECT COALESCE(SUM(CASE
      WHEN t.type='expense' THEN ${MY_AMOUNT}
      WHEN t.type='refund' AND t.ref_id='' THEN -t.amount_cents
      ELSE 0 END),0) AS spent_cents
    FROM transactions t JOIN periods p ON p.id=t.period_id
    WHERE t.period_id=? AND t.deleted=0`,
  incomeOfPeriod: `SELECT COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount_cents ELSE 0 END),0) AS income_cents
    FROM transactions t WHERE t.period_id=? AND t.deleted=0`,
  listByDay: `SELECT t.id, t.date, t.type, t.amount_cents, t.category_id, t.merchant, t.note, t.is_shared,
      ${MY_AMOUNT} AS my_amount_cents
    FROM transactions t JOIN periods p ON p.id=t.period_id
    WHERE t.period_id=? AND t.deleted=0 AND t.type IN ('expense','income','refund')
    ORDER BY t.date DESC, t.created_at DESC`,
  listExpenseLeafCategories: `SELECT c.id, c.name FROM categories c
    WHERE c.flow='expense' AND c.deleted=0 AND c.is_archived=0
      AND NOT EXISTS (SELECT 1 FROM categories h WHERE h.parent_id=c.id AND h.deleted=0)
    ORDER BY c.display_order`,
  listIncomeCategories: `SELECT c.id, c.name FROM categories c
    WHERE c.flow='income' AND c.deleted=0 AND c.is_archived=0 ORDER BY c.display_order`,
  listAccounts: `SELECT id, name, type FROM accounts WHERE deleted=0 AND is_archived=0 ORDER BY display_order`,
  allCategories: `SELECT id, name, parent_id FROM categories WHERE deleted=0`,
  dumpTable: (t) => `SELECT * FROM ${t}`,   // solo para exportAllJson; t viene de la lista fija de tablas
};
export const TABLES = ["meta","accounts","categories","periods","transactions","recurring_rules","goals","budgets"];
```

- [ ] **Step 4: Implementar `db-worker.js` y `db.js`**

`db-worker.js` (module worker):

```js
import sqlite3InitModule from "../vendor/sqlite-wasm/jswasm/sqlite3.mjs";
import { seedStatements } from "./seeds.js";

let db = null, storage = "opfs";

async function init() {
  const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: console.error });
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "basecero" });
    db = new pool.OpfsSAHPoolDb("/basecero.sqlite3");
  } catch (e) {
    storage = "memory";
    db = new sqlite3.oo1.DB(":memory:", "c");
  }
  const schema = await (await fetch(new URL("./schema.sql", import.meta.url))).text();
  db.exec(schema);
  const seeded = db.selectValue("SELECT COUNT(*) FROM accounts");
  if (seeded === 0) {
    const now = new Date().toISOString().slice(0, 19) + "Z";
    for (const { sql, rows } of seedStatements(now)) for (const r of rows) db.exec({ sql, bind: r });
  }
  return { storage };
}

self.onmessage = async (e) => {
  const { id, op, sql, params } = e.data;
  try {
    if (op === "init") { const r = await init(); postMessage({ id, ...r }); return; }
    if (op === "query") {
      const rows = [];
      db.exec({ sql, bind: params ?? [], rowMode: "object", resultRows: rows });
      postMessage({ id, rows }); return;
    }
    if (op === "exec") { db.exec({ sql, bind: params ?? [] }); postMessage({ id, rows: [] }); return; }
    postMessage({ id, error: "op desconocida: " + op });
  } catch (err) { postMessage({ id, error: String(err && err.message || err) }); }
};
```

Nota de adaptación permitida: la API exacta de `installOpfsSAHPoolVfs`/`OpfsSAHPoolDb` debe cotejarse con el `sqlite3.mjs` vendorizado (búscala en el propio archivo); si el nombre difiere en la versión descargada, adapta MINIMAMENTE manteniendo el comportamiento (OPFS persistente con fallback a memoria) y documenta el cambio en el report.

`db.js` (completo):

```js
let worker = null, seq = 0;
const pending = new Map();

function call(op, sql, params) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, op, sql, params });
  });
}

export function initDb() {
  worker = new Worker(new URL("./db-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const { id, error, ...rest } = e.data;
    const p = pending.get(id); if (!p) return;
    pending.delete(id);
    error ? p.reject(new Error(error)) : p.resolve(rest);
  };
  return call("init");
}
export const query = (sql, params = []) => call("query", sql, params).then((r) => r.rows);
export const exec = (sql, params = []) => call("exec", sql, params).then(() => {});
```

- [ ] **Step 5: Implementar `repo.js`**

```js
import { SQL, TABLES } from "./sql.js";
import { query, exec } from "./db.js";
import { nowIso } from "./format.js";

export async function getOpenPeriod() { return (await query(SQL.getOpenPeriod))[0] ?? null; }

export async function openFirstPeriod({ name, startDate, sharePct }) {
  const t = nowIso();
  await exec(SQL.insertPeriod, [bcUlid(), name, startDate, sharePct, t, t]);
}

export async function addTransaction({ type, amountCents, date, categoryId, accountId, merchant, note, isShared }) {
  const p = await getOpenPeriod();
  if (!p) throw new Error("No hay ningún periodo abierto");
  const t = nowIso();
  await exec(SQL.insertTransaction, [bcUlid(), date, p.id, type, amountCents, accountId,
    categoryId, bcSanitizeCell(merchant ?? ""), bcSanitizeCell(note ?? ""),
    isShared ? 1 : 0, null, t, t]);
}

export const spentOfPeriod = async (pid) => (await query(SQL.spentOfPeriod, [pid]))[0].spent_cents;
export const incomeOfPeriod = async (pid) => (await query(SQL.incomeOfPeriod, [pid]))[0].income_cents;
export const listByDay = (pid) => query(SQL.listByDay, [pid]);
export const listExpenseLeafCategories = () => query(SQL.listExpenseLeafCategories);
export const listIncomeCategories = () => query(SQL.listIncomeCategories);
export const listAccounts = () => query(SQL.listAccounts);
export const allCategoriesById = async () =>
  Object.fromEntries((await query(SQL.allCategories)).map((c) => [c.id, c]));

export async function exportAllJson() {
  const out = {};
  for (const t of TABLES) out[t] = await query(SQL.dumpTable(t));
  return out;
}
```
(`bcUlid`/`bcSanitizeCell` son globales del `vendor/pure.js` cargado en `index.html`; los tests de este task NO importan `repo.js` — validan `sql.js` directamente, por eso no necesitan esos globales.)

- [ ] **Step 6: Verificar en verde y commit**

Run: `node --test --experimental-sqlite tests/app/` → 10 tests PASS (5 de Task 2 + 5 nuevos).

```bash
git add app/js tests/app && git commit -m "feat(app): worker SQLite con OPFS, puente de promesas y repositorio de dominio"
```

### Task 4: Onboarding + pantalla de Registro rápido + router

**Files:**
- Create: `app/js/main.js`, `app/js/onboarding.js`, `app/js/screens/registro.js`
- Verificación: `node --check` de cada archivo + arranque manual del server (la verificación en navegador real es la Task 6)

**Interfaces:**
- Consumes: todo lo de Tasks 1-3.
- Produces: `main.js` arranca la app (initDb → aviso si storage="memory" → `navigator.storage.persist()` → onboarding si no hay periodo → nav("inicio")) y expone la navegación por tabs; `showOnboarding(container) -> Promise<void>` (resuelve con el periodo creado); `renderRegistro(container, onSaved)` monta la pantalla completa.

- [ ] **Step 1: `main.js`**

```js
import { initDb } from "./db.js";
import { getOpenPeriod } from "./repo.js";
import { showOnboarding } from "./onboarding.js";
import { renderInicio } from "./screens/inicio.js";
import { renderRegistro } from "./screens/registro.js";
import { renderProximamente, renderAjustes } from "./screens/placeholder.js";

const screen = document.getElementById("screen");
const RUTAS = {
  inicio: () => renderInicio(screen),
  movimientos: () => renderProximamente(screen, "Movimientos"),
  patrimonio: () => renderProximamente(screen, "Patrimonio"),
  ajustes: () => renderAjustes(screen),
};

export function nav(tab) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  RUTAS[tab]();
}

async function boot() {
  const { storage } = await initDb();
  if (storage === "memory") {
    const aviso = document.createElement("div");
    aviso.className = "banner-aviso";
    aviso.textContent = "⚠ Este navegador no soporta almacenamiento persistente: tus datos NO se guardarán al cerrar.";
    document.body.prepend(aviso);
  }
  try { await navigator.storage?.persist?.(); } catch {}
  if (!(await getOpenPeriod())) await showOnboarding(screen);
  nav("inicio");
}

document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => nav(b.dataset.tab)));
document.getElementById("btn-registro").onclick = () => renderRegistro(screen, () => nav("inicio"));
boot();
```
(Añade `.banner-aviso` a `app.css`: franja roja tenue fija arriba.)

- [ ] **Step 2: `onboarding.js`**

Pantalla completa (no modal) montada en el container: título "Abre tu primer periodo", explicación de una línea ("Tu mes empieza cuando tú lo digas — normalmente, el día que cobras"), campo nombre precargado con el mes actual capitalizado en español (`new Date().toLocaleDateString("es-ES",{month:"long",year:"numeric"})` → "agosto de 2026" → capitaliza y quita "de": "Agosto 2026"), campo fecha (`input type="date"`, valor `hoyISO()`), campo "% de los gastos compartidos que pagas tú" (`input type="number"` 0-100, valor 50, con ayuda "Sara pagará el resto"), botón `.btn-primary` "Abrir periodo" → `openFirstPeriod(...)` → resuelve la promesa. Deshabilita el botón mientras guarda. Código completo con esa estructura (usa template literals + `container.innerHTML` y luego `querySelector` para los handlers — el patrón de render de toda la app).

- [ ] **Step 3: `screens/registro.js` — la pantalla estrella**

Estructura (del canvas `Registro`/`Main.dc.html`, consultable en `design/`):

```js
import { addTransaction, getOpenPeriod, listExpenseLeafCategories, listIncomeCategories,
         listAccounts, allCategoriesById } from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtEUR, hoyISO } from "../format.js";
```

Comportamiento y elementos (implementar completo):
- Estado local: `{ tipo: "expense", cents: 0, categoryId: null, accountId: "acc-n26", isShared: false, fecha: hoyISO(), merchant: "", note: "" }`.
- Cabecera con "Registrar" y botón ✕ (vuelve con `onSaved` sin guardar… no: ✕ llama a `onCancel` = mismo callback; nómbralo `onDone`).
- Segmented control `Gasto | Ingreso` (transfer llega en fase 2): cambia `tipo` y recarga los chips de categoría (expense→hojas de gasto; income→las 3 de ingreso).
- Display del importe: `.num` a 56px, se alimenta del teclado propio: dígitos, coma (máx. 2 decimales) y ⌫. El estado interno son SIEMPRE céntimos (`cents`); la coma solo gobierna la entrada (mantén un string de entrada `raw` y deriva `cents = Math.round(parseFloat(raw.replace(",", ".") || "0") * 100)`).
- Chips de categoría scrollables en 2 filas: icono (emoji de `iconForCategory`) en contenedor con fondo `color + "2e"` (tinte ~18 %), nombre debajo, seleccionado con borde `--accent`.
- Selector de cuenta: chips horizontales (N26 activa por defecto; excluir `liability`).
- Campo comercio y nota (inputs de línea, opcionales), fecha editable (`input type="date"`).
- Toggle "Compartido con Sara": al activarse muestra la tarjeta de desglose calculada con `my_share_pct` del periodo abierto (cárgalo al montar): "Tu parte X · Sara Y" con `X = Math.round(cents*pct/100)`, actualizada al teclear.
- Botón "Guardar gasto" (o "Guardar ingreso"): valida `cents>0` y `categoryId` elegido (si no, shake/aviso), llama `addTransaction`, y `onDone()`.

- [ ] **Step 4: Verificar sintaxis y commit**

```bash
for f in app/js/main.js app/js/onboarding.js app/js/screens/registro.js; do node --check "$f" || exit 1; done
node --test --experimental-sqlite tests/app/   # sin regresiones
git add app && git commit -m "feat(app): onboarding de primer periodo y pantalla de registro rápido"
```

### Task 5: Pantalla Inicio + placeholders + Ajustes con export JSON

**Files:**
- Create: `app/js/screens/inicio.js`, `app/js/screens/placeholder.js`
- Modify: `app/css/app.css` (estilos que falten para las listas)

**Interfaces:**
- Consumes: `repo.js`, `category-colors.js`, `format.js`.
- Produces: `renderInicio(container)`; `renderProximamente(container, titulo)`; `renderAjustes(container)`.

- [ ] **Step 1: `screens/inicio.js`**

Implementación completa con esta estructura:
- Carga en paralelo: `getOpenPeriod()`, y con su id `spentOfPeriod`, `incomeOfPeriod`, `listByDay`, `allCategoriesById`.
- **Tarjeta de cabecera** (canvas `Resumen`): nombre del periodo + "desde el {start_date formateada}" en gris; "Gastado" con el importe grande `.num`; debajo, en fila: Ingresos (verde) · Ahorrado (`income - spent`, verde/rojo según signo) · Tasa ("—" si ingresos 0, si no `ahorrado/ingresos` en %).
- **Movimientos**: agrupados por `date` (cabecera de grupo con `fmtDiaLargo` y "HOY" si es hoy); cada fila: icono de categoría en su tinte, comercio (o nombre de categoría si no hay comercio) + subtítulo gris (nombre de categoría; si `is_shared`, añade " · tu parte {fmtEUR(my_amount_cents)}"), importe a la derecha `.num`: gastos `-X` en rojo, ingresos `+X` en verde, refunds `+X` en verde.
- Estado vacío (sin movimientos): mensaje centrado "Registra tu primer gasto con el botón ＋" con el gris `--text-3`.

- [ ] **Step 2: `screens/placeholder.js`**

```js
import { exportAllJson } from "../repo.js";
import { hoyISO } from "../format.js";

export function renderProximamente(container, titulo) {
  container.innerHTML = `<header class="screen-header"><h1>${titulo}</h1></header>
    <div class="card" style="text-align:center;color:var(--text-2)">
      <p style="font-size:32px">🚧</p><p>Llega en la fase 2.</p></div>`;
}

export function renderAjustes(container) {
  container.innerHTML = `<header class="screen-header"><h1>Ajustes</h1></header>
    <div class="card" style="margin-bottom:12px">
      <p>🔒 <strong>Tus datos viven solo en este dispositivo.</strong></p>
      <p style="color:var(--text-2);font-size:14px;margin-top:6px">
        Sin cuentas, sin nube. Haz copias con el export mientras llega el export .xlsx de la fase 2.</p></div>
    <button class="btn-primary" id="btn-export">Exportar copia de seguridad (JSON)</button>`;
  container.querySelector("#btn-export").onclick = async () => {
    const data = await exportAllJson();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"),
      { href: URL.createObjectURL(blob), download: `basecero-backup-${hoyISO()}.json` });
    a.click(); URL.revokeObjectURL(a.href);
  };
}
```

- [ ] **Step 3: Verificar y commit**

```bash
for f in app/js/screens/inicio.js app/js/screens/placeholder.js; do node --check "$f" || exit 1; done
node --test --experimental-sqlite tests/app/
git add app && git commit -m "feat(app): pantalla Inicio, placeholders y export JSON de emergencia"
```

### Task 6: QA E2E en navegador real (Playwright) + arreglos

**Files:**
- Modify: los que el QA revele (arreglos pequeños dentro de la tarea; bump de `CACHE` en `sw.js` en cada arreglo que toque archivos cacheados)
- Produce: capturas en el scratchpad de la sesión (el controlador se las enseña al usuario)

**Interfaces:**
- Consumes: la app completa. Herramientas MCP de Playwright (cargarlas con ToolSearch: `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_take_screenshot`, `browser_evaluate`, `browser_close`); el MCP está configurado con Chrome.

- [ ] **Step 1: Servir la app**

```bash
cd ~/Documents/apps/BaseCero && python3 -m http.server 8765 -d app &
```
(Recuerda matarlo al acabar. OPFS funciona en localhost por ser contexto seguro.)

- [ ] **Step 2: Flujo E2E completo con Playwright**

1. `browser_navigate` a `http://localhost:8765` → snapshot: debe aparecer el onboarding "Abre tu primer periodo".
2. Completa el onboarding (nombre autogenerado, fecha por defecto, 60 %) → "Abrir periodo".
3. Registra 3 movimientos con el botón ＋: (a) gasto 45,20 € Supermercado en N26; (b) gasto 90,00 € Restaurantes COMPARTIDO (verifica en el snapshot que el desglose muestra "Tu parte 54,00 €" con 60 %); (c) ingreso 1.800,00 € Nómina.
4. En Inicio verifica: Gastado = `99,20 €` (45,20 + 54,00), Ingresos `1.800,00 €`, y las tres filas con sus signos/colores.
5. **Persistencia**: `browser_navigate` de nuevo a la URL (recarga completa) → los datos siguen. Después `browser_evaluate` → `navigator.serviceWorker.getRegistrations().then(r=>r.length)` ≥ 1.
6. **Offline del shell**: con el server matado, recarga → la app debe cargar desde el SW (los datos son locales). Reactiva el server después.
7. `browser_take_screenshot` de: onboarding, registro con desglose de Sara visible, Inicio con los 3 movimientos. Guárdalas en el scratchpad de la sesión.
8. Contrasta visualmente contra `design/Registro… (los .dc.html)`: paleta oscura, chips con tinte, importes tabulares. Ajusta CSS si algo chirría (cambios pequeños; los grandes se reportan).

- [ ] **Step 3: Arreglos + re-verificación**

Cada bug encontrado: arréglalo, bump `CACHE` en `sw.js` si tocaste archivos cacheados, repite el paso del flujo que falló. Mantén `node --test --experimental-sqlite tests/app/` en verde.

- [ ] **Step 4: Commit final**

```bash
git add app && git commit -m "feat(app): QA E2E en navegador y ajustes de la fase 1"
```
