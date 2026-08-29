// Regresión del "fix round 1" de Task 3 (bug real de dinero, ver task-3-report.md): el teclado
// de Registro no se testea directo (registro.js importa repo.js/db.js, con Worker/OPFS, fuera de
// alcance para node --test — mismo criterio que el resto de la suite). Este fichero reproduce el
// ALGORITMO exacto que registro.js usa para "back" justo tras un operador (computeRunning =
// foldPending + parseCentsRaw, y el guard `state.acc >= 0` antes de reconstruir raw vía
// centsToRaw) usando solo los módulos puros de los que depende (expr.js + format.js), sin
// duplicar su lógica de negocio: son las mismas funciones exportadas que registro.js llama.
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldPending } from "../../app/app/js/expr.js";
import { parseCentsRaw, centsToRaw } from "../../app/app/js/format.js";

// Mismo wrapper que computeRunning en registro.js.
const computeRunning = (acc, op, raw) => foldPending(acc, op, parseCentsRaw(raw), raw !== "");

test("bug real corregido: '5 − 10 + back' — el acumulador YA es correctamente negativo tras encadenar la resta", () => {
  let acc = computeRunning(null, null, "5"); // pressOp("−") pliega el primer operando: acc=500
  acc = computeRunning(acc, "−", "10");      // pressOp("+") pliega "5 − 10": acc=-500
  assert.equal(acc, -500);
});

test("bug real corregido: centsToRaw es Math.abs por contrato — reconstruir raw desde un acc NEGATIVO sin guardia blanquea el signo (esto es lo que pasaba ANTES del fix: −500 se volvía guardable como +500)", () => {
  const acc = -500; // "5 − 10", ya plegado
  const buggyRaw = centsToRaw(acc); // "5,00" — Math.abs, sin signo
  const buggyCents = parseCentsRaw(buggyRaw); // 500: el bug — un importe no guardable (-500) se vuelve guardable (+500)
  assert.equal(buggyRaw, "5,00");
  assert.equal(buggyCents, 500);
  assert.notEqual(buggyCents, acc); // documenta la divergencia que causaba el bug
});

test("fix: con acc<0 el 'back' de registro.js NO hace el round-trip por raw — cae al backspace normal sobre raw='', y computeRunning(acc, op, \"\") devuelve acc SIN TOCAR (signo intacto)", () => {
  const acc = -500, op = "+", raw = "";
  // Guard real de registro.js: `state.raw === "" && state.op != null && state.acc >= 0` — con
  // acc=-500 esa condición es falsa, así que la rama de abajo (el fix) es la que se ejecuta.
  const shouldUndoViaRaw = raw === "" && op != null && acc >= 0;
  assert.equal(shouldUndoViaRaw, false);
  const fixedCents = computeRunning(acc, op, raw); // el "back" cae aquí: setRaw(raw.slice(0,-1)) -> computeRunning
  assert.equal(fixedCents, -500); // el valor real se conserva, no se lanza por parseCentsRaw
});

test("el mismo guard SÍ deja deshacer el operador cuando acc>=0 (el camino feliz no cambia)", () => {
  const acc = 1700, op = "×", raw = "";
  const shouldUndoViaRaw = raw === "" && op != null && acc >= 0;
  assert.equal(shouldUndoViaRaw, true);
  const restoredRaw = centsToRaw(acc); // "17,00" — ida y vuelta limpia, sin signo que perder
  const restoredCents = computeRunning(null, null, restoredRaw); // acc/op ya a null tras el undo
  assert.equal(restoredCents, 1700);
});

test("acc===0 (operador como primera tecla) sigue produciendo raw limpio, no '0,00'", () => {
  assert.equal(centsToRaw(0), "");
});
