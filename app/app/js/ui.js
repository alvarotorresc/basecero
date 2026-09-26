/** Piezas de chrome compartidas por las pantallas (DESIGN.md §9: cabeceras y botones). Módulo PURO:
 *  solo importa icons.js, t(), esc.js y theme.js —sin DOM ni db—, y devuelve HTML. */
import { icon } from "./icons.js";
import { t } from "./i18n/index.js";
import { escHtml, escAttr } from "./esc.js";

/** Cabecera de raíz (DESIGN.md §9, B-Home): `h1` de 24 en Unbounded y subtítulo opcional 13/500
 *  dim debajo. La llevan los 4 destinos de la barra de pestañas; es el único `h1` de la pantalla.
 *  @param {object} o
 *  @param {string} o.title       Se escapa aquí.
 *  @param {string} [o.subtitle]  Segunda línea. Se escapa aquí; vacía → no se pinta.
 *  @param {{id:string,label:string}|null} [o.subtitleAction]  El subtítulo pasa a ser un botón
 *                                (alto de toque 44) con ese id. Su nombre accesible empieza por el
 *                                texto visible y sigue con `label` (la acción). El h1 nunca va
 *                                dentro: un botón no puede contener un encabezado. Inicio lo usa
 *                                para «Periodo nuevo».
 *  @returns {string} HTML */
export function rootHeaderHtml({ title, subtitle = "", subtitleAction = null }) {
  let sub = "";
  if (subtitle && subtitleAction) {
    sub = `<button type="button" class="root-header-sub root-header-sub-btn" id="${escAttr(subtitleAction.id)}"`
      + ` aria-label="${escAttr(`${subtitle}, ${subtitleAction.label}`)}">${escHtml(subtitle)}</button>`;
  } else if (subtitle) {
    sub = `<span class="root-header-sub">${escHtml(subtitle)}</span>`;
  }
  return `<header class="root-header">
    <h1 class="root-header-title">${escHtml(title)}</h1>
    ${sub}
  </header>`;
}

/** Cabecera con atrás (DESIGN.md §9, forma canónica B/C de inventario-B I-15; B-Categorias):
 *  atrás de 44 · `h1` de 20 ALINEADO A LA IZQUIERDA con subtítulo opcional 13/500 dim debajo ·
 *  acción opcional de 44 a la derecha. Sin acción no hay hueco: el título ocupa el resto.
 *
 *   subHeaderHtml({ id:"mov-back", title })                         atrás + título
 *   subHeaderHtml({ id, title, action:{ id, icon:"plus", label } })  atrás + título + acción
 *   subHeaderHtml({ id, title, subtitle })                           + subtítulo
 *   subHeaderHtml({ id:null, title, action:{ icon:"close", … } })    título + cerrar (Registro)
 *
 *  @param {object}      o
 *  @param {string}      o.title          Se escapa aquí.
 *  @param {string|null} [o.id]           id del botón «atrás». null → sin botón «atrás».
 *  @param {string}      [o.subtitle]     Segunda línea. Se escapa aquí.
 *  @param {object|null} [o.action]       { id, icon, label } del botón derecho. null → nada.
 *  @returns {string} HTML
 *
 *  El «atrás» se llama siempre t("common.back") («Atrás», §11). NO cablea nada: devuelve HTML con
 *  los ids que le pasas y la pantalla los conecta en su wire(). Es lo que permite que sea puro. */
export function subHeaderHtml({ title, id = "screen-back", subtitle = "", action = null }) {
  const back = id === null
    ? ""
    : `<button type="button" class="icon-btn" id="${escAttr(id)}" aria-label="${escAttr(t("common.back"))}">${icon("back")}</button>`;
  const right = action
    ? `<button type="button" class="icon-btn" id="${escAttr(action.id)}" aria-label="${escAttr(action.label)}">${icon(action.icon)}</button>`
    : "";
  return `<header class="sub-header">
    ${back}
    <div class="sub-header-body">
      <h1 class="sub-header-title">${escHtml(title)}</h1>
      ${subtitle ? `<span class="sub-header-sub">${escHtml(subtitle)}</span>` : ""}
    </div>
    ${right}
  </header>`;
}

const BUTTON_CLASS = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  tertiary: "btn-tertiary",
  "danger-entry": "btn-danger",
  "tertiary-danger": "btn-tertiary btn-tertiary-danger",
  "danger-confirm": "btn-danger-confirm",
};

