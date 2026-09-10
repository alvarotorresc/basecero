import { test } from "node:test";
import assert from "node:assert/strict";
import {
  annualCents, monthlyCents, activeSubscriptions, inactiveSubscriptions,
  annualTotalCents, monthlyTotalCents,
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
