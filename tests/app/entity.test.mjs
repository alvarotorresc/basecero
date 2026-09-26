// Piezas de entidad del sistema B (DESIGN.md §9; C4, C6, C7, C9, C10, I-61). Módulo PURO: se
// prueba sin Worker ni DOM. Nombres de comercio inventados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  tileHtml, pickTileHtml, badgeHtml, chosenCategoryHtml, filterChipHtml,
  txRowHtml, settingRowHtml, dayHeaderHtml, sectionHeaderHtml, familySwatchesHtml,
} from "../../app/app/js/entity.js";

const AMOUNT = '12,50<span class="money-cents"></span><span class="money-cur"> €</span>';

const CSS = readFileSync(new URL("../../app/app/css/components.css", import.meta.url), "utf8");
/** Misma lectura mínima que design-rules.test.mjs#reglasCss/instrument.test.mjs (no se importa de
 *  ninguno de los dos: importar un .test.mjs registraría también sus tests en este proceso). */
function reglasCss(css) {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    sel: m[1].trim(),
    decls: m[2].split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(":");
      return { prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim() };
    }),
  }));
}
const decl = (sel, prop) => reglasCss(CSS).filter((r) => r.sel.split(",").map((s) => s.trim()).includes(sel))
  .flatMap((r) => r.decls).find((d) => d.prop === prop)?.value;

test("tileHtml: tinte por familia, 32 compacta, --chip sobre tinte y neutra sin familia", () => {
  assert.match(tileHtml({ fam: "res" }), /class="ent-tile fam-res"/);
  assert.match(tileHtml({ fam: "res", size: 32 }), /class="ent-tile ent-tile-32 fam-res"/);
  assert.match(tileHtml({ fam: "res", onTint: true }), /ent-on-tint/);
  const neutra = tileHtml({ fam: null, icon: "income" });
  assert.match(neutra, /ent-neutral/);
  assert.ok(!neutra.includes("fam-"));
  assert.ok(!tileHtml({ fam: "inventada" }).includes("fam-"), "una clave desconocida no inventa clase");
});

test("badgeHtml: la ficha de ingreso (C9) no lleva clase fam- ni borde de etiqueta", () => {
  const html = badgeHtml({ income: true, fam: "res", label: "Intereses de ahorro" });
  assert.ok(!html.includes("fam-"), html);
  assert.match(html, /ent-badge-income/);
  assert.ok(!html.includes("ent-badge-tag"));
});

test("badgeHtml: etiqueta neutra (C10) con icono de etiqueta; con familia, clase fam-", () => {
  const tag = badgeHtml({ tag: true, label: "Oficina" });
  assert.match(tag, /ent-badge-tag/);
  assert.ok(!tag.includes("fam-"));
  assert.match(badgeHtml({ fam: "tra", label: "Transporte" }), /class="ent-badge fam-tra"/);
});

test("txRowHtml: un ingreso lleva «+» y la clase pos; sin familia, baldosa neutra", () => {
  const html = txRowHtml({ fam: null, title: "Nómina", line2: "Ingresos", amountHtml: AMOUNT, sign: "income" });
  assert.match(html, /class="ent-amount num pos">\+12,50/);
  assert.ok(!html.includes("fam-"));
  assert.match(html, /ent-tile ent-neutral/);
  assert.match(html, /class="ent-row ent-neutral"/, "la fila sin familia también es neutra");
});

test("txRowHtml: un gasto lleva «−» (U+2212) y va en tinta (ni pos ni neg)", () => {
  const html = txRowHtml({ fam: "ali", title: "Mercado Sol", line2: "Alimentación › Supermercado", amountHtml: AMOUNT });
  assert.match(html, /class="ent-amount num">−12,50/);
  assert.ok(!/ent-amount num (pos|neg)/.test(html));
  assert.match(html, /class="ent-row fam-ali"/);
  const alerta = txRowHtml({ fam: "ali", title: "X", amountHtml: AMOUNT, sign: "alert" });
  assert.match(alerta, /class="ent-amount num neg">−/);
  const sin = txRowHtml({ title: "X", amountHtml: AMOUNT, sign: "none" });
  assert.match(sin, /class="ent-amount num">12,50/);
});

test("txRowHtml: escapa el nombre del comercio, la línea 2, la nota y los atributos", () => {
  const html = txRowHtml({
    fam: "res", title: 'Bar <b>"Lola"</b> & Co', line2: "Resta<u>", amountHtml: AMOUNT,
    amountNote: "<i>tu parte</i>", id: 'tx"1', data: { txId: '5"><x' },
  });
  assert.ok(!html.includes("<b>") && !html.includes("<u>") && !html.includes("<i>") && !html.includes("<x"));
  assert.match(html, /Bar &lt;b&gt;&quot;Lola&quot;&lt;\/b&gt; &amp; Co/);
  assert.match(html, /id="tx&quot;1"/);
  assert.match(html, /data-tx-id="5&quot;&gt;&lt;x"/);
});

