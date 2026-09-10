import { test } from "node:test";
import assert from "node:assert/strict";
import { createSpeech } from "../../app/app/js/speech.js";
import { initI18n } from "../../app/app/js/i18n/index.js";

// `win` falso: mismo patrón que back.test.mjs#fakeWin — un constructor de reconocimiento que
// registra en qué instancia se llamó a start() y con qué propiedades quedó configurada, sin tocar
// nada real del navegador (en Node no existe SpeechRecognition).
function fakeWin({ webkit = false, standard = false, throwOnStart = false } = {}) {
  const instances = [];
  function FakeRecognition() {
    this.startCalls = 0;
    instances.push(this);
  }
  FakeRecognition.prototype.start = function () {
    this.startCalls += 1;
    if (throwOnStart) throw new Error("boom");
  };
  FakeRecognition.prototype.stop = function () { this.stopCalls = (this.stopCalls ?? 0) + 1; };
  const win = { instances };
  if (webkit) win.webkitSpeechRecognition = FakeRecognition;
  if (standard) win.SpeechRecognition = FakeRecognition;
  return win;
}

function fakeResult(transcript) {
  return { results: [[{ transcript }]] };
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

// D-2 (revisión de código): sin salida del estado "Escuchando…" cuando el reconocedor no dispara
// ni onresult ni onerror (solo onend), o cuando recognition.start() lanza de forma sincrónica.

test("start(): onresult entrega el transcript, y un onend posterior (asentado) NO llama a onError", () => {
  const win = fakeWin({ standard: true });
  const s = createSpeech(win);
  const results = [];
  let errorCalls = 0;
  s.start((text) => results.push(text), () => { errorCalls += 1; });
  const rec = win.instances[0];
  rec.onresult(fakeResult("doce en el bar"));
  rec.onend();
  assert.deepEqual(results, ["doce en el bar"]);
  assert.equal(errorCalls, 0);
});

test("start(): onerror llama a onError, y un onend posterior (asentado) no lo repite", () => {
  const win = fakeWin({ standard: true });
  const s = createSpeech(win);
  let errorCalls = 0;
  s.start(() => {}, () => { errorCalls += 1; });
  const rec = win.instances[0];
  rec.onerror();
  rec.onend();
  assert.equal(errorCalls, 1);
});

test("start(): un reconocimiento que termina sin resultado (solo onend, sin onresult ni onerror) llama a onError", () => {
  const win = fakeWin({ standard: true });
  const s = createSpeech(win);
  let errorCalls = 0;
  s.start(() => {}, () => { errorCalls += 1; });
  win.instances[0].onend();
  assert.equal(errorCalls, 1);
});

test("start(): onend sin asentar y sin onError no lanza (onError es opcional)", () => {
  const win = fakeWin({ standard: true });
  const s = createSpeech(win);
  assert.doesNotThrow(() => {
    s.start(() => {});
    win.instances[0].onend();
  });
});

test("start(): recognition.start() lanzando de forma sincrónica se atrapa y llama a onError, sin propagar", () => {
  const win = fakeWin({ standard: true, throwOnStart: true });
  const s = createSpeech(win);
  let errorCalls = 0;
  assert.doesNotThrow(() => s.start(() => {}, () => { errorCalls += 1; }));
  assert.equal(errorCalls, 1);
});

test("stop(): delega en recognition.stop() del reconocedor abierto", () => {
  const win = fakeWin({ standard: true });
  const s = createSpeech(win);
  s.start(() => {}, () => {});
  s.stop();
  assert.equal(win.instances[0].stopCalls, 1);
});
