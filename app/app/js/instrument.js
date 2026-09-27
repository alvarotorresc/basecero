// Instrumento del sistema B (DESIGN.md §9): Display, LED, bloque bento, contenedor, barra apilada,
// medidor, columnas y estado vacío. Módulo PURO (patrón ui.js): solo importa esc.js y
// category-colors.js y devuelve HTML. Ningún color vive aquí: cada pieza lleva su clase y el color
// lo pone components.css (sección «Instrumento»). En línea solo va geometría (width, height,
// flex-basis y propiedades personalizadas), como pide R-INLINE.
//
// Parámetros de texto: se escapan aquí. Los que terminan en `Html` y `slot` son HTML de confianza
// que construye quien llama (normalmente con otra función de este módulo o de charts.js).
import { escHtml, escAttr } from "./esc.js";
import { famClass, isFamily } from "./category-colors.js";

// ---- Display --------------------------------------------------------------------------------

/** Atajos de tamaño de la cifra del Display (52 / 44 / 34, --disp-xl/l/m). Además, `size` admite
 *  un número de px (DISPLAY_PX_MIN…DISPLAY_PX_MAX) para el tamaño exacto del mockup de cada pantalla
 *  (Informe 64, Bienvenida 56, Gasto 48…; la escala de tres se retiró, Álvaro 2026-09-27). */
export const DISPLAY_SIZES = ["xl", "l", "m"];
export const DISPLAY_PX_MIN = 24;
export const DISPLAY_PX_MAX = 72;

const DISP_TONES = { ink: "", amber: " disp-amber", ok: " disp-ok" };

/** Cifra secundaria dentro del Display: mono en --disp-ink por defecto. Para montar el pie:
 *  `footHtml: \`Quedan ${dispInkHtml("558,29 €", { tone: "amber" })} de 1.700,00 €\``.
 *  `tone` (por defecto "ink"): "amber" la pinta en el ámbar de la cifra del Display, como las
 *  secundarias de B-Home, B-Objetivo, B-PeriodoNuevo, B-Recurrentes y B-Suscripciones (F-13
 *  retirada, Álvaro 2026-09-27: igual que el mockup); "ok" en el verde del LED (--ok), como el
 *  «+737,51 €» de B-Patrimonio y B-Cuenta. Un tono desconocido cae a "ink". */
export function dispInkHtml(text, { tone = "ink" } = {}) {
  const t = Object.hasOwn(DISP_TONES, tone) ? DISP_TONES[tone] : "";
  return `<span class="num disp-ink${t}">${escHtml(text)}</span>`;
}

/** Display (DESIGN.md §9, B-Home, B-Movimientos): panel hundido --disp, --radius-lg, relleno
 *  16 20. Arriba la etiqueta 13/500 y el LED opcional; la cifra que manda en ámbar con brillo;
 *  el pie 13/500 dim; y debajo, opcional, el instrumento (gráfico, medidor, pie de datos).
 *
 *   displayHtml({ label:"Hoy puedes gastar", value:"32,84 €", size:"xl",
 *                 footHtml:`Quedan ${dispInkHtml("558,29 €")} de 1.700,00 €`,
 *                 led:{ state:"ok", text:"Periodo abierto" }, slot: sparklineSvg(…) })
 *
 *  K4: exactamente UNA cifra .disp-value por Display. Si `footHtml` o `slot` traen otra, lanza.
 *  @param {object} o
 *  @param {string} o.label            Se escapa.
 *  @param {string} o.value            La cifra ya formateada. Se escapa.
 *  @param {"xl"|"l"|"m"|number} [o.size]  Por defecto "l" (subpantallas). Un número entero de px
 *                                     entre DISPLAY_PX_MIN y DISPLAY_PX_MAX pinta ese tamaño exacto
 *                                     (`--disp-fs` en línea). Otro valor lanza (K9).
 *  @param {string} [o.foot]           Pie en texto plano. Se escapa.
 *  @param {string} [o.footHtml]       Pie con HTML de confianza (gana a `foot`).
 *  @param {{state:string,text:string}|null} [o.led]  LED dentro del Display (ledHtml).
 *  @param {string} [o.aside]          Texto plano 12/500 --disp-dim junto al label (p. ej. un rango
 *                                     de fechas, B-PeriodoNuevo). Se escapa. Ignorado si hay `led`
 *                                     (el LED ya ocupa ese hueco).
 *  @param {string} [o.slot]           HTML de confianza debajo de la cifra: gráfico, medidor…
 *  @param {string} [o.id]             id de la cifra, para que la pantalla la actualice.
 *  @param {string} [o.labelAfter]     HTML de confianza justo detrás de la etiqueta (un chevron que
 *                                     avisa de que el Display cambia de cuenta, en Inicio).
 *  @param {boolean} [o.labelStrong]   Etiqueta 15/600 en --disp-ink en vez de 13/500 dim: el
 *                                     comercio de B-Movimiento-Detalle y B-Borrar («Bar Pepe»).
 *  @returns {string} HTML */
