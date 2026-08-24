# BaseCero PWA Fase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Terminar la PWA: motor xlsx round-trip (el dato canónico es la hoja), registro de los 5 tipos, Movimientos con edición, periodos/presupuestos, recurrentes/previsión, Patrimonio/objetivos, gráficas, import CSV N26 y publicación en GitHub Pages.

**Architecture:** Se amplía la app vanilla de fase 1 (ES modules, sqlite-wasm opfs-sahpool en worker, SQL centralizada en `sql.js` compartida con tests Node). Toda la lógica nueva no-UI vive en módulos puros testeables (`contract.js`, `xlsx.js`, `prevision.js`, `charts.js`, `n26.js`); las pantallas siguen el patrón de `registro.js` (estado local + re-render completo). Las escrituras multi-sentencia usan una nueva op transaccional `execMany` del worker.

**Tech Stack:** Vanilla JS (sin build, sin npm en runtime), sqlite-wasm vendorizado, SheetJS CE standalone vendorizado, `node --test` + `node:sqlite` para tests, GitHub Pages via Action.

**Spec:** `docs/specs/2026-08-24-app-pwa-fase2-design.md` (y el contrato `docs/specs/2026-08-24-basecero-hoja-calculo-design.md`, autoridad de datos).

## Global Constraints

- Vanilla JS, **sin build step y sin npm en runtime**; dependencias solo vendorizadas a mano en `app/vendor/`.
- `apps_script/pure.js` **no se modifica**; su copia `app/vendor/pure.js` tampoco (fuente única en `apps_script/`). Se consume vía globales `bc*`.
- Importes en **céntimos INTEGER** en SQLite; **euros número** en el xlsx. Fechas TEXT ISO `YYYY-MM-DD`. Booleanos INTEGER 0/1 en SQLite; boolean de celda en xlsx.
- UI en español; nombres de tablas/columnas en inglés snake_case (contrato).
- Diseño: réplica de los artboards `design/*.dc.html` con los tokens ya existentes en `app/css/tokens.css`. Colores de categoría de `app/js/category-colors.js`.
- Toda SQL nueva se añade a `app/js/sql.js` (nunca SQL inline en pantallas) para que los tests Node la ejerciten idéntica.
- Tests: `node --experimental-sqlite --test tests/app/` (patrón de `tests/app/repo-sql.test.mjs`: `node:sqlite` + `app/js/schema.sql` + `SQL` importada). Deben seguir pasando los existentes (app 10/10) y `cd generator && .venv/bin/python -m pytest` (22/22).
- **No** tocar `app/sw.js` (CACHE/SHELL) hasta la Task 16 — un solo bump al final.
- Commit al final de cada tarea. Mensajes en español, prefijo `feat(app):`/`fix(app):`/`test(app):`.
- La cuenta semilla N26 tiene `id='acc-n26'`, nombre `N26` — no renombrable (rompe el dedupe del import CSV).
- Pantallas: patrón de `app/js/screens/registro.js` — función `render*(container, ...)`, objeto `state`, re-render completo con `container.innerHTML`, listeners recableados tras cada render.

---

## File Structure

```
app/vendor/xlsx/xlsx.full.min.js      # NUEVO — SheetJS CE standalone (UMD: global XLSX en browser, require() en Node)
app/js/contract.js                    # NUEVO — metadatos del contrato: columnas por tabla, enums, FKs, converters
app/js/xlsx.js                        # NUEVO — rowsToWorkbook / workbookToRows / validateImport (puros)
app/js/prevision.js                   # NUEVO — periodMonth / ruleApplies / myAmountOfRule (puros)
app/js/charts.js                      # NUEVO — barChartSvg / donutSvg / sparklineSvg (puros, devuelven string SVG)
app/js/n26.js                         # NUEVO — importN26Csv (usa pure.js + crypto.subtle + repo)
app/js/sql.js                         # MODIF — insertTransaction full-params, fix MY_AMOUNT refund, ~25 queries nuevas
app/js/repo.js                        # MODIF — API ampliada (ver Interfaces de cada task)
app/js/db.js / app/js/db-worker.js    # MODIF — nueva op transaccional execMany
app/js/main.js                        # MODIF — rutas nuevas, chrome oculto en onboarding
app/js/onboarding.js                  # MODIF — delega en el asistente de periodo (modo 'first')
app/js/screens/registro.js            # MODIF — 5 tipos + precarga desde regla
app/js/screens/inicio.js              # MODIF — gráficas, Con Sara, Previsión, Ver presupuesto
app/js/screens/movimientos.js         # NUEVO — lista + detalle editar/borrar + bandeja sin categorizar
app/js/screens/liquidar.js            # NUEVO — compartidos pendientes de Sara
app/js/screens/periodo-nuevo.js       # NUEVO — asistente Nuevo periodo (modos 'first'/'next')
app/js/screens/presupuesto.js         # NUEVO — pantalla Presupuesto
app/js/screens/recurrentes.js         # NUEVO — CRUD de recurring_rules
app/js/screens/patrimonio.js          # NUEVO — patrimonio + cuentas + objetivos + formularios
app/js/screens/ajustes.js             # NUEVO — sustituye renderAjustes de placeholder.js (export/import xlsx, JSON, N26)
app/js/screens/placeholder.js         # MODIF — queda solo si algo lo usa; Movimientos/Patrimonio dejan de usarlo
app/icons/icon-maskable.svg           # NUEVO — arte en zona segura 80 %
app/index.html                        # MODIF — <script> de SheetJS, tab bar sin cambios
app/manifest.webmanifest              # MODIF — icons split any/maskable
app/sw.js                             # MODIF (solo Task 16) — CACHE bump + SHELL ampliado
.github/workflows/pages.yml           # NUEVO — deploy de app/ a GitHub Pages
tests/app/contract.test.mjs           # NUEVO
tests/app/xlsx.test.mjs               # NUEVO — incluye el round-trip (test crítico)
tests/app/tipos.test.mjs              # NUEVO — 5 tipos + MY_AMOUNT refund
tests/app/movimientos.test.mjs        # NUEVO
tests/app/sara.test.mjs               # NUEVO
tests/app/periodos.test.mjs           # NUEVO
tests/app/presupuesto.test.mjs        # NUEVO
tests/app/recurrentes.test.mjs        # NUEVO
tests/app/prevision.test.mjs          # NUEVO
tests/app/patrimonio.test.mjs         # NUEVO
tests/app/n26.test.mjs                # NUEVO
```

Helper de tests compartido (ya existe el patrón en `tests/app/repo-sql.test.mjs`): cada test abre `new DatabaseSync(":memory:")` de `node:sqlite`, ejecuta `app/js/schema.sql`, e inserta lo que necesite. Extraer en Task 2 un `tests/app/helpers.mjs` con `openDb()` y `seedMinimal(db)` (un periodo open `per-1` con `my_share_pct=60`, cuentas `acc-n26`/`acc-revolut` (savings)/`acc-prestamo` (liability, opening −600000), categorías `cat-casa` (raíz expense) → `cat-casa-alquiler` (hoja), `cat-nomina` (income), timestamps `"2026-08-01T00:00:00Z"`).

---

### Task 1: Vendor SheetJS + `contract.js` (metadatos del contrato)

**Files:**
- Create: `app/vendor/xlsx/xlsx.full.min.js` (descarga), `app/js/contract.js`
- Modify: `app/index.html` (añadir script)
- Test: `tests/app/contract.test.mjs`

**Interfaces:**
- Consumes: nada (base de la fase).
- Produces (usado por Tasks 2-4):
  - `CONTRACT`: `{ [tabla]: { cols: string[] } }` — columnas SQLite en orden canónico (exactas del `schema.sql`).
  - `ENUMS`: `{ [tabla]: { [col]: string[] } }`
  - `BOOL_COLS`: `{ [tabla]: string[] }`
  - `FKS`: `[{ table, col, ref, optional }]`
  - `eurToCents(v:number) → int` · `centsToEur(c:int) → number` · `toIsoDate(v:any) → string` · `xlsxHeader(col) → string` (quita `_cents`) · `insertSql(table) → string`

- [ ] **Step 1: Vendorizar SheetJS CE**

```bash
mkdir -p app/vendor/xlsx
curl -fL https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js -o app/vendor/xlsx/xlsx.full.min.js
head -c 400 app/vendor/xlsx/xlsx.full.min.js   # verificar que es JS (banner Apache-2.0), no HTML de error
```

Si la URL fallara, alternativa: `https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js` (misma API para lo que usamos: `read`, `utils.aoa_to_sheet`, `utils.sheet_to_json`, `book_new/book_append_sheet`, `write`).

En `app/index.html`, tras la línea del script de `vendor/pure.js`, añadir:

```html
<script src="vendor/xlsx/xlsx.full.min.js"></script>
```

- [ ] **Step 2: Test que fija el contrato**

