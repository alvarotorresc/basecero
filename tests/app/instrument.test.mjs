// instrument.js (PR-07): Display, LED, bento, contenedor, barra apilada, medidor, columnas y vacío.
// Funciones puras: se comprueba el HTML y, donde el color es la garantía (pista del medidor, tamaño
// de la cifra), la regla de components.css que lo pinta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  displayHtml, dispInkHtml, ledHtml, bentoHtml, containerHtml, stackedBarHtml, meterHtml, columnsHtml,
  emptyStateHtml, DISPLAY_SIZES, LED_STATES,
} from "../../app/app/js/instrument.js";

const CSS = readFileSync(new URL("../../app/app/css/components.css", import.meta.url), "utf8");
/** Reglas CSS más internas {sel, decls} (la misma lectura que design-rules.test.mjs#reglasCss; no se
 *  importa de allí porque importar un .test.mjs registraría también sus tests en este proceso). */
function reglasCss(css) {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    sel: m[1].trim(),
    decls: m[2].split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(":");
      return { prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim() };
    }),
  }));
}
/** Declaraciones de la regla cuyo selector es exactamente `sel`. */
const decl = (sel, prop) => reglasCss(CSS).filter((r) => r.sel.split(",").map((s) => s.trim()).includes(sel))
  .flatMap((r) => r.decls).find((d) => d.prop === prop)?.value;
const count = (html, re) => (html.match(re) || []).length;

// ---- Display ----------------------------------------------------------------------------------

test("displayHtml: labelAfter va tal cual detrás de la etiqueta escapada", () => {
  const html = displayHtml({ label: "A&B", value: "1 €", labelAfter: '<svg class="chev"></svg>' });
  assert.match(html, /<span class="disp-label">A&amp;B<svg class="chev"><\/svg><\/span>/);
  assert.match(displayHtml({ label: "x", value: "1" }), /<span class="disp-label">x<\/span>/);
});

test("displayHtml: exactamente un .disp-value por Display (K4), con pie, LED e instrumento", () => {
  const html = displayHtml({
    label: "Hoy puedes gastar", value: "32,84 €", size: "xl",
    footHtml: `Quedan ${dispInkHtml("558,29 €")} de 1.700,00 €`,
    led: { state: "ok", text: "Periodo abierto" },
    slot: meterHtml({ value: 1, max: 2, onDisplay: true }),
  });
  assert.equal(count(html, /\bdisp-value\b(?!-)/g), 1);
  assert.equal(count(html, /class="num disp-ink"/g), 1, "la secundaria va en --disp-ink");
  assert.match(html, /class="led led-ok"/);
});

