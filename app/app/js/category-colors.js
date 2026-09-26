// Familias de categoría (dirección B, DESIGN.md C6/C7/C9/C11/C12 y §6). La familia es un DATO —una
// de 12 claves—, no un hex: el color lo pone el CSS con `.fam-<clave>` (components.css), que expone
// --ft/--fb/--fx a partir de los tokens --f-<clave>-t/-b/-x de tokens.css. Este módulo no conoce
// ningún color de interfaz (C13); los únicos hex que quedan aquí son DATOS DE MIGRACIÓN
// (LEGACY_COLORS y POOL_TO_FAMILY), escritos en minúsculas y sin almohadilla.

export const FAMILIES = ["casa", "ali", "res", "tra", "coc", "sal", "sus", "oci", "rop", "reg", "imp", "otr"];
const FAMILY_SET = new Set(FAMILIES);

// Raíces sembradas de gasto → su familia fija (seeds.js). Cada una comparte clave con su icono.
export const ROOT_FAMILY = {
  "cat-casa": "casa", "cat-alimentacion": "ali", "cat-restauracion": "res", "cat-transporte": "tra",
  "cat-coche": "coc", "cat-salud": "sal", "cat-suscripciones": "sus", "cat-ocio": "oci",
  "cat-ropa": "rop", "cat-regalos": "reg", "cat-impuestos": "imp", "cat-otros": "otr",
};

// Raíces sembradas de ingreso: siguen siendo ingreso aunque el byId que llega no traiga `flow`
// (hay call sites que construyen byId parciales).
const INCOME_SEEDS = new Set(["cat-nomina", "cat-puntuales", "cat-intereses"]);

// ---- Compatibilidad del category_style antiguo: SE LEE PARA SIEMPRE --------------------------
// Hay xlsx exportados con {color:"<hex>", icon:"<emoji>"} y bases locales que nunca se reescriben.
// Cadena: hex v1 → hex v2 (LEGACY_COLORS, misma ranura del antiguo POOL) → familia
// (POOL_TO_FAMILY, por el tono OKLCH más cercano a la barra clara de cada familia; se permiten
// colisiones, §6). Hex en minúsculas y sin almohadilla: son datos de migración, no colores de UI.
export const LEGACY_COLORS = {
  "629d3b": "6bcb3e", "6b61c2": "8b7cf6", "a09600": "c4b72f", "9153ab": "c264d9",
  "15ac7d": "22c58b", "986603": "e8a93b", "12a7a7": "2bd9c9", "b45018": "ff7a45",
  "00a1cb": "2fc4e0", "aa4985": "de5fa8", "4f94e9": "5b9bff", "b64656": "e85f72",
};
export const POOL_TO_FAMILY = {
  "6bcb3e": "ali", "8b7cf6": "sus", "c4b72f": "imp", "c264d9": "rop", "22c58b": "ali", "e8a93b": "casa",
  "2bd9c9": "sal", "ff7a45": "reg", "2fc4e0": "sal", "de5fa8": "oci", "5b9bff": "tra", "e85f72": "reg",
};

