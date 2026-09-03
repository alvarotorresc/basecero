// skeletonHtml es puro (devuelve un string): se testea igual que charts.js, sin DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { skeletonHtml } from "../../app/app/js/skeleton.js";

test("skeletonHtml: un bloque por altura, con la clase y la altura en px", () => {
  const html = skeletonHtml([64, 168]);
  assert.equal((html.match(/class="skeleton"/g) ?? []).length, 2);
  assert.ok(html.includes("height:64px"));
  assert.ok(html.includes("height:168px"));
  assert.ok(html.includes('aria-hidden="true"'), "es relleno visual: no se anuncia");
});

test("skeletonHtml: alturas raras se acotan a 0 y una lista vacía no pinta bloques", () => {
  const html = skeletonHtml([-40, NaN, 12.6]);
  assert.ok(html.includes("height:0px"), `sin acotar: ${html}`);
  assert.equal((html.match(/height:-/g) ?? []).length, 0, "height:-40px es CSS inválido");
  assert.ok(html.includes("height:13px"), "se redondea a entero de px");
  assert.equal((html.match(/class="skeleton"/g) ?? []).length, 3);
  assert.equal((skeletonHtml([]).match(/class="skeleton"/g) ?? []).length, 0);
});
