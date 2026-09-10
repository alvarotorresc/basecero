import { test } from "node:test";
import assert from "node:assert/strict";
import {
  annualCents, monthlyCents, activeSubscriptions, inactiveSubscriptions,
  annualTotalCents, monthlyTotalCents, nextRenewal, daysUntil, wholeMonthsBetween, savedSinceCancelCents,
  RENEWAL_SOON_DAYS, renewalNotice, parseIgnored, parseSnoozed, IGNORED_MAX,
  monthlyCommitmentCents,
} from "../../app/app/js/subscriptions.js";

/** Regla mínima con la forma de una fila real de recurring_rules — solo los campos que estos
 *  helpers miran. */
function rule(over = {}) {
  return {
    id: "rule-" + Math.floor(Math.random() * 1e9), amount_cents: 1299, frequency: "monthly",
    is_shared: 0, is_subscription: 1, is_active: 1, cancelled_at: "",
    ...over,
  };
}

test("annualCents: por las cuatro frecuencias, y una desconocida da 0", () => {
  assert.equal(annualCents(rule({ amount_cents: 1000, frequency: "weekly" })), 52000);
  assert.equal(annualCents(rule({ amount_cents: 1000, frequency: "monthly" })), 12000);
  assert.equal(annualCents(rule({ amount_cents: 1000, frequency: "quarterly" })), 4000);
  assert.equal(annualCents(rule({ amount_cents: 1000, frequency: "yearly" })), 1000);
  assert.equal(annualCents(rule({ amount_cents: 1000, frequency: "daily" })), 0);
});

test("monthlyCents: anual entre doce, redondeado", () => {
  assert.equal(monthlyCents(rule({ amount_cents: 1299, frequency: "monthly" })), 1299);
  assert.equal(monthlyCents(rule({ amount_cents: 9999, frequency: "yearly" })), 833); // 9999/12 = 833.25
});

// El test que fija el diseño (spec §3 D4, Suscripciones.dc.html:30-38): tres mensuales de
// 12,99 + 2,99 + 34,00 dan EXACTAMENTE 599,76 €/año y 49,98 €/mes.
test("annualTotalCents/monthlyTotalCents: tres mensuales dan 59976 y 4998 (el artboard)", () => {
  const rules = [
    rule({ amount_cents: 1299, frequency: "monthly" }),
    rule({ amount_cents: 299, frequency: "monthly" }),
    rule({ amount_cents: 3400, frequency: "monthly" }),
  ];
  assert.equal(annualTotalCents(rules), 59976);
  assert.equal(monthlyTotalCents(rules), 4998);
});

test("activeSubscriptions: excluye no marcadas, inactivas y canceladas", () => {
  const marcadaActiva = rule({ id: "a" });
  const noMarcada = rule({ id: "b", is_subscription: 0 });
  const inactivaSinCancelar = rule({ id: "c", is_active: 0 });
  const cancelada = rule({ id: "d", is_active: 0, cancelled_at: "2026-06-12" });
  const rows = [marcadaActiva, noMarcada, inactivaSinCancelar, cancelada];
  assert.deepEqual(activeSubscriptions(rows).map((r) => r.id), ["a"]);
});

// D3: el coste usa el importe ÍNTEGRO, nunca prorrateado — una suscripción compartida cuenta
// entera, sin que my_share_pct del periodo abierto entre en la cuenta.
test("activeSubscriptions/annualCents: una regla compartida cuenta por su importe ÍNTEGRO (D3)", () => {
  const compartida = rule({ amount_cents: 2000, frequency: "monthly", is_shared: 1 });
  assert.equal(annualCents(compartida), 24000, "sin prorratear: 20€ x 12, no la mitad");
  assert.deepEqual(activeSubscriptions([compartida]).map((r) => r.id), [compartida.id]);
});

