import { test } from "node:test";
import assert from "node:assert/strict";
import { setTabNavigator, goToTab } from "../../app/app/js/tabs.js";

test("goToTab sin registrar: no-op, no lanza", () => {
  assert.doesNotThrow(() => goToTab("movimientos"));
});

test("setTabNavigator registra: goToTab llama al navegador con el tab", () => {
  let called = null;
  setTabNavigator((tab) => { called = tab; });
  goToTab("movimientos");
  assert.equal(called, "movimientos");
});

test("un segundo setTabNavigator sustituye al anterior", () => {
  let first = 0, second = 0;
  setTabNavigator(() => { first += 1; });
  setTabNavigator(() => { second += 1; });
  goToTab("inicio");
  assert.equal(first, 0);
  assert.equal(second, 1);
});
