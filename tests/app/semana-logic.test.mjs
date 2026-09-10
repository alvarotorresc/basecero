import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WEEK_DAYS, weekDates, weekRange, fillDays, daysWithCategories, maxDayTotal, weekTotals,
  categoryTotals, movementsOfDay, rangeLabelParts,
} from "../../app/app/js/semana-logic.js";

test("WEEK_DAYS es 7", () => {
  assert.equal(WEEK_DAYS, 7);
});

test("weekDates: 7 días ascendentes terminando hoy, cruzando mes y año", () => {
  assert.deepEqual(weekDates("2026-09-09"),
    ["2026-09-03","2026-09-04","2026-09-05","2026-09-06","2026-09-07","2026-09-08","2026-09-09"]);
  assert.equal(weekDates("2026-03-02")[0], "2026-02-24");
  assert.equal(weekDates("2027-01-02")[0], "2026-12-27");
});

test("weekRange: start/end/dates coherentes con weekDates", () => {
  const r = weekRange("2026-09-09");
  assert.equal(r.start, "2026-09-03");
  assert.equal(r.end, "2026-09-09");
  assert.equal(r.dates.length, 7);
});

test("fillDays: rellena huecos a 0 y conserva el orden de `dates`", () => {
  const dates = weekDates("2026-09-09");
  const rows = [{ date: "2026-09-05", cents: 500 }, { date: "2026-09-09", cents: 1200 }];
  const days = fillDays(rows, dates);
  assert.deepEqual(days.map((d) => d.cents), [0, 0, 500, 0, 0, 0, 1200]);
  assert.deepEqual(days.map((d) => d.date), dates);
});

test("daysWithCategories: apila, ordena y marca la dominante", () => {
  const rows = [
    { date: "2026-09-09", root_id: "cat-rest", cents: 1850 },
    { date: "2026-09-09", root_id: "cat-salud", cents: 1490 },
    { date: "2026-09-07", root_id: "cat-casa", cents: 6790 },
  ];
  const days = daysWithCategories(rows, weekDates("2026-09-09"));
  assert.equal(days.length, 7);
  const hoy = days.at(-1);
  assert.equal(hoy.totalCents, 3340);
  assert.deepEqual(hoy.segments.map((s) => s.rootId), ["cat-rest", "cat-salud"]);
  assert.equal(hoy.dominantRootId, "cat-rest");
  assert.equal(days[3].totalCents, 0);          // domingo sin gasto
  assert.equal(days[3].dominantRootId, null);
});

test("daysWithCategories: un día con más devolución que gasto queda negativo y sin tramos", () => {
  const rows = [{ date: "2026-09-05", root_id: "cat-casa", cents: -700 }];
  const days = daysWithCategories(rows, weekDates("2026-09-09"));
  const dia = days.find((d) => d.date === "2026-09-05");
  assert.equal(dia.totalCents, -700);
  assert.deepEqual(dia.segments, []);
  assert.equal(dia.dominantRootId, null);
});

test("maxDayTotal: el mayor total, nunca negativo (una semana toda a 0/negativa da 0)", () => {
  const days = [{ totalCents: 4120 }, { totalCents: 6790 }, { totalCents: 0 }];
  assert.equal(maxDayTotal(days), 6790);
  assert.equal(maxDayTotal([{ totalCents: -300 }, { totalCents: -50 }]), 0);
  assert.equal(maxDayTotal([]), 0);
});

test("weekTotals: 231,05 € y 33,01 € de media (los números del artboard)", () => {
  const days = [4120, 1280, 5230, 0, 6790, 2345, 3340].map((c, i) =>
    ({ date: weekDates("2026-09-09")[i], totalCents: c, segments: [], dominantRootId: null }));
  const { totalCents, avgCents } = weekTotals(days);
  assert.equal(totalCents, 23105);
  assert.equal(avgCents, 3301);                 // 23105/7 = 3300,71 → 3301
});

test("categoryTotals: Restauración suma sus dos días y la lista va de mayor a menor", () => {
  const rows = [
    { date: "2026-09-04", root_id: "cat-restauracion", cents: 1280 },
    { date: "2026-09-09", root_id: "cat-restauracion", cents: 1850 },
    { date: "2026-09-07", root_id: "cat-casa", cents: 6790 },
  ];
  assert.deepEqual(categoryTotals(rows), [
    { rootId: "cat-casa", cents: 6790 },
    { rootId: "cat-restauracion", cents: 3130 },
  ]);
});

test("categoryTotals: una raíz que en NETO queda a 0 o negativa no lleva chip", () => {
  const rows = [
    { date: "2026-09-01", root_id: "cat-x", cents: -50 },
    { date: "2026-09-02", root_id: "cat-y", cents: 100 },
  ];
  assert.deepEqual(categoryTotals(rows), [{ rootId: "cat-y", cents: 100 }]);
});

test("movementsOfDay: filtra por fecha conservando el orden", () => {
  const rows = [{ id: "1", date: "2026-09-09" }, { id: "2", date: "2026-09-08" }, { id: "3", date: "2026-09-09" }];
  assert.deepEqual(movementsOfDay(rows, "2026-09-09").map((r) => r.id), ["1", "3"]);
  assert.deepEqual(movementsOfDay(rows, "2026-09-01"), []);
});

test("rangeLabelParts: mismo mes y a caballo de dos meses", () => {
  assert.deepEqual(rangeLabelParts("2026-09-03", "2026-09-09"),
    { sameMonth: true, fromDay: 3, fromMonth: 8, toDay: 9, toMonth: 8 });
  assert.deepEqual(rangeLabelParts("2026-08-29", "2026-09-04"),
    { sameMonth: false, fromDay: 29, fromMonth: 7, toDay: 4, toMonth: 8 });
});
