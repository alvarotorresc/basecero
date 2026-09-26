// Controles canónicos del sistema B (DESIGN.md §9, PR-06). Módulos PUROS: se prueban sin Worker ni
// DOM, igual que ui.test.mjs. wireSegmented es la única pieza impura; se prueba con un DOM de
// mentira (objetos planos con setAttribute/getAttribute/focus/onclick/onkeydown) para no arrastrar
// jsdom solo por esto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentedHtml, wireSegmented, switchHtml, checkboxHtml, stepperHtml, stepsHtml, fieldHtml, neutralChipHtml } from "../../app/app/js/controls.js";

// ---------- segmentedHtml ----------

test("segmentedHtml: radiogroup con un radio por opción y aria-label del grupo", () => {
  const html = segmentedHtml({ name: "Tema", options: [{ value: "light", label: "Claro" }, { value: "dark", label: "Oscuro" }], value: "dark" });
  assert.match(html, /role="radiogroup"/);
  assert.match(html, /aria-label="Tema"/);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 2);
});

test("segmentedHtml: un único aria-checked=\"true\", en la opción de value, con tabindex=0; el resto -1", () => {
  const html = segmentedHtml({ name: "Tema", options: [{ value: "light", label: "Claro" }, { value: "dark", label: "Oscuro" }, { value: "system", label: "Sistema" }], value: "dark" });
  const radios = [...html.matchAll(/<button [^>]*>([^<]*)</g)];
  assert.equal(radios.length, 3);
  const marcados = radios.filter((m) => /aria-checked="true"/.test(m[0]));
  assert.equal(marcados.length, 1);
  assert.match(marcados[0][0], /data-value="dark"/);
  assert.match(marcados[0][0], /tabindex="0"/);
  assert.equal(radios.filter((m) => /tabindex="-1"/.test(m[0])).length, 2);
});

test("segmentedHtml: un value que no casa con ninguna opción cae a la primera (si no, nada sería tabulable)", () => {
  const html = segmentedHtml({ name: "Tema", options: [{ value: "light", label: "Claro" }, { value: "dark", label: "Oscuro" }], value: "sepia" });
  assert.match(html, /aria-checked="true"[^>]*data-value="light"/);
});

test("segmentedHtml: escapa el nombre del grupo y la etiqueta de cada opción", () => {
  const html = segmentedHtml({ name: "A & B", options: [{ value: "x", label: "<b>Ítem</b>" }], value: "x" });
  assert.match(html, /aria-label="A &amp; B"/);
  assert.match(html, /&lt;b&gt;Ítem&lt;\/b&gt;/);
  assert.ok(!html.includes("<b>Ítem</b>"));
});

test("segmentedHtml: con id, lo pone en el contenedor; sin id, no lo pone", () => {
  assert.match(segmentedHtml({ id: "theme-seg", name: "Tema", options: [{ value: "x", label: "X" }], value: "x" }), /id="theme-seg"/);
  assert.ok(!segmentedHtml({ name: "Tema", options: [{ value: "x", label: "X" }], value: "x" }).includes("id="));
});

test("segmentedHtml: sin labelledBy, aria-label (comportamiento por defecto)", () => {
  const html = segmentedHtml({ name: "Tema", options: [{ value: "x", label: "X" }], value: "x" });
  assert.match(html, /aria-label="Tema"/);
  assert.ok(!html.includes("aria-labelledby"));
});

test("segmentedHtml: con labelledBy, aria-labelledby en vez de aria-label (asocia con la etiqueta visible)", () => {
  const html = segmentedHtml({ name: "Tema", labelledBy: "theme-label", options: [{ value: "x", label: "X" }], value: "x" });
  assert.match(html, /aria-labelledby="theme-label"/);
  assert.ok(!html.includes("aria-label="), "no debe salir aria-label a la vez que aria-labelledby");
});

