// sheetHtml es pura (devuelve un string) y createSheet(doc, {pushBack, goBack, win, wait}) recibe
// sus dependencias por parámetro para probarla en Node — mismo patrón y mismo fake de <dialog> que
// modal.test.mjs (showModal() exige estar en el documento, close() sobre un diálogo ya cerrado es
// un no-op, "cancel" es un evento aparte de close()).
import { test } from "node:test";
import assert from "node:assert/strict";
import { sheetHtml, createSheet } from "../../app/app/js/sheet.js";

function fakeDoc() {
  const body = { children: [], appendChild(n) { this.children.push(n); n.inBody = true; } };
  const doc = { body, activeElement: null, log: [], createElement: (tag) => node(tag) };
  function node(tag) {
    const listeners = {};
    const kids = {};
    const classes = new Set();
    const self = {
      tag, className: "", innerHTML: "", attrs: {}, open: false, inBody: false,
      focusCount: 0,
      classList: {
        add(c) { classes.add(c); },
        remove(c) { classes.delete(c); },
        contains(c) { return classes.has(c); },
      },
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(type, fn) { listeners[type] = fn; },
      showModal() {
        if (!this.inBody) throw new Error("InvalidStateError");
        this.open = true; doc.log.push("showModal");
      },
      close() { if (!this.open) return; this.open = false; doc.log.push("close"); listeners.close?.(); },
      remove() { body.children = body.children.filter((c) => c !== this); this.inBody = false; },
      focus() { this.focusCount += 1; doc.activeElement = this; },
      querySelector(sel) { return (kids[sel] ??= node("button")); },
      fireCancel() { listeners.cancel?.({ preventDefault() { this.defaultPrevented = true; } }); },
      fireClickOn(target) { listeners.click?.({ target }); },
    };
    return self;
  }
  return doc;
}

function fakeWin() {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] ?? []).filter((l) => l !== fn);
    },
  };
}

const SYNC_WAIT = (ms, fn) => fn();

function harness({ wait = SYNC_WAIT, win = fakeWin() } = {}) {
  const doc = fakeDoc();
  const backs = [];
  const backOpts = [];
  const calls = [];
  const sheet = createSheet(doc, {
    pushBack: (cb, opts) => { backs.push(cb); backOpts.push(opts); calls.push("pushBack"); },
    goBack: () => calls.push("goBack"),
    win,
    wait,
  });
  return { doc, backs, backOpts, calls, sheet, win };
}

const OPTS = { title: "Filtros", action: "", body: "<p>cuerpo</p>" };

test("sheetHtml: h2 con el id al que apunta aria-labelledby del dialog", () => {
  const html = sheetHtml(OPTS);
  assert.ok(html.includes('id="sheet-title"'));
});

test("sheetHtml: escapa el título", () => {
  const html = sheetHtml({ ...OPTS, title: "<b>Filtros</b> & más" });
  assert.ok(!html.includes("<b>Filtros</b>"));
  assert.ok(html.includes("&lt;b&gt;Filtros&lt;/b&gt; &amp; más"));
});

test("sheetHtml: sin action no deja hueco a la derecha; con action, la inserta tal cual", () => {
  const sinAccion = sheetHtml(OPTS);
  assert.ok(sinAccion.includes("sheet-header"));
  const accion = '<button id="flt-clear">Quitar filtros</button>';
  const conAccion = sheetHtml({ ...OPTS, action: accion });
  assert.ok(conAccion.includes(accion));
});

test("sheetHtml: el asa lleva aria-hidden (es decorativa)", () => {
  const html = sheetHtml(OPTS);
  assert.match(html, /<span class="sheet-handle" aria-hidden="true">/);
});

test("sheetHtml: el cuerpo se inserta tal cual, UNA sola vez", () => {
  const body = '<div class="mi-form">…</div>';
  const html = sheetHtml({ ...OPTS, body });
  const primera = html.indexOf(body);
  assert.ok(primera >= 0);
  assert.equal(html.indexOf(body, primera + 1), -1);
});

test("open: cuelga el dialog del body ANTES de showModal, con role, aria-modal y aria-labelledby", () => {
  const { doc, sheet } = harness();
  const dlg = sheet.open(OPTS);
  assert.equal(doc.body.children.length, 1);
  assert.equal(dlg.tag, "dialog");
  assert.equal(dlg.className, "sheet");
  assert.equal(dlg.attrs.role, "dialog");
  assert.equal(dlg.attrs["aria-modal"], "true");
  assert.equal(dlg.attrs["aria-labelledby"], "sheet-title");
  assert.equal(dlg.open, true, "showModal sobre un nodo suelto lanza InvalidStateError");
});

test("open: apunta una entrada en la pila de atras con {scroll:false, chrome:false}", () => {
  const { backs, backOpts, calls, sheet } = harness();
  sheet.open(OPTS);
  assert.equal(backs.length, 1);
  assert.deepEqual(calls, ["pushBack"]);
  assert.deepEqual(backOpts, [{ scroll: false, chrome: false }]);
});

test("dos open() seguidos: solo se abre uno", () => {
  const { doc, calls, sheet } = harness();
  sheet.open(OPTS);
  assert.equal(sheet.open(OPTS), null);
  assert.equal(doc.body.children.length, 1);
  assert.deepEqual(calls, ["pushBack"]);
});

