// Módulo PURO (sin DOM ni imports de db/repo): construye y devuelve strings SVG/HTML para las
// gráficas de Patrimonio (sparklineSvg, netWorthBarsHtml). Esto permite que los tests de node
// importen el módulo directamente, sin worker ni DOM (ver tests/app/charts.test.mjs).
//
// `barChartSvg` (Flujo de gasto) y `donutSvg` (donut de Gasto por categoría) vivieron aquí hasta
// el plan Inicio v2 (2026-09-10): la Task 9 sustituyó sus dos únicos consumidores —los dos en
// inicio.js— por la espina de semana-logic.js y las barras horizontales de I3, y el sistema v2
// («Neto») no tiene ninguna rueda en ninguna de sus pantallas, así que no van a volver. Se
// borraron aquí en la Task 10 junto con sus tests y sus constantes privadas (STANDARDS §6: si no
// se usa, se borra) — ninguna de las dos funciones restantes (sparklineSvg, netWorthBarsHtml)
// formatea números, así que el import de fmtNum2/fmtNum0 se fue con ellas.

// ---- sparklineSvg -------------------------------------------------------

const SPARK_W = 300, SPARK_H = 60, SPARK_PAD = 4;

/** Sparkline compacto: polyline + polígono de relleno (bajo la línea) + círculo en el último
 *  punto. La usa Task 13 (tendencia de saldo de una cuenta). points: valores numéricos ya en la
 *  unidad que quiera quien llama (p.ej. cents); labels: paralelo a points, mismo tamaño — no se
 *  pinta aquí dentro (este módulo no compone tooltips/eje), se recibe solo para fijar ya la
 *  firma completa que necesitará Task 13 (evita tener que cambiarla cuando la integre). */
export function sparklineSvg(points, labels = []) {
  const n = points.length;
  if (n === 0) return `<svg width="${SPARK_W}" height="${SPARK_H}" viewBox="0 0 ${SPARK_W} ${SPARK_H}"></svg>`;

  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const stepX = n > 1 ? (SPARK_W - SPARK_PAD * 2) / (n - 1) : 0;
  const coords = points.map((v, i) => {
    const x = SPARK_PAD + i * stepX;
    const y = SPARK_PAD + (SPARK_H - SPARK_PAD * 2) * (1 - (v - min) / range);
    return [Number(x.toFixed(2)), Number(y.toFixed(2))];
  });
  const pointsAttr = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const [lastX, lastY] = coords[n - 1];
  const baseY = SPARK_H - SPARK_PAD;
  const polygonPoints = `${SPARK_PAD},${baseY} ${pointsAttr} ${SPARK_W - SPARK_PAD},${baseY}`;

  return `
    <svg width="${SPARK_W}" height="${SPARK_H}" viewBox="0 0 ${SPARK_W} ${SPARK_H}" preserveAspectRatio="none">
      <polygon points="${polygonPoints}" fill="var(--accent)" fill-opacity="0.12" stroke="none"></polygon>
      <polyline points="${pointsAttr}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>
      <circle cx="${lastX}" cy="${lastY}" r="3" fill="var(--accent)"></circle>
    </svg>`;
}

// ---- netWorthBarsHtml -----------------------------------------------------

// Evolución del patrimonio en barras (artboard Patrimonio.dc.html:31-39): últimas ≤6,
// alturas relativas al máximo absoluto, la actual en verde, etiquetas MAYÚSCULAS con la
// actual resaltada. Sin eje Y ni valores sobre las barras, como el artboard. "" con <2 puntos.
export function netWorthBarsHtml(series) {
  const pts = series.slice(-6);
  if (pts.length < 2) return "";
  const max = Math.max(...pts.map((p) => Math.abs(p.cents)), 1);
  const bars = pts.map((p, i) => {
    const h = Math.max(6, Math.round((Math.abs(p.cents) / max) * 100));
    const last = i === pts.length - 1;
    // Task 7 (5a): un cierre negativo se tiñe de rojo con prioridad sobre el verde de "última
    // barra" — un patrimonio negativo es la señal más urgente, aunque sea el punto más reciente.
    const fill = p.cents < 0 ? "var(--red)" : (last ? "var(--green)" : "var(--card2)");
    return `<div style="flex:1;height:${h}%;border-radius:5px 5px 2px 2px;background:${fill};"></div>`;
  }).join("");
  const labels = pts.map((p, i) =>
    `<span style="${i === pts.length - 1 ? "color:var(--text);font-weight:700;" : ""}">${String(p.label).toUpperCase()}</span>`).join("");
  return `
  <div style="display:flex;align-items:flex-end;gap:5px;height:44px;margin-top:10px;">${bars}</div>
  <div class="num" style="display:flex;justify-content:space-between;font-size:9.5px;color:var(--text-2);margin-top:6px;">${labels}</div>`;
}