test("segmentedHtml: labelledBy se escapa", () => {
  assert.match(segmentedHtml({ name: "Tema", labelledBy: 'a"b', options: [{ value: "x", label: "X" }], value: "x" }), /aria-labelledby="a&quot;b"/);
});

// ---------- wireSegmented ----------

function fakeSegmented(values, selected = values[0]) {
  const radios = values.map((v) => {
    const attrs = { "aria-checked": String(v === selected) };
    return {
      dataset: { value: v },
      tabIndex: v === selected ? 0 : -1,
      focused: false,
      onclick: null,
      onkeydown: null,
      setAttribute(k, val) { attrs[k] = String(val); },
      getAttribute(k) { return attrs[k]; },
      focus() { this.focused = true; },
    };
  });
  return { root: { querySelectorAll: () => radios }, radios };
}

test("wireSegmented: pulsar un radio lo marca, desmarca el resto y llama a onChange con su value", () => {
  const { root, radios } = fakeSegmented(["light", "dark", "system"]);
  const changes = [];
  wireSegmented(root, (v) => changes.push(v));
  radios[1].onclick();
  assert.equal(radios[0].getAttribute("aria-checked"), "false");
  assert.equal(radios[1].getAttribute("aria-checked"), "true");
  assert.equal(radios[2].getAttribute("aria-checked"), "false");
  assert.equal(radios[1].tabIndex, 0);
  assert.equal(radios[0].tabIndex, -1);
  assert.deepEqual(changes, ["dark"]);
});

test("wireSegmented: ArrowRight mueve del elegido al siguiente, con vuelta, y le da foco", () => {
  const { root, radios } = fakeSegmented(["light", "dark", "system"], "system");
  const changes = [];
  wireSegmented(root, (v) => changes.push(v));
  let prevented = false;
  radios[2].onkeydown({ key: "ArrowRight", preventDefault: () => { prevented = true; } });
  assert.ok(prevented, "preventDefault se llama para que la flecha no desplace la página");
  assert.equal(radios[0].getAttribute("aria-checked"), "true");
  assert.ok(radios[0].focused);
  assert.deepEqual(changes, ["light"]);
});

test("wireSegmented: una tecla que no mueve (Tab) no llama a onChange", () => {
  const { root, radios } = fakeSegmented(["light", "dark"]);
  const changes = [];
  wireSegmented(root, (v) => changes.push(v));
  radios[0].onkeydown({ key: "Tab", preventDefault: () => assert.fail("no debería llamarse") });
  assert.deepEqual(changes, []);
});

// ---------- switchHtml ----------

test("switchHtml: role=switch, aria-checked y aria-label reflejan checked/label; el id se respeta", () => {
  const on = switchHtml({ id: "sw-1", checked: true, label: "Registro rápido" });
  assert.match(on, /role="switch"/);
  assert.match(on, /id="sw-1"/);
  assert.match(on, /aria-checked="true"/);
  assert.match(on, /aria-label="Registro rápido"/);
  const off = switchHtml({ id: "sw-1", checked: false, label: "Registro rápido" });
  assert.match(off, /aria-checked="false"/);
});

test("switchHtml: escapa el label", () => {
  assert.match(switchHtml({ id: "x", checked: false, label: "A & B" }), /aria-label="A &amp; B"/);
});

// El dibujo se queda en 44×26 (§9); components.css amplía el área de toque real a 44×44 (§11, K10)
// con un ::before invisible colgado de esta misma clase, sin tocar el marcado. Este test es la red
// de seguridad: si alguna vez se renombra "ctl-switch" aquí sin tocar la regla CSS, el hit area
// vuelve a quedarse en 44×26 en silencio.
test("switchHtml: mantiene la clase ctl-switch (de ella cuelga el ::before que amplía el área de toque a 44×44)", () => {
  assert.match(switchHtml({ id: "x", checked: false, label: "X" }), /class="ctl-switch"/);
});

// ---------- checkboxHtml ----------