test("cerrar: pasa por requestClose — añade is-leaving antes de cerrar de verdad", () => {
  const pendientes = [];
  const { doc, sheet } = harness({ wait: (ms, fn) => pendientes.push(fn) });
  const dlg = sheet.open(OPTS);
  dlg.fireClickOn(dlg);             // clic en el velo
  assert.ok(dlg.classList.contains("is-leaving"));
  assert.equal(dlg.open, true, "el cierre real espera a que termine la animación");
  assert.equal(doc.body.children.length, 1);
  pendientes[0]();
  assert.equal(dlg.open, false);
  assert.equal(doc.body.children.length, 0);
});

test("clic en el velo (target===dlg): cierra, deshace la entrada y devuelve el foco al que abrió", () => {
  const { doc, calls, sheet } = harness();
  const abridor = { focusCount: 0, focus() { this.focusCount += 1; } };
  doc.activeElement = abridor;
  const dlg = sheet.open(OPTS);
  dlg.fireClickOn(dlg);
  assert.equal(dlg.open, false);
  assert.equal(doc.body.children.length, 0);
  assert.deepEqual(calls, ["pushBack", "goBack"]);
  assert.equal(abridor.focusCount, 1);
});

test("clic dentro del contenido (target !== dlg): NO cierra", () => {
  const { sheet } = harness();
  const dlg = sheet.open(OPTS);
  dlg.fireClickOn(dlg.querySelector(".sheet-body"));
  assert.equal(dlg.open, true);
});

test("Escape (cancel): se intercepta con preventDefault y pasa por requestClose", () => {
  const { doc, calls, sheet } = harness();
  const dlg = sheet.open(OPTS);
  dlg.fireCancel();
  assert.equal(dlg.open, false);
  assert.equal(doc.body.children.length, 0);
  assert.deepEqual(calls, ["pushBack", "goBack"]);
});

test("Escape (cancel): con la animación en curso, el <dialog> sigue abierto", () => {
  const pendientes = [];
  const { sheet } = harness({ wait: (ms, fn) => pendientes.push(fn) });
  const dlg = sheet.open(OPTS);
  dlg.fireCancel();
  assert.ok(dlg.classList.contains("is-leaving"));
  assert.equal(dlg.open, true);
});

test("requestClose es idempotente: velo + Escape no reprograman el cierre", () => {
  const pendientes = [];
  const { sheet } = harness({ wait: (ms, fn) => pendientes.push(fn) });
  const dlg = sheet.open(OPTS);
  dlg.fireClickOn(dlg);
  dlg.fireCancel();
  assert.equal(pendientes.length, 1);
});

test("gesto atras del sistema: cierra la hoja sin deshacer una segunda entrada", () => {
  const { doc, backs, calls, sheet } = harness();
  sheet.open(OPTS);
  backs[0]();                       // lo que ejecuta el popstate de back.js
  assert.equal(doc.body.children.length, 0);
  assert.deepEqual(calls, ["pushBack"], "el historial ya estaba donde toca");
});

test("salto de varias entradas: cierra la hoja aunque el popstate no ejecute su propio callback", () => {
  const { doc, calls, sheet, win } = harness();
  const dlg = sheet.open(OPTS);
  for (const fn of [...win.listeners.popstate]) fn({ state: { bc: 0 } });
  assert.equal(dlg.open, false);
  assert.equal(doc.body.children.length, 0);
  assert.deepEqual(calls, ["pushBack"]);
});

test("cerrar quita su listener de popstate de seguridad", () => {
  const { sheet, win } = harness();
  const dlg = sheet.open(OPTS);
  assert.equal(win.listeners.popstate.length, 1);
  dlg.fireClickOn(dlg);
  assert.equal(win.listeners.popstate.length, 0);
});

test("sin `win` (dependencia opcional): abre y cierra igual, sin red de seguridad de popstate", () => {
  const doc = fakeDoc();
  const calls = [];
  const sheet = createSheet(doc, {
    pushBack: (cb) => calls.push("pushBack"),
    goBack: () => calls.push("goBack"),
    win: undefined,
    wait: SYNC_WAIT,
  });
  const dlg = sheet.open(OPTS);
  assert.equal(dlg.open, true);
  dlg.fireClickOn(dlg);
  assert.equal(dlg.open, false);
  assert.deepEqual(calls, ["pushBack", "goBack"]);
});

test("si pushBack lanzó (pushState rechazado), cerrar no deshace la pantalla de detrás", () => {
  const doc = fakeDoc();
  const calls = [];
  const sheet = createSheet(doc, {
    pushBack: () => { throw new Error("límite de Safari"); },
    goBack: () => calls.push("goBack"),
    win: fakeWin(),
    wait: SYNC_WAIT,
  });
  const dlg = sheet.open(OPTS);
  dlg.fireClickOn(dlg);
  assert.equal(dlg.open, false);
  assert.deepEqual(calls, []);
});

test("createSheet sin `wait`: usa setTimeout por defecto", () => {
  const doc = fakeDoc();
  const sheet = createSheet(doc, { pushBack: () => {}, goBack: () => {}, win: fakeWin() });
  const dlg = sheet.open(OPTS);
  dlg.fireClickOn(dlg);
  assert.ok(dlg.classList.contains("is-leaving"));
  assert.equal(dlg.open, true, "con setTimeout real, el cierre no es síncrono");
});
