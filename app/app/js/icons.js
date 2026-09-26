/** Repertorio de iconos de UI (SISTEMA.md §3): SVG de trazo, viewBox 0 0 24 24, fill none,
 *  stroke currentColor, stroke-width 1.75, linecap/linejoin round. Módulo PURO — sin imports,
 *  sin DOM: devuelve HTML, como charts.js.
 *
 *  Existe porque hoy hay CATORCE copias del icono «atrás» repartidas por once pantallas, con dos
 *  paths distintos (`M15 5 8 12l7 7`, el de §3, y `M19 12H5M12 19l-7-7 7-7`, que no está en el
 *  repertorio) y tres stroke-width distintos. Un icono, un sitio.
 *
 *  Los iconos de categoría (PR-04) viven aparte, en CAT_ICONS: son DATOS (la clave se guarda en
 *  meta.category_style) y no piezas de interfaz. Los cuatro de la tab bar tampoco están aquí: son
 *  SVG literal en index.html. */
import { escAttr } from "./esc.js";

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

// ---- Iconos de categoría (PR-04) --------------------------------------------------------------
// La clave es un DATO: se guarda en meta.category_style ({fam, icon}) y la valida
// repo.setCategoryStyle. Los 12 primeros son los de las familias (B-Gasto.dc.html, rejilla de
// baldosas; la clave coincide con la de la familia) y los 6 siguientes, los del selector de
// B-Categorias-Nueva.dc.html. Los `d` están copiados TAL CUAL de esos ficheros (solo cambia el
// cierre `></path>` por `/>`). El ORDEN es el del selector de la pantalla de edición.
export const CAT_ICONS = {
  casa:     '<path d="M4 11l8-6.5 8 6.5v8.5a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  ali:      '<path d="M4 9.5h16l-1.6 9.5H5.6z"/><path d="M8.5 9.5l3-5.5M15.5 9.5l-3-5.5"/>',
  res:      '<path d="M5 9h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5v3M12 3.5v3"/>',
  tra:      '<rect x="5" y="3.5" width="14" height="14" rx="3"/><path d="M5 11h14M8 20.5v-3M16 20.5v-3M8.5 14.5h.01M15.5 14.5h.01"/>',
  coc:      '<path d="M3.5 15l2-6h13l2 6v3h-17z"/><path d="M3.5 13h17M7 18v2M17 18v2"/>',
  sal:      '<path d="M3 12h4l2-4 3 8 2-4h7"/>',
  sus:      '<path d="M4.5 10a7.5 7.5 0 0 1 13.4-3.2L20 9M19.5 14a7.5 7.5 0 0 1-13.4 3.2L4 15"/><path d="M20 4.5V9h-4.5M4 19.5V15h4.5"/>',
  oci:      '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14 7.5v2M14 11v2M14 14.5v2"/>',
  rop:      '<path d="M8.5 4L3.5 7l2 4 2.5-1v10h8V10l2.5 1 2-4-5-3a3.5 3.5 0 0 1-7 0z"/>',
  reg:      '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18M12 9v11M12 9C10.5 5.5 7 5 7 7.2 7 9 12 9 12 9s5 0 5-1.8C17 5 13.5 5.5 12 9z"/>',
  imp:      '<path d="M6 3h9l3 3v15H6z"/><path d="M9 16l6-6"/><circle cx="9.5" cy="10.5" r="1"/><circle cx="14.5" cy="15.5" r="1"/>',
  otr:      '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
  huella:   '<ellipse cx="12" cy="16" rx="4.5" ry="3.8"/><circle cx="6" cy="10.5" r="1.8"/><circle cx="9.5" cy="6.5" r="1.8"/><circle cx="14.5" cy="6.5" r="1.8"/><circle cx="18" cy="10.5" r="1.8"/>',
  hoja:     '<path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14zM5 19l7-7"/>',
  libro:    '<path d="M4 5.5h6a2 2 0 0 1 2 2V19a2 2 0 0 0-2-2H4zM20 5.5h-6a2 2 0 0 0-2 2V19a2 2 0 0 1 2-2h6z"/>',
  nota:     '<path d="M9 17.5V5.5l10-2v12"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>',
  avion:    '<path d="M3 13.5l18-7-5 14-3.5-5.5z"/><path d="M12.5 15L21 6.5"/>',
  estrella: '<path d="M12 4l2.5 5.2 5.5.7-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.5-.7z"/>',
};

// Ingreso (ficha en --well, C9: B-Importar.dc.html, «Intereses de ahorro») y etiqueta (B-Gasto /
// B-Borrar, «Oficina»). No son elegibles en el selector —un ingreso no tiene familia y una
// etiqueta no es una categoría—, por eso no están en CAT_ICONS, pero se pintan con catIcon().
const ENTITY_ICONS = {
  income: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  tag:    '<path d="M3.5 12.5V4.5h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.3"/>',
};

/** SVG de un icono de categoría, de ingreso o de etiqueta. Mismo trazo que icon(). `size` en px o
 *  cualquier longitud CSS válida en un atributo (p. ej. "1em", para sustituir a un emoji que
 *  heredaba el font-size). Con `label` el SVG deja de ser decorativo (role img + aria-label).
 *  Una clave desconocida pinta el icono de Otros: una fila nunca se queda sin icono. */
export function catIcon(key, { size = 20, width = 1.75, cls = "", label = "" } = {}) {
  const d = CAT_ICONS[key] ?? ENTITY_ICONS[key] ?? CAT_ICONS.otr;
  const a11y = label ? `role="img" aria-label="${escAttr(label)}"` : 'aria-hidden="true"';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"`
    + ` stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${a11y}`
    + `${cls ? ` class="${escAttr(cls)}"` : ""}>${d}</svg>`;
}
