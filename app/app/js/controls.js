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
 *  con el texto que el usuario ya ve en vez de duplicarlo. `name` sigue siendo obligatorio: es el aria-label de
 *  respaldo cuando no hay `labelledBy`.
 *
 *  Cada opción admite `fam` (clave de familia, category-colors.js): pinta delante del texto la
 *  muestra de 10 en la barra de esa familia (--fb), como las cuentas de B-Liquidar. Sin `fam` o con
 *  una clave desconocida, sin muestra.
 *  Y `count` (S10, B-Categorias «Gasto 12 · Ingreso 3»): una cifra mono 500 dim detrás del texto;
 *  el nombre accesible del radio la incluye tal cual («Gasto 12»). */
export function segmentedHtml({ id = "", name, labelledBy = "", options, value, allowNone = false }) {
  // allowNone (Crear gasto, S2): el valor activo puede vivir FUERA del grupo (devolución o ajuste,
  // que se eligen debajo). Entonces ningún radio va marcado —marcar el primero mentiría— y la
  // primera opción sigue siendo la tabulable, para que el grupo no quede fuera del teclado (K12).
  const matches = options.some((o) => o.value === value);
  const none = allowNone && !matches;
  const sel = matches ? value : options[0]?.value;
  const items = options.map((o, i) => {
    const on = !none && o.value === sel;
    const tab = none ? i === 0 : on;
    // Muestra de 10 en la barra de la familia (B-Liquidar «Entra en»: la cuenta con su familia, C8).
    const fc = o.fam ? famClass(o.fam) : "";
    const swatch = fc ? `<span class="ctl-seg-muestra ${fc}" aria-hidden="true"></span>` : "";
    const count = o.count !== undefined && o.count !== null && o.count !== "" ? ` <span class="ctl-seg-count num">${escHtml(o.count)}</span>` : "";
    return `<button type="button" role="radio" aria-checked="${on}" tabindex="${tab ? "0" : "-1"}" data-value="${escAttr(o.value)}">${swatch ? `${swatch}<span class="ctl-seg-text">${escHtml(o.label)}</span>` : escHtml(o.label)}${count}</button>`;
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
 *  Encendido: pista `--text`, pomo `--raised`. Componente mínimo: sin icono ni etiqueta visible (eso
 *  es la «Fila de ajuste» que lo envuelve); `label` es su aria-label.
 *  `accent` (por defecto false): encendido en naranja (`--accent`, pomo `--raised`), como el
 *  interruptor de B-Movimientos-Filtros (F-04 retirada, Álvaro 2026-09-27: igual que el mockup).
 *  Apagado se ve igual con o sin `accent`. */
export function switchHtml({ id, checked, label, accent = false }) {
  return `<button type="button" class="ctl-switch${accent ? " is-accent" : ""}" id="${escAttr(id)}" role="switch" aria-checked="${checked ? "true" : "false"}" aria-label="${escAttr(label)}">
    <span class="ctl-switch-knob"></span>
  </button>`;
}

/** Casilla (§9): 24 de radio 7 dentro de un área de toque de 44 (K10). Marcada: `--text` con el
 *  check en `--raised`. Vacía: `--raised` con borde interior `--idle` (F-22). `label` es su
 *  aria-label completo (p.ej. «Incluir Mercadona en la liquidación», como en B-Liquidar), no una
 *  etiqueta corta: el botón no lleva texto visible propio.
 *  `accent` (por defecto false): marcada en naranja (`--accent` con el check en `--on-accent`), como
 *  las casillas de B-Liquidar (F-05 retirada, Álvaro 2026-09-27: igual que el mockup). La de
 *  B-Onb-Categorias va en tinta: ahí, sin `accent`. */
export function checkboxHtml({ id, checked, label, accent = false }) {
  const mark = checked ? icon("check", { size: 16, width: 2.6 }) : "";
  return `<button type="button" class="ctl-checkbox${accent ? " is-accent" : ""}" id="${escAttr(id)}" role="checkbox" aria-checked="${checked ? "true" : "false"}" aria-label="${escAttr(label)}">
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
 *  traducido («Paso 1 de 4»); sin él, `aria-valuemin`/`max`/`now` bastan para anunciarlo.
 *  Con `labels` (S12, B-Importar: un texto por paso, ya traducido) es una lista ordenada: cada
 *  paso es su segmento con la etiqueta 12/600 dim debajo, y el actual lleva `aria-current="step"`
 *  y la etiqueta en --text 700. */
export function stepsHtml({ total, current, ariaLabel = "", labels = null }) {
  const cur = Math.min(Math.max(current, 1), total);
  if (Array.isArray(labels)) {
    const items = Array.from({ length: total }, (_, i) => `<li class="ctl-steps-step"${i + 1 === cur ? ' aria-current="step"' : ""}>`
      + `<span class="ctl-steps-seg${i < cur ? " is-done" : ""}" aria-hidden="true"></span>`
      + `<span class="ctl-steps-label">${escHtml(labels[i] ?? "")}</span></li>`).join("");
    return `<ol class="ctl-steps ctl-steps-labelled"${ariaLabel ? ` aria-label="${escAttr(ariaLabel)}"` : ""}>${items}</ol>`;
  }
  const segs = Array.from({ length: total }, (_, i) => `<span class="ctl-steps-seg${i < cur ? " is-done" : ""}"></span>`).join("");
  return `<div class="ctl-steps" role="progressbar" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="${cur}"${ariaLabel ? ` aria-label="${escAttr(ariaLabel)}"` : ""}>${segs}</div>`;
}

/** Campo hundido (§9): 48 de alto, `--well` + `--sh-well`, radio 10, input de 16 (`--fs-input`,
 *  evita el zoom de iOS: K9) y etiqueta 13/600 dim encima. `type` por defecto "text"; `value` ya
 *  viene formateado por la pantalla. Opcionales (S3, formularios de Patrimonio): `inputmode`
 *  («decimal» en importes), `placeholder` (ya traducido), `num` (cifra en mono tabular) y `suffix`,
 *  la unidad 15/600 dim a la derecha dentro del pozo («€», «%»). `min` y `step` (S7, límite de
 *  Gasto por categoría) para inputs numéricos. `lead` (S10, B-Categorias-Nueva: la baldosa de 32 que
 *  hace de vista previa): HTML YA RENDERIZADO (entity.js#tileHtml) que va dentro del pozo, delante
 *  del input, envuelto en `.ctl-field-lead` (quien llama lo repinta por ahí). Sin ellos, el marcado
 *  es el de siempre.
 *  `pill` (por defecto false): el pozo en píldora (`--radius-pill`) en vez de radio 10, como la
 *  búsqueda y los importes de B-Movimientos / B-Movimientos-Filtros (F-29 retirada). `label` sigue
 *  siendo obligatorio; con `hideLabel` no se ve (queda como texto para el lector de pantalla), para
 *  los campos del original que no llevan etiqueta encima. */
export function fieldHtml({ id, label, type = "text", value = "", inputmode = "", placeholder = "", num = false, suffix = "", min = "", step = "", lead = "", pill = false, hideLabel = false }) {
  const extra = `${inputmode ? ` inputmode="${escAttr(inputmode)}"` : ""}${placeholder ? ` placeholder="${escAttr(placeholder)}"` : ""}`
    + `${min !== "" ? ` min="${escAttr(min)}"` : ""}${step !== "" ? ` step="${escAttr(step)}"` : ""}`;
  return `<label class="ctl-field-wrap" for="${escAttr(id)}">
    <span class="ctl-field-label${hideLabel ? " is-hidden" : ""}">${escHtml(label)}</span>
    <span class="ctl-field${lead ? " has-lead" : ""}${pill ? " is-pill" : ""}">${lead ? `<span class="ctl-field-lead" aria-hidden="true">${lead}</span>` : ""}<input class="ctl-field-input${num ? " is-num" : ""}" id="${escAttr(id)}" type="${escAttr(type)}" value="${escAttr(value)}"${extra}>${suffix ? `<span class="ctl-field-suffix" aria-hidden="true">${escHtml(suffix)}</span>` : ""}</span>
  </label>`;
}

/** Chip neutro (§9): 44 píldora, `--raised`, 14/500 — subcategoría o etiqueta, nunca color propio
 *  (eso es el chip de filtro con tinte de familia, de otra PR). Con `tag:true` añade borde e icono
 *  de etiqueta, como en B-Movimientos-Filtros.
 *  Opcionales (S10, B-Categorias: subcategorías como chips): `data` (objeto → atributos data-*, el
 *  gancho del cableado), `ariaLabel` (nombre accesible completo, p. ej. «Gas, archivada»), `icon`
 *  (clave de icons.js, 16, delante del texto) y `cls` (clase extra de la pantalla, p. ej. el chip
 *  archivado de borde discontinuo). Sin ellos, el marcado es el de siempre. */
export function neutralChipHtml({ id = "", label, tag = false, data = null, ariaLabel = "", icon: iconName = "", cls = "" }) {
  const classes = ["ctl-chip", tag && "is-tag", cls].filter(Boolean).join(" ");
  let extra = id ? ` id="${escAttr(id)}"` : "";
  if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data)) {
      if (v == null) continue;
      const name = String(k).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()).replace(/[^a-z0-9-]/g, "");
      if (name) extra += ` data-${name}="${escAttr(v)}"`;
    }
  }
  if (ariaLabel) extra += ` aria-label="${escAttr(ariaLabel)}"`;
  const lead = tag ? icon("tag", { size: 16 }) : iconName ? icon(iconName, { size: 16 }) : "";
  return `<button type="button" class="${classes}"${extra}>${lead}${escHtml(label)}</button>`;
}
