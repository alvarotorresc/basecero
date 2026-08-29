import { test } from "node:test";
import assert from "node:assert/strict";
import { t, initI18n, activeLang, monthShort, weekdayInitial } from "../../app/app/js/i18n/index.js";
import { ES } from "../../app/app/js/i18n/es.js";
import { EN } from "../../app/app/js/i18n/en.js";

// Node 22 expone un `navigator` sintético cuyo `language` sale de LANG/LC_ALL del SO
// (ver p.ej. LC_ALL=es_ES.UTF-8 → "es-ES"): lo quitamos para que el fallback a
// navigator sea determinista en cualquier máquina, tal y como asume este test.
delete globalThis.navigator;

test("t: por defecto español, interpolación y plurales {one,other}", () => {
  assert.equal(activeLang(), "es");
  assert.equal(t("common.back"), "Atrás");
  assert.equal(t("i18n.demo.rows", { n: 1 }), "1 fila");
  assert.equal(t("i18n.demo.rows", { n: 3 }), "3 filas");
  assert.equal(t("clave.inexistente"), "clave.inexistente");
});

test("initI18n: meta.lang manda, vacío cae a navigator/es, inválido cae a es", () => {
  assert.equal(initI18n({ lang: "en" }), "en");
  assert.equal(t("common.back"), "Back");
  assert.equal(monthShort(8), "Sep");
  assert.equal(weekdayInitial(1), "M");
  assert.equal(initI18n({ lang: "xx" }), "es");
  assert.equal(initI18n({ lang: "" }), "es"); // en Node no hay navigator → es
  assert.equal(monthShort(8), "sep");
});

test("paridad de claves es/en y valores attribute-safe", () => {
  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) =>
    typeof v === "string" || v.one !== undefined ? [[p + k, v]] : flat(v, p + k + "."));
  const esKeys = flat(ES).map(([k]) => k).sort();
  const enKeys = flat(EN).map(([k]) => k).sort();
  assert.deepEqual(enKeys, esKeys);
  for (const dict of [ES, EN]) for (const [k, v] of flat(dict)) {
    for (const s of typeof v === "string" ? [v] : [v.one, v.other]) {
      assert.ok(!/["<]/.test(s), `valor no attribute-safe en ${k}: ${s}`);
    }
  }
});
