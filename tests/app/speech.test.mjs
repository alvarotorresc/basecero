import { test } from "node:test";
import assert from "node:assert/strict";
import { createSpeech } from "../../app/app/js/speech.js";
import { initI18n } from "../../app/app/js/i18n/index.js";

// `win` falso: mismo patrón que back.test.mjs#fakeWin — un constructor de reconocimiento que
// registra en qué instancia se llamó a start() y con qué propiedades quedó configurada, sin tocar
// nada real del navegador (en Node no existe SpeechRecognition).
function fakeWin({ webkit = false, standard = false } = {}) {
  const instances = [];
  function FakeRecognition() {
    this.startCalls = 0;
    instances.push(this);
  }
  FakeRecognition.prototype.start = function () { this.startCalls += 1; };
  FakeRecognition.prototype.stop = function () { this.stopCalls = (this.stopCalls ?? 0) + 1; };
  const win = { instances };
  if (webkit) win.webkitSpeechRecognition = FakeRecognition;
  if (standard) win.SpeechRecognition = FakeRecognition;
  return win;
}

test("supported: false sin ninguna de las dos APIs", () => {
  assert.equal(createSpeech(fakeWin()).supported, false);
});

test("supported: true con webkitSpeechRecognition", () => {
  assert.equal(createSpeech(fakeWin({ webkit: true })).supported, true);
});

test("supported: true con SpeechRecognition", () => {
  assert.equal(createSpeech(fakeWin({ standard: true })).supported, true);
});

test("start(): sin soporte no lanza y no llama a nada (ni crea instancia, ni onResult/onError)", () => {
  const win = fakeWin();
  const s = createSpeech(win);
  let called = false;
  assert.doesNotThrow(() => s.start(() => { called = true; }, () => { called = true; }));
  assert.equal(called, false);
  assert.equal(win.instances.length, 0);
});

test("start(): fija lang según el idioma activo y las opciones fijas (continuous/interimResults/maxAlternatives)", () => {
  const win = fakeWin({ standard: true });
  const s = createSpeech(win);

  initI18n({ lang: "en" });
  s.start(() => {}, () => {});
  const rec1 = win.instances[0];
  assert.equal(rec1.lang, "en-US");
  assert.equal(rec1.continuous, false);
  assert.equal(rec1.interimResults, false);
  assert.equal(rec1.maxAlternatives, 1);
  assert.equal(rec1.startCalls, 1);

  initI18n({ lang: "es" });
  s.start(() => {}, () => {});
  const rec2 = win.instances[1];
  assert.equal(rec2.lang, "es-ES");
});
