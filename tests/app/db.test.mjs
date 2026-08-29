// db.js depende de un Worker real (new Worker(...)) para initDb/call — no disponible en Node
// (mismo motivo documentado en repo-i18n-guards.test.mjs para repo.js). mapWorkerError es la
// única parte pura y exportada: el mapeo de código crudo del worker -> Error localizado, que
// SÍ es alcanzable sin mockear el Worker. El resto de B3 (worker.onerror marca el worker
// muerto y rechaza call() de inmediato) se verifica por lectura de código — ver task-7-report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapWorkerError } from "../../app/js/db.js";
import { t } from "../../app/js/i18n/index.js";

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
