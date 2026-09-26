/** Piezas de ENTIDAD del sistema B (DESIGN.md §9, inventario-B §2): baldosas, ficha, tarjeta de
 *  categoría elegida, chip de filtro, fila de movimiento, fila de ajuste y cabeceras de día y de
 *  sección. Módulo PURO: solo importa icons.js, esc.js y category-colors.js —sin DOM, sin db, sin
 *  t()—, y devuelve HTML. Las pantallas lo cablean en su wire() por id o data-*.
 *
 *  Color (DESIGN.md §5):
 *   - La familia entra SOLO como clase `.fam-<k>` (famClass): el CSS lee --ft (tinte), --fb (barra)
 *     y --fx (texto e icono). Aquí no hay ni un color ni un estilo en línea.
 *   - `fam` null/desconocida = sin familia: ingresos y «sin categoría» (C9) y lo que no es entidad
 *     (C11) se pintan neutros en --well con el icono en --text.
 *   - Las cifras van en tinta o en señal (C4, C7); nunca en color de familia.
 *   - Las cuentas usan estos mismos componentes con el `fam` que les da account-colors.js (PR-10).
 *
 *  Todo el texto que entra se escapa aquí. La única excepción es `amountHtml`/`totalHtml`/
 *  `controlHtml`: HTML YA RENDERIZADO (format.js#moneyPartsHtml, el interruptor de controls.js)
 *  que se inserta tal cual. format.js no se toca: su anatomía money-cents/money-cur se envuelve. */
import { icon, catIcon, ICON_PATHS } from "./icons.js";
import { escHtml, escAttr } from "./esc.js";
import { famClass } from "./category-colors.js";

const MINUS = "−"; // «−» tipográfico: el mismo ancho que «+» en la mono tabular.

/** Atributos opcionales comunes: id y data-* (claves en kebab o camel; se pasan a kebab). */
function attrs({ id = "", data = null } = {}) {
  let out = id ? ` id="${escAttr(id)}"` : "";
  if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data)) {
      if (v == null) continue;
      const name = String(k).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()).replace(/[^a-z0-9-]/g, "");
      if (name) out += ` data-${name}="${escAttr(v)}"`;
    }
  }
  return out;
}

/** Icono de entidad: clave de categoría/ingreso/etiqueta (catIcon) o, si es un icono de UI
 *  (icons.js#ICON_PATHS), ese. Una clave desconocida cae al icono de Otros (catIcon). */
function entityIcon(key, size) {
  if (key && Object.hasOwn(ICON_PATHS, key)) return icon(key, { size });
  return catIcon(key || "otr", { size });
}

const cls = (...parts) => parts.filter(Boolean).join(" ");

/** Baldosa de icono (§9, B-Movimientos): 40 en fila o 32 compacta, radio 10, tinte + icono --fx.
 *  Sobre un padre teñido (`onTint`) el fondo es --chip. Sin familia: --well con icono en --text.
 *  Decorativa (span, aria-hidden en el SVG): el nombre lo lleva la fila.
 *  @param {object} o
 *  @param {string|null} [o.fam]    Clave de familia (category-colors.js#familyForCategory).
 *  @param {string} [o.icon]        Clave de icono. Por defecto la de la familia, o "otr".
 *  @param {40|32} [o.size]         Por defecto 40.
 *  @param {boolean} [o.onTint]     Dentro de algo ya teñido (tarjeta elegida, bloque de categoría).
 *  @returns {string} HTML */
export function tileHtml({ fam = null, icon: key = "", size = 40, onTint = false } = {}) {
  const fc = famClass(fam);
  const small = Number(size) === 32;
  return `<span class="${cls("ent-tile", small && "ent-tile-32", fc, !fc && "ent-neutral", onTint && "ent-on-tint")}">`
    + `${entityIcon(key || (fc ? fam : "otr"), small ? 18 : 20)}</span>`;
}

/** Baldosa seleccionable (§9, B-Gasto): 56, tinte, icono --fx 20, nombre 13/600 --text.
 *  Seleccionada: aria-pressed="true" → --ring-sel + 700 sobre tinte; sin familia (ingreso),
 *  relleno --accent + --on-accent 700 (regla de «Seleccionado», §9).
 *  @param {object} o
 *  @param {string|null} [o.fam]
 *  @param {string} [o.icon]
 *  @param {string} o.label        Se escapa aquí.
 *  @param {boolean} [o.selected]
 *  @param {string} [o.id]
 *  @param {object} [o.data]       data-* para el wire() de la pantalla.
 *  @returns {string} HTML */
