// El SHELL del service worker es una lista de rutas a mano: si una deja de existir, el install
// falla ENTERO (sw.js:20 lanza si !r.ok) y la app se queda sin versión nueva sin decir nada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../../app/app/", import.meta.url));
const sw = readFileSync(APP + "sw.js", "utf8");
const shell = [...sw.matchAll(/"([^"]+)"/g)].map((m) => m[1])
  .filter((s) => s !== "./" && !s.startsWith("bc-v") && s.includes("."));

test("sw: CACHE tiene la forma bc-vNN", () => {
  assert.match(sw.match(/const CACHE = "([^"]+)"/)[1], /^bc-v\d+$/);
});

test("sw: cada entrada del SHELL existe en disco", () => {
  for (const rel of shell) assert.ok(existsSync(APP + rel), `SHELL apunta a un fichero que no existe: ${rel}`);
});

test("sw: los woff2 de las dos familias están en el SHELL", () => {
  assert.ok(shell.includes("vendor/fonts/schibsted-grotesk-latin.woff2"));
  assert.ok(shell.includes("vendor/fonts/jetbrains-mono-latin.woff2"));
  assert.ok(!sw.includes("QGYvz"), "Outfit ya no se sirve");
});

test("sw: pdf-lib está vendorizado y en el SHELL", () => {
  assert.ok(shell.includes("vendor/pdf-lib/pdf-lib.min.js"));
});
