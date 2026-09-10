import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectSubscriptions, DETECT_WINDOW_DAYS, AMOUNT_TOLERANCE_PCT, MAX_CANDIDATES, CADENCES,
} from "../../app/app/js/subscription-detect.js";

const TODAY = "2026-09-09";

/** Cargo con la forma exacta de SQL.subscriptionCharges. Un id aleatorio por defecto: la
 *  detección no depende de un formato de id concreto. */
let seq = 0;
function charge({ date, merchant = "Netflix", cents = 1299, ruleId = "", categoryId = "cat-x", accountId = "acc-1", id }) {
  seq += 1;
  return { id: id ?? `tx-${seq}`, date, merchant, amount_cents: cents, category_id: categoryId, account_id: accountId, rule_id: ruleId };
}

test("constantes exportadas", () => {
  assert.equal(DETECT_WINDOW_DAYS, 760);
  assert.equal(AMOUNT_TOLERANCE_PCT, 10);
  assert.equal(MAX_CANDIDATES, 5);
  assert.deepEqual(CADENCES.map((c) => c.frequency), ["weekly", "monthly", "yearly"]);
});

test("mensual limpio (2 jul / 2 ago / 2 sep) → 1 candidata monthly, count 3, nextEstimated 2 de octubre", () => {
  const charges = [
    charge({ id: "tx-sep", date: "2026-09-02", cents: 1299 }),
    charge({ id: "tx-ago", date: "2026-08-02", cents: 1299 }),
    charge({ id: "tx-jul", date: "2026-07-02", cents: 1299 }),
  ];
  const cs = detectSubscriptions(charges, [], { todayIso: TODAY, ignored: [] });
  assert.equal(cs.length, 1);
  const c = cs[0];
  assert.equal(c.frequency, "monthly");
  assert.equal(c.count, 3);
  assert.equal(c.amountCents, 1299);
  assert.equal(c.nextEstimated, "2026-10-02");
  assert.equal(c.merchant, "Netflix");
  assert.equal(c.categoryId, "cat-x");
  assert.equal(c.accountId, "acc-1");
  assert.deepEqual(c.txIds, ["tx-sep", "tx-ago", "tx-jul"]);
});

test("±10%: dentro sigue la racha, fuera la corta", () => {
  const charges = [
    charge({ date: "2026-09-02", cents: 1299 }),  // ref
    charge({ date: "2026-08-02", cents: 1350 }),  // +3.9%: dentro
    charge({ date: "2026-07-02", cents: 1250 }),  // -3.8%: dentro
    charge({ date: "2026-06-02", cents: 1450 }),  // +11.6%: fuera, corta aquí
  ];
  const cs = detectSubscriptions(charges, [], { todayIso: TODAY, ignored: [] });
  assert.equal(cs.length, 1);
  assert.equal(cs[0].count, 3, "el cuarto cargo, fuera de tolerancia, corta la racha");
});

test("±10% exacto entra (aritmética entera)", () => {
  const charges = [
    charge({ date: "2026-09-02", cents: 1000 }), // ref
    charge({ date: "2026-08-02", cents: 1100 }), // exactamente +10%
  ];
  const cs = detectSubscriptions(charges, [], { todayIso: TODAY, ignored: [] });
  assert.equal(cs.length, 1);
  assert.equal(cs[0].count, 2, "el 10% justo SÍ entra en la racha");
});

test("dos cargos solo → candidata (D8)", () => {
  const charges = [charge({ date: "2026-09-02" }), charge({ date: "2026-08-02" })];
  const cs = detectSubscriptions(charges, [], { todayIso: TODAY, ignored: [] });
  assert.equal(cs.length, 1);
  assert.equal(cs[0].count, 2);
});

test("un cargo solo → ninguna candidata", () => {
  const charges = [charge({ date: "2026-09-02" })];
  assert.deepEqual(detectSubscriptions(charges, [], { todayIso: TODAY, ignored: [] }), []);
});

test("comercio ya con regla: solo el cargo más reciente enlazado, y aun así NINGUNA candidata (la trampa del grupo)", () => {
  const charges = [
    charge({ date: "2026-09-02", ruleId: "rule-netflix" }),
    charge({ date: "2026-08-02" }),
    charge({ date: "2026-07-02" }),
  ];
  assert.deepEqual(detectSubscriptions(charges, [], { todayIso: TODAY, ignored: [] }), []);
});

test("comercio con una regla de nombre coincidente (filtro débil) → ninguna candidata", () => {
  const charges = [charge({ date: "2026-09-02" }), charge({ date: "2026-08-02" }), charge({ date: "2026-07-02" })];
  const rules = [{ name: "Netflix" }];
  assert.deepEqual(detectSubscriptions(charges, rules, { todayIso: TODAY, ignored: [] }), []);
});

test("ignorado → ninguna candidata", () => {
  const charges = [charge({ date: "2026-09-02" }), charge({ date: "2026-08-02" })];
  const cs = detectSubscriptions(charges, [], { todayIso: TODAY, ignored: ["netflix"] });
  assert.deepEqual(cs, []);
});

