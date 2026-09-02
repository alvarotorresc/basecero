import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openDb, seedMinimal, dumpAll, X, OLD_TRANSACTIONS_DDL } from "./helpers.mjs";
import { rowsToWorkbook, workbookToRows, validateImport } from "../../app/app/js/xlsx.js";
import { insertSql, CONTRACT } from "../../app/app/js/contract.js";
import { pendingMigrations } from "../../app/app/js/migrations.js";
import { replaceAllStmts } from "../../app/app/js/repo.js";
import { SQL } from "../../app/app/js/sql.js";

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

// Regresión (hallazgo crítico de la review final): la hoja del GENERADOR real añade a la
// derecha de "meta" (a partir de la columna D, con una C en blanco de por medio) una columna
// por cada enum con sus valores permitidos, para alimentar los desplegables — MÁS filas de
// valores (aquí 5, goal_types) que filas key/value reales (aquí 3). Antes del fix, el filtro de
// "fila vacía" miraba TODAS las columnas de la fila cruda, así que las filas 5 y 6 (sin key/value
// pero con un valor de enum en columna D/E) colaban como {key:"",value:""} duplicadas → replaceAll
// reventaba con "UNIQUE constraint failed: meta.key" al importar cualquier hoja del generador.
test("import: meta con columnas de enums del generador (más filas de enum que de key/value) no duplica PKs vacías", () => {
  const wb = wbFromSeed();
  wb.Sheets.meta = X.utils.aoa_to_sheet([
    ["key", "value", "", "account_types", "goal_types"],
    ["schema_version", "2", "", "checking", "emergency_fund"],
    ["currency", "EUR", "", "savings", "savings_target"],
    ["created_with", "basecero-pwa", "", "liability", "spending_cap"],
    ["", "", "", "", "savings_rate"],
    ["", "", "", "", "provision"],
  ]);
  const { data, errors } = workbookToRows(X, wb);
  assert.deepEqual(errors, []);
  assert.equal(data.meta.length, 3, "solo las 3 filas key/value reales, las 2 de solo-enum se descartan");
  assert.deepEqual(validateImport(data), []);
});

// Misma familia de bug, pero en una pestaña de DATOS (no meta): una fila totalmente vacía (p.ej.
// una fila de plantilla sobrante) no debe colarse como registro real ni chocar con las columnas
// booleanas (que "" mapea a 0, no a vacío — ver comentario en xlsx.js#workbookToRows).
test("import: fila totalmente vacía en una pestaña de datos (no meta) se descarta y valida limpio", () => {
  const wb = wbFromSeed();
  const existingRows = X.utils.sheet_to_json(wb.Sheets.accounts, { defval: "" });
  const header = Object.keys(existingRows[0]);
  const aoa = [header, ...existingRows.map((r) => header.map((h) => r[h])), header.map(() => "")];
  wb.Sheets.accounts = X.utils.aoa_to_sheet(aoa);
  const { data, errors } = workbookToRows(X, wb);
  assert.deepEqual(errors, []);
  assert.equal(data.accounts.length, existingRows.length, "la fila totalmente vacía se descarta");
  assert.deepEqual(validateImport(data), []);
});

const parse = (mutate) => workbookToRows(X, wbFromSeed(mutate)).data;

test("validate: base semilla válida", () => { assert.deepEqual(validateImport(parse()), []); });
test("validate: schema_version distinta de 1 o 2", () => {
  const d = parse((x) => { x.meta.find((m) => m.key === "schema_version").value = "3"; });
  assert.match(validateImport(d)[0], /schema_version/);
});

test("validate: una hoja v1 (schema_version=1) se sigue aceptando", () => {
  const d = parse((x) => { x.meta.find((m) => m.key === "schema_version").value = "1"; });
  assert.deepEqual(validateImport(d), []);
});

test("import: hoja v1 sin cabecera paid_by → todas las filas quedan en me", () => {
  const wb = wbFromSeed((dump) => {
    dump.transactions.push({ id: "tx-v1", date: "2026-08-02", period_id: "per-1", type: "expense",
      amount_cents: 1000, account_id: "acc-n26", counter_account_id: "", category_id: "cat-casa-alquiler",
      merchant: "M", note: "", is_shared: 0, share_pct_override: null, paid_by: "me", settled: 0,
      ref_id: "", rule_id: "", external_id: "", status: "pending",
      created_at: "2026-08-02T00:00:00Z", updated_at: "2026-08-02T00:00:00Z", deleted: 0 });
  });
  const ws = wb.Sheets.transactions;
  const fullHeader = X.utils.sheet_to_json(ws, { header: 1 })[0];
  const rows = X.utils.sheet_to_json(ws, { defval: "" });
  const header = fullHeader.filter((h) => h !== "paid_by");     // hoja v1: la columna no existe
  wb.Sheets.transactions = X.utils.aoa_to_sheet([header, ...rows.map((r) => header.map((h) => r[h]))]);

  const { data, errors } = workbookToRows(X, wb);
  assert.deepEqual(errors, []);
  assert.ok(data.transactions.length > 0);
  for (const r of data.transactions) assert.equal(r.paid_by, "me");
  assert.deepEqual(validateImport(data), []);
});

