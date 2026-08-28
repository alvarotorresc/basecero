import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initFormat, fmtMoney, fmtMoneyParts, currencySymbol, currencyCode, appLocale, fmtNum2, fmtPct, fmtDec1 } from "../../app/js/format.js";

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
