import { test } from "node:test";
import assert from "node:assert/strict";
import { evalExpr } from "../../app/js/expr.js";

test("identidad: sin acumulador (acc=null) devuelve el operando tal cual — paridad con el estado de hoy (sin operador)", () => {
  assert.equal(evalExpr(null, null, 1250), 1250);
  assert.equal(evalExpr(null, "+", 1250), 1250); // acc null manda, op ignorado
});

test("suma: 12,00 + 12,90 = 24,90", () => {
  assert.equal(evalExpr(1200, "+", 1290), 2490);
});

test("resta: negativos permitidos (10,00 - 15,00 = -5,00)", () => {
  assert.equal(evalExpr(1000, "−", 1500), -500);
});

test("multiplicación con corrección /100: 12,50 × 3 = 37,50", () => {
  assert.equal(evalExpr(1250, "×", 300), 3750);
});

test("división con corrección ×100 y redondeo: 12,50 ÷ 3 ≈ 4,17", () => {
  assert.equal(evalExpr(1250, "÷", 300), 417);
});

test("división por cero es no-op: devuelve el acumulador intacto", () => {
  assert.equal(evalExpr(1000, "÷", 0), 1000);
});

test("cadena izquierda-a-derecha sin precedencia: 10,00 + 5,00 − 2,00 = 13,00 (dos plegados sucesivos, como hará el teclado)", () => {
  let acc = evalExpr(null, null, 1000); // primer operando, sin operador aún
  acc = evalExpr(acc, "+", 500);
  acc = evalExpr(acc, "−", 200);
  assert.equal(acc, 1300);
});

test("alias ASCII tolerados junto a los símbolos Unicode que envía el teclado (-, *, /)", () => {
  assert.equal(evalExpr(1000, "-", 1500), -500);
  assert.equal(evalExpr(1250, "*", 300), 3750);
  assert.equal(evalExpr(1250, "/", 300), 417);
});

test("operador desconocido/null con acc presente: devuelve el operando (no rompe, no NaN)", () => {
  assert.equal(evalExpr(1000, null, 500), 500);
  assert.equal(evalExpr(1000, "?", 500), 500);
});

test("nunca NaN/Infinity: entradas no finitas caen a un valor seguro (nunca NaN/Infinity de vuelta)", () => {
  assert.equal(evalExpr(NaN, "+", 500), 500); // acc no finito = como acc null: manda el operando
  assert.equal(evalExpr(1000, "+", NaN), 1000); // operando no finito se sanea a 0
  assert.equal(evalExpr(Infinity, "+", 500), 500); // acc no finito = como acc null
  const r = evalExpr(1000, "+", 500);
  assert.equal(Number.isFinite(r), true);
});
