const ROOT_COLORS = {
  "cat-casa": "#4F94E9", "cat-alimentacion": "#629D3B", "cat-restauracion": "#B45018",
  "cat-transporte": "#00A1CB", "cat-coche": "#986603", "cat-ocio": "#6B61C2",
  "cat-salud": "#12A7A7", "cat-suscripciones": "#9153AB",
  "cat-ropa": "#B64656", "cat-regalos": "#AA4985", "cat-impuestos": "#A09600",
  "cat-nomina": "#15AC7D", "cat-puntuales": "#15AC7D", "cat-intereses": "#15AC7D",
};
const DEFAULT_COLOR = "#9A99A6";
const TEXT_COLORS = {
  "cat-casa": "#6FA8F0", "cat-alimentacion": "#7FB554", "cat-restauracion": "#D97742",
  "cat-transporte": "#3FB7DC", "cat-coche": "#B2802A", "cat-ocio": "#8A82D6",
  "cat-salud": "#3FBDBD", "cat-suscripciones": "#AB74C4",
  "cat-ropa": "#CD6472", "cat-regalos": "#C4699F", "cat-impuestos": "#BDB32A",
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
const POOL_TEXT = {
  "#629D3B": "#7FB554", "#6B61C2": "#8A82D6", "#A09600": "#BDB32A", "#9153AB": "#AB74C4",
  "#15AC7D": "#3DC299", "#986603": "#B2802A", "#12A7A7": "#3FBDBD", "#B45018": "#D97742",
  "#00A1CB": "#3FB7DC", "#AA4985": "#C4699F", "#4F94E9": "#6FA8F0", "#B64656": "#CD6472",
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

// Overrides de usuario por categoría raíz: { [catId]: { color?, icon? } }. Se inicializan en el
// boot desde meta.category_style (ver parseStyle) y los reutiliza la pantalla de edición.
let style = {};
export function initCategoryStyle(map) {
  style = map && typeof map === "object" ? map : {};
}

// JSON.parse seguro para meta.category_style: cualquier fallo (valor ausente, corrupto, no-objeto)
// vuelve a {} en vez de romper el boot.
export function parseStyle(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function rootOf(catId, byId) {
  let c = byId[catId];
  while (c && c.parent_id) c = byId[c.parent_id];
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
