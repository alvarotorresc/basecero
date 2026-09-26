// modalHtml es puro (devuelve un string, como skeletonHtml): el contrato de accesibilidad se
// verifica sobre el string. createModal(doc, {pushBack, goBack, win, wait}) recibe sus
// dependencias por parámetro —mismo patrón que createToaster(doc) en toast.js— para probarlo en
// Node con un document falso. El fake de <dialog> reproduce lo que importa del elemento nativo:
// showModal() exige estar en el documento, close() sobre un diálogo ya cerrado es un no-op que NO
// vuelve a emitir "close" (de eso depende que el gesto atrás tardío sea inocuo), y "cancel"
// (Escape) es un evento aparte que llega ANTES de close().
import { test } from "node:test";
import assert from "node:assert/strict";
import { modalHtml, createModal } from "../../app/app/js/modal.js";

function fakeDoc() {
  const body = { children: [], appendChild(n) { this.children.push(n); n.inBody = true; } };
  const doc = { body, activeElement: null, log: [], createElement: (tag) => node(tag) };
  function node(tag) {
    const listeners = {};
    const kids = {};
    const classes = new Set();
    const self = {
      tag, className: "", innerHTML: "", attrs: {}, open: false, inBody: false,
      focusCount: 0, focusOpts: null,
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
      focus(o) { this.focusCount += 1; this.focusOpts = o; doc.activeElement = this; },
      querySelector(sel) { return (kids[sel] ??= node("button")); },
      // Simuladores de eventos que no tienen un método nativo equivalente en este fake (a
      // diferencia de close(), que SÍ es un método real del <dialog>).
      fireCancel() { listeners.cancel?.({ preventDefault() { this.defaultPrevented = true; } }); },
      fireClickOn(target) { listeners.click?.({ target }); },
    };
    return self;
  }
  return doc;
}

// win falso que registra listeners de verdad (varios por tipo, con removeEventListener) — no el
// win de back.test.mjs, que solo guarda uno por tipo y no lo necesita.
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

// wait síncrono (ejecuta el callback en el acto): así las 250/180 ms de la animación de salida
// (components.css, DESIGN.md §10) no meten temporizadores reales en los tests — el comportamiento
// que importa es que TODO pase por requestClose(), no cuánto tarde el reloj.
const SYNC_WAIT = (ms, fn) => fn();

function harness({ wait = SYNC_WAIT } = {}) {
  const doc = fakeDoc();
  const backs = [];
  const backOpts = [];
  const calls = [];
  const win = fakeWin();
  const modal = createModal(doc, {
    pushBack: (cb, opts) => { backs.push(cb); backOpts.push(opts); calls.push("pushBack"); },
    goBack: () => calls.push("goBack"),
    win,
    wait,
  });
  return { doc, backs, backOpts, calls, modal, win };
}

const OPTS = { title: "Borrar", message: "Mercadona", cancelText: "Cancelar", confirmText: "Borrar" };

test("modalHtml: h2 y p con los ids a los que apuntan los aria- del dialog", () => {
  const html = modalHtml(OPTS);
  assert.ok(html.includes('id="modal-title"'));
  assert.ok(html.includes('id="modal-text"'));
});

test("modalHtml: Cancelar va ANTES que la accion destructiva en el DOM", () => {
  const html = modalHtml(OPTS);
  assert.ok(html.indexOf('id="modal-cancel"') < html.indexOf('id="modal-confirm"'),
    "el foco y la tabulacion empiezan en la salida segura");
});

test("modalHtml: escapa titulo, texto y etiquetas UNA sola vez", () => {
  const html = modalHtml({ ...OPTS, message: "<script>x</script> Tom & Jerry" });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("Tom &amp; Jerry"));
  assert.ok(!html.includes("&amp;lt;"), "doble escape");
});

test("modalHtml: sin mensaje no pinta el parrafo", () => {
  const html = modalHtml({ ...OPTS, message: "" });
  assert.ok(!html.includes('id="modal-text"'));
});

test("modalHtml: sin preview no pinta el pozo", () => {
  const html = modalHtml(OPTS);
  assert.ok(!html.includes("modal-preview"));
});

