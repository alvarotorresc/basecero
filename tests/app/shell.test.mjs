// El SHELL del service worker es una lista de rutas a mano: si una deja de existir, el install
// falla ENTERO (sw.js:20 lanza si !r.ok) y la app se queda sin versión nueva sin decir nada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
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

test("sw: cada woff2 y cada licencia de vendor/fonts está en el SHELL", () => {
  // Leído del disco, no de una lista: una fuente nueva que no entre en el SHELL se queda sin caché offline.
  const enDisco = readdirSync(APP + "vendor/fonts").filter((f) => f.endsWith(".woff2") || f.endsWith("-OFL.txt"));
  assert.ok(enDisco.filter((f) => f.endsWith(".woff2")).length >= 6, "faltan woff2 en vendor/fonts");
  for (const f of enDisco) assert.ok(shell.includes("vendor/fonts/" + f), `vendor/fonts/${f} no está en el SHELL`);
  assert.ok(!sw.includes("QGYvz"), "Outfit ya no se sirve");
});

test("sw: cada url() de fonts.css está en el SHELL", () => {
  const css = readFileSync(APP + "vendor/fonts/fonts.css", "utf8");
  const urls = [...css.matchAll(/url\(\.\/([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 2);
  for (const u of urls) assert.ok(shell.includes("vendor/fonts/" + u), `fonts.css sirve ${u}, que no está en el SHELL`);
});

test("sw: pdf-lib está vendorizado y en el SHELL", () => {
  assert.ok(shell.includes("vendor/pdf-lib/pdf-lib.min.js"));
});

test("sw: las hojas y módulos nuevos del sistema B están en el SHELL", () => {
  for (const f of ["css/tokens.css", "css/legacy.css", "css/components.css", "css/app.css", "css/screens.css", "js/theme.js"]) {
    assert.ok(shell.includes(f), `falta ${f} en el SHELL`);
  }
});
