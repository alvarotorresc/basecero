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
