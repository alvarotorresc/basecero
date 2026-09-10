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
