// Las piezas de chrome compartidas por las 28 pantallas (SISTEMA.md §4.2, §1). Módulo PURO:
// solo importa icons.js y t(), así que se prueba sin Worker ni DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { subHeaderHtml, metaHtml } from "../../app/app/js/ui.js";

test("subHeaderHtml: siempre TRES celdas, para que el título quede centrado de verdad", () => {
  // Es el defecto que arrastran 12 de las 14 subpantallas: sin el hueco de la derecha, el título
  // «centrado» queda descentrado justo el ancho del botón de la izquierda.
  const html = subHeaderHtml({ title: "Semana" });
  assert.equal((html.match(/sub-header-slot/g) ?? []).length, 1);
  assert.match(html, /class="icon-btn" id="screen-back"/);
});

test("subHeaderHtml: escapa el título (puede venir del nombre de un periodo o de una etiqueta)", () => {
  // escHtml viene de esc.js (PR chore/esc-html): superconjunto seguro que neutraliza & < > " ',
  // no solo & y < como hacían la mayoría de las copias locales que reemplazó.
  const html = subHeaderHtml({ title: "Viaje <Japón> & Corea" });
  assert.match(html, /Viaje &lt;Japón&gt; &amp; Corea/);
  assert.ok(!html.includes("<Japón>"));
});

test("subHeaderHtml: con action:null el tercer hueco es sub-header-slot; con id:null el primero también", () => {
  const noAction = subHeaderHtml({ title: "X", id: "x-back" });
  assert.equal((noAction.match(/sub-header-slot/g) ?? []).length, 1);

  const noId = subHeaderHtml({ title: "X", id: null });
  assert.match(noId, /<div class="sub-header-slot"><\/div>\s*<div class="sub-header-body">/);
  assert.ok(!noId.includes('id="screen-back"'));
});

test("subHeaderHtml: con action, emite el botón derecho con su icono y aria-label", () => {
  const html = subHeaderHtml({ title: "Etiquetas", id: "et-back", action: { id: "et-add", icon: "plus", label: "Añadir etiqueta" } });
  assert.match(html, /id="et-add"/);
  assert.match(html, /aria-label="Añadir etiqueta"/);
  assert.equal((html.match(/sub-header-slot/g) ?? []).length, 0);
});

test("subHeaderHtml: el subtítulo solo se pinta si se pasa, y se escapa", () => {
  const sinSub = subHeaderHtml({ title: "X" });
  assert.ok(!sinSub.includes("sub-header-sub"));

  const conSub = subHeaderHtml({ title: "X", subtitle: "A & B" });
  assert.match(conSub, /<span class="sub-header-sub">A &amp; B<\/span>/);
});

test("subHeaderHtml: align:\"start\" añade is-start; por defecto es \"center\"", () => {
  assert.match(subHeaderHtml({ title: "X", align: "start" }), /class="sub-header is-start"/);
  assert.match(subHeaderHtml({ title: "X" }), /class="sub-header"/);
});

test("subHeaderHtml: el aria-label del «atrás» cae a common.goBack y respeta backLabel", () => {
  assert.match(subHeaderHtml({ title: "X" }), /aria-label="Volver"/);
  assert.match(subHeaderHtml({ title: "X", backLabel: "Cerrar" }), /aria-label="Cerrar"/);
});

test("subHeaderHtml: el id del botón atrás es el que se pasa", () => {
  assert.match(subHeaderHtml({ title: "X", id: "mov-back" }), /id="mov-back"/);
});

test("metaHtml: un divisor MENOS que segmentos, y los vacíos no dejan divisor huérfano", () => {
  assert.equal((metaHtml(["a", "b", "c"]).match(/meta-sep/g) ?? []).length, 2);
  assert.equal((metaHtml(["a", "", null]).match(/meta-sep/g) ?? []).length, 0);
  assert.equal((metaHtml(["a"]).match(/meta-sep/g) ?? []).length, 0);
});

test("metaHtml: sin segmentos, .meta-row vacío", () => {
  assert.match(metaHtml([]), /<div class="meta-row"><\/div>/);
});

test("metaHtml: escapa cada segmento", () => {
  assert.match(metaHtml(["<b>x</b>", "A & B"]), /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(metaHtml(["<b>x</b>", "A & B"]), /A &amp; B/);
});

test("metaHtml: acepta una clase extra sin perder meta-row", () => {
  assert.match(metaHtml(["a"], { cls: "foo" }), /class="meta-row foo"/);
});