`tests/app/contract.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTRACT, ENUMS, eurToCents, centsToEur, toIsoDate, xlsxHeader, insertSql } from "../../app/js/contract.js";

test("columnas canónicas de transactions (orden del schema)", () => {
  assert.deepEqual(CONTRACT.transactions.cols, [
    "id","date","period_id","type","amount_cents","account_id","counter_account_id",
    "category_id","merchant","note","is_shared","share_pct_override","settled",
    "ref_id","rule_id","external_id","status","created_at","updated_at","deleted"]);
});
test("las 8 tablas del contrato", () => {
  assert.deepEqual(Object.keys(CONTRACT),
    ["meta","accounts","categories","periods","transactions","recurring_rules","goals","budgets"]);
});
test("conversión euros/céntimos con redondeo", () => {
  assert.equal(eurToCents(12.34), 1234);
  assert.equal(eurToCents(0.1 + 0.2), 30);       // flotantes
  assert.equal(centsToEur(1234), 12.34);
});
test("toIsoDate normaliza string, serial de Excel y Date", () => {
  assert.equal(toIsoDate("2026-08-24"), "2026-08-24");
  assert.equal(toIsoDate("2026-08-24T00:00:00Z"), "2026-08-24");
  assert.equal(toIsoDate(46258), "2026-08-24");   // serial Excel de 2026-08-24
  assert.equal(toIsoDate(new Date(Date.UTC(2026, 7, 24))), "2026-08-24");
});
test("xlsxHeader quita _cents", () => {
  assert.equal(xlsxHeader("amount_cents"), "amount");
  assert.equal(xlsxHeader("merchant"), "merchant");
});
test("insertSql genera placeholders", () => {
  assert.equal(insertSql("meta"), "INSERT INTO meta (key,value) VALUES (?,?)");
});
test("enums del contrato", () => {
  assert.deepEqual(ENUMS.transactions.type, ["expense","income","transfer","refund","adjustment"]);
  assert.deepEqual(ENUMS.recurring_rules.frequency, ["weekly","monthly","quarterly","yearly"]);
});
```

- [ ] **Step 3: Verificar que falla** — `node --experimental-sqlite --test tests/app/contract.test.mjs` → FAIL (módulo no existe).

- [ ] **Step 4: Implementar `app/js/contract.js`**

```js
// Metadatos del contrato de datos (docs/specs/2026-08-24-basecero-hoja-calculo-design.md).
// Columnas en el orden exacto de app/js/schema.sql: insertSql y el motor xlsx dependen de ese orden.
export const CONTRACT = {
  meta: { cols: ["key","value"] },
  accounts: { cols: ["id","name","type","opening_balance_cents","display_order","is_archived","created_at","updated_at","deleted"] },
  categories: { cols: ["id","name","parent_id","flow","need_type","display_order","is_archived","created_at","updated_at","deleted"] },
  periods: { cols: ["id","name","start_date","end_date","status","my_share_pct","notes","created_at","updated_at","deleted"] },
  transactions: { cols: ["id","date","period_id","type","amount_cents","account_id","counter_account_id","category_id","merchant","note","is_shared","share_pct_override","settled","ref_id","rule_id","external_id","status","created_at","updated_at","deleted"] },
  recurring_rules: { cols: ["id","name","type","amount_cents","category_id","account_id","counter_account_id","frequency","due_day","due_month","is_shared","is_active","created_at","updated_at","deleted"] },
  goals: { cols: ["id","name","type","target_amount_cents","target_months","target_pct","target_date","account_id","category_id","is_active","created_at","updated_at","deleted"] },
  budgets: { cols: ["id","period_id","category_id","amount_cents","created_at","updated_at","deleted"] },
};

export const ENUMS = {
  accounts: { type: ["checking","savings","liability"] },
  categories: { flow: ["expense","income"], need_type: ["need","want","savings",""] },
  periods: { status: ["open","closed"] },
  transactions: { type: ["expense","income","transfer","refund","adjustment"], status: ["pending","reconciled"] },
  recurring_rules: { type: ["expense","income","transfer"], frequency: ["weekly","monthly","quarterly","yearly"] },
  goals: { type: ["emergency_fund","savings_target","spending_cap","savings_rate","provision"] },
};

export const BOOL_COLS = {
  accounts: ["is_archived","deleted"], categories: ["is_archived","deleted"],
  periods: ["deleted"], transactions: ["is_shared","settled","deleted"],
  recurring_rules: ["is_shared","is_active","deleted"], goals: ["is_active","deleted"],
  budgets: ["deleted"], meta: [],
};

// optional=true → '' permitido (FK vacía). ref_id/rule_id/parent_id/counter_account_id son opcionales por contrato.
export const FKS = [
  { table: "categories", col: "parent_id", ref: "categories", optional: true },
  { table: "transactions", col: "period_id", ref: "periods", optional: false },
  { table: "transactions", col: "account_id", ref: "accounts", optional: false },
  { table: "transactions", col: "counter_account_id", ref: "accounts", optional: true },
  { table: "transactions", col: "category_id", ref: "categories", optional: true },
  { table: "transactions", col: "ref_id", ref: "transactions", optional: true },
  { table: "transactions", col: "rule_id", ref: "recurring_rules", optional: true },
  { table: "recurring_rules", col: "category_id", ref: "categories", optional: true },
  { table: "recurring_rules", col: "account_id", ref: "accounts", optional: false },
  { table: "recurring_rules", col: "counter_account_id", ref: "accounts", optional: true },
  { table: "goals", col: "account_id", ref: "accounts", optional: true },
  { table: "goals", col: "category_id", ref: "categories", optional: true },
  { table: "budgets", col: "period_id", ref: "periods", optional: false },
  { table: "budgets", col: "category_id", ref: "categories", optional: false },
];

export const eurToCents = (v) => Math.round(Number(v) * 100);
export const centsToEur = (c) => Math.round(c) / 100;
export const xlsxHeader = (col) => col.replace(/_cents$/, "");

// Serial de Excel: días desde 1899-12-30 (25569 = 1970-01-01).
export function toIsoDate(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number") return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

export const insertSql = (table) =>
  `INSERT INTO ${table} (${CONTRACT[table].cols.join(",")}) VALUES (${CONTRACT[table].cols.map(() => "?").join(",")})`;
```

- [ ] **Step 5: Verificar** — mismo comando → PASS. Nota sobre el serial 46258: si el test fallara por ±1, calcular el serial correcto con `Math.round(Date.UTC(2026,7,24)/86400000)+25569` y fijar ese valor en el test (el helper es UTC puro, sin DST).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(app): vendor SheetJS y metadatos del contrato (contract.js)"`

---

### Task 2: Export xlsx (`rowsToWorkbook`) + helper de tests

**Files:**
- Create: `app/js/xlsx.js`, `tests/app/helpers.mjs`
- Test: `tests/app/xlsx.test.mjs`

**Interfaces:**
- Consumes: `contract.js` (Task 1); global `XLSX` (en tests: `createRequire`).
- Produces: `rowsToWorkbook(X, dump) → workbook` donde `dump = { [tabla]: rows[] }` con filas SQLite (objetos col→valor). Task 4 lo usa para exportar y para el backup pre-import.

- [ ] **Step 1: Crear `tests/app/helpers.mjs`**

```js
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const X = require("../../app/vendor/xlsx/xlsx.full.min.js");

const T = "2026-08-01T00:00:00Z";
export function openDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../../app/js/schema.sql", import.meta.url), "utf8"));
  return db;
}
export function seedMinimal(db) {
  const ins = (sql, ...p) => db.prepare(sql).run(...p);
  ins(`INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
       VALUES ('per-1','Agosto 2026','2026-07-27','','open',60,'',?,?,0)`, T, T);
  ins(`INSERT INTO accounts (id,name,type,opening_balance_cents,display_order,is_archived,created_at,updated_at,deleted)
       VALUES ('acc-n26','N26','checking',100000,1,0,?,?,0)`, T, T);
  ins(`INSERT INTO accounts (id,name,type,opening_balance_cents,display_order,is_archived,created_at,updated_at,deleted)
       VALUES ('acc-revolut','Revolut','savings',50000,2,0,?,?,0)`, T, T);
  ins(`INSERT INTO accounts (id,name,type,opening_balance_cents,display_order,is_archived,created_at,updated_at,deleted)
       VALUES ('acc-prestamo','Préstamo coche','liability',-600000,4,0,?,?,0)`, T, T);
  ins(`INSERT INTO categories (id,name,parent_id,flow,need_type,display_order,is_archived,created_at,updated_at,deleted)
       VALUES ('cat-casa','Casa','','expense','need',1,0,?,?,0)`, T, T);
  ins(`INSERT INTO categories (id,name,parent_id,flow,need_type,display_order,is_archived,created_at,updated_at,deleted)
       VALUES ('cat-casa-alquiler','Alquiler/Hipoteca','cat-casa','expense','need',1,0,?,?,0)`, T, T);
  ins(`INSERT INTO categories (id,name,parent_id,flow,need_type,display_order,is_archived,created_at,updated_at,deleted)
       VALUES ('cat-nomina','Nómina','','income','',1,0,?,?,0)`, T, T);
}
export const dumpAll = (db) => {
  const out = {};
  for (const t of ["meta","accounts","categories","periods","transactions","recurring_rules","goals","budgets"])
    out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return out;
};
```

- [ ] **Step 2: Test de export** (`tests/app/xlsx.test.mjs`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, seedMinimal, dumpAll, X } from "./helpers.mjs";
import { rowsToWorkbook } from "../../app/js/xlsx.js";