export function displayHtml({ label, value, size = "l", foot = "", footHtml = "", led = null, aside = "", slot = "", id = "", labelAfter = "", labelStrong = false }) {
  const px = typeof size === "number" ? size : null;
  if (px !== null && !(Number.isInteger(px) && px >= DISPLAY_PX_MIN && px <= DISPLAY_PX_MAX)) {
    throw new Error(`displayHtml: size ${size} no es un entero de ${DISPLAY_PX_MIN} a ${DISPLAY_PX_MAX} px (K9)`);
  }
  if (px === null && !DISPLAY_SIZES.includes(size)) throw new Error(`displayHtml: size «${size}» no es xl, l, m ni un número de px (K9)`);
  const sizeCls = px === null ? `disp-value-${size}` : "disp-value-free";
  const sizeStyle = px === null ? "" : ` style="--disp-fs:${px}px"`;
  if (/\bdisp-value\b/.test(footHtml) || /\bdisp-value\b/.test(slot)) {
    throw new Error("displayHtml: una sola cifra .disp-value por Display (K4); las secundarias van con dispInkHtml");
  }
  const pie = footHtml || (foot ? escHtml(foot) : "");
  return `<section class="disp">
    <div class="disp-head">
      <span class="disp-label${labelStrong ? " is-strong" : ""}">${escHtml(label)}${labelAfter}</span>
      ${led ? ledHtml({ ...led, onDisplay: true }) : aside ? `<span class="num disp-aside">${escHtml(aside)}</span>` : ""}
    </div>
    <span class="num disp-value ${sizeCls}"${sizeStyle}${id ? ` id="${escAttr(id)}"` : ""}>${escHtml(value)}</span>
    ${pie ? `<span class="disp-foot">${pie}</span>` : ""}
    ${slot ? `<div class="disp-slot">${slot}</div>` : ""}
  </section>`;
}

// ---- LED ------------------------------------------------------------------------------------

/** Estados del LED (§9): ok (encendido), idle (reposo) y wait («espera», solo dentro del Display). */
export const LED_STATES = ["ok", "idle", "wait"];

/** LED (DESIGN.md §9, B-Suscripciones): punto 8 + texto 12/500. El texto es obligatorio: el color
 *  nunca es la única señal (§11). Fuera del Display (Importar, Periodo nuevo) el punto «ok» va en
 *  --pos sin brillo (inventario-B, LED) y no existe la espera.
 *  @param {object} o
 *  @param {"ok"|"idle"|"wait"} o.state
 *  @param {string} o.text             Se escapa. Vacío lanza.
 *  @param {boolean} [o.onDisplay]     Por defecto true.
 *  @returns {string} HTML */
export function ledHtml({ state, text, onDisplay = true }) {
  if (!LED_STATES.includes(state)) throw new Error(`ledHtml: estado «${state}» desconocido`);
  if (!text || !String(text).trim()) throw new Error("ledHtml: el LED lleva texto (el color nunca es la única señal)");
  if (state === "wait" && !onDisplay) throw new Error("ledHtml: la espera solo existe dentro del Display");
  return `<span class="led led-${state}${onDisplay ? "" : " led-out"}"><span class="led-dot" aria-hidden="true"></span>${escHtml(text)}</span>`;
}

// ---- Bloque bento y contenedor --------------------------------------------------------------