test("settingRowHtml: nunca emite fam- en el valor ni en la fila (I-61)", () => {
  const html = settingRowHtml({ icon: "calendar", fam: "tra", label: "Cuenta", value: "Corriente" });
  const valor = html.match(/<span class="ent-set-value[^"]*">[^<]*<\/span>/)[0];
  assert.ok(!valor.includes("fam-"), valor);
  assert.match(html, /^<button type="button" class="ent-set">/, "la familia no va en la fila");
  assert.match(html, /class="ent-tile ent-tile-32 fam-tra"/, "solo en la baldosa");
  const sinFam = settingRowHtml({ icon: "calendar", label: "El periodo empieza", value: "Día 28", valueNum: true });
  assert.ok(!sinFam.includes("fam-"));
  assert.match(sinFam, /ent-tile ent-tile-32 ent-neutral/);
});

test("settingRowHtml: valueFam pinta la muestra de la cuenta delante del valor, nunca en él (C8, I-61)", () => {
  const html = settingRowHtml({ label: "Cuenta", value: "Cuenta corriente", valueFam: "tra" });
  assert.match(html, /<span class="ent-swatch fam-tra" aria-hidden="true"><\/span><span class="ent-set-value">Cuenta corriente<\/span>/);
  assert.match(html, /^<button type="button" class="ent-set">/, "la familia no va en la fila");
  assert.ok(!settingRowHtml({ label: "Cuenta", value: "X", valueFam: "rojo" }).includes("ent-swatch"), "una clave que no es familia no pinta muestra");
  assert.ok(!settingRowHtml({ label: "Cuenta", valueFam: "tra" }).includes("ent-swatch"), "sin valor, sin muestra");
});

test("settingRowHtml: con control es un div sin chevron; sin él, botón con chevron; escapa", () => {
  const sw = '<button role="switch" aria-checked="true" aria-labelledby="notif-label"></button>';
  const conControl = settingRowHtml({ label: "Avisos", controlHtml: sw, id: "notif" });
  assert.match(conControl, /^<div class="ent-set" id="notif">/);
  assert.match(conControl, /id="notif-label"/);
  assert.ok(conControl.includes(sw));
  assert.ok(!conControl.includes("ent-chev"));
  const enlace = settingRowHtml({ label: "Moneda <EUR>", value: "€ & más", sub: "dos" });
  assert.match(enlace, /ent-chev/);
  assert.match(enlace, /class="ent-set ent-set-2"/);
  assert.ok(enlace.includes("Moneda &lt;EUR&gt;") && enlace.includes("€ &amp; más"));
});

test("settingRowHtml: desplegable (aria-expanded/aria-controls) y desactivada; solo en la fila botón", () => {
  const cerrada = settingRowHtml({ label: "Copia cifrada", id: "aj-enc", expanded: false, controls: "aj-enc-panel" });
  assert.match(cerrada, /^<button type="button" class="ent-set" id="aj-enc" aria-expanded="false" aria-controls="aj-enc-panel">/);
  const abierta = settingRowHtml({ label: "Copia cifrada", expanded: true, controls: "p\"x" });
  assert.match(abierta, /aria-expanded="true" aria-controls="p&quot;x"/);
  const normal = settingRowHtml({ label: "Moneda" });
  assert.ok(!normal.includes("aria-expanded") && !normal.includes("aria-controls") && !normal.includes("disabled"));
  assert.match(settingRowHtml({ label: "Banco", disabled: true }), /^<button type="button" class="ent-set" disabled>/);
  const conControl = settingRowHtml({ label: "Avisos", controlHtml: "<i></i>", expanded: true, disabled: true });
  assert.ok(!conControl.includes("aria-expanded") && !conControl.includes("disabled"), "un div no se despliega ni se desactiva");
});

test("settingRowHtml: la etiqueta y la segunda línea truncan en una sola línea (S11, categorías largas)", () => {
  // Sin white-space:nowrap, text-overflow:ellipsis no hace nada (MDN): el nombre envuelve en su
  // lugar y, con un control ancho al lado (B-PeriodoNuevo), parte «Impuestos y tasas» en 2-3
  // líneas y estira la fila entera. Bug real visto en captura; no un caso sintético.
  for (const sel of [".ent-set-label", ".ent-set-sub"]) {
    assert.equal(decl(sel, "white-space"), "nowrap", sel);
    assert.equal(decl(sel, "overflow"), "hidden", sel);
    assert.equal(decl(sel, "text-overflow"), "ellipsis", sel);
  }
});