test("inactiveSubscriptions: marcadas y NO activas (pausadas o canceladas), nunca las activas", () => {
  const activa = rule({ id: "a" });
  const pausada = rule({ id: "b", is_active: 0 });
  const cancelada = rule({ id: "c", is_active: 0, cancelled_at: "2026-06-12" });
  const noMarcada = rule({ id: "d", is_subscription: 0, is_active: 0 });
  const rows = [activa, pausada, cancelada, noMarcada];
  assert.deepEqual(inactiveSubscriptions(rows).map((r) => r.id), ["b", "c"]);
});

test("annualTotalCents/monthlyTotalCents: solo suman las activas, y una lista vacía da 0", () => {
  assert.equal(annualTotalCents([]), 0);
  assert.equal(monthlyTotalCents([]), 0);
  const rows = [rule({ id: "activa", amount_cents: 1000, frequency: "monthly" }),
    rule({ id: "cancelada", amount_cents: 999999, frequency: "yearly", is_active: 0, cancelled_at: "2026-01-01" })];
  assert.equal(annualTotalCents(rows), 12000, "la cancelada no cuenta aunque sea enorme");
});

// ---- nextRenewal --------------------------------------------------------------------------

test("nextRenewal: mensual con el día aún por llegar este mes", () => {
  const r = rule({ frequency: "monthly", due_day: 20 });
  assert.equal(nextRenewal(r, "2026-09-09"), "2026-09-20");
});

test("nextRenewal: mensual con el día ya pasado → el mes siguiente", () => {
  const r = rule({ frequency: "monthly", due_day: 2 });
  assert.equal(nextRenewal(r, "2026-09-09"), "2026-10-02");
});

test("nextRenewal: mensual, el día de hoy cuenta como 'todavía por llegar' (no se salta al mes siguiente)", () => {
  const r = rule({ frequency: "monthly", due_day: 9 });
  assert.equal(nextRenewal(r, "2026-09-09"), "2026-09-09");
});

test("nextRenewal: mensual, día 31 se recorta al último día del mes — 28 en febrero normal, 29 en bisiesto", () => {
  const normal = rule({ frequency: "monthly", due_day: 31 });
  assert.equal(nextRenewal(normal, "2026-02-01"), "2026-02-28", "2026 no es bisiesto");
  const bisiesto = rule({ frequency: "monthly", due_day: 31 });
  assert.equal(nextRenewal(bisiesto, "2028-02-01"), "2028-02-29", "2028 sí es bisiesto");
});

test("nextRenewal: anual con el mes ya pasado este año → el año que viene", () => {
  const r = rule({ frequency: "yearly", due_day: 14, due_month: 3 });
  assert.equal(nextRenewal(r, "2026-09-09"), "2027-03-14");
});

test("nextRenewal: anual con el mes aún por llegar este año", () => {
  const r = rule({ frequency: "yearly", due_day: 14, due_month: 12 });
  assert.equal(nextRenewal(r, "2026-09-09"), "2026-12-14");
});

test("nextRenewal: trimestral avanza de tres en tres meses desde due_month hasta alcanzar hoy", () => {
  const r = rule({ frequency: "quarterly", due_day: 15, due_month: 3 }); // ciclo: mar, jun, sep, dic
  assert.equal(nextRenewal(r, "2026-09-09"), "2026-09-15");
  assert.equal(nextRenewal(r, "2026-09-20"), "2026-12-15");
});

// Regresión: due_month=12 ancla el ciclo en dic/mar/jun/sep. Con hoy ANTES de esa ancla dentro
// del año (due_month - todayMonth > 0), la versión ingenua que solo SUMABA desde due_month se
// saltaba hasta 3 trimestres de más (devolvía diciembre en vez del marzo que tocaba).
test("nextRenewal: trimestral con due_month posterior al mes de hoy cae en el trimestre correcto, no 3 de más", () => {
  const r = rule({ frequency: "quarterly", due_day: 5, due_month: 12 }); // ciclo: dic, mar, jun, sep
  assert.equal(nextRenewal(r, "2026-01-10"), "2026-03-05");
  assert.equal(nextRenewal(r, "2026-04-10"), "2026-06-05");
});

