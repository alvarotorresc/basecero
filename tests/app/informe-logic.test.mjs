import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../../app/app/js/informe-logic.js";

/** Fixture calcada de la hoja de datos del sistema (SISTEMA.md §5, periodo Septiembre 2026):
 *  periodo 2026-09-01, hoy 2026-09-09, ingresos 1.850,00 €, gastado 847,20 €, presupuesto
 *  1.200,00 € (740,00 € en las 4 categorias con limite listadas + 460,00 € en una categoria sin
 *  gasto este periodo, para que el total cuadre con la hoja sin inventar una octava fila en la
 *  comparativa). Dos cuentas checking (apertura/cierre calcadas de la hoja: 519,65 € -> 1.522,45 €,
 *  +1.002,80 €) mas una savings y una liability que NO deben entrar en el total operativo (D11). */
function fixture() {
  return {
    period: { id: "per-sep", name: "Septiembre 2026", start_date: "2026-09-01", end_date: "", status: "open", my_share_pct: 50 },
    prevPeriod: { id: "per-ago", name: "Agosto 2026", start_date: "2026-08-01", end_date: "2026-08-31", status: "closed", my_share_pct: 50 },
    accountsStart: [
      { id: "acc-corriente", name: "Cuenta corriente", type: "checking", balance_cents: 45965 },
      { id: "acc-efectivo", name: "Efectivo", type: "checking", balance_cents: 6000 },
      { id: "acc-fondo", name: "Fondo de emergencia", type: "savings", balance_cents: 300000 },
      { id: "acc-prestamo", name: "Prestamo coche", type: "liability", balance_cents: -350000 },
    ],
    accountsEnd: [
      { id: "acc-corriente", name: "Cuenta corriente", type: "checking", balance_cents: 148015 },
      { id: "acc-efectivo", name: "Efectivo", type: "checking", balance_cents: 4230 },
      { id: "acc-fondo", name: "Fondo de emergencia", type: "savings", balance_cents: 310000 },
      { id: "acc-prestamo", name: "Prestamo coche", type: "liability", balance_cents: -333000 },
    ],
    spentByRoot: [
      { root_id: "cat-casa", name: "Casa", spent_cents: 24560 },
      { root_id: "cat-alimentacion", name: "Alimentacion", spent_cents: 18740 },
      { root_id: "cat-coche", name: "Coche", spent_cents: 12180 },
      { root_id: "cat-restauracion", name: "Restauracion", spent_cents: 9630 },
      { root_id: "cat-ocio", name: "Ocio", spent_cents: 8995 },
      { root_id: "cat-transporte", name: "Transporte", spent_cents: 6400 },
      { root_id: "cat-salud", name: "Salud", spent_cents: 4215 },
    ],
    prevSpentByRoot: [
      { root_id: "cat-casa", name: "Casa", spent_cents: 23800 },
      { root_id: "cat-alimentacion", name: "Alimentacion", spent_cents: 21490 },
      { root_id: "cat-coche", name: "Coche", spent_cents: 7640 },
      { root_id: "cat-restauracion", name: "Restauracion", spent_cents: 14210 },
      { root_id: "cat-ocio", name: "Ocio", spent_cents: 6130 },
      { root_id: "cat-transporte", name: "Transporte", spent_cents: 5820 },
      { root_id: "cat-salud", name: "Salud", spent_cents: 3350 },
    ],
    budgets: [
      { id: "bud-casa", category_id: "cat-casa", amount_cents: 26000 },
      { id: "bud-alimentacion", category_id: "cat-alimentacion", amount_cents: 25000 },
      { id: "bud-restauracion", category_id: "cat-restauracion", amount_cents: 15000 },
      { id: "bud-ocio", category_id: "cat-ocio", amount_cents: 8000 },
      { id: "bud-ropa", category_id: "cat-ropa", amount_cents: 46000 },
    ],
    transactions: [
      { id: "t-restauracion-hoy", date: "2026-09-09", type: "expense", amount_cents: 1850, category_id: "cat-restauracion", merchant: "Bar La Plaza", note: "", is_shared: 0, account_id: "acc-corriente", counter_account_id: "", share_pct_override: null, paid_by: "me", ref_id: "", rule_id: "", status: "pending", my_amount_cents: 1850 },
      { id: "t-salud-hoy", date: "2026-09-09", type: "expense", amount_cents: 1490, category_id: "cat-salud", merchant: "Farmacia", note: "", is_shared: 0, account_id: "acc-corriente", counter_account_id: "", share_pct_override: null, paid_by: "me", ref_id: "", rule_id: "", status: "pending", my_amount_cents: 1490 },
      { id: "t-alimentacion-ayer", date: "2026-09-08", type: "expense", amount_cents: 2345, category_id: "cat-alimentacion", merchant: "Mercadona", note: "", is_shared: 0, account_id: "acc-corriente", counter_account_id: "", share_pct_override: null, paid_by: "me", ref_id: "", rule_id: "", status: "pending", my_amount_cents: 2345 },
      { id: "t-casa-7", date: "2026-09-07", type: "expense", amount_cents: 6790, category_id: "cat-casa", merchant: "Ferreteria Ruiz", note: "Reforma bano", is_shared: 0, account_id: "acc-corriente", counter_account_id: "", share_pct_override: null, paid_by: "me", ref_id: "", rule_id: "", status: "pending", my_amount_cents: 6790 },
      { id: "t-coche-5", date: "2026-09-05", type: "expense", amount_cents: 5230, category_id: "cat-coche", merchant: "Gasolinera", note: "", is_shared: 0, account_id: "acc-corriente", counter_account_id: "", share_pct_override: null, paid_by: "me", ref_id: "", rule_id: "", status: "pending", my_amount_cents: 5230 },
      { id: "t-alimentacion-compartido", date: "2026-09-02", type: "expense", amount_cents: 8430, category_id: "cat-alimentacion", merchant: "Mercadona", note: "", is_shared: 1, account_id: "acc-corriente", counter_account_id: "", share_pct_override: 50, paid_by: "me", ref_id: "", rule_id: "", status: "pending", my_amount_cents: 4215 },
      { id: "t-ocio-compartido", date: "2026-09-02", type: "expense", amount_cents: 11510, category_id: "cat-ocio", merchant: "Cafe Central", note: "", is_shared: 1, account_id: "acc-corriente", counter_account_id: "", share_pct_override: 50, paid_by: "me", ref_id: "", rule_id: "", status: "pending", my_amount_cents: 5755 },
      { id: "t-suscripcion-netflix", date: "2026-09-02", type: "expense", amount_cents: 1299, category_id: "cat-suscripciones", merchant: "Netflix", note: "cargo detectado como recurrente", is_shared: 0, account_id: "acc-corriente", counter_account_id: "", share_pct_override: null, paid_by: "me", ref_id: "", rule_id: "", status: "pending", my_amount_cents: 1299 },
      { id: "t-ingreso-nomina", date: "2026-09-01", type: "income", amount_cents: 185000, category_id: "cat-nomina", merchant: "Nomina agosto", note: "", is_shared: 0, account_id: "acc-corriente", counter_account_id: "", share_pct_override: null, paid_by: "me", ref_id: "", rule_id: "", status: "pending", my_amount_cents: 185000 },
    ],
    categoriesById: {
      "cat-casa": { id: "cat-casa", parent_id: "" },
      "cat-alimentacion": { id: "cat-alimentacion", parent_id: "" },
      "cat-coche": { id: "cat-coche", parent_id: "" },
      "cat-restauracion": { id: "cat-restauracion", parent_id: "" },
      "cat-ocio": { id: "cat-ocio", parent_id: "" },
      "cat-transporte": { id: "cat-transporte", parent_id: "" },
      "cat-salud": { id: "cat-salud", parent_id: "" },
      "cat-suscripciones": { id: "cat-suscripciones", parent_id: "" },
      "cat-nomina": { id: "cat-nomina", parent_id: "" },
      "cat-ropa": { id: "cat-ropa", parent_id: "" },
    },
    incomeCents: 185000,
    spentCents: 84720,
    partnerNetCents: 2260,
    partnerName: "Marta",
    subscriptionRules: [
      { id: "rule-spotify", name: "Spotify Duo", type: "expense", amount_cents: 1299, category_id: "cat-suscripciones", account_id: "acc-corriente", counter_account_id: "", frequency: "monthly", due_day: 14, due_month: null, is_shared: 0, is_active: 1, is_subscription: 1, cancelled_at: "" },
      { id: "rule-gimnasio", name: "Gimnasio", type: "expense", amount_cents: 3400, category_id: "cat-suscripciones", account_id: "acc-corriente", counter_account_id: "", frequency: "monthly", due_day: 3, due_month: null, is_shared: 0, is_active: 1, is_subscription: 1, cancelled_at: "" },
      { id: "rule-nube", name: "Almacenamiento nube", type: "expense", amount_cents: 299, category_id: "cat-suscripciones", account_id: "acc-corriente", counter_account_id: "", frequency: "monthly", due_day: 2, due_month: null, is_shared: 0, is_active: 1, is_subscription: 1, cancelled_at: "" },
      { id: "rule-revista", name: "Revista digital", type: "expense", amount_cents: 499, category_id: "cat-suscripciones", account_id: "acc-corriente", counter_account_id: "", frequency: "monthly", due_day: 12, due_month: null, is_shared: 0, is_active: 0, is_subscription: 1, cancelled_at: "2026-06-12" },
    ],
    todayIso: "2026-09-09",
  };
}

