// legacy.css: los alias «Neto» → sistema B mientras quedan pantallas sin migrar (se borra en la PR-99).
// Si un alias redeclara un token, pisa el valor canónico; si apunta a un hex, se salta el tema oscuro;
// si se carga antes que tokens.css, da igual el orden de var() pero no el de la cascada de :root.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../../app/app/", import.meta.url));
const tokens = readFileSync(APP + "css/tokens.css", "utf8");
const legacy = readFileSync(APP + "css/legacy.css", "utf8");
const html = readFileSync(APP + "index.html", "utf8");

const sinComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const declaraciones = (css) =>
  [...sinComentarios(css).matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);
const nombresTokens = new Set(declaraciones(tokens).map(([n]) => n));
const alias = declaraciones(legacy);
const nombresLegacy = new Set(alias.map(([n]) => n));

// Usados una vez cada uno y ya sin definir antes de esta PR: se quedan sin alias a propósito y
// pasan a la lista PENDIENTES de design-rules.test (PR-03).
const SIN_ALIAS = new Set(["--surface-1", "--r-1"]);

test("legacy.css: declara alias de verdad (no está vacío)", () => {
  assert.ok(alias.length >= 50, `solo ${alias.length} alias`);
});

test("legacy.css: no redeclara ningún nombre de tokens.css", () => {
  for (const [n] of alias) assert.ok(!nombresTokens.has(n), `${n} ya lo declara tokens.css: pisaría el canónico`);
});

test("legacy.css: cada valor es var(), color-mix con var(), una longitud o un atajo font con var()", () => {
  const VAR = /^var\(--[a-zA-Z0-9-]+\)$/;
  const MIX = /^color-mix\(in srgb, var\(--[a-zA-Z0-9-]+\) \d+%, transparent\)$/;
  const LONGITUD = /^(0|\d+(\.\d+)?(px|%))$/;
  const FONT = /^\d00 var\(--[a-z0-9-]+\)\/var\(--[a-z0-9-]+\) var\(--font-[a-z]+\)$/;
  for (const [n, v] of alias) {
    assert.ok(VAR.test(v) || MIX.test(v) || LONGITUD.test(v) || FONT.test(v), `${n}: "${v}" no es un valor permitido`);
  }
});

test("legacy.css: cada var() apunta a un token que existe en tokens.css", () => {
  for (const [n, v] of alias) {
    for (const [, ref] of v.matchAll(/var\((--[a-zA-Z0-9-]+)\)/g)) {
      assert.ok(nombresTokens.has(ref), `${n} apunta a ${ref}, que tokens.css no declara`);
    }
  }
});

test("index.html: fuentes, tokens, legacy, components y app, en ese orden", () => {
  const hojas = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(hojas, ["vendor/fonts/fonts.css", "css/tokens.css", "css/legacy.css",
    "css/components.css", "css/app.css"]);
});

// Todo nombre que la app lee con var() tiene que existir: si no, la propiedad cae a su valor
// inicial en silencio (color negro, radio 0…) y ningún test lo pinta.
function ficherosApp(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "vendor" ? [] : ficherosApp(p);
    return /\.(css|js)$/.test(e.name) && !["tokens.css", "legacy.css"].includes(e.name) ? [p] : [];
  });
}

test("app: cada var(--x) que se lee lo declara tokens.css, legacy.css o el propio código", () => {
  const fuentes = ficherosApp(APP).map((f) => readFileSync(f, "utf8"));
  // Propiedades locales que el código declara él mismo (p. ej. style="--cat:…").
  const locales = new Set(fuentes.flatMap((s) => [...s.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1])));
  const leidas = new Set(fuentes.flatMap((s) => [...s.matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map((m) => m[1])));
  const huerfanas = [...leidas].filter((n) =>
    !nombresTokens.has(n) && !nombresLegacy.has(n) && !locales.has(n) && !SIN_ALIAS.has(n));
  assert.deepEqual(huerfanas, []);
});

test("SIN_ALIAS: siguen sin definir en ningún sitio (si alguien los define, se sacan de la lista)", () => {
  for (const n of SIN_ALIAS) assert.ok(!nombresTokens.has(n) && !nombresLegacy.has(n), `${n} ya está definido`);
});
