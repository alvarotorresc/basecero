// Integración hoja+aviso apilados sobre la pila de atrás REAL (back.js, sin mock): reproduce el
// bug de revisión (ronda 1) — un aviso abierto ENCIMA de una hoja que se cancela llamaba a
// goBack(), que dispara un popstate real; la red de seguridad de la hoja de abajo no miraba la
// profundidad y se cerraba también, sin pasar por SU propio goBack() (entrada colgada en back.js).
//
// A diferencia de modal.test.mjs/sheet.test.mjs (que sustituyen pushBack/goBack por espías), aquí
// se usa createBackStack(win) de verdad: es la única forma de comprobar que "la pila cuadra"
// después de cancelar el aviso, y no solo que el <dialog> de la hoja siga abierto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBackStack } from "../../app/app/js/back.js";
import { createModal } from "../../app/app/js/modal.js";
import { createSheet } from "../../app/app/js/sheet.js";

// `win` falso con un historial de verdad (pila de entradas + puntero), porque back.js necesita que
// pushState/back/go se comporten de forma consistente entre sí, no solo que registren la llamada
// (a diferencia del win de back.test.mjs, que no lo necesita porque cada test dispara el popstate
// a mano con el bc que quiere). `back()`/`go()` disparan el popstate EN EL ACTO (síncrono): en un
// navegador real es asíncrono, pero aquí no cambia lo que se está probando (el orden relativo de
// los propios cierres) y así el test no necesita microtareas.
function fakeWin() {
  const entries = [{ bc: 0 }];
  let idx = 0;
  const listeners = {};
  const win = {
    history: {
      get state() { return entries[idx]; },
      get length() { return entries.length; },
      pushState(state) { entries.length = idx + 1; entries.push(state); idx = entries.length - 1; },
      replaceState(state) { entries[idx] = state; },
      back() { win.history.go(-1); },
      go(n) {
        idx = Math.max(0, Math.min(entries.length - 1, idx + n));
        const e = { state: entries[idx] };
        for (const fn of [...(listeners.popstate ?? [])]) fn(e);
      },
    },
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] ?? []).filter((l) => l !== fn); },
    document: {
      body: {
        classList: {
          add() {}, remove() {}, contains() { return false; }, toggle() {},
        },
      },
    },
    scrollTo() {},
  };
  return win;
}

// Mismo fake de <dialog> que modal.test.mjs/sheet.test.mjs (showModal() exige estar en el
// documento, close() sobre uno ya cerrado es un no-op).
function fakeDoc() {
  const body = { children: [], appendChild(n) { this.children.push(n); n.inBody = true; } };
  const doc = { body, activeElement: null, createElement: (tag) => node(tag) };
  function node(tag) {
    const listeners = {};
    const kids = {};
    const classes = new Set();
    const self = {
      tag, className: "", innerHTML: "", attrs: {}, open: false, inBody: false,
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(type, fn) { listeners[type] = fn; },
      showModal() { if (!this.inBody) throw new Error("InvalidStateError"); this.open = true; },
      close() { if (!this.open) return; this.open = false; listeners.close?.(); },
      remove() { body.children = body.children.filter((c) => c !== this); this.inBody = false; },
      focus() {},
      querySelector(sel) { return (kids[sel] ??= node("button")); },
      fireClickOn(target) { listeners.click?.({ target }); },
    };
    return self;
  }
  return doc;
}

const SYNC_WAIT = (ms, fn) => fn();

test("hoja + aviso apilados: cancelar el aviso NO cierra la hoja de abajo y la pila cuadra", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  const doc = fakeDoc();
  const sheet = createSheet(doc, { pushBack: back.push, goBack: back.back, win, wait: SYNC_WAIT });
  const modal = createModal(doc, { pushBack: back.push, goBack: back.back, win, wait: SYNC_WAIT });

  const dlgSheet = sheet.open({ title: "Filtros", body: "<p>x</p>" });
  assert.equal(back.depth(), 1, "la hoja apunta su entrada");

  const dlgModal = modal.confirm({ title: "¿Seguro?", message: "", cancelText: "Cancelar", confirmText: "Sí" });
  assert.equal(back.depth(), 2, "el aviso apunta la suya encima");

  // Cancelar el aviso: su propio embudo de salida llama a goBack() (back.back() → history.back()),
  // que en este fake dispara el popstate EN EL ACTO — el mismo que reciben TODOS los listeners
  // vivos en `win`, incluida la red de seguridad de la hoja.
  dlgModal.querySelector("#modal-cancel").onclick();

  assert.equal(dlgModal.open, false, "el aviso se cierra");
  assert.equal(dlgSheet.open, true, "la hoja de abajo NO se cierra (bug de revisión, ronda 1)");
  assert.equal(back.depth(), 1, "la pila cuadra: solo queda la entrada de la hoja");

  // Atrás otra vez (gesto real del sistema, no goBack() de la propia hoja): ahora sí debe cerrarla,
  // pasando por SU propio embudo de salida (no una entrada colgada).
  win.history.back();
  assert.equal(dlgSheet.open, false, "la hoja se cierra con el segundo atrás");
  assert.equal(back.depth(), 0, "la pila queda vacía, sin entradas colgadas");
});

test("hoja + aviso apilados: confirmar el aviso tampoco cierra la hoja de abajo", () => {
  const win = fakeWin();
  const back = createBackStack(win);
  const doc = fakeDoc();
  const sheet = createSheet(doc, { pushBack: back.push, goBack: back.back, win, wait: SYNC_WAIT });
  const modal = createModal(doc, { pushBack: back.push, goBack: back.back, win, wait: SYNC_WAIT });

  const dlgSheet = sheet.open({ title: "Filtros", body: "<p>x</p>" });
  let hecho = 0;
  const dlgModal = modal.confirm({
    title: "¿Seguro?", message: "", cancelText: "Cancelar", confirmText: "Sí",
    onConfirm: () => { hecho += 1; },
  });

  dlgModal.querySelector("#modal-confirm").onclick();

  assert.equal(hecho, 1);
  assert.equal(dlgModal.open, false);
  assert.equal(dlgSheet.open, true, "la hoja sigue abierta tras confirmar el aviso");
  assert.equal(back.depth(), 1);
});
