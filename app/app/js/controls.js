/** Controles canónicos del sistema B (DESIGN.md §9): Segmented, interruptor, casilla, paso a paso,
 *  progreso por pasos, campo hundido y chip neutro. Mismo patrón que ui.js: funciones PURAS que
 *  devuelven HTML — sin DOM, sin i18n propio (toda etiqueta llega YA TRADUCIDA desde la pantalla,
 *  como los `segments` de metaHtml). Solo importan icons.js, esc.js y, para las flechas del
 *  Segmented, `radioKeyIndex` de ui.js (se IMPORTA, no se toca: la lógica de flechas del radiogroup
 *  ya vivía ahí y no hay motivo para duplicarla).
 *
 *  `wireSegmented` es la única pieza impura del módulo — cablea un Segmented ya montado en el DOM —
 *  y por eso vive fuera de las funciones puras, igual que el cableado de un modal vive fuera de
 *  modal.js. Interruptor y casilla no traen su propio «wire»: son botones sueltos que cada pantalla
 *  cablea con un onclick tan simple como el que ya tenía (ver ajustes.js#pref-quick-register), y
 *  meterles un helper aquí sería inventar cableado que el brief no pide. */
import { icon } from "./icons.js";
import { escHtml, escAttr } from "./esc.js";
import { radioKeyIndex } from "./ui.js";
import { famClass } from "./category-colors.js";

/** Segmented (§9): pozo píldora con relleno 4 y `--sh-well`; ítems de 44, 14/600 dim; el activo va
 *  en `--raised` + `--sh-thumb` y 700 — NUNCA naranja (C1, K3). `options`: `[{value, label}]` con
 *  `label` YA TRADUCIDO. Si `value` no casa con ninguna opción cae a la primera: si no, ningún
 *  ítem sería tabulable (tabindex itinerante, K12) y el grupo quedaría inalcanzable por teclado.
 *  `id`, opcional, es el gancho que usa `wireSegmented` para encontrar el grupo ya montado.
 *
 *  Nombre accesible del radiogroup: por defecto `aria-label="${name}"`. Si la pantalla ya pinta una
 *  etiqueta VISIBLE al lado del control (como el «Tema» de Ajustes), pásale `labelledBy` con el id
 *  de ese elemento — entonces sale `aria-labelledby` en vez de `aria-label`, así el grupo se asocia
 *  con el texto que el usuario ya ve en vez de duplicarlo (mismo patrón que el `theme-label` de la
 *  vieja `themeSegmentedHtml` de ui.js). `name` sigue siendo obligatorio: es el aria-label de
 *  respaldo cuando no hay `labelledBy`.
 *
 *  Cada opción admite `fam` (clave de familia, category-colors.js): pinta delante del texto la
 *  muestra de 10 en la barra de esa familia (--fb), como las cuentas de B-Liquidar. Sin `fam` o con
 *  una clave desconocida, sin muestra. */
export function segmentedHtml({ id = "", name, labelledBy = "", options, value }) {
  const sel = options.some((o) => o.value === value) ? value : options[0]?.value;
  const items = options.map((o) => {
    const on = o.value === sel;
    // Muestra de 10 en la barra de la familia (B-Liquidar «Entra en»: la cuenta con su familia, C8).
    const fc = o.fam ? famClass(o.fam) : "";
    const swatch = fc ? `<span class="ctl-seg-muestra ${fc}" aria-hidden="true"></span>` : "";
    return `<button type="button" role="radio" aria-checked="${on}" tabindex="${on ? "0" : "-1"}" data-value="${escAttr(o.value)}">${swatch ? `${swatch}<span class="ctl-seg-text">${escHtml(o.label)}</span>` : escHtml(o.label)}</button>`;
  }).join("");
  const labelAttr = labelledBy ? `aria-labelledby="${escAttr(labelledBy)}"` : `aria-label="${escAttr(name)}"`;
  return `<div class="ctl-segmented"${id ? ` id="${escAttr(id)}"` : ""} role="radiogroup" ${labelAttr}>${items}</div>`;
}

/** Cablea un Segmented ya en el DOM: pulsar o mover con las flechas (Inicio/Fin incluidos, WAI-ARIA
 *  radiogroup) elige, actualiza `aria-checked` y el tabindex itinerante de todo el grupo, mueve el
 *  foco y llama a `onChange(value)`. `root` es el elemento `.ctl-segmented` que devuelve
 *  `segmentedHtml` (p.ej. `container.querySelector("#theme-seg")`). Impuro a propósito: toca el DOM
 *  que le pasan, nunca `document`/`window` directamente. */
export function wireSegmented(root, onChange) {
  const radios = [...root.querySelectorAll('[role="radio"]')];
  const choose = (btn) => {
    for (const r of radios) {
      const on = r === btn;
      r.setAttribute("aria-checked", String(on));
      r.tabIndex = on ? 0 : -1;
    }
    onChange(btn.dataset.value);
  };
  for (const r of radios) {
    r.onclick = () => choose(r);
    r.onkeydown = (e) => {
      const i = radioKeyIndex(e.key, radios.indexOf(r), radios.length);
      if (i < 0) return;
      e.preventDefault();
      choose(radios[i]);
      radios[i].focus();
    };
  }
}

/** Interruptor (§9): 44×26 con pomo de 20. Apagado: pista `--well` + `--sh-well`, pomo `--idle`.
 *  Encendido: pista `--text`, pomo `--raised` — tinta, nunca naranja (F-04, K3). Componente mínimo:
 *  sin icono ni etiqueta visible (eso es la «Fila de ajuste» que lo envuelve, de otra PR); `label`
 *  es su aria-label. */