export function pickTileHtml({ fam = null, icon: key = "", label, selected = false, id = "", data = null }) {
  const fc = famClass(fam);
  return `<button type="button" class="${cls("ent-pick", fc, !fc && "ent-neutral")}" aria-pressed="${selected ? "true" : "false"}"${attrs({ id, data })}>`
    + `${entityIcon(key || (fc ? fam : "otr"), 20)}<span class="ent-pick-label">${escHtml(label)}</span></button>`;
}

/** Ficha (§9, B-Importar/B-Recibo): 28 píldora, estática (span; no es pulsable).
 *   fam     tinte + icono 14 y texto 12/600 en --fx.
 *   income  C9: --well SIN borde, icono y texto en --text. Sin familia (nunca `fam-`).
 *   tag     C10: --raised CON borde e icono de etiqueta. Sin familia.
 *  Precedencia: income > tag > fam. Sin ninguno, neutra como el ingreso.
 *  @param {object} o
 *  @param {string|null} [o.fam]
 *  @param {boolean} [o.income]
 *  @param {boolean} [o.tag]
 *  @param {string} [o.icon]   Por defecto: "income", "tag" o la clave de la familia.
 *  @param {string} o.label    Se escapa aquí.
 *  @returns {string} HTML */
export function badgeHtml({ fam = null, income = false, tag = false, icon: key = "", label }) {
  let variant;
  let iconKey = key;
  if (income) { variant = "ent-badge-income"; iconKey ||= "income"; }
  else if (tag) { variant = "ent-badge-tag"; iconKey ||= "tag"; }
  else if (famClass(fam)) { variant = famClass(fam); iconKey ||= fam; }
  else { variant = "ent-badge-income"; iconKey ||= "otr"; }
  return `<span class="ent-badge ${variant}">${entityIcon(iconKey, 14)}<span class="ent-badge-label">${escHtml(label)}</span></span>`;
}

/** Tarjeta de categoría elegida (§9, B-Movimiento-Detalle/B-Gasto; F-42/I-64: SIN borde): tinte,
 *  --radius-lg, baldosa 40 sobre --chip, nombre 15/600 --text arriba y ruta o ayuda 12/500 --fx
 *  debajo (el mismo orden que la fila), chevron opcional. Sin familia (ingreso): --well y la ruta
 *  en --text-dim. Con `id` es un botón (abre el selector); sin `id`, un bloque estático.
 *  @param {object} o
 *  @param {string|null} [o.fam]
 *  @param {string} [o.icon]
 *  @param {string} o.name        Se escapa aquí.
 *  @param {string} [o.path]      «Restauración» o «Restauración › Bares». Se escapa aquí.
 *  @param {boolean} [o.chevron]  Por defecto true si hay id.
 *  @param {string} [o.id]
 *  @param {object} [o.data]
 *  @returns {string} HTML */
export function chosenCategoryHtml({ fam = null, icon: key = "", name, path = "", chevron, id = "", data = null }) {
  const fc = famClass(fam);
  const tag = id ? "button" : "div";
  const showChev = chevron ?? Boolean(id);
  return `<${tag}${tag === "button" ? ' type="button"' : ""} class="${cls("ent-chosen", fc, !fc && "ent-neutral")}"${attrs({ id, data })}>`
    + tileHtml({ fam, icon: key, size: 40, onTint: true })
    + `<span class="ent-body"><span class="ent-name">${escHtml(name)}</span>`
    + `${path ? `<span class="ent-line2">${escHtml(path)}</span>` : ""}</span>`
    + `${showChev ? `<span class="ent-chev">${icon("chevronRight", { size: 16 })}</span>` : ""}</${tag}>`;
}

