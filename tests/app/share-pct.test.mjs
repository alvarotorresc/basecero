import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidPct, normalizePct, stepPct, splitCents, netOfSelected } from "../../app/app/js/share-pct.js";

test("isValidPct: número finito en [0, 100], rechaza fuera de rango, NaN y no-números", () => {
  assert.equal(isValidPct(0), true);
  assert.equal(isValidPct(100), true);
  assert.equal(isValidPct(60), true);
  assert.equal(isValidPct(101), false);
  assert.equal(isValidPct(-1), false);
  assert.equal(isValidPct(NaN), false);
  assert.equal(isValidPct("60"), false);
  assert.equal(isValidPct(null), false);
});

test("normalizePct: redondea si es válido, si no cae al fallback (100 por defecto)", () => {
  assert.equal(normalizePct(60), 60);
  assert.equal(normalizePct(59.6), 60);
  assert.equal(normalizePct(null), 100);
  assert.equal(normalizePct("abc"), 100);
  assert.equal(normalizePct(120), 100);
  assert.equal(normalizePct(null, 50), 50);
});

test("stepPct: aplica delta y acota a [0, 100]", () => {
  assert.equal(stepPct(60, 5), 65);
  assert.equal(stepPct(60, -5), 55);
  assert.equal(stepPct(100, 5), 100);
  assert.equal(stepPct(0, -5), 0);
  assert.equal(stepPct(3, -5), 0);
  assert.equal(stepPct(98, 5), 100);
});

test("splitCents: mi parte redondeada al céntimo, la contraparte es el resto (mine + partner === amountCents siempre)", () => {
  const cases = [
    [10000, 60, { mine: 6000, partner: 4000 }],
    [4550, 60, { mine: 2730, partner: 1820 }],
    [1, 50, { mine: 1, partner: 0 }],
    [0, 60, { mine: 0, partner: 0 }],
    [10000, 100, { mine: 10000, partner: 0 }],
    [10000, 0, { mine: 0, partner: 10000 }],
  ];
  for (const [amountCents, pct, expected] of cases) {
    const r = splitCents(amountCents, pct);
    assert.deepEqual(r, expected);
    assert.equal(r.mine + r.partner, amountCents);
  }
});

// netOfSelected: Liquidar (P3) pasa de "liquidar todo lo pendiente" a "liquidar lo elegido" —
// el único cambio de comportamiento de la PR (SISTEMA.md spec §4). Fixture con las dos
// direcciones de repo.pendingSettlements.
const ROWS = [
  { id: "a", direction: "partner_owes", settle_cents: 4215 },
  { id: "b", direction: "partner_owes", settle_cents: 1900 },
  { id: "c", direction: "i_owe", settle_cents: 1200 },
  { id: "d", direction: "i_owe", settle_cents: 2655 },
];

test("netOfSelected: con TODOS los ids seleccionados, el neto es exactamente el de hoy (invariante decisión 3: por defecto, nada cambia)", () => {
  const selected = new Set(ROWS.map((r) => r.id));
  const legacyNet = ROWS.reduce((s, r) => s + (r.direction === "i_owe" ? -r.settle_cents : r.settle_cents), 0);
  assert.equal(netOfSelected(ROWS, selected), legacyNet);
});

test("netOfSelected: sin ninguno seleccionado, 0", () => {
  assert.equal(netOfSelected(ROWS, new Set()), 0);
});

test("netOfSelected: solo filas 'partner_owes' seleccionadas da un neto positivo", () => {
  assert.equal(netOfSelected(ROWS, new Set(["a", "b"])), 4215 + 1900);
});

test("netOfSelected: solo filas 'i_owe' seleccionadas da un neto negativo", () => {
  assert.equal(netOfSelected(ROWS, new Set(["c", "d"])), -(1200 + 2655));
});

test("netOfSelected: un id del Set que no está en rows se ignora sin lanzar", () => {
  assert.doesNotThrow(() => netOfSelected(ROWS, new Set(["a", "ghost-id"])));
  assert.equal(netOfSelected(ROWS, new Set(["a", "ghost-id"])), 4215);
});
