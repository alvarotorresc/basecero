import { barRowsGeometry } from "./charts.js";
import { fmtMoney, fmtDiaCorto } from "./format.js";
import { t } from "./i18n/index.js";

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

// ---- layoutReport — geometría de páginas A4, SIN pdf-lib ---------------------------------------
// Sin medir texto: los bloques de texto llevan `align`/`maxX`/`maxWidth`, y el adaptador (Task 10,
// buildPdfBytes) es el único que mide la fuente y trunca. Materiales de papel (SISTEMA.md §2.1):
// el color de categoría rellena barras e insignias, el NOMBRE de la categoría va siempre en tinta
// de papel — eso lo decide el adaptador de dibujo, no esta geometría.

export const A4 = { w: 595.28, h: 841.89 };
export const MARGIN = 40;

// Alto de la franja del pie, reservada por encima del margen: así el pie numerado también cumple
// "ningún bloque por debajo del margen inferior" sin pisar la última línea de contenido.
const FOOTER_H = 16;
const BAR_ROW_H = 16;
const BAR_H = 6;

function newPage() {
  return { blocks: [] };
}

/** Reparte el informe en páginas A4. PURO: no importa pdf-lib, no mide texto. Devuelve bloques con
 *  su caja ya resuelta en el sistema de coordenadas del PDF (origen abajo a la izquierda).
 *  kinds: "text" | "rule" | "rect". Secciones, en el orden del artboard: header, summary,
 *  accounts, categories, shared, subscriptions, movements — con pie `{n}/{total}` en cada página. */
