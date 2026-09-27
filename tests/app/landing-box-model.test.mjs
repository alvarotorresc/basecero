// Regresión: scroll horizontal en la landing (2026-09-27). /app/css/tokens.css dejó de traer
// `* { box-sizing: border-box; margin: 0 }` cuando ese reset se movió a app.css con los tokens B
// (PR 33fe4c5) — y la landing NO carga app.css (ver la nota al principio de css/landing.css). Sin
// el reset, cualquier `.bc-wrap`/`.bc-frame` con padding + width:100% en content-box crece más allá
// de su contenedor: 32px de scroll horizontal en móvil y tablet, en las dos landings y en las
// páginas legales que comparten marcado (.lp-legal). Este test vigila que la landing siga trayendo
// su propio reset y no vuelva a depender del que solo carga la app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../../app/", import.meta.url));
const landingCss = readFileSync(APP + "css/landing.css", "utf8");

test("landing.css trae su propio box-sizing: border-box (no depende de app.css)", () => {
  assert.match(
    landingCss,
    /\*\s*,\s*\*::before\s*,\s*\*::after\s*\{[^}]*box-sizing:\s*border-box/,
    "falta el reset de box-sizing en css/landing.css: sin él, .bc-wrap y .bc-frame con padding se salen de su contenedor"
  );
});

test("landing.css pone body { margin: 0 } (el margen por defecto del UA rompe el ancho)", () => {
  assert.match(
    landingCss,
    /\bbody\s*\{[^}]*margin:\s*0\b/,
    "falta margin: 0 en el body de css/landing.css"
  );
});
