/** Repertorio de iconos de UI (SISTEMA.md §3): SVG de trazo, viewBox 0 0 24 24, fill none,
 *  stroke currentColor, stroke-width 1.75, linecap/linejoin round. Módulo PURO — sin imports,
 *  sin DOM: devuelve HTML, como charts.js.
 *
 *  Existe porque hoy hay CATORCE copias del icono «atrás» repartidas por once pantallas, con dos
 *  paths distintos (`M15 5 8 12l7 7`, el de §3, y `M19 12H5M12 19l-7-7 7-7`, que no está en el
 *  repertorio) y tres stroke-width distintos. Un icono, un sitio.
 *
 *  Los emoji de categoría NO están aquí: son datos (category-colors.js#CATEGORY_ICONS) y §2.2
 *  prohíbe mezclar las dos familias en el mismo sitio. Los cuatro de la tab bar tampoco: son
 *  SVG literal en index.html y ya salen de §3. */

// `d` copiado VERBATIM de la tabla de §3. Las tres entradas marcadas «(artboard)» no están en esa
// tabla pero sí en los .dc.html; ver «Decisiones de diseñador» D3 de la spec.
export const ICON_PATHS = {
  back:         '<path d="M15 5 8 12l7 7"/>',
  close:        '<path d="M6 6l12 12M18 6 6 18"/>',
  chevronRight: '<path d="M9.5 5 16 12l-6.5 7"/>',
  chevronDown:  '<path d="M5 9.5 12 16l7-6.5"/>',
  plus:         '<path d="M12 5v14M5 12h14"/>',
  minus:        '<path d="M5 12h14"/>',
  check:        '<path d="M5 12.5 10 17.5 19 7"/>',
  warn:         '<path d="M12 4.5 21 19.5H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  tag:          '<path d="M4 11V4h7l9 9-7 7z"/><circle cx="8" cy="8" r="1.2"/>',
  calendar:     '<rect x="3.5" y="5" width="17" height="15.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  download:     '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15"/>',
  trash:        '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  pencil:       '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  repeat:       '<path d="M4 9h13l-3.5-3.5M20 15H7l3.5 3.5"/>',
  filter:       '<path d="M4 6h16l-6.2 7.2V19l-3.6-2v-3.8z"/>',
  lock:         '<rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
  trendUp:      '<path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/>',
  trendDown:    '<path d="M12 5v13M6.5 12.5 12 18l5.5-5.5"/>',
  camera:       '<path d="M3 8.5h3.5L8 6h8l1.5 2.5H21v11H3z"/><circle cx="12" cy="13.5" r="3.5"/>',
  mic:          '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 12a6.5 6.5 0 0 0 13 0M12 18.5V21"/>',
  // (artboard) asa de arrastre — Categorias.dc.html:41
  drag:         '<path d="M6 9h12M6 15h12"/>',
  // (artboard) fichero elegido — ImportAsistente.dc.html:26
  file:         '<path d="M13 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V9z"/><path d="M13 3v6h6M8.5 13h7M8.5 16.5h7"/>',
  // (artboard) transferencia entre cuentas — hoy movimientos.js:57
  transfer:     '<path d="M7 10l-3 3 3 3M4 13h13M17 8l3-3-3-3M20 5H7"/>',
};

/** SVG listo para pegar. `size` en px (20 dentro de fila o botón, 24 en cabecera, 16 dentro de la
 *  casilla o del chevron pequeño). `stroke` solo se pasa cuando el icono NO puede heredar el color
 *  del contenedor (dentro de una insignia tintada, por ejemplo); por defecto currentColor, que es
 *  lo que quiere §3. `width` es el grosor de trazo: 1.75 salvo la casilla (2.6) y la flecha de
 *  tendencia (2.2), los dos valores que los artboards escriben a mano. */
export function icon(name, { size = 20, width = 1.75, stroke = "currentColor", cls = "", style = "" } = {}) {
  const d = ICON_PATHS[name];
  if (!d) return "";           // defensivo: un nombre mal escrito no debe romper la pantalla
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${stroke}"`
    + ` stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`
    + `${cls ? ` class="${cls}"` : ""}${style ? ` style="${style}"` : ""}>${d}</svg>`;
}
