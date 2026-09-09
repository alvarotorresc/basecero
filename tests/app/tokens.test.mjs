import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CSS = fileURLToPath(new URL("../../app/app/css/", import.meta.url));
const FONTS = fileURLToPath(new URL("../../app/app/vendor/fonts/", import.meta.url));
const fonts = readFileSync(FONTS + "fonts.css", "utf8");

test("fonts.css: declara las dos familias del sistema v2 y ninguna otra", () => {
  const familias = [...fonts.matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(familias)].sort(), ["JetBrains Mono", "Schibsted Grotesk"]);
});

test("fonts.css: cada url() apunta a un fichero que existe", () => {
  const urls = [...fonts.matchAll(/url\(\.\/([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 2);
  for (const u of urls) assert.ok(existsSync(FONTS + u), `fonts.css apunta a ${u}, que no existe`);
});

test("fonts.css: el subset latin cubre el euro y los diacríticos del español", () => {
  assert.ok(fonts.includes("U+0000-00FF"));
  assert.ok(fonts.includes("U+20AC"));
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
