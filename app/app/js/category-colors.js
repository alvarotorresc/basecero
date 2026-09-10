// Paleta v2 resaturada para el fondo oscuro #0B0B0C (reskin, SISTEMA.md §2.2). El ORDEN de las
// claves no importa aquí (a diferencia de POOL más abajo): cada categoría raíz seedeada tiene su
// propio hex fijo, no depende de una ranura.
const ROOT_COLORS = {
  "cat-casa": "#5B9BFF", "cat-alimentacion": "#6BCB3E", "cat-restauracion": "#FF7A45",
  "cat-transporte": "#2FC4E0", "cat-coche": "#E8A93B", "cat-ocio": "#8B7CF6",
  "cat-salud": "#2BD9C9", "cat-suscripciones": "#C264D9",
  "cat-ropa": "#E85F72", "cat-regalos": "#DE5FA8", "cat-impuestos": "#C4B72F",
  "cat-nomina": "#22C58B", "cat-puntuales": "#22C58B", "cat-intereses": "#22C58B",
};
export const DEFAULT_COLOR = "#8A8794";
// Tinta legible de los neutros (cat-otros, ""): antes compartía DEFAULT_COLOR con el propio color
// de fondo del neutro; en v2 son valores distintos, como en el resto de la paleta (--cat-x vs
// --cat-x-ink, SISTEMA.md §2.2).
export const DEFAULT_TEXT_COLOR = "#B4B1BC";
// Contraste texto/insignia (WCAG 1.4.3 AA ≥4.5:1), verificado sobre la insignia tintada al 16%
// de --cat sobre --bg #0B0B0C (SISTEMA.md §2.2, columna "ink / insignia tintada 16%"): Casa 7.45 ·
// Alimentación 9.38 · Restauración 7.64 · Transporte 8.95 · Coche 9.32 · Ocio 6.90 (el peor) ·
// Salud 9.72 · Suscripciones 7.00 · Ropa 6.91 · Regalos 7.08 · Impuestos 9.02 · Ingresos 8.85 ·
// Otras/neutro 7.79. Las 13 pasan de sobra el mínimo 4.5:1.
const TEXT_COLORS = {
  "cat-casa": "#7FB3FF", "cat-alimentacion": "#8FE05F", "cat-restauracion": "#FF9A6E",
  "cat-transporte": "#63D6EC", "cat-coche": "#F2C463", "cat-ocio": "#A99CFA",
  "cat-salud": "#5CE6D8", "cat-suscripciones": "#D98CE8",
  "cat-ropa": "#F08997", "cat-regalos": "#EA8BC4", "cat-impuestos": "#D6CB5E",
  "cat-nomina": "#4FDBA6", "cat-puntuales": "#4FDBA6", "cat-intereses": "#4FDBA6",
};
export const CATEGORY_ICONS = {
  "cat-casa": "🏠", "cat-alimentacion": "🛒", "cat-restauracion": "🍽️", "cat-transporte": "🚌",
  "cat-coche": "🚗", "cat-salud": "❤️‍🩹", "cat-suscripciones": "📺", "cat-ocio": "🎉",
  "cat-ropa": "👕", "cat-regalos": "🎁", "cat-impuestos": "🧾", "cat-otros": "▫️",
  "cat-nomina": "💶", "cat-puntuales": "💶", "cat-intereses": "💶",
};

// cat-otros no tiene entrada en ROOT_COLORS/TEXT_COLORS (se queda en gris a propósito): sin este
// guard caería al hash del pool y cambiaría de color en cada release. Es un set explícito y no
// "todo lo que falte de ROOT_COLORS" porque una categoría nueva de usuario SÍ debe hashear.
// "" también es neutro: category_id NOT NULL DEFAULT '' (schema.sql) es el id real de "sin
// categorizar" (movimientos.js isUncategorized, transacciones importadas antes de categorizar,
// transferencias) que llega sin guardar a colorForCategory/textColorForCategory en más de un
// call site (p.ej. inicio.js txRowHtml) — sin esta entrada, rootOf("", byId) devuelve "" y
// hashIndex("") cae en un color del pool en vez de quedarse en gris.
const NEUTRAL_IDS = new Set(["cat-otros", ""]);

