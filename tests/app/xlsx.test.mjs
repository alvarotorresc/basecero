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