/** Bloque bento (DESIGN.md §9, B-Home, B-Patrimonio): --radius-lg, relleno 16; etiqueta 13/600,
 *  cifra mono 20/600 en tinta, pie 12/500 dim. Sin familia va en --raised con borde; con familia,
 *  sobre su tinte (-t) y la etiqueta en -x (C6: lo que *es*).
 *  Variantes del original (B-Home «Ahorras 47 %»; C3 y C7 retiradas ahí, Álvaro 2026-09-27):
 *   - `valueFam: true` pinta la cifra en el -x de la familia (necesita `fam`).
 *   - `valueSize: "l"` la sube a 30 (--fs-30) con interlineado 1. Por defecto "m" (20).
 *  @param {object} o
 *  @param {string} o.label
 *  @param {string} [o.value]          Cifra ya formateada.
 *  @param {string} [o.foot]
 *  @param {string|null} [o.fam]       Clave de familia (category-colors.js).
 *  @param {string} [o.iconHtml]       Icono ya pintado (icons.js), en baldosa --chip de 32.
 *  @param {string} [o.slot]           HTML de confianza al final (botón, columnas…).
 *  @param {string} [o.cls]            Clases extra (p. ej. para que la pantalla lo ponga a 2 columnas).
 *  @param {boolean} [o.valueFam]      Cifra en -x de la familia. Sin `fam` válida, no hace nada.
 *  @param {"m"|"l"} [o.valueSize]     "m" 20 (por defecto) · "l" 30.
 *  @returns {string} HTML */
export function bentoHtml({ label, value = "", foot = "", fam = null, iconHtml = "", slot = "", cls = "", valueFam = false, valueSize = "m" }) {
  const tint = isFamily(fam);
  const classes = ["bento", tint ? `bento-tint ${famClass(fam)}` : "", cls].filter(Boolean).join(" ");
  return `<section class="${classes}">
    <div class="bento-head">
      ${iconHtml ? `<span class="bento-ico" aria-hidden="true">${iconHtml}</span>` : ""}
      <span class="bento-label">${escHtml(label)}</span>
    </div>
    ${value || foot ? `<div class="bento-body">
      ${value ? `<span class="num bento-figure${valueSize === "l" ? " is-l" : ""}${valueFam && tint ? " is-fam-ink" : ""}">${escHtml(value)}</span>` : ""}
      ${foot ? `<span class="bento-foot">${escHtml(foot)}</span>` : ""}
    </div>` : ""}
    ${slot}
  </section>`;
}

/** Contenedor (inventario-B, Contenedor; B-Home): lista o gráfico sobre --surface con borde y
 *  --radius-lg; relleno 4 en listas y 16 en gráficos. Cabecera opcional: título de sección 15 en
 *  Unbounded y, a la derecha, un total mono 15/600 en tinta.
 *  @param {object} o
 *  @param {string} [o.title]
 *  @param {string} [o.total]          Cifra ya formateada.
 *  @param {string} o.body             HTML de confianza.
 *  @param {"list"|"chart"} [o.kind]   Por defecto "chart".
 *  @param {string} [o.label]          aria-label de la sección cuando no hay título.
 *  @param {string} [o.aside]          HTML de confianza a la derecha de la cabecera, en lugar del
 *                                     total: la acción de la sección (el terciario «Ver todos» de
 *                                     B-Home). Con `aside`, `total` no se pinta.
 *  @returns {string} HTML */
export function containerHtml({ title = "", total = "", body, kind = "chart", label = "", aside = "" }) {
  const right = aside || (total ? `<span class="num box-total">${escHtml(total)}</span>` : "");
  const head = title || right
    ? `<div class="box-head">${title ? `<h2 class="box-title">${escHtml(title)}</h2>` : "<span></span>"}${right}</div>`
    : "";
  const aria = !title && label ? ` aria-label="${escAttr(label)}"` : "";
  return `<section class="box box-${kind === "list" ? "list" : "chart"}"${aria}>${head}${body}</section>`;
}

// ---- Barra apilada --------------------------------------------------------------------------

