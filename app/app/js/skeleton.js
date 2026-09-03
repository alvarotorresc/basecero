/** Silueta gris del primer pintado de una pantalla (Inicio y Movimientos): bloques con la forma
 *  de las tarjetas que van a llegar, para que el arranque no sea una pantalla en blanco.
 *
 *  Módulo PURO (devuelve un string, igual que charts.js): sin DOM, testeable en Node.
 *
 *  Solo se pinta en el PRIMER render de cada pantalla — quien llama lo decide con
 *  container.dataset.screen, ver inicio.js/movimientos.js. El pulso vive en app.css (.skeleton) y
 *  se apaga con prefers-reduced-motion. */

/** heights: alturas en px, una por bloque, de arriba abajo. */
export function skeletonHtml(heights) {
  const bloques = (heights ?? []).map((h) => {
    // Acotado: width/height negativos o NaN son declaraciones CSS inválidas que el navegador
    // descarta, dejando el bloque con la altura del contenido (cero) o sin altura ninguna.
    const px = Number.isFinite(h) ? Math.max(0, Math.round(h)) : 0;
    return `<div class="skeleton" style="height:${px}px;"></div>`;
  }).join("");
  return `<div aria-hidden="true" style="display:flex;flex-direction:column;gap:16px;">${bloques}</div>`;
}
