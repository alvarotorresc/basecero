import { test } from "node:test";
import assert from "node:assert/strict";
import { initFormat, fmtMoney, currencySymbol, currencyCode, appLocale } from "../../app/js/format.js";

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
