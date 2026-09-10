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

// Etiquetas (N11, D12): entrar en una etiqueta cambia a Movimientos CON su filtro puesto —
// goToTab tiene que poder llevar el mismo `opts` que nav(tab, opts) (main.js), sin que
// screens/etiquetas.js tenga que importar main.js (el ciclo que este módulo existe para evitar).
test("goToTab pasa un segundo argumento (opts) al navegador registrado", () => {
  let calledTab = null, calledOpts = null;
  setTabNavigator((tab, opts) => { calledTab = tab; calledOpts = opts; });
  goToTab("movimientos", { tagId: "tag-japon" });
  assert.equal(calledTab, "movimientos");
  assert.deepEqual(calledOpts, { tagId: "tag-japon" });
});
