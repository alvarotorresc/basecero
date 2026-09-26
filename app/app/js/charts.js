// Módulo PURO (sin DOM ni imports de db/repo): construye y devuelve strings SVG/HTML para las
// gráficas. Los tests de node lo importan directamente (tests/app/charts.test.mjs).
//
// Sistema B (DESIGN.md C6, C11, C12, PR-07): aquí NO vive ningún color. Cada marca lleva una clase
// y components.css (sección «Instrumento») la pinta: `.chart-bar.fam-<k>` con la barra de su familia
// (fill:var(--fb)), `.chart-bar.is-idle` con el gris neutro --idle (nunca `otr`, C11/I-56), y la
// línea del Display con `.disp-chart-line`. Ni el atributo fill con var() ni un estilo en línea de relleno:
// var() en un atributo de presentación SVG no es fiable y R-INLINE solo deja geometría en línea.
//
// `barChartSvg` y `donutSvg` se borraron en el plan Inicio v2 (Task 10): sin consumidor.
import { famClass, isFamily } from "./category-colors.js";
import { columnsHtml } from "./instrument.js";
import { escHtml } from "./esc.js";

/** Clase de relleno de una marca: la familia si es válida; si no, el gris neutro. */
const markCls = (fam) => (isFamily(fam) ? famClass(fam) : "is-idle");

// ---- sparklineSvg (la línea del Display) --------------------------------------------------

export const SPARK_W = 318, SPARK_H = 72, SPARK_PAD = 4; // PAD = --sp-4: el eje (components.css) lo usa para alinearse

/** Línea del Display (B-Home, B-Patrimonio): área al 12 % + línea de 2,25 en el ámbar del Display
 *  (.disp-chart-line) y el punto de hoy/último (.disp-today) con aro --disp. Filete de base en
 *  --disp-line. Escala uniforme (viewBox sin deformar): el SVG ocupa el ancho del Display y los
 *  círculos siguen redondos.
 *  @param {number[]} points      Valores en la unidad que quiera quien llama (p. ej. céntimos).
 *  @param {object}  [o]
 *  @param {string[]} [o.labels]  Eje (meses): una etiqueta por punto, la última en ámbar. Se escapan.
 *  @param {boolean} [o.dots]     Un punto de 2,5 en cada valor (Patrimonio).
 *  @param {number}  [o.width]
 *  @param {number}  [o.height]
 *  @returns {string} HTML: <div class="disp-chart"><svg>…</svg>[eje]</div> */
export function sparklineSvg(points, { labels = [], dots = false, width = SPARK_W, height = SPARK_H } = {}) {
  const pts = points ?? [];
  const n = pts.length;
  const svgOpen = `<svg class="disp-chart-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">`;
  const base = `<path class="disp-chart-base" d="M0,${height - 1} L${width},${height - 1}" stroke-width="1"></path>`;
  if (n === 0) return `<div class="disp-chart">${svgOpen}${base}</svg></div>`;

  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const range = max - min || 1;
  const stepX = n > 1 ? (width - SPARK_PAD * 2) / (n - 1) : 0;
  const coords = pts.map((v, i) => {
    const x = SPARK_PAD + i * stepX;
    const y = SPARK_PAD + (height - SPARK_PAD * 2) * (1 - (v - min) / range);
    return [Number(x.toFixed(2)), Number(y.toFixed(2))];
  });
  const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const [lastX, lastY] = coords[n - 1];
  const baseY = height - 1;
  const area = `${coords[0][0]},${baseY} ${line} ${lastX},${baseY}`;
  const puntos = dots
    ? coords.slice(0, -1).map(([x, y]) => `<circle class="disp-chart-line is-dot" cx="${x}" cy="${y}" r="2.5"></circle>`).join("")
    : "";
  const svg = `${svgOpen}${base}`
    + `<polygon class="disp-chart-line is-area" points="${area}" fill-opacity="0.12"></polygon>`
    + `<polyline class="disp-chart-line" points="${line}" fill="none" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"></polyline>`
    + puntos
    + `<circle class="disp-today" cx="${lastX}" cy="${lastY}" r="4.5" stroke-width="3"></circle></svg>`;
  const eje = labels.length
    ? `<div class="disp-chart-axis num" style="--n:${labels.length}" aria-hidden="true">${labels
      .map((l, i) => `<span${i === labels.length - 1 ? ' class="disp-today"' : ""}>${escHtml(l)}</span>`).join("")}</div>`
    : "";
  return `<div class="disp-chart">${svg}${eje}</div>`;
}

// ---- periodChartSvg (la línea del periodo del Display de Inicio) ---------------------------