/** Botón del sistema (DESIGN.md §9): Primario, Secundario M/S, Terciario y destructivo (entrada y
 *  confirmación).
 *
 *   primary       56 píldora --accent 17/700 --sh-key, ancho completo. `note` → 12/500 dim DEBAJO
 *                 (I-67); entonces devuelve un contenedor .btn-stack con el botón y la nota.
 *   secondary     M 48/15 (por defecto) · S 44/14 (`size:"s"`), --raised con borde.
 *   tertiary      Texto 13/600 dim con alto de toque 44.
 *   danger-entry  Forma de secundario con texto y borde --neg (D-1, C5).
 *   danger-confirm  Confirmación del aviso (D-1, C5, modal.js): relleno --neg, texto --on-neg,
 *                 48/15 — la ÚNICA excepción a «rojo solo en cifras».
 *   tertiary-danger  Terciario con texto --neg (D-1: destructivo rojo en todas partes), p. ej.
 *                 «Borrar objetivo» de B-Objetivo.
 *
 *  @param {object} o
 *  @param {"primary"|"secondary"|"tertiary"|"danger-entry"|"danger-confirm"|"tertiary-danger"} [o.kind]  Por defecto "secondary".
 *  @param {"m"|"s"} [o.size]    Solo secundario y entrada destructiva. Por defecto "m".
 *  @param {string}  [o.id]
 *  @param {string}  o.label     Se escapa aquí.
 *  @param {string}  [o.note]    Solo primario. Se escapa aquí.
 *  @param {string}  [o.icon]    Nombre de icons.js, 18 px, delante del texto.
 *  @param {boolean} [o.disabled]
 *  @param {object}  [o.data]    data-* para el wire() de la pantalla (patrón entity.js#attrs):
 *                               claves en kebab o camel; se pasan a kebab. Para una lista de
 *                               botones sin id fijo (candidatas de S9, una por comercio).
 *  @returns {string} HTML */
export function buttonHtml({ kind = "secondary", size = "m", id = "", label, note = "", icon: iconName = "", disabled = false, data = null }) {
  const base = BUTTON_CLASS[kind] ?? BUTTON_CLASS.secondary;
  const small = size === "s" && (base === "btn-secondary" || base === "btn-danger");
  const cls = small ? `${base} btn-s` : base;
  let attrs = id ? ` id="${escAttr(id)}"` : "";
  if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data)) {
      if (v == null) continue;
      const name = String(k).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()).replace(/[^a-z0-9-]/g, "");
      if (name) attrs += ` data-${name}="${escAttr(v)}"`;
    }
  }
  const btn = `<button type="button" class="${cls}"${attrs}${disabled ? " disabled" : ""}>`
    + `${iconName ? icon(iconName, { size: 18 }) : ""}<span>${escHtml(label)}</span></button>`;
  if (base !== "btn-primary" || !note) return btn;
  return `<div class="btn-stack">${btn}<span class="btn-note">${escHtml(note)}</span></div>`;
}

/** Fila de metadatos con el divisor de 1px de §1 y §4.4 — la alternativa que el sistema da al
 *  punto medio prohibido. Recibe los segmentos YA TRADUCIDOS y en TEXTO PLANO; los escapa (es lo
 *  único que entra: fechas, nombres de categoría, «día 12», «pagado»), descarta los vacíos —así
 *  una fila de dos datos y otra de tres se piden igual— y los une con el divisor.
 *
 *  Si algún día un segmento necesita HTML dentro (la anatomía de un importe, por ejemplo), ese
 *  bloque se pinta a mano fuera del helper: no se le añade un modo `html:true`, porque entonces
 *  el escapado dejaría de estar garantizado en el único sitio donde se puede garantizar. */
export function metaHtml(segments, { cls = "" } = {}) {
  const parts = segments.filter((s) => s !== "" && s != null).map((s) => `<span>${escHtml(s)}</span>`);
  return `<div class="meta-row${cls ? ` ${cls}` : ""}">${parts.join('<span class="meta-sep" aria-hidden="true"></span>')}</div>`;
}

/** Índice al que lleva una tecla dentro de un grupo de radios (patrón radiogroup de WAI-ARIA):
 *  flechas con vuelta, Inicio y Fin. -1 si la tecla no mueve. */
export function radioKeyIndex(key, index, count) {
  switch (key) {
    case "ArrowRight": case "ArrowDown": return (index + 1) % count;
    case "ArrowLeft": case "ArrowUp": return (index - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return -1;
  }
}
