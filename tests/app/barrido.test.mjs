import { test } from "node:test";
import assert from "node:assert/strict";
import { remainderCents, sweepDestinations, sweepPlan } from "../../app/app/js/barrido.js";

test("remainderCents: con presupuesto, lo que sobra del presupuesto", () => {
  assert.deepEqual(remainderCents({ budgetTotalCents: 120000, incomeCents: 185000, spentCents: 84720 }),
    { cents: 35280, basis: "budget" }); // el «Te sobran 352,80 €» del artboard
});

test("remainderCents: sin ningun limite, lo que sobra de los ingresos", () => {
  assert.deepEqual(remainderCents({ budgetTotalCents: 0, incomeCents: 185000, spentCents: 84720 }),
    { cents: 100280, basis: "income" });
});

test("remainderCents: gastado por encima -> 0, nunca negativo", () => {
  assert.deepEqual(remainderCents({ budgetTotalCents: 100000, incomeCents: 150000, spentCents: 200000 }),
    { cents: 0, basis: "budget" });
  assert.deepEqual(remainderCents({ budgetTotalCents: 0, incomeCents: 100000, spentCents: 200000 }),
    { cents: 0, basis: "income" });
});

// Un objetivo ES una cuenta (goals.account_id, schema.sql:70; goalProgress lo lee de
// balanceByAccount, repo.js:583). spending_cap y savings_rate no tienen cuenta: no hay a dónde
// mover nada.
function accounts() {
  return {
    "acc-fondo": { id: "acc-fondo", is_archived: false },
    "acc-japon": { id: "acc-japon", is_archived: false },
    "acc-archivada": { id: "acc-archivada", is_archived: true },
    "acc-corriente": { id: "acc-corriente", is_archived: false },
  };
}
function goals() {
  return [
    { goal: { id: "g-fondo", name: "Fondo de emergencia", type: "emergency_fund", account_id: "acc-fondo" },
      currentCents: 310000, targetCents: 450000, pct: (310000 / 450000) * 100, level: "ok" },
    { goal: { id: "g-japon", name: "Viaje Japón", type: "savings_target", account_id: "acc-japon" },
      currentCents: 124000, targetCents: 300000, pct: (124000 / 300000) * 100, level: "ok" },
    { goal: { id: "g-cap", name: "Techo de Restauración", type: "spending_cap", account_id: "" },
      currentCents: 9630, targetCents: 15000, pct: (9630 / 15000) * 100, level: "ok" },
    { goal: { id: "g-rate", name: "Tasa de ahorro", type: "savings_rate", account_id: "" },
      currentCents: 54, targetCents: 40, pct: 135, level: "ok" },
  ];
}

test("sweepDestinations: solo emergency_fund, savings_target y provision", () => {
  const d = sweepDestinations(goals(), accounts(), 10000, "acc-corriente");
  const types = d.map((x) => x.goalId);
  assert.ok(types.includes("g-fondo") && types.includes("g-japon"));
  assert.ok(!types.includes("g-cap") && !types.includes("g-rate"), "spending_cap/savings_rate no tienen cuenta");
});

test("sweepDestinations: fuera el goal cuya cuenta esta archivada", () => {
  const gp = [{ goal: { id: "g-x", name: "Archivada", type: "provision", account_id: "acc-archivada" },
    currentCents: 1000, targetCents: 5000, pct: 20, level: "ok" }];
  const d = sweepDestinations(gp, accounts(), 1000, "acc-corriente");
  assert.deepEqual(d, []);
});

test("sweepDestinations: fuera el goal cuya cuenta es la de origen", () => {
  const gp = [{ goal: { id: "g-x", name: "Misma cuenta", type: "provision", account_id: "acc-fondo" },
    currentCents: 1000, targetCents: 5000, pct: 20, level: "ok" }];
  const d = sweepDestinations(gp, accounts(), 1000, "acc-fondo");
  assert.deepEqual(d, []);
});

test("sweepDestinations: orden por pct descendente, empate por nombre", () => {
  const d = sweepDestinations(goals(), accounts(), 35280, "acc-corriente");
  assert.deepEqual(d.map((x) => x.name), ["Fondo de emergencia", "Viaje Japón"]); // 69 % y 41 %
  assert.equal(d[0].afterCents, 310000 + 35280); // 3.452,80 €
});

test("sweepDestinations: 'completes' cuando la aportacion cruza el objetivo", () => {
  const gp = [{ goal: { id: "g-x", name: "Casi lleno", type: "provision", account_id: "acc-fondo" },
    currentCents: 9000, targetCents: 10000, pct: 90, level: "ok" }];
  const noCompleta = sweepDestinations(gp, accounts(), 500, "acc-corriente");
  assert.equal(noCompleta[0].completes, false);
  const completa = sweepDestinations(gp, accounts(), 1500, "acc-corriente");
  assert.equal(completa[0].completes, true);
});

test("sweepDestinations: target 0 (fondo sin periodos cerrados) -> pct 0, sin dividir por cero", () => {
  const gp = [{ goal: { id: "g-x", name: "Fondo nuevo", type: "emergency_fund", account_id: "acc-fondo" },
    currentCents: 0, targetCents: 0, pct: 0, level: "ok" }];
  const d = sweepDestinations(gp, accounts(), 1000, "acc-corriente");
  assert.equal(d[0].pct, 0);
  assert.equal(d[0].completes, false, "sin objetivo real no hay nada que 'completar'");
  assert.ok(!Number.isNaN(d[0].afterCents));
});

test("sweepPlan: por encima del saldo de origen se CAPA y se avisa", () => {
  const p = sweepPlan({ rawAmount: "999", remainderCents: 35280, sourceBalanceCents: 50000 });
  assert.equal(p.amountCents, 50000);
  assert.equal(p.capped, true);
  assert.equal(p.valid, true);
});

test("sweepPlan: 0, vacio o basura -> valid false", () => {
  assert.equal(sweepPlan({ rawAmount: "0", remainderCents: 100, sourceBalanceCents: 100000 }).valid, false);
  assert.equal(sweepPlan({ rawAmount: "", remainderCents: 100, sourceBalanceCents: 100000 }).valid, false);
  assert.equal(sweepPlan({ rawAmount: "abc", remainderCents: 100, sourceBalanceCents: 100000 }).valid, false);
  assert.equal(sweepPlan({ rawAmount: "-50", remainderCents: 100, sourceBalanceCents: 100000 }).valid, false);
});

test("sweepPlan: coma decimal leida con parseCentsRaw", () => {
  const p = sweepPlan({ rawAmount: "150,50", remainderCents: 20000, sourceBalanceCents: 100000 });
  assert.equal(p.amountCents, 15050);
  assert.equal(p.capped, false);
  assert.equal(p.valid, true);
});