test("checkboxHtml: role=checkbox, aria-checked y aria-label reflejan checked/label", () => {
  const on = checkboxHtml({ id: "cb-1", checked: true, label: "Incluir Mercadona en la liquidación" });
  assert.match(on, /role="checkbox"/);
  assert.match(on, /aria-checked="true"/);
  assert.match(on, /aria-label="Incluir Mercadona en la liquidación"/);
  const off = checkboxHtml({ id: "cb-1", checked: false, label: "Incluir Mercadona en la liquidación" });
  assert.match(off, /aria-checked="false"/);
});

test("checkboxHtml: el check solo se pinta cuando checked es true", () => {
  const on = checkboxHtml({ id: "cb-1", checked: true, label: "X" });
  assert.match(on, /<svg/);
  assert.match(on, /stroke-width="2.6"/);
  const off = checkboxHtml({ id: "cb-1", checked: false, label: "X" });
  assert.ok(!off.includes("<svg"));
});

// ---------- stepperHtml ----------

test("stepperHtml: el valor se refleja (escapado) y cada tecla lleva su aria-label", () => {
  const html = stepperHtml({ value: "3", decLabel: "Un mes menos", incLabel: "Un mes más" });
  assert.match(html, />3</);
  assert.match(html, /aria-label="Un mes menos"/);
  assert.match(html, /aria-label="Un mes más"/);
});

test("stepperHtml: decId/incId, si llegan, se ponen en su botón", () => {
  const html = stepperHtml({ value: "50 %", decId: "pct-down", incId: "pct-up", decLabel: "Menos", incLabel: "Más" });
  assert.match(html, /id="pct-down"/);
  assert.match(html, /id="pct-up"/);
});

test("stepperHtml: escapa el valor", () => {
  assert.match(stepperHtml({ value: "<b>3</b>", decLabel: "-", incLabel: "+" }), /&lt;b&gt;3&lt;\/b&gt;/);
});

// ---------- stepsHtml ----------

test("stepsHtml: tantos segmentos como total, y tantos .is-done como current", () => {
  const html = stepsHtml({ total: 4, current: 2 });
  assert.equal((html.match(/ctl-steps-seg/g) ?? []).length, 4);
  assert.equal((html.match(/is-done/g) ?? []).length, 2);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuemin="1"/);
  assert.match(html, /aria-valuemax="4"/);
  assert.match(html, /aria-valuenow="2"/);
});

test("stepsHtml: current se acota a [1, total]", () => {
  assert.match(stepsHtml({ total: 4, current: 99 }), /aria-valuenow="4"/);
  assert.equal((stepsHtml({ total: 4, current: 99 }).match(/is-done/g) ?? []).length, 4);
  assert.match(stepsHtml({ total: 4, current: 0 }), /aria-valuenow="1"/);
  assert.equal((stepsHtml({ total: 4, current: 0 }).match(/is-done/g) ?? []).length, 1);
});

test("stepsHtml: ariaLabel opcional, ya traducido, se refleja; sin él no se pinta aria-label", () => {
  assert.match(stepsHtml({ total: 4, current: 1, ariaLabel: "Paso 1 de 4" }), /aria-label="Paso 1 de 4"/);
  assert.ok(!stepsHtml({ total: 4, current: 1 }).includes("aria-label"));
});

test("stepsHtml con labels: lista ordenada con una etiqueta escapada por paso y aria-current en el actual", () => {
  const html = stepsHtml({ total: 3, current: 2, ariaLabel: "Pasos", labels: ["Fichero", "Columnas", "<b>Resultado</b>"] });
  assert.match(html, /^<ol class="ctl-steps ctl-steps-labelled" aria-label="Pasos">/);
  assert.equal((html.match(/<li /g) ?? []).length, 3);
  assert.equal((html.match(/ctl-steps-seg/g) ?? []).length, 3);
  assert.equal((html.match(/is-done/g) ?? []).length, 2);
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  assert.match(html, /aria-current="step"><span[^>]*><\/span><span class="ctl-steps-label">Columnas/);
  assert.ok(!html.includes("<b>"));
  assert.match(html, /&lt;b&gt;Resultado/);
  assert.ok(!html.includes("progressbar"));
});