// Pool de 12 colores validados (contraste + distinción) para categorías sin seed ni override.
// ORDEN preservado del pool v1: hashIndex mapea id → RANURA, así que una categoría de usuario ya
// hasheada mantiene su ranura (y por tanto su identidad de color) y solo cambia de tono con el
// reskin — no salta de "el azul" a "el rosa" para nadie.
export const POOL = [
  "#6BCB3E", "#8B7CF6", "#C4B72F", "#C264D9", "#22C58B", "#E8A93B",
  "#2BD9C9", "#FF7A45", "#2FC4E0", "#DE5FA8", "#5B9BFF", "#E85F72",
];
// Mismos hexes que TEXT_COLORS (misma justificación arriba): POOL_TEXT es la fuente para overrides
// de usuario y categorías hasheadas, así que debe llevar los mismos valores o esos caminos
// volverían a renderizar el hex sin aclarar sobre la insignia tintada.
const POOL_TEXT = {
  "#6BCB3E": "#8FE05F", "#8B7CF6": "#A99CFA", "#C4B72F": "#D6CB5E", "#C264D9": "#D98CE8",
  "#22C58B": "#4FDBA6", "#E8A93B": "#F2C463", "#2BD9C9": "#5CE6D8", "#FF7A45": "#FF9A6E",
  "#2FC4E0": "#63D6EC", "#DE5FA8": "#EA8BC4", "#5B9BFF": "#7FB3FF", "#E85F72": "#F08997",
};
// meta.category_style guarda el hex que el usuario eligió. Al resaturar la paleta (reskin v2) esos
// hexes dejarían de estar en POOL y sanitizeStyleMap los descartaría EN SILENCIO: el usuario
// perdería el color que eligió sin ver ni un aviso. Este mapa los sube a su equivalente v2 (misma
// ranura de POOL, mismo tono). Idempotente: un hex nuevo (ya en POOL) no matchea y pasa de largo.
const LEGACY_COLORS = {
  "#629D3B": "#6BCB3E", "#6B61C2": "#8B7CF6", "#A09600": "#C4B72F", "#9153AB": "#C264D9",
  "#15AC7D": "#22C58B", "#986603": "#E8A93B", "#12A7A7": "#2BD9C9", "#B45018": "#FF7A45",
  "#00A1CB": "#2FC4E0", "#AA4985": "#DE5FA8", "#4F94E9": "#5B9BFF", "#B64656": "#E85F72",
};
// 8 iconos curados ofrecidos en el selector de icono de categoría (pantalla de edición).
export const CURATED_ICONS = ["🐾", "🎓", "✈️", "👶", "💻", "🎮", "🌱", "📦"];

// djb2 sobre el id de categoría → índice estable 0..11 en POOL. Determinista y sin dependencias:
// misma categoría, mismo color, en cualquier dispositivo/sesión.
export function hashIndex(id) {
  let h = 5381;
  for (const ch of String(id)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return h % POOL.length;
}

// Defensa en profundidad (CRITICAL, review final): meta.category_style llega de un import xlsx sin
// más validación que "es JSON válido" (parseStyle) — un color/icono corrupto (p.ej. un payload de
// XSS) pasaría intacto a colorForCategory/iconForCategory y de ahí, SIN escapar, a los template
// strings de categorias.js (style="--cat:${color}" / contenido ${icon}). sanitizeStyleMap descarta
// en SILENCIO (sin throw: esto es la última línea de defensa para datos que ya pudieron entrar sin
// pasar por setCategoryStyle, que sí lanza) cualquier entrada que no encaje en las listas cerradas.
function sanitizeStyleMap(map) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return {};
  const allowedIcons = new Set([...CURATED_ICONS, ...Object.values(CATEGORY_ICONS)]);
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    // JSON.parse crea "__proto__" como own property normal (no como el prototipo real) — pero
    // out[k]= con k="__proto__" SÍ dispara el setter especial de Object.prototype y envenenaría el
    // prototipo de `out`. Saltarla evita tocar out.__proto__ por completo.
    if (k === "__proto__") continue;
    if (!v || typeof v !== "object") continue;
    const entry = {};
    // Migrar ANTES del filtro: un hex de la paleta v1 no está en el POOL v2 y se descartaría en
    // silencio (ver LEGACY_COLORS arriba) si no se sube primero a su sucesor.
    const color = typeof v.color === "string" ? (LEGACY_COLORS[v.color] ?? v.color) : v.color;
    if (typeof color === "string" && POOL.includes(color)) entry.color = color;
    if (typeof v.icon === "string" && allowedIcons.has(v.icon)) entry.icon = v.icon;
    if (Object.keys(entry).length > 0) out[k] = entry;
  }
  return out;
}

