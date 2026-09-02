import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initFormat, fmtMoney, fmtMoneyParts, currencySymbol, currencyCode, appLocale, fmtNum2, fmtNum0, fmtPct, fmtDec1, parseCentsRaw, centsToRaw } from "../../app/app/js/format.js";

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

test("fmtNum2, fmtPct y fmtDec1 siguen el locale de initFormat", () => {
  // OJO paridad: los formateadores originales NO llevan useGrouping:"always" — en es-ES los
  // 4 dígitos NO agrupan ("1800,00"). No "arreglarlo": cambiaría la salida actual de la app.
  assert.equal(norm(fmtNum2(1800)), "1800,00");
  assert.equal(norm(fmtNum2(18000)), "18.000,00");
  assert.equal(norm(fmtPct(0.605)), "60,5 %");
  assert.equal(norm(fmtDec1(3.25)), "3,3");
  initFormat({ locale: "en-US" });
  assert.equal(norm(fmtNum2(1800)), "1,800.00");
  assert.equal(norm(fmtPct(0.605)), "60.5%");
});

test("fmtNum0: sin decimales, agrupando siempre (a diferencia de fmtNum2, para que un importe de 4 cifras quepa en columnas estrechas)", () => {
  assert.equal(norm(fmtNum0(0)), "0");
  assert.equal(norm(fmtNum0(1200.4)), "1.200");
  assert.equal(norm(fmtNum0(999.5)), "1.000");
  initFormat({ locale: "en-US" });
  assert.equal(norm(fmtNum0(0)), "0");
  assert.equal(norm(fmtNum0(1200.4)), "1,200");
  assert.equal(norm(fmtNum0(999.5)), "1,000");
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