// Emoji antiguos (CATEGORY_ICONS y CURATED_ICONS de v2) → clave de icono SVG. Todos tienen
// equivalente (los que no lo tenían en B salen de Lucide, ver icons.js); un emoji ajeno a estas
// listas se descarta y la categoría cae al icono de su familia. La clave es la
// secuencia de code points en hex sin el selector de variación FE0F (ver emojiKey): así el
// módulo no lleva ningún emoji literal (R-EMOJI) y un emoji con o sin FE0F resuelve igual.
//   casa 1f3e0 · ali 1f6d2 · res 1f37d · tra 1f68c · coc 1f697 · sal 2764+200d+1fa79 · sus 1f4fa
//   oci 1f389 · rop 1f455 · reg 1f381 · imp 1f9fe · otr 25ab · billete 1f4b6
//   curados: huella 1f43e · birrete 1f393 · avion 2708 · bebe 1f476 · portatil 1f4bb
//   mando 1f3ae · hoja 1f331 · paquete 1f4e6.
export const LEGACY_EMOJI = {
  "1f3e0": "casa", "1f6d2": "ali", "1f37d": "res", "1f68c": "tra", "1f697": "coc",
  "2764-200d-1fa79": "sal", "1f4fa": "sus", "1f389": "oci", "1f455": "rop", "1f381": "reg",
  "1f9fe": "imp", "25ab": "otr", "1f4b6": "billete",
  "1f43e": "huella", "1f393": "birrete", "2708": "avion", "1f476": "bebe", "1f4bb": "portatil",
  "1f3ae": "mando", "1f331": "hoja", "1f4e6": "paquete",
};

/** Code points en hex, sin FE0F, unidos por «-» (el corazón vendado da "2764-200d-1fa79"). */
export function emojiKey(str) {
  const out = [];
  for (const ch of String(str ?? "")) {
    const cp = ch.codePointAt(0);
    if (cp !== 0xfe0f) out.push(cp.toString(16));
  }
  return out.join("-");
}

// Iconos elegibles para una categoría (los mismos que ofrece el selector: icons.js#CAT_ICONS).
// Se repite la lista de claves en vez de importar icons.js para que este módulo siga sin
// dependencias; tests/app/category-colors.test.mjs comprueba que coinciden.
export const CAT_ICON_KEYS = [
  ...FAMILIES, "huella", "hoja", "libro", "nota", "avion", "estrella",
  "billete", "bebe", "portatil", "mando", "paquete", "birrete",
];
const ICON_SET = new Set(CAT_ICON_KEYS);

export const isFamily = (fam) => typeof fam === "string" && FAMILY_SET.has(fam);
export const isCatIcon = (key) => typeof key === "string" && ICON_SET.has(key);

function legacyColorToFamily(color) {
  if (typeof color !== "string") return null;
  const hex = color.trim().replace(/^#/, "").toLowerCase();
  const v2 = Object.hasOwn(LEGACY_COLORS, hex) ? LEGACY_COLORS[hex] : hex;
  return Object.hasOwn(POOL_TO_FAMILY, v2) ? POOL_TO_FAMILY[v2] : null;
}

function toIconKey(icon) {
  if (typeof icon !== "string") return null;
  if (isCatIcon(icon)) return icon;
  const k = emojiKey(icon);
  return Object.hasOwn(LEGACY_EMOJI, k) ? LEGACY_EMOJI[k] : null;
}

// djb2 sobre el id de categoría → ranura estable 0..11. Determinista y sin dependencias: misma
// categoría, misma familia, en cualquier dispositivo. Mismo algoritmo y módulo que el antiguo
// POOL, así que una categoría de usuario conserva su ranura.
export function hashIndex(id) {
  let h = 5381;
  for (const ch of String(id)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return h % FAMILIES.length;
}

// Defensa en profundidad: meta.category_style llega de un import xlsx sin más validación que «es
// JSON válido». sanitizeStyleMap traduce el formato antiguo y descarta EN SILENCIO (sin throw: es la
// última línea de defensa para datos que no pasaron por repo.setCategoryStyle, que sí lanza) todo
// lo que no encaje en las listas cerradas. Siempre devuelve el formato nuevo {fam?, icon?}.
function sanitizeStyleMap(map) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return {};
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    // out["__proto__"]= dispararía el setter de Object.prototype: se salta la clave.
    if (k === "__proto__") continue;
    if (!v || typeof v !== "object") continue;
    const entry = {};
    const fam = isFamily(v.fam) ? v.fam : legacyColorToFamily(v.color);
    if (fam) entry.fam = fam;
    const icon = toIconKey(v.icon);
    if (icon) entry.icon = icon;
    if (Object.keys(entry).length > 0) out[k] = entry;
  }
  return out;
}

