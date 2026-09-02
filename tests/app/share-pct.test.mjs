import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidPct, normalizePct, stepPct, splitCents } from "../../app/app/js/share-pct.js";

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