test("modalHtml: con preview lo inserta tal cual, UNA sola vez, dentro del pozo", () => {
  const preview = '<span class="mi-fila">Bar Pepe</span>';
  const html = modalHtml({ ...OPTS, preview });
  const primera = html.indexOf(preview);
  assert.ok(primera >= 0);
  assert.equal(html.indexOf(preview, primera + 1), -1, "no se duplica");
  assert.ok(/class="modal-preview">\s*<span class="mi-fila">/.test(html), "vive dentro de .modal-preview");
});

test("modalHtml: destructive por defecto (true) — btn-danger-confirm, D-1/C5", () => {
  const html = modalHtml(OPTS);
  assert.ok(html.includes("btn-danger-confirm"));
  assert.ok(!/id="modal-confirm"[^>]*class="btn-secondary"/.test(html));
});

test("modalHtml: destructive:false — el confirmar es un secundario normal", () => {
  const html = modalHtml({ ...OPTS, destructive: false });
  assert.ok(!html.includes("btn-danger-confirm"));
  const confirmBtn = html.slice(html.indexOf("modal-actions"));
  assert.ok(confirmBtn.includes('id="modal-confirm"'));
});

test("modalHtml: Cancelar siempre es un secundario, destructivo o no", () => {
  for (const destructive of [true, false]) {
    const html = modalHtml({ ...OPTS, destructive });
    assert.match(html, /class="btn-secondary" id="modal-cancel"/);
  }
});

test("confirm: cuelga el dialog del body ANTES de showModal, con role alertdialog, aria-modal y aria-labelledby", () => {
  const { doc, modal } = harness();
  const dlg = modal.confirm(OPTS);
  assert.equal(doc.body.children.length, 1);
  assert.equal(dlg.tag, "dialog");
  assert.equal(dlg.className, "modal");
  assert.equal(dlg.attrs.role, "alertdialog");
  assert.equal(dlg.attrs["aria-modal"], "true");
  assert.equal(dlg.attrs["aria-labelledby"], "modal-title");
  assert.equal(dlg.attrs["aria-describedby"], "modal-text");
  assert.equal(dlg.open, true, "showModal sobre un nodo suelto lanza InvalidStateError");
});

test("confirm: el foco inicial es Cancelar, no la accion destructiva", () => {
  const { modal } = harness();
  const dlg = modal.confirm(OPTS);
  assert.equal(dlg.querySelector("#modal-cancel").focusCount, 1);
  assert.equal(dlg.querySelector("#modal-confirm").focusCount, 0);
});

test("confirm: apunta una entrada en la pila de atras", () => {
  const { backs, calls, modal } = harness();
  modal.confirm(OPTS);
  assert.equal(backs.length, 1);
  assert.deepEqual(calls, ["pushBack"]);
});

test("confirm: pushBack recibe {scroll:false, chrome:false} — el modal no es un cambio de pantalla ni de subpantalla", () => {
  const { backOpts, modal } = harness();
  modal.confirm(OPTS);
  assert.deepEqual(backOpts, [{ scroll: false, chrome: false }]);
});

test("cancelar: cierra, desmonta, deshace la entrada y NO ejecuta onConfirm", () => {
  const { doc, calls, modal } = harness();
  let hecho = 0;
  const dlg = modal.confirm({ ...OPTS, onConfirm: () => { hecho += 1; } });
  dlg.querySelector("#modal-cancel").onclick();
  assert.equal(dlg.open, false);
  assert.equal(doc.body.children.length, 0);
  assert.deepEqual(calls, ["pushBack", "goBack"]);
  assert.equal(hecho, 0);
});

test("cancelar: pasa por requestClose — añade is-leaving antes de cerrar de verdad", () => {
  const pendientes = [];
  const { doc, modal } = harness({ wait: (ms, fn) => pendientes.push(fn) });
  const dlg = modal.confirm(OPTS);
  dlg.querySelector("#modal-cancel").onclick();
  assert.ok(dlg.classList.contains("is-leaving"), "la animación de salida debe verse ANTES del cierre real");
  assert.equal(dlg.open, true, "el cierre real espera a que termine la animación (EXIT_MS)");
  assert.equal(doc.body.children.length, 1, "sigue montado mientras dura la animación");
  assert.equal(pendientes.length, 1);
  pendientes[0]();                         // termina la animación → cierre real
  assert.equal(dlg.open, false);
  assert.equal(doc.body.children.length, 0);
});

