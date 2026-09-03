// createToaster recibe el `document` como parámetro (mismo patrón que createBackStack(win) en
// back.js): en Node no hay DOM, así que se le pasa uno falso que registra lo que el módulo hace.
// Los temporizadores se controlan con los mock timers de node:test — mockear setTimeout mockea
// también clearTimeout, que es lo que usa el reinicio del toast.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createToaster } from "../../app/app/js/toast.js";

function fakeDoc() {
  const body = { children: [], appendChild(n) { this.children.push(n); } };
  return {
    body,
    created: 0,
    createElement() {
      this.created += 1;
      const clases = new Set();
      return {
        id: "", textContent: "", attrs: {},
        classList: {
          add: (c) => clases.add(c),
          remove: (c) => clases.delete(c),
          contains: (c) => clases.has(c),
        },
        setAttribute(k, v) { this.attrs[k] = v; },
      };
    },
  };
}

test("show: crea UN nodo #toast en el body, con el texto, y lo esconde a los 3 s", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const doc = fakeDoc();
  const toaster = createToaster(doc);

  toaster.show("Guardado");
  assert.equal(doc.created, 1);
  assert.equal(doc.body.children.length, 1);
  const nodo = doc.body.children[0];
  assert.equal(nodo.id, "toast");
  assert.equal(nodo.textContent, "Guardado");
  assert.equal(nodo.attrs.role, "status", "lector de pantalla: es un aviso, no un control");
  assert.equal(nodo.attrs["aria-live"], "polite");
  assert.ok(nodo.classList.contains("is-visible"));

  t.mock.timers.tick(2999);
  assert.ok(nodo.classList.contains("is-visible"), "a los 2,999 s sigue visible");
  t.mock.timers.tick(1);
  assert.equal(nodo.classList.contains("is-visible"), false, "a los 3 s se va");
});

test("show dos veces: reutiliza el mismo nodo, cambia el texto y reinicia la cuenta atrás", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const doc = fakeDoc();
  const toaster = createToaster(doc);

  toaster.show("Guardado");
  t.mock.timers.tick(2000);
  toaster.show("Límite quitado");
  assert.equal(doc.created, 1, "un solo nodo en toda la vida de la página");
  assert.equal(doc.body.children.length, 1);
  const nodo = doc.body.children[0];
  assert.equal(nodo.textContent, "Límite quitado");

  // Si el timer NO se reiniciara, el del primer show (que vence a los 3 s) escondería este
  // segundo toast 1 s después de aparecer.
  t.mock.timers.tick(1000);
  assert.ok(nodo.classList.contains("is-visible"), "el timer viejo ya no puede esconderlo");
  t.mock.timers.tick(2000);
  assert.equal(nodo.classList.contains("is-visible"), false);
});
