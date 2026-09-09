// modalHtml es puro (devuelve un string, como skeletonHtml): el contrato de accesibilidad se
// verifica sobre el string. createModal(doc, {pushBack, goBack}) recibe sus dependencias por
// parámetro —mismo patrón que createToaster(doc) en toast.js— para probarlo en Node con un
// document falso. El fake de <dialog> reproduce lo que importa del elemento nativo: showModal()
// exige estar en el documento, y close() sobre un diálogo ya cerrado es un no-op que NO vuelve a
// emitir "close" (de eso depende que el gesto atrás tardío sea inocuo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { modalHtml, createModal } from "../../app/app/js/modal.js";

function fakeDoc() {
  const body = { children: [], appendChild(n) { this.children.push(n); n.inBody = true; } };
  const doc = { body, activeElement: null, log: [], createElement: (tag) => node(tag) };
  function node(tag) {
    const listeners = {};
    const kids = {};
    const self = {
      tag, className: "", innerHTML: "", attrs: {}, open: false, inBody: false,
      focusCount: 0, focusOpts: null,
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
    };
    return self;
  }
  return doc;
}

function harness() {
  const doc = fakeDoc();
  const backs = [];
  const calls = [];
  const modal = createModal(doc, {
    pushBack: (cb) => { backs.push(cb); calls.push("pushBack"); },
    goBack: () => calls.push("goBack"),
  });
  return { doc, backs, calls, modal };
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

test("confirm: cuelga el dialog del body ANTES de showModal, con role, aria-modal y aria-labelledby", () => {
  const { doc, modal } = harness();
  const dlg = modal.confirm(OPTS);
  assert.equal(doc.body.children.length, 1);
  assert.equal(dlg.tag, "dialog");
  assert.equal(dlg.className, "modal");
  assert.equal(dlg.attrs.role, "dialog");
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

test("confirmar: cierra, desmonta, deshace la entrada y ejecuta onConfirm UNA vez", () => {
  const { doc, calls, modal } = harness();
  let hecho = 0;
  const dlg = modal.confirm({ ...OPTS, onConfirm: () => { hecho += 1; } });
  dlg.querySelector("#modal-confirm").onclick();
  assert.equal(doc.body.children.length, 0);
  assert.deepEqual(calls, ["pushBack", "goBack"]);
  assert.equal(hecho, 1);
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
  dlg.close();                      // es lo que hace Escape en un <dialog> modal
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