/** Fixture minima SIN compartidos ni transferencias: es el unico caso en que la variacion de
 *  saldos coincide EXACTAMENTE con ingresos-gastos (spec §5.4) — el guardarrail mas barato contra
 *  esa clase de error, sin acoplarlo a los numeros (con compartidos) de la hoja del sistema. */
function cleanFixture() {
  return {
    period: { id: "per-x", name: "Periodo X", start_date: "2026-09-01", end_date: "", status: "open", my_share_pct: 100 },
    prevPeriod: null,
    accountsStart: [{ id: "acc-1", name: "Cuenta unica", type: "checking", balance_cents: 500000 }],
    accountsEnd: [{ id: "acc-1", name: "Cuenta unica", type: "checking", balance_cents: 560000 }],
    spentByRoot: [],
    prevSpentByRoot: [],
    budgets: [],
    transactions: [],
    categoriesById: {},
    incomeCents: 100000,
    spentCents: 40000,
    partnerNetCents: 0,
    partnerName: "",
    subscriptionRules: [],
    todayIso: "2026-09-09",
  };
}

test("buildReport: el resumen cuadra con la hoja de datos del sistema", () => {
  const r = buildReport(fixture());
  assert.equal(r.summary.incomeCents, 185000);
  assert.equal(r.summary.spentCents, 84720);
  assert.equal(r.summary.savedCents, 100280);
  assert.equal(r.summary.availableCents, 35280);
  assert.equal(r.summary.savingsRatePct, 54);
});