export const PERIOD_W = 318, PERIOD_PAD = 6;
// Alto y cotas de la línea que baja (B-Home: 90 de alto, el presupuesto entero en y=10 y el cero en
// y=86) y de la línea de tiempo plana (B-Inicio-Vacio: 40 de alto, la línea en y=14, rótulos en 36).
const BURN = { H: 90, TOP: 10, BOTTOM: 86 };
const FLAT = { H: 40, Y: 14, LABEL_Y: 36 };
// Un rótulo de 12 en mono ocupa ~7,2 px por carácter: más cerca del borde derecho que esto, el de
// «hoy» se pone a la izquierda del punto y el del final del periodo se calla para no pisarse.
const LABEL_ROOM = 64;

const r2 = (n) => Number(n.toFixed(2));

/** Línea del periodo dentro del Display de Inicio (DESIGN.md §9 Display: «la línea del gráfico y el
 *  marcador de hoy», C2). El eje X es el PERIODO ENTERO, no solo los días que han pasado: hoy cae
 *  donde toca (día 13 de 30 → al 43 %), a diferencia de sparklineSvg, que reparte sus puntos por
 *  todo el ancho. Dos modos:
 *   - Con `values` y `max` > 0 (B-Home): lo que queda del presupuesto día a día. values[0] es el
 *     inicio del periodo (el presupuesto entero) y values[k], lo que queda al cerrar el día k; el
 *     último es hoy. La guía discontinua va de `max` al cero en el último día: el ritmo parejo.
 *   - Sin ellos (B-Inicio-Vacio): una línea de tiempo plana con el punto en el día de hoy.
 *  En los dos modos hoy está en el mismo x: el final del día `today` (k = today sobre `days`).
 *  Sin color en el HTML: .disp-chart-guide (--disp-dim), .disp-chart-line y .disp-today (ámbar,
 *  C2) y .disp-chart-label (--disp-dim) los pinta components.css.
 *  @param {object} o
 *  @param {number} o.days             Días del periodo (expectedPeriodDays).
 *  @param {number} o.today            Día de hoy dentro del periodo, 1-based (dayIndexOfPeriod).
 *  @param {number[]|null} [o.values]  Serie de lo que queda, del inicio a hoy.
 *  @param {number} [o.max]            El presupuesto: la cota de arriba. Lo que se sale se recorta.
 *  @param {string} [o.todayLabel]     «hoy». Se escapa.
 *  @param {string} [o.endLabel]       «día 30». Se escapa.
 *  @param {number} [o.width]
 *  @returns {string} HTML: <div class="disp-chart"><svg>…</svg></div> */
export function periodChartSvg({ days, today, values = null, max = 0, todayLabel = "", endLabel = "", width = PERIOD_W }) {
  const vals = Array.isArray(values) ? values.filter((v) => Number.isFinite(v)) : [];
  const burn = vals.length > 0 && max > 0;
  const H = burn ? BURN.H : FLAT.H;
  const svgOpen = `<svg class="disp-chart-svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" aria-hidden="true">`;
  const label = (x, y, text, anchor) => (text
    ? `<text class="disp-chart-label" x="${r2(x)}" y="${y}" text-anchor="${anchor}">${escHtml(text)}</text>` : "");
  const inner = width - PERIOD_PAD * 2;

  if (!burn) {
    // Mismo sitio para «hoy» que en la línea que baja: el final del día `today` sobre `days`.
    const span = Math.max(1, days | 0, today | 0);
    const x = PERIOD_PAD + (inner * Math.max(0, today | 0)) / span;
    const nearEnd = x > width - LABEL_ROOM;
    return `<div class="disp-chart">${svgOpen}`
      + `<path class="disp-chart-guide" d="M${PERIOD_PAD},${FLAT.Y} L${width - PERIOD_PAD},${FLAT.Y}" fill="none" stroke-width="1.25"></path>`
      + `<circle class="disp-today" cx="${r2(x)}" cy="${FLAT.Y}" r="4.5" stroke-width="3"></circle>`
      + label(nearEnd ? x + 4.5 : x - 4.5, FLAT.LABEL_Y, todayLabel, nearEnd ? "end" : "start")
      + (nearEnd ? "" : label(width, FLAT.LABEL_Y, endLabel, "end"))
      + `</svg></div>`;
  }

  const span = Math.max(1, days | 0, vals.length - 1);
  const xOf = (k) => PERIOD_PAD + (inner * k) / span;
  const yOf = (v) => BURN.TOP + (BURN.BOTTOM - BURN.TOP) * (1 - Math.min(1, Math.max(0, v / max)));
  const coords = vals.map((v, k) => [r2(xOf(k)), r2(yOf(v))]);
  const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const [lastX, lastY] = coords[coords.length - 1];
  const area = `${coords[0][0]},${H} ${line} ${lastX},${H}`;
  const nearEnd = lastX > width - LABEL_ROOM;
  return `<div class="disp-chart">${svgOpen}`
    + `<path class="disp-chart-guide" d="M${r2(xOf(0))},${BURN.TOP} L${r2(xOf(span))},${BURN.BOTTOM}" fill="none" stroke-width="1.25"></path>`
    + `<polygon class="disp-chart-line is-area" points="${area}" fill-opacity="0.12"></polygon>`
    + `<polyline class="disp-chart-line" points="${line}" fill="none" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"></polyline>`
    + `<circle class="disp-today" cx="${lastX}" cy="${lastY}" r="4.5" stroke-width="3"></circle>`
    + label(nearEnd ? lastX - 11 : lastX + 11, r2(lastY + 4), todayLabel, nearEnd ? "end" : "start")
    + (nearEnd ? "" : label(width - PERIOD_PAD, BURN.BOTTOM - 8, endLabel, "end"))
    + `</svg></div>`;
}