// Overrides de usuario por categoría raíz: { [catId]: { fam?, icon? } }. Se inicializan en el boot
// desde meta.category_style (ver parseStyle) y los refresca repo.setCategoryStyle.
let style = {};
export function initCategoryStyle(map) {
  style = sanitizeStyleMap(map);
}

/** JSON.parse seguro de meta.category_style, ya saneado y en formato nuevo. Cualquier fallo
 *  (ausente, corrupto, no objeto) devuelve {}. */
export function parseStyle(raw) {
  try {
    return sanitizeStyleMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

// Un ciclo de parent_id (xlsx importado a mano) no debe colgar la pestaña: Set de visitados.
export function rootOf(catId, byId) {
  let c = own(byId, catId);
  const seen = new Set();
  while (c && c.parent_id && !seen.has(c.id)) {
    seen.add(c.id);
    c = own(byId, c.parent_id);
  }
  return c ? c.id : catId;
}

// Búsquedas por clave con Object.hasOwn: un id como "toString" o "constructor" no debe resolver a
// lo que hereda de Object.prototype (style, ROOT_FAMILY y byId son objetos planos).
const own = (obj, k) => (obj && Object.hasOwn(obj, k) ? obj[k] : undefined);
const isIncomeRoot = (root, byId) => own(byId, root)?.flow === "income" || INCOME_SEEDS.has(root);

/** Familia de una categoría (la de su raíz: una subcategoría nunca tiene color propio, §6).
 *  null para «sin categoría» ("") y para los ingresos (C9): ambos se pintan neutros en --well.
 *  Precedencia: override de category_style > ROOT_FAMILY > FAMILIES[hashIndex(raíz)]. */
export function familyForCategory(catId, byId) {
  if (!catId) return null;
  const root = rootOf(catId, byId ?? {});
  if (!root || isIncomeRoot(root, byId)) return null;
  return own(style, root)?.fam ?? own(ROOT_FAMILY, root) ?? FAMILIES[hashIndex(root)];
}

/** Clave de icono (icons.js#catIcon), nunca un emoji. Ingresos → "income"; «sin categoría» → "otr".
 *  Precedencia: override > icono de la raíz sembrada > icono de su familia. Cambiar la familia de
 *  una raíz sembrada no le cambia el icono. */
export function iconForCategory(catId, byId) {
  if (!catId) return "otr";
  const root = rootOf(catId, byId ?? {});
  if (isIncomeRoot(root, byId)) return "income";
  return own(style, root)?.icon ?? own(ROOT_FAMILY, root) ?? familyForCategory(catId, byId) ?? "otr";
}

/** "fam-casa"; cadena vacía para null o una clave desconocida (nunca una clase inventada). */
export const famClass = (fam) => (isFamily(fam) ? `fam-${fam}` : "");

/** Nombre del token de una familia: famToken("casa", "b") → "--f-casa-b" (part: t tinte, b barra,
 *  x texto). Para los pocos sitios que necesitan el color fuera de una clase `.fam-*`: el PDF
 *  (pdf-palette.js) y el puente de abajo. */
export const famToken = (fam, part = "b") => `--f-${fam}-${part}`;

// ---- Puente para las pantallas aún en PENDIENTES ---------------------------------------------
// Las pantallas sin migrar interpolan un color en `--cat:` o `background:`. Hasta que cada una pase
// a `.fam-*` (S1-S13), reciben el token de la familia como var(), nunca un hex.
export const colorForCategory = (catId, byId) => {
  const fam = familyForCategory(catId, byId);
  return fam ? `var(${famToken(fam, "b")})` : "var(--idle)";
};
export const textColorForCategory = (catId, byId) => {
  const fam = familyForCategory(catId, byId);
  return fam ? `var(${famToken(fam, "x")})` : "var(--text)";
};
