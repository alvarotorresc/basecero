import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const CSS = fileURLToPath(new URL("../../app/app/css/", import.meta.url));
const FONTS = fileURLToPath(new URL("../../app/app/vendor/fonts/", import.meta.url));
const fonts = readFileSync(FONTS + "fonts.css", "utf8");

// Cada @font-face de fonts.css como { family, weight, url }, para comprobar pesos por familia.
const faces = [...fonts.matchAll(/@font-face\s*{([^}]*)}/g)].map(([, body]) => ({
  family: body.match(/font-family:\s*'([^']+)'/)[1],
  weight: body.match(/font-weight:\s*([^;]+);/)[1].trim(),
  url: body.match(/url\(\.\/([^)]+)\)/)[1],
}));
const pesos = (family) => faces.filter((f) => f.family === family).map((f) => f.weight).sort();

test("fonts.css: declara las tres familias del sistema B y las dos del v2, ninguna más", () => {
  // Schibsted Grotesk y JetBrains Mono se quedan hasta la PR-99 del rediseño B.
  assert.deepEqual([...new Set(faces.map((f) => f.family))].sort(),
    ["IBM Plex Mono", "Instrument Sans", "JetBrains Mono", "Schibsted Grotesk", "Unbounded"]);
});

test("fonts.css: cada url() apunta a un fichero que existe", () => {
  const urls = [...fonts.matchAll(/url\(\.\/([^)]+)\)/g)].map((m) => m[1]);
  assert.equal(urls.length, faces.length);
  for (const u of urls) assert.ok(existsSync(FONTS + u), `fonts.css apunta a ${u}, que no existe`);
});

test("fonts.css: el subset latin de cada @font-face cubre el euro y los diacríticos del español", () => {
  for (const m of fonts.matchAll(/@font-face\s*{([^}]*)}/g)) {
    assert.ok(m[1].includes("U+0000-00FF"), m[1]);
    assert.ok(m[1].includes("U+20AC"), m[1]);
    assert.match(m[1], /font-display:\s*swap;/);
  }
});

test("fonts.css: el font-weight de cada familia coincide con el eje real de su woff2", () => {
  // Ejes medidos con fontTools sobre los ficheros servidos (tabla fvar y OS/2 usWeightClass):
  // Unbounded estático 700; Instrument Sans variable wght 400-700; Plex Mono estático, uno por peso;
  // Schibsted variable 400-900 y JetBrains variable 400-800. Declarar un rango más corto que el eje
  // lo recorta y el navegador satura al extremo declarado.
  assert.deepEqual(pesos("Unbounded"), ["700"]);
  assert.deepEqual(pesos("Instrument Sans"), ["400 700"]);
  assert.deepEqual(pesos("IBM Plex Mono"), ["500", "600"]);
  assert.deepEqual(pesos("Schibsted Grotesk"), ["400 900"]);
  assert.deepEqual(pesos("JetBrains Mono"), ["400 800"]);
});

test("fonts.css: IBM Plex Mono va en un fichero por peso y no descarga el 400", () => {
  const plex = faces.filter((f) => f.family === "IBM Plex Mono");
  assert.equal(new Set(plex.map((f) => f.url)).size, plex.length);
  assert.ok(!plex.some((f) => f.weight === "400"));
});

test("vendor/fonts: cada familia del sistema B trae su licencia OFL", () => {
  for (const f of ["unbounded", "instrument-sans", "ibm-plex-mono"]) {
    const ruta = FONTS + f + "-OFL.txt";
    assert.ok(existsSync(ruta), `falta ${f}-OFL.txt`);
    assert.match(readFileSync(ruta, "utf8"), /SIL Open Font License, Version 1\.1/);
  }
});

test("vendor/fonts: ningún woff2 pasa de 120 KB", () => {
  const woff2 = readdirSync(FONTS).filter((f) => f.endsWith(".woff2"));
  assert.ok(woff2.length >= 6);
  for (const f of woff2) assert.ok(statSync(FONTS + f).size <= 120 * 1024, `${f} pesa más de 120 KB`);
});

const tokens = readFileSync(CSS + "tokens.css", "utf8");
const app = readFileSync(CSS + "app.css", "utf8");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// K2 (DESIGN §13): tokens.css es la copia BYTE A BYTE de design/design-system/tokens-B.css. La
// constante fija la copia en CI (design/ está ignorado en git); si tokens-B cambia, se vuelve a
// copiar con `cp` y se actualiza aquí, nunca se edita tokens.css a mano.
const TOKENS_B_SHA256 = "67c8c169844ed179bfd0547705fa4e47fe0d9418398dc54051b3807eebd02904";
const TOKENS_B = fileURLToPath(new URL("../../design/design-system/tokens-B.css", import.meta.url));

test("tokens.css (K2): su sha256 es el de la copia canónica de tokens-B.css", () => {
  assert.equal(sha256(readFileSync(CSS + "tokens.css")), TOKENS_B_SHA256);
});

test("tokens.css (K2): en local, sigue siendo idéntico a design/design-system/tokens-B.css",
  { skip: !existsSync(TOKENS_B) && "design/ no existe aquí (CI o worktree)" }, () => {
    assert.equal(sha256(readFileSync(CSS + "tokens.css")), sha256(readFileSync(TOKENS_B)),
      "tokens-B.css ha cambiado: vuelve a copiarlo con cp y actualiza TOKENS_B_SHA256");
  });

test("tokens.css: claro en :root y oscuro en :root[data-theme=dark], con --bg en los dos", () => {
  assert.match(tokens, /:root\s*\{[^}]*--bg:\s*#E3E1DC/i);
  assert.match(tokens, /:root\[data-theme="dark"\]\s*\{[^}]*--bg:\s*#161719/i);
});

test("tokens.css: solo tokens; ni @import de fuentes ni reglas de base", () => {
  assert.ok(!/@import/.test(tokens), "las fuentes entran por <link> en index.html");
  assert.ok(!/^\s*(\*|html|body|\.num)\s*\{/m.test(tokens), "reset, html, body y .num viven en app.css");
});

test("tokens.css: no queda ni rastro de Outfit", () => {
  assert.ok(!/Outfit/i.test(tokens));
});

test("app.css: sigue anulando el margen por defecto (el <dialog> modal depende de ello)", () => {
  assert.match(app, /\*\s*\{[^}]*margin:\s*0/);
});

test("app.css: html y body pintan con los tokens del sistema B", () => {
  assert.match(app, /html\s*\{[^}]*background:\s*var\(--bg\)/);
  assert.match(app, /body\s*\{[^}]*font-family:\s*var\(--font-body\)[^}]*color:\s*var\(--text\)/);
  assert.match(app, /\.num\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
});
