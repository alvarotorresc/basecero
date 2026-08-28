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
export function rootOf(catId, byId) {
  let c = byId[catId];
  while (c && c.parent_id) c = byId[c.parent_id];
  return c ? c.id : catId;
}
export const colorForCategory = (catId, byId) => ROOT_COLORS[rootOf(catId, byId)] ?? DEFAULT_COLOR;
export const textColorForCategory = (catId, byId) => TEXT_COLORS[rootOf(catId, byId)] ?? DEFAULT_COLOR;
export const iconForCategory = (catId, byId) => CATEGORY_ICONS[rootOf(catId, byId)] ?? "▫️";
