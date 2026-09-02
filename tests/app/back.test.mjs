import { test } from "node:test";
import assert from "node:assert/strict";
import { createBackStack } from "../../app/app/js/back.js";

// `win` falso: history que registra las llamadas y addEventListener que guarda el listener para
// poder disparar el popstate a mano (en Node no hay window; el módulo deja su instancia global a
// null y solo se prueba la fábrica).
function fakeWin() {
  const calls = [];
  const listeners = {};
  return {
    calls,
    listeners,
    history: {
      pushState: (state, title) => calls.push(["pushState", state, title]),
      replaceState: (state, title) => calls.push(["replaceState", state, title]),
      back: () => calls.push(["back"]),
      go: (n) => calls.push(["go", n]),
    },
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
}

test("createBackStack: marca la entrada base con replaceState({bc:0})", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  assert.deepEqual(win.calls, [["replaceState", { bc: 0 }, ""]]);
  assert.equal(back.depth(), 0);
});

test("push: apunta una entrada de historial con su profundidad", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  back.push(() => {});
  assert.deepEqual(win.calls.at(-1), ["pushState", { bc: 1 }, ""]);
  assert.equal(back.depth(), 1);
});

test("popstate: ejecuta el callback de la entrada deshecha y la saca de la pila", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  let veces = 0;
  back.push(() => { veces += 1; });
  win.listeners.popstate({ state: { bc: 0 } });
  assert.equal(veces, 1);
  assert.equal(back.depth(), 0);
});

test("back(): sin subpantallas abiertas no toca el historial", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  back.back();
  assert.equal(win.calls.filter((c) => c[0] === "back").length, 0);
});

test("back(): con una subpantalla llama a history.back una vez y NO ejecuta el callback", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  let veces = 0;
  back.push(() => { veces += 1; });
  back.back();
  assert.equal(win.calls.filter((c) => c[0] === "back").length, 1);
  // El callback lo ejecuta el popstate que provoca history.back, no back() por sí misma.
  assert.equal(veces, 0);
  assert.equal(back.depth(), 1);
});

test("anidado: cada popstate deshace solo su propia subpantalla", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  const vistas = [];
  back.push(() => vistas.push("A"));
  back.push(() => vistas.push("B"));
  assert.deepEqual(win.calls.at(-1), ["pushState", { bc: 2 }, ""]);
  win.listeners.popstate({ state: { bc: 1 } });
  assert.deepEqual(vistas, ["B"]);
  assert.equal(back.depth(), 1);
  win.listeners.popstate({ state: { bc: 0 } });
  assert.deepEqual(vistas, ["B", "A"]);
  assert.equal(back.depth(), 0);
});

test("salto de varias entradas: solo se ejecuta el callback de la más baja descartada", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  const vistas = [];
  back.push(() => vistas.push("A"));
  back.push(() => vistas.push("B"));
  win.listeners.popstate({ state: { bc: 0 } });
  assert.deepEqual(vistas, ["A"]);
  assert.equal(back.depth(), 0);
});

test("clear(): descarta las entradas abiertas sin ejecutar callbacks", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  let veces = 0;
  back.push(() => { veces += 1; });
  back.push(() => { veces += 1; });
  back.clear();
  assert.deepEqual(win.calls.at(-1), ["go", -2]);
  assert.equal(back.depth(), 0);
  assert.equal(veces, 0);
  // El history.go(-2) real dispara su popstate después: la pila ya está vacía, así que ese
  // popstate tiene que ser inocuo (si no, cambiar de pestaña repintaría la pantalla anterior).
  win.listeners.popstate({ state: { bc: 0 } });
  assert.equal(veces, 0);
  assert.equal(back.depth(), 0);
});

test("clear(): sin subpantallas abiertas no toca el historial", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  back.clear();
  assert.equal(win.calls.filter((c) => c[0] === "go").length, 0);
});

test("popstate ajeno: sin entradas propias no lanza ni hace nada", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  win.listeners.popstate({ state: { bc: 0 } });
  win.listeners.popstate({ state: null });
  assert.equal(back.depth(), 0);
});

test("popstate a una profundidad por encima de la pila: no hace nada", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  let veces = 0;
  back.push(() => { veces += 1; });
  win.listeners.popstate({ state: { bc: 5 } });
  assert.equal(veces, 0);
  assert.equal(back.depth(), 1);
});