test("stepsHtml con labels: current también se acota a [1, total]", () => {
  const html = stepsHtml({ total: 3, current: 9, labels: ["A", "B", "C"] });
  assert.equal((html.match(/is-done/g) ?? []).length, 3);
  assert.match(html, /aria-current="step"><span[^>]*><\/span><span class="ctl-steps-label">C<\/span><\/li><\/ol>$/);
});

// ---------- fieldHtml ----------

test("fieldHtml: label-for/id emparejan, type y value se reflejan", () => {
  const html = fieldHtml({ id: "flt-desde", label: "Desde", type: "text", value: "10,00" });
  assert.match(html, /for="flt-desde"/);
  assert.match(html, /id="flt-desde"/);
  assert.match(html, /type="text"/);
  assert.match(html, /value="10,00"/);
  assert.match(html, /Desde/);
});

test("fieldHtml: type por defecto \"text\" y value por defecto vacío", () => {
  const html = fieldHtml({ id: "x", label: "X" });
  assert.match(html, /type="text"/);
  assert.match(html, /value=""/);
});

test("fieldHtml: escapa label y value", () => {
  const html = fieldHtml({ id: "x", label: "A & B", value: '10"' });
  assert.match(html, /A &amp; B/);
  assert.match(html, /value="10&quot;"/);
});

test("fieldHtml: sin opcionales no emite inputmode, placeholder, is-num ni sufijo", () => {
  const html = fieldHtml({ id: "x", label: "X" });
  assert.doesNotMatch(html, /inputmode|placeholder|is-num|ctl-field-suffix/);
});

test("fieldHtml: inputmode, placeholder (escapado), cifra mono y sufijo dentro del pozo", () => {
  const html = fieldHtml({ id: "x", label: "Saldo", inputmode: "decimal", placeholder: 'p. ej. "0"', num: true, suffix: "€" });
  assert.match(html, /inputmode="decimal"/);
  assert.match(html, /placeholder="p\. ej\. &quot;0&quot;"/);
  assert.match(html, /class="ctl-field-input is-num"/);
  assert.match(html, /<span class="ctl-field-suffix" aria-hidden="true">€<\/span><\/span>/);
});

// ---------- neutralChipHtml ----------

test("neutralChipHtml: pinta el label escapado", () => {
  const html = neutralChipHtml({ label: "Viaje <a> Japón" });
  assert.match(html, /class="ctl-chip"/);
  assert.match(html, /Viaje &lt;a&gt; Japón/);
});

test("neutralChipHtml: tag:true añade is-tag y el icono de etiqueta; sin tag, ninguno de los dos", () => {
  const tag = neutralChipHtml({ label: "Viaje a Japón", tag: true });
  assert.match(tag, /class="ctl-chip is-tag"/);
  assert.match(tag, /<svg/);
  const plain = neutralChipHtml({ label: "Alimentación" });
  assert.ok(!plain.includes("is-tag"));
  assert.ok(!plain.includes("<svg"));
});

test("neutralChipHtml: con id lo pone en el botón", () => {
  assert.match(neutralChipHtml({ id: "chip-viaje", label: "Viaje" }), /id="chip-viaje"/);
});

test("segmentedHtml: una opción con `fam` lleva la muestra de su familia; sin fam o desconocida, ninguna", () => {
  const html = segmentedHtml({ name: "Cuenta", value: "a", options: [
    { value: "a", label: "Corriente", fam: "tra" }, { value: "b", label: "Ahorro" }, { value: "c", label: "Rara", fam: "zzz" },
  ] });
  assert.equal((html.match(/ctl-seg-muestra/g) ?? []).length, 1);
  assert.match(html, /<span class="ctl-seg-muestra fam-tra" aria-hidden="true"><\/span><span class="ctl-seg-text">Corriente<\/span>/);
});
