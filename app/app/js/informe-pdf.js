/** Presentador PDF del Informe del periodo. Dos mitades, mismo criterio que charts.js: misma
 *  testabilidad, un fichero menos.
 *
 *  CONTRATO DE ESCAPADO, invertido respecto al resto de la app (spec §7.1): `buildReport()`
 *  (informe-logic.js) devuelve strings CRUDOS; `screens/informe.js` los escapa AL PINTAR con su
 *  `escHtml`/`escAttr` local, como el resto de pantallas. Este módulo NO ESCAPA NUNCA — un
 *  `escHtml` aquí imprimiría literalmente "&amp;" en el PDF. En su lugar, todo texto de usuario
 *  pasa por `winAnsiSafe` antes de tocar el documento: es la única frontera de saneo del PDF. */

// pdf-lib, con las fuentes estándar (Helvetica/Courier), codifica el texto en WinAnsi (Windows-1252)
// y LANZA si aparece un carácter fuera de esa tabla (verificado: `WinAnsi cannot encode "→"
// (0x2192)`). En esta app los nombres de categoría admiten emoji por diseño (CURATED_ICONS,
// category-colors.js:63) y los comercios llegan de un CSV ajeno: sin este saneo, el PDF de un
// usuario normal revienta la primera vez que use un emoji o le llegue un comercio con una flecha.

// Mapa de los puntos de código Unicode que WinAnsi codifica en el rango 0x80-0x9F (Windows-1252),
// EXCLUIDAS las comillas tipográficas (’‘“”), que se normalizan a las rectas más abajo — el resto
// se conserva tal cual porque WinAnsi sí las soporta directamente.
const WIN_ANSI_SPECIALS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122,
  0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

// ASCII imprimible (0x20-0x7E) y Latin-1 Supplement (0xA0-0xFF, que WinAnsi codifica idéntico al
// Unicode salvo casos que no salen en texto normal): entre los dos cubren tildes, ñ/ü/ç, «»,
// el NBSP y el punto medio sin necesitar tabla adicional.
function isWinAnsiCodePoint(cp) {
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_SPECIALS.has(cp);
}

// Marcas combinantes y caracteres de formato de ancho cero (p.ej. el ZWJ que encadena un emoji
// compuesto como "❤️‍🩹"): se DESCARTAN en silencio en vez de convertirse en "?", porque no ocupan
// espacio visual propio — un "?" ahí sería un carácter que nunca estuvo.
function isZeroWidthOrMark(cp) {
  return /^[\p{M}\p{Cf}]$/u.test(String.fromCodePoint(cp));
}

/** Deja una cadena codificable en WinAnsi. NUNCA lanza: sustituye, no rechaza.
 *  - U+2212 MINUS SIGN -> "-"               (el artboard usa "−"; Intl usa U+002D, pero un
 *                                            literal de i18n puede traer el bonito)
 *  - U+202F / U+2009 -> U+00A0              (fr-FR emite U+202F en sus importes: verificado)
 *  - U+2018/2019 -> "'", U+201C/201D -> '"' (por si llegan de un CSV)
 *  - resto fuera de WinAnsi (emoji, flechas, CJK) -> "" si es de ancho cero o marca,
 *    "?" si no, colapsando runs para no dejar "????"
 *  Es la ÚNICA frontera: todo lo que entra en el PDF pasa por aquí. */
export function winAnsiSafe(str) {
  if (str === null || str === undefined) return "";
  let s = String(str)
    .replace(/−/g, "-")
    .replace(/[  ]/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');

  let out = "";
  let lastWasQuestion = false;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (isWinAnsiCodePoint(cp)) {
      out += ch;
      lastWasQuestion = false;
    } else if (isZeroWidthOrMark(cp)) {
      // se descarta sin dejar rastro: no colapsa ni reinicia un run de "?" en curso.
    } else {
      if (!lastWasQuestion) out += "?";
      lastWasQuestion = true;
    }
  }
  return out;
}
