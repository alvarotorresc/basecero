// ticketHtml es puro (string, escapa todo). createReceipt(doc, {holdMs}) recibe el document
// (y opcionalmente el hold) por parámetro —mismo patrón que createToaster(doc)/createModal(doc,…)—
// para probarlo en Node con un document falso y los timers simulados de node:test. El fake de
// nodo no parsea innerHTML de verdad (igual que el <dialog> falso de modal.test.mjs): querySelector
// fabrica un hijo perezoso por selector, y la fidelidad del propio HTML se prueba aparte, sobre el
// string que devuelve ticketHtml().
import { test } from "node:test";
import assert from "node:assert/strict";
import { ticketHtml, createReceipt, showReceipt } from "../../app/app/js/recibo.js";
import { fmtMoneyParts } from "../../app/app/js/format.js";

const DATA = {
  dateTime: "09/09/2026  19:07",
  lines: [{ label: "Comercio", value: "Bar La Plaza" }, { label: "Categoría", value: "Restauración" }],
  total: { main: "45", cents: "20", suffix: " €" },
  stampDate: "9 SEP 2026",
  labels: { brand: "BaseCero", stamp: "Guardado", total: "Total", undo: "Deshacer" },
};

// Mismos valores que recibo.js (no exportados: son detalle interno de la fábrica).
const ENTER_MS = 600;
const EXIT_MS = 260;

function fakeDoc({ reducedMotion = false } = {}) {
  const body = { children: [], appendChild(n) { this.children.push(n); } };
  function node() {
    const clases = new Set();
    const kids = {};
    const listeners = {};
    const self = {
      id: "", innerHTML: "", attrs: {}, onclick: null, onkeydown: null,
      classList: {
        add: (c) => clases.add(c),
        remove: (c) => clases.delete(c),
        contains: (c) => clases.has(c),
      },
      setAttribute(k, v) { self.attrs[k] = v; },
      querySelector(sel) { return (kids[sel] ??= node()); },
      remove() { body.children = body.children.filter((c) => c !== self); },
      // focusin/focusout no son propiedades on* estándar en todos los navegadores (Firefox no las
      // expone), así que recibo.js los engancha con addEventListener — el fake los simula con este
      // registro mínimo en vez de un onfocusin/onfocusout que no reproduciría el bug real.
      addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
      fire(type, ev) { for (const fn of listeners[type] ?? []) fn(ev); },
    };
    return self;
  }
  return {
    body,
    createElement: () => node(),
    defaultView: { matchMedia: () => ({ matches: reducedMotion }) },
  };
}

test("ticketHtml: imprime la cabecera, las líneas con valor y el sello", () => {
  const html = ticketHtml(DATA);
  assert.ok(html.includes("BaseCero"));
  assert.ok(html.includes("09/09/2026"));
  assert.ok(html.includes("Bar La Plaza"));
  assert.ok(html.includes("Restauración"));
  assert.ok(html.includes("45"));
  assert.ok(html.includes("Guardado"));
  assert.ok(html.includes("9 SEP 2026"));
  assert.ok(html.includes("recibo-stamp"), "el sello lleva su clase para animarse aparte");
});

test("ticketHtml: el total, construido con fmtMoneyParts real, imprime el símbolo de moneda", () => {
  const html = ticketHtml({ ...DATA, total: fmtMoneyParts(4520) });
  assert.ok(html.includes("€"), "fmtMoneyParts devuelve {main,cents,suffix}: el símbolo vive en suffix, no en cur");
  assert.ok(!html.includes("undefined"));
});

test("ticketHtml: una línea sin valor NO se imprime", () => {
  const html = ticketHtml({ ...DATA, lines: [...DATA.lines, { label: "Etiqueta", value: "" }] });
  assert.ok(!html.includes("Etiqueta"));
});

test("ticketHtml: escapa comercio y nota UNA sola vez", () => {
  const html = ticketHtml({
    ...DATA,
    lines: [{ label: "Comercio", value: "<script>x</script> Tom & Jerry" }],
  });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("Tom &amp; Jerry"));
  assert.ok(!html.includes("&amp;lt;"), "doble escape");
});

test("show: cuelga UN overlay de <body> con role=status y aria-live=polite", () => {
  const doc = fakeDoc();
  const receipt = createReceipt(doc, { holdMs: 900 });
  receipt.show(DATA);
  assert.equal(doc.body.children.length, 1);
  const el = doc.body.children[0];
  assert.equal(el.id, "recibo");
  assert.equal(el.attrs.role, "status");
  assert.equal(el.attrs["aria-live"], "polite");
});

