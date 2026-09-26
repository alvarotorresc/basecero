// Las piezas de chrome compartidas por las pantallas (DESIGN.md §9). Módulo PURO:
// solo importa icons.js y t(), así que se prueba sin Worker ni DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { subHeaderHtml, rootHeaderHtml, buttonHtml, metaHtml, radioKeyIndex } from "../../app/app/js/ui.js";

// Cabecera con atrás, forma canónica B/C (DESIGN.md §9, inventario-B I-15): atrás · título a la
// izquierda · acción opcional. Ya no hay tres celdas ni huecos de relleno.
test("subHeaderHtml: atrás primero, título a la izquierda y ningún hueco de relleno", () => {
  const html = subHeaderHtml({ title: "Semana" });
  assert.ok(!html.includes("sub-header-slot"), "sin hueco de 44 a la derecha");
  assert.ok(!html.includes("is-start") && !html.includes("align"), "sin variante de alineación");
  const order = ["screen-back", "sub-header-body", "Semana"].map((s) => html.indexOf(s));
  assert.ok(order.every((i) => i >= 0), "atrás, cuerpo y título presentes");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "el atrás va antes que el título");
  assert.match(html, /<h1 class="sub-header-title">Semana<\/h1>/);
  assert.equal((html.match(/<h1/g) ?? []).length, 1, "un solo h1");
});

test("subHeaderHtml: el «atrás» es un botón icono de 44 con aria-label «Atrás» (§11)", () => {
  const html = subHeaderHtml({ title: "X", id: "mov-back" });
  assert.match(html, /<button type="button" class="icon-btn" id="mov-back" aria-label="Atrás">/);
  assert.ok(!html.includes("Volver"));
});

test("subHeaderHtml: backLabel y align ya no existen (se ignoran si llegan)", () => {
  const html = subHeaderHtml({ title: "X", backLabel: "Cerrar", align: "start" });
  assert.match(html, /aria-label="Atrás"/);
  assert.ok(!html.includes("Cerrar"));
  assert.match(html, /<header class="sub-header">/);
});

test("subHeaderHtml: escapa el título (puede venir del nombre de un periodo o de una etiqueta)", () => {
  const html = subHeaderHtml({ title: "Viaje <Japón> & Corea" });
  assert.match(html, /Viaje &lt;Japón&gt; &amp; Corea/);
  assert.ok(!html.includes("<Japón>"));
});

test("subHeaderHtml: sin acción no hay botón derecho; con id:null no hay «atrás»", () => {
  const noAction = subHeaderHtml({ title: "X", id: "x-back" });
  assert.equal((noAction.match(/<button/g) ?? []).length, 1);

  const noId = subHeaderHtml({ title: "X", id: null });
  assert.ok(!noId.includes("<button"));
  assert.ok(!noId.includes('id="screen-back"'));
});

test("subHeaderHtml: con action, el botón derecho va DESPUÉS del título, con su icono y aria-label", () => {
  const html = subHeaderHtml({ title: "Etiquetas", id: "et-back", action: { id: "et-add", icon: "plus", label: "Añadir <etiqueta>" } });
  assert.match(html, /<button type="button" class="icon-btn" id="et-add" aria-label="Añadir &lt;etiqueta&gt;"><svg/);
  assert.ok(html.indexOf('id="et-add"') > html.indexOf("sub-header-title"));
  assert.equal((html.match(/<button/g) ?? []).length, 2);
});

test("subHeaderHtml: Registro (id:null + cerrar) deja el título solo a la izquierda del cerrar", () => {
  const html = subHeaderHtml({ title: "Nuevo", id: null, action: { id: "reg-close", icon: "close", label: "Cerrar" } });
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.ok(html.indexOf("sub-header-body") < html.indexOf('id="reg-close"'));
});

test("subHeaderHtml: el subtítulo solo se pinta si se pasa, y se escapa", () => {
  const sinSub = subHeaderHtml({ title: "X" });
  assert.ok(!sinSub.includes("sub-header-sub"));

  const conSub = subHeaderHtml({ title: "X", subtitle: "A & B" });
  assert.match(conSub, /<span class="sub-header-sub">A &amp; B<\/span>/);
});

// Cabecera de raíz (DESIGN.md §9, B-Home): h1 24 + subtítulo 13/500 dim.
test("rootHeaderHtml: un h1 con el título y el subtítulo debajo, ambos escapados", () => {
  const html = rootHeaderHtml({ title: "Sept <A>", subtitle: "Día 13 & 30" });
  assert.match(html, /^<header class="root-header">/);
  assert.match(html, /<h1 class="root-header-title">Sept &lt;A&gt;<\/h1>/);
  assert.match(html, /<span class="root-header-sub">Día 13 &amp; 30<\/span>/);
  assert.ok(html.indexOf("root-header-title") < html.indexOf("root-header-sub"));
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
});

test("rootHeaderHtml: sin subtítulo no pinta la segunda línea", () => {
  assert.ok(!rootHeaderHtml({ title: "Ajustes" }).includes("root-header-sub"));
});

test("rootHeaderHtml: con subtitleAction el subtítulo es un botón (el h1 sigue fuera de él)", () => {
  const html = rootHeaderHtml({ title: "Septiembre", subtitle: "Día 13 & 30", subtitleAction: { id: "hdr-per", label: "Abrir <periodo>" } });
  assert.match(html, /<h1 class="root-header-title">Septiembre<\/h1>/);
  assert.match(html, /<button type="button" class="root-header-sub root-header-sub-btn" id="hdr-per" aria-label="Día 13 &amp; 30, Abrir &lt;periodo&gt;">Día 13 &amp; 30<\/button>/);
  assert.ok(!/<button[^>]*>[^]*<h1/.test(html), "el h1 no va dentro del botón");
  assert.ok(!rootHeaderHtml({ title: "X", subtitleAction: { id: "a", label: "b" } }).includes("<button"), "sin subtítulo no hay botón");
});