/** Barra apilada (DESIGN.md §9, B-Home, B-Patrimonio): grande 24 (radio --radius) o fina 8
 *  (píldora, sobre pozo), 2 de separación. Cada segmento pinta la barra de su familia (-b, C6), o
 *  --idle con `idle:true` («Resto», C11), o la trama de deuda con `debt:true` (C8).
 *  `idle:true` CON `fam` («Resto» en la barra de Otros, `{ idle:true, fam:"otr" }`, como B-Home;
 *  F-10 retirada, Álvaro 2026-09-27) pinta la barra de esa familia y deja la leyenda en dim.
 *
 *  C12: cada segmento lleva su nombre; sin `name` LANZA. La leyenda (muestra 10 + nombre + importe)
 *  sale por defecto; con `legend:false` los nombres siguen en el aria-label de la barra, y quien
 *  llama se compromete a nombrarlos al lado (Patrimonio: «Tienes» / «Debes»).
 *  @param {Array<{fam?:string, idle?:boolean, debt?:boolean, value:number, name:string, amount?:string}>} segments
 *  @param {object} [o]
 *  @param {24|8} [o.size]          Por defecto 24.
 *  @param {boolean} [o.legend]     Por defecto true.
 *  @param {string} [o.label]       Nombre de la gráfica para el aria-label.
 *  @param {number} [o.max]         Tope de la barra (p. ej. un límite): con él por encima de la suma,
 *                                  el hueco hasta el tope se queda en la pista.
 *  @returns {string} HTML ("" si ningún segmento tiene valor > 0) */
export function stackedBarHtml(segments, { size = 24, legend = true, label = "", max = 0 } = {}) {
  if (size !== 24 && size !== 8) throw new Error(`stackedBarHtml: size ${size} no es 24 ni 8`);
  const segs = segments ?? [];
  for (const s of segs) {
    if (!s || !s.name || !String(s.name).trim()) throw new Error("stackedBarHtml: cada segmento lleva su nombre (C12)");
  }
  const vivos = segs.filter((s) => Number(s.value) > 0);
  const total = vivos.reduce((a, s) => a + Number(s.value), 0);
  if (!(total > 0)) return "";
  const segCls = (s) => (s.debt ? "is-debt" : isFamily(s.fam) ? famClass(s.fam) : "is-idle");
  // `max` (S10, B-Etiquetas: gasto de una etiqueta frente a su límite): si supera la suma, los
  // segmentos se miden contra él y lo que falta hasta el límite queda como pista (--well de la
  // barra fina). Menor o igual que la suma, o ausente, no cambia nada.
  const denom = Number(max) > total ? Number(max) : total;
  const pct = (v) => Number(((v / denom) * 100).toFixed(3));
  const aria = [label, ...vivos.map((s) => (s.amount ? `${s.name} ${s.amount}` : s.name))].filter(Boolean).join(", ");
  const bar = `<div class="sbar sbar-${size}" role="img" aria-label="${escAttr(aria)}">${vivos
    .map((s) => `<span class="sbar-seg ${segCls(s)}" style="flex-basis:${pct(Number(s.value))}%"></span>`).join("")}</div>`;
  if (!legend) return bar;
  const rows = vivos.map((s) => `<li class="sbar-key${s.idle ? " is-rest" : ""}">`
    + `<span class="sbar-muestra ${segCls(s)}" aria-hidden="true"></span>`
    + `<span class="sbar-name">${escHtml(s.name)}</span>`
    + `${s.amount ? `<span class="num sbar-amt">${escHtml(s.amount)}</span>` : ""}</li>`).join("");
  return `<div class="sbar-wrap">${bar}<ul class="sbar-legend" aria-hidden="true">${rows}</ul></div>`;
}

// ---- Medidor --------------------------------------------------------------------------------

const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const pctStr = (r) => `${Number((r * 100).toFixed(2))}%`;

/** Medidor (DESIGN.md §9, B-GastoCategoria, B-Movimientos): 8 de alto, píldora. Pista --well; sobre
 *  tinte (`onTint`) --chip; dentro del Display (`onDisplay`) --disp-line. Relleno: la barra de la
 *  familia (-b). Sin familia y dentro del Display, el relleno es la línea del gráfico del Display
 *  (ámbar, C2: B-Movimientos y B-GastoCategoria); sin familia fuera del Display, --idle.
 *  Límite opcional: marca de 2 px que sobresale 3, en --text (en el Display, --disp-ink).
 *  @param {object} o
 *  @param {string|null} [o.fam]
 *  @param {number} o.value
 *  @param {number} o.max              <= 0 → relleno vacío (nunca NaN).
 *  @param {number|null} [o.limit]     En la misma unidad que value/max.
 *  @param {boolean} [o.onDisplay]
 *  @param {boolean} [o.onTint]
 *  @param {string} [o.label]          Con label: role="meter" con sus valores; sin él, decorativo
 *                                     (la cifra ya está escrita al lado) y aria-hidden.
 *  @returns {string} HTML */
