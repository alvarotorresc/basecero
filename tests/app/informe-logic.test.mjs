import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, previousPeriodOf } from "../../app/app/js/informe-logic.js";

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
      { id: "t-transferencia", date: "2026-09-03", type: "transfer", amount_cents: 10000, category_id: "", merchant: "", note: "", is_shared: 0, account_id: "acc-corriente", counter_account_id: "acc-fondo", share_pct_override: null, paid_by: "me", ref_id: "", rule_id: "", status: "pending", my_amount_cents: 10000 },
      { id: "t-ajuste", date: "2026-09-04", type: "adjustment", amount_cents: -500, category_id: "", merchant: "", note: "Ajuste de redondeo", is_shared: 0, account_id: "acc-corriente", counter_account_id: "", share_pct_override: null, paid_by: "me", ref_id: "", rule_id: "", status: "pending", my_amount_cents: -500 },
    ],
    categoriesById: {
      "cat-casa": { id: "cat-casa", name: "Casa", parent_id: "" },
      "cat-alimentacion": { id: "cat-alimentacion", name: "Alimentacion", parent_id: "" },
      "cat-coche": { id: "cat-coche", name: "Coche", parent_id: "" },
      "cat-restauracion": { id: "cat-restauracion", name: "Restauracion", parent_id: "" },
      "cat-ocio": { id: "cat-ocio", name: "Ocio", parent_id: "" },
      "cat-transporte": { id: "cat-transporte", name: "Transporte", parent_id: "" },
      "cat-salud": { id: "cat-salud", name: "Salud", parent_id: "" },
      "cat-suscripciones": { id: "cat-suscripciones", name: "Suscripciones", parent_id: "" },
      "cat-nomina": { id: "cat-nomina", name: "Nomina", parent_id: "" },
      "cat-ropa": { id: "cat-ropa", name: "Ropa", parent_id: "" },
    },
    incomeCents: 185000,
    spentCents: 84720,
    // Agosto: (190000-108300)/190000 = 43 % exacto — el «En agosto, el 43 %.» del artboard.
    prevIncomeCents: 190000,
    prevSpentCents: 108300,
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

// «Ahorras el 54 % de lo que ingresas. En agosto, el 43 %.» (Main.dc.html / Informe.dc.html): la
// segunda mitad de la frase necesita la tasa de ahorro del periodo ANTERIOR.
test("buildReport: la tasa de ahorro del periodo anterior tambien se calcula", () => {
  const r = buildReport(fixture());
  assert.equal(r.summary.prevSavingsRatePct, 43);
});