test("export: pestaña por tabla, euros, bools y cabeceras sin _cents", () => {
  const db = openDb(); seedMinimal(db);
  const wb = rowsToWorkbook(X, dumpAll(db));
  assert.deepEqual(wb.SheetNames, ["meta","accounts","categories","periods","transactions","recurring_rules","goals","budgets"]);
  const rows = X.utils.sheet_to_json(wb.Sheets.accounts, { defval: "" });
  const n26 = rows.find((r) => r.id === "acc-n26");
  assert.equal(n26.opening_balance, 1000);        // céntimos → euros, cabecera sin _cents
  assert.equal(n26.is_archived, false);            // boolean de celda
  const prestamo = rows.find((r) => r.id === "acc-prestamo");
  assert.equal(prestamo.opening_balance, -6000);
  assert.equal(X.utils.sheet_to_json(wb.Sheets.transactions, { defval: "" }).length, 0); // pestaña presente aunque vacía
});
```

- [ ] **Step 3: Verificar que falla** — `node --experimental-sqlite --test tests/app/xlsx.test.mjs` → FAIL.

- [ ] **Step 4: Implementar `rowsToWorkbook` en `app/js/xlsx.js`**

```js
import { CONTRACT, BOOL_COLS, centsToEur, xlsxHeader } from "./contract.js";

// dump: { tabla: [{col: valor SQLite}] } → workbook con una pestaña por tabla.
// Sin dashboards y sin columnas "_": el dump ya solo trae columnas del contrato.
export function rowsToWorkbook(X, dump) {
  const wb = X.utils.book_new();
  for (const table of Object.keys(CONTRACT)) {
    const cols = CONTRACT[table].cols;
    const bools = new Set(BOOL_COLS[table] ?? []);
    const aoa = [cols.map(xlsxHeader)];
    for (const row of dump[table] ?? []) {
      aoa.push(cols.map((c) => {
        const v = row[c];
        if (c.endsWith("_cents")) return v == null ? "" : centsToEur(v);
        if (bools.has(c)) return v === 1;
        return v ?? "";
      }));
    }
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), table);
  }
  return wb;
}
```

- [ ] **Step 5: Verificar** → PASS (y `node --experimental-sqlite --test tests/app/` completo sigue verde).
- [ ] **Step 6: Commit** — `git commit -m "feat(app): export xlsx con pestaña por tabla (rowsToWorkbook)"`

---

### Task 3: Import xlsx — parseo y validación

**Files:**
- Modify: `app/js/xlsx.js`
- Test: `tests/app/xlsx.test.mjs` (añadir)

**Interfaces:**
- Consumes: `contract.js`, `rowsToWorkbook` (para construir fixtures en tests).
- Produces (Task 4 los usa):
  - `workbookToRows(X, wb) → { data, errors }` — `data` con valores YA en formato SQLite (céntimos int, bools 0/1, fechas ISO). Ignora pestañas no-contrato y columnas desconocidas o `_*`. Falta una pestaña → error.
  - `validateImport(data) → string[]` — lista de errores legibles `"pestaña «X» fila N: motivo"`; vacía = válido.

- [ ] **Step 1: Tests de parseo y validación** (añadir a `tests/app/xlsx.test.mjs`)

```js
import { rowsToWorkbook, workbookToRows, validateImport } from "../../app/js/xlsx.js";

function wbFromSeed(mutate) {
  const db = openDb(); seedMinimal(db);
  const dump = dumpAll(db);
  if (mutate) mutate(dump);
  return rowsToWorkbook(X, dump);
}

test("import: round de parseo devuelve formato SQLite e ignora extras", () => {
  const wb = wbFromSeed();
  // pestaña extra (dashboard) y columna extra "_account" deben ignorarse
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["Resumen"]]), "Resumen del periodo");
  const { data, errors } = workbookToRows(X, wb);
  assert.deepEqual(errors, []);
  const n26 = data.accounts.find((r) => r.id === "acc-n26");
  assert.equal(n26.opening_balance_cents, 100000);
  assert.equal(n26.is_archived, 0);
  assert.equal(data.periods[0].start_date, "2026-07-27");
});

test("import: falta una pestaña del contrato → error", () => {
  const wb = wbFromSeed();
  delete wb.Sheets.budgets; wb.SheetNames = wb.SheetNames.filter((n) => n !== "budgets");
  const { errors } = workbookToRows(X, wb);
  assert.match(errors[0], /budgets/);
});

const parse = (mutate) => workbookToRows(X, wbFromSeed(mutate)).data;

test("validate: base semilla válida", () => { assert.deepEqual(validateImport(parse()), []); });
test("validate: schema_version distinta de 1", () => {
  const d = parse((x) => { x.meta.find((m) => m.key === "schema_version").value = "2"; });
  assert.match(validateImport(d)[0], /schema_version/);
});
test("validate: created_with dual — acepta hoja y pwa, rechaza otros", () => {
  const ok = parse((x) => { x.meta.find((m) => m.key === "created_with").value = "basecero-sheets-mvp"; });
  assert.deepEqual(validateImport(ok), []);
  const bad = parse((x) => { x.meta.find((m) => m.key === "created_with").value = "otra-app"; });
  assert.match(validateImport(bad)[0], /created_with/);
});
test("validate: enum inválido", () => {
  const d = parse((x) => { x.accounts[0].type = "bitcoin"; });
  assert.match(validateImport(d)[0], /accounts.*type/s);
});
test("validate: FK rota", () => {
  const d = parse((x) => { x.categories.find((c) => c.id === "cat-casa-alquiler").parent_id = "cat-nope"; });
  assert.match(validateImport(d)[0], /parent_id/);
});
test("validate: dos periodos open", () => {
  const d = parse((x) => { x.periods.push({ ...x.periods[0], id: "per-2", name: "Otro" }); });
  assert.match(validateImport(d)[0], /open/);
});
test("validate: importe no positivo salvo adjustment", () => {
  const d = parse();
  const base = { id: "tx-1", date: "2026-08-01", period_id: "per-1", type: "expense", amount_cents: 0,
    account_id: "acc-n26", counter_account_id: "", category_id: "cat-casa-alquiler", merchant: "", note: "",
    is_shared: 0, share_pct_override: null, settled: 0, ref_id: "", rule_id: "", external_id: "",
    status: "pending", created_at: "x", updated_at: "x", deleted: 0 };
  d.transactions.push(base);
  assert.match(validateImport(d)[0], /amount/);
  d.transactions[0] = { ...base, type: "adjustment", amount_cents: -500, category_id: "" };
  assert.deepEqual(validateImport(d), []);
});
```

- [ ] **Step 2: Verificar que fallan** → FAIL (funciones no exportadas).

- [ ] **Step 3: Implementar en `app/js/xlsx.js`**

```js
import { CONTRACT, ENUMS, BOOL_COLS, FKS, eurToCents, xlsxHeader, toIsoDate } from "./contract.js";

const DATE_COLS = new Set(["date", "start_date", "end_date", "target_date"]);

export function workbookToRows(X, wb) {
  const data = {}, errors = [];
  for (const table of Object.keys(CONTRACT)) {
    const ws = wb.Sheets[table];
    if (!ws) { errors.push(`falta la pestaña «${table}»`); continue; }
    const cols = CONTRACT[table].cols, bools = new Set(BOOL_COLS[table] ?? []);
    const byHeader = Object.fromEntries(cols.map((c) => [xlsxHeader(c), c]));
    const raw = X.utils.sheet_to_json(ws, { defval: "" });
    data[table] = raw
      .filter((r) => Object.values(r).some((v) => v !== ""))   // filas totalmente vacías fuera
      .map((r) => {
        const row = {};
        for (const [h, v] of Object.entries(r)) {
          const col = byHeader[h];
          if (!col) continue;                                   // "_account", desconocidas… se ignoran
          if (col.endsWith("_cents")) row[col] = v === "" ? null : eurToCents(v);
          else if (bools.has(col)) row[col] = v === true || v === "TRUE" || v === 1 ? 1 : 0;
          else if (DATE_COLS.has(col)) row[col] = toIsoDate(v);
          else row[col] = v;
        }
        for (const c of cols) if (!(c in row)) row[c] = c === "share_pct_override" ? null : (c.endsWith("_cents") ? null : "");
        return row;
      });
  }
  return { data, errors };
}