export function meterHtml({ fam = null, value, max, limit = null, onDisplay = false, onTint = false, label = "" }) {
  const ratio = max > 0 ? clamp01(value / max) : 0;
  const track = onDisplay ? "meter-on-disp" : onTint ? "meter-on-tint" : "";
  const fill = isFamily(fam) ? famClass(fam) : onDisplay ? "disp-chart-line" : "is-idle";
  const lim = limit !== null && limit !== undefined && max > 0
    ? `<span class="meter-limit" style="--at:${pctStr(clamp01(limit / max))}"></span>` : "";
  const a11y = label
    ? ` role="meter" aria-label="${escAttr(label)}" aria-valuemin="0" aria-valuemax="${escAttr(max)}" aria-valuenow="${escAttr(value)}"`
    : ` aria-hidden="true"`;
  return `<div class="meter${track ? ` ${track}` : ""}"${a11y}><span class="meter-fill ${fill}" style="width:${pctStr(ratio)}"></span>${lim}</div>`;
}

// ---- Columnas -------------------------------------------------------------------------------

const COL_TOP = 76;

/** Columnas (DESIGN.md §9, B-Home «Esta semana», B-Semana): radio xs arriba; «hoy» en --text (o en
 *  la barra de su familia con `fam`), el resto en --idle (C11). Encima de la columna, la cifra mono
 *  12/600 cuando trae `amount` (en B-Home, solo hoy). Debajo, la inicial del día; la de hoy en tinta.
 *
 *  Apiladas (B-Semana): un día con `segments` pinta su columna como una pila de tramos por
 *  familia (-b, C6), el mayor abajo, separados 2; la altura sale de `value`. C12: cada tramo lleva
 *  su nombre (sin `name` LANZA), que va también al aria-label de la columna; la leyenda con nombre
 *  la pone la pantalla («Dónde se ha ido»). `selected` hunde la columna en un pozo (--well).
 *  @param {Array<{label:string, value:number, today?:boolean, fam?:string, amount?:string, name?:string,
 *    selected?:boolean, segments?:Array<{fam?:string, value:number, name:string}>}>} days
 *    label: la inicial que se ve («L»); name: el nombre largo para el lector («Lunes 7»).
 *  @param {object} [o]
 *  @param {string} [o.label]    aria-label del grupo (p. ej. «Gasto por día»).
 *  @param {boolean} [o.labels]  Fila de iniciales debajo. Por defecto true; false si la pantalla
 *                               pone su propia fila (los días pulsables de B-Semana).
 *  @param {string|null} [o.restFam]  Familia de las columnas que no son hoy (sin tramos): su barra
 *                               (-b) en vez de --idle. B-Home «Esta semana» usa "otr" (F-10
 *                               retirada, Álvaro 2026-09-27). Por defecto null (--idle).
 *  @returns {string} HTML ("" sin días) */