export function layoutReport(report, { pageSize = A4, margin = MARGIN } = {}) {
  const contentW = pageSize.w - margin * 2;
  const pages = [newPage()];
  let y = pageSize.h - margin;

  const page = () => pages[pages.length - 1];
  function ensure(h) {
    if (y - h < margin + FOOTER_H) {
      pages.push(newPage());
      y = pageSize.h - margin;
    }
  }
  function text(section, str, { size = 10, align = "left", bold = false, color, mono = false } = {}) {
    const lineH = size + 4;
    ensure(lineH);
    y -= lineH;
    page().blocks.push({
      kind: "text", section, text: String(str ?? ""), x: margin, y, align,
      maxX: margin + contentW, maxWidth: contentW, size, bold, color, mono,
    });
  }
  function rule(section) {
    ensure(10);
    y -= 10;
    page().blocks.push({ kind: "rule", section, x: margin, y, w: contentW });
  }
  function bar(section, { value, max, color }) {
    ensure(BAR_ROW_H);
    y -= BAR_ROW_H;
    const [g] = barRowsGeometry([{ key: "row", value, max, color }], { width: contentW, rowH: BAR_ROW_H, barH: BAR_H });
    page().blocks.push({ kind: "rect", section, x: margin + g.x, y, w: g.w, h: g.h, color: g.color });
  }

  // 1. Cabecera
  text("header", report.meta.name, { size: 18, bold: true });
  text("header", report.meta.isOpen
    ? `${fmtDiaCorto(report.meta.startDate)} – ${fmtDiaCorto(report.meta.closeDate)}`
    : `${fmtDiaCorto(report.meta.startDate)} – ${fmtDiaCorto(report.meta.endDate)}`, { size: 10 });
  rule("header");

  // 2. Resumen
  text("summary", t("informe.pdf.summary"), { size: 13, bold: true });
  text("summary", `${t("informe.pdf.income")}  ${fmtMoney(report.summary.incomeCents)}`, { mono: true });
  text("summary", `${t("informe.pdf.spent")}  ${fmtMoney(report.summary.spentCents)}`, { mono: true });
  text("summary", `${t("informe.pdf.saved")}  ${fmtMoney(report.summary.savedCents)}`, { mono: true });
  text("summary", `${t("informe.pdf.available")}  ${fmtMoney(report.summary.availableCents)}`, { mono: true });
  if (report.summary.savingsRatePct != null) {
    text("summary", t("informe.pdf.savingsRate", { pct: report.summary.savingsRatePct }));
  }
  rule("summary");

  // 3. Tus cuentas
  // "->" en vez de "→": el separador lo componemos NOSOTROS (no es texto de usuario), así que
  // basta con elegir uno que ya esté en WinAnsi — evita depender de que winAnsiSafe lo convierta
  // a "?" (verificado: WinAnsi no codifica U+2192).
  text("accounts", t("informe.pdf.accounts"), { size: 13, bold: true });
  for (const a of report.accounts.rows) {
    text("accounts", `${a.name}  ${fmtMoney(a.startCents)} -> ${fmtMoney(a.endCents)}`, { mono: true });
  }
  text("accounts", t("informe.pdf.accountsTotal", {
    amount: `${fmtMoney(report.accounts.totalStartCents)} -> ${fmtMoney(report.accounts.totalEndCents)}`,
  }), { bold: true, mono: true });
  rule("accounts");

  // 4. Gasto por categoría
  text("categories", t("informe.pdf.categories"), { size: 13, bold: true });
  const maxSpent = Math.max(0, ...report.categories.rows.map((c) => c.spentCents));
  for (const c of report.categories.rows) {
    // El nombre de la categoría va SIEMPRE en tinta de papel (SISTEMA §2.1): el color de
    // categoría solo rellena la barra de abajo, nunca el texto (D5/D7 de la spec).
    text("categories", `${c.name}  ${fmtMoney(c.spentCents)}`, { mono: true });
    bar("categories", { value: c.spentCents, max: maxSpent, color: c.color });
  }
  text("categories", t("informe.pdf.categoriesTotal", { amount: fmtMoney(report.categories.totalCents) }), { bold: true, mono: true });
  rule("categories");

  // 5. Con la contraparte
  if (report.shared) {
    text("shared", t("informe.pdf.shared", { name: report.shared.partnerName }), { size: 13, bold: true });
    text("shared", t("informe.pdf.periodTotal", { amount: fmtMoney(report.shared.periodTotalCents) }), { mono: true });
    text("shared", t("informe.pdf.myPart", { amount: fmtMoney(report.shared.myPartCents) }), { mono: true });
    text("shared", t("informe.pdf.net", { amount: fmtMoney(report.shared.netCents) }), { mono: true });
    rule("shared");
  }

  // 6. Suscripciones
  if (report.subscriptions) {
    text("subscriptions", t("informe.pdf.subscriptions"), { size: 13, bold: true });
    text("subscriptions", t("informe.pdf.subscriptionsActive", {
      n: report.subscriptions.activeCount, amount: fmtMoney(report.subscriptions.monthlyCents),
    }), { mono: true });
    text("subscriptions", t("informe.pdf.subscriptionsYear", { amount: fmtMoney(report.subscriptions.annualCents) }), { mono: true });
    rule("subscriptions");
  }

  // 7. Movimientos por categoría — la lista completa, la parte que se lleva las páginas.
  text("movements", t("informe.pdf.movements"), { size: 13, bold: true });
  for (const g of report.movements.groups) {
    // Regla de viuda: la cabecera de grupo arrastra al menos su primera fila a la página
    // siguiente si no caben las dos juntas — nunca se queda sola al final de una página.
    const headerLineH = 16, firstItemLineH = 14;
    ensure(headerLineH + firstItemLineH);
    y -= headerLineH;
    page().blocks.push({
      kind: "text", section: "movements", text: `${g.name}  ${fmtMoney(g.totalCents)}`, x: margin, y,
      align: "left", maxX: margin + contentW, maxWidth: contentW, size: 12, bold: true, groupHeader: true,
    });
    for (const it of g.items) {
      text("movements", `${fmtDiaCorto(it.date)}   ${it.merchant}   ${fmtMoney(it.cents)}`, { size: 10, mono: true });
    }
  }
  if (report.movements.others.items.length) {
    text("movements", t("informe.pdf.others"), { size: 12, bold: true });
    for (const it of report.movements.others.items) {
      text("movements", `${fmtDiaCorto(it.date)}   ${it.merchant}   ${fmtMoney(it.cents)}`, { size: 10, mono: true });
    }
  }

  // Pie numerado {n}/{total} en cada página, dentro de la franja reservada por FOOTER_H.
  const total = pages.length;
  pages.forEach((p, i) => {
    p.blocks.push({
      kind: "text", section: "footer", text: `${i + 1}/${total}`, x: margin, y: margin + 2,
      align: "right", maxX: pageSize.w - margin, maxWidth: contentW, size: 9,
    });
  });

  return { pageSize, margin, pages };
}