test("buildReport: sin ingresos previos (o sin periodo anterior) la tasa previa es null", () => {
  assert.equal(buildReport({ ...fixture(), prevIncomeCents: 0 }).summary.prevSavingsRatePct, null);
  assert.equal(buildReport(cleanFixture()).summary.prevSavingsRatePct, null);
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

// ---- Task 4: categorías y comparativa con el periodo anterior (N3) --------------------------

test("buildReport: las siete categorias con su comparativa contra agosto", () => {
  const { rows, totalCents, prevTotalCents, totalDeltaPct } = buildReport(fixture()).categories;
  const casa = rows.find((r) => r.rootId === "cat-casa");
  assert.equal(casa.spentCents, 24560);
  assert.equal(casa.prevCents, 23800);
  assert.equal(Number(casa.deltaPct.toFixed(1)), 3.2);
  assert.equal(casa.direction, "up");
  const ali = rows.find((r) => r.rootId === "cat-alimentacion");
  assert.equal(Number(ali.deltaPct.toFixed(1)), -12.8);
  assert.equal(ali.direction, "down"); // gastar menos es bueno (SISTEMA §4.19)
  assert.equal(totalCents, 84720);
  assert.equal(prevTotalCents, 82440);
  assert.equal(Number(totalDeltaPct.toFixed(1)), 2.8);
});

test("buildReport: sin periodo anterior no hay comparativa", () => {
  const r = buildReport({ ...fixture(), prevPeriod: null, prevSpentByRoot: [] });
  assert.equal(r.categories.hasPrev, false);
  for (const row of r.categories.rows) {
    assert.equal(row.prevCents, null);
    assert.equal(row.deltaPct, null);
    assert.equal(row.direction, "new");
  }
});

test("buildReport: categoria que no existia antes -> 'new', sin dividir por cero", () => {
  const f = fixture();
  f.spentByRoot.push({ root_id: "cat-nueva", name: "Categoria nueva", spent_cents: 5000 });
  // sin fila en prevSpentByRoot para cat-nueva: prevCents cae a 0 por defecto.
  const r = buildReport(f);
  const nueva = r.categories.rows.find((row) => row.rootId === "cat-nueva");
  assert.equal(nueva.prevCents, 0);
  assert.equal(nueva.direction, "new");
  assert.equal(nueva.deltaPct, null, "no se divide por cero: sin gasto previo no hay porcentaje");
});

test("buildReport: mismo gasto que el periodo anterior -> 'flat' y deltaPct 0", () => {
  const f = fixture();
  f.spentByRoot.push({ root_id: "cat-igual", name: "Categoria igual", spent_cents: 3000 });
  f.prevSpentByRoot.push({ root_id: "cat-igual", name: "Categoria igual", spent_cents: 3000 });
  const r = buildReport(f);
  const igual = r.categories.rows.find((row) => row.rootId === "cat-igual");
  assert.equal(igual.direction, "flat");
  assert.equal(igual.deltaPct, 0);
  assert.equal(igual.deltaCents, 0);
});

test("buildReport: categoria SIN limite -> limitCents 0, level null, pctOfLimit 0", () => {
  const coche = buildReport(fixture()).categories.rows.find((r) => r.rootId === "cat-coche");
  assert.equal(coche.limitCents, 0);
  assert.equal(coche.level, null); // null, NO "ok": budgetStatus devuelve null
  assert.equal(coche.pctOfLimit, 0);
  assert.ok(coche.shareOfMax >= 0 && coche.shareOfMax <= 100);
});

test("buildReport: raiz con gasto negativo (mas devoluciones que gasto) -> shareOfMax acotado", () => {
  const f = fixture();
  f.spentByRoot.push({ root_id: "cat-negativa", name: "Categoria negativa", spent_cents: -500 });
  const r = buildReport(f);
  const neg = r.categories.rows.find((row) => row.rootId === "cat-negativa");
  assert.ok(neg.shareOfMax >= 0 && neg.shareOfMax <= 100);
  assert.equal(neg.shareOfMax, 0, "un gasto negativo no puede dar un ancho de barra negativo");
});

test("buildReport: categoria al limite y excedida -> level warn / over", () => {
  const f = {
    ...cleanFixture(),
    spentByRoot: [
      { root_id: "cat-warn", name: "Al limite", spent_cents: 9000 },
      { root_id: "cat-over", name: "Excedida", spent_cents: 12000 },
    ],
    prevSpentByRoot: [],
    budgets: [
      { id: "b1", category_id: "cat-warn", amount_cents: 10000 },
      { id: "b2", category_id: "cat-over", amount_cents: 10000 },
    ],
  };
  const rows = buildReport(f).categories.rows;
  assert.equal(rows.find((r) => r.rootId === "cat-warn").level, "warn");
  assert.equal(rows.find((r) => r.rootId === "cat-over").level, "over");
});


// ---- Task 5: movimientos, compartidos y suscripciones ----------------------------------------

test("buildReport: movimientos agrupados por raiz y ordenados por fecha descendente", () => {
  const r = buildReport(fixture());
  const alimentacion = r.movements.groups.find((g) => g.rootId === "cat-alimentacion");
  assert.equal(alimentacion.count, 2);
  assert.deepEqual(alimentacion.items.map((i) => i.date), ["2026-09-08", "2026-09-02"]);
});

// El total de cabecera es el de spentByRootCategory, NO la suma de las filas: el SQL descuenta
// devoluciones con REFUND_REDUCES_SPEND (sql.js:11-12) y recalcular en JS abriria una divergencia
// silenciosa entre el informe y «Gasto por categoria». En este fixture la lista de movimientos es
// una MUESTRA (no el libro mayor completo del periodo): la suma de sus filas nunca coincide con
// el total real, que es justo lo que este test fija.
test("buildReport: el total de un grupo es el del SQL, no la suma de sus filas", () => {
  const r = buildReport(fixture());
  const alimentacion = r.movements.groups.find((g) => g.rootId === "cat-alimentacion");
  const sumaFilas = alimentacion.items.reduce((s, i) => s + i.cents, 0);
  assert.equal(alimentacion.totalCents, 18740);
  assert.notEqual(alimentacion.totalCents, sumaFilas);
});

test("buildReport: ingresos, transferencias y ajustes van al grupo 'others'", () => {
  const r = buildReport(fixture());
  const types = r.movements.others.items.map((i) => i.type).sort();
  assert.deepEqual(types, ["adjustment", "income", "transfer"]);
  assert.equal(r.movements.others.count, 3);
});

test("buildReport: count es el total de movimientos del periodo", () => {
  const f = fixture();
  const r = buildReport(f);
  assert.equal(r.movements.count, f.transactions.length);
});

test("buildReport: compartidos — integro y mi parte son cifras distintas", () => {
  const s = buildReport(fixture()).shared;
  assert.equal(s.periodTotalCents, 19940);
  assert.equal(s.myPartCents, 9970);
  assert.equal(s.netCents, 2260); // viene de fuera: NO esta acotado al periodo
  assert.equal(s.direction, "partner_owes");
});

test("buildReport: neto negativo -> 'i_owe'; neto 0 -> 'settled'", () => {
  assert.equal(buildReport({ ...fixture(), partnerNetCents: -500 }).shared.direction, "i_owe");
  assert.equal(buildReport({ ...fixture(), partnerNetCents: 0 }).shared.direction, "settled");
});

test("buildReport: sin partner_name la seccion de compartidos es null", () => {
  assert.equal(buildReport({ ...fixture(), partnerName: "" }).shared, null);
});

test("buildReport: suscripciones — 49,98 al mes y 599,76 al ano", () => {
  const sub = buildReport(fixture()).subscriptions;
  assert.equal(sub.activeCount, 3);
  assert.equal(sub.monthlyCents, 4998);
  assert.equal(sub.annualCents, 59976);
});

test("buildReport: una anual que no aplica este mes no suma al coste del periodo", () => {
  const f = {
    ...cleanFixture(),
    period: { id: "per-x", name: "Septiembre", start_date: "2026-09-01", end_date: "", status: "open", my_share_pct: 100 },
    subscriptionRules: [
      { id: "r-mensual", name: "Mensual", type: "expense", amount_cents: 1000, category_id: "", account_id: "acc-1", counter_account_id: "", frequency: "monthly", due_day: 5, due_month: null, is_shared: 0, is_active: 1, is_subscription: 1, cancelled_at: "" },
      { id: "r-anual", name: "Anual de marzo", type: "expense", amount_cents: 9999, category_id: "", account_id: "acc-1", counter_account_id: "", frequency: "yearly", due_day: 1, due_month: 3, is_shared: 0, is_active: 1, is_subscription: 1, cancelled_at: "" },
    ],
  };
  const sub = buildReport(f).subscriptions;
  assert.equal(sub.activeCount, 2);
  assert.equal(sub.periodCents, 1000, "septiembre no es marzo: la anual no aporta al coste de ESTE periodo");
});

test("buildReport: sin suscripciones activas la seccion es null", () => {
  assert.equal(buildReport({ ...fixture(), subscriptionRules: [] }).subscriptions, null);
});

// ---- Task 6: previousPeriodOf ------------------------------------------------------------------

test("previousPeriodOf: el anterior por start_date; el primero -> null; id desconocido -> null", () => {
  const periods = [
    { id: "p3", start_date: "2026-09-01" },
    { id: "p2", start_date: "2026-08-01" },
    { id: "p1", start_date: "2026-07-01" },
  ];
  assert.equal(previousPeriodOf(periods, "p3").id, "p2");
  assert.equal(previousPeriodOf(periods, "p2").id, "p1");
  assert.equal(previousPeriodOf(periods, "p1"), null, "el primero de la vida del usuario no tiene anterior");
  assert.equal(previousPeriodOf(periods, "desconocido"), null);
  assert.equal(previousPeriodOf([], "cualquiera"), null);
});