export function switchHtml({ id, checked, label }) {
  return `<button type="button" class="ctl-switch" id="${escAttr(id)}" role="switch" aria-checked="${checked ? "true" : "false"}" aria-label="${escAttr(label)}">
    <span class="ctl-switch-knob"></span>
  </button>`;
}

/** Casilla (§9): 24 de radio 7 dentro de un área de toque de 44 (K10). Marcada: `--text` con el
 *  check en `--raised`. Vacía: `--raised` con borde interior `--idle` (F-22) — tinta, nunca naranja
 *  (F-05, K3). `label` es su aria-label completo (p.ej. «Incluir Mercadona en la liquidación», como
 *  en B-Liquidar), no una etiqueta corta: el botón no lleva texto visible propio. */
export function checkboxHtml({ id, checked, label }) {
  const mark = checked ? icon("check", { size: 16, width: 2.6 }) : "";
  return `<button type="button" class="ctl-checkbox" id="${escAttr(id)}" role="checkbox" aria-checked="${checked ? "true" : "false"}" aria-label="${escAttr(label)}">
    <span class="ctl-checkbox-box">${mark}</span>
  </button>`;
}

/** Paso a paso (§9): pozo píldora con relleno 4, teclas de 44 en `--raised` + `--sh-thumb`, valor
 *  mono 17/600. `value` llega YA FORMATEADO por la pantalla (p.ej. «3» o «50 %»); `decLabel`/
 *  `incLabel` son los aria-label de cada tecla, ya traducidos («Un mes menos» / «Un mes más»).
 *  `id`/`decId`/`incId` son ganchos de cableado opcionales, igual que el `id` de `subHeaderHtml`. */
export function stepperHtml({ id = "", value, decId = "", incId = "", decLabel, incLabel }) {
  return `<div class="ctl-stepper"${id ? ` id="${escAttr(id)}"` : ""}>
    <button type="button" class="ctl-stepper-btn"${decId ? ` id="${escAttr(decId)}"` : ""} aria-label="${escAttr(decLabel)}">${icon("minus", { size: 18 })}</button>
    <span class="ctl-stepper-value">${escHtml(value)}</span>
    <button type="button" class="ctl-stepper-btn"${incId ? ` id="${escAttr(incId)}"` : ""} aria-label="${escAttr(incLabel)}">${icon("plus", { size: 18 })}</button>
  </div>`;
}

/** Progreso por pasos (§9): segmentos de 6 en píldora; hecho y actual en `--text`, pendiente en el
 *  pozo (I-35/F-27). `current` se acota a `[1, total]` — un valor fuera de rango no debe dejar el
 *  progressbar sin segmentos marcados ni con más de `total`. `ariaLabel`, si llega, ya viene
 *  traducido («Paso 1 de 4»); sin él, `aria-valuemin`/`max`/`now` bastan para anunciarlo. */
export function stepsHtml({ total, current, ariaLabel = "" }) {
  const cur = Math.min(Math.max(current, 1), total);
  const segs = Array.from({ length: total }, (_, i) => `<span class="ctl-steps-seg${i < cur ? " is-done" : ""}"></span>`).join("");
  return `<div class="ctl-steps" role="progressbar" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="${cur}"${ariaLabel ? ` aria-label="${escAttr(ariaLabel)}"` : ""}>${segs}</div>`;
}

/** Campo hundido (§9): 48 de alto, `--well` + `--sh-well`, radio 10, input de 16 (`--fs-input`,
 *  evita el zoom de iOS: K9) y etiqueta 13/600 dim encima. `type` por defecto "text"; `value` ya
 *  viene formateado por la pantalla. Opcionales (S3, formularios de Patrimonio): `inputmode`
 *  («decimal» en importes), `placeholder` (ya traducido), `num` (cifra en mono tabular) y `suffix`,
 *  la unidad 15/600 dim a la derecha dentro del pozo («€», «%»). `min` y `step` (S7, límite de
 *  Gasto por categoría) para inputs numéricos. Sin ellos, el marcado es el de siempre. */
export function fieldHtml({ id, label, type = "text", value = "", inputmode = "", placeholder = "", num = false, suffix = "", min = "", step = "" }) {
  const extra = `${inputmode ? ` inputmode="${escAttr(inputmode)}"` : ""}${placeholder ? ` placeholder="${escAttr(placeholder)}"` : ""}`
    + `${min !== "" ? ` min="${escAttr(min)}"` : ""}${step !== "" ? ` step="${escAttr(step)}"` : ""}`;
  return `<label class="ctl-field-wrap" for="${escAttr(id)}">
    <span class="ctl-field-label">${escHtml(label)}</span>
    <span class="ctl-field"><input class="ctl-field-input${num ? " is-num" : ""}" id="${escAttr(id)}" type="${escAttr(type)}" value="${escAttr(value)}"${extra}>${suffix ? `<span class="ctl-field-suffix" aria-hidden="true">${escHtml(suffix)}</span>` : ""}</span>
  </label>`;
}

/** Chip neutro (§9): 44 píldora, `--raised`, 14/500 — subcategoría o etiqueta, nunca color propio
 *  (eso es el chip de filtro con tinte de familia, de otra PR). Con `tag:true` añade borde e icono
 *  de etiqueta, como en B-Movimientos-Filtros. */
export function neutralChipHtml({ id = "", label, tag = false }) {
  return `<button type="button" class="ctl-chip${tag ? " is-tag" : ""}"${id ? ` id="${escAttr(id)}"` : ""}>${tag ? icon("tag", { size: 16 }) : ""}${escHtml(label)}</button>`;
}
