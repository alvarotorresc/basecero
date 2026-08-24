import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, seedMinimal, dumpAll, X } from "./helpers.mjs";
import { rowsToWorkbook, workbookToRows, validateImport } from "../../app/js/xlsx.js";

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
