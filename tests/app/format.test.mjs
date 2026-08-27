import { test } from "node:test";
import assert from "node:assert/strict";
import { initFormat, fmtMoney, currencySymbol, currencyCode, appLocale, fmtNum2, fmtPct, fmtDec1 } from "../../app/js/format.js";

// Intl mete espacios no separadores (U+00A0/U+202F): normalizar antes de comparar.
const norm = (s) => s.replace(/\u00A0|\u202F/g, " ");

test("fmtMoney por defecto = comportamiento histórico (es-ES, EUR, agrupando SIEMPRE)", () => {
  initFormat({});
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
  initFormat({}); // dejar el estado por defecto para el resto de la suite
});

test("initFormat con valores inválidos cae a los defaults sin romper", () => {
  initFormat({ currency: "NOPE", locale: "xx-INVENTADO" });
  assert.equal(norm(fmtMoney(100)), "1,00 €");
  initFormat({});
});

test("fmtNum2, fmtPct y fmtDec1 siguen el locale de initFormat", () => {
  initFormat({});
  // OJO paridad: los formateadores originales NO llevan useGrouping:"always" — en es-ES los
  // 4 dígitos NO agrupan ("1800,00"). No "arreglarlo": cambiaría la salida actual de la app.
  assert.equal(norm(fmtNum2(1800)), "1800,00");
  assert.equal(norm(fmtNum2(18000)), "18.000,00");
  assert.equal(norm(fmtPct(0.605)), "60,5 %");
  assert.equal(norm(fmtDec1(3.25)), "3,3");
  initFormat({ locale: "en-US" });
  assert.equal(norm(fmtNum2(1800)), "1,800.00");
  assert.equal(norm(fmtPct(0.605)), "60.5%");
  initFormat({});
});