test("nextRenewal: semanal siempre \"\" — el esquema no tiene ancla semanal (D5)", () => {
  const r = rule({ frequency: "weekly", due_day: 9 });
  assert.equal(nextRenewal(r, "2026-09-09"), "");
});

test("nextRenewal: due_day nulo → \"\" (monthly/quarterly/yearly)", () => {
  assert.equal(nextRenewal(rule({ frequency: "monthly", due_day: null }), "2026-09-09"), "");
  assert.equal(nextRenewal(rule({ frequency: "yearly", due_day: null, due_month: 3 }), "2026-09-09"), "");
});

test("nextRenewal: anual/trimestral sin due_month → \"\"", () => {
  assert.equal(nextRenewal(rule({ frequency: "yearly", due_day: 14, due_month: null }), "2026-09-09"), "");
  assert.equal(nextRenewal(rule({ frequency: "quarterly", due_day: 14, due_month: null }), "2026-09-09"), "");
});

// ---- daysUntil ----------------------------------------------------------------------------

test("daysUntil: hoy → 0, mañana → 1", () => {
  assert.equal(daysUntil("2026-09-09", "2026-09-09"), 0);
  assert.equal(daysUntil("2026-09-10", "2026-09-09"), 1);
});

test("daysUntil: cruzando un cambio de mes y un cambio de año", () => {
  assert.equal(daysUntil("2026-09-01", "2026-08-31"), 1);
  assert.equal(daysUntil("2027-01-01", "2026-12-31"), 1);
});

// ---- wholeMonthsBetween --------------------------------------------------------------------

test("wholeMonthsBetween: 12 jun → 9 sep = 2 (el 12 de septiembre aún no ha llegado)", () => {
  assert.equal(wholeMonthsBetween("2026-06-12", "2026-09-09"), 2);
});

test("wholeMonthsBetween: 12 jun → 12 sep = 3", () => {
  assert.equal(wholeMonthsBetween("2026-06-12", "2026-09-12"), 3);
});

test("wholeMonthsBetween: 31 ene → 28 feb = 1 (recorte de fin de mes: 28 es el último día de febrero)", () => {
  assert.equal(wholeMonthsBetween("2026-01-31", "2026-02-28"), 1);
});

test("wholeMonthsBetween: 31 ene → 27 feb = 0 (27 no es el último día de febrero)", () => {
  assert.equal(wholeMonthsBetween("2026-01-31", "2026-02-27"), 0);
});

test("wholeMonthsBetween: nunca negativo — una fecha 'to' anterior a 'from' da 0", () => {
  assert.equal(wholeMonthsBetween("2026-09-09", "2026-06-12"), 0);
});

// ---- savedSinceCancelCents ------------------------------------------------------------------

test("savedSinceCancelCents: 4,99 €/mes cancelada el 12 jun, hoy 9 sep → 998 (D6, meses completos)", () => {
  const r = rule({ amount_cents: 499, frequency: "monthly", is_active: 0, cancelled_at: "2026-06-12" });
  assert.equal(savedSinceCancelCents(r, "2026-09-09"), 998);
});

test("savedSinceCancelCents: sin cancelled_at → 0", () => {
  const r = rule({ amount_cents: 499, frequency: "monthly", is_active: 0, cancelled_at: "" });
  assert.equal(savedSinceCancelCents(r, "2026-09-09"), 0);
});

test("savedSinceCancelCents: el mismo día de la baja → 0", () => {
  const r = rule({ amount_cents: 499, frequency: "monthly", is_active: 0, cancelled_at: "2026-09-09" });
  assert.equal(savedSinceCancelCents(r, "2026-09-09"), 0);
});

test("savedSinceCancelCents: una anual de 99,99 € a los 5 meses redondea UNA sola vez", () => {
  const r = rule({ amount_cents: 9999, frequency: "yearly", is_active: 0, cancelled_at: "2026-04-09" });
  // round(9999 * 5 / 12) = round(4166.25) = 4166 — distinto de round(9999/12)*5 = 833*5 = 4165.
  assert.equal(savedSinceCancelCents(r, "2026-09-09"), 4166);
});

