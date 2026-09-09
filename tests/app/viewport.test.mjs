// createScrollTop(win) recibe la ventana como parámetro (mismo patrón que createBackStack(win) en
// back.js): en Node no hay window, así que se le pasa una falsa que registra lo que el módulo hace.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createScrollTop, focusInput } from "../../app/app/js/viewport.js";

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
  // Es EXACTAMENTE el win falso de back.test.mjs: back.js construye el reset en su fábrica y los
  // 21 tests que ya existen no le dan ni scrollTo ni document.
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