test("show: se va solo a ENTER+hold+EXIT y desmonta el nodo", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const doc = fakeDoc();
  const receipt = createReceipt(doc, { holdMs: 900 });
  receipt.show(DATA);
  const el = doc.body.children[0];

  t.mock.timers.tick(ENTER_MS + 900 - 1);
  assert.equal(el.classList.contains("is-leaving"), false, "todavía en reposo");
  t.mock.timers.tick(1);
  assert.ok(el.classList.contains("is-leaving"), "empieza la salida");
  assert.equal(doc.body.children.length, 1, "sigue montado mientras dura la animación de salida");

  t.mock.timers.tick(EXIT_MS - 1);
  assert.equal(doc.body.children.length, 1);
  t.mock.timers.tick(1);
  assert.equal(doc.body.children.length, 0, "desmontado al final de la salida");
});

test("show: un toque en el velo lo corta y NO deshace", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const doc = fakeDoc();
  let hecho = 0;
  const receipt = createReceipt(doc, { holdMs: 900 });
  receipt.show({ ...DATA, onUndo: () => { hecho += 1; } });
  const el = doc.body.children[0];

  el.onclick();
  assert.ok(el.classList.contains("is-leaving"));
  t.mock.timers.tick(EXIT_MS);
  assert.equal(doc.body.children.length, 0);
  assert.equal(hecho, 0);
});

test("Deshacer: llama a onUndo UNA vez y cierra", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const doc = fakeDoc();
  let hecho = 0;
  const receipt = createReceipt(doc, { holdMs: 900 });
  receipt.show({ ...DATA, onUndo: () => { hecho += 1; } });
  const el = doc.body.children[0];

  el.querySelector(".recibo-undo").onclick();
  assert.equal(hecho, 1);
  assert.ok(el.classList.contains("is-leaving"));
  t.mock.timers.tick(EXIT_MS);
  assert.equal(doc.body.children.length, 0);
});

test("Deshacer: no se vuelve a llamar si el temporizador vence después", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const doc = fakeDoc();
  let hecho = 0;
  const receipt = createReceipt(doc, { holdMs: 900 });
  receipt.show({ ...DATA, onUndo: () => { hecho += 1; } });

  doc.body.children[0].querySelector(".recibo-undo").onclick();
  assert.equal(hecho, 1);
  // El temporizador ENTER+hold, si no se hubiera cancelado, dispararía por aquí: avanzar de sobra
  // confirma que Deshacer lo canceló de verdad y no hay una segunda llamada a onUndo.
  t.mock.timers.tick(ENTER_MS + 900 + EXIT_MS + 1000);
  assert.equal(hecho, 1, "onUndo no se llama una segunda vez");
});

test("dos show() seguidos: solo queda un ticket en el body", () => {
  const doc = fakeDoc();
  const receipt = createReceipt(doc, { holdMs: 900 });
  receipt.show(DATA);
  const first = doc.body.children[0];
  receipt.show({ ...DATA, total: { main: "12", cents: "00", suffix: " €" } });
  assert.equal(doc.body.children.length, 1, "el primero se quita sin animación");
  assert.notEqual(doc.body.children[0], first);
  assert.equal(doc.body.children[0].classList.contains("is-leaving"), false);
});

test("focusin: el foco dentro del recibo congela el auto-cierre", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const doc = fakeDoc();
  const receipt = createReceipt(doc, { holdMs: 900 });
  receipt.show(DATA);
  const el = doc.body.children[0];

  el.fire("focusin");
  t.mock.timers.tick(ENTER_MS + 900 + 10000);
  assert.equal(el.classList.contains("is-leaving"), false, "un usuario de teclado dentro del recibo no debe verlo cerrarse solo");
});

test("Escape: cierra el recibo sin deshacer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const doc = fakeDoc();
  let hecho = 0;
  const receipt = createReceipt(doc, { holdMs: 900 });
  receipt.show({ ...DATA, onUndo: () => { hecho += 1; } });
  const el = doc.body.children[0];

  el.onkeydown({ key: "Escape" });
  assert.ok(el.classList.contains("is-leaving"));
  assert.equal(hecho, 0, "Escape no llama a onUndo");
  t.mock.timers.tick(EXIT_MS);
  assert.equal(doc.body.children.length, 0);
});

test("prefers-reduced-motion: el reposo baja a 600 ms", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const doc = fakeDoc({ reducedMotion: true });
  const receipt = createReceipt(doc);   // sin holdMs: sale de matchMedia
  receipt.show(DATA);
  const el = doc.body.children[0];

  t.mock.timers.tick(ENTER_MS + 600 - 1);
  assert.equal(el.classList.contains("is-leaving"), false);
  t.mock.timers.tick(1);
  assert.ok(el.classList.contains("is-leaving"));
});

test("sin document (Node): el módulo se importa y showReceipt no hace nada", () => {
  assert.doesNotThrow(() => showReceipt(DATA));
});
