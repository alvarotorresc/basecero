// El script de tema en línea del <head> (DESIGN.md §3, «sin parpadeo»): fija data-theme ANTES de que
// se pida ninguna hoja de estilo. No puede importar js/theme.js, así que duplica su lógica; este test
// lo extrae de index.html, lo evalúa con dobles de document, localStorage y matchMedia, y le pasa la
// MISMA tabla de casos que theme.test.mjs para que las dos copias no diverjan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { THEME_CASES } from "./fixtures/theme-cases.mjs";

const APP = fileURLToPath(new URL("../../app/app/", import.meta.url));
const html = readFileSync(APP + "index.html", "utf8");
const tokens = readFileSync(APP + "css/tokens.css", "utf8");

const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
const code = inline[1];
const head = html.slice(0, html.indexOf("</head>"));
const bgDe = (bloque) => tokens.match(new RegExp(bloque + "\\s*\\{[^}]*--bg:\\s*(#[0-9A-Fa-f]{6})"))[1];
const BG_CLARO = bgDe(":root");
const BG_OSCURO = bgDe(':root\\[data-theme="dark"\\]');

function run({ stored = null, throws = false, prefersDark = false, matchMedia = true, mediaThrows = false } = {}) {
  const attrs = {};
  const meta = { content: BG_CLARO, setAttribute(k, v) { this[k] = v; } };
  const document = {
    documentElement: { setAttribute(k, v) { attrs[k] = String(v); } },
    querySelector: (sel) => (sel === 'meta[name="theme-color"]' ? meta : null),
  };
  const storage = { getItem: (k) => (k === "bc-theme" ? stored : null) };
  const window = {
    get localStorage() { if (throws) throw new Error("SecurityError"); return storage; },
  };
  if (matchMedia) {
    window.matchMedia = (q) => {
      if (mediaThrows) throw new Error("matchMedia roto");
      return { matches: q === "(prefers-color-scheme: dark)" && prefersDark };
    };
  }
  new Function("document", "window", code)(document, window);
  return { attrs, meta };
}

test("index.html: el script de tema es el primero en línea, está en el <head> y va antes de todo CSS", () => {
  const pos = inline.index;
  assert.ok(pos < head.length, "el script de tema tiene que estar en el <head>");
  for (const m of html.matchAll(/<link[^>]*rel="stylesheet"/g)) {
    assert.ok(pos < m.index, "hay una hoja de estilo antes del script de tema: habría destello");
  }
  assert.ok(!/<script[^>]*\bsrc=/.test(html.slice(0, pos)), "ningún script externo debe ir antes");
});

test("index.html: color-scheme admite los dos temas y theme-color arranca con el --bg claro", () => {
  assert.match(head, /<meta name="color-scheme" content="light dark">/);
  const tc = head.match(/<meta name="theme-color" content="([^"]+)">/);
  assert.equal(tc[1], BG_CLARO);
  assert.ok(tc.index < inline.index, "el script corrige el theme-color: la meta tiene que existir ya");
});

for (const c of THEME_CASES) {
  test(`script en línea: ${c.name}`, () => {
    const { attrs, meta } = run(c);
    assert.equal(attrs["data-theme"], c.dark ? "dark" : undefined);
    // El theme-color del oscuro tiene que ser el --bg oscuro de tokens.css (si cambia, cambian los dos).
    assert.equal(meta.content, c.dark ? BG_OSCURO : BG_CLARO);
  });
}

test("script en línea: sin matchMedia, Sistema se queda en claro y no lanza", () => {
  const { attrs } = run({ stored: "system", matchMedia: false });
  assert.equal(attrs["data-theme"], undefined);
});

test("script en línea: si matchMedia lanza, no rompe la carga y Sistema queda en claro", () => {
  const { attrs } = run({ stored: "system", prefersDark: true, mediaThrows: true });
  assert.equal(attrs["data-theme"], undefined);
});

test("script en línea: si matchMedia lanza, Oscuro guardado sigue aplicándose", () => {
  const { attrs } = run({ stored: "dark", mediaThrows: true });
  assert.equal(attrs["data-theme"], "dark");
});