/** Chip de filtro (§9, B-Movimientos-Filtros): 44 píldora con aria-pressed.
 *   fam   tinte + muestra 10 --fb (radio 3) + 14/600 --text. Seleccionado: --ring-sel + 700.
 *   sin familia (neutro, «Todos», subcategoría)  --raised 14/500. Seleccionado: --accent +
 *         --on-accent 700, con check si `check` (selección múltiple).
 *   tag   neutro de etiqueta (C10): --raised con borde e icono de etiqueta.
 *  @param {object} o
 *  @param {string|null} [o.fam]
 *  @param {string} o.label      Se escapa aquí.
 *  @param {boolean} [o.selected]
 *  @param {boolean} [o.tag]
 *  @param {boolean} [o.check]   Solo neutro: check delante al estar seleccionado.
 *  @param {string} [o.id]
 *  @param {object} [o.data]
 *  @returns {string} HTML */
export function filterChipHtml({ fam = null, label, selected = false, tag = false, check = false, id = "", data = null }) {
  const fc = tag ? "" : famClass(fam);
  const lead = fc
    ? '<span class="ent-swatch" aria-hidden="true"></span>'
    : tag ? catIcon("tag", { size: 16 })
      : check && selected ? icon("check", { size: 18, width: 2.2 }) : "";
  return `<button type="button" class="${cls("ent-chip", fc, !fc && "ent-neutral", tag && "ent-chip-tag")}" aria-pressed="${selected ? "true" : "false"}"${attrs({ id, data })}>`
    + `${lead}<span class="ent-chip-label">${escHtml(label)}</span></button>`;
}

const SIGNS = {
  income: { ch: "+", cls: "pos" },   // ingreso: «+» en --pos (C4, C9)
  expense: { ch: MINUS, cls: "" },   // gasto: «−» en tinta (C7)
  alert: { ch: MINUS, cls: "neg" },  // «−» que avisa (sobrepasado, deuda que crece): --neg (C4)
  none: { ch: "", cls: "" },         // sin signo (transferencia, saldo)
};

/** Fila de movimiento (§9, B-Movimientos): 60; baldosa 40 · nombre 15/600 · línea 2 12/500 en
 *  --fx (dim sin familia) · cifra mono 15/600 a la derecha.
 *  @param {object} o
 *  @param {string|null} [o.fam]   null en ingresos: baldosa --well, icono --text (C9).
 *  @param {string} [o.icon]
 *  @param {string} o.title         Comercio o concepto. Se escapa aquí.
 *  @param {string} [o.line2]       Categoría › subcategoría. Se escapa aquí.
 *  @param {string} o.amountHtml    Importe EN VALOR ABSOLUTO ya renderizado, p. ej.
 *                                  moneyPartsHtml(Math.abs(cents)). El signo lo pone `sign`.
 *  @param {"income"|"expense"|"alert"|"none"} [o.sign]  Por defecto "expense".
 *  @param {string} [o.amountNote]  Segunda línea bajo la cifra, 12/500 dim. Se escapa aquí.
 *  @param {string} [o.id]
 *  @param {object} [o.data]
 *  @returns {string} HTML */
export function txRowHtml({ fam = null, icon: key = "", title, line2 = "", amountHtml, sign = "expense", amountNote = "", id = "", data = null }) {
  const s = Object.hasOwn(SIGNS, sign) ? SIGNS[sign] : SIGNS.expense;
  const fc = famClass(fam);
  return `<button type="button" class="${cls("ent-row", fc)}"${attrs({ id, data })}>`
    + tileHtml({ fam, icon: key || (fc ? fam : sign === "income" ? "income" : "otr") })
    + `<span class="ent-body"><span class="ent-name">${escHtml(title)}</span>`
    + `${line2 ? `<span class="ent-line2">${escHtml(line2)}</span>` : ""}</span>`
    + `<span class="ent-amount-col"><span class="${cls("ent-amount", "num", s.cls)}">${s.ch}${amountHtml ?? ""}</span>`
    + `${amountNote ? `<span class="ent-amount-note">${escHtml(amountNote)}</span>` : ""}</span></button>`;
}