// ---- renewalNotice --------------------------------------------------------------------------

const TODAY = "2026-09-09";
const subRule = (over = {}) => rule({ id: "r-" + Math.floor(Math.random() * 1e9), name: "Spotify",
  frequency: "monthly", due_day: 14, due_month: null, ...over });

test("renewalNotice: elige la que renueva ANTES dentro de los próximos 7 días", () => {
  const pronto = subRule({ name: "Spotify", due_day: 11 }); // 2 días
  const lejos = subRule({ name: "Gimnasio", due_day: 25 }); // más de 7 días
  const notice = renewalNotice([pronto, lejos], TODAY);
  assert.equal(notice.ruleId, pronto.id);
  assert.equal(notice.name, "Spotify");
  assert.equal(notice.dueIso, "2026-09-11");
  assert.equal(notice.days, 2);
});

test("renewalNotice: a 8 días → null", () => {
  const r = subRule({ due_day: 17 }); // 2026-09-17, 8 días
  assert.equal(renewalNotice([r], TODAY), null);
});

test("renewalNotice: hoy → days=0", () => {
  const r = subRule({ due_day: 9 });
  const notice = renewalNotice([r], TODAY);
  assert.equal(notice.days, 0);
  assert.equal(notice.dueIso, TODAY);
});

test("renewalNotice: cancelada, pausada o no marcada → nunca avisa", () => {
  const cancelada = subRule({ due_day: 10, is_active: 0, cancelled_at: "2026-06-01" });
  const pausada = subRule({ due_day: 10, is_active: 0 });
  const noMarcada = subRule({ due_day: 10, is_subscription: 0 });
  assert.equal(renewalNotice([cancelada, pausada, noMarcada], TODAY), null);
});

test("renewalNotice: semanal → nunca (sin fecha de renovación, D5)", () => {
  const r = subRule({ frequency: "weekly", due_day: 10 });
  assert.equal(renewalNotice([r], TODAY), null);
});

test("renewalNotice: snoozed con la fecha exacta → null; con la del mes anterior → sí avisa", () => {
  const r = subRule({ due_day: 11 }); // due 2026-09-11
  assert.equal(renewalNotice([r], TODAY, { [r.id]: "2026-09-11" }), null,
    "silencia ESA fecha exacta");
  const notice = renewalNotice([r], TODAY, { [r.id]: "2026-08-11" });
  assert.ok(notice, "una fecha DISTINTA (la del mes pasado) no la silencia: vuelve a avisar sola");
  assert.equal(notice.dueIso, "2026-09-11");
});

test("renewalNotice: empate por importe (mayor primero) y luego por nombre", () => {
  const a = subRule({ name: "Zeta", due_day: 12, amount_cents: 1000 });
  const b = subRule({ name: "Alpha", due_day: 12, amount_cents: 2000 });
  const c = subRule({ name: "Beta", due_day: 12, amount_cents: 2000 });
  const notice = renewalNotice([a, b, c], TODAY);
  assert.equal(notice.name, "Alpha", "mismo importe que Beta: gana el nombre alfabéticamente antes");
});

test("renewalNotice: lista vacía → null", () => {
  assert.equal(renewalNotice([], TODAY), null);
});

test("RENEWAL_SOON_DAYS es 7", () => {
  assert.equal(RENEWAL_SOON_DAYS, 7);
});

// ---- parseIgnored / parseSnoozed -------------------------------------------------------------

