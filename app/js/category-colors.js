const ROOT_COLORS = {
  "cat-casa": "#8b9ff5", "cat-alimentacion": "#58d68d", "cat-restauracion": "#f0a868",
  "cat-transporte": "#56c6de", "cat-coche": "#ddb455", "cat-ocio": "#e68ab0",
  "cat-salud": "#ec8a84", "cat-suscripciones": "#b08be8",
};
const DEFAULT_COLOR = "#5c646d";
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
export const iconForCategory = (catId, byId) => CATEGORY_ICONS[rootOf(catId, byId)] ?? "▫️";
