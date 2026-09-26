// Paleta del PDF del Informe (D-impl-3): sale de parsear el bloque `:root{` (claro) de tokens.css,
// así en JS no hay ni un hex y el papel nunca hereda el tema oscuro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseRootTokens, loadPdfPalette, rgbOf } from "../../app/app/js/pdf-palette.js";
import { FAMILIES } from "../../app/app/js/category-colors.js";

const TOKENS = readFileSync(new URL("../../app/app/css/tokens.css", import.meta.url), "utf8");

test("parseRootTokens sobre el tokens.css real: 12 -b y 12 -t de familia, con los valores claros", () => {
  const p = parseRootTokens(TOKENS);
  for (const k of FAMILIES) {
    assert.match(p[`--f-${k}-b`] ?? "", /^#[0-9A-Fa-f]{6}$/, `--f-${k}-b`);
    assert.match(p[`--f-${k}-t`] ?? "", /^#[0-9A-Fa-f]{6}$/, `--f-${k}-t`);
  }
  assert.equal(Object.keys(p).filter((n) => /^--f-[a-z]+-b$/.test(n)).length, 12);
  assert.equal(Object.keys(p).filter((n) => /^--f-[a-z]+-t$/.test(n)).length, 12);
  // Valor del bloque claro (paleta-familias.md), no del oscuro.
  assert.equal(p["--f-casa-b"].toUpperCase(), "#A8895F");
  assert.equal(p["--f-otr-b"].toUpperCase(), "#9A968C");
});

test("parseRootTokens no lee el bloque oscuro ni lo que venga detrás de :root", () => {
  const css = ':root{--f-casa-b:#111111;--x:var(--y)}\n:root[data-theme="dark"]{--f-casa-b:#222222;--solo-oscuro:#333333}';
  assert.deepEqual(parseRootTokens(css), { "--f-casa-b": "#111111" }, "solo hex; nada del bloque oscuro");
  const real = parseRootTokens(TOKENS);
  const dark = TOKENS.slice(TOKENS.indexOf(':root[data-theme="dark"]'));
  assert.ok(dark.includes(`--f-casa-b:${"#"}C0A389`), "precondición: el oscuro trae otro valor");
  assert.notEqual(real["--f-casa-b"].toUpperCase(), "#C0A389");
});

test("parseRootTokens: entrada vacía o sin :root da {}", () => {
  assert.deepEqual(parseRootTokens(""), {});
  assert.deepEqual(parseRootTokens("body{color:red}"), {});
  assert.deepEqual(parseRootTokens(undefined), {});
});

test("rgbOf: token → [r,g,b] 0..255; token ausente o sin paleta → null", () => {
  const p = parseRootTokens(TOKENS);
  assert.deepEqual(rgbOf("--f-casa-b", p), [0xa8, 0x89, 0x5f]);
  assert.equal(rgbOf("--no-existe", p), null);
  assert.equal(rgbOf("--f-casa-b", undefined), null);
});

test("loadPdfPalette: pide css/tokens.css con el fetch inyectado y lo parsea", async () => {
  const asked = [];
  const fakeFetch = async (url) => { asked.push(url); return { ok: true, text: async () => TOKENS }; };
  const p = await loadPdfPalette(fakeFetch);
  assert.deepEqual(asked, ["css/tokens.css"]);
  assert.equal(p["--f-casa-b"].toUpperCase(), "#A8895F");
});

test("loadPdfPalette: si la respuesta falla, devuelve {} (el PDF sale con el gris de papel, no revienta)", async () => {
  assert.deepEqual(await loadPdfPalette(async () => ({ ok: false, text: async () => "" })), {});
  assert.deepEqual(await loadPdfPalette(async () => { throw new Error("offline"); }), {});
});
