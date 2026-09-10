import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initFormat, fmtMoney, fmtMoneyParts, moneyPartsHtml, currencySymbol, currencyCode, appLocale, fmtPct, fmtPct0, fmtDec1, parseCentsRaw, centsToRaw, fmtDiaCorto } from "../../app/app/js/format.js";

// Intl mete espacios no separadores (U+00A0/U+202F): normalizar antes de comparar.
const norm = (s) => s.replace(/\u00A0|\u202F/g, " ");

beforeEach(() => {
  initFormat({});
});

test("fmtMoney por defecto = comportamiento histórico (es-ES, EUR, agrupando SIEMPRE)", () => {
  assert.equal(norm(fmtMoney(180000)), "1.800,00 €"); // el bug de useGrouping min2 que documenta format.js:3-4
  assert.equal(norm(fmtMoney(null)), "0,00 €");
  assert.equal(currencySymbol(), "€");
  assert.equal(currencyCode(), "EUR");
  assert.equal(appLocale(), "es-ES");
});

test("initFormat aplica currency y locale de meta", () => {
  initFormat({ currency: "USD", locale: "en-US" });
  assert.equal(norm(fmtMoney(180000)), "$1,800.00");
  assert.equal(currencySymbol(), "$");
});

test("initFormat con valores inválidos cae a los defaults sin romper", () => {
  initFormat({ currency: "NOPE", locale: "xx-INVENTADO" });
  assert.equal(norm(fmtMoney(100)), "1,00 €");
});

test("fmtPct y fmtDec1 siguen el locale de initFormat", () => {
  assert.equal(norm(fmtPct(0.605)), "60,5 %");
  assert.equal(norm(fmtDec1(3.25)), "3,3");
  initFormat({ locale: "en-US" });
  assert.equal(norm(fmtPct(0.605)), "60.5%");
});

// Inicio v2 (plan 2026-09-10): la frase de ahorro y la de la hucha quieren el porcentaje SIN
// decimales («54 %», no «54,2 %» de fmtPct) — Intl ya mete el espacio duro que exige la
// tipografía es-ES.
test("fmtPct0: entero en es-ES con espacio duro, sin espacio en en-US", () => {
  assert.equal(norm(fmtPct0(0.542)), "54 %");
  initFormat({ locale: "en-US" });
  assert.equal(norm(fmtPct0(0.542)), "54%");
});

test("fmtMoneyParts (es-ES, EUR) separa main/cents/suffix — main incluye el separador decimal", () => {
  const parts = fmtMoneyParts(128450);
  assert.equal(norm(parts.main), "1.284,");
  assert.equal(parts.cents, "50");
  assert.equal(norm(parts.suffix), " €");
});

test("fmtMoneyParts(0) rellena céntimos a dos dígitos", () => {
  const parts = fmtMoneyParts(0);
  assert.equal(norm(parts.main), "0,");
  assert.equal(parts.cents, "00");
  assert.equal(norm(parts.suffix), " €");
});

test("fmtMoneyParts con moneda sin decimales (JPY, ja-JP) deja cents vacío", () => {
  initFormat({ currency: "JPY", locale: "ja-JP" });
  const parts = fmtMoneyParts(128450);
  assert.equal(parts.cents, "");
  assert.match(parts.main, /\d$/); // main termina en dígito: sin separador decimal que arrastrar
});

test("parseCentsRaw: coma decimal y casos base", () => {
  assert.equal(parseCentsRaw("1250,50"), 125050);
  assert.equal(parseCentsRaw("12"), 1200);
  assert.equal(parseCentsRaw(""), 0);
  assert.equal(parseCentsRaw("abc"), 0);
  assert.equal(parseCentsRaw("-300"), -30000);
});

test("parseCentsRaw: separador de miles ya no rompe el importe", () => {
  assert.equal(parseCentsRaw("1.250,50"), 125050);   // antes: 125 (1,25 €)
  assert.equal(parseCentsRaw("1.250"), 125000);       // solo puntos con grupos de 3 = millares
  assert.equal(parseCentsRaw("-1.250,50"), -125050);
  assert.equal(parseCentsRaw("12.5"), 1250);          // punto suelto sin coma = decimal tecleado
});

// B4: formato en-US (coma de millar, punto decimal) — antes de este fix, cualquier coma
// disparaba la rama "coma = decimal" y se comía el punto real como si fuera de millar
// («1,250.50» → 1,25 €, error ×1000 silencioso). Regla: cuando aparecen los DOS separadores,
// gana el que va último (es el decimal); con uno solo, el comportamiento de arriba no cambia.
test("parseCentsRaw: gana el último separador con coma Y punto a la vez (en-US)", () => {
  assert.equal(parseCentsRaw("1,250.50"), 125050);    // en-US: coma millar, punto decimal
  assert.equal(parseCentsRaw("1.250,50"), 125050);    // es-ES: punto millar, coma decimal (ya cubierto arriba)
  assert.equal(parseCentsRaw("12.5"), 1250);          // un solo separador: sin cambios
  // Un solo separador (coma) sigue siendo SIEMPRE decimal, sin importar cuántos dígitos la
  // sigan — "gana el último" es un desempate entre coma y punto, no una reinterpretación de
  // un separador solitario. "1,234" → 1,234 € (no 1.234 €).
  assert.equal(parseCentsRaw("1,234"), 123);
});

test("parseCentsRaw: guarda contra valores no finitos (Infinity)", () => {
  assert.equal(parseCentsRaw("1e400"), 0);
  assert.equal(parseCentsRaw("-1e400"), 0);
});

test("centsToRaw: inverso para precargar inputs", () => {
  assert.equal(centsToRaw(125050), "1250,50");
  assert.equal(centsToRaw(-30000), "300,00");
  assert.equal(centsToRaw(0), "");
});

test("moneyPartsHtml: parte el importe en entero, céntimos y símbolo", () => {
  const html = moneyPartsHtml(148015);
  assert.ok(html.includes('<span class="money-cents">'));
  assert.ok(html.includes('<span class="money-cur">'));
  // el símbolo va DENTRO de su span, como último elemento del HTML: es lo que el <small> de
  // antes no hacía (dejaba el sufijo colgando fuera, a tamaño pleno).
  assert.match(html, /<span class="money-cur">[^<]*<\/span>$/);
});
test("moneyPartsHtml: cero y negativos no rompen la anatomía", () => {
  for (const c of [0, -1850]) assert.equal((moneyPartsHtml(c).match(/<span/g) ?? []).length, 2);
});
test("moneyPartsHtml: escapa lo que sale de Intl", () => {
  assert.ok(!moneyPartsHtml(100).includes("<script"));
});

// fmtDiaCorto (§1.10 del plan de rediseño): Intl da "sept" para septiembre en es-ES (4 letras),
// y los artboards escriben "sep" (3). El recorte es solo cosmético sobre la abreviatura del mes.
test("fmtDiaCorto: recorta la abreviatura de mes de Intl a tres letras (sept -> sep)", () => {
  assert.equal(norm(fmtDiaCorto("2026-09-12")), "12 sep");
});
test("fmtDiaCorto: no toca el día ni el año, y no recorta un mes que ya viene en tres letras", () => {
  assert.equal(norm(fmtDiaCorto("2026-05-03")), "3 may");
  initFormat({ locale: "en-US" });
  assert.equal(norm(fmtDiaCorto("2026-09-12")), "Sep 12");
});