// Botones del sistema (DESIGN.md §9: Primario, Secundario M/S, Terciario, Destructivo de entrada).
test("buttonHtml: cada kind lleva su clase y siempre type=\"button\"", () => {
  const cases = { primary: "btn-primary", secondary: "btn-secondary", tertiary: "btn-tertiary", "danger-entry": "btn-danger" };
  for (const [kind, cls] of Object.entries(cases)) {
    const html = buttonHtml({ kind, label: "X" });
    assert.match(html, new RegExp(`^<button type="button" class="${cls}"`), kind);
  }
  assert.match(buttonHtml({ label: "X" }), /class="btn-secondary"/, "por defecto, secundario");
  assert.match(buttonHtml({ kind: "raro", label: "X" }), /class="btn-secondary"/, "kind desconocido → secundario");
});

test("buttonHtml: tertiary-danger es el terciario con la clase destructiva (D-1, B-Objetivo)", () => {
  const html = buttonHtml({ kind: "tertiary-danger", id: "goal-delete", label: "Borrar objetivo", icon: "trash" });
  assert.match(html, /^<button type="button" class="btn-tertiary btn-tertiary-danger" id="goal-delete"><svg/);
  assert.match(html, /<span>Borrar objetivo<\/span><\/button>$/);
  assert.match(buttonHtml({ kind: "tertiary-danger", size: "s", label: "X" }), /class="btn-tertiary btn-tertiary-danger"/, "sin talla S");
  assert.ok(!buttonHtml({ kind: "tertiary-danger", label: "X", note: "n" }).includes("btn-note"));
});

test("buttonHtml: talla S solo en secundario y entrada destructiva", () => {
  assert.match(buttonHtml({ kind: "secondary", size: "s", label: "X" }), /class="btn-secondary btn-s"/);
  assert.match(buttonHtml({ kind: "danger-entry", size: "s", label: "X" }), /class="btn-danger btn-s"/);
  assert.match(buttonHtml({ kind: "primary", size: "s", label: "X" }), /class="btn-primary"/);
  assert.match(buttonHtml({ kind: "tertiary", size: "s", label: "X" }), /class="btn-tertiary"/);
});

test("buttonHtml: la nota del primario va DEBAJO del botón (I-67), en un contenedor", () => {
  const html = buttonHtml({ kind: "primary", id: "pn-open", label: "Abrir Octubre", note: "Se guarda el informe" });
  assert.match(html, /^<div class="btn-stack"><button type="button" class="btn-primary" id="pn-open">/);
  assert.ok(html.indexOf("</button>") < html.indexOf('class="btn-note"'), "nota después del botón");
  assert.match(html, /<span class="btn-note">Se guarda el informe<\/span><\/div>$/);
  assert.ok(!buttonHtml({ kind: "primary", label: "X" }).includes("btn-stack"), "sin nota, botón suelto");
  assert.ok(!buttonHtml({ kind: "secondary", label: "X", note: "n" }).includes("btn-note"), "la nota es solo del primario");
});

test("buttonHtml: escapa etiqueta, nota e id", () => {
  const html = buttonHtml({ kind: "primary", id: 'a"b', label: "<b>Borrar</b> & co", note: "<i>n</i>" });
  assert.match(html, /id="a&quot;b"/);
  assert.match(html, /&lt;b&gt;Borrar&lt;\/b&gt; &amp; co/);
  assert.match(html, /&lt;i&gt;n&lt;\/i&gt;/);
  assert.ok(!html.includes("<b>") && !html.includes("<i>"));
});

test("buttonHtml: icono opcional delante del texto, sin id vacío, y disabled", () => {
  const html = buttonHtml({ kind: "danger-entry", label: "Borrar", icon: "trash", disabled: true });
  assert.match(html, /<button type="button" class="btn-danger" disabled><svg [^>]*width="18"[^>]*>.*<\/svg><span>Borrar<\/span><\/button>/);
  assert.ok(!buttonHtml({ label: "X" }).includes("id="));
  assert.ok(!buttonHtml({ label: "X", icon: "nope" }).includes("<svg"), "un icono desconocido no pinta nada");
});

test("buttonHtml: data-* para una lista de botones sin id fijo (S9, candidatas)", () => {
  const html = buttonHtml({ kind: "secondary", size: "s", label: "Sí, añádela", data: { add: 'mer"chant' } });
  assert.match(html, /data-add="mer&quot;chant"/);
  assert.ok(!buttonHtml({ label: "X" }).includes("data-"), "sin data, ningún atributo data-*");
  assert.ok(!buttonHtml({ label: "X", data: { add: null } }).includes("data-"), "un valor null no pinta el atributo");
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

test("radioKeyIndex: flechas con vuelta, Inicio/Fin, y el resto de teclas no mueven", () => {
  assert.equal(radioKeyIndex("ArrowRight", 0, 3), 1);
  assert.equal(radioKeyIndex("ArrowDown", 2, 3), 0);
  assert.equal(radioKeyIndex("ArrowLeft", 0, 3), 2);
  assert.equal(radioKeyIndex("ArrowUp", 1, 3), 0);
  assert.equal(radioKeyIndex("Home", 2, 3), 0);
  assert.equal(radioKeyIndex("End", 0, 3), 2);
  assert.equal(radioKeyIndex("Tab", 1, 3), -1);
  assert.equal(radioKeyIndex("Enter", 1, 3), -1);
});
