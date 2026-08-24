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