// ---- buildPdfBytes — adaptador de dibujo con pdf-lib (inyectado) -------------------------------
// PDFLib entra por INYECCIÓN: este módulo no lo importa ni lo carga (el test lo trae con
// createRequire, la app con pdf-loader.js/<script>) — es lo único que mide texto y trunca.

/** "basecero-informe-2026-09-01.pdf" — determinista, sin slug del nombre del periodo (que es
 *  texto libre del usuario). Mismo estilo que basecero-{hoy}.xlsx. */
export const reportFilename = (report) => `basecero-informe-${report.meta.startDate}.pdf`;

const PAPER = [0xed, 0xe6, 0xda];
const PAPER_INK = [0x1b, 0x1a, 0x16];
const PAPER_DIM = [0x6b, 0x64, 0x59];

function rgbFromParts(PDFLib, [r, g, b]) {
  return PDFLib.rgb(r / 255, g / 255, b / 255);
}

function rgbFromHex(PDFLib, hex) {
  const s = String(hex ?? "").replace("#", "");
  const r = parseInt(s.slice(0, 2), 16) || 0;
  const g = parseInt(s.slice(2, 4), 16) || 0;
  const b = parseInt(s.slice(4, 6), 16) || 0;
  return rgbFromParts(PDFLib, [r, g, b]);
}

// Alineación derecha y truncado con elipsis vía font.widthOfTextAtSize (§7.3): busca por
// bisección el prefijo más largo que, con la elipsis añadida, sigue cabiendo en maxWidth.
function truncateToFit(font, text, size, maxWidth) {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  const ellipsis = "…";
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(text.slice(0, mid) + ellipsis, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + ellipsis;
}

/** Adaptador: recorre layoutReport y dibuja con pdf-lib. Fondo `--paper`, StandardFonts
 *  Helvetica/HelveticaBold/Courier (Courier para las cifras, `--font-mono` del sistema).
 *  `drawText` con `winAnsiSafe` SIEMPRE — es la única frontera de saneo del módulo (Task 2).
 *  Devuelve Uint8Array. */
export async function buildPdfBytes(PDFLib, report, opts) {
  const { pageSize, pages } = layoutReport(report, opts);
  const doc = await PDFLib.PDFDocument.create();
  const helvetica = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const courier = await doc.embedFont(PDFLib.StandardFonts.Courier);
  const paper = rgbFromParts(PDFLib, PAPER);
  const ink = rgbFromParts(PDFLib, PAPER_INK);
  const dim = rgbFromParts(PDFLib, PAPER_DIM);

  for (const p of pages) {
    const pdfPage = doc.addPage([pageSize.w, pageSize.h]);
    pdfPage.drawRectangle({ x: 0, y: 0, width: pageSize.w, height: pageSize.h, color: paper });
    for (const b of p.blocks) {
      if (b.kind === "rule") {
        pdfPage.drawRectangle({ x: b.x, y: b.y, width: b.w, height: 1, color: dim });
      } else if (b.kind === "rect") {
        if (b.w > 0 && b.h > 0) pdfPage.drawRectangle({ x: b.x, y: b.y, width: b.w, height: b.h, color: rgbFromHex(PDFLib, b.color) });
      } else if (b.kind === "text") {
        const font = b.bold ? helveticaBold : b.mono ? courier : helvetica;
        const safe = winAnsiSafe(b.text);
        const fitted = truncateToFit(font, safe, b.size, b.maxWidth);
        const width = font.widthOfTextAtSize(fitted, b.size);
        const x = b.align === "right" ? b.maxX - width : b.x;
        pdfPage.drawText(fitted, { x, y: b.y, size: b.size, font, color: b.color ? rgbFromHex(PDFLib, b.color) : ink });
      }
    }
  }
  return doc.save();
}
