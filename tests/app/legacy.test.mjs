// legacy.css (los alias var() de «Neto» → sistema B) se borró en la PR-99, con todas las pantallas
// migradas. Que no vuelva: ni el fichero, ni su <link>, ni su entrada en el SHELL del service worker.
// Que ningún fichero lea o declare uno de sus nombres lo vigila R-LEGACY (design-rules.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../../app/app/", import.meta.url));
const html = readFileSync(APP + "index.html", "utf8");
const sw = readFileSync(APP + "sw.js", "utf8");

test("legacy.css: ya no existe", () => {
  assert.ok(!existsSync(APP + "css/legacy.css"), "css/legacy.css ha vuelto: el sistema B no lleva alias");
});

test("index.html: fuentes, tokens, components, app y screens, en ese orden (sin legacy)", () => {
  const hojas = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(hojas, ["vendor/fonts/fonts.css", "css/tokens.css", "css/components.css", "css/app.css", "css/screens.css"]);
});

test("sw.js: el SHELL ya no cita legacy.css", () => {
  assert.ok(!sw.includes("legacy.css"));
});
