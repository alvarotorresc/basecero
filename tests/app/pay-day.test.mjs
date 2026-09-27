// B-1 · Día de cobro (decisiones 2026-09-27): meta.pay_day (0/ausente = día 1). Lógica pura en
// app/app/js/pay-day.js: fecha propuesta para el periodo nuevo, su nombre y cuándo avisa Inicio.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePayDay, payDayToMeta, stepPayDay, payDateIn, lastPayDate, nextPayDateAfter,
  proposedPeriodStart, periodNameFor, payDayDue, isPayDate, MIN_PERIOD_DAYS,
} from "../../app/app/js/pay-day.js";

test("normalizePayDay: 0, vacío, ausente o basura = día 1; 1..31 tal cual", () => {
  for (const raw of [undefined, null, "", "0", 0, "abc", "-3", "32", "2.5", 40]) assert.equal(normalizePayDay(raw), 1, String(raw));
  assert.equal(normalizePayDay("28"), 28);
  assert.equal(normalizePayDay(31), 31);
  assert.equal(normalizePayDay("1"), 1);
});

test("payDayToMeta: el día 1 se guarda como '0' (la semilla); el resto, su número", () => {
  assert.equal(payDayToMeta(1), "0");
  assert.equal(payDayToMeta(0), "0");
  assert.equal(payDayToMeta(28), "28");
});

test("stepPayDay: sube y baja acotado a 1..31", () => {
  assert.equal(stepPayDay(1, -1), 1);
  assert.equal(stepPayDay(1, 1), 2);
  assert.equal(stepPayDay(31, 1), 31);
  assert.equal(stepPayDay(28, -1), 27);
});

test("payDateIn: meses cortos — el 31 en febrero cae en el último día (28, y 29 en bisiesto)", () => {
  assert.equal(payDateIn(2026, 1, 31), "2026-02-28");
  assert.equal(payDateIn(2028, 1, 31), "2028-02-29");
  assert.equal(payDateIn(2026, 1, 30), "2026-02-28");
  assert.equal(payDateIn(2026, 3, 31), "2026-04-30");
  assert.equal(payDateIn(2026, 8, 28), "2026-09-28");
  assert.equal(payDateIn(2026, 0, 1), "2026-01-01");
});

test("lastPayDate: el último día de cobro que ya llegó (hoy incluido)", () => {
  assert.equal(lastPayDate(28, "2026-09-28"), "2026-09-28");
  assert.equal(lastPayDate(28, "2026-09-27"), "2026-08-28");
  assert.equal(lastPayDate(1, "2026-09-27"), "2026-09-01");
  assert.equal(lastPayDate(31, "2026-03-05"), "2026-02-28");
  assert.equal(lastPayDate(28, "2026-01-10"), "2025-12-28", "cruza el año hacia atrás");
});

test("nextPayDateAfter: el primero ESTRICTAMENTE posterior, con el mes corto recortado", () => {
  assert.equal(nextPayDateAfter(28, "2026-08-28"), "2026-09-28");
  assert.equal(nextPayDateAfter(28, "2026-09-27"), "2026-09-28");
  assert.equal(nextPayDateAfter(31, "2026-01-31"), "2026-02-28");
  assert.equal(nextPayDateAfter(31, "2026-02-28"), "2026-03-31", "tras un inicio recortado, vuelve al 31");
  assert.equal(nextPayDateAfter(28, "2026-12-28"), "2027-01-28", "cruza el año hacia delante");
});

test("proposedPeriodStart (primer periodo): el último día de cobro que ya llegó", () => {
  assert.equal(proposedPeriodStart({ payDay: 28, todayIso: "2026-09-28" }), "2026-09-28");
  assert.equal(proposedPeriodStart({ payDay: 28, todayIso: "2026-10-10" }), "2026-09-28");
  assert.equal(proposedPeriodStart({ payDay: 1, todayIso: "2026-09-27" }), "2026-09-01");
});

test("proposedPeriodStart (cierre): el día de cobro si ya llegó y es posterior al inicio del abierto", () => {
  assert.equal(proposedPeriodStart({ payDay: 28, todayIso: "2026-09-28", openStartIso: "2026-08-28" }), "2026-09-28");
  // Se cierra tarde: la propuesta sigue siendo el día de cobro que abrió el periodo nuevo.
  assert.equal(proposedPeriodStart({ payDay: 28, todayIso: "2026-10-02", openStartIso: "2026-08-28" }), "2026-09-28");
  assert.equal(proposedPeriodStart({ payDay: 1, todayIso: "2026-10-03", openStartIso: "2026-09-01" }), "2026-10-01");
});

