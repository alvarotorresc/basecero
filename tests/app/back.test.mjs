import { test } from "node:test";
import assert from "node:assert/strict";
import { createBackStack } from "../../app/app/js/back.js";

// `win` falso: history que registra las llamadas y addEventListener que guarda el listener para
// poder disparar el popstate a mano (en Node no hay window; el módulo deja su instancia global a
// null y solo se prueba la fábrica).
// `state` y `length` simulan lo que el navegador conserva tras una recarga: el state de la entrada
// actual (con su {bc:n}) y cuántas entradas hay en la sesión. Por defecto, pestaña recién abierta:
// sin state y con una sola entrada.
// `document.body.classList` falso (mismo motivo que en toast.test.mjs/modal.test.mjs): un Set de
// nombres de clase con add/remove/contains/toggle, para poder comprobar la clase `subscreen` que
// pone createBackStack sin un DOM de verdad.
function fakeWin({ state = null, length = 1 } = {}) {
  const calls = [];
  const listeners = {};
  const classes = new Set();
  return {
    calls,
    listeners,
    history: {
      state,
      length,
      pushState: (s, title) => calls.push(["pushState", s, title]),
      replaceState: (s, title) => calls.push(["replaceState", s, title]),
      back: () => calls.push(["back"]),
      go: (n) => calls.push(["go", n]),
    },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    scrollTo: (x, y) => calls.push(["scrollTo", x, y]),
    document: {
      body: {
        classList: {
          add: (c) => classes.add(c),
          remove: (c) => classes.delete(c),
          contains: (c) => classes.has(c),
          toggle: (c, force) => {
            const on = force === undefined ? !classes.has(c) : !!force;
            if (on) classes.add(c); else classes.delete(c);
            return on;
          },
        },
      },
    },
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
  // at(-2), no at(-1): push() ahora manda un scrollTo justo después del pushState (ver los tests
  // de scroll más abajo).
  assert.deepEqual(win.calls.at(-2), ["pushState", { bc: 1 }, ""]);
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
  // at(-2): idem, push() manda un scrollTo justo después del pushState.
  assert.deepEqual(win.calls.at(-2), ["pushState", { bc: 2 }, ""]);
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

test("popstate con bc negativo o NaN: no lanza, no ejecuta callback, la pila no cambia", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  // pila vacía: un state ajeno malformado no debe reventar
  assert.doesNotThrow(() => win.listeners.popstate({ state: { bc: -1 } }));
  assert.doesNotThrow(() => win.listeners.popstate({ state: { bc: NaN } }));
  assert.equal(back.depth(), 0);

  // pila con una entrada: tampoco debe deshacerla
  let veces = 0;
  back.push(() => { veces += 1; });
  assert.doesNotThrow(() => win.listeners.popstate({ state: { bc: -1 } }));
  assert.doesNotThrow(() => win.listeners.popstate({ state: { bc: NaN } }));
  assert.equal(veces, 0);
  assert.equal(back.depth(), 1);
});

test("push: si pushState lanza (límite de Safari), el error se propaga y la pila no registra la entrada", () => {
  const win = fakeWin();
  win.history.pushState = () => { throw new Error("rate"); };
  const back = createBackStack(win);
  assert.throws(() => back.push(() => {}), /rate/);
  assert.equal(back.depth(), 0);
});

// ------------------------------------------- recarga con una subpantalla abierta (backlog, D1)

test("createBackStack tras recargar con dos subpantallas abiertas: rebobina el historial hasta la base", () => {
  // El navegador conserva las entradas y el state de la actual; la pila, en cambio, nace vacía.
  const win = fakeWin({ state: { bc: 2 }, length: 5 });
  const back = createBackStack(win);
  assert.deepEqual(win.calls, [["replaceState", { bc: 0 }, ""], ["go", -2]],
    "primero se marca la entrada actual como base, después se salta a la de verdad");
  assert.equal(back.depth(), 0);
  // El popstate que provoca ese go llega con el state de la entrada destino: la pila ya está
  // vacía, así que tiene que ser inocuo (no repintar nada).
  win.listeners.popstate({ state: { bc: 0 } });
  assert.equal(back.depth(), 0);
});

test("createBackStack: no rebobina con un bc que no describe una pila propia", () => {
  for (const [state, length, motivo] of [
    [null, 3, "pestaña nueva, sin state"],
    [{ bc: 0 }, 3, "ya estaba en la entrada base"],
    [{ bc: -1 }, 3, "state ajeno o corrupto"],
    [{ bc: 1.5 }, 3, "no es un entero"],
    [{ bc: NaN }, 3, "NaN"],
    [{ bc: "2" }, 3, "no es un número"],
    [{ bc: 3 }, 3, "no caben 3 entradas por debajo en un historial de 3"],
    [{ bc: 9 }, 2, "más profundidad que historial: saltaría fuera de la app"],
  ]) {
    const win = fakeWin({ state, length });
    createBackStack(win);
    assert.deepEqual(win.calls.filter((c) => c[0] === "go"), [], motivo);
  }
});

// ------------------------------------------- cambio de pestaña principal (backlog, D2)

test("resetTo desde Inicio (pila vacía): apunta la única entrada de la pestaña", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  const vistas = [];
  back.resetTo(() => vistas.push("inicio"));
  assert.deepEqual(win.calls.at(-1), ["pushState", { bc: 1 }, ""]);
  assert.equal(back.depth(), 1);
  // Atrás desde la pestaña: vuelve a Inicio en vez de cerrar la app.
  win.listeners.popstate({ state: { bc: 0 } });
  assert.deepEqual(vistas, ["inicio"]);
  assert.equal(back.depth(), 0);
});

