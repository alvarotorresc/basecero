const ROOT_COLORS = {
  "cat-casa": "#4F94E9", "cat-alimentacion": "#629D3B", "cat-restauracion": "#B45018",
  "cat-transporte": "#00A1CB", "cat-coche": "#986603", "cat-ocio": "#6B61C2",
  "cat-salud": "#12A7A7", "cat-suscripciones": "#9153AB",
  "cat-ropa": "#B64656", "cat-regalos": "#AA4985", "cat-impuestos": "#A09600",
  "cat-nomina": "#15AC7D", "cat-puntuales": "#15AC7D", "cat-intereses": "#15AC7D",
};
const DEFAULT_COLOR = "#9A99A6";
// Contraste texto/tinte (Task 2 P2, WCAG 1.4.3 AA ≥4.5:1), verificado sobre las dos superficies
// reales donde se usa TEXT_COLORS: en registro.js chipStyle el texto va sobre su propio tinte al
// 18% (color-mix(in srgb, <color> 18%, transparent)) compuesto sobre --bg #121214; en
// gasto-por-categoria.js rootRowHtml el texto va sólido (sin tinte) sobre --card #1C1C21 igualmente
// sólido, dando ≥5.33:1 para las 12 — la superficie exigente es el tinte sobre --bg. 5 de las 12
// entradas fallaban 4.5:1 ahí con el hex original (aunque ya pasaban de sobra sobre --card
// sólido); se subió su lightness en OKLCH manteniendo hue/chroma hasta despejar 4.5:1 con margen
// sobre el tinte (script ad-hoc, no versionado — ver report de Task 2). Ratios sobre tinte 18% /
// --bg, antes → después:
//   cat-coche          #B2802A → #BB8934  (4.261 → 4.711)
//   cat-ocio           #8A82D6 → #9088DD  (4.390 → 4.683)
//   cat-suscripciones  #AB74C4 → #B37CCD  (4.250 → 4.650)
//   cat-ropa           #CD6472 → #DA707D  (4.072 → 4.623)
//   cat-regalos        #C4699F → #CF73A9  (4.185 → 4.678)
// Las otras 7 (incl. restauracion, 4.676, el "casi" más próximo) ya pasaban 4.5:1 en esa misma
// superficie y no se tocan.
const TEXT_COLORS = {
  "cat-casa": "#6FA8F0", "cat-alimentacion": "#7FB554", "cat-restauracion": "#D97742",
  "cat-transporte": "#3FB7DC", "cat-coche": "#BB8934", "cat-ocio": "#9088DD",
  "cat-salud": "#3FBDBD", "cat-suscripciones": "#B37CCD",
  "cat-ropa": "#DA707D", "cat-regalos": "#CF73A9", "cat-impuestos": "#BDB32A",
  "cat-nomina": "#3DC299", "cat-puntuales": "#3DC299", "cat-intereses": "#3DC299",
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
export const POOL = [
  "#629D3B", "#6B61C2", "#A09600", "#9153AB", "#15AC7D", "#986603",
  "#12A7A7", "#B45018", "#00A1CB", "#AA4985", "#4F94E9", "#B64656",
];
// Mismos 5 hexes aclarados que TEXT_COLORS (misma justificación arriba): POOL_TEXT es la fuente
// para overrides de usuario y categorías hasheadas, así que debe llevar los mismos valores o esos
// caminos volverían a renderizar el hex sin aclarar sobre el mismo tinte al 18%.
const POOL_TEXT = {
  "#629D3B": "#7FB554", "#6B61C2": "#9088DD", "#A09600": "#BDB32A", "#9153AB": "#B37CCD",
  "#15AC7D": "#3DC299", "#986603": "#BB8934", "#12A7A7": "#3FBDBD", "#B45018": "#D97742",
  "#00A1CB": "#3FB7DC", "#AA4985": "#CF73A9", "#4F94E9": "#6FA8F0", "#B64656": "#DA707D",
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
    if (typeof v.color === "string" && POOL.includes(v.color)) entry.color = v.color;
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
// (el color elegido en el selector es del pool): POOL_TEXT[color], o DEFAULT_COLOR si datos
// corruptos lo dejaran fuera del pool.
export const textColorForCategory = (catId, byId) => {
  const root = rootOf(catId, byId);
  const override = style[root];
  if (override?.color) return POOL_TEXT[override.color] ?? DEFAULT_COLOR;
  if (TEXT_COLORS[root]) return TEXT_COLORS[root];
  if (NEUTRAL_IDS.has(root)) return DEFAULT_COLOR;
  return POOL_TEXT[POOL[hashIndex(root)]];
};

// El icono no hashea: sin override ni seed, cae al icono por defecto (▫️), igual que siempre.
export const iconForCategory = (catId, byId) => {
  const root = rootOf(catId, byId);
  const override = style[root];
  if (override?.icon) return override.icon;
  return CATEGORY_ICONS[root] ?? "▫️";
};