// ---- netWorthBarsHtml (COMPATIBILIDAD: Patrimonio aún en PENDIENTES) ----------------------

/** Evolución del patrimonio en columnas: las últimas ≤6, alturas por el valor absoluto, la actual
 *  en --text y las anteriores en --idle (columnsHtml, §9 Columnas). "" con <2 puntos. Firma de
 *  «Neto» mantenida para screens/patrimonio.js; en B, Patrimonio pinta la evolución con
 *  sparklineSvg dentro del Display, y esta función se borra con la migración de esa pantalla.
 *  Sistema B: un cierre negativo ya NO se pinta en rojo (C4: el rojo solo va en cifras).
 *  @param {Array<{label:string, cents:number}>} series */
export function netWorthBarsHtml(series) {
  const pts = (series ?? []).slice(-6);
  if (pts.length < 2) return "";
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  return columnsHtml(pts.map((p, i) => ({
    label: cap(String(p.label)),
    value: Math.abs(p.cents),
    today: i === pts.length - 1,
  })));
}

// ---- barRowsGeometry / categoryBarsSvg / comparisonBarsSvg (Informe del periodo) --------------
// LA garantía de que el PDF y la pantalla no divergen: los dos presentadores del informe
// (screens/informe.js con <svg>, informe-pdf.js con drawRectangle) consumen la MISMA geometría.

/** Geometría pura de una lista de barras horizontales, en coordenadas de un lienzo
 *  w×(n·rowH). NO devuelve SVG ni HTML: devuelve números.
 *  rows: [{ key, value, max, fam?, color? }] -> [{ key, fam, color, x, y, w, h, trackW }]
 *  (la pantalla pinta con `fam`; el PDF, informe-pdf.js, con `color`: los dos pasan tal cual)
 *  Anchos SIEMPRE acotados a 0..width (un valor negativo, o un max<=0, dan w:0 — nunca NaN, mismo
 *  criterio que category-spend.js#relativeWidth). trackFill controla si se devuelve el ancho de
 *  la pista de fondo (trackW=width) o no (trackW=0) — quien pinta decide si la dibuja. */
// `gap` no participa en la geometría de CADA fila (rowH ya reserva el hueco entre filas); se
// acepta en las opciones igualmente para que la firma cubra lo que layoutReport (informe-pdf.js)
// necesita pasarle junto al resto de opciones de layout de una tacada.
export function barRowsGeometry(rows, { width, rowH, barH, trackFill = true }) {
  return (rows ?? []).map((r, i) => {
    const ratio = r.max > 0 ? Math.min(1, Math.max(0, r.value / r.max)) : 0;
    return {
      key: r.key,
      fam: r.fam,
      color: r.color,
      x: 0,
      y: i * rowH,
      w: width * ratio,
      h: barH,
      trackW: trackFill ? width : 0,
    };
  });
}

/** Barras horizontales por categoría, listas para innerHTML: un <rect> por fila con la barra de
 *  su familia (`.chart-bar.fam-<k>`, C6) o --idle sin familia. `rows`: el shape de barRowsGeometry
 *  con `fam` (clave de category-colors.js) en vez de color. */
