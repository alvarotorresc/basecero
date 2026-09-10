/** Piezas de chrome compartidas por las 28 pantallas (SISTEMA.md §4.2, §1). Módulo PURO: solo
 *  importa icons.js y t() —los dos sin DOM ni db—, y devuelve HTML.
 *  escHtml/escAttr son copia local, como en cada screens/*.js: centralizarlos es un refactor
 *  aparte (BACKLOG), no la excusa de este helper. */
import { icon } from "./icons.js";
import { t } from "./i18n/index.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** Cabecera de subpantalla (§4.2). Emite SIEMPRE tres celdas —44px / flex:1 / 44px— para que el
 *  título quede centrado de verdad, con acción a la derecha o sin ella. Cinco formas, una firma:
 *
 *   subHeaderHtml({ id:"mov-back", title })                        atrás + título + hueco
 *   subHeaderHtml({ id, title, action:{ id, icon:"plus", label } }) atrás + título + acción
 *   subHeaderHtml({ id, title, subtitle })                          + subtítulo centrado 12/500
 *   subHeaderHtml({ id, title, subtitle, align:"start" })           título 22/600 a la izquierda (asistente)
 *   subHeaderHtml({ id:null, title, action:{ icon:"close", … } })   hueco + título + cerrar (Registro)
 *
 *  @param {object}      o
 *  @param {string}      o.title                Se escapa aquí.
 *  @param {string|null} [o.id]                 id del botón «atrás». null → hueco de 44px.
 *  @param {string}      [o.subtitle]           Segunda línea. Se escapa aquí.
 *  @param {string}      [o.backLabel]          aria-label del «atrás». Por defecto t("common.goBack").
 *  @param {object|null} [o.action]             { id, icon, label } del botón derecho. null → hueco.
 *  @param {"center"|"start"} [o.align]         Alineación del bloque de título. Por defecto "center".
 *  @returns {string} HTML
 *
 *  NO cablea nada: devuelve HTML con los ids que le pasas y la pantalla los conecta en su wire(),
 *  como hace hoy con `#mov-back`/`#liq-back`/`#cat-back`. Es lo que permite que el helper sea puro. */
export function subHeaderHtml({ title, id = "screen-back", subtitle = "", backLabel = "", action = null, align = "center" }) {
  const left = id === null
    ? `<div class="sub-header-slot"></div>`
    : `<button type="button" class="icon-btn" id="${escAttr(id)}" aria-label="${escAttr(backLabel || t("common.goBack"))}">${icon("back")}</button>`;
  const right = action
    ? `<button type="button" class="icon-btn" id="${escAttr(action.id)}" aria-label="${escAttr(action.label)}">${icon(action.icon)}</button>`
    : `<div class="sub-header-slot"></div>`;
  return `<div class="sub-header${align === "start" ? " is-start" : ""}">
    ${left}
    <div class="sub-header-body">
      <span class="sub-header-title">${escHtml(title)}</span>
      ${subtitle ? `<span class="sub-header-sub">${escHtml(subtitle)}</span>` : ""}
    </div>
    ${right}
  </div>`;
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
