import { test } from "node:test";
import assert from "node:assert/strict";
import { periodMonth, ruleApplies, myAmountOfRule } from "../../app/js/prevision.js";
import { SQL } from "../../app/js/sql.js";
import { openDb, seedMinimal } from "./helpers.mjs";

const T = "2026-08-24T18:00:00Z";

/** Inserta una transacción usando la firma de SQL.insertTransaction (mismo helper que
 *  tests/app/compartidos.test.mjs). */
function ins(db, over = {}) {
  const v = {
    id: "t" + Math.floor(Math.random() * 1e9),
    date: "2026-08-20", period: "per-1", type: "expense", cents: 4520,
    account: "acc-n26", counterAccount: "", category: "cat-casa-alquiler",
    merchant: "", note: "", shared: 0, override: null, settled: 0,
    ref: "", rule: "", external: "", status: "pending",
    ...over,
  };
  db.prepare(SQL.insertTransaction).run(
    v.id, v.date, v.period, v.type, v.cents, v.account, v.counterAccount,
    v.category, v.merchant, v.note, v.shared, v.override, v.settled,
    v.ref, v.rule, v.external, v.status, T, T,
  );
  return v.id;
}

/** Inserta una regla recurrente usando la firma de SQL.insertRule (mismo helper que
 *  tests/app/recurrentes.test.mjs). */
function insRule(db, over = {}) {
  const v = {
    id: "rule" + Math.floor(Math.random() * 1e9),
    name: "Alquiler", type: "expense", cents: 90000,
    category: "cat-casa-alquiler", account: "acc-n26", counterAccount: "",
    frequency: "monthly", dueDay: 1, dueMonth: null,
    shared: 0, active: 1,
    ...over,
  };
  db.prepare(SQL.insertRule).run(
    v.id, v.name, v.type, v.cents, v.category, v.account, v.counterAccount,
    v.frequency, v.dueDay, v.dueMonth, v.shared, v.active, T, T,
  );
  return v.id;
}

test("periodMonth: mayor parte del rango", () => {
  // paridad Álvaro (abierto, día 27): el resultado NO cambia con la implementación nueva
  assert.equal(periodMonth("2026-07-27"), 8);
  assert.equal(periodMonth("2026-07-27", "2026-08-26"), 8); // cerrado, mismo rango
  assert.equal(periodMonth("2026-08-01"), 8);               // quien cobra el día 1
  assert.equal(periodMonth("2026-06-25", "2026-07-02"), 6); // periodo corto: manda junio (6 días vs 2)
  assert.equal(periodMonth("2026-02-14", "2026-03-13"), 2); // febrero: la heurística +15 decía marzo (mal)
  assert.equal(periodMonth("2026-02-15", "2026-03-14"), 3); // empate 14/14: gana el mes más tardío
  assert.equal(periodMonth("2026-03-10", "2026-03-01"), 3); // rango incoherente: cae al mes de inicio, sin lanzar
});

test("ruleApplies: matriz de reglas de negocio", () => {
  const base = { is_active: 1 };

  // monthly y weekly aplican siempre (RULING: weekly NO es "una vez por semana")
  assert.equal(ruleApplies({ ...base, frequency: "monthly" }, 8), true);
  assert.equal(ruleApplies({ ...base, frequency: "weekly" }, 8), true, "weekly aplica igual que monthly");

  // yearly: due_month === month
  assert.equal(ruleApplies({ ...base, frequency: "yearly", due_month: 11 }, 11), true);
  assert.equal(ruleApplies({ ...base, frequency: "yearly", due_month: 11 }, 8), false);

  // quarterly: ciclo de 3 en 3 meses desde due_month (2 -> 2,5,8,11)
  assert.equal(ruleApplies({ ...base, frequency: "quarterly", due_month: 2 }, 8), true);
  assert.equal(ruleApplies({ ...base, frequency: "quarterly", due_month: 2 }, 9), false);

  // inactiva: nunca aplica, sea cual sea la frecuencia
  assert.equal(ruleApplies({ is_active: 0, frequency: "monthly" }, 8), false);

  // quarterly/yearly sin due_month: nunca aplica (null O "" — la hoja usa IF(J="","no",...),
  // que es el guard fiel: "" no debe colar como 0 y aplicar por casualidad de módulo)
  assert.equal(ruleApplies({ ...base, frequency: "quarterly", due_month: null }, 8), false);
  assert.equal(ruleApplies({ ...base, frequency: "quarterly", due_month: "" }, 9), false,
    "'' no debe colar como due_month=0 (9-0=9, %3=0 daría 'sí' si no se guardase)");
});