export function columnsHtml(days, { label = "", labels = true, restFam = null } = {}) {
  const rest = isFamily(restFam) ? famClass(restFam) : "";
  const ds = days ?? [];
  if (!ds.length) return "";
  for (const d of ds) {
    for (const s of d.segments ?? []) {
      if (!s || !s.name || !String(s.name).trim()) throw new Error("columnsHtml: cada tramo lleva su nombre (C12)");
    }
  }
  const max = Math.max(0, ...ds.map((d) => Number(d.value) || 0));
  const h = (v) => {
    if (!(max > 0) || !(v > 0)) return 0;
    // Tope 76 %: la columna más alta deja sitio encima para su cifra 12/600 (B-Home: 52 de 72).
    return Math.max(4, Math.round((v / max) * COL_TOP));
  };
  const stack = (d) => {
    const vivos = (d.segments ?? []).filter((s) => Number(s.value) > 0);
    const total = vivos.reduce((a, s) => a + Number(s.value), 0);
    const height = h(Number(d.value));
    if (!(total > 0) || !height) return `<span class="col-stack" style="height:0%"></span>`;
    // El mayor abajo: la pila se pinta de arriba abajo, así que va en orden ascendente.
    const segs = [...vivos].sort((a, b) => Number(a.value) - Number(b.value)).map((s) =>
      `<span class="col-seg ${isFamily(s.fam) ? famClass(s.fam) : "is-idle"}" style="flex-basis:${Number(((Number(s.value) / total) * 100).toFixed(3))}%"></span>`).join("");
    return `<span class="col-stack" style="height:${height}%">${segs}</span>`;
  };
  const cols = ds.map((d) => {
    const stacked = Array.isArray(d.segments);
    const cls = [
      d.today ? (isFamily(d.fam) ? `is-today has-fam ${famClass(d.fam)}` : "is-today") : rest ? `has-rest-fam ${rest}` : "",
      d.selected ? "is-selected" : "",
    ].filter(Boolean).join(" ");
    const names = stacked ? (d.segments ?? []).filter((s) => Number(s.value) > 0).map((s) => s.name).join(", ") : "";
    const aria = [d.name || d.label, d.amount, names].filter(Boolean).join(" ");
    return `<div class="col${cls ? ` ${cls}` : ""}" role="listitem" aria-label="${escAttr(aria)}">`
      + `${d.amount ? `<span class="num col-amt" aria-hidden="true">${escHtml(d.amount)}</span>` : ""}`
      + `${stacked ? stack(d) : `<span class="col-bar" style="height:${h(Number(d.value))}%"></span>`}</div>`;
  }).join("");
  const row = labels
    ? `<div class="cols-labels" aria-hidden="true">${ds.map((d) => `<span class="${d.today ? "is-today" : ""}">${escHtml(d.label)}</span>`).join("")}</div>`
    : "";
  return `<div class="cols-wrap" style="--n:${ds.length}">
    <div class="cols" role="list"${label ? ` aria-label="${escAttr(label)}"` : ""}>${cols}</div>
    ${row}
  </div>`;
}

// ---- Estado vacío ---------------------------------------------------------------------------

/** Estado vacío (DESIGN.md §9, B-Inicio-Vacio): filas fantasma en pozo (decorativas), título
 *  15/600 y una línea 13/500 dim (una línea de ayuda como mucho, §7). Con `arrow` añade la
 *  flecha discontinua que baja hacia el botón de añadir de la barra de pestañas.
 *  @param {object} o
 *  @param {string} o.title
 *  @param {string} [o.text]
 *  @param {number} [o.rows]       Filas fantasma (0-3). Por defecto 2.
 *  @param {boolean} [o.arrow]
 *  @param {number} [o.arrowHeight]  Largo de la flecha en px (entero 40-200). Por defecto 72; B-Inicio-
 *                                 Vacio la baja 120, hasta el botón de añadir. Fuera de rango, 72.
 *  @returns {string} HTML */
export function emptyStateHtml({ title, text = "", rows = 2, arrow = false, arrowHeight = 72 }) {
  const n = Math.max(0, Math.min(3, rows | 0));
  const ghosts = Array.from({ length: n }, (_, i) => `<div class="ghost-row${i ? " is-faded" : ""}">`
    + `<span class="ghost ghost-ico"></span><span class="ghost-lines"><span class="ghost ghost-l1"></span><span class="ghost ghost-l2"></span></span>`
    + `<span class="ghost ghost-amt"></span></div>`).join("");
  const ah = Number.isInteger(arrowHeight) && arrowHeight >= 40 && arrowHeight <= 200 ? arrowHeight : 72;
  const flecha = arrow
    ? `<svg class="empty-arrow" width="40" height="${ah}" viewBox="0 0 40 ${ah}" aria-hidden="true"><path d="M20 2 L20 ${ah - 8}" stroke-dasharray="3 5"></path><path d="M13 ${ah - 15} L20 ${ah - 7} L27 ${ah - 15}"></path></svg>`
    : "";
  return `<div class="empty">
    ${n ? `<div class="ghost-rows" aria-hidden="true">${ghosts}</div>` : ""}
    <div class="empty-copy">
      <span class="empty-title">${escHtml(title)}</span>
      ${text ? `<span class="empty-text">${escHtml(text)}</span>` : ""}
    </div>
    ${flecha}
  </div>`;
}