export function validateImport(data) {
  const errs = [];
  const meta = Object.fromEntries((data.meta ?? []).map((m) => [m.key, String(m.value)]));
  if (meta.schema_version !== "1") errs.push(`meta: schema_version debe ser 1 (es «${meta.schema_version}»)`);
  if (!["basecero-sheets-mvp", "basecero-pwa"].includes(meta.created_with))
    errs.push(`meta: created_with no reconocido («${meta.created_with}»)`);

  const ids = {};   // tabla → Set de ids (para FKs)
  for (const t of Object.keys(CONTRACT))
    ids[t] = new Set((data[t] ?? []).map((r) => r.id ?? r.key));

  for (const [table, spec] of Object.entries(ENUMS))
    (data[table] ?? []).forEach((row, i) => {
      for (const [col, allowed] of Object.entries(spec))
        if (!allowed.includes(String(row[col] ?? "")))
          errs.push(`pestaña «${table}» fila ${i + 2}: ${col} inválido («${row[col]}»)`);
    });

  for (const fk of FKS)
    (data[fk.table] ?? []).forEach((row, i) => {
      const v = row[fk.col];
      if (v === "" || v == null) { if (!fk.optional) errs.push(`pestaña «${fk.table}» fila ${i + 2}: ${fk.col} vacío`); return; }
      if (!ids[fk.ref].has(v)) errs.push(`pestaña «${fk.table}» fila ${i + 2}: ${fk.col} apunta a «${v}» que no existe en ${fk.ref}`);
    });

  const open = (data.periods ?? []).filter((p) => p.status === "open" && p.deleted !== 1);
  if (open.length > 1) errs.push(`periods: hay ${open.length} periodos open (máximo 1)`);

  (data.transactions ?? []).forEach((row, i) => {
    if (row.type !== "adjustment" && !(row.amount_cents > 0))
      errs.push(`pestaña «transactions» fila ${i + 2}: amount debe ser > 0`);
  });
  return errs;
}
```

- [ ] **Step 4: Verificar** → PASS. Nota: si `sheet_to_json` devuelve `share_pct_override` como `""`, el mapeo de `_cents`/else ya la deja `""` — corregir a `null` en el bucle de relleno (ya contemplado).
- [ ] **Step 5: Commit** — `git commit -m "feat(app): parseo y validación del import xlsx"`

---

### Task 4: `execMany` transaccional, `replaceAll`, pantalla Ajustes y round-trip

**Files:**
- Modify: `app/js/db.js`, `app/js/db-worker.js`, `app/js/repo.js`, `app/js/main.js` (ruta ajustes), `app/js/screens/placeholder.js` (quitar renderAjustes)
- Create: `app/js/screens/ajustes.js`
- Test: `tests/app/xlsx.test.mjs` (round-trip)

**Interfaces:**
- Consumes: `rowsToWorkbook` / `workbookToRows` / `validateImport`, `insertSql`, `dumpTable`.
- Produces:
  - `db.js`: `execMany(stmts: [{sql, bind?}]) → Promise<void>` — TODAS las tareas posteriores lo usan para escrituras multi-sentencia.
  - `repo.js`: `dumpAllTables() → Promise<dump>` · `replaceAll(data) → Promise<void>`
  - `screens/ajustes.js`: `renderAjustes(container)` (misma firma que la del placeholder que sustituye).

- [ ] **Step 1: op `execMany` en el worker**

En `app/js/db-worker.js`, junto a las ops `query`/`exec` existentes, añadir el caso:

```js
if (op === "execMany") {
  db.exec("BEGIN");
  try {
    for (const s of stmts) db.exec({ sql: s.sql, bind: s.bind ?? [] });
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}
```

(adaptar nombres al dispatcher real del archivo: el mensaje llega como `{id, op, stmts}`; responder igual que `exec`). En `app/js/db.js` exportar `execMany(stmts)` con el mismo mecanismo de promesa pendiente que `query`/`exec`.

- [ ] **Step 2: Test round-trip (el crítico)** — añadir a `tests/app/xlsx.test.mjs`:

```js
import { insertSql, CONTRACT } from "../../app/js/contract.js";

test("ROUND-TRIP: export → import → mismos datos", () => {
  const db = openDb(); seedMinimal(db);
  // enriquecer: transacción de cada tipo, regla, goal y budget
  const T2 = "2026-08-02T00:00:00Z";
  const tx = (id, type, cents, extra = {}) => db.prepare(insertSql("transactions")).run(...CONTRACT.transactions.cols.map((c) =>
    ({ id, date: "2026-08-02", period_id: "per-1", type, amount_cents: cents, account_id: "acc-n26",
       counter_account_id: "", category_id: type === "transfer" || type === "adjustment" ? "" : "cat-casa-alquiler",
       merchant: "M", note: "", is_shared: 0, share_pct_override: null, settled: 0, ref_id: "", rule_id: "",
       external_id: "", status: "pending", created_at: T2, updated_at: T2, deleted: 0, ...extra })[c]));
  tx("tx-e", "expense", 900, { is_shared: 1 });
  tx("tx-i", "income", 215000, { category_id: "cat-nomina" });
  tx("tx-t", "transfer", 5000, { counter_account_id: "acc-revolut" });
  tx("tx-r", "refund", 360, { ref_id: "tx-e" });
  tx("tx-a", "adjustment", -123);
  db.prepare(insertSql("recurring_rules")).run("rr-1","Alquiler","expense",90000,"cat-casa-alquiler","acc-n26","","monthly",1,null,1,1,T2,T2,0);
  db.prepare(insertSql("goals")).run("goal-1","Fondo emergencia","emergency_fund",null,6,null,"","acc-revolut","",1,T2,T2,0);
  db.prepare(insertSql("budgets")).run("bud-1","per-1","cat-casa",70000,T2,T2,0);

  const original = dumpAll(db);
  const buf = X.write(rowsToWorkbook(X, original), { type: "buffer", bookType: "xlsx" });
  const { data, errors } = workbookToRows(X, X.read(buf, { type: "buffer" }));
  assert.deepEqual(errors, []);
  assert.deepEqual(validateImport(data), []);

  const db2 = openDb();   // aplicar el import como lo hará replaceAll
  for (const t of Object.keys(CONTRACT)) {
    db2.prepare(`DELETE FROM ${t}`).run();
    for (const row of data[t]) db2.prepare(insertSql(t)).run(...CONTRACT[t].cols.map((c) => row[c]));
  }
  assert.deepEqual(dumpAll(db2), original);
});
```

- [ ] **Step 3: Verificar que falla / depurar hasta PASS.** Los puntos que suelen morder: `share_pct_override` null↔"" y `due_day/due_month/target_*` null↔"". Regla fija: en `workbookToRows`, celdas vacías de columnas numéricas nullable (`share_pct_override`, `due_day`, `due_month`, `target_amount_cents`, `target_months`, `target_pct`) → `null`. Añadir un set `NULLABLE_NUM` en `contract.js` si hace falta y exportarlo. El round-trip debe quedar en `deepEqual` estricto.

- [ ] **Step 4: `repo.js`**

```js
import { execMany } from "./db.js";
import { CONTRACT, insertSql } from "./contract.js";

export async function dumpAllTables() {
  const out = {};
  for (const t of TABLES) out[t] = await query(SQL.dumpTable(t));
  return out;   // exportAllJson pasa a usar esto
}

export async function replaceAll(data) {
  const stmts = [...TABLES].reverse().map((t) => ({ sql: `DELETE FROM ${t}` }));
  for (const t of TABLES)
    for (const row of data[t]) stmts.push({ sql: insertSql(t), bind: CONTRACT[t].cols.map((c) => row[c]) });
  await execMany(stmts);
}
```

- [ ] **Step 5: Pantalla Ajustes** (`app/js/screens/ajustes.js`, sustituye a la del placeholder; `main.js` importa de aquí)

Estructura (patrón registro.js, tarjetas apiladas):
- Tarjeta "Tu hoja de cálculo": botón primario **"Exportar hoja (.xlsx)"** → `dumpAllTables()` → `rowsToWorkbook(window.XLSX, dump)` → `XLSX.write(wb, {type:"array", bookType:"xlsx"})` → Blob descargable `basecero-${hoyISO()}.xlsx` (mismo mecanismo de `<a download>` que el export JSON de fase 1). Botón secundario **"Importar hoja (.xlsx)"** → `<input type="file" accept=".xlsx">` oculto → `file.arrayBuffer()` → `XLSX.read(buf, {type:"array"})` → `workbookToRows` + `validateImport` → si hay errores, listarlos en un banner rojo scrollable (máx. 10 + "y N más"); si no, mostrar confirmación inline: "Esto reemplaza TODOS los datos de la app (N movimientos actuales). Se descargará una copia antes." con botones Cancelar / **Reemplazar** → al confirmar: descargar backup xlsx automático + `await replaceAll(data)` + `location.reload()`.
- Tarjeta "Copia de emergencia": el export JSON existente (mover desde placeholder.js).
- (La tarjeta de import N26 y el enlace a Recurrentes se añaden en Tasks 15 y 10.)

- [ ] **Step 6: Prueba manual en navegador** — `python3 -m http.server 8765 -d app` → exportar, editar una celda en LibreOffice/Sheets, importar, verificar reflejo y backup descargado. Probar también un xlsx inválido (enum roto) → banner de errores sin tocar datos.
- [ ] **Step 7: Commit** — `git commit -m "feat(app): import/export xlsx round-trip con execMany transaccional y Ajustes real"`

---

### Task 5: Registro de 5 tipos + fix `MY_AMOUNT` en refunds

**Files:**
- Modify: `app/js/sql.js`, `app/js/repo.js`, `app/js/screens/registro.js`
- Test: `tests/app/tipos.test.mjs`

**Interfaces:**
- Consumes: `execMany` (refund que liquida).
- Produces:
  - `SQL.insertTransaction` NUEVA FIRMA — 19 parámetros posicionales: `id,date,period_id,type,amount_cents,account_id,counter_account_id,category_id,merchant,note,is_shared,share_pct_override,settled,ref_id,rule_id,external_id,status,created_at,updated_at` (deleted fijo 0). Consumidores: repo y Task 15.
  - `repo.addTransaction(opts)` — opts amplía fase 1 con `counterAccountId=""`, `sharePctOverride=null`, `refId=""`, `ruleId=""`, `externalId=""`, `status="pending"`. Si `refId` no vacío → además `settled=1` en la transacción original (execMany).
  - `SQL.spentOfPeriod` corregida; `SQL.recentForRefund` (últimos 15 expenses del periodo + compartidos sin liquidar de todos, para el selector).
  - `renderRegistro(container, onDone, prefill?)` — `prefill` opcional `{type, amountCents, categoryId, accountId, merchant, ruleId}` (lo usa Task 11).

- [ ] **Step 1: Tests** (`tests/app/tipos.test.mjs`, con helpers y `SQL` importada como hace `repo-sql.test.mjs`)

```js
// 1. spentOfPeriod con refund COMPARTIDO sin ref_id resta solo MY_AMOUNT:
//    expense 10000 shared (pct 60) → spent 6000; refund 1000 shared sin ref → spent 5400 (resta 600, no 1000).
// 2. refund CON ref_id no toca el gasto: expense shared 90000 → refund 36000 ref_id=tx → spent sigue 54000.
// 3. insertTransaction admite transfer con counter_account_id y adjustment negativo (CHECK del schema lo permite).
// 4. CHECK: expense con amount_cents=0 lanza.
```

(escribir los 4 tests ejecutando `SQL.insertTransaction` y `SQL.spentOfPeriod` contra `openDb()+seedMinimal`).

- [ ] **Step 2: Verificar que falla** — el test 1 da 5000 (resta completa) con la SQL actual → FAIL esperado.

- [ ] **Step 3: `sql.js`** — `spentOfPeriod`: cambiar el brazo refund a `WHEN t.type='refund' AND t.ref_id='' THEN -${MY_AMOUNT}`. `insertTransaction`: todos los campos parametrizados (VALUES con 19 `?` + deleted 0). Añadir `recentForRefund`:

```sql
SELECT t.id, t.date, t.amount_cents, t.merchant, t.category_id, t.is_shared, t.settled
FROM transactions t WHERE t.deleted=0 AND t.type='expense'
  AND (t.period_id=? OR (t.is_shared=1 AND t.settled=0))
ORDER BY t.date DESC, t.created_at DESC LIMIT 15
```

- [ ] **Step 4: `repo.addTransaction`** ampliado (defaults compatibles con las llamadas de fase 1); con `refId`: `execMany([{insert...}, {sql: "UPDATE transactions SET settled=1, updated_at=? WHERE id=?", bind:[t, refId]}])`.
- [ ] **Step 5: Verificar tests** → PASS.
- [ ] **Step 6: UI de `registro.js`** — el segmented pasa a 5 chips con scroll horizontal (`Gasto · Ingreso · Transfer. · Devolución · Ajuste`), `state.type` gobierna los campos visibles:
  - `transfer`: chips "Desde"/"Hacia" (dos filas de cuentas; excluir la misma cuenta en destino), sin categoría, sin compartido.
  - `refund`: cuenta destino + categorías de gasto + selector plegable "¿Devuelve un gasto?" alimentado por `recentForRefund` (fila → fija `state.refId` y precarga categoría e importe de la parte de Sara si el gasto era compartido).
  - `adjustment`: cuenta + toggle `+/−` junto al display de importe (el importe guardado lleva el signo), sin categoría ni compartido.
  - `expense`/`income`: como fase 1. Validación por tipo antes de guardar (transfer necesita 2 cuentas distintas; refund/expense/income categoría).
- [ ] **Step 7: Prueba manual en navegador** de los 5 tipos + commit — `git commit -m "feat(app): registro de los 5 tipos y prorrateo MY_AMOUNT en refunds"`

---

### Task 6: Pantalla Movimientos (lista, bandeja, detalle editar/borrar)

**Files:**
- Modify: `app/js/sql.js`, `app/js/repo.js`, `app/js/main.js` (ruta movimientos), `app/js/screens/placeholder.js` (Movimientos deja de usarlo)
- Create: `app/js/screens/movimientos.js`
- Test: `tests/app/movimientos.test.mjs`

**Interfaces:**
- Consumes: patrón de filas de `inicio.js`, `allCategoriesById`, `listAccounts`.
- Produces:
  - `SQL.listPeriods` (`SELECT id,name,start_date,end_date,status FROM periods WHERE deleted=0 ORDER BY start_date DESC`), `SQL.listAllByDay` (como `listByDay` pero **con los 5 tipos** y todas las columnas editables), `SQL.getTransaction`, `SQL.updateTransaction` (SET de todos los campos editables + `updated_at`), `SQL.softDeleteTransaction` (`UPDATE transactions SET deleted=1, updated_at=? WHERE id=?`), `SQL.countUncategorized` (periodo: `category_id='' AND deleted=0 AND type IN ('expense','income','refund')`).
  - `repo.listPeriods()`, `repo.listAllByDay(pid)`, `repo.getTransaction(id)`, `repo.updateTransaction(id, fields)` (fields con las MISMAS claves camelCase de addTransaction), `repo.softDeleteTransaction(id)`, `repo.countUncategorized(pid)`.
  - `renderMovimientos(container)`.

- [ ] **Step 1: Tests** — update cambia campos y `updated_at` (y no `created_at`); softDelete deja la fila fuera de `listAllByDay` y de `spentOfPeriod`; `countUncategorized` cuenta solo sin categoría no borradas; `listAllByDay` incluye transfer y adjustment.
- [ ] **Step 2: FAIL → implementar SQL + repo → PASS.**
- [ ] **Step 3: UI** — `movimientos.js`: cabecera con `<select>` de periodo (por defecto el open); si `countUncategorized > 0`, chip ámbar "N sin categorizar" que filtra; lista agrupada por día (reutilizar el patrón visual de inicio.js; transfer con icono ⇄ y texto "N26 → Revolut", adjustment con "Ajuste"); tap → subvista detalle en el mismo container (`state.view = 'detail'`): formulario con los campos del tipo (mismos controles que registro), botones **Guardar** (updateTransaction → volver a lista) y **Borrar** (confirmación inline dos-taps: "¿Borrar? / Sí, borrar" → softDelete). `main.js`: `RUTAS.movimientos = () => renderMovimientos(screen)`.
- [ ] **Step 4: Prueba manual + commit** — `git commit -m "feat(app): pantalla Movimientos con edición, borrado y bandeja sin categorizar"`

---

### Task 7: Con Sara — pendiente y liquidar

**Files:**
- Modify: `app/js/sql.js`, `app/js/repo.js`, `app/js/screens/inicio.js`
- Create: `app/js/screens/liquidar.js`
- Test: `tests/app/sara.test.mjs`

**Interfaces:**
- Consumes: `addTransaction` con refId (Task 5).
- Produces:
  - `SQL.pendingShared`: expenses `is_shared=1 AND settled=0 AND deleted=0` de TODOS los periodos, con `sara_amount_cents = t.amount_cents - ${MY_AMOUNT}` (JOIN periods), orden `date ASC`.
  - `SQL.pendingSharedTotal`: `COALESCE(SUM(...),0)` de lo mismo — **lo reutiliza la previsión (Task 11)**.
  - `repo.pendingShared()`, `repo.pendingSharedTotalCents()`, `repo.settleShared(txId, accountId)` → crea el refund (`amount = sara_amount`, categoría del gasto, `ref_id=txId`, cuenta destino) y marca `settled=1`, vía `addTransaction({refId})`.
  - `renderLiquidar(container, onBack)`.

- [ ] **Step 1: Tests** — pendingShared calcula sara_amount con pct del periodo y override; settleShared crea refund con categoría/importe correctos y el original queda settled; pendingSharedTotal baja a 0 tras liquidar; el refund de liquidación NO altera spentOfPeriod (tiene ref_id).
- [ ] **Step 2: FAIL → implementar → PASS.**
- [ ] **Step 3: UI** — bloque "Con Sara" en `inicio.js` (réplica del artboard `design/Resumen.dc.html:218-231`): chip "Este periodo: X / Y", "Pendiente de que te devuelva" en rojo con `pendingSharedTotalCents`, botón "Liquidar" → `renderLiquidar` (lista de pendientes con fecha/comercio/su parte; botón por fila "Liquidar" → dos-taps → `settleShared` con cuenta N26 por defecto y selector de cuenta arriba). Ocultar el bloque si no hay compartidos sin liquidar y el total es 0.
- [ ] **Step 4: Prueba manual + commit** — `git commit -m "feat(app): bloque Con Sara y liquidación de compartidos"`

---

### Task 8: Asistente Nuevo periodo, cierre y onboarding unificado

**Files:**
- Modify: `app/js/sql.js`, `app/js/repo.js`, `app/js/onboarding.js`, `app/js/main.js`, `app/css/app.css`, `app/js/screens/inicio.js` (entrada), `app/js/screens/ajustes.js` (entrada)
- Create: `app/js/screens/periodo-nuevo.js`
- Test: `tests/app/periodos.test.mjs`

**Interfaces:**
- Consumes: `spentOfPeriod`, `incomeOfPeriod`, `execMany`.
- Produces:
  - `SQL.closePeriod`: `UPDATE periods SET end_date=?, status='closed', updated_at=? WHERE id=?`
  - `SQL.spentByRootCategory` (**la reutilizan Tasks 9 y 12**):

```sql
SELECT root.id AS root_id, root.name,
  COALESCE(SUM(CASE WHEN t.type='expense' THEN ${MY_AMOUNT}
               WHEN t.type='refund' AND t.ref_id='' THEN -${MY_AMOUNT} ELSE 0 END),0) AS spent_cents
FROM categories root
LEFT JOIN categories child ON (child.id=root.id OR child.parent_id=root.id) AND child.deleted=0
LEFT JOIN transactions t ON t.category_id=child.id AND t.period_id=? AND t.deleted=0
LEFT JOIN periods p ON p.id=t.period_id
WHERE root.parent_id='' AND root.flow='expense' AND root.deleted=0 AND root.is_archived=0
GROUP BY root.id ORDER BY spent_cents DESC
```

  - `SQL.insertBudget`, `SQL.budgetsOfPeriod` (`SELECT b.id, b.category_id, b.amount_cents FROM budgets b WHERE b.period_id=? AND b.deleted=0`).
  - `repo.spentByRootCategory(pid)`, `repo.budgetsOfPeriod(pid)`, `repo.openNextPeriod({name, startDate, sharePct, budgets})` — `budgets: [{categoryId, amountCents}]`; cierra el open (si existe) con `end_date` = día anterior a `startDate`, crea el nuevo y sus budgets, TODO en un `execMany`. También la usa el onboarding (sin periodo previo que cerrar).
  - `renderPeriodoNuevo(container, { mode: 'first' | 'next', onDone })`.

- [ ] **Step 1: Tests** — openNextPeriod: el viejo queda closed con `end_date` correcta (día anterior, cruzando mes: start 2026-09-01 → end 2026-08-31), el nuevo open, budgets insertados; índice `one_open_period` intacto; en modo primero (sin open previo) solo crea; spentByRootCategory agrega subárbol (gasto en `cat-casa-alquiler` cuenta para `cat-casa`) y resta refunds sin ref prorrateados; un execMany que viole el CHECK hace rollback completo (ningún periodo nuevo).
- [ ] **Step 2: FAIL → implementar SQL + repo → PASS.** Cálculo de "día anterior": `new Date(startDate+"T12:00:00")` − 1 día → ISO (helper `prevDayIso(iso)` en `format.js`).
- [ ] **Step 3: UI del asistente** (réplica de `design/Periodo.dc.html`, pantalla única con flecha atrás, sin tab bar):
  1. Modo `next`: bloque "Cierras {nombre}" con rango, nº movimientos y métricas (spent/ahorrado/tasa del open actual). Modo `first`: este bloque no existe.
  2. Campos: "Empieza el" (date, default hoy), "Nombre" (autogenerado con `nombrePorDefecto()` movido de onboarding.js a `format.js`, editable), "Pagas de lo compartido" (stepper % — default: `my_share_pct` del periodo que se cierra; en `first`, 50).
  3. Presupuestos por raíz: filas con icono+color, referencia "Mes pasado: X €" (spentByRootCategory del periodo saliente; en `first` sin referencia), input € (vacío = sin límite, estilo punteado); "Añadir límite a otra categoría" despliega las raíces sin fila.
  4. Total: presupuestado vs "Ingresos previstos" (= `incomeOfPeriod` del saliente; en `first` se omite la comparativa), barra, nota de lo sin asignar.
  5. Botón "Abrir periodo" → `openNextPeriod` → `onDone()`.
- [ ] **Step 4: Onboarding unificado + chrome oculto** — `onboarding.js` queda en: `showOnboarding(container)` → `document.body.classList.add("onboarding")` → `renderPeriodoNuevo(container, {mode:'first', onDone})` → al terminar quita la clase y resuelve. En `app.css`: `body.onboarding .tabbar, body.onboarding .fab { display: none; }` (usar los selectores reales del tab bar/FAB de `index.html`). En `main.js`, guard en `nav()`: `if (document.body.classList.contains("onboarding")) return;`.
- [ ] **Step 5: Entradas** — en `inicio.js`, la cabecera del periodo pasa a ser tappable → asistente modo next; en `ajustes.js`, fila "Cerrar periodo y abrir el siguiente".
- [ ] **Step 6: Prueba manual (onboarding desde BD borrada + cierre normal) + commit** — `git commit -m "feat(app): asistente de nuevo periodo con presupuestos, cierre y onboarding unificado"`

---

### Task 9: Pantalla Presupuesto

**Files:**
- Modify: `app/js/screens/inicio.js` (enlace), `app/js/main.js` si hace falta helper de navegación
- Create: `app/js/screens/presupuesto.js`
- Test: `tests/app/presupuesto.test.mjs`

**Interfaces:**
- Consumes: `spentByRootCategory(pid)`, `budgetsOfPeriod(pid)` (Task 8), `category-colors.js`.
- Produces: `renderPresupuesto(container, onBack)`; helper puro exportado `budgetStatus(spent, limit) → {pct, level: 'ok'|'warn'|'over'}` con umbrales **warn ≥ 85 %, over > 100 %**.

- [ ] **Step 1: Test del helper** — 82 % → ok; 85 % → warn; 92 % → warn; 100 % → warn; 100.1 %+ → over; límite 0/null → sin estado (null).
- [ ] **Step 2: FAIL → implementar → PASS.**
- [ ] **Step 3: UI** (réplica de `design/Presupuesto.dc.html`): tarjeta total (suma de spent de raíces CON límite vs suma de límites, % grande, barra, "Te quedan X € en las N categorías con límite"); tarjeta por categoría con límite (icono, "X € de Y €", % coloreado, barra, línea de estado: ok "Te quedan X €" / warn "Casi al límite · te quedan X €" / over borde rojizo + píldora "Superado por X €"); recuadro punteado "Sin límite este periodo" con nombres y total gastado. Entrada: enlace "Ver presupuesto →" en `inicio.js` (aparece si el periodo tiene budgets). Flecha atrás → `onBack`.
- [ ] **Step 4: Prueba manual + commit** — `git commit -m "feat(app): pantalla Presupuesto del periodo"`

---

### Task 10: Recurrentes (CRUD)

**Files:**
- Modify: `app/js/sql.js`, `app/js/repo.js`, `app/js/screens/ajustes.js` (enlace)
- Create: `app/js/screens/recurrentes.js`
- Test: `tests/app/recurrentes.test.mjs`

**Interfaces:**
- Consumes: catálogos (`listAccounts`, categorías), `insertSql` no (SQL nombrada propia).
- Produces:
  - `SQL.listRules` (`WHERE deleted=0 ORDER BY is_active DESC, name`), `SQL.insertRule`, `SQL.updateRule`, `SQL.softDeleteRule`.
  - `repo.listRules()`, `repo.createRule(fields)`, `repo.updateRule(id, fields)`, `repo.softDeleteRule(id)` — `fields`: `{name, type, amountCents, categoryId, accountId, counterAccountId, frequency, dueDay, dueMonth, isShared, isActive}`.
  - `renderRecurrentes(container, onBack)` — **Task 11 enlaza aquí desde Previsión**.

- [ ] **Step 1: Tests** — create/list/update/softDelete; CHECK de frequency inválida lanza; transfer guarda counter_account_id.
- [ ] **Step 2: FAIL → implementar → PASS.**
- [ ] **Step 3: UI** — lista de reglas (nombre, "90,00 € · mensual · día 1", badge gris "inactiva") + botón "Nueva regla" → formulario (mismos controles que registro: tipo solo expense/income/transfer, importe, categoría si expense/income, cuenta, cuenta destino si transfer, frecuencia como chips, día 1-31, mes 1-12 solo quarterly/yearly, toggles compartida/activa) → guardar/editar/borrar (dos-taps). Enlace en Ajustes: "Gastos e ingresos recurrentes".
- [ ] **Step 4: Prueba manual + commit** — `git commit -m "feat(app): CRUD de recurrentes"`

---

### Task 11: Previsión en Inicio

**Files:**
- Create: `app/js/prevision.js`
- Modify: `app/js/sql.js`, `app/js/repo.js`, `app/js/screens/inicio.js`, `app/js/screens/registro.js` (prefill ya soportado en Task 5)
- Test: `tests/app/prevision.test.mjs`

**Interfaces:**
- Consumes: `pendingSharedTotalCents` (Task 7), `listRules` (Task 10), `renderRegistro(..., prefill)` (Task 5).
- Produces:
  - `prevision.js` (puro): `periodMonth(startDateIso) → 1..12` (= mes de `start_date + 15 días`, regla del dashboard `generator/basecero_generator/dashboards.py:110`); `ruleApplies(rule, month) → bool` (inactiva → no; monthly/weekly → sí; sin due_month → no para quarterly/yearly; yearly → `due_month === month`; quarterly → `((month - due_month) % 12) % 3 === 0`); `myAmountOfRule(rule, sharePct) → cents` (prorratea si `is_shared`).
  - `SQL.paidRuleIds`: `SELECT DISTINCT rule_id FROM transactions WHERE period_id=? AND deleted=0 AND rule_id<>''`; `SQL.paidByCatAmount`: `SELECT DISTINCT category_id || '|' || amount_cents AS k FROM transactions WHERE period_id=? AND deleted=0` (fallback del dashboard: misma categoría + mismo importe).
  - `SQL.accountBalance` (**la reutilizan Tasks 13/14**):

```sql
SELECT a.opening_balance_cents + COALESCE((SELECT SUM(CASE
    WHEN t.type IN ('expense','transfer') AND t.account_id=a.id THEN -t.amount_cents
    WHEN t.type='transfer' AND t.counter_account_id=a.id THEN t.amount_cents
    WHEN t.type IN ('income','refund') AND t.account_id=a.id THEN t.amount_cents
    WHEN t.type='adjustment' AND t.account_id=a.id THEN t.amount_cents
    ELSE 0 END) FROM transactions t
  WHERE t.deleted=0 AND (t.account_id=a.id OR t.counter_account_id=a.id) AND t.date<=?),0) AS balance_cents
FROM accounts a WHERE a.id=?
```

  - `repo.accountBalanceCents(accountId, atDateIso)`, `repo.previsionOfPeriod(period)` → `{items: [{rule, myCents, paid}], comprometidoCents, saldoN26Cents, pendienteSaraCents, disponibleCents}` (comprometido excluye `type='income'`; disponible = saldoN26 − comprometido + pendienteSara; saldo N26 por `account_id='acc-n26'` a fecha hoy).

- [ ] **Step 1: Tests** — matriz `ruleApplies` (monthly sí; weekly sí; yearly due_month 11 con month 11 sí / month 8 no; quarterly due_month 2 con month 8 sí (2,5,8,11) / month 9 no; inactiva no; quarterly sin due_month no); `periodMonth("2026-07-27") === 8`; `accountBalance` con un movimiento de cada tipo (expense −, income +, transfer resta origen y suma destino, refund +, adjustment con signo, liability con opening negativo); `previsionOfPeriod` integrado: regla pagada por rule_id, otra por fallback categoría+importe, disponible = saldo − comprometido + Sara.
- [ ] **Step 2: FAIL → implementar → PASS.**
- [ ] **Step 3: UI en `inicio.js`** — bloque "Previsión" (solo si hay reglas aplicables): filas regla (nombre, mi importe, badge "✅ pagado"/"⏳ pendiente"); pie con "Comprometido restante X €" y **"Disponible real Y €"** destacado; tap en pendiente → `renderRegistro(screen, volverAInicio, {type: rule.type === 'transfer' ? 'transfer' : rule.type, amountCents: myCents… })` — prefill con importe SIN prorratear (`rule.amount_cents`), categoría, cuenta, `merchant: rule.name`, `ruleId: rule.id` y `isShared: rule.is_shared`; enlace "Gestionar recurrentes" → `renderRecurrentes`.
- [ ] **Step 4: Prueba manual + commit** — `git commit -m "feat(app): previsión del periodo con disponible real"`

---

### Task 12: Gráficas de Inicio (flujo + donut)

**Files:**
- Create: `app/js/charts.js`
- Modify: `app/js/sql.js`, `app/js/repo.js`, `app/js/screens/inicio.js`
- Test: `tests/app/charts.test.mjs` (crear; incluye también el test de datos de `spentLast7Days`)

**Interfaces:**
- Consumes: `spentByRootCategory`, `budgetsOfPeriod`, `budgetStatus`, `category-colors.js`.
- Produces:
  - `SQL.spentByDay`: gasto (`MY_AMOUNT` de expenses − refunds sin ref prorrateados) agrupado por `t.date` en un rango `date BETWEEN ? AND ?` del periodo.
  - `repo.spentLast7Days(pid)` → `[{date, cents}]` 7 entradas (rellenar días sin gasto con 0 en JS).
  - `charts.js` (puro, sin DOM — devuelve strings SVG):
    - `barChartSvg(days: [{label, cents, active}]) → string` — 7 barras `align-items:end` como el artboard; barra activa color acento + etiqueta del importe encima; sin ejes.
    - `donutSvg(slices: [{color, cents}], centerTitle, centerSub) → string` — SVG 140×140, r=54, stroke 20, arcos con `stroke-dasharray`/`dashoffset` rotados −90°.
    - `sparklineSvg(points: number[], labels: string[]) → string` — polyline + polygon de relleno + círculo en el último punto (**la usa Task 13**).

- [ ] **Step 1: Tests** (`tests/app/charts.test.mjs`, sin DOM: asserts sobre el string) — donut: la suma de los `stroke-dasharray` de los arcos ≈ `2π·54` (±1) y hay un `<circle>`/`<path>` por slice con su color; barChart: la barra de mayor importe lleva la altura máxima y la activa la clase/atributo de acento; sparkline: N puntos → polyline con N pares. Test de datos: `spentLast7Days` devuelve 7 días con ceros rellenos y suma correcta.
- [ ] **Step 2: FAIL → implementar → PASS.**
- [ ] **Step 3: Integración en `inicio.js`** (réplica de `design/Resumen.dc.html:67-215`): tarjeta "Flujo de gasto" (últimos 7 días, hoy activo, iniciales L-D con la de hoy en blanco); tarjeta "Gasto por categoría" con el donut (total del periodo en el centro), subtítulo "Solo tu parte de lo compartido", enlace "Ver presupuesto →" (Task 9), y lista de raíces: punto de color + nombre + "X € de Y €" con mini-barra `budgetStatus` para las presupuestadas, "sin límite" para el resto (agrupar las menores en "Otras N" con gris `#5c646d` como el artboard).
- [ ] **Step 4: Prueba manual + commit** — `git commit -m "feat(app): gráficas de flujo y donut por categoría en Inicio"`

---

### Task 13: Pantalla Patrimonio

**Files:**
- Modify: `app/js/sql.js`, `app/js/repo.js`, `app/js/main.js` (ruta patrimonio)
- Create: `app/js/screens/patrimonio.js`
- Test: `tests/app/patrimonio.test.mjs`

**Interfaces:**
- Consumes: `accountBalanceCents` (Task 11), `sparklineSvg` (Task 12), `spentOfPeriod`/`incomeOfPeriod`.
- Produces:
  - `SQL.listAllAccounts` (incluye liability, `deleted=0`, orden display_order), `SQL.listClosedPeriods` (`status='closed' AND deleted=0 ORDER BY start_date`), `SQL.listGoals` (`is_active=1 AND deleted=0`).
  - `repo.balancesAt(dateIso)` → `[{id, name, type, balance_cents}]` (accountBalance por cuenta); `repo.netWorthAt(dateIso)` → suma; `repo.netWorthSeries()` → por periodo cerrado `{label: mes corto, cents: netWorthAt(end_date)}` + punto actual; `repo.avgSpentOfClosedPeriods()` → media de `spentOfPeriod` de cerrados (0 si no hay); `repo.goalsWithProgress()` → por goal activo `{goal, currentCents, targetCents, pct, subtitle}` según tipo (§7.2 del contrato): `emergency_fund` saldo hucha / (target_months × gasto medio); `savings_target` saldo / target (+ target_date en subtítulo); `provision` saldo hucha / target anual; `spending_cap` gastado del periodo open en su categoría raíz / target (over → nivel rojo); `savings_rate` tasa del open (ahorro/ingresos) / target_pct.
  - `renderPatrimonio(container)`.

- [ ] **Step 1: Tests** — netWorthAt con las 4 cuentas semilla (liability resta); netWorthSeries usa end_date de cerrados; goalsWithProgress: un goal de cada tipo con datos mínimos y pct esperado (emergency_fund con avg 0 → pct 0 sin dividir por cero); spending_cap over 100 marca over.
- [ ] **Step 2: FAIL → implementar → PASS.**
- [ ] **Step 3: UI** (réplica de `design/Patrimonio.dc.html`): tarjeta neto (importe 38 px + badge variación absoluta vs último cerrado + sparkline, oculta con <2 puntos); tarjeta Cuentas (fila por cuenta: nombre, subtítulo por tipo, saldo — liability en rojo); tarjeta Objetivos (fila por goal: título, "actual / objetivo", barra 8 px con color por estado, subtítulo contextual + % a la derecha). Botones "Nueva cuenta" / "Nuevo objetivo" y tap en fila → formularios de la Task 14 (hasta entonces, los botones no se muestran: se añaden en Task 14). `main.js`: `RUTAS.patrimonio = () => renderPatrimonio(screen)` (deja de usar placeholder).
- [ ] **Step 4: Prueba manual + commit** — `git commit -m "feat(app): pantalla Patrimonio con neto, cuentas y objetivos"`

---

### Task 14: Formularios de cuentas y objetivos

**Files:**
- Modify: `app/js/sql.js`, `app/js/repo.js`, `app/js/screens/patrimonio.js`
- Test: `tests/app/patrimonio.test.mjs` (añadir)

**Interfaces:**
- Consumes: `execMany`, `insertSql`.
- Produces:
  - `SQL.insertAccount`, `SQL.updateAccount` (`SET name=?, type=?, opening_balance_cents=?, updated_at=? WHERE id=?`), `SQL.insertGoal`, `SQL.updateGoal`, `SQL.softDeleteGoal`.
  - `repo.createAccount({name, type, openingBalanceCents})`, `repo.updateAccount(id, fields)` — **si `id==='acc-n26'`, ignora el cambio de `name`** (mantiene "N26"); `repo.createGoal(fields)` — `fields: {name, type, targetAmountCents, targetMonths, targetPct, targetDate, accountId, categoryId}`; para `emergency_fund`/`savings_target`/`provision` sin `accountId`: crea en el MISMO execMany una cuenta `savings` llamada `Hucha · {name}` y la vincula; `repo.updateGoal(id, fields)`, `repo.softDeleteGoal(id)`.

- [ ] **Step 1: Tests** — createGoal savings_target sin cuenta crea la hucha vinculada (una cuenta nueva savings, goal.account_id apunta a ella) atómicamente; spending_cap no crea hucha; updateAccount de acc-n26 con otro nombre conserva "N26" pero sí cambia opening_balance; dos goals no comparten hucha (cada create crea la suya).
- [ ] **Step 2: FAIL → implementar → PASS.**
- [ ] **Step 3: UI en `patrimonio.js`** — subvistas de formulario (patrón detalle de movimientos): cuenta (nombre — solo lectura si N26 con nota "No renombrable: la usa el import de N26" —, tipo chips, saldo inicial € con signo para pasivos); objetivo (tipo chips → campos condicionales: target € / meses / % / fecha / categoría raíz para spending_cap y provision; nota "Se creará su hucha automáticamente" en los tipos con hucha); guardar/editar; desactivar objetivo (toggle `is_active`).
- [ ] **Step 4: Prueba manual (poner saldos reales de prueba y un objetivo de cada tipo) + commit** — `git commit -m "feat(app): formularios de cuentas y objetivos con hucha automática"`

---

### Task 15: Import CSV N26 en la app

**Files:**
- Create: `app/js/n26.js`
- Modify: `app/js/sql.js`, `app/js/repo.js`, `app/js/screens/ajustes.js`
- Test: `tests/app/n26.test.mjs`

**Interfaces:**
- Consumes: globales `bcParseN26Csv`, `bcBuildExternalId`, `bcDecideImportAction`, `bcSanitizeCell` de `vendor/pure.js` (en tests: `createRequire` sobre `apps_script/pure.js`, que exporta `module.exports` en Node); `SQL.insertTransaction` (Task 5), `execMany`.
- Produces:
  - `SQL.n26Existing`: transacciones no borradas de `account_id='acc-n26'` con `id, date, type, amount_cents, external_id, status`.
  - `SQL.reconcileTx`: `UPDATE transactions SET external_id=?, status='reconciled', updated_at=? WHERE id=?`.
  - `n26.js`: `async importN26Csv(text) → {created, reconciled, skipped}` — el flujo completo; `async sha256Hex(s) → hex` (crypto.subtle) y `async externalIdFor(row) → string` con el **adaptador de captura** (no se toca pure.js):

```js
export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// bcBuildExternalId exige una función de hash SÍNCRONA; capturamos el payload
// en una primera pasada y llamamos de nuevo con el hash ya resuelto.
export async function externalIdFor(row, hashFn = sha256Hex) {
  let payload;
  bcBuildExternalId(row.bookingDate, row.amountCents, row.partnerName, row.paymentReference,
    (p) => { payload = p; return "0".repeat(64); });
  const hex = await hashFn(payload);
  return bcBuildExternalId(row.bookingDate, row.amountCents, row.partnerName, row.paymentReference, () => hex);
}
```

- [ ] **Step 1: Tests** (`tests/app/n26.test.mjs`; fixture CSV inline con cabecera real de N26: `"Booking Date","Value Date","Partner Name","Partner Iban","Type","Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"`) — la lógica de decisión se testea componiendo `bcParseN26Csv` + `externalIdFor` (con un hashFn determinista de test) + `bcDecideImportAction` + las SQL contra `node:sqlite`: (1) CSV de 2 filas sobre base vacía → 2 created `reconciled` sin categoría, importes/sentido correctos (fila negativa → expense, positiva → income); (2) re-import del mismo CSV → 2 skipped; (3) fila que casa con un pending manual de igual importe a ≤3 días → reconciled (la fila manual conserva categoría y merchant, gana external_id); (4) `externalIdFor` reproduce el payload de pure.js (mismo resultado con el mismo hashFn síncrono directo).
- [ ] **Step 2: FAIL → implementar `importN26Csv`** — puerto directo de `apps_script/main.js:106-164`: cargar existentes con `SQL.n26Existing` re-signados (`amountCents = |amount_cents| × (type==='expense' ? -1 : 1)`, `externalId`, `date`), parsear, por fila calcular externalId y decidir; acumular stmts (`insertTransaction` con status reconciled / `reconcileTx`) y push a existentes en memoria; un solo `execMany` al final; devolver contadores. → PASS.
- [ ] **Step 3: UI en `ajustes.js`** — tarjeta "Banco": "Importar CSV de N26" (input file `.csv`) → `importN26Csv(await file.text())` → banner con "Nuevas: N · Conciliadas: N · Duplicadas: N. Revisa la bandeja «sin categorizar» en Movimientos y reclasifica a devolución los Bizum de Sara."
- [ ] **Step 4: Prueba manual con un CSV real de N26 (o el fixture) + commit** — `git commit -m "feat(app): import de CSV de N26 con dedupe y conciliación"`

---

### Task 16: Icono maskable, manifest y Service Worker

**Files:**
- Create: `app/icons/icon-maskable.svg`
- Modify: `app/manifest.webmanifest`, `app/sw.js`

**Interfaces:**
- Consumes: `app/icons/icon.svg` (arte actual: rect 512×512 rx=112, "B" azul, círculo verde en 380,146).
- Produces: manifest con icons split; SHELL completo de fase 2.

- [ ] **Step 1: `icon-maskable.svg`** — mismo arte reescalado a la zona segura: fondo `#0b0c0e` a sangre 512×512 SIN esquinas redondeadas (la máscara las pone) y el grupo B+círculo escalado ×0.7 centrado (contenido dentro del 80 % central). Manifest:

```json
"icons": [
  { "src": "icons/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" },
  { "src": "icons/icon-maskable.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "maskable" }
]
```

- [ ] **Step 2: `sw.js`** — `CACHE = "bc-v6"`; añadir a SHELL TODOS los archivos nuevos: `vendor/xlsx/xlsx.full.min.js`, `js/contract.js`, `js/xlsx.js`, `js/prevision.js`, `js/charts.js`, `js/n26.js`, `js/screens/movimientos.js`, `js/screens/liquidar.js`, `js/screens/periodo-nuevo.js`, `js/screens/presupuesto.js`, `js/screens/recurrentes.js`, `js/screens/patrimonio.js`, `js/screens/ajustes.js`, `icons/icon-maskable.svg` (y retirar `js/screens/placeholder.js` si ya no lo importa nadie — verificar con grep antes).
- [ ] **Step 3: Verificación** — `python3 -m http.server 8765 -d app`, DevTools → Application: SW activo con la caché nueva, sin 404 en install (el install lanza si un asset falla); modo avión → la app abre. `node --experimental-sqlite --test tests/app/` completo verde.
- [ ] **Step 4: Commit** — `git commit -m "feat(app): icono maskable propio y SW de fase 2"`

---

### Task 17: QA E2E en navegador (Playwright) + ola de arreglos

**Files:**
- Ninguno nuevo obligatorio (fixes donde toque).

- [ ] **Step 1:** Servir `app/` en localhost:8765 y recorrer con Playwright MCP (mismo método que la fase 1) el criterio de éxito del spec §12: onboarding con presupuestos (chrome oculto — verificar que las pestañas no responden), registrar los 5 tipos, editar y borrar en Movimientos, liquidar un compartido, previsión con disponible real, cerrar periodo y abrir el siguiente, Presupuesto, Patrimonio con saldos tras editar opening_balance y un objetivo con hucha automática, export xlsx → modificar → import (round-trip real en navegador), import CSV N26, gráficas pintadas. Posibles ptos ciegos: OPFS solo funciona en localhost/HTTPS; usar viewport móvil 390×844.
- [ ] **Step 2:** Cada fallo → arreglo + test de regresión si es de lógica. Commits `fix(app): …`.
- [ ] **Step 3:** Suite completa verde (`node --experimental-sqlite --test tests/app/` + `cd generator && .venv/bin/python -m pytest`) + commit final de la ola.

---

### Task 18: Publicación en GitHub Pages

**⚠️ GATE HUMANO: antes de ejecutar esta tarea hay que CONFIRMAR con Álvaro el nombre del repo (propuesto: `basecero`) y la visibilidad pública. No crear nada en GitHub sin esa confirmación explícita en la conversación.**

**Files:**
- Create: `.github/workflows/pages.yml`
- Modify: `README.md` (sección de la app + enlace a la URL pública)

- [ ] **Step 1: Workflow** (`.github/workflows/pages.yml`):

```yaml
name: pages
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: "${{ steps.deployment.outputs.page_url }}" }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: app }
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Crear el repo y publicar** (tras el gate): `gh repo create <nombre-confirmado> --public --source . --push` (o `git remote add origin` + push si el repo se crea desde la web). Activar Pages con source "GitHub Actions": `gh api -X POST repos/{owner}/{repo}/pages -f build_type=workflow` (si ya existe, `-X PUT`). Verificar el run del workflow (`gh run watch`) y abrir `https://<owner>.github.io/<repo>/`.
- [ ] **Step 3: README** — añadir sección "La app (PWA)": URL pública, instalación en Android/PC, aviso de datos 100 % locales y del flujo export/import xlsx. Commit + push.
- [ ] **Step 4: Verificación final en la URL pública** — instalar la PWA desde el móvil, comprobar OPFS persistente (registrar → cerrar → reabrir) y modo avión. Avisar a Álvaro para SU ronda de QA → sus hallazgos alimentan una segunda ola de fixes (fuera de este plan).

---

## Self-review del plan (hecho)

- **Cobertura del spec**: §3 motor xlsx → Tasks 1-4 · §4 registro/movimientos/Sara → Tasks 5-7 · §5 periodos/presupuestos/onboarding → Tasks 8-9 · §6 recurrentes/previsión → Tasks 10-11 · §7 patrimonio/objetivos/gráficas → Tasks 12-14 · §8 N26 → Task 15 · §9 publicación → Tasks 16-18 · §10 tests → distribuidos + Task 17. Los 4 deferred: MY_AMOUNT (T5), created_with (T3), maskable (T16), chrome (T8).
- **Discrepancia resuelta**: el spec §6 decía "weekly una por semana"; el dashboard de la hoja (`dashboards.py:118-123`, la referencia que el propio spec declara autoridad) cuenta weekly UNA vez por periodo. Se sigue la hoja: `ruleApplies` trata weekly como monthly. Anotado aquí para el ejecutor.
- **Consistencia de firmas**: `execMany` (T4) usada en T5/7/8/14/15; `spentByRootCategory` (T8) en T9/12/13; `accountBalance` (T11) en T13; `budgetStatus` (T9) en T12; `sparklineSvg` (T12) en T13; `renderRegistro(container, onDone, prefill)` (T5) en T11.
