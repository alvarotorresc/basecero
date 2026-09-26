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
 *   - Las cifras van en tinta o en señal (C4, C7) salvo donde el mockup elegido las pinta con su
 *     familia: entonces llevan `.is-fam-ink` (famNumHtml, `valueInFam`), el único gancho que R-C7
 *     admite (C7 retirada ahí, Álvaro 2026-09-27: igual que el mockup).
 *   - Las cuentas usan estos mismos componentes con el `fam` que les da account-colors.js (PR-10).
 *
 *  Todo el texto que entra se escapa aquí. La única excepción es `amountHtml`/`totalHtml`/
 *  `controlHtml`: HTML YA RENDERIZADO (format.js#moneyPartsHtml, el interruptor de controls.js)
 *  que se inserta tal cual. format.js no se toca: su anatomía money-cents/money-cur se envuelve. */
import { icon, catIcon, ICON_PATHS } from "./icons.js";
import { escHtml, escAttr } from "./esc.js";
import { famClass, isFamily } from "./category-colors.js";

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
 *  @param {boolean} [o.filled]     Baldosa RELLENA del sólido de la familia (-b) con el icono en
 *                                  --on-fam (claro en claro, fondo en oscuro), como B-Ajustes,
 *                                  B-Categorias o B-PeriodoNuevo (F-08/F-39 retiradas, Álvaro
 *                                  2026-09-27). Gana a `onTint`. Sin familia no hace nada (neutra).
 *  @returns {string} HTML */
export function tileHtml({ fam = null, icon: key = "", size = 40, onTint = false, filled = false } = {}) {
  const fc = famClass(fam);
  const small = Number(size) === 32;
  const fill = filled && fc;
  return `<span class="${cls("ent-tile", small && "ent-tile-32", fc, !fc && "ent-neutral", fill && "ent-tile-filled", onTint && !fill && "ent-on-tint")}">`
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
 *  @param {boolean|null} [o.expanded]  Solo si la baldosa despliega algo (las subcategorías de
 *                                 B-Gasto): aria-expanded. Desplegar NO es seleccionar (§9), así
 *                                 que no pinta nada: el estado lo lleva aria-pressed. null → sin atributo.
 *  @param {string} [o.id]
 *  @param {object} [o.data]       data-* para el wire() de la pantalla.
 *  @returns {string} HTML */
export function pickTileHtml({ fam = null, icon: key = "", label, selected = false, expanded = null, id = "", data = null }) {
  const fc = famClass(fam);
  const exp = typeof expanded === "boolean" ? ` aria-expanded="${expanded}"` : "";
  return `<button type="button" class="${cls("ent-pick", fc, !fc && "ent-neutral")}" aria-pressed="${selected ? "true" : "false"}"${exp}${attrs({ id, data })}>`
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
 *  @param {28|36} [o.size]    Por defecto 28. 36 (B-Recibo, F-41 retirada): píldora de 36, icono 16
 *                             dentro de un círculo --raised de 26 y texto 13/600, con el mismo color
 *                             por variante (el ingreso sigue neutro, C9).
 *  @returns {string} HTML */
export function badgeHtml({ fam = null, income = false, tag = false, icon: key = "", label, size = 28 }) {
  let variant;
  let iconKey = key;
  if (income) { variant = "ent-badge-income"; iconKey ||= "income"; }
  else if (tag) { variant = "ent-badge-tag"; iconKey ||= "tag"; }
  else if (famClass(fam)) { variant = famClass(fam); iconKey ||= fam; }
  else { variant = "ent-badge-income"; iconKey ||= "otr"; }
  if (size === 36) {
    return `<span class="ent-badge ent-badge-36 ${variant}"><span class="ent-badge-ico">${entityIcon(iconKey, 16)}</span><span class="ent-badge-label">${escHtml(label)}</span></span>`;
  }
  return `<span class="ent-badge ${variant}">${entityIcon(iconKey, 14)}<span class="ent-badge-label">${escHtml(label)}</span></span>`;
}

/** Tarjeta de categoría elegida (§9, B-Movimiento-Detalle/B-Gasto): tinte, --radius-lg, baldosa
 *  40 sobre --chip, nombre 15/600 --text arriba y ruta o ayuda 12/500 --fx debajo (el mismo orden
 *  que la fila), chevron opcional. Sin familia (ingreso): --well y la ruta en --text-dim. Con `id`
 *  es un botón (abre el selector); sin `id`, un bloque estático.
 *  `variant` recupera la tarjeta del mockup elegido (F-42 retirada, Álvaro 2026-09-27): con borde
 *  1px en el sólido de la familia (-b) y su jerarquía:
 *   - "pick"   (B-Gasto): relleno 10 12; `name` 15/700 arriba («Restauración › Bares y cafés») y
 *              `path` 12/500 -x debajo («La que usas en Bar Pepe»).
 *   - "detail" (B-Movimiento-Detalle, B-Borrar): relleno 12; `path` 13/600 -x ARRIBA («Restauración»)
 *              y `name` 17/700 debajo («Bares y cafés»).
 *  Por defecto "" (la tarjeta sin borde de siempre). Sin familia, la variante no pinta borde.
 *  `check` (por defecto false): marca de «aplicada» de 22 al final, en -x (B-Gasto). Decorativa: el
 *  nombre ya dice cuál está elegida. Si hay chevron, gana el chevron.
 *  @param {object} o
 *  @param {string|null} [o.fam]
 *  @param {string} [o.icon]
 *  @param {string} o.name        Se escapa aquí.
 *  @param {string} [o.path]      «Restauración» o «Restauración › Bares». Se escapa aquí.
 *  @param {boolean} [o.chevron]  Por defecto true si hay id.
 *  @param {string} [o.id]
 *  @param {object} [o.data]
 *  @param {""|"pick"|"detail"} [o.variant]
 *  @param {boolean} [o.check]
 *  @returns {string} HTML */
export function chosenCategoryHtml({ fam = null, icon: key = "", name, path = "", chevron, id = "", data = null, variant = "", check = false }) {
  const fc = famClass(fam);
  const tag = id ? "button" : "div";
  const showChev = chevron ?? Boolean(id);
  const v = variant === "pick" || variant === "detail" ? variant : "";
  const nameHtml = `<span class="ent-name">${escHtml(name)}</span>`;
  const pathHtml = path ? `<span class="ent-line2">${escHtml(path)}</span>` : "";
  return `<${tag}${tag === "button" ? ' type="button"' : ""} class="${cls("ent-chosen", v && `ent-chosen-${v}`, fc, !fc && "ent-neutral")}"${attrs({ id, data })}>`
    + tileHtml({ fam, icon: key, size: 40, onTint: true })
    + `<span class="ent-body">${v === "detail" ? pathHtml + nameHtml : nameHtml + pathHtml}</span>`
    + `${showChev ? `<span class="ent-chev">${icon("chevronRight", { size: 16 })}</span>`
      : check ? `<span class="ent-chosen-check">${icon("check", { size: 22 })}</span>` : ""}</${tag}>`;
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
 *  @param {52|60} [o.height]       Alto mínimo. Por defecto 60; 52 es la fila de B-Home y B-Cuenta
 *                                  (F-34 retirada, Álvaro 2026-09-27).
 *  @param {500|600} [o.amountWeight]  Peso de la cifra. Por defecto 600; 500 es el de B-Home,
 *                                  B-Movimientos, B-Cuenta y B-Semana.
 *  @returns {string} HTML */
export function txRowHtml({ fam = null, icon: key = "", title, line2 = "", amountHtml, sign = "expense", amountNote = "", id = "", data = null, height = 60, amountWeight = 600 }) {
  const s = Object.hasOwn(SIGNS, sign) ? SIGNS[sign] : SIGNS.expense;
  const fc = famClass(fam);
  return `<button type="button" class="${cls("ent-row", Number(height) === 52 && "ent-row-52", Number(amountWeight) === 500 && "ent-row-w500", fc, !fc && "ent-neutral")}"${attrs({ id, data })}>`
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
 *  @param {string|null} [o.valueFam]  Muestra de 10 en la barra de esa familia DELANTE del valor
 *                                  (C8: la cuenta con su familia, B-Movimiento-Detalle). La clase
 *                                  de familia va solo en la muestra, nunca en el valor (I-61).
 *  @param {boolean} [o.chevron]    Por defecto true si no hay control.
 *  @param {string} [o.controlHtml] HTML ya renderizado del control (interruptor). Tal cual.
 *  @param {boolean} [o.expanded]   Solo fila botón: la fila despliega un panel en su sitio (S4,
 *                                  sin hoja todavía) → aria-expanded. Sin pasarlo, no se emite.
 *  @param {string} [o.controls]    Con `expanded`: id del panel que despliega (aria-controls).
 *  @param {boolean} [o.disabled]   Solo fila botón: desactivada mientras hay una tarea en curso.
 *  @param {string} [o.id]
 *  @param {object} [o.data]
 *  @param {boolean} [o.tileFilled] Baldosa rellena del sólido de `fam` con icono --on-fam (tileHtml
 *                                  `filled`), como los grupos de B-Ajustes, B-Cuenta y B-Objetivo.
 *  @param {boolean} [o.valueInFam] Valor en el -x de `fam` (B-Ajustes/B-Cuenta/B-Objetivo original:
 *                                  «Marta», «50 %» en -d). Distinto de `valueFam` (la muestra).
 *                                  Sin `fam`, no hace nada.
 *  @param {string} [o.trailHtml]   HTML decorativo ya hecho entre el valor y el chevron, sin
 *                                  convertir la fila en div (a diferencia de `controlHtml`): las
 *                                  muestras de color de «Categorías» en B-Ajustes. Tal cual.
 *  @returns {string} HTML */
export function settingRowHtml({ icon: key = "", fam = null, label, sub = "", value = "", valueNum = false, valueFam = null, chevron, controlHtml = "", expanded, controls = "", disabled = false, id = "", data = null, tileFilled = false, valueInFam = false, trailHtml = "" }) {
  const tag = controlHtml ? "div" : "button";
  const showChev = !controlHtml && (chevron ?? true);
  const labelId = controlHtml && id ? ` id="${escAttr(id + "-label")}"` : "";
  let btnAttrs = "";
  if (tag === "button") {
    if (typeof expanded === "boolean") {
      btnAttrs += ` aria-expanded="${expanded}"${controls ? ` aria-controls="${escAttr(controls)}"` : ""}`;
    }
    if (disabled) btnAttrs += " disabled";
  }
  return `<${tag}${tag === "button" ? ' type="button"' : ""} class="${cls("ent-set", sub && "ent-set-2")}"${attrs({ id, data })}${btnAttrs}>`
    + `${key ? tileHtml({ fam, icon: key, size: 32, filled: tileFilled }) : ""}`
    + `<span class="ent-set-body"><span class="ent-set-label"${labelId}>${escHtml(label)}</span>`
    + `${sub ? `<span class="ent-set-sub">${escHtml(sub)}</span>` : ""}</span>`
    + `${value !== "" && value != null && famClass(valueFam) ? `<span class="ent-swatch ${famClass(valueFam)}" aria-hidden="true"></span>` : ""}`
    + `${value !== "" && value != null ? `<span class="${cls("ent-set-value", valueNum && "num", valueInFam && famClass(fam), valueInFam && famClass(fam) && "is-fam-ink")}">${escHtml(value)}</span>` : ""}`
    + `${trailHtml}`
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

/** Encabezado de sección (§9, I-42): dos niveles.
 *   "title"  fuera de bloque: ttl 15 --text con contador 13 dim opcional.
 *   "group"  sobre un grupo: 13/600 dim en cuerpo, con relleno 4.
 *  Variantes del mockup elegido (F-37 y el encabezado de F-08 retirados, Álvaro 2026-09-27):
 *   - `fam`: el texto en el -x de esa familia («Activas» de B-Suscripciones, los grupos de
 *     B-Ajustes, B-Cuenta, B-Objetivo, B-Onb-Ajustes). En "group" pasa además a Unbounded 13 (ttl).
 *   - `ttl`: "group" en Unbounded 13 y tinta, sin familia («A tu favor» de B-Liquidar). Con `fam`
 *     ya va implícito.
 *   - `dim`: "title" en --text-dim («Archivadas» de B-Etiquetas).
 *  Nunca emite h1 (el h1 es de la cabecera de pantalla).
 *  @param {object} o
 *  @param {string} o.title             Se escapa aquí.
 *  @param {"title"|"group"} [o.level]  Por defecto "title".
 *  @param {string|number} [o.count]    Contador. Se escapa aquí.
 *  @param {"h2"|"h3"} [o.tag]          Por defecto "h2".
 *  @param {string} [o.id]
 *  @param {string|null} [o.fam]        Familia del texto. Desconocida → sin familia.
 *  @param {boolean} [o.ttl]            Solo "group": Unbounded 13.
 *  @param {boolean} [o.dim]            Texto en --text-dim (si no hay `fam`).
 *  @returns {string} HTML */
export function sectionHeaderHtml({ title, level = "title", count = "", tag = "h2", id = "", fam = null, ttl = false, dim = false }) {
  const h = tag === "h3" ? "h3" : "h2";
  const group = level === "group";
  const lv = group ? "ent-sec-group" : "ent-sec-title";
  const fc = famClass(fam);
  const mods = cls(fc, fc && "is-fam", group && (ttl || fc) && "is-ttl", !fc && dim && "is-dim");
  return `<div class="ent-sec ${lv}${mods ? ` ${mods}` : ""}"><${h} class="ent-sec-text"${attrs({ id })}>${escHtml(title)}</${h}>`
    + `${count !== "" && count != null ? `<span class="ent-sec-count">${escHtml(count)}</span>` : ""}</div>`;
}

/** Cifra en el color de su familia (-x) — donde el mockup elegido la pinta así: la deuda de
 *  B-Patrimonio («−4.300,00 €» en Coche), el «39,00 €» del Gimnasio en B-Home, el «69%» de un anillo
 *  o el «1.250 de 1.810,20 €» de un objetivo. Mono tabular; el peso y el tamaño los hereda (la
 *  pantalla lo mete dentro de su texto). C7 retirada ahí (Álvaro 2026-09-27: igual que el mockup).
 *  Familia desconocida → la cifra en tinta, sin clase de familia.
 *  @param {string} text           La cifra ya formateada. Se escapa aquí.
 *  @param {string|null} fam
 *  @param {object} [o]
 *  @param {500|600} [o.weight]    Peso explícito (600 en «1.250» de B-Patrimonio). Sin él, hereda.
 *  @returns {string} HTML */
export function famNumHtml(text, fam, { weight = null } = {}) {
  const fc = famClass(fam);
  const w = Number(weight) === 600 ? "is-w600" : Number(weight) === 500 ? "is-w500" : "";
  return `<span class="${cls("num", "ent-fam-num", fc, fc && "is-fam-ink", w)}">${escHtml(text)}</span>`;
}

/** Selector de familia de color (§6, C8; anatomía de B-Categorias-Nueva): rejilla de 6 columnas
 *  de muestras de 48, tinte (-t) con la barra (-b) de 12 abajo. La elegida lleva --ring-sel y el
 *  check en --fx. Es un grupo de botones con aria-pressed (como la baldosa seleccionable): el
 *  anillo naranja solo se permite en lo pulsado (C1). Cada muestra lleva su aria-label completo,
 *  ya traducido por quien llama (p. ej. «Cielo, la usa Cuenta corriente»); las claves que no son
 *  familia se descartan (nunca una clase inventada).
 *  @param {object} o
 *  @param {string} o.label                         aria-label del grupo. Se escapa aquí.
 *  @param {Array<{fam:string,label:string}>} o.options
 *  @param {string|null} [o.value]                  Familia elegida.
 *  @param {string} [o.id]
 *  @returns {string} HTML */
export function familySwatchesHtml({ label, options, value = null, id = "" }) {
  const items = (options ?? []).filter((o) => o && isFamily(o.fam)).map((o) => {
    const on = o.fam === value;
    return `<button type="button" class="ent-fam-pick ${famClass(o.fam)}" aria-pressed="${on ? "true" : "false"}" aria-label="${escAttr(o.label)}" data-fam="${escAttr(o.fam)}">`
      + `${on ? icon("check", { size: 20, width: 2.2 }) : ""}<span class="ent-fam-bar" aria-hidden="true"></span></button>`;
  }).join("");
  return `<div class="ent-fam-picker" role="group" aria-label="${escAttr(label)}"${attrs({ id })}>${items}</div>`;
}
