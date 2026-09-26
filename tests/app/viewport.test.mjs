// createScrollTop(win) recibe la ventana como parámetro (mismo patrón que createBackStack(win) en
// back.js): en Node no hay window, así que se le pasa una falsa que registra lo que el módulo hace.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createScrollTop, focusInput, tabbarRealValue, trackTabbarHeight } from "../../app/app/js/viewport.js";

function fakeWin({ screen = null } = {}) {
  const calls = [];
  return {
    calls,
    scrollTo: (x, y) => calls.push(["scrollTo", x, y]),
    document: { getElementById: (id) => (id === "screen" ? screen : null) },
  };
}

test("createScrollTop: manda el documento y #screen al principio", () => {
  const screen = { scrollTop: 900 };
  const win = fakeWin({ screen });
  createScrollTop(win)();
  assert.deepEqual(win.calls, [["scrollTo", 0, 0]]);
  assert.equal(screen.scrollTop, 0);
});

test("createScrollTop: sin #screen en el documento, solo mueve el documento", () => {
  const win = fakeWin();
  createScrollTop(win)();
  assert.deepEqual(win.calls, [["scrollTo", 0, 0]]);
});

test("createScrollTop: aguanta un win sin scrollTo y sin document", () => {
  // El win falso de back.test.mjs SÍ da scrollTo (back.js lo usa para el reset de scroll), pero
  // nunca document: este literal deja fuera los dos para cubrir igual ambos `?.`.
  const win = { history: {}, addEventListener() {} };
  assert.doesNotThrow(() => createScrollTop(win)());
});

test("focusInput: enfoca con preventScroll y deja el cursor al final", () => {
  const calls = [];
  const el = {
    value: "12,50",
    focus: (o) => calls.push(["focus", o]),
    setSelectionRange: (a, b) => calls.push(["sel", a, b]),
  };
  assert.equal(focusInput(el), true);
  assert.deepEqual(calls, [["focus", { preventScroll: true }], ["sel", 5, 5]]);
});

test("focusInput: con null o con un nodo sin focus() devuelve false y no revienta", () => {
  assert.equal(focusInput(null), false);
  assert.equal(focusInput(undefined), false);
  assert.equal(focusInput({}), false);
});

test("focusInput: sin setSelectionRange (un input date o number) enfoca igual", () => {
  let veces = 0;
  assert.equal(focusInput({ value: "", focus: () => { veces += 1; } }), true);
  assert.equal(veces, 1);
});

// --tabbar-real (letra al 200 %): main#screen deja debajo el alto REAL de la barra de pestañas.
test("tabbarRealValue: px enteros hacia arriba; 0, negativo o no numérico → null", () => {
  assert.equal(tabbarRealValue(84), "84px");
  assert.equal(tabbarRealValue(138.4), "139px");
  assert.equal(tabbarRealValue(0), null, "barra oculta: no se escribe");
  assert.equal(tabbarRealValue(-3), null);
  assert.equal(tabbarRealValue(NaN), null);
  assert.equal(tabbarRealValue(undefined), null);
});

function fakeRoWin({ withRO = true } = {}) {
  const props = {};
  const win = { document: { documentElement: { style: { setProperty: (k, v) => { props[k] = v; } } } } };
  const obs = [];
  if (withRO) win.ResizeObserver = class { constructor(cb) { this.cb = cb; obs.push(this); } observe(el) { this.el = el; } };
  return { win, props, obs };
}

test("trackTabbarHeight: escribe --tabbar-real al empezar y en cada cambio de tamaño; ignora el 0", () => {
  const { win, props, obs } = fakeRoWin();
  let h = 84;
  const nav = { getBoundingClientRect: () => ({ height: h }) };
  assert.equal(trackTabbarHeight(win, nav), true);
  assert.equal(props["--tabbar-real"], "84px");
  assert.equal(obs[0].el, nav);
  h = 139; obs[0].cb();
  assert.equal(props["--tabbar-real"], "139px");
  h = 0; obs[0].cb();
  assert.equal(props["--tabbar-real"], "139px", "oculta: conserva el último alto");
});

test("trackTabbarHeight: sin ResizeObserver, sin nav o sin window no hace nada (cae al fallback CSS)", () => {
  const { win, props } = fakeRoWin({ withRO: false });
  assert.equal(trackTabbarHeight(win, { getBoundingClientRect: () => ({ height: 84 }) }), false);
  assert.deepEqual(props, {});
  assert.equal(trackTabbarHeight(fakeRoWin().win, null), false);
  assert.equal(trackTabbarHeight(undefined, {}), false);
});