// ---- barRowsGeometry / categoryBarsSvg / comparisonBarsSvg (Informe del periodo) --------------
// LA garantía de que el PDF y la pantalla no divergen: los dos presentadores del informe
// (screens/informe.js con <svg>, informe-pdf.js con drawRectangle) consumen la MISMA geometría.

/** Geometría pura de una lista de barras horizontales, en coordenadas de un lienzo
 *  w×(n·rowH). NO devuelve SVG ni HTML: devuelve números.
 *  rows: [{ key, value, max, color }] -> [{ key, color, x, y, w, h, trackW }]
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
      color: r.color,
      x: 0,
      y: i * rowH,
      w: width * ratio,
      h: barH,
      trackW: trackFill ? width : 0,
    };
  });
}

/** Barras horizontales por categoría, listas para innerHTML: un <rect> por fila, con el color
 *  de esa categoría. `rows`: el mismo shape que barRowsGeometry. */
export function categoryBarsSvg(rows, opts) {
  const geo = barRowsGeometry(rows, opts);
  const height = geo.length ? Math.max(...geo.map((g) => g.y + g.h)) : 0;
  const rects = geo.map((g) => `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="3" fill="${g.color}"></rect>`).join("");
  return `<svg width="${opts.width}" height="${height}" viewBox="0 0 ${opts.width} ${height}">${rects}</svg>`;
}

/** Comparativa de dos periodos: por fila, la barra del periodo actual y, debajo y atenuada, la
 *  del anterior — a la MISMA escala (el máximo de LOS DOS valores de esa fila, nunca dos escalas
 *  distintas). `rows`: [{ key, value, prevValue, color }]. Sin `prevValue` (null/undefined) no se
 *  emite la segunda barra: es el caso de "sin periodo anterior" (spec §5.5). */
export function comparisonBarsSvg(rows, { width, rowH, barH, gap = 0 }) {
  const height = (rows ?? []).length * rowH;
  const prevBarH = Math.max(2, Math.round(barH * 0.4));
  const body = (rows ?? []).map((r, i) => {
    const hasPrev = r.prevValue !== null && r.prevValue !== undefined;
    const max = Math.max(r.value, hasPrev ? r.prevValue : 0);
    const ratio = (v) => (max > 0 ? Math.min(1, Math.max(0, v / max)) : 0);
    const y = i * rowH;
    let svg = `<rect x="0" y="${y}" width="${width * ratio(r.value)}" height="${barH}" rx="3" fill="${r.color}"></rect>`;
    if (hasPrev) {
      const prevY = y + barH + gap;
      svg += `<rect x="0" y="${prevY}" width="${width * ratio(r.prevValue)}" height="${prevBarH}" rx="2" fill="${r.color}" fill-opacity="0.35"></rect>`;
    }
    return svg;
  }).join("");
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
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
 *  plena, en el color de la categoría. Devuelve "" cuando trendOf da null: quien llama interpola
 *  sin condicional. */
export function trendSvg(values, color) {
  const t = trendOf(values);
  if (!t) return "";
  const n = t.heights.length;
  const width = n * TREND_W + (n - 1) * TREND_GAP;
  const bars = t.heights.map((h, i) => {
    const x = i * (TREND_W + TREND_GAP);
    const y = TREND_H - h;
    const isLast = i === n - 1;
    const opacityAttr = isLast ? "" : ` fill-opacity="0.45"`;
    return `<rect x="${x}" y="${y}" width="${TREND_W}" height="${h}" fill="${color}"${opacityAttr}></rect>`;
  }).join("");
  return `<svg width="${width}" height="${TREND_H}" viewBox="0 0 ${width} ${TREND_H}">${bars}</svg>`;
}
