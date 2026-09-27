// B-7 (detalle de objetivo) y B-4 («Pasar a la hucha»): lógica pura de objetivo-logic.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monthKey, addMonths, accountFlowCents, contributionsByMonth, avgMonthlyContribution,
  projectCompletion, coverMonths, transferError, hasHucha,
} from "../../app/app/js/objetivo-logic.js";

const HUCHA = "acc-hucha";
const tr = (date, amount, from, to) => ({ date, type: "transfer", amount_cents: amount, account_id: from, counter_account_id: to });

test("monthKey / addMonths: aritmética de meses sin Date ni zona horaria", () => {
  assert.equal(monthKey("2026-09-27"), "2026-09");
  assert.equal(addMonths("2026-09", 1), "2026-10");
  assert.equal(addMonths("2026-09", 4), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-03", -14), "2025-01");
});

test("accountFlowCents: mismo signo que SQL.accountBalance, visto desde la cuenta", () => {
  assert.equal(accountFlowCents(tr("2026-09-01", 1000, "acc-c", HUCHA), HUCHA), 1000, "transferencia que entra");
  assert.equal(accountFlowCents(tr("2026-09-01", 1000, HUCHA, "acc-c"), HUCHA), -1000, "transferencia que sale");
  assert.equal(accountFlowCents({ type: "income", amount_cents: 500, account_id: HUCHA }, HUCHA), 500);
  assert.equal(accountFlowCents({ type: "refund", amount_cents: 500, account_id: HUCHA }, HUCHA), 500);
  assert.equal(accountFlowCents({ type: "expense", amount_cents: 300, account_id: HUCHA }, HUCHA), -300);
  assert.equal(accountFlowCents({ type: "adjustment", amount_cents: -200, account_id: HUCHA }, HUCHA), -200);
  assert.equal(accountFlowCents({ type: "expense", amount_cents: 300, account_id: "otra" }, HUCHA), 0, "ajena");
});

test("contributionsByMonth: 6 meses hasta el actual, lo anterior en «antes» y el total es el saldo", () => {
  const txs = [
    tr("2026-02-10", 5000, "acc-c", HUCHA),   // antes de la ventana (abr-sep)
    tr("2026-04-28", 15000, "acc-c", HUCHA),
    tr("2026-06-28", 20000, "acc-c", HUCHA),
    tr("2026-06-30", 5000, HUCHA, "acc-c"),  // sacó 50 en junio: neto 150
    tr("2026-08-28", 15000, "acc-c", HUCHA),
  ];
  const r = contributionsByMonth({ txs, accountId: HUCHA, openingCents: 30000, todayIso: "2026-09-27" });
  assert.deepEqual(r.months.map((m) => m.key), ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(r.months.map((m) => m.cents), [15000, 0, 15000, 0, 15000, 0]);
  assert.deepEqual(r.months.map((m) => m.current), [false, false, false, false, false, true]);
  assert.equal(r.beforeCents, 35000, "saldo inicial + lo de febrero");
  assert.equal(r.totalCents, 30000 + 5000 + 15000 + 15000 + 15000);
});

test("contributionsByMonth: los movimientos con fecha futura no cuentan (como el saldo a hoy)", () => {
  const txs = [tr("2026-09-10", 1000, "acc-c", HUCHA), tr("2026-10-02", 9999, "acc-c", HUCHA)];
  const r = contributionsByMonth({ txs, accountId: HUCHA, openingCents: 0, todayIso: "2026-09-27" });
  assert.equal(r.months.at(-1).cents, 1000);
  assert.equal(r.totalCents, 1000);
});

test("avgMonthlyContribution: media de los 3 últimos meses cerrados", () => {
  const byMonth = { "2026-06": 15000, "2026-07": 15000, "2026-08": 18000, "2026-09": 50000 };
  assert.equal(avgMonthlyContribution({ byMonth, firstKey: "2026-01", todayIso: "2026-09-27" }), 16000);
});

test("avgMonthlyContribution: un mes sin aportar cuenta como 0", () => {
  const byMonth = { "2026-06": 15000, "2026-08": 15000 };
  assert.equal(avgMonthlyContribution({ byMonth, firstKey: "2026-01", todayIso: "2026-09-27" }), 10000);
});

test("avgMonthlyContribution: una hucha más nueva divide solo por los meses que lleva", () => {
  const byMonth = { "2026-08": 15000 };
  assert.equal(avgMonthlyContribution({ byMonth, firstKey: "2026-08", todayIso: "2026-09-27" }), 15000);
});

test("avgMonthlyContribution: con el primer movimiento este mes, cuenta el mes en curso", () => {
  assert.equal(avgMonthlyContribution({ byMonth: { "2026-09": 20000 }, firstKey: "2026-09", todayIso: "2026-09-27" }), 20000);
});

test("avgMonthlyContribution: sin aportaciones (o con retiradas) no hay media: null", () => {
  assert.equal(avgMonthlyContribution({ byMonth: {}, firstKey: null, todayIso: "2026-09-27" }), null);
  assert.equal(avgMonthlyContribution({ byMonth: { "2026-08": -5000 }, firstKey: "2026-01", todayIso: "2026-09-27" }), null);
  assert.equal(avgMonthlyContribution({ byMonth: { "2026-02": 5000 }, firstKey: "2026-01", todayIso: "2026-09-27" }), null,
    "lo de hace más de 3 meses no sostiene una proyección");
});

test("projectCompletion: el mockup, 560,20 € a 150 €/mes sin aportar aún este mes → 4 aportaciones, diciembre", () => {
  const p = projectCompletion({ remainingCents: 56020, avgCents: 15000, todayIso: "2026-09-27", currentMonthCents: 0 });
  assert.deepEqual(p, { status: "projected", count: 4, monthKey: "2026-12" });
});

test("projectCompletion: si este mes ya aportó, la cuenta empieza el mes que viene", () => {
  const p = projectCompletion({ remainingCents: 56020, avgCents: 15000, todayIso: "2026-09-27", currentMonthCents: 15000 });
  assert.deepEqual(p, { status: "projected", count: 4, monthKey: "2027-01" });
});

test("projectCompletion: completado y sin media", () => {
  assert.deepEqual(projectCompletion({ remainingCents: 0, avgCents: 15000, todayIso: "2026-09-27" }), { status: "done" });
  assert.deepEqual(projectCompletion({ remainingCents: -10, avgCents: null, todayIso: "2026-09-27" }), { status: "done" });
  assert.deepEqual(projectCompletion({ remainingCents: 1000, avgCents: null, todayIso: "2026-09-27" }), { status: "none" });
  assert.deepEqual(projectCompletion({ remainingCents: 1000, avgCents: 0, todayIso: "2026-09-27" }), { status: "none" });
});

test("coverMonths: ahorrado / gasto medio; sin gasto medio, null", () => {
  assert.equal(coverMonths(125000, 60340), 125000 / 60340);
  assert.equal(coverMonths(125000, 0), null);
  assert.equal(coverMonths(-500, 60000), 0, "una hucha en negativo no cubre meses negativos");
});

test("transferError: importe > 0, cuenta origen y distinta de la hucha", () => {
  assert.equal(transferError({ cents: 0, fromId: "a", toId: "b" }), "amount");
  assert.equal(transferError({ cents: -5, fromId: "a", toId: "b" }), "amount");
  assert.equal(transferError({ cents: NaN, fromId: "a", toId: "b" }), "amount");
  assert.equal(transferError({ cents: 100, fromId: "", toId: "b" }), "account");
  assert.equal(transferError({ cents: 100, fromId: "b", toId: "b" }), "sameAccount");
  assert.equal(transferError({ cents: 100, fromId: "a", toId: "" }), "noHucha");
  assert.equal(transferError({ cents: 100, fromId: "a", toId: "b" }), "");
});

test("hasHucha: solo los tipos con hucha y con cuenta enlazada", () => {
  assert.equal(hasHucha({ type: "emergency_fund", account_id: "x" }), true);
  assert.equal(hasHucha({ type: "savings_target", account_id: "x" }), true);
  assert.equal(hasHucha({ type: "provision", account_id: "x" }), true);
  assert.equal(hasHucha({ type: "savings_target", account_id: "" }), false);
  assert.equal(hasHucha({ type: "spending_cap", account_id: "x" }), false);
  assert.equal(hasHucha({ type: "savings_rate", account_id: "" }), false);
  assert.equal(hasHucha(null), false);
});
