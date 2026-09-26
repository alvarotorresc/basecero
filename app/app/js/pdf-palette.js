// Paleta del PDF del Informe (D-impl-3). PURO salvo loadPdfPalette, que recibe el fetch inyectado.
//
// El PDF necesita números (PDFLib) y la regla C13 prohíbe escribir un color en JS: la paleta se
// lee de tokens.css, del bloque `:root{` CLARO. Así el papel no hereda nunca el tema oscuro y la
// paleta no puede desincronizarse de la de pantalla.

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** {"--f-casa-b": "<hex>", …} con las propiedades del PRIMER bloque cuyo selector es exactamente
 *  `:root` (no `:root[data-theme="dark"]`). Solo se quedan los valores que son un hex: los alias
 *  var(…), sombras o gradientes no le sirven al PDF. Entrada vacía o sin ese bloque → {}. */
export function parseRootTokens(cssText) {
  const css = String(cssText ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
  const m = css.match(/(?:^|[\s}]):root\s*\{([^}]*)\}/);
  if (!m) return {};
  const out = {};
  for (const decl of m[1].split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const name = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (name.startsWith("--") && HEX.test(value)) out[name] = value;
  }
  return out;
}

/** Token → [r, g, b] en 0..255, o null si la paleta no lo trae (quien llama decide el respaldo). */
export function rgbOf(token, palette) {
  const hex = palette?.[token];
  if (typeof hex !== "string" || !HEX.test(hex)) return null;
  let s = hex.slice(1);
  if (s.length === 3) s = [...s].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

/** Descarga css/tokens.css (el service worker lo tiene en caché, funciona sin red) y lo parsea.
 *  Cualquier fallo devuelve {}: el PDF sale igual, con las barras en el gris de papel. */
export async function loadPdfPalette(fetchFn = globalThis.fetch, url = "css/tokens.css") {
  try {
    const res = await fetchFn(url);
    if (!res?.ok) return {};
    return parseRootTokens(await res.text());
  } catch {
    return {};
  }
}