export function categoryBarsSvg(rows, opts) {
  const geo = barRowsGeometry(rows, opts);
  const height = geo.length ? Math.max(...geo.map((g) => g.y + g.h)) : 0;
  const rects = geo.map((g) => `<rect class="chart-bar ${markCls(g.fam)}" x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="3"></rect>`).join("");
  return `<svg width="${opts.width}" height="${height}" viewBox="0 0 ${opts.width} ${height}" aria-hidden="true">${rects}</svg>`;
}

/** Comparativa de dos periodos: por fila, la barra del periodo actual en su familia y, debajo y
 *  más fina, la del anterior en --idle (C11: las comparativas van en gris neutro) — a la MISMA
 *  escala (el máximo de LOS DOS valores de esa fila, nunca dos escalas distintas).
 *  `rows`: [{ key, value, prevValue, fam }]. Sin `prevValue` (null/undefined) no se emite la
 *  segunda barra: es el caso de "sin periodo anterior" (spec §5.5). */
export function comparisonBarsSvg(rows, { width, rowH, barH, gap = 0 }) {
  const height = (rows ?? []).length * rowH;
  const prevBarH = Math.max(2, Math.round(barH * 0.4));
  const body = (rows ?? []).map((r, i) => {
    const hasPrev = r.prevValue !== null && r.prevValue !== undefined;
    const max = Math.max(r.value, hasPrev ? r.prevValue : 0);
    const ratio = (v) => (max > 0 ? Math.min(1, Math.max(0, v / max)) : 0);
    const y = i * rowH;
    let svg = `<rect class="chart-bar ${markCls(r.fam)}" x="0" y="${y}" width="${width * ratio(r.value)}" height="${barH}" rx="3"></rect>`;
    if (hasPrev) {
      const prevY = y + barH + gap;
      svg += `<rect class="chart-bar is-idle" x="0" y="${prevY}" width="${width * ratio(r.prevValue)}" height="${prevBarH}" rx="2"></rect>`;
    }
    return svg;
  }).join("");
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">${body}</svg>`;
}

// ---- trendOf / trendSvg (Etiquetas, N3: mini tendencia de 3 periodos, SISTEMA §4.19) ----------

export const TREND_H = 18, TREND_W = 4, TREND_GAP = 3, TREND_MIN_H = 2;

/** Alturas en px de la mini tendencia de 3 periodos. PURA: devuelve números, no SVG.
 *  values: céntimos del MÁS ANTIGUO al MÁS RECIENTE (jul, ago, sep).
 *  null cuando no hay nada que dibujar: menos de 2 valores, o max <= 0 (una raíz con más
 *  devoluciones que gasto existe — el mismo caso que documenta relativeWidth, category-spend.js).
 *  Escala: h = round(v / max * 18), con max = el MAYOR de la serie (no el actual) — Alimentación
 *  (etiquetas-design §8.2) es la fila que lo demuestra: su barra de 18px es la de AGOSTO. */
export function trendOf(values) {
  const vals = values ?? [];
  if (vals.length < 2) return null;
  const max = Math.max(...vals);
  if (!(max > 0)) return null;
  const heights = vals.map((v) => {
    const h = Math.round((v / max) * TREND_H);
    // Una barra invisible se lee como "no hay dato" en vez de "casi nada" (TREND_MIN_H no es una
    // copia: precedente BAR_MIN_H/netWorthBarsHtml en este mismo módulo).
    return v > 0 && h <= 0 ? TREND_MIN_H : Math.max(0, h);
  });
  return { heights, max };
}

/** Las barras de trendOf: las anteriores al 45 % de opacidad y la ÚLTIMA (la actual) a opacidad
 *  plena, en la barra de la familia de la categoría (o --idle sin familia). Devuelve "" cuando
 *  trendOf da null: quien llama interpola sin condicional.
 *  @param {number[]} values
 *  @param {string|null} fam   Clave de familia (category-colors.js#familyForCategory). */
export function trendSvg(values, fam) {
  const t = trendOf(values);
  if (!t) return "";
  const n = t.heights.length;
  const width = n * TREND_W + (n - 1) * TREND_GAP;
  const cls = markCls(fam);
  const bars = t.heights.map((h, i) => {
    const x = i * (TREND_W + TREND_GAP);
    const y = TREND_H - h;
    const isLast = i === n - 1;
    const opacityAttr = isLast ? "" : ` fill-opacity="0.45"`;
    return `<rect class="chart-bar ${cls}" x="${x}" y="${y}" width="${TREND_W}" height="${h}"${opacityAttr}></rect>`;
  }).join("");
  return `<svg width="${width}" height="${TREND_H}" viewBox="0 0 ${width} ${TREND_H}" aria-hidden="true">${bars}</svg>`;
}