test("myAmountOfRule: prorratea si is_shared, si no el importe íntegro", () => {
  assert.equal(myAmountOfRule({ is_shared: 1, amount_cents: 10000 }, 60), 6000);
  assert.equal(myAmountOfRule({ is_shared: 0, amount_cents: 10000 }, 60), 10000, "no compartida: ignora el pct");
});

test("SQL.accountBalance: expense resta, income suma, transfer resta origen y suma destino, refund suma, adjustment con signo, liability parte de opening negativo", () => {
  const db = openDb();
  seedMinimal(db);

  ins(db, { id: "e1", date: "2026-08-01", type: "expense", cents: 2000, account: "acc-n26" });
  ins(db, { id: "i1", date: "2026-08-02", type: "income", cents: 1500, account: "acc-n26", category: "cat-nomina" });
  ins(db, { id: "tr1", date: "2026-08-03", type: "transfer", cents: 3000, account: "acc-n26", counterAccount: "acc-revolut", category: "" });
  ins(db, { id: "r1", date: "2026-08-04", type: "refund", cents: 500, account: "acc-n26", ref: "e1" });
  ins(db, { id: "a1", date: "2026-08-05", type: "adjustment", cents: -700, account: "acc-n26", category: "" });
  ins(db, { id: "a2", date: "2026-08-06", type: "adjustment", cents: 300, account: "acc-revolut", category: "" });
  ins(db, { id: "eLiab", date: "2026-08-01", type: "expense", cents: 2000, account: "acc-prestamo" });

  const n26 = db.prepare(SQL.accountBalance).get("2026-12-31", "acc-n26").balance_cents;
  assert.equal(n26, 100000 - 2000 + 1500 - 3000 + 500 - 700, "100000 opening +/- cada movimiento");

  const revolut = db.prepare(SQL.accountBalance).get("2026-12-31", "acc-revolut").balance_cents;
  assert.equal(revolut, 50000 + 3000 + 300, "recibe la transferencia + su propio ajuste");

  const prestamo = db.prepare(SQL.accountBalance).get("2026-12-31", "acc-prestamo").balance_cents;
  assert.equal(prestamo, -600000 - 2000, "el opening negativo del pasivo se conserva y el gasto lo hunde más");

  // filtro por fecha: a "2026-08-02" solo cuentan e1 e i1
  const n26Corte = db.prepare(SQL.accountBalance).get("2026-08-02", "acc-n26").balance_cents;
  assert.equal(n26Corte, 100000 - 2000 + 1500);
});

test("SQL.accountBalance: la letra del préstamo como transfer hacia el pasivo acerca su saldo a cero", () => {
  const db = openDb();
  seedMinimal(db);
  // Letra de 200 €: sale de N26 y amortiza el préstamo (−6000 → −5800).
  ins(db, { id: "letra", date: "2026-08-27", type: "transfer", cents: 20000, account: "acc-n26", counterAccount: "acc-prestamo", category: "" });

  const prestamo = db.prepare(SQL.accountBalance).get("2026-12-31", "acc-prestamo").balance_cents;
  assert.equal(prestamo, -600000 + 20000);
  const n26 = db.prepare(SQL.accountBalance).get("2026-12-31", "acc-n26").balance_cents;
  assert.equal(n26, 100000 - 20000);
});

