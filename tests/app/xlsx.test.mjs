import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, seedMinimal, dumpAll, X } from "./helpers.mjs";
import { rowsToWorkbook, workbookToRows, validateImport } from "../../app/js/xlsx.js";
import { insertSql, CONTRACT } from "../../app/js/contract.js";
import { replaceAllStmts } from "../../app/js/repo.js";
import { SQL } from "../../app/js/sql.js";

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
    ["schema_version", "1", "", "checking", "emergency_fund"],
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
  // el duplicado se reporta en la fila de la SEGUNDA aparición (fila 10: las 8 semillas + esta)
  assert.match(validateImport(d).join("\n"), /pestaña «meta» fila 10: id duplicado \(«schema_version»\)/);
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

  const db2 = openDb(); // aplicar el import con la MISMA lógica que replaceAll (fusión de meta incluida)
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
      { key: "schema_version", value: "1" },
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
