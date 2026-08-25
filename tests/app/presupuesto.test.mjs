import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetStatus } from "../../app/js/screens/presupuesto.js";

test("budgetStatus: 82% del límite -> ok", () => {
  const s = budgetStatus(82, 100);
  assert.equal(s.level, "ok");
  assert.equal(s.pct, 82);
});

test("budgetStatus: 85% del límite -> warn (umbral inclusivo)", () => {
  const s = budgetStatus(85, 100);
  assert.equal(s.level, "warn");
  assert.equal(s.pct, 85);
});

test("budgetStatus: 92% del límite -> warn", () => {
  const s = budgetStatus(92, 100);
  assert.equal(s.level, "warn");
  assert.equal(s.pct, 92);
});

test("budgetStatus: 100% del límite -> warn (no over todavía)", () => {
  const s = budgetStatus(100, 100);
  assert.equal(s.level, "warn");
  assert.equal(s.pct, 100);
});

test("budgetStatus: 100.1%+ del límite -> over", () => {
  const s = budgetStatus(1001, 1000);
  assert.equal(s.level, "over");
  assert.ok(Math.abs(s.pct - 100.1) < 1e-9);
});

test("budgetStatus: límite 0 -> sin estado (null)", () => {
  assert.equal(budgetStatus(500, 0), null);
});

test("budgetStatus: límite null -> sin estado (null)", () => {
  assert.equal(budgetStatus(500, null), null);
});