test("confirmar: cierra, desmonta, deshace la entrada y ejecuta onConfirm UNA vez", () => {
  const { doc, calls, modal } = harness();
  let hecho = 0;
  const dlg = modal.confirm({ ...OPTS, onConfirm: () => { hecho += 1; } });
  dlg.querySelector("#modal-confirm").onclick();
  assert.equal(doc.body.children.length, 0);
  assert.deepEqual(calls, ["pushBack", "goBack"]);
  assert.equal(hecho, 1);
});

test("Escape (cancel): se intercepta con preventDefault y pasa por requestClose, no confirma", () => {
  const { doc, calls, modal } = harness();
  let hecho = 0;
  const dlg = modal.confirm({ ...OPTS, onConfirm: () => { hecho += 1; } });
  dlg.fireCancel();
  assert.equal(dlg.open, false, "con wait síncrono, la animación ya terminó y cerró de verdad");
  assert.equal(doc.body.children.length, 0);
  assert.deepEqual(calls, ["pushBack", "goBack"]);
  assert.equal(hecho, 0);
});

test("Escape (cancel): con la animación en curso, el <dialog> sigue abierto (el navegador NO lo cierra por su cuenta)", () => {
  const pendientes = [];
  const { modal } = harness({ wait: (ms, fn) => pendientes.push(fn) });
  const dlg = modal.confirm(OPTS);
  dlg.fireCancel();
  assert.ok(dlg.classList.contains("is-leaving"));
  assert.equal(dlg.open, true, "preventDefault() evita que Escape cierre de golpe, sin animación");
});

test("clic en el velo (target===dlg): cierra sin confirmar, igual que Cancelar", () => {
  const { doc, calls, modal } = harness();
  let hecho = 0;
  const dlg = modal.confirm({ ...OPTS, onConfirm: () => { hecho += 1; } });
  dlg.fireClickOn(dlg);
  assert.equal(dlg.open, false);
  assert.deepEqual(calls, ["pushBack", "goBack"]);
  assert.equal(hecho, 0);
});

test("clic dentro del contenido (target !== dlg): NO cierra", () => {
  const { modal } = harness();
  const dlg = modal.confirm(OPTS);
  dlg.fireClickOn(dlg.querySelector("#modal-cancel"));
  assert.equal(dlg.open, true);
});

test("cancelar y luego tocar Borrar DENTRO de la ventana de animación: NO confirma (el guard va también en los onclick, no solo en requestClose)", () => {
  const pendientes = [];
  const { doc, calls, modal } = harness({ wait: (ms, fn) => pendientes.push(fn) });
  let hecho = 0;
  const dlg = modal.confirm({ ...OPTS, onConfirm: () => { hecho += 1; } });
  dlg.querySelector("#modal-cancel").onclick();     // empieza a cerrar (is-leaving, wait pendiente)
  dlg.querySelector("#modal-confirm").onclick();    // toque tardío mientras se desvanece
  assert.equal(pendientes.length, 1, "el segundo onclick no reprograma un cierre nuevo");
  pendientes[0]();                                  // termina la animación → cierre real
  assert.equal(hecho, 0, "la primera acción fue cancelar: no debe confirmar");
  assert.deepEqual(calls, ["pushBack", "goBack"]);
});

test("confirmar y luego tocar Cancelar dentro de la ventana de animación: SÍ confirma (gana la primera acción)", () => {
  const pendientes = [];
  const { modal } = harness({ wait: (ms, fn) => pendientes.push(fn) });
  let hecho = 0;
  const dlg = modal.confirm({ ...OPTS, onConfirm: () => { hecho += 1; } });
  dlg.querySelector("#modal-confirm").onclick();
  dlg.querySelector("#modal-cancel").onclick();
  pendientes[0]();
  assert.equal(hecho, 1);
});

test("requestClose es idempotente: un segundo disparo (Escape tras el clic en el velo) no reprograma el cierre", () => {
  const pendientes = [];
  const { modal } = harness({ wait: (ms, fn) => pendientes.push(fn) });
  const dlg = modal.confirm(OPTS);
  dlg.fireClickOn(dlg);
  dlg.fireCancel();
  assert.equal(pendientes.length, 1, "closing ya estaba a true: no se programa un segundo wait");
});