test("displayHtml: el tamaño sale de size y solo existen xl, l y m (K9: 52/44/34)", () => {
  assert.deepEqual(DISPLAY_SIZES, ["xl", "l", "m"]);
  for (const size of DISPLAY_SIZES) {
    assert.match(displayHtml({ label: "x", value: "1 €", size }), new RegExp(`class="num disp-value disp-value-${size}"`));
  }
  assert.match(displayHtml({ label: "x", value: "1 €" }), /disp-value-l"/, "por defecto, subpantalla (44)");
  assert.throws(() => displayHtml({ label: "x", value: "1", size: "xxl" }), /K9/);
  assert.equal(decl(".disp-value-xl", "font-size"), "var(--disp-xl)");
  assert.equal(decl(".disp-value-l", "font-size"), "var(--disp-l)");
  assert.equal(decl(".disp-value-m", "font-size"), "var(--disp-m)");
  assert.equal(decl(".disp-value", "line-height"), "var(--lh-disp)");
  assert.equal(decl(".disp", "padding"), "var(--sp-16) var(--sp-20)");
});

test("displayHtml: lanza si el pie o el instrumento traen una segunda cifra .disp-value (K4)", () => {
  const otra = '<span class="num disp-value disp-value-m">9 €</span>';
  assert.throws(() => displayHtml({ label: "x", value: "1", slot: otra }), /K4/);
  assert.throws(() => displayHtml({ label: "x", value: "1", footHtml: otra }), /K4/);
});

test("displayHtml: escapa etiqueta, cifra y pie en texto", () => {
  const html = displayHtml({ label: "<b>", value: "1 & 2", foot: "\"pie\"" });
  assert.ok(html.includes("&lt;b&gt;") && html.includes("1 &amp; 2") && html.includes("&quot;pie&quot;"));
  assert.ok(!html.includes("<b>"));
});

test("displayHtml: la cifra en ámbar con brillo y las secundarias en --disp-ink, solo por CSS", () => {
  assert.equal(decl(".disp-value", "color"), "var(--disp-text)");
  assert.equal(decl(".disp-value", "text-shadow"), "var(--disp-glow)");
  assert.equal(decl(".disp-ink", "color"), "var(--disp-ink)");
  assert.doesNotMatch(displayHtml({ label: "x", value: "1" }), /style=/);
});

// ---- LED -------------------------------------------------------------------------------------

test("ledHtml: ok, idle y espera, siempre con texto (el color nunca es la única señal)", () => {
  assert.deepEqual(LED_STATES, ["ok", "idle", "wait"]);
  for (const state of LED_STATES) {
    const html = ledHtml({ state, text: "Periodo abierto" });
    assert.match(html, new RegExp(`class="led led-${state}"`));
    assert.match(html, /<span class="led-dot" aria-hidden="true"><\/span>Periodo abierto<\/span>$/);
  }
  assert.throws(() => ledHtml({ state: "ok", text: "" }), /texto/);
  assert.throws(() => ledHtml({ state: "ok", text: "   " }), /texto/);
  assert.throws(() => ledHtml({ state: "rojo", text: "x" }), /estado/);
});

test("ledHtml: la espera solo existe dentro del Display; fuera, ok va en --pos sin brillo", () => {
  assert.throws(() => ledHtml({ state: "wait", text: "1 pendiente", onDisplay: false }), /Display/);
  assert.match(ledHtml({ state: "ok", text: "Listo", onDisplay: false }), /class="led led-ok led-out"/);
  assert.equal(decl(".led-out.led-ok .led-dot", "background"), "var(--pos)");
  assert.equal(decl(".led-out.led-ok .led-dot", "box-shadow"), "none");
  assert.equal(decl(".led-ok .led-dot", "background"), "var(--ok)");
  assert.equal(decl(".led-dot", "background"), "var(--idle)");
  assert.equal(decl(".led-dot", "border-radius"), "var(--radius-pill)");
});

// ---- Bento y contenedor ----------------------------------------------------------------------

test("bentoHtml: neutro en --raised; con familia, su tinte; la cifra nunca en color de familia", () => {
  const neutro = bentoHtml({ label: "Ahorras", value: "47 %", foot: "de 2.150,00 €" });
  assert.match(neutro, /class="bento"/);
  assert.match(neutro, /class="num bento-figure">47 %</);
  const tinte = bentoHtml({ label: "Cuenta corriente", value: "3.374,26 €", fam: "tra" });
  assert.match(tinte, /class="bento bento-tint fam-tra"/);
  assert.match(bentoHtml({ label: "x", fam: "nada" }), /class="bento"/, "una clave desconocida no inventa clase");
  assert.equal(decl(".bento-figure", "font-size"), "var(--fs-20)", "C3: fuera del Display, 20 como mucho");
  assert.equal(decl(".bento-figure", "color"), "var(--text)");
});

test("containerHtml: gráfico con relleno 16 y lista con 4; cabecera con título y total", () => {
  const html = containerHtml({ title: "Gasto por categoría", total: "1.141,71 €", body: "<p>x</p>" });
  assert.match(html, /class="box box-chart"/);
  assert.match(html, /<h2 class="box-title">Gasto por categoría<\/h2><span class="num box-total">1.141,71 €<\/span>/);
  assert.match(containerHtml({ body: "", kind: "list", label: "Movimientos" }), /class="box box-list" aria-label="Movimientos"/);
  assert.equal(decl(".box-chart", "padding"), "var(--sp-16)");
  assert.equal(decl(".box-list", "padding"), "var(--sp-4)");
});

test("containerHtml: `aside` pone la acción a la derecha de la cabecera, tal cual y en lugar del total", () => {
  const btn = '<button type="button" class="btn-tertiary" id="ver">Ver todos</button>';
  const html = containerHtml({ title: "Últimos movimientos", total: "9,00 €", aside: btn, body: "", kind: "list" });
  assert.match(html, /<div class="box-head"><h2 class="box-title">Últimos movimientos<\/h2><button type="button" class="btn-tertiary" id="ver">Ver todos<\/button><\/div>/);
  assert.ok(!html.includes("box-total"), "con aside no hay total");
  assert.match(containerHtml({ aside: btn, body: "" }), /<div class="box-head"><span><\/span><button/, "sin título la acción sigue a la derecha");
});

// ---- Barra apilada ---------------------------------------------------------------------------

const SEGS = [
  { fam: "casa", value: 468, name: "Casa", amount: "468,00 €" },
  { fam: "ali", value: 192.82, name: "Alimentación", amount: "192,82 €" },
  { idle: true, value: 159.1, name: "Resto", amount: "159,10 €" },
];

test("stackedBarHtml: lanza si un segmento no trae nombre (C12)", () => {
  assert.throws(() => stackedBarHtml([{ fam: "casa", value: 10 }]), /C12/);
  assert.throws(() => stackedBarHtml([{ fam: "casa", value: 10, name: " " }]), /C12/);
});

test("stackedBarHtml: un segmento por valor > 0, barra en -b de su familia y «Resto» en --idle", () => {
  const html = stackedBarHtml([...SEGS, { fam: "oci", value: 0, name: "Ocio" }]);
  const segs = [...html.matchAll(/<span class="sbar-seg ([^"]+)" style="flex-basis:([\d.]+)%"/g)];
  assert.deepEqual(segs.map((m) => m[1]), ["fam-casa", "fam-ali", "is-idle"]);
  const sum = segs.reduce((a, m) => a + Number(m[2]), 0);
  assert.ok(Math.abs(sum - 100) < 0.01, `las proporciones suman 100 (${sum})`);
  assert.equal(decl(".sbar-seg", "background"), "var(--fb)");
  assert.equal(decl(".sbar-seg.is-idle", "background"), "var(--idle)");
});

test("stackedBarHtml: leyenda con nombre e importe, y los nombres en el aria-label de la barra", () => {
  const html = stackedBarHtml(SEGS, { label: "Gasto por categoría" });
  assert.match(html, /role="img" aria-label="Gasto por categoría, Casa 468,00 €, Alimentación 192,82 €, Resto 159,10 €"/);
  assert.equal(count(html, /<li class="sbar-key/g), 3);
  assert.match(html, /<span class="sbar-name">Alimentación<\/span><span class="num sbar-amt">192,82 €<\/span>/);
  assert.match(html, /<li class="sbar-key is-rest">/);
});

test("stackedBarHtml: tamaños 24 y 8, deuda con su trama, sin leyenda si se pide, vacía sin valores", () => {
  assert.match(stackedBarHtml(SEGS, { size: 8 }), /class="sbar sbar-8"/);
  assert.throws(() => stackedBarHtml(SEGS, { size: 10 }), /24 ni 8/);
  const pat = stackedBarHtml([{ fam: "tra", value: 3, name: "Tienes" }, { debt: true, value: 1, name: "Debes" }], { legend: false });
  assert.match(pat, /sbar-seg is-debt/);
  assert.doesNotMatch(pat, /sbar-legend/);
  assert.match(pat, /aria-label="Tienes, Debes"/);
  assert.equal(stackedBarHtml([{ fam: "casa", value: 0, name: "Casa" }]), "");
  assert.equal(decl(".sbar-24", "height"), "24px");
  assert.equal(decl(".sbar-8", "height"), "8px");
});

// ---- Medidor ---------------------------------------------------------------------------------

test("meterHtml: relleno proporcional en -b de su familia, acotado a 0..100 % y sin NaN", () => {
  assert.match(meterHtml({ fam: "casa", value: 50, max: 200 }), /<span class="meter-fill fam-casa" style="width:25%">/);
  assert.match(meterHtml({ fam: "casa", value: 500, max: 200 }), /width:100%/);
  assert.match(meterHtml({ fam: "casa", value: 5, max: 0 }), /width:0%/);
  assert.equal(decl(".meter-fill", "background"), "var(--fb)");
  assert.equal(decl(".meter", "height"), "8px");
});

test("meterHtml: con límite pinta la marca en su sitio; dentro del Display la pista es --disp-line", () => {
  const html = meterHtml({ value: 1141.71, max: 1700, limit: 736, onDisplay: true });
  assert.match(html, /^<div class="meter meter-on-disp"/);
  assert.match(html, /<span class="meter-limit" style="--at:43\.29%"><\/span>/);
  assert.equal(decl(".meter-on-disp", "background"), "var(--disp-line)");
  assert.equal(decl(".meter-on-disp .meter-limit", "background"), "var(--disp-ink)");
  assert.equal(decl(".meter-limit", "background"), "var(--text)");
  assert.equal(decl(".meter-limit", "width"), "2px");
  // Sin familia, en el Display el relleno es la línea del Display (ámbar, C2); fuera, --idle.
  assert.match(html, /meter-fill disp-chart-line/);
  assert.match(meterHtml({ value: 1, max: 2 }), /meter-fill is-idle/);
});

test("meterHtml: sobre tinte la pista es --chip; por defecto --well; sin límite no hay marca", () => {
  const html = meterHtml({ fam: "ali", value: 1, max: 2, onTint: true });
  assert.match(html, /class="meter meter-on-tint"/);
  assert.doesNotMatch(html, /meter-limit/);
  assert.equal(decl(".meter-on-tint", "background"), "var(--chip)");
  assert.equal(decl(".meter", "background"), "var(--well)");
});

test("meterHtml: con label es un role=meter con sus valores; sin él, decorativo", () => {
  assert.match(meterHtml({ fam: "sal", value: 30, max: 60, label: "Salud" }),
    /role="meter" aria-label="Salud" aria-valuemin="0" aria-valuemax="60" aria-valuenow="30"/);
  assert.match(meterHtml({ fam: "sal", value: 30, max: 60 }), /aria-hidden="true"/);
});

// ---- Columnas --------------------------------------------------------------------------------

const SEMANA = ["L", "M", "X", "J", "V", "S", "D"].map((label, i) => ({ label, value: [10, 24, 8, 28, 18, 19, 52][i] }));

test("columnsHtml: una columna por día; hoy en tinta con su cifra encima, el resto en --idle", () => {
  const days = SEMANA.map((d, i) => (i === 6 ? { ...d, today: true, amount: "168,90", name: "Domingo 13" } : d));
  const html = columnsHtml(days, { label: "Esta semana" });
  assert.equal(count(html, /class="col-bar"/g), 7);
  assert.equal(count(html, /class="col is-today"/g), 1);
  assert.match(html, /<span class="num col-amt" aria-hidden="true">168,90<\/span>/);
  assert.match(html, /aria-label="Domingo 13 168,90"/);
  assert.match(html, /<span class="is-today">D<\/span>/);
  assert.match(html, /style="--n:7"/);
  assert.equal(decl(".col-bar", "background"), "var(--idle)");
  assert.equal(decl(".col.is-today .col-bar", "background"), "var(--text)");
  assert.equal(decl(".col-bar", "border-radius"), "var(--radius-xs) var(--radius-xs) 0 0");
});

test("columnsHtml: hoy puede ir en la barra de su familia; alturas relativas al máximo", () => {
  const html = columnsHtml([{ label: "a", value: 50 }, { label: "b", value: 100, today: true, fam: "oci" }, { label: "c", value: 0 }]);
  assert.match(html, /class="col is-today has-fam fam-oci"/);
  const hs = [...html.matchAll(/style="height:(\d+)%"/g)].map((m) => Number(m[1]));
  assert.deepEqual(hs, [38, 76, 0]);
  assert.equal(decl(".col.is-today.has-fam .col-bar", "background"), "var(--fb)");
  assert.equal(columnsHtml([]), "");
});

test("columnsHtml: apiladas por familia, el mayor abajo, con los nombres en el aria-label (C12)", () => {
  const html = columnsHtml([
    { label: "L", value: 30, segments: [{ fam: "rop", value: 20, name: "Ropa" }, { fam: "res", value: 10, name: "Restauración" }], selected: true, amount: "30,00", name: "Lunes 7" },
    { label: "M", value: 0, segments: [] },
  ], { labels: false });
  assert.equal(count(html, /class="col-bar"/g), 0);
  assert.equal(count(html, /class="col-stack"/g), 2);
  // Orden ascendente de arriba abajo: Restauración (10) arriba, Ropa (20) abajo.
  assert.match(html, /col-seg fam-res" style="flex-basis:33\.333%"><\/span><span class="col-seg fam-rop" style="flex-basis:66\.667%"/);
  assert.match(html, /class="col is-selected"/);
  assert.match(html, /aria-label="Lunes 7 30,00 Ropa, Restauración"/);
  assert.match(html, /<span class="col-stack" style="height:0%"><\/span>/);
  assert.doesNotMatch(html, /cols-labels/);
  assert.equal(decl(".col-seg", "background"), "var(--fb)");
  assert.equal(decl(".col.is-selected", "background"), "var(--well)");
  assert.throws(() => columnsHtml([{ label: "L", value: 1, segments: [{ fam: "ali", value: 1, name: "" }] }]), /C12/);
  // Sin segments, la columna de siempre y la fila de iniciales por defecto.
  assert.match(columnsHtml([{ label: "L", value: 1 }]), /cols-labels/);
});

// ---- Estado vacío ----------------------------------------------------------------------------

test("emptyStateHtml: filas fantasma decorativas, título y una línea; flecha opcional", () => {
  const html = emptyStateHtml({ title: "Aún no hay movimientos", text: "El primer gasto se apunta con el botón de abajo.", arrow: true });
  assert.equal(count(html, /class="ghost-row[ "]/g), 2);
  assert.match(html, /class="ghost-rows" aria-hidden="true"/);
  assert.match(html, /<span class="empty-title">Aún no hay movimientos<\/span>/);
  assert.match(html, /class="empty-arrow"/);
  assert.doesNotMatch(emptyStateHtml({ title: "x", rows: 0 }), /ghost-rows|empty-arrow|empty-text/);
  assert.equal(decl(".ghost", "background"), "var(--well)");
  assert.equal(decl(".empty-title", "font-size"), "var(--fs-15)");
});

// ---- Todo el módulo --------------------------------------------------------------------------

test("instrument.js: ningún color en el HTML; en línea solo geometría", () => {
  const all = [
    displayHtml({ label: "a", value: "1", led: { state: "wait", text: "1 pendiente" } }),
    bentoHtml({ label: "a", value: "1", fam: "casa" }), stackedBarHtml(SEGS), meterHtml({ fam: "casa", value: 1, max: 2, limit: 1 }),
    columnsHtml(SEMANA), emptyStateHtml({ title: "a", arrow: true }),
  ].join("");
  assert.doesNotMatch(all, /#[0-9a-f]{3,8}\b|rgba?\(|var\(--/i);
  for (const m of all.matchAll(/style="([^"]*)"/g)) assert.match(m[1], /^(--[a-z]+|width|height|flex-basis):[^;]+$/);
});