test("proposedPeriodStart (cierre adelantado): sin día de cobro nuevo, hoy (nunca una fecha que el guard rechace)", () => {
  // Cobro adelantado: hoy 26 y el día de cobro es el 28 — se propone hoy, no una fecha futura.
  assert.equal(proposedPeriodStart({ payDay: 28, todayIso: "2026-09-26", openStartIso: "2026-08-28" }), "2026-09-26");
  // El último día de cobro ES el inicio del abierto: no vale (periodStartTooEarly exige > inicio).
  assert.equal(proposedPeriodStart({ payDay: 28, todayIso: "2026-09-10", openStartIso: "2026-08-28" }), "2026-09-10");
});

test("proposedPeriodStart: un ajuste que no casa con la historia no parte el periodo abierto (MIN_PERIOD_DAYS)", () => {
  assert.equal(MIN_PERIOD_DAYS, 15);
  // Usuario de siempre SIN ajuste (día 1) cuyos periodos empiezan el 28: el 1 de septiembre está a
  // 4 días del inicio del abierto — proponerlo cerraría agosto el 31 con un mes de movimientos
  // dentro. Se propone hoy, como antes de B-1.
  assert.equal(proposedPeriodStart({ payDay: 1, todayIso: "2026-09-28", openStartIso: "2026-08-28" }), "2026-09-28");
  // Recién cambiado el ajuste del 1 al 28: el 28 está a 27 días del inicio, se propone.
  assert.equal(proposedPeriodStart({ payDay: 28, todayIso: "2026-09-28", openStartIso: "2026-09-01" }), "2026-09-28");
});

test("periodNameFor: nombre del mes que ocupa casi todo el periodo, con el año (formato de nombrePorDefecto)", () => {
  // Ancla del mockup B-PeriodoNuevo: empieza el 28 de septiembre → «Octubre».
  assert.equal(periodNameFor("2026-09-28", "es-ES"), "Octubre 2026");
  assert.equal(periodNameFor("2026-09-01", "es-ES"), "Septiembre 2026");
  assert.equal(periodNameFor("2026-09-15", "es-ES"), "Septiembre 2026");
  assert.equal(periodNameFor("2026-09-16", "es-ES"), "Octubre 2026");
  assert.equal(periodNameFor("2026-12-28", "es-ES"), "Enero 2027", "cruza el año");
  assert.equal(periodNameFor("2026-02-28", "es-ES"), "Marzo 2026", "el 31 recortado a febrero nombra marzo");
  assert.equal(periodNameFor("2026-09-28", "en-US"), "October 2026");
});

test("isPayDate: la fecha es el día de cobro de su mes (con el recorte de meses cortos)", () => {
  assert.equal(isPayDate(28, "2026-09-28"), true);
  assert.equal(isPayDate(28, "2026-09-27"), false);
  assert.equal(isPayDate(31, "2026-02-28"), true);
  assert.equal(isPayDate(30, "2026-02-28"), true);
});

test("payDayDue: el día de cobro que ya llegó con el periodo abierto sin cerrar", () => {
  assert.equal(payDayDue({ payDay: 28, openStartIso: "2026-08-28", todayIso: "2026-09-27" }), null);
  assert.equal(payDayDue({ payDay: 28, openStartIso: "2026-08-28", todayIso: "2026-09-28" }), "2026-09-28");
  assert.equal(payDayDue({ payDay: 28, openStartIso: "2026-08-28", todayIso: "2026-10-05" }), "2026-09-28");
  assert.equal(payDayDue({ payDay: 31, openStartIso: "2026-01-31", todayIso: "2026-02-28" }), "2026-02-28");
});

test("payDayDue: sin ajuste (día 1) no avisa — el aviso de fin de periodo de siempre ya lo cubre", () => {
  assert.equal(payDayDue({ payDay: 1, openStartIso: "2026-09-01", todayIso: "2026-10-01" }), null);
});

test("payDayDue: un periodo recién abierto no avisa a los pocos días (MIN_PERIOD_DAYS)", () => {
  // Abierto el 25 con el cobro el 28 (ajuste recién cambiado): el aviso espera al 28 de octubre.
  assert.equal(payDayDue({ payDay: 28, openStartIso: "2026-09-25", todayIso: "2026-09-28" }), null);
  assert.equal(payDayDue({ payDay: 28, openStartIso: "2026-09-25", todayIso: "2026-10-28" }), "2026-10-28");
});
