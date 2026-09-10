import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTRACT, ENUMS, BOOL_COLS, NULLABLE_NUM, TEXT_DEFAULTS, FKS, eurToCents, centsToEur, toIsoDate, xlsxHeader, insertSql } from "../../app/app/js/contract.js";

test("columnas canónicas de transactions (orden del schema)", () => {
  assert.deepEqual(CONTRACT.transactions.cols, [
    "id","date","period_id","type","amount_cents","account_id","counter_account_id",
    "category_id","merchant","note","is_shared","share_pct_override","paid_by","settled",
    "ref_id","rule_id","tag_id","external_id","status","created_at","updated_at","deleted"]);
});
test("las 9 tablas del contrato, con tags al final", () => {
  assert.deepEqual(Object.keys(CONTRACT),
    ["meta","accounts","categories","periods","transactions","recurring_rules","goals","budgets","tags"]);
});

// El criterio de §4.1 (etiquetas-design.md): si alguien marca una tabla del núcleo como opcional
// para que "ese import pase", este test se pone rojo. Las ocho van escritas a mano a propósito.
test("ninguna tabla del núcleo puede ser opcional", () => {
  for (const table of ["meta","accounts","categories","periods","transactions","recurring_rules","goals","budgets"])
    assert.ok(!CONTRACT[table].optional, `${table} NO puede ser opcional`);
});

test("tags es la única tabla opcional, con sus columnas y sin flow/parent_id/color/icono (D3, D14)", () => {
  assert.equal(CONTRACT.tags.optional, true);
  assert.deepEqual(CONTRACT.tags.cols, ["id","name","budget_cents","is_archived","created_at","updated_at","deleted"]);
});

test("columnas canónicas de transactions: tag_id tras rule_id", () => {
  const cols = CONTRACT.transactions.cols;
  assert.equal(cols[cols.indexOf("tag_id") - 1], "rule_id");
});

test("BOOL_COLS.tags es is_archived/deleted", () => {
  assert.deepEqual(BOOL_COLS.tags, ["is_archived", "deleted"]);
});

// D4: budget_cents es NULLABLE — una hoja con la celda del límite en blanco no debe reportar
// `required` (xlsx.js:330-332 reportaría eso si budget_cents no estuviera en este set).
test("NULLABLE_NUM incluye budget_cents", () => {
  assert.ok(NULLABLE_NUM.has("budget_cents"));
});

// tag_id: FK opcional a tags, con allowDeletedRef (D5) — la app nunca produce ese estado
// (archivar es is_archived), pero una hoja editada a mano con una etiqueta borrada no debe tirar
// abajo el import entero.
test("FKS incluye transactions.tag_id -> tags, opcional y con allowDeletedRef", () => {
  const fk = FKS.find((f) => f.table === "transactions" && f.col === "tag_id");
  assert.ok(fk, "existe la FK de tag_id");
  assert.equal(fk.ref, "tags");
  assert.equal(fk.optional, true);
  assert.equal(fk.allowDeletedRef, true);
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

test("insertSql(transactions): 22 columnas y 22 placeholders", () => {
  const sql = insertSql("transactions");
  assert.equal(CONTRACT.transactions.cols.length, 22);
  assert.equal(sql.match(/\?/g).length, 22);
  assert.match(sql, /share_pct_override,paid_by,settled/, "paid_by va entre el reparto y settled");
  assert.match(sql, /rule_id,tag_id,external_id/, "tag_id va entre rule_id y external_id");
});

test("ENUMS.transactions.paid_by es exactamente me/partner (sin cadena vacía)", () => {
  assert.deepEqual(ENUMS.transactions.paid_by, ["me", "partner"]);
});

test("TEXT_DEFAULTS: paid_by de transactions cae a me", () => {
  assert.equal(TEXT_DEFAULTS.transactions.paid_by, "me");
});

// Suscripciones (v3): is_subscription y cancelled_at entre is_active y created_at — mismo criterio
// de colocación semántica que paid_by en transactions.
test("columnas canónicas de recurring_rules: is_subscription y cancelled_at entre is_active y created_at", () => {
  assert.deepEqual(CONTRACT.recurring_rules.cols, [
    "id", "name", "type", "amount_cents", "category_id", "account_id", "counter_account_id",
    "frequency", "due_day", "due_month", "is_shared", "is_active", "is_subscription", "cancelled_at",
    "created_at", "updated_at", "deleted"]);
});

test("BOOL_COLS.recurring_rules incluye is_subscription", () => {
  assert.deepEqual(BOOL_COLS.recurring_rules, ["is_shared", "is_active", "is_subscription", "deleted"]);
});