test("cadencias: 7 y 8 días → weekly", () => {
  const charges = [
    charge({ date: "2026-09-16" }),
    charge({ date: "2026-09-09" }), // gap 7
    charge({ date: "2026-09-01" }), // gap 8
  ];
  const cs = detectSubscriptions(charges, [], { todayIso: TODAY, ignored: [] });
  assert.equal(cs.length, 1);
  assert.equal(cs[0].frequency, "weekly");
  assert.equal(cs[0].count, 3);
  assert.equal(cs[0].nextEstimated, "2026-09-23", "+7 días naturales, no due_day");
});

test("cadencias: 33 días → nada", () => {
  const charges = [charge({ date: "2026-09-03" }), charge({ date: "2026-08-01" })]; // gap 33
  assert.deepEqual(detectSubscriptions(charges, [], { todayIso: TODAY, ignored: [] }), []);
});

test("cadencias: 365 y 370 días → yearly", () => {
  const exacto = detectSubscriptions(
    [charge({ date: "2026-09-02" }), charge({ date: "2025-09-02" })], // gap 365
    [], { todayIso: TODAY, ignored: [] },
  );
  assert.equal(exacto.length, 1);
  assert.equal(exacto[0].frequency, "yearly");
  assert.equal(exacto[0].nextEstimated, "2027-09-02");

  const holgado = detectSubscriptions(
    [charge({ date: "2026-09-02" }), charge({ date: "2025-08-28" })], // gap 370
    [], { todayIso: TODAY, ignored: [] },
  );
  assert.equal(holgado.length, 1);
  assert.equal(holgado[0].frequency, "yearly");
});

test("huecos mezclados (31 y luego 13) → solo la racha reciente", () => {
  const charges = [
    charge({ date: "2026-09-02" }),
    charge({ date: "2026-08-02" }), // gap 31 desde el anterior: monthly
    charge({ date: "2026-07-20" }), // gap 13 desde el anterior: no encaja en monthly, corta
  ];
  const cs = detectSubscriptions(charges, [], { todayIso: TODAY, ignored: [] });
  assert.equal(cs.length, 1);
  assert.equal(cs[0].count, 2, "la racha se corta al primer hueco que no encaja en la clase ya fijada");
  assert.equal(cs[0].frequency, "monthly");
});

test("dos cargos el mismo día no rompen una racha buena", () => {
  const charges = [
    charge({ id: "tx-dup1", date: "2026-09-02" }),
    charge({ id: "tx-dup2", date: "2026-09-02" }), // mismo día: se descarta, no cuenta como hueco de 0
    charge({ date: "2026-08-02" }),
    charge({ date: "2026-07-02" }),
  ];
  const cs = detectSubscriptions(charges, [], { todayIso: TODAY, ignored: [] });
  assert.equal(cs.length, 1);
  assert.equal(cs[0].count, 3, "el duplicado del mismo día no cuenta ni rompe la racha");
});

test("«Bar la plaza» / «BAR LA PLAZA  » se agrupan juntos", () => {
  const charges = [
    charge({ merchant: "Bar la plaza", date: "2026-09-02", cents: 2000 }),
    charge({ merchant: "BAR LA PLAZA  ", date: "2026-08-02", cents: 2000 }),
  ];
  const cs = detectSubscriptions(charges, [], { todayIso: TODAY, ignored: [] });
  assert.equal(cs.length, 1);
  assert.equal(cs[0].count, 2);
});

test("un comercio __proto__ no contamina Object.prototype", () => {
  const charges = [
    charge({ merchant: "__proto__", date: "2026-09-02" }),
    charge({ merchant: "__proto__", date: "2026-08-02" }),
  ];
  const cs = detectSubscriptions(charges, [], { todayIso: TODAY, ignored: [] });
  assert.equal(cs.length, 1);
  assert.equal(cs[0].merchantKey, "__proto__");
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test("orden y tope: 7 grupos válidos → 5 candidatas, count desc → amountCents desc → merchant asc", () => {
  const group = (merchant, cents, dates) => dates.map((date) => charge({ merchant, cents, date }));
  const charges = [
    ...group("Beta", 1500, ["2026-09-02", "2026-08-02", "2026-07-02"]),   // count 3, 1500
    ...group("Alpha", 1000, ["2026-09-02", "2026-08-02", "2026-07-02"]),  // count 3, 1000
    ...group("Zulu", 5000, ["2026-09-02", "2026-08-02"]),                 // count 2, 5000
    ...group("Alpha2", 5000, ["2026-09-02", "2026-08-02"]),               // count 2, 5000
    ...group("Gamma", 100, ["2026-09-02", "2026-08-02"]),                 // count 2, 100
    ...group("Delta", 100, ["2026-09-02", "2026-08-02"]),                 // count 2, 100
    ...group("Epsilon", 100, ["2026-09-02", "2026-08-02"]),               // count 2, 100
  ];
  const cs = detectSubscriptions(charges, [], { todayIso: TODAY, ignored: [] });
  assert.equal(cs.length, 5, "capado a MAX_CANDIDATES");
  assert.deepEqual(cs.map((c) => c.merchant), ["Beta", "Alpha", "Alpha2", "Zulu", "Delta"]);
});