test("parseIgnored: JSON roto → vacío; entradas no-string fuera; __proto__ no contamina; tope IGNORED_MAX", () => {
  assert.deepEqual(parseIgnored("{no es json"), []);
  assert.deepEqual(parseIgnored(undefined), []);
  assert.deepEqual(parseIgnored(JSON.stringify({ not: "an array" })), []);
  assert.deepEqual(parseIgnored(JSON.stringify(["netflix", 42, null, "spotify"])), ["netflix", "spotify"]);

  const withProto = parseIgnored(JSON.stringify(["netflix", "__proto__"]));
  assert.deepEqual(withProto, ["netflix"]);
  assert.equal(({}).polluted, undefined);

  const many = JSON.stringify(Array.from({ length: IGNORED_MAX + 50 }, (_, i) => "m" + i));
  assert.equal(parseIgnored(many).length, IGNORED_MAX);
});

test("parseSnoozed: JSON roto → vacío; entradas no-string/fechas mal formadas fuera; __proto__ no contamina", () => {
  assert.deepEqual(parseSnoozed("{no es json"), {});
  assert.deepEqual(parseSnoozed(undefined), {});
  assert.deepEqual(parseSnoozed(JSON.stringify(["not", "an", "object"])), {});
  assert.deepEqual(
    parseSnoozed(JSON.stringify({ "rule-1": "2026-09-14", "rule-2": 12345, "rule-3": "no-es-fecha" })),
    { "rule-1": "2026-09-14" },
  );

  const withProto = parseSnoozed(JSON.stringify({ "rule-1": "2026-09-14", "__proto__": "2026-09-14" }));
  assert.deepEqual(withProto, { "rule-1": "2026-09-14" });
  assert.equal(({}).polluted, undefined);
});

// ---- monthlyCommitmentCents (P4, spec §5.3) ------------------------------------------------

test("monthlyCommitmentCents: excluye type:\"income\"", () => {
  const nomina = rule({ type: "income", amount_cents: 185000, frequency: "monthly" });
  assert.equal(monthlyCommitmentCents([nomina]), 0);
});

test("monthlyCommitmentCents: excluye is_active:0 y cancelled_at", () => {
  const pausada = rule({ type: "expense", amount_cents: 1000, frequency: "monthly", is_active: 0 });
  const cancelada = rule({
    type: "expense", amount_cents: 1000, frequency: "monthly",
    is_active: 0, cancelled_at: "2026-06-01",
  });
  assert.equal(monthlyCommitmentCents([pausada, cancelada]), 0);
});

test("monthlyCommitmentCents: incluye type:\"transfer\"", () => {
  const ahorro = rule({ type: "transfer", amount_cents: 20000, frequency: "monthly" });
  assert.equal(monthlyCommitmentCents([ahorro]), 20000);
});

test("monthlyCommitmentCents: normaliza una anual y una trimestral con UN solo redondeo", () => {
  const anual = rule({ type: "expense", amount_cents: 9999, frequency: "yearly" }); // 9999/12 = 833.25
  const trimestral = rule({ type: "expense", amount_cents: 2500, frequency: "quarterly" }); // 2500*4/12 = 833.33
  assert.equal(monthlyCommitmentCents([anual]), 833);
  assert.equal(monthlyCommitmentCents([trimestral]), 833);
});

// El test que fija el diseño (spec §5.3, Recurrentes.dc.html:36): la lista del artboard da
// EXACTAMENTE 78988 (789,88 €/mes) — 650,00 + 89,90 + 34,00 + 12,99 + 2,99, todas mensuales.
test("monthlyCommitmentCents: la lista del artboard da 78988", () => {
  const rules = [
    rule({ type: "expense", amount_cents: 65000, frequency: "monthly" }),
    rule({ type: "expense", amount_cents: 8990, frequency: "monthly" }),
    rule({ type: "expense", amount_cents: 3400, frequency: "monthly", is_subscription: 1 }),
    rule({ type: "expense", amount_cents: 1299, frequency: "monthly", is_subscription: 1 }),
    rule({ type: "expense", amount_cents: 299, frequency: "monthly", is_subscription: 1 }),
  ];
  assert.equal(monthlyCommitmentCents(rules), 78988);
});

test("monthlyCommitmentCents: lista vacía o nula da 0", () => {
  assert.equal(monthlyCommitmentCents([]), 0);
  assert.equal(monthlyCommitmentCents(undefined), 0);
});