test("gesto atras del sistema: cierra el modal sin deshacer una segunda entrada", () => {
  const { doc, backs, calls, modal } = harness();
  let hecho = 0;
  modal.confirm({ ...OPTS, onConfirm: () => { hecho += 1; } });
  backs[0]();                       // lo que ejecuta el popstate de back.js:28
  assert.equal(doc.body.children.length, 0);
  assert.deepEqual(calls, ["pushBack"], "el historial ya estaba donde toca");
  assert.equal(hecho, 0);
});

test("salto de varias entradas: cierra el modal aunque el popstate no ejecute su propio callback", () => {
  const { doc, calls, modal, win } = harness();
  let hecho = 0;
  const dlg = modal.confirm({ ...OPTS, onConfirm: () => { hecho += 1; } });
  // La entrada del modal se descarta sin ser la más baja (back.js: dropped[0]): back.js NO ejecuta
  // el callback de pushBack (backs[0]), pero el popstate sí llega — es la red de seguridad de
  // confirm() la que tiene que cerrar el <dialog>.
  for (const fn of [...win.listeners.popstate]) fn({ state: { bc: 0 } });
  assert.equal(dlg.open, false);
  assert.equal(doc.body.children.length, 0);
  assert.equal(hecho, 0);
  assert.deepEqual(calls, ["pushBack"], "el historial ya saltó por sí solo: no hay que deshacer nada más");
});

test("cerrar el modal (cancelar) quita su listener de popstate de seguridad", () => {
  const { modal, win } = harness();
  const dlg = modal.confirm(OPTS);
  assert.equal(win.listeners.popstate.length, 1);
  dlg.querySelector("#modal-cancel").onclick();
  assert.equal(win.listeners.popstate.length, 0);
});

test("cancelar: si pushBack lanzó (pushState rechazado), no deshace la pantalla de detrás", () => {
  const doc = fakeDoc();
  const calls = [];
  const modal = createModal(doc, {
    pushBack: () => { throw new Error("límite de Safari"); },
    goBack: () => calls.push("goBack"),
    win: fakeWin(),
    wait: SYNC_WAIT,
  });
  const dlg = modal.confirm(OPTS);
  dlg.querySelector("#modal-cancel").onclick();
  assert.equal(dlg.open, false);
  assert.deepEqual(calls, [], "pushBack nunca aportó una entrada que goBack() pudiera deshacer");
});

test("Escape: el nodo es un dialog abierto con showModal, que es lo que lo cierra con Escape", () => {
  const { doc, modal } = harness();
  const dlg = modal.confirm(OPTS);
  assert.equal(dlg.tag, "dialog");
  assert.ok(doc.log.includes("showModal"), "Escape, la trampa de foco y el fondo inerte los da el navegador");
});

test("Escape: el evento close desmonta, sincroniza el historial y no confirma", () => {
  const { doc, calls, modal } = harness();
  let hecho = 0;
  const dlg = modal.confirm({ ...OPTS, onConfirm: () => { hecho += 1; } });
  dlg.close();                      // cierre real directo (p. ej. si el navegador lo cerrara sin pasar por "cancel")
  assert.equal(doc.body.children.length, 0);
  assert.deepEqual(calls, ["pushBack", "goBack"]);
  assert.equal(hecho, 0);
});

test("dos confirm() seguidos: solo se abre uno", () => {
  const { doc, calls, modal } = harness();
  modal.confirm(OPTS);
  assert.equal(modal.confirm(OPTS), null);
  assert.equal(doc.body.children.length, 1);
  assert.deepEqual(calls, ["pushBack"]);
});

test("cancelar: devuelve el foco a quien abrio el modal", () => {
  const { doc, modal } = harness();
  const abridor = { focusCount: 0, focus() { this.focusCount += 1; } };
  doc.activeElement = abridor;
  const dlg = modal.confirm(OPTS);
  dlg.querySelector("#modal-cancel").onclick();
  assert.equal(abridor.focusCount, 1);
});

test("createModal sin `wait`: usa setTimeout por defecto (no revienta si el llamador no lo pasa)", () => {
  const doc = fakeDoc();
  const modal = createModal(doc, { pushBack: () => {}, goBack: () => {}, win: fakeWin() });
  const dlg = modal.confirm(OPTS);
  dlg.querySelector("#modal-cancel").onclick();
  assert.ok(dlg.classList.contains("is-leaving"));
  assert.equal(dlg.open, true, "con setTimeout real, el cierre no es síncrono");
});
