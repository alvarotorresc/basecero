import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
const declara = (n) => new RegExp(`^\\s*${n.replace("--", "--")}\\s*:`, "m").test(tokens);

const NUEVOS = ["--bg","--surface","--surface-2","--hairline","--hairline-strong","--ink","--ink-2",
  "--ink-3","--accent","--accent-ink","--accent-tint","--pos","--pos-tint","--warn","--warn-tint",
  "--danger","--danger-tint","--scrim","--shadow-float","--paper","--paper-ink","--paper-dim",
  "--stamp","--r-0","--r-pill","--r-circle","--pad-screen","--gap-section","--font-sans",
  "--font-mono","--t-hero","--t-figure-xl","--t-figure-m","--t-title","--t-section","--t-body",
  "--t-label","--t-micro","--tabbar-h"];
// Los que las ~25 pantallas emiten inline: si uno desaparece, la pantalla que lo usa se queda sin color.
const ALIAS = ["--card","--card2","--text","--text-2","--text-3","--rule","--red","--green",
  "--amber","--radius","--radius-sm","--font-ui","--font-num"];

test("tokens.css: declara todos los tokens de SISTEMA.md §2", () => {
  for (const n of NUEVOS) assert.ok(declara(n), `falta el token ${n}`);
});

test("tokens.css: mantiene vivos los alias que las pantallas emiten inline", () => {
  for (const n of ALIAS) assert.ok(declara(n), `falta el alias ${n}`);
});

test("tokens.css: cada alias apunta a un token declarado, no a un hex suelto", () => {
  for (const n of ALIAS) {
    const valor = tokens.match(new RegExp(`${n}\\s*:\\s*([^;]+);`))[1].trim();
    const destino = valor.match(/^var\((--[a-z0-9-]+)\)$/);
    assert.ok(destino, `${n} debería ser var(--nuevo), es "${valor}"`);
    assert.ok(declara(destino[1]), `${n} apunta a ${destino[1]}, que no existe`);
  }
});

test("tokens.css: el fondo y el acento son los de v2", () => {
  assert.match(tokens, /--bg:\s*#0B0B0C/i);
  assert.match(tokens, /--accent:\s*#D4FF3F/i);
});

test("tokens.css: no queda ni rastro de Outfit", () => {
  assert.ok(!/Outfit/i.test(tokens));
});

test("tokens.css: sigue anulando el margen por defecto (el <dialog> modal depende de ello)", () => {
  assert.match(tokens, /\*\s*\{[^}]*margin:\s*0/);
});