test("resetTo con la pestaña ya a profundidad 1: NO toca el historial y cambia el callback", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  const vistas = [];
  back.resetTo(() => vistas.push("primera"));
  const antes = win.calls.length;
  back.resetTo(() => vistas.push("segunda"));
  assert.equal(win.calls.length, antes, "la entrada ya existe: ni pushState ni go");
  assert.equal(back.depth(), 1);
  win.listeners.popstate({ state: { bc: 0 } });
  assert.deepEqual(vistas, ["segunda"], "manda el callback de la pestaña actual, no el de la anterior");
});

test("resetTo con subpantallas abiertas: descarta las de arriba en UN salto, sin ejecutar sus callbacks", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  const vistas = [];
  back.resetTo(() => vistas.push("movimientos"));
  back.push(() => vistas.push("detalle"));
  back.push(() => vistas.push("subdetalle"));
  assert.equal(back.depth(), 3);

  back.resetTo(() => vistas.push("patrimonio"));
  assert.deepEqual(win.calls.at(-1), ["go", -2], "un solo salto de historial, nunca go + pushState");
  assert.equal(back.depth(), 1);
  assert.deepEqual(vistas, [], "cambiar de pestaña no repinta las subpantallas que cierra");

  // El popstate del salto llega a la entrada 1, que sigue viva: no debe deshacer la pestaña.
  win.listeners.popstate({ state: { bc: 1 } });
  assert.equal(back.depth(), 1);
  assert.deepEqual(vistas, []);
  // Y el siguiente atrás sí vuelve a Inicio, con el callback de la pestaña NUEVA.
  win.listeners.popstate({ state: { bc: 0 } });
  assert.deepEqual(vistas, ["patrimonio"]);
  assert.equal(back.depth(), 0);
});

// ------------------------------------------- scroll al cambiar de pantalla (fix/ux-scroll-borrar)

test("push: además de apuntar la entrada, devuelve la pantalla al principio", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  back.push(() => {});
  assert.deepEqual(win.calls.at(-1), ["scrollTo", 0, 0]);
  // Después del pushState, no antes: si el navegador rechazara la entrada (límite de Safari), no
  // se ha navegado y no habría que mover nada.
  assert.deepEqual(win.calls.at(-2), ["pushState", { bc: 1 }, ""]);
});