// Overrides de usuario por categoría raíz: { [catId]: { color?, icon? } }. Se inicializan en el
// boot desde meta.category_style (ver parseStyle) y los reutiliza la pantalla de edición.
let style = {};
export function initCategoryStyle(map) {
  style = sanitizeStyleMap(map);
}

// JSON.parse seguro para meta.category_style: cualquier fallo (valor ausente, corrupto, no-objeto)
// vuelve a {} en vez de romper el boot. sanitizeStyleMap aplica el saneo de datos (Item 1) sobre
// cualquier JSON que sí parsee pero traiga colores/iconos fuera de las listas cerradas.
export function parseStyle(raw) {
  try {
    const parsed = JSON.parse(raw);
    return sanitizeStyleMap(parsed);
  } catch {
    return {};
  }
}

// A1 (review de seguridad): un category_id cuyo parent_id apunta a sí mismo (o un ciclo A↔B) puede
// entrar en la DB vía un xlsx importado a mano (validateImport hoy solo comprueba que el padre
// exista — Task 3 cierra esa vía de entrada). rootOf corre en CADA render de Inicio/Movimientos, así
// que sin guard un ciclo ya presente en la DB cuelga la pestaña en cada carga: este Set de
// visitados es la única vía de recuperación una vez el ciclo ya está guardado.
export function rootOf(catId, byId) {
  let c = byId[catId];
  const seen = new Set();
  while (c && c.parent_id && !seen.has(c.id)) {
    seen.add(c.id);
    c = byId[c.parent_id];
  }
  return c ? c.id : catId;
}

// Precedencia (Decisión 2): override de usuario > seed de ROOT_COLORS > neutro (cat-otros) > hash.
export const colorForCategory = (catId, byId) => {
  const root = rootOf(catId, byId);
  const override = style[root];
  if (override?.color) return override.color;
  if (ROOT_COLORS[root]) return ROOT_COLORS[root];
  if (NEUTRAL_IDS.has(root)) return DEFAULT_COLOR;
  return POOL[hashIndex(root)];
};

// Mismo orden que colorForCategory. Con override de usuario el tinte SIEMPRE sale del pool
// (el color elegido en el selector es del pool): POOL_TEXT[color], o DEFAULT_TEXT_COLOR si datos
// corruptos lo dejaran fuera del pool.
export const textColorForCategory = (catId, byId) => {
  const root = rootOf(catId, byId);
  const override = style[root];
  if (override?.color) return POOL_TEXT[override.color] ?? DEFAULT_TEXT_COLOR;
  if (TEXT_COLORS[root]) return TEXT_COLORS[root];
  if (NEUTRAL_IDS.has(root)) return DEFAULT_TEXT_COLOR;
  return POOL_TEXT[POOL[hashIndex(root)]];
};

// El icono no hashea: sin override ni seed, cae al icono por defecto (▫️), igual que siempre.
export const iconForCategory = (catId, byId) => {
  const root = rootOf(catId, byId);
  const override = style[root];
  if (override?.icon) return override.icon;
  return CATEGORY_ICONS[root] ?? "▫️";
};
