// errors.js es puro (solo importa el t de i18n): se testea directo, sin DOM ni Worker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { UserError, userMessage, writeThenRefresh } from "../../app/app/js/errors.js";
import { t } from "../../app/app/js/i18n/index.js";

/** Ejecuta fn con console.error silenciado y devuelve lo que se le pasó (userMessage lo usa como
 *  ÚNICA salida técnica: sin esto, la suite escupiría los errores de prueba por stderr). */
function capturandoConsoleError(fn) {
  const original = console.error;
  const vistos = [];
  console.error = (...args) => vistos.push(args);
  try { return { valor: fn(), vistos }; } finally { console.error = original; }
}

test("UserError: es un Error de verdad, conserva el mensaje y se marca userFacing", () => {
  const e = new UserError("No hay ningún periodo abierto");
  assert.ok(e instanceof Error);
  assert.ok(e instanceof UserError);
  assert.equal(e.name, "UserError");
  assert.equal(e.message, "No hay ningún periodo abierto");
  assert.equal(e.userFacing, true);
});

test("userMessage: devuelve tal cual el mensaje de un UserError, sin tocar la consola", () => {
  const { valor, vistos } = capturandoConsoleError(() => userMessage(new UserError("Categoría no encontrada")));
  assert.equal(valor, "Categoría no encontrada");
  assert.deepEqual(vistos, [], "un error de usuario no es una incidencia técnica: no se loguea");
});

test("userMessage: también acepta el marcador userFacing en un Error corriente (sin instanceof)", () => {
  const e = new Error("La contraseña no es correcta");
  e.userFacing = true;
  const { valor, vistos } = capturandoConsoleError(() => userMessage(e));
  assert.equal(valor, "La contraseña no es correcta");
  assert.deepEqual(vistos, []);
});

test("userMessage: cualquier otra cosa da el mensaje genérico y va entera a console.error", () => {
  const tecnico = new Error("SQLITE_CONSTRAINT: CHECK constraint failed: amount_cents > 0");
  const { valor, vistos } = capturandoConsoleError(() => userMessage(tecnico));
  assert.equal(valor, t("errors.generic"));
  assert.equal(vistos.length, 1);
  assert.equal(vistos[0][0], tecnico, "se loguea el error entero, no su mensaje: hace falta el stack");

  // Y no revienta con lo que no es un Error (un reject con un string, un null…).
  for (const raro of [null, undefined, "boom", 42, { message: "no soy un Error" }]) {
    const r = capturandoConsoleError(() => userMessage(raro));
    assert.equal(r.valor, t("errors.generic"), `entrada rara: ${String(raro)}`);
  }
});

// ---- writeThenRefresh (revisión final B: detalle de movimiento) ------------------------------

test("writeThenRefresh: escritura y recarga bien → written sin error, en ese orden", async () => {
  const calls = [];
  const res = await writeThenRefresh(async () => { calls.push("write"); }, async () => { calls.push("refresh"); });
  assert.deepEqual(res, { written: true, error: null });
  assert.deepEqual(calls, ["write", "refresh"]);
});

test("writeThenRefresh: si falla la escritura no se recarga y written es false", async () => {
  const boom = new Error("db");
  let refreshed = false;
  const res = await writeThenRefresh(async () => { throw boom; }, async () => { refreshed = true; });
  assert.deepEqual(res, { written: false, error: boom });
  assert.equal(refreshed, false);
});

test("writeThenRefresh: si falla solo la recarga, la escritura cuenta como hecha (no «no se pudo guardar»)", async () => {
  const boom = new Error("reload");
  const res = await writeThenRefresh(async () => {}, async () => { throw boom; });
  assert.deepEqual(res, { written: true, error: boom });
});

test("writeThenRefresh: un throw síncrono de la escritura también se recoge", async () => {
  const res = await writeThenRefresh(() => { throw new Error("sync"); }, async () => {});
  assert.equal(res.written, false);
});
