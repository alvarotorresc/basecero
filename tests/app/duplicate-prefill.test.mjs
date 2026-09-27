import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDuplicatePrefill } from "../../app/app/js/duplicate-prefill.js";

// Fila mínima de getTransaction (repo.js): solo los campos que buildDuplicatePrefill lee. Los
// campos que NUNCA debe copiar (ref_id, rule_id, external_id, date, has_attachment, status,
// settled) se dejan puestos a propósito, para que un deepEqual contra la forma exacta del
// resultado los cace si algún día se cuelan.
const ROW = {
  type: "expense",
  amount_cents: 990,
  category_id: "cat-1",
  account_id: "acc-1",
  counter_account_id: "",
  merchant: "Bar Pepe",
  note: "Desayuno con Luis",
  is_shared: 1,
  paid_by: "me",
  share_pct_override: 70,
  tag_id: "tag-1",
  ref_id: "ref-should-not-copy",
  rule_id: "rule-should-not-copy",
  external_id: "ext-should-not-copy",
  date: "2020-01-01",
  has_attachment: 1,
  status: "done",
  settled: 1,
  period_id: "per-1",
};

test("buildDuplicatePrefill: copia tipo, importe, comercio, categoría, cuenta, etiqueta, reparto y nota", () => {
  assert.deepEqual(buildDuplicatePrefill(ROW, 100), {
    type: "expense",
    amountCents: 990,
    adjustmentSign: "+",
    merchant: "Bar Pepe",
    note: "Desayuno con Luis",
    isShared: true,
    paidBy: "me",
    sharePct: 70,
    categoryId: "cat-1",
    accountId: "acc-1",
    tagId: "tag-1",
  });
});

test("buildDuplicatePrefill: nunca copia ref_id, rule_id, external_id, fecha ni el estado de liquidación", () => {
  const out = buildDuplicatePrefill(ROW, 100);
  for (const key of ["refId", "ruleId", "externalId", "fecha", "date", "hasAttachment", "status", "settled"]) {
    assert.equal(key in out, false, key);
  }
});

test("buildDuplicatePrefill: importe siempre en valor absoluto, con el signo del ajuste aparte", () => {
  const negative = buildDuplicatePrefill({ ...ROW, type: "adjustment", amount_cents: -500 });
  assert.equal(negative.amountCents, 500);
  assert.equal(negative.adjustmentSign, "-");
  const positive = buildDuplicatePrefill({ ...ROW, type: "adjustment", amount_cents: 500 });
  assert.equal(positive.adjustmentSign, "+");
});

test("buildDuplicatePrefill: gasto que pagó la contraparte (cuenta en blanco) omite accountId, no lo manda vacío ni null", () => {
  const out = buildDuplicatePrefill({ ...ROW, paid_by: "partner", account_id: "" }, 100);
  assert.equal("accountId" in out, false);
  assert.equal(out.paidBy, "partner");
  assert.equal(out.isShared, true);
});

test("buildDuplicatePrefill: sin categoría, cuenta destino o etiqueta (transferencia) omite esas claves", () => {
  const out = buildDuplicatePrefill({
    ...ROW, type: "transfer", category_id: "", account_id: "acc-1", counter_account_id: "acc-2", tag_id: "",
  }, 100);
  assert.equal("categoryId" in out, false);
  assert.equal("tagId" in out, false);
  assert.equal(out.counterAccountId, "acc-2");
});

test("buildDuplicatePrefill: no compartido — isShared false explícito, no se omite (es una decisión, no un vacío)", () => {
  const out = buildDuplicatePrefill({ ...ROW, is_shared: 0, paid_by: "me", share_pct_override: null }, 55);
  assert.equal(out.isShared, false);
  assert.equal(out.paidBy, "me");
  assert.equal(out.sharePct, 55);
});

test("buildDuplicatePrefill: share_pct_override manda sobre el % por defecto del periodo", () => {
  assert.equal(buildDuplicatePrefill({ ...ROW, share_pct_override: 30 }, 80).sharePct, 30);
  assert.equal(buildDuplicatePrefill({ ...ROW, share_pct_override: null }, 80).sharePct, 80);
});

test("buildDuplicatePrefill: un % roto (fuera de rango o no numérico) cae a 100, como normalizePct", () => {
  assert.equal(buildDuplicatePrefill({ ...ROW, share_pct_override: 500 }, 80).sharePct, 100);
  assert.equal(buildDuplicatePrefill({ ...ROW, share_pct_override: null }, "roto").sharePct, 100);
});

test("buildDuplicatePrefill: paid_by desconocido o ausente cae a \"me\"", () => {
  assert.equal(buildDuplicatePrefill({ ...ROW, paid_by: null }, 100).paidBy, "me");
  assert.equal(buildDuplicatePrefill({ ...ROW, paid_by: "otracosa" }, 100).paidBy, "me");
});

// Revisión global, hallazgo 5: sin contraparte configurada no se puede heredar «lo pagó ella».
import { prefillSharing } from "../../app/app/js/duplicate-prefill.js";

test("prefillSharing: sin contraparte, un duplicado pagado por la contraparte vuelve a «yo» y no compartido", () => {
  const prefill = { isShared: true, paidBy: "partner" };
  assert.deepEqual(prefillSharing(prefill, ""), { isShared: false, paidBy: "me" });
  assert.deepEqual(prefillSharing(prefill, "Marta"), { isShared: true, paidBy: "partner" });
  assert.deepEqual(prefillSharing(undefined, "Marta"), { isShared: false, paidBy: "me" }, "sin prefill, como antes");
  assert.deepEqual(prefillSharing(undefined, ""), { isShared: false, paidBy: "me" });
});
