// pdf-lib con fuentes estandar codifica en WinAnsi y LANZA ante cualquier caracter fuera de esa
// tabla (verificado: `WinAnsi cannot encode "→" (0x2192)`). En esta app los nombres de
// categoria admiten emoji por diseno (CURATED_ICONS, category-colors.js:63) y los comercios vienen
// de CSV ajenos: sin este saneo, el PDF de un usuario normal revienta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { winAnsiSafe } from "../../app/app/js/informe-pdf.js";

test("winAnsiSafe: conserva lo que WinAnsi si codifica", () => {
  const ok = "Alimentación ñ áéíóú ü ç — · « » 1.480,15 €";
  assert.equal(winAnsiSafe(ok), ok);
});

test("winAnsiSafe: normaliza el menos tipografico y los espacios finos", () => {
  assert.equal(winAnsiSafe("−17,70 €"), "-17,70 €");
  // fr-FR emite U+202F (narrow no-break space) en sus importes: verificado con Intl en Node 22.
  const fr = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(-1234.5);
  assert.ok(fr.includes(" "));
  assert.ok(!winAnsiSafe(fr).includes(" "));
  assert.ok(winAnsiSafe(fr).includes(" "));
});

test("winAnsiSafe: nunca lanza con emoji ni flechas, y no deja runs de interrogantes", () => {
  assert.doesNotThrow(() => winAnsiSafe("🏠 Casa → 🎉"));
  assert.ok(!/\?\?/.test(winAnsiSafe("🏠🏠🏠 Casa")));
  assert.ok(winAnsiSafe("🏠 Casa").includes("Casa"));
});

test("winAnsiSafe: entradas raras no rompen", () => {
  assert.equal(winAnsiSafe(null), "");
  assert.equal(winAnsiSafe(undefined), "");
  assert.equal(winAnsiSafe(42), "42");
});
