// Módulo PURO (sin DOM ni imports de db/repo): construye y devuelve strings SVG/HTML para las
// gráficas de Inicio (Task 12) y del detalle de cuenta (sparklineSvg, Task 13). Esto permite que
// los tests de node importen el módulo directamente, sin worker ni DOM (ver tests/app/charts.test.mjs).

const fmtNumEs = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const centsToStr = (cents) => fmtNumEs.format((cents ?? 0) / 100);

// ---- barChartSvg ----------------------------------------------------------

const BAR_AREA_H = 124; // alto del área de barras, igual que design/Resumen.dc.html:73
const BAR_MAX_H = 100;  // tope de la barra más alta — deja hueco arriba para la etiqueta de la activa
const BAR_MIN_H = 3;    // alto mínimo visible para un día sin gasto (evita una barra invisible)
const BAR_INACTIVE_COLOR = "#223252";

/** Tarjeta "Flujo de gasto": grid de N barras `align-items:end` + fila de iniciales de día
 *  debajo — réplica de design/Resumen.dc.html:73-106. Sin ejes.
 *  days: [{label, cents, active}] — la barra `active` (hoy) usa el color de acento y muestra el
 *  importe encima; el resto van en gris y sin etiqueta. La escala es relativa al día de mayor
 *  gasto del propio array (ese día ocupa el 100% de BAR_MAX_H). */
export function barChartSvg(days) {
  const maxCents = Math.max(0, ...days.map((d) => Math.max(0, d.cents ?? 0)));
  const scale = maxCents > 0 ? BAR_MAX_H / maxCents : 0;

  const barsHtml = days.map((d) => {
    const cents = Math.max(0, d.cents ?? 0);
    const h = Math.max(BAR_MIN_H, Math.round(cents * scale));
    const fillColor = d.active ? "var(--accent)" : BAR_INACTIVE_COLOR;
    const labelHtml = d.active
      ? `<div class="flujo-bar-label" style="font-size:10px;font-weight:700;color:var(--accent);text-align:center;font-variant-numeric:tabular-nums;">${centsToStr(cents)}</div>`
      : "";
    return `
      <div class="flujo-bar${d.active ? " flujo-bar--active" : ""}" data-cents="${cents}"
        style="display:flex;flex-direction:column;align-items:stretch;justify-content:flex-end;gap:6px;">
        ${labelHtml}
        <div class="flujo-bar-fill${d.active ? " flujo-bar-fill--active" : ""}"
          style="height:${h}px;background:${fillColor};border-radius:12px;"></div>
      </div>`;
  }).join("");

  const labelsHtml = days.map((d) => `
    <div class="flujo-day-label${d.active ? " flujo-day-label--active" : ""}"
      style="font-size:11px;text-align:center;${d.active ? "font-weight:700;color:#e7e9ec;" : "color:#656c74;"}">${d.label}</div>`).join("");

  return `
    <div style="display:grid;grid-template-columns:repeat(${days.length},minmax(0,1fr));gap:10px;height:${BAR_AREA_H}px;align-items:end;">${barsHtml}
    </div>
    <div style="display:grid;grid-template-columns:repeat(${days.length},minmax(0,1fr));gap:10px;">${labelsHtml}
    </div>`;
}

// ---- donutSvg ---------------------------------------------------------

const DONUT_R = 54;
const DONUT_CIRC = 2 * Math.PI * DONUT_R;

/** Tarjeta "Gasto por categoría": SVG 140×140, r=54, stroke 20, arcos con
 *  stroke-dasharray/stroke-dashoffset rotados −90° (empiezan arriba, avanzan en sentido horario)
 *  — réplica de design/Resumen.dc.html:119-137. slices: [{color, cents}], ya en el orden en que
 *  deben pintarse. centerTitle/centerSub: texto ya formateado por quien llama (p.ej. "1.762,40"
 *  / "EUR gastados") — este módulo no conoce fmtEUR ni ninguna moneda. */
export function donutSvg(slices, centerTitle, centerSub) {
  const total = slices.reduce((s, sl) => s + Math.max(0, sl.cents ?? 0), 0);

  let arcsHtml;
  if (total > 0) {
    let offset = 0;
    arcsHtml = slices.filter((sl) => (sl.cents ?? 0) > 0).map((sl) => {
      const len = (sl.cents / total) * DONUT_CIRC;
      const circle = `<circle cx="70" cy="70" r="${DONUT_R}" stroke="${sl.color}"
        stroke-dasharray="${len.toFixed(2)} ${(DONUT_CIRC - len).toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}"></circle>`;
      offset += len;
      return circle;
    }).join("");
  } else {
    // Sin gasto todavía: anillo neutro completo en vez de dividir por cero.
    arcsHtml = `<circle cx="70" cy="70" r="${DONUT_R}" stroke="${BAR_INACTIVE_COLOR}"
      stroke-dasharray="${DONUT_CIRC.toFixed(2)} 0" stroke-dashoffset="0"></circle>`;
  }

  return `
    <div style="display:grid;width:140px;height:140px;flex-shrink:0;">
      <svg width="140" height="140" viewBox="0 0 140 140" style="grid-area:1 / 1;">
        <g transform="rotate(-90 70 70)" fill="none" stroke-width="20">${arcsHtml}
        </g>
      </svg>
      <div style="grid-area:1 / 1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;">
        <div class="num" style="font-size:16px;font-weight:600;font-variant-numeric:tabular-nums;">${centerTitle}</div>
        <div style="font-size:9px;color:#656c74;">${centerSub}</div>
      </div>
    </div>`;
}

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