test("import: celda paid_by en blanco (cabecera presente) → me", () => {
  const wb = wbFromSeed();
  const header = X.utils.sheet_to_json(wb.Sheets.transactions, { header: 1 })[0];
  const row = { id: "tx-blank", date: "2026-08-01", period_id: "per-1", type: "expense", amount: 1,
    account_id: "acc-n26", counter_account_id: "", category_id: "cat-casa-alquiler", merchant: "", note: "",
    is_shared: "", share_pct_override: "", paid_by: "", settled: "", ref_id: "", rule_id: "", external_id: "",
    status: "pending", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", deleted: "" };
  wb.Sheets.transactions = X.utils.aoa_to_sheet([header, header.map((h) => row[h] ?? "")]);

  const { data, errors } = workbookToRows(X, wb);
  assert.deepEqual(errors, []);
  assert.equal(data.transactions.find((r) => r.id === "tx-blank").paid_by, "me");
  assert.deepEqual(validateImport(data), []);
});

test("validate: paid_by fuera del enum → error", () => {
  const wb = wbFromSeed();
  const header = X.utils.sheet_to_json(wb.Sheets.transactions, { header: 1 })[0];
  const row = { id: "tx-enum", date: "2026-08-01", period_id: "per-1", type: "expense", amount: 1,
    account_id: "acc-n26", counter_account_id: "", category_id: "cat-casa-alquiler", merchant: "", note: "",
    is_shared: false, share_pct_override: "", paid_by: "ambos", settled: false, ref_id: "", rule_id: "",
    external_id: "", status: "pending", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    deleted: false };
  wb.Sheets.transactions = X.utils.aoa_to_sheet([header, header.map((h) => row[h] ?? "")]);
  const { data } = workbookToRows(X, wb);
  assert.match(validateImport(data).join("\n"), /paid_by/);
});

// Helper local de los tres tests de invariantes de paid_by: una fila de transactions completa,
// escrita a mano sobre la cabecera real de la hoja (así el test no depende del orden de columnas).
function txSheet(wb, over) {
  const header = X.utils.sheet_to_json(wb.Sheets.transactions, { header: 1 })[0];
  const row = { id: "tx-1", date: "2026-08-01", period_id: "per-1", type: "expense", amount: 100,
    account_id: "acc-n26", counter_account_id: "", category_id: "cat-casa-alquiler", merchant: "", note: "",
    is_shared: true, share_pct_override: "", paid_by: "partner", settled: false, ref_id: "", rule_id: "",
    external_id: "", status: "pending", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    deleted: false, ...over };
  wb.Sheets.transactions = X.utils.aoa_to_sheet([header, header.map((h) => row[h] ?? "")]);
  return workbookToRows(X, wb).data;
}

test("validate: paid_by=partner en un ingreso o en un gasto no compartido → error", () => {
  const income = txSheet(wbFromSeed(), { type: "income", category_id: "cat-nomina", account_id: "", is_shared: false });
  assert.match(validateImport(income).join("\n"), /paid_by «partner» solo vale en un gasto compartido/);

  const noShared = txSheet(wbFromSeed(), { is_shared: false, account_id: "" });
  assert.match(validateImport(noShared).join("\n"), /paid_by «partner» solo vale en un gasto compartido/);
});

test("validate: paid_by=partner con cuenta llena da error; con cuenta vacía, ninguno", () => {
  const conCuenta = txSheet(wbFromSeed(), { account_id: "acc-n26" });
  assert.match(validateImport(conCuenta).join("\n"), /no puede llevar cuenta/);

  const sinCuenta = txSheet(wbFromSeed(), { account_id: "" });
  assert.deepEqual(validateImport(sinCuenta), [], "un gasto compartido pagado por la contraparte sin cuenta es válido");
});

test("validate: account_id vacío en un gasto NORMAL sigue dando fkEmpty", () => {
  const d = txSheet(wbFromSeed(), { paid_by: "me", is_shared: false, account_id: "" });
  assert.match(validateImport(d).join("\n"), /pestaña «transactions» fila 2: account_id vacío/);
});

// Item 4 (final fix wave): una devolución que enlaza (ref_id) un gasto pagado por la contraparte no
// es MÍA — el que la devuelve lo hace a quien pagó, no a mí. Fila completa a mano (mismo patrón que
// "hoja v1 sin cabecera paid_by" más arriba) porque hacen falta DOS filas de transactions enlazadas
// entre sí, y txSheet solo escribe una.
function txRow(over) {
  return { id: "tx-x", date: "2026-08-02", period_id: "per-1", type: "expense",
    amount_cents: 10000, account_id: "acc-n26", counter_account_id: "", category_id: "cat-casa-alquiler",
    merchant: "M", note: "", is_shared: 0, share_pct_override: null, paid_by: "me", settled: 0,
    ref_id: "", rule_id: "", external_id: "", status: "pending",
    created_at: "2026-08-02T00:00:00Z", updated_at: "2026-08-02T00:00:00Z", deleted: 0, ...over };
}

test("validate: una devolución que enlaza un gasto pagado por la contraparte da error; enlazando uno mío, ninguno", () => {
  const gastoSuyo = txRow({ id: "tx-gasto-suyo", is_shared: 1, paid_by: "partner", account_id: "" });
  const devolucionDeSuyo = txRow({ id: "tx-devolucion-suyo", type: "refund", ref_id: "tx-gasto-suyo" });
  const conPartner = parse((x) => { x.transactions.push(gastoSuyo, devolucionDeSuyo); });
  assert.deepEqual(validateImport(conPartner),
    ["pestaña «transactions» fila 3: una devolución no puede enlazar un gasto pagado por la contraparte"]);

  const gastoMio = txRow({ id: "tx-gasto-mio" });
  const devolucionDeMio = txRow({ id: "tx-devolucion-mio", type: "refund", ref_id: "tx-gasto-mio" });
  const sinPartner = parse((x) => { x.transactions.push(gastoMio, devolucionDeMio); });
  assert.deepEqual(validateImport(sinPartner), []);
});

test("import: replaceAll NO importa el schema_version de la hoja", () => {
  const db = openDb(); seedMinimal(db);   // BD en '2'
  const data = {
    meta: [
      { key: "schema_version", value: "1" },
      { key: "currency", value: "USD" },
      { key: "created_with", value: "basecero-pwa" },
    ],
    accounts: [], categories: [], periods: [], transactions: [], recurring_rules: [], goals: [], budgets: [],
  };
  for (const s of replaceAllStmts(data)) db.prepare(s.sql).run(...(s.bind ?? []));
  const meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((r) => [r.key, r.value]));
  assert.equal(meta.schema_version, "2", "la versión es propiedad de ESTA BD, no de la hoja");
  assert.equal(meta.currency, "USD", "el resto de claves de la hoja sí se aplican");
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
test("validate: PK vacía", () => {
  const d = parse((x) => { x.accounts[0].id = ""; });
  assert.match(validateImport(d)[0], /pestaña «accounts» fila 2: id vacío/);
});
// Item 2 (Important, review final): un id con caracteres fuera de [A-Za-z0-9_-] (payload de XSS
// tipo atributo roto, o cualquier otro basura) se rechaza — cubre tanto la key de meta como el id
// de una tabla de datos. El fixture normal (seeds kebab-case, ULIDs Crockford, keys de meta con
// underscore) NO debe disparar este check en el resto de la suite: control de "no demasiado estricto".
test("validate: id con caracteres no válidos se rechaza — en meta.key y en categories.id", () => {
  const d = parse((x) => {
    x.meta.push({ key: 'x" onfocus="a', value: "1" });
    const alquiler = x.categories.find((c) => c.id === "cat-casa-alquiler");
    alquiler.id = "cat-casa-alquiler<script>";
  });
  const errs = validateImport(d).join("\n");
  assert.match(errs, /pestaña «meta».*id con caracteres no válidos \(«x" onfocus="a»\)/);
  assert.match(errs, /pestaña «categories».*id con caracteres no válidos \(«cat-casa-alquiler<script>»\)/);
});
test("validate: PK duplicada (dentro de la misma pestaña, meta usa key)", () => {
  const d = parse((x) => { x.meta.push({ key: "schema_version", value: "1" }); });
  // el duplicado se reporta en la fila de la SEGUNDA aparición (fila 13: las 11 semillas + esta)
  assert.match(validateImport(d).join("\n"), /pestaña «meta» fila 13: id duplicado \(«schema_version»\)/);
});
test("validate: dos periodos open", () => {
  const d = parse((x) => { x.periods.push({ ...x.periods[0], id: "per-2", name: "Otro" }); });
  assert.match(validateImport(d)[0], /open/);
});
test("validate: importe no positivo salvo adjustment", () => {
  const d = parse();
  const base = { id: "tx-1", date: "2026-08-01", period_id: "per-1", type: "expense", amount_cents: 0,
    account_id: "acc-n26", counter_account_id: "", category_id: "cat-casa-alquiler", merchant: "", note: "",
    is_shared: 0, share_pct_override: null, paid_by: "me", settled: 0, ref_id: "", rule_id: "", external_id: "",
    status: "pending", created_at: "x", updated_at: "x", deleted: 0 };
  d.transactions.push(base);
  assert.match(validateImport(d)[0], /amount/);
  d.transactions[0] = { ...base, type: "adjustment", amount_cents: -500, category_id: "" };
  assert.deepEqual(validateImport(d), []);
});

// Fix round 1 (revisor): amount no numérico ("lunes") producía DOS errores — numericInvalid
// (correcto: no es un número) Y amountNotPositive ("!(NaN > 0)" es true, así que además
// diagnosticaba "no positivo", que es engañoso: el problema real es que no es un número en
// absoluto). amountNotPositive ahora solo se evalúa cuando amount_cents es finito.
test("validate: amount no numérico → SOLO numericInvalid, sin amountNotPositive duplicado", () => {
  const wb = wbFromSeed();
  const ws = wb.Sheets.transactions;
  const header = X.utils.sheet_to_json(ws, { header: 1 })[0];
  const row = { id: "tx-amt", date: "2026-08-01", period_id: "per-1", type: "expense", amount: "lunes",
    account_id: "acc-n26", counter_account_id: "", category_id: "cat-casa-alquiler", merchant: "", note: "",
    is_shared: 0, share_pct_override: "", settled: 0, ref_id: "", rule_id: "", external_id: "",
    status: "pending", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", deleted: 0 };
  wb.Sheets.transactions = X.utils.aoa_to_sheet([header, header.map((h) => row[h] ?? "")]);
  const { data, errors } = workbookToRows(X, wb);
  assert.deepEqual(errors, []);
  const amtErrs = validateImport(data).filter((e) => e.includes("amount"));
  assert.equal(amtErrs.length, 1, `esperaba 1 error de amount, hubo ${amtErrs.length}: ${amtErrs.join(" | ")}`);
  assert.match(amtErrs[0], /amount_cents no es un número válido \(«NaN»\)/);
});

// Fila base de transacción válida (contra la semilla) — reutilizada por varios tests de esta
// familia; cada test solo toca el campo bajo prueba.
const txBase = { id: "tx-x", date: "2026-08-01", period_id: "per-1", type: "expense", amount_cents: 100,
  account_id: "acc-n26", counter_account_id: "", category_id: "cat-casa-alquiler", merchant: "", note: "",
  is_shared: 0, share_pct_override: null, paid_by: "me", settled: 0, ref_id: "", rule_id: "", external_id: "",
  status: "pending", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", deleted: 0 };

test("validate: categoría con parent_id === id → error", () => {
  const d = parse((x) => {
    const c = x.categories.find((c) => c.id === "cat-casa-alquiler");
    c.parent_id = c.id;
  });
  assert.deepEqual(validateImport(d), ["pestaña «categories» fila 3: parent_id no puede apuntar a sí misma"]);
});

test("validate: árbol de categorías de 3 niveles (nieto→hijo→raíz) → error", () => {
  const d = parse((x) => {
    const hijo = x.categories.find((c) => c.id === "cat-casa-alquiler");
    x.categories.push({ ...hijo, id: "cat-nieto", name: "Nieto", parent_id: "cat-casa-alquiler" });
  });
  assert.deepEqual(validateImport(d),
    ["pestaña «categories» fila 5: parent_id debe apuntar a una categoría raíz (con parent_id vacío)"]);
});

test("validate: categoría hija con flow distinto al del padre → error", () => {
  const d = parse((x) => {
    const raiz = x.categories.find((c) => c.id === "cat-nomina"); // raíz income
    x.categories.push({ ...raiz, id: "cat-flow-bad", name: "Flow malo", parent_id: "cat-casa" }); // padre cat-casa es expense
  });
  assert.deepEqual(validateImport(d), ["pestaña «categories» fila 5: flow no coincide con el de su categoría padre"]);
});

test("validate: fecha no-ISO en columna de fecha no vacía → error", () => {
  const d = parse((x) => {
    x.transactions.push({ ...txBase, id: "tx-d1", date: "9999-99-99" });
    x.transactions.push({ ...txBase, id: "tx-d2", date: "not-a-date" });
    x.transactions.push({ ...txBase, id: "tx-d3", date: "2026-13-40" });
  });
  assert.deepEqual(validateImport(d), [
    "pestaña «transactions» fila 2: date no es una fecha ISO válida («9999-99-99»)",
    "pestaña «transactions» fila 3: date no es una fecha ISO válida («not-a-date»)",
    "pestaña «transactions» fila 4: date no es una fecha ISO válida («2026-13-40»)",
  ]);
});

test("validate: periodo closed con end_date vacío → error", () => {
  const d = parse((x) => { x.periods[0].status = "closed"; });
  assert.deepEqual(validateImport(d),
    ["pestaña «periods» fila 2: end_date debe estar vacío si status es open, y con valor si es closed"]);
});

test("validate: periodo open con end_date no vacío → error", () => {
  const d = parse((x) => { x.periods[0].end_date = "2026-08-31"; });
  assert.deepEqual(validateImport(d),
    ["pestaña «periods» fila 2: end_date debe estar vacío si status es open, y con valor si es closed"]);
});

test("validate: start_date posterior a end_date en periodo closed → error", () => {
  const d = parse((x) => { x.periods[0].status = "closed"; x.periods[0].end_date = "2026-01-01"; });
  assert.deepEqual(validateImport(d), ["pestaña «periods» fila 2: start_date es posterior a end_date"]);
});

test("validate: transacción viva con period_id a un periodo deleted=1 → error", () => {
  const d = parse((x) => {
    x.periods.push({ ...x.periods[0], id: "per-deleted", status: "closed", end_date: "2026-07-31", deleted: 1 });
    x.transactions.push({ ...txBase, id: "tx-live-deleted-period", period_id: "per-deleted" });
  });
  assert.deepEqual(validateImport(d),
    ["pestaña «transactions» fila 2: period_id apunta a «per-deleted» que está borrado en periods"]);
});

// CRÍTICO (contrato de este check): una exportación real puede tener soft-deletes encadenados —
// una fila BORRADA referenciando, vía FK, a otra fila también borrada — sin que eso sea un error.
// Solo VIVO→borrado es el error (fkDeleted). Prueba con una FK sin excepción (account_id, sin
// allowDeletedRef) para fijar la regla general, no el caso especial de abajo.
test("validate: fila borrada referenciando (FK) otra fila borrada no es error", () => {
  const d = parse((x) => {
    x.accounts.push({ ...x.accounts[0], id: "acc-dead", deleted: 1 });
    x.transactions.push({ ...txBase, id: "tx-dead", account_id: "acc-dead", deleted: 1 });
  });
  assert.deepEqual(validateImport(d), []);
});

// Excepción documentada en contract.js (FKS[].allowDeletedRef): softDeleteTransaction (repo.js)
// no comprueba, pre-Task 6, si el gasto que borra tiene un refund ACTIVO enlazado por ref_id — deja
// un refund VIVO apuntando a un gasto BORRADO. Es un estado alcanzable por uso normal HOY (borrar
// el gasto original de un reparto ya liquidado), así que el import no debe rechazar una BD real que
// ya esté en ese estado.
test("validate: refund vivo con ref_id a un gasto borrado no es error (allowDeletedRef, bug pre-Task 6)", () => {
  const d = parse((x) => {
    x.transactions.push({ ...txBase, id: "tx-gasto-borrado", settled: 1, deleted: 1 });
    x.transactions.push({ ...txBase, id: "tx-refund-huerfano", type: "refund", category_id: "", ref_id: "tx-gasto-borrado" });
  });
  assert.deepEqual(validateImport(d), []);
});

// Misma excepción para rule_id: softDeleteRule (repo.js) no hace cascada — las transacciones ya
// generadas por una regla (rule_id) siguen vivas cuando la regla se borra después.
test("validate: transacción viva con rule_id a una regla borrada no es error (allowDeletedRef)", () => {
  const d = parse((x) => {
    x.recurring_rules.push({ id: "rr-borrada", name: "Vieja", type: "expense", amount_cents: 1000,
      category_id: "cat-casa-alquiler", account_id: "acc-n26", counter_account_id: "", frequency: "monthly",
      due_day: 1, due_month: null, is_shared: 0, is_active: 0,
      created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", deleted: 1 });
    x.transactions.push({ ...txBase, id: "tx-de-regla-borrada", rule_id: "rr-borrada" });
  });
  assert.deepEqual(validateImport(d), []);
});

// Columnas numéricas NO-*_cents: workbookToRows las deja pasar tal cual (ni coerción ni
// parseo) — sin este bloque de checks, un "lunes" en my_share_pct sobrevive intacto hasta
// SQLite como TEXT (afinidad dinámica) y produce "NaN €"/"NaN %" en cualquier pantalla que
// haga aritmética con la columna.
test("validate: my_share_pct no numérico → error", () => {
  const d = parse((x) => { x.periods[0].my_share_pct = "lunes"; });
  assert.match(validateImport(d).join("\n"), /pestaña «periods».*my_share_pct no es un número válido \(«lunes»\)/s);
});

test("validate: due_day fuera de rango (32) → error de rango", () => {
  const d = parse((x) => {
    x.recurring_rules.push({ id: "rr-1", name: "Alquiler", type: "expense", amount_cents: 1000,
      category_id: "cat-casa-alquiler", account_id: "acc-n26", counter_account_id: "", frequency: "monthly",
      due_day: 32, due_month: null, is_shared: 0, is_active: 1,
      created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", deleted: 0 });
  });
  assert.match(validateImport(d).join("\n"), /pestaña «recurring_rules».*due_day fuera de rango \[1, 31\] \(«32»\)/s);
});

test("validate: due_month fuera de rango (13) → error", () => {
  const d = parse((x) => {
    x.recurring_rules.push({ id: "rr-1", name: "Alquiler", type: "expense", amount_cents: 1000,
      category_id: "cat-casa-alquiler", account_id: "acc-n26", counter_account_id: "", frequency: "monthly",
      due_day: null, due_month: 13, is_shared: 0, is_active: 1,
      created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", deleted: 0 });
  });
  assert.match(validateImport(d).join("\n"), /pestaña «recurring_rules».*due_month fuera de rango \[1, 12\] \(«13»\)/s);
});

test("validate: display_order no numérico → error", () => {
  const d = parse((x) => { x.accounts[0].display_order = "x"; });
  assert.match(validateImport(d).join("\n"), /pestaña «accounts».*display_order no es un número válido \(«x»\)/s);
});

// I1 (revisión final del PR de seguridad): todos los checks de arriba validan el FORMATO de un
// valor presente, pero se saltaban "" / null sin más — una celda REQUERIDA (columna NOT NULL en
// schema.sql) que llega en blanco pasaba validateImport limpia. Confirmado como corrupción
// silenciosa: my_share_pct en blanco guarda TEXT '' en una columna NOT NULL → COALESCE no
// coalesce ese '' → todo reparto compartido pasa a 0%/100% en silencio. amount_cents/
// opening_balance_cents/budgets.amount_cents en blanco → null → pasa validateImport → el import
// aborta con el error crudo de NOT NULL de SQLite. date/start_date en blanco → se aceptan y aplican.
//
// display_order (accounts/categories) entra en el mismo saco: es NOT NULL DEFAULT 0 y la misma
// columna NUMERIC_COLS ya la itera — un blank ahí guarda TEXT '' en una columna INTEGER y rompe
// cualquier ORDER BY display_order. No lo menciona el hallazgo original pero es la misma clase de
// bug y el check ya pasa por esa columna, así que se incluye.
//
// Columnas NULLABLE_NUM (share_pct_override, due_day, due_month, target_amount_cents,
// target_months, target_pct) y end_date/target_date NO son required — schema.sql las declara sin
// NOT NULL (o con DEFAULT '' + invariante propio, caso de end_date) y deben seguir aceptando
// blanco. Los tests negativos de abajo fijan justo eso.
test("validate: my_share_pct en blanco (periodo) → error required, no se salta como un skip nullable", () => {
  const d = parse((x) => { x.periods[0].my_share_pct = ""; });
  assert.deepEqual(validateImport(d),
    ["pestaña «periods» fila 2: my_share_pct es obligatorio y está vacío"]);
});

// " " (solo espacio) NO es === "" pero Number(" ") es 0 — un finito válido que, sin trim() en el
// check, se colaría dentro de [0,100] y dejaría pasar la MISMA corrupción silenciosa (TEXT no
// numérico en columna REAL NOT NULL) que este fix existe para cerrar.
test("validate: my_share_pct con un solo espacio en blanco → error required (no Number(\" \")===0 colándose)", () => {
  const d = parse((x) => { x.periods[0].my_share_pct = " "; });
  assert.deepEqual(validateImport(d),
    ["pestaña «periods» fila 2: my_share_pct es obligatorio y está vacío"]);
});

test("validate: display_order en blanco (accounts) → error required", () => {
  const d = parse((x) => { x.accounts[0].display_order = ""; });
  assert.deepEqual(validateImport(d),
    ["pestaña «accounts» fila 2: display_order es obligatorio y está vacío"]);
});

test("validate: amount_cents en blanco (transacción) → error required, no null silencioso", () => {
  const d = parse();
  d.transactions.push({ ...txBase, id: "tx-blank-amount", amount_cents: null });
  assert.deepEqual(validateImport(d),
    ["pestaña «transactions» fila 2: amount_cents es obligatorio y está vacío"]);
});

test("validate: opening_balance_cents en blanco (cuenta) → error required", () => {
  const d = parse((x) => { x.accounts[0].opening_balance_cents = null; });
  assert.deepEqual(validateImport(d),
    ["pestaña «accounts» fila 2: opening_balance_cents es obligatorio y está vacío"]);
});

test("validate: budgets.amount_cents en blanco → error required", () => {
  const d = parse();
  d.budgets.push({ id: "bud-blank", period_id: "per-1", category_id: "cat-casa-alquiler",
    amount_cents: null, created_at: "x", updated_at: "x", deleted: 0 });
  assert.deepEqual(validateImport(d),
    ["pestaña «budgets» fila 2: amount_cents es obligatorio y está vacío"]);
});

test("validate: recurring_rules.amount_cents en blanco → error required", () => {
  const d = parse();
  d.recurring_rules.push({ id: "rr-blank", name: "Alquiler", type: "expense", amount_cents: null,
    category_id: "cat-casa-alquiler", account_id: "acc-n26", counter_account_id: "", frequency: "monthly",
    due_day: 1, due_month: null, is_shared: 0, is_active: 1,
    created_at: "x", updated_at: "x", deleted: 0 });
  assert.deepEqual(validateImport(d),
    ["pestaña «recurring_rules» fila 2: amount_cents es obligatorio y está vacío"]);
});

test("validate: transactions.date en blanco → error required, sin fallar como fecha no-ISO", () => {
  const d = parse();
  d.transactions.push({ ...txBase, id: "tx-blank-date", date: "" });
  assert.deepEqual(validateImport(d),
    ["pestaña «transactions» fila 2: date es obligatorio y está vacío"]);
});

test("validate: periods.start_date en blanco → error required", () => {
  const d = parse((x) => { x.periods[0].start_date = ""; });
  assert.deepEqual(validateImport(d),
    ["pestaña «periods» fila 2: start_date es obligatorio y está vacío"]);
});

// Negativos: blancos LEGÍTIMOS (columnas nullable/opcionales por contrato) siguen sin ser error —
// control de "no demasiado estricto" simétrico al de arriba.
test("validate: end_date en blanco en periodo open sigue sin ser error (blanco legítimo)", () => {
  assert.deepEqual(validateImport(parse()), []); // per-1 (semilla) ya es open con end_date=""
});

test("validate: share_pct_override en blanco en una transacción sigue sin ser error (nullable)", () => {
  const d = parse();
  d.transactions.push({ ...txBase, id: "tx-null-pct", share_pct_override: null });
  assert.deepEqual(validateImport(d), []);
});

test("validate: target_amount_cents/target_months/target_pct/target_date en blanco en un goal siguen sin ser error (nullable/opcional)", () => {
  const d = parse();
  d.goals.push({ id: "goal-blank", name: "Fondo", type: "emergency_fund",
    target_amount_cents: null, target_months: null, target_pct: null, target_date: "",
    account_id: "", category_id: "", is_active: 1, created_at: "x", updated_at: "x", deleted: 0 });
  assert.deepEqual(validateImport(d), []);
});

// Columnas booleanas: la única forma real de inyectar un valor "crudo" no reconocido es
// escribiéndolo directamente en la celda del workbook — un dump de la propia app (vía
// rowsToWorkbook) SIEMPRE produce 0/1 limpios, así que el vector de ataque real es un xlsx
// editado a mano o corrupto, no una re-exportación de la app.
test("validate: columna booleana con valor no reconocido (\"yes\"/\"maybe\") → error, sin coerción silenciosa a false", () => {
  const wb = wbFromSeed();
  const ws = wb.Sheets.transactions;
  const header = X.utils.sheet_to_json(ws, { header: 1 })[0];
  const row = { id: "tx-bool", date: "2026-08-01", period_id: "per-1", type: "expense", amount: 1,
    account_id: "acc-n26", counter_account_id: "", category_id: "cat-casa-alquiler", merchant: "", note: "",
    is_shared: "yes", share_pct_override: "", settled: "maybe", ref_id: "", rule_id: "", external_id: "",
    status: "pending", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", deleted: 0 };
  wb.Sheets.transactions = X.utils.aoa_to_sheet([header, header.map((h) => row[h] ?? "")]);
  const { data, errors } = workbookToRows(X, wb);
  assert.deepEqual(errors, []); // el parseo en sí no falla: "yes"/"maybe" sobreviven crudos a data
  const errs = validateImport(data).join("\n");
  assert.match(errs, /pestaña «transactions».*is_shared no es un valor booleano válido \(«yes»\)/s);
  assert.match(errs, /pestaña «transactions».*settled no es un valor booleano válido \(«maybe»\)/s);
});

// Contrato explícito: una celda booleana en blanco (hoja rellenada a mano, dropdown sin elegir
// todavía) NO es un error — se coerciona a false, igual que hacía el código antes de este fix.
// Sin este test, alguien podría "cerrar" el enum quitando "" de BOOL_FALSE pensando que endurece
// la validación, y rompería el import de cualquier hoja del generador con booleanos sin rellenar.
test("validate: celda booleana vacía → false, no error (hoja rellenada a mano)", () => {
  const wb = wbFromSeed();
  const ws = wb.Sheets.transactions;
  const header = X.utils.sheet_to_json(ws, { header: 1 })[0];
  const row = { id: "tx-bool-blank", date: "2026-08-01", period_id: "per-1", type: "expense", amount: 1,
    account_id: "acc-n26", counter_account_id: "", category_id: "cat-casa-alquiler", merchant: "", note: "",
    is_shared: "", share_pct_override: "", settled: "", ref_id: "", rule_id: "", external_id: "",
    status: "pending", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", deleted: "" };
  wb.Sheets.transactions = X.utils.aoa_to_sheet([header, header.map((h) => row[h] ?? "")]);
  const { data, errors } = workbookToRows(X, wb);
  assert.deepEqual(errors, []);
  const tx = data.transactions.find((r) => r.id === "tx-bool-blank");
  assert.equal(tx.is_shared, 0);
  assert.equal(tx.settled, 0);
  assert.equal(tx.deleted, 0);
  assert.deepEqual(validateImport(data), []);
});

// Fix round 1 (revisor): si la CABECERA de una columna booleana falta directamente en la hoja
// (no solo la celda vacía), el default-fill (línea ~76) le asignaba "" — justo lo que el nuevo
// booleanInvalid rechaza, anulando la tolerancia a hojas antiguas/del generador que la
// inclusión de "" en BOOL_FALSE pretendía dar. El default-fill ahora asigna 0 para columnas
// booleanas, igual que si la celda estuviera vacía (mismo criterio, misma constante bools).
test("import: pestaña sin cabecera de columna booleana (is_archived) → default 0, sin error", () => {
  const wb = wbFromSeed();
  const ws = wb.Sheets.accounts;
  const fullHeader = X.utils.sheet_to_json(ws, { header: 1 })[0];
  const rows = X.utils.sheet_to_json(ws, { defval: "" });
  const header = fullHeader.filter((h) => h !== "is_archived");
  const aoa = [header, ...rows.map((r) => header.map((h) => r[h]))];
  wb.Sheets.accounts = X.utils.aoa_to_sheet(aoa);
  const { data, errors } = workbookToRows(X, wb);
  assert.deepEqual(errors, []);
  assert.ok(data.accounts.length > 0);
  for (const r of data.accounts) assert.equal(r.is_archived, 0);
  assert.deepEqual(validateImport(data), []);
});

// Task 8 (5c): created_at/updated_at son NOT NULL en schema.sql, pero "" satisface NOT NULL
// (se guarda como texto vacío) — un residuo de storage silencioso, no un error de validación
// (ninguna de las dos columnas está en DATE_COLS/REQUIRED_DATE_COLS ni en ningún otro check de
// validateImport). Blanco de fábrica típico: hoja del generador con la columna presente pero sin
// rellenar a mano. workbookToRows debe rellenarlas con un timestamp no vacío en vez de dejarlas "".
test("import: created_at/updated_at en blanco se rellenan con timestamp no vacío (5c)", () => {
  const wb = wbFromSeed();
  const ws = wb.Sheets.accounts;
  const header = X.utils.sheet_to_json(ws, { header: 1 })[0];
  const rows = X.utils.sheet_to_json(ws, { defval: "" });
  const aoa = [header, ...rows.map((r) =>
    header.map((h) => (h === "created_at" || h === "updated_at") ? "" : r[h]))];
  wb.Sheets.accounts = X.utils.aoa_to_sheet(aoa);
  const { data, errors } = workbookToRows(X, wb);
  assert.deepEqual(errors, []);
  assert.ok(data.accounts.length > 0);
  for (const r of data.accounts) {
    assert.notEqual(r.created_at, "");
    assert.notEqual(r.updated_at, "");
  }
  assert.deepEqual(validateImport(data), []);
});

// Determinismo (ruling 5): NO se llama a nowIso() directo dentro de workbookToRows de forma que
// un test no pueda fijar el valor — el 3er parámetro `now` es inyectable, con default nowIso()
// SOLO cuando el llamador (onboarding.js/ajustes.js) no pasa nada. Aquí se inyecta un valor fijo
// y se comprueba que es EXACTAMENTE ese valor, no solo "no vacío".
test("import: created_at/updated_at en blanco usan el `now` inyectado, no Date.now() (determinismo)", () => {
  const wb = wbFromSeed();
  const ws = wb.Sheets.accounts;
  const header = X.utils.sheet_to_json(ws, { header: 1 })[0];
  const rows = X.utils.sheet_to_json(ws, { defval: "" });
  const aoa = [header, ...rows.map((r) =>
    header.map((h) => (h === "created_at" || h === "updated_at") ? "" : r[h]))];
  wb.Sheets.accounts = X.utils.aoa_to_sheet(aoa);
  const NOW = "2026-08-29T12:00:00Z";
  const { data, errors } = workbookToRows(X, wb, NOW);
  assert.deepEqual(errors, []);
  assert.ok(data.accounts.length > 0);
  for (const r of data.accounts) {
    assert.equal(r.created_at, NOW);
    assert.equal(r.updated_at, NOW);
  }
});

// Mismo default-fill cuando la CABECERA falta directamente (no solo la celda vacía) — mismo
// criterio que el fix round 1 de is_archived (test de arriba): una columna NOT NULL ausente de
// la hoja no debe colar "" hasta el INSERT.
test("import: pestaña sin cabecera created_at/updated_at → default-fill, no vacío", () => {
  const wb = wbFromSeed();
  const ws = wb.Sheets.accounts;
  const fullHeader = X.utils.sheet_to_json(ws, { header: 1 })[0];
  const rows = X.utils.sheet_to_json(ws, { defval: "" });
  const header = fullHeader.filter((h) => h !== "created_at" && h !== "updated_at");
  const aoa = [header, ...rows.map((r) => header.map((h) => r[h]))];
  wb.Sheets.accounts = X.utils.aoa_to_sheet(aoa);
  const { data, errors } = workbookToRows(X, wb);
  assert.deepEqual(errors, []);
  assert.ok(data.accounts.length > 0);
  for (const r of data.accounts) {
    assert.notEqual(r.created_at, "");
    assert.notEqual(r.updated_at, "");
  }
  assert.deepEqual(validateImport(data), []);
});

test("import: nullable numeric columns round-trip como null", () => {
  const T = "2026-08-01T00:00:00Z";
  const db = openDb(); seedMinimal(db);

  // Insert test rows with null values
  const ins = (sql, ...p) => db.prepare(sql).run(...p);
  ins(`INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,counter_account_id,category_id,merchant,note,is_shared,share_pct_override,settled,ref_id,rule_id,external_id,status,created_at,updated_at,deleted)
       VALUES ('tx-null','2026-08-01','per-1','expense',1000,'acc-n26','','cat-casa-alquiler','','',0,NULL,0,'','','','pending',?,?,0)`, T, T);
  ins(`INSERT INTO recurring_rules (id,name,type,amount_cents,category_id,account_id,counter_account_id,frequency,due_day,due_month,is_shared,is_active,created_at,updated_at,deleted)
       VALUES ('rr-null','Test','expense',1000,'cat-casa-alquiler','acc-n26','','monthly',NULL,NULL,0,1,?,?,0)`, T, T);
  ins(`INSERT INTO goals (id,name,type,target_amount_cents,target_months,target_pct,target_date,account_id,category_id,is_active,created_at,updated_at,deleted)
       VALUES ('goal-null','Test','savings_target',NULL,NULL,NULL,'','','',1,?,?,0)`, T, T);

  const dump = dumpAll(db);
  const wb = rowsToWorkbook(X, dump);
  const { data } = workbookToRows(X, wb);

  const tx = data.transactions.find((r) => r.id === "tx-null");
  assert.strictEqual(tx.share_pct_override, null);

  const rr = data.recurring_rules.find((r) => r.id === "rr-null");
  assert.strictEqual(rr.due_day, null);
  assert.strictEqual(rr.due_month, null);

  const goal = data.goals.find((r) => r.id === "goal-null");
  assert.strictEqual(goal.target_amount_cents, null);
  assert.strictEqual(goal.target_months, null);
  assert.strictEqual(goal.target_pct, null);
});

test("ROUND-TRIP: export → import → mismos datos", () => {
  const db = openDb(); seedMinimal(db);
  // enriquecer: transacción de cada tipo, regla, goal y budget
  const T2 = "2026-08-02T00:00:00Z";
  const tx = (id, type, cents, extra = {}) => db.prepare(insertSql("transactions")).run(...CONTRACT.transactions.cols.map((c) =>
    ({ id, date: "2026-08-02", period_id: "per-1", type, amount_cents: cents, account_id: "acc-n26",
       counter_account_id: "", category_id: type === "transfer" || type === "adjustment" ? "" : "cat-casa-alquiler",
       merchant: "M", note: "", is_shared: 0, share_pct_override: null, paid_by: "me", settled: 0, ref_id: "", rule_id: "",
       external_id: "", status: "pending", created_at: T2, updated_at: T2, deleted: 0, ...extra })[c]));
  tx("tx-e", "expense", 900, { is_shared: 1 });
  tx("tx-i", "income", 215000, { category_id: "cat-nomina" });
  tx("tx-t", "transfer", 5000, { counter_account_id: "acc-revolut" });
  tx("tx-r", "refund", 360, { ref_id: "tx-e" });
  tx("tx-a", "adjustment", -123);
  // Las dos direcciones del compartido y el apunte de salida que las liquida (el mundo nuevo):
  tx("tx-mio", "expense", 10000, { is_shared: 1, paid_by: "me" });
  tx("tx-suyo", "expense", 10000, { is_shared: 1, paid_by: "partner", account_id: "" });
  tx("tx-liq", "adjustment", -6000, { ref_id: "tx-suyo", merchant: "Liquidacion con Alex" });
  db.prepare(insertSql("recurring_rules")).run("rr-1","Alquiler","expense",90000,"cat-casa-alquiler","acc-n26","","monthly",1,null,1,1,T2,T2,0);
  db.prepare(insertSql("goals")).run("goal-1","Fondo emergencia","emergency_fund",null,6,null,"","acc-revolut","",1,T2,T2,0);
  db.prepare(insertSql("budgets")).run("bud-1","per-1","cat-casa",70000,T2,T2,0);

  const original = dumpAll(db);
  const buf = X.write(rowsToWorkbook(X, original), { type: "buffer", bookType: "xlsx" });
  const { data, errors } = workbookToRows(X, X.read(buf, { type: "buffer" }));
  assert.deepEqual(errors, []);
  assert.deepEqual(validateImport(data), []);

  const db2 = openDb(); // aplicar el import con la MISMA lógica que replaceAll (fusión de meta incluida)
  for (const s of replaceAllStmts(data)) db2.prepare(s.sql).run(...(s.bind ?? []));
  assert.deepEqual(dumpAll(db2), original);
});

test("ROUND-TRIP sobre una BD MIGRADA (paid_by físicamente la última): los dumps coinciden", () => {
  // El ALTER TABLE del runner deja paid_by al FINAL de la tabla; schema.sql la declara en medio.
  // Nada del código depende del orden físico (todo nombra columnas), y esto lo demuestra.
  // La BD de partida se construye creando PRIMERO la tabla vieja (el DDL literal de helpers.mjs,
  // el MISMO que usa migraciones.test.mjs) y ejecutando schema.sql DESPUÉS: sus CREATE TABLE IF
  // NOT EXISTS dejan intacta la transactions que ya existe —justo el motivo por el que migrations.js
  // hace falta— y crean el resto de tablas, los índices y las semillas. Es exactamente la BD de un
  // usuario de la versión anterior, y no depende de recortar el texto de schema.sql con un
  // .replace() (que un cambio de indentación convertiría en un no-op silencioso).
  const db = new DatabaseSync(":memory:");
  db.exec(OLD_TRANSACTIONS_DDL);
  db.exec(readFileSync(new URL("../../app/app/js/schema.sql", import.meta.url), "utf8"));
  assert.ok(!db.prepare("PRAGMA table_info(transactions)").all().some((c) => c.name === "paid_by"),
    "la BD de partida es la de la versión anterior: transactions SIN paid_by");

  for (const s of pendingMigrations({ transactions: db.prepare("PRAGMA table_info(transactions)").all().map((c) => c.name) }))
    (s.bind?.length ? db.prepare(s.sql).run(...s.bind) : db.exec(s.sql));
  assert.equal(db.prepare("PRAGMA table_info(transactions)").all().at(-1).name, "paid_by");
  seedMinimal(db);
  db.prepare(insertSql("transactions")).run(...CONTRACT.transactions.cols.map((c) =>
    ({ id: "tx-mig", date: "2026-08-02", period_id: "per-1", type: "expense", amount_cents: 10000,
       account_id: "", counter_account_id: "", category_id: "cat-casa-alquiler", merchant: "M", note: "",
       is_shared: 1, share_pct_override: null, paid_by: "partner", settled: 0, ref_id: "", rule_id: "",
       external_id: "", status: "pending", created_at: "2026-08-02T00:00:00Z",
       updated_at: "2026-08-02T00:00:00Z", deleted: 0 })[c]));

  const original = dumpAll(db);
  const buf = X.write(rowsToWorkbook(X, original), { type: "buffer", bookType: "xlsx" });
  const { data, errors } = workbookToRows(X, X.read(buf, { type: "buffer" }));
  assert.deepEqual(errors, []);
  assert.deepEqual(validateImport(data), []);

  const db2 = openDb();     // BD de schema.sql FRESCO (paid_by en medio)
  for (const s of replaceAllStmts(data)) db2.prepare(s.sql).run(...(s.bind ?? []));
  assert.deepEqual(dumpAll(db2), original);
});

test("import: replaceAll fusiona meta — conserva claves que la hoja no trae", () => {
  const db = openDb(); seedMinimal(db);
  // config del usuario que una hoja antigua no conoce (upsert: vale antes y después de que existan como semilla)
  db.prepare(SQL.upsertMeta).run("locale", "en-GB");
  db.prepare(SQL.upsertMeta).run("csv_profile", "{}");
  const data = {
    meta: [
      { key: "schema_version", value: "2" },
      { key: "currency", value: "USD" },
      { key: "created_with", value: "basecero-pwa" },
    ],
    accounts: [], categories: [], periods: [], transactions: [], recurring_rules: [], goals: [], budgets: [],
  };
  for (const s of replaceAllStmts(data)) db.prepare(s.sql).run(...(s.bind ?? []));
  const meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((r) => [r.key, r.value]));
  assert.equal(meta.locale, "en-GB", "clave ausente de la hoja: sobrevive");
  assert.equal(meta.csv_profile, "{}", "clave ausente de la hoja: sobrevive");
  assert.equal(meta.currency, "USD", "clave presente en la hoja: se actualiza");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM accounts").get().c, 0, "las demás tablas SÍ se reemplazan");
});