test("previsión del periodo (composición SQL + prevision.js): pagado por rule_id, pagado por fallback categoría+importe, disponible = saldo - comprometido + contraparte", () => {
  const db = openDb();
  seedMinimal(db); // per-1: start_date 2026-07-27 (periodMonth=8), my_share_pct=60; acc-n26 opening 100000

  const period = db.prepare("SELECT * FROM periods WHERE id='per-1'").get();
  const month = periodMonth(period.start_date);
  assert.equal(month, 8);

  // A: mensual, gasto, NO compartida -> aplica, se paga por rule_id
  const ruleA = insRule(db, { name: "Alquiler", frequency: "monthly", cents: 90000, shared: 0 });
  // B: anual (due_month=8, aplica este mes), gasto, COMPARTIDA -> se paga por fallback categoría+importe (SIN rule_id)
  const ruleB = insRule(db, { name: "Seguro anual", frequency: "yearly", dueMonth: 8, cents: 12000, shared: 1 });
  // C: anual due_month=3 -> NO aplica este mes (periodMonth=8)
  const ruleC = insRule(db, { name: "Otro seguro", frequency: "yearly", dueMonth: 3, cents: 5000 });
  // D: trimestral (due_month=2, aplica: 2,5,8,11), INGRESO -> aplica pero se excluye del comprometido
  const ruleD = insRule(db, {
    name: "Paga extra", type: "income", frequency: "quarterly", dueMonth: 2, cents: 50000,
    category: "cat-nomina",
  });
  // E: mensual pero INACTIVA -> no aplica
  const ruleE = insRule(db, { name: "Gimnasio (baja)", frequency: "monthly", cents: 4000, active: 0 });
  // F: mensual, gasto, sin pagar -> queda pendiente y SÍ cuenta en el comprometido
  const ruleF = insRule(db, { name: "Netflix", frequency: "monthly", cents: 1500 });

  // Movimientos del periodo:
  ins(db, { id: "pagoA", cents: 90000, rule: ruleA });                                  // paga A por rule_id
  ins(db, { id: "pagoB", cents: 12000, category: "cat-casa-alquiler" });                // paga B por fallback (mismo cat+importe SIN rule_id)
  ins(db, { id: "gastoContraparte", cents: 5000, shared: 1 });                          // pendiente con la contraparte, no ligado a ninguna regla

  const rules = db.prepare(SQL.listRules).all();
  const paidByRuleSet = new Set(db.prepare(SQL.paidRuleIds).all(period.id).map((r) => r.rule_id));
  const paidByCatSet = new Set(db.prepare(SQL.paidByCatAmount).all(period.id).map((r) => r.k));

  const items = rules
    .filter((r) => ruleApplies(r, month))
    .map((rule) => {
      const myCents = myAmountOfRule(rule, period.my_share_pct);
      const paid = paidByRuleSet.has(rule.id) || paidByCatSet.has(`${rule.category_id}|${rule.amount_cents}`);
      return { rule, myCents, paid };
    });

  assert.deepEqual(items.map((it) => it.rule.id).sort(), [ruleA, ruleB, ruleD, ruleF].sort(),
    "C (mes distinto) y E (inactiva) quedan fuera");

  const itemA = items.find((it) => it.rule.id === ruleA);
  const itemB = items.find((it) => it.rule.id === ruleB);
  const itemD = items.find((it) => it.rule.id === ruleD);
  const itemF = items.find((it) => it.rule.id === ruleF);

  assert.equal(itemA.paid, true, "A se paga por rule_id");
  assert.equal(itemA.myCents, 90000);
  assert.equal(itemB.paid, true, "B se paga por el fallback categoría+importe");
  assert.equal(itemB.myCents, 7200, "compartida al 60%: round(12000*60/100)");
  assert.equal(itemD.paid, false);
  assert.equal(itemF.paid, false);

  const comprometidoCents = items
    .filter((it) => !it.paid && it.rule.type !== "income")
    .reduce((sum, it) => sum + it.myCents, 0);
  assert.equal(comprometidoCents, 1500, "solo F: pendiente y no es income (D pendiente pero es income, se excluye)");

  const saldoCuentaCents = db.prepare(SQL.accountBalance).get("2026-08-24", "acc-n26").balance_cents;
  assert.equal(saldoCuentaCents, 100000 - 90000 - 12000 - 5000, "opening menos los 3 gastos del periodo");

  const pendientePartnerCents = db.prepare(SQL.pendingSharedTotal).get().total_cents;
  assert.equal(pendientePartnerCents, 5000 - 3000, "gastoContraparte: 5000 - 60% de mi parte = 2000 de la contraparte");

  const disponibleCents = saldoCuentaCents - comprometidoCents + pendientePartnerCents;
  assert.equal(disponibleCents, -7000 - 1500 + 2000);
});