/** Fila de ajuste (§9, B-Ajustes): 48 (60 con `sub`); baldosa 32 opcional · etiqueta 15/500 ·
 *  valor 15/600 en --text (NUNCA en familia, I-61) · chevron 16 dim o un control.
 *   - Con `controlHtml` (el interruptor de controls.js, ya renderizado) la fila es un <div> —un
 *     interruptor no puede ir dentro de un botón— y la etiqueta lleva id `${id}-label` para que
 *     el control la cite con aria-labelledby.
 *   - Sin control es un <button> con chevron (salvo `chevron:false`).
 *   - La baldosa es neutra (--well, icono en tinta, C11) salvo que llegue `fam` (una cuenta):
 *     entonces la clase de familia va SOLO en la baldosa, nunca en la fila ni en el valor.
 *  @param {object} o
 *  @param {string} [o.icon]        Clave de icons.js o de categoría. Sin icono, sin baldosa.
 *  @param {string|null} [o.fam]
 *  @param {string} o.label         Se escapa aquí.
 *  @param {string} [o.sub]         Segunda línea 13/500 dim. Se escapa aquí.
 *  @param {string} [o.value]       Se escapa aquí.
 *  @param {boolean} [o.valueNum]   Valor en mono tabular (porcentajes, días).
 *  @param {boolean} [o.chevron]    Por defecto true si no hay control.
 *  @param {string} [o.controlHtml] HTML ya renderizado del control (interruptor). Tal cual.
 *  @param {string} [o.id]
 *  @param {object} [o.data]
 *  @returns {string} HTML */
export function settingRowHtml({ icon: key = "", fam = null, label, sub = "", value = "", valueNum = false, chevron, controlHtml = "", id = "", data = null }) {
  const tag = controlHtml ? "div" : "button";
  const showChev = !controlHtml && (chevron ?? true);
  const labelId = controlHtml && id ? ` id="${escAttr(id + "-label")}"` : "";
  return `<${tag}${tag === "button" ? ' type="button"' : ""} class="${cls("ent-set", sub && "ent-set-2")}"${attrs({ id, data })}>`
    + `${key ? tileHtml({ fam, icon: key, size: 32 }) : ""}`
    + `<span class="ent-set-body"><span class="ent-set-label"${labelId}>${escHtml(label)}</span>`
    + `${sub ? `<span class="ent-set-sub">${escHtml(sub)}</span>` : ""}</span>`
    + `${value !== "" && value != null ? `<span class="${cls("ent-set-value", valueNum && "num")}">${escHtml(value)}</span>` : ""}`
    + `${controlHtml}`
    + `${showChev ? `<span class="ent-chev">${icon("chevronRight", { size: 16 })}</span>` : ""}</${tag}>`;
}

/** Cabecera de día (§9, B-Movimientos): 24 de alto; «Hoy» 13/700 + fecha 13/500 dim; total mono
 *  14/600 a la derecha (opcional: en las listas cortas, sin total). SIN familia (C6).
 *  @param {object} o
 *  @param {string} o.label        «Hoy», «Ayer» o el día. Se escapa aquí.
 *  @param {string} [o.date]       «dom 13». Se escapa aquí.
 *  @param {string} [o.totalHtml]  Total ya renderizado (moneyPartsHtml). Tal cual.
 *  @returns {string} HTML */
export function dayHeaderHtml({ label, date = "", totalHtml = "" }) {
  return `<div class="ent-day"><span class="ent-day-label">${escHtml(label)}`
    + `${date ? ` <span class="ent-day-date">${escHtml(date)}</span>` : ""}</span>`
    + `${totalHtml ? `<span class="ent-day-total num">${totalHtml}</span>` : ""}</div>`;
}

/** Encabezado de sección (§9, I-42): dos niveles y SIN familia (C6).
 *   "title"  fuera de bloque: ttl 15 --text con contador 13 dim opcional.
 *   "group"  sobre un grupo: 13/600 dim en cuerpo, con relleno 4.
 *  Nunca emite h1 (el h1 es de la cabecera de pantalla).
 *  @param {object} o
 *  @param {string} o.title             Se escapa aquí.
 *  @param {"title"|"group"} [o.level]  Por defecto "title".
 *  @param {string|number} [o.count]    Contador. Se escapa aquí.
 *  @param {"h2"|"h3"} [o.tag]          Por defecto "h2".
 *  @param {string} [o.id]
 *  @returns {string} HTML */
export function sectionHeaderHtml({ title, level = "title", count = "", tag = "h2", id = "" }) {
  const h = tag === "h3" ? "h3" : "h2";
  const lv = level === "group" ? "ent-sec-group" : "ent-sec-title";
  return `<div class="ent-sec ${lv}"><${h} class="ent-sec-text"${attrs({ id })}>${escHtml(title)}</${h}>`
    + `${count !== "" && count != null ? `<span class="ent-sec-count">${escHtml(count)}</span>` : ""}</div>`;
}