test("pickTileHtml: seleccionado → aria-pressed=\"true\"; si no, \"false\"", () => {
  assert.match(pickTileHtml({ fam: "res", label: "Restauración", selected: true }), /aria-pressed="true"/);
  assert.match(pickTileHtml({ fam: "res", label: "Restauración" }), /aria-pressed="false"/);
  assert.match(pickTileHtml({ fam: null, label: "Nómina", selected: true }), /class="ent-pick ent-neutral"/);
  assert.match(pickTileHtml({ fam: "res", label: "<x>" }), /&lt;x&gt;/);
});

test("filterChipHtml: con familia, muestra y aria-pressed; neutro con check; etiqueta sin familia", () => {
  const fam = filterChipHtml({ fam: "casa", label: "Casa", selected: true });
  assert.match(fam, /class="ent-chip fam-casa" aria-pressed="true"/);
  assert.match(fam, /ent-swatch/);
  const neutro = filterChipHtml({ label: "Todos", selected: true, check: true });
  assert.match(neutro, /class="ent-chip ent-neutral"/);
  assert.match(neutro, /<svg/);
  assert.ok(!filterChipHtml({ label: "Todos", selected: false, check: true }).includes("<svg"));
  const tag = filterChipHtml({ tag: true, fam: "casa", label: "Viaje" });
  assert.ok(!tag.includes("fam-"));
  assert.match(tag, /ent-chip-tag/);
});

test("chosenCategoryHtml: sin borde de familia, nombre arriba y ruta debajo; botón solo con id", () => {
  const html = chosenCategoryHtml({ fam: "res", name: "Bares y cafés", path: "Restauración", id: "cat-pick" });
  assert.match(html, /^<button type="button" class="ent-chosen fam-res" id="cat-pick">/);
  assert.ok(html.indexOf("Bares y cafés") < html.indexOf("Restauración"));
  assert.match(html, /ent-on-tint/);
  assert.match(html, /ent-chev/);
  assert.match(chosenCategoryHtml({ fam: null, name: "Nómina" }), /^<div class="ent-chosen ent-neutral">/);
});

test("cabeceras de día y de sección: sin familia, sin h1, y escapan", () => {
  const dia = dayHeaderHtml({ label: "Hoy", date: "dom 13", totalHtml: AMOUNT });
  assert.ok(!dia.includes("fam-"));
  assert.match(dia, /ent-day-total num/);
  assert.ok(!dayHeaderHtml({ label: "Ayer" }).includes("ent-day-total"));
  const sec = sectionHeaderHtml({ title: "Activas <3>", count: 4 });
  assert.ok(!sec.includes("fam-") && !sec.includes("<h1"));
  assert.match(sec, /<h2 class="ent-sec-text">Activas &lt;3&gt;<\/h2>/);
  assert.match(sectionHeaderHtml({ title: "Cuenta", level: "group", tag: "h3" }), /ent-sec-group"><h3/);
});

// ---------- familySwatchesHtml (selector de familia, S3) ----------

test("familySwatchesHtml: grupo con aria-label y una muestra aria-pressed por familia válida", () => {
  const html = familySwatchesHtml({
    label: "Color de la cuenta", value: "tra", id: "fam-pick",
    options: [{ fam: "casa", label: "Arena" }, { fam: "tra", label: "Cielo, la usa Cuenta" }, { fam: "rojo", label: "X" }],
  });
  assert.match(html, /role="group" aria-label="Color de la cuenta" id="fam-pick"/);
  assert.equal((html.match(/class="ent-fam-pick /g) ?? []).length, 2, "descarta la clave que no es familia");
  assert.doesNotMatch(html, /fam-rojo/);
  assert.match(html, /class="ent-fam-pick fam-casa" aria-pressed="false" aria-label="Arena" data-fam="casa"/);
  assert.match(html, /class="ent-fam-pick fam-tra" aria-pressed="true" aria-label="Cielo, la usa Cuenta" data-fam="tra"/);
});

test("familySwatchesHtml: solo la elegida lleva el check; sin radios (aria-checked) y escapa el label", () => {
  const html = familySwatchesHtml({ label: 'A "B"', value: "casa", options: [{ fam: "casa", label: "<x>" }, { fam: "ali", label: "Salvia" }] });
  assert.equal((html.match(/<svg/g) ?? []).length, 1);
  assert.doesNotMatch(html, /aria-checked|role="radio"/);
  assert.match(html, /aria-label="A &quot;B&quot;"/);
  assert.match(html, /aria-label="&lt;x&gt;"/);
});

test("pickTileHtml: expanded pone aria-expanded solo si es booleano (desplegar no es seleccionar)", () => {
  assert.match(pickTileHtml({ fam: "res", label: "Restauración", expanded: true }), /aria-expanded="true"/);
  assert.match(pickTileHtml({ fam: "res", label: "Restauración", expanded: false }), /aria-expanded="false"/);
  assert.doesNotMatch(pickTileHtml({ fam: "res", label: "Restauración" }), /aria-expanded/);
  assert.match(pickTileHtml({ fam: "res", label: "Restauración", expanded: true }), /aria-pressed="false"/);
});