test("buildReport: sin ingresos la tasa es null, nunca NaN", () => {
  const r = buildReport({ ...fixture(), incomeCents: 0 });
  assert.equal(r.summary.savingsRatePct, null);
});

// REGRESION del off-by-one: SQL.accountBalance filtra t.date <= ? (sql.js:280), asi que el
// saldo de apertura es el del DIA ANTERIOR a start_date (repo.reportInputs pasa prevDayIso). Aqui
// se comprueba el lado de buildReport: toma accountsStart TAL CUAL llega, sin volver a filtrar
// nada — si algun dia alguien pasa balancesAt(start_date) por error, este test no lo detecta (esa
// es la responsabilidad de repo-sql.test.mjs/Task 6), pero SI fija que buildReport nunca resta un
// dia por su cuenta ni descuenta el primer movimiento dos veces.
test("buildReport: la apertura no incluye los movimientos del primer dia (usa accountsStart tal cual)", () => {
  const f = fixture();
  const r = buildReport(f);
  const corriente = r.accounts.rows.find((a) => a.name === "Cuenta corriente");
  assert.equal(corriente.startCents, 45965, "el saldo de apertura es el que trae accountsStart, sin restar el primer dia otra vez");
});

test("buildReport: la variacion total cuadra con ingresos menos gastos", () => {
  const r = buildReport(cleanFixture());
  assert.equal(r.accounts.totalDeltaCents, r.summary.incomeCents - r.summary.spentCents);
});

test("buildReport: el total de cuentas es OPERATIVO — solo checking", () => {
  const r = buildReport(fixture());
  assert.deepEqual(r.accounts.rows.map((a) => a.name), ["Cuenta corriente", "Efectivo"]);
  assert.equal(r.accounts.totalStartCents, 51965);
  assert.equal(r.accounts.totalEndCents, 152245);
  assert.equal(r.accounts.totalDeltaCents, 100280);
});

test("buildReport: una cuenta nueva sin saldo inicial se lee 0 -> X", () => {
  const f = fixture();
  f.accountsStart.push({ id: "acc-nueva", name: "Cuenta nueva", type: "checking", balance_cents: 0 });
  f.accountsEnd.push({ id: "acc-nueva", name: "Cuenta nueva", type: "checking", balance_cents: 50000 });
  const r = buildReport(f);
  const nueva = r.accounts.rows.find((a) => a.name === "Cuenta nueva");
  assert.equal(nueva.startCents, 0);
  assert.equal(nueva.endCents, 50000);
  assert.equal(nueva.deltaCents, 50000);
});

test("buildReport: la estructura es serializable", () => {
  const r = buildReport(fixture());
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

