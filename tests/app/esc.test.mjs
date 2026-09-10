// esc.js es el único módulo que puede definir escHtml/escAttr — hasta esta PR vivían copiados en
// 18 ficheros (16 pantallas + recibo.js + modal.js + ui.js), cada uno con su propia copia local
// (mismo patrón repetido, ver grep del historial de la PR chore/esc-html). Este test cubre el
// contrato del módulo: los cinco caracteres, null/undefined/números, idempotencia sobre texto
// llano. El escaneo de "ninguna copia local ha vuelto a aparecer" vive al final de este mismo
// fichero, añadido en el commit que termina de migrar las 16 pantallas — antes de eso fallaría
// contra copias que este commit todavía no ha tocado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { escHtml, escAttr } from "../../app/app/js/esc.js";

test("escHtml escapa los cinco caracteres especiales", () => {
  assert.equal(escHtml("&"), "&amp;");
  assert.equal(escHtml("<"), "&lt;");
  assert.equal(escHtml(">"), "&gt;");
  assert.equal(escHtml('"'), "&quot;");
  assert.equal(escHtml("'"), "&#39;");
  assert.equal(escHtml(`A&B <test> "x" 'y'`), "A&amp;B &lt;test&gt; &quot;x&quot; &#39;y&#39;");
});

test("escAttr escapa los cinco caracteres especiales (superconjunto seguro: sirve para atributos con comillas simples o dobles)", () => {
  assert.equal(escAttr("&"), "&amp;");
  assert.equal(escAttr("<"), "&lt;");
  assert.equal(escAttr(">"), "&gt;");
  assert.equal(escAttr('"'), "&quot;");
  assert.equal(escAttr("'"), "&#39;");
  assert.equal(escAttr(`A&B <test> "x" 'y'`), "A&amp;B &lt;test&gt; &quot;x&quot; &#39;y&#39;");
});

test("null/undefined se convierten en cadena vacía", () => {
  assert.equal(escHtml(null), "");
  assert.equal(escHtml(undefined), "");
  assert.equal(escAttr(null), "");
  assert.equal(escAttr(undefined), "");
});

test("los números se convierten en texto sin tocar", () => {
  assert.equal(escHtml(0), "0");
  assert.equal(escHtml(1234), "1234");
  assert.equal(escHtml(-4.5), "-4.5");
  assert.equal(escAttr(1234), "1234");
});

test("idempotente sobre texto sin caracteres especiales", () => {
  const texto = "Supermercado de la esquina 123";
  assert.equal(escHtml(texto), texto);
  assert.equal(escAttr(texto), texto);
});
