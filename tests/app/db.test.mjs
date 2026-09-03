// db.js depende de un Worker real (new Worker(...)) para initDb/call — no disponible en Node
// (mismo motivo documentado en repo-i18n-guards.test.mjs para repo.js). mapWorkerError es la
// única parte pura y exportada: el mapeo de código crudo del worker -> Error localizado, que
// SÍ es alcanzable sin mockear el Worker. El resto de B3 (worker.onerror marca el worker
// muerto y rechaza call() de inmediato) se verifica por lectura de código — ver task-7-report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapWorkerError } from "../../app/app/js/db.js";
import { t } from "../../app/app/js/i18n/index.js";
import { userMessage } from "../../app/app/js/errors.js";

test("mapWorkerError: unknown_op: -> mensaje localizado con el nombre de la operación", () => {
  const err = mapWorkerError("unknown_op:foo");
  assert.equal(err.message, t("errors.worker.unknownOp", { op: "foo" }));
});

test("mapWorkerError: not_initialized (B3) -> mensaje localizado, no el código crudo", () => {
  const err = mapWorkerError("not_initialized");
  assert.equal(err.message, t("errors.worker.notInitialized"));
  assert.notEqual(err.message, "not_initialized");
});

test("mapWorkerError: cualquier otro string -> Error con ese mensaje tal cual (ruta ya existente)", () => {
  const err = mapWorkerError("CHECK constraint failed: amount_cents != 0");
  assert.equal(err.message, "CHECK constraint failed: amount_cents != 0");
});

test("mapWorkerError: solo not_initialized es un error de usuario; unknown_op y el crudo, no", () => {
  assert.equal(mapWorkerError("not_initialized").userFacing, true,
    "el mensaje ya está escrito para el usuario y es accionable (esperar y reintentar)");
  assert.equal(userMessage(mapWorkerError("not_initialized")), t("errors.worker.notInitialized"));

  const original = console.error;
  console.error = () => {};
  try {
    // Un op desconocido es un bug de programación, y el error crudo del worker es texto de SQLite:
    // ninguno se le enseña a nadie.
    assert.notEqual(mapWorkerError("unknown_op:foo").userFacing, true);
    assert.equal(userMessage(mapWorkerError("unknown_op:foo")), t("errors.generic"));
    assert.notEqual(mapWorkerError("CHECK constraint failed: x").userFacing, true);
    assert.equal(userMessage(mapWorkerError("CHECK constraint failed: x")), t("errors.generic"));
  } finally { console.error = original; }
});