test("popstate: vuelve al principio ANTES de repintar la pantalla de debajo", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  back.push(() => win.calls.push(["onBack"]));
  win.listeners.popstate({ state: { bc: 0 } });
  const scroll = win.calls.findIndex((c) => c[0] === "scrollTo" && c === win.calls.at(-2));
  assert.deepEqual(win.calls.at(-2), ["scrollTo", 0, 0]);
  assert.deepEqual(win.calls.at(-1), ["onBack"], "el callback pinta con la vista ya arriba");
  assert.ok(scroll >= 0);
});

test("back() sin subpantallas: no toca ni el historial ni el scroll", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  const antes = win.calls.length;
  back.back();
  assert.equal(win.calls.length, antes, "no hay cambio de pantalla que resetear");
});

// ------------------------------------------- el modal no es un cambio de pantalla (fix/ux-scroll-borrar)

test("push(cb, {scroll:false}): no manda la pantalla al principio", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  back.push(() => {}, { scroll: false });
  assert.equal(win.calls.some((c) => c[0] === "scrollTo"), false);
});

test("popstate de una entrada con {scroll:false}: no resetea el scroll", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  const vistas = [];
  back.push(() => vistas.push("modal"), { scroll: false });
  win.listeners.popstate({ state: { bc: 0 } });
  assert.deepEqual(vistas, ["modal"]);
  assert.equal(win.calls.some((c) => c[0] === "scrollTo"), false);
});

test("popstate que descarta una entrada {scroll:false} junto con una de pantalla debajo: sí resetea", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  const vistas = [];
  back.push(() => vistas.push("pantalla"));                    // scroll por defecto: true
  back.push(() => vistas.push("modal"), { scroll: false });
  win.listeners.popstate({ state: { bc: 0 } });
  // Solo corre el callback de la más baja descartada (back.js:34): la de pantalla, no la del modal.
  assert.deepEqual(vistas, ["pantalla"]);
  assert.ok(win.calls.some((c) => c[0] === "scrollTo"));
});

// ------------------------------------------- clase `subscreen` en <body> (fix/chrome-subpantallas)
//
// SISTEMA.md §4.14: solo las cuatro pestañas raíz llevan tab bar y FAB. resetTo() (cambio de
// pestaña, main.js#nav) deja UNA entrada en la pila que no es una subpantalla — es la raíz de la
// pestaña — así que no debe encender la clase; cualquier entrada de push() sí.

test("push: pone la clase subscreen en <body>", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  back.push(() => {});
  assert.equal(win.document.body.classList.contains("subscreen"), true);
});

test("popstate: quita la clase subscreen al vaciar la pila", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  back.push(() => {});
  win.listeners.popstate({ state: { bc: 0 } });
  assert.equal(win.document.body.classList.contains("subscreen"), false);
});

test("resetTo desde Inicio: NO pone subscreen — es la raíz de la pestaña, no una subpantalla", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  back.resetTo(() => {});
  assert.equal(back.depth(), 1);
  assert.equal(win.document.body.classList.contains("subscreen"), false);
});

test("resetTo con la pestaña ya a profundidad 1: sigue sin subscreen tras cambiar el callback", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  back.resetTo(() => {});
  back.resetTo(() => {});
  assert.equal(win.document.body.classList.contains("subscreen"), false);
});

test("resetTo con subpantallas abiertas encima: subscreen se mantiene hasta llegar a la raíz de la pestaña", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  back.resetTo(() => {});                        // pestaña Movimientos: solo la raíz
  assert.equal(win.document.body.classList.contains("subscreen"), false);
  back.push(() => {});                            // abre una subpantalla encima
  assert.equal(win.document.body.classList.contains("subscreen"), true);
  win.listeners.popstate({ state: { bc: 1 } });    // cierra la subpantalla, queda solo la raíz
  assert.equal(win.document.body.classList.contains("subscreen"), false);
});

test("clear(): quita la clase subscreen de <body>", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  back.push(() => {});
  back.clear();
  assert.equal(win.document.body.classList.contains("subscreen"), false);
});

test("subscreen no toca una clase onboarding ya puesta en <body>", () => {
  const win = fakeWin();
  win.document.body.classList.add("onboarding");
  const back = createBackStack(win);
  back.push(() => {});
  assert.equal(win.document.body.classList.contains("subscreen"), true);
  assert.equal(win.document.body.classList.contains("onboarding"), true);
});
