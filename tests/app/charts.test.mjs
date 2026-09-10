import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { sparklineSvg, netWorthBarsHtml } from "../../app/app/js/charts.js";
import { SQL } from "../../app/app/js/sql.js";
import { fillLast7Days } from "../../app/app/js/repo.js";
import { fmtDiaIni } from "../../app/app/js/format.js";
import { openDb, seedMinimal } from "./helpers.mjs";

const T = "2026-08-24T18:00:00Z";

// donutSvg y barChartSvg (y sus tests de aquí) se borraron en el plan Inicio v2, Task 10: sin
// consumidor desde que la Task 9 sustituyó el donut y el flujo de gasto de Inicio por la espina y
// las barras horizontales — ver el comentario de cabecera de charts.js.

// ---- sparklineSvg --------------------------------------------------------

test("sparklineSvg: N puntos → polyline con N pares de coordenadas", () => {
  const points = [10, 40, 25, 60, 55, 80];
  const svg = sparklineSvg(points, ["a", "b", "c", "d", "e", "f"]);
  const m = svg.match(/<polyline points="([^"]+)"/);
  assert.ok(m, "debe incluir un <polyline>");
  const pairs = m[1].trim().split(/\s+/);
  assert.equal(pairs.length, points.length);
  pairs.forEach((p) => assert.match(p, /^-?[\d.]+,-?[\d.]+$/));

  const pg = svg.match(/<polygon points="([^"]+)"/);
  assert.ok(pg, "debe incluir el polígono de relleno");
  // el polígono cierra el área bajo la línea: base-izquierda + N puntos + base-derecha = N+2
  assert.equal(pg[1].trim().split(/\s+/).length, points.length + 2);

  assert.ok(svg.match(/<circle[^>]*\/?>/), "debe incluir el círculo del último punto");
});

test("sparklineSvg: un único punto no revienta (sin división por cero)", () => {
  const svg = sparklineSvg([50], ["a"]);
  assert.ok(!svg.includes("NaN"));
});

// ---- netWorthBarsHtml -----------------------------------------------------

test("netWorthBarsHtml: hasta 6 barras, la última en verde, etiquetas en mayúsculas", () => {
  const series = ["mar", "abr", "may", "jun", "jul", "ago", "sep"].map((label, i) => ({ label, cents: (i + 1) * 100000 }));
  const html = netWorthBarsHtml(series);
  assert.equal((html.match(/border-radius:5px 5px 2px 2px/g) || []).length, 6); // 7 puntos → 6 barras
  assert.ok(html.includes("var(--green)"));
  assert.ok(html.includes("SEP") && !html.includes("MAR")); // slice(-6) descarta el más viejo
});

test("netWorthBarsHtml: oculto con menos de 2 puntos", () => {
  assert.equal(netWorthBarsHtml([{ label: "ago", cents: 100 }]), "");
  assert.equal(netWorthBarsHtml([]), "");
});

// Task 7 (5a): un patrimonio negativo se tiñe de rojo, prioridad sobre el verde de "última barra".
test("netWorthBarsHtml: un punto con cents negativo pinta esa barra en rojo (aunque sea la última)", () => {
  const series = [
    { label: "jul", cents: 50000 },
    { label: "ago", cents: -20000 },
  ];
  const html = netWorthBarsHtml(series);
  assert.ok(html.includes("var(--red)"), "la barra negativa debe usar var(--red)");
});

test("netWorthBarsHtml: serie toda positiva no pinta ninguna barra en rojo", () => {
  const series = [
    { label: "jul", cents: 50000 },
    { label: "ago", cents: 70000 },
  ];
  const html = netWorthBarsHtml(series);
  assert.ok(!html.includes("var(--red)"), "sin puntos negativos no debe aparecer var(--red)");
});

// ---- SQL.spentByDay / fillLast7Days (datos de spentLast7Days) -----------

function tx(d, over = {}) {
  const v = {
    id: "t" + Math.floor(Math.random() * 1e9),
    date: "2026-08-20", period: "per-1", type: "expense", cents: 1000,
    account: "acc-n26", counterAccount: "", category: "cat-casa-alquiler",
    merchant: "", note: "", shared: 0, override: null, paidBy: "me", settled: 0,
    ref: "", rule: "", external: "", status: "pending",
    ...over,
  };
  d.prepare(SQL.insertTransaction).run(
    v.id, v.date, v.period, v.type, v.cents, v.account, v.counterAccount,
    v.category, v.merchant, v.note, v.shared, v.override, v.paidBy, v.settled,
    v.ref, v.rule, v.external, v.status, T, T,
  );
  return v.id;
}

test("SQL.spentByDay + fillLast7Days: 7 días con ceros rellenos y suma correcta (MY_AMOUNT prorrateado, refunds sueltos restan)", () => {
  const d = openDb();
  seedMinimal(d);
  // últimos 7 días naturales terminando en 2026-08-24: 08-18..08-24 (inclusive)
  tx(d, { date: "2026-08-17", cents: 5000 });                 // fuera de rango (8 días atrás) — no debe contar
  tx(d, { date: "2026-08-20", cents: 2000 });                 // dentro, entero
  tx(d, { date: "2026-08-22", cents: 4000, shared: 1 });      // dentro, 60% de periodo -> 2400
  tx(d, { date: "2026-08-22", cents: 500, type: "refund" });  // refund suelto resta del mismo día
  // 2026-08-18, -19, -21, -23, -24 sin movimientos -> deben quedar a 0

  const rows = d.prepare(SQL.spentByDay).all("per-1", "2026-08-18", "2026-08-24");
  const days = fillLast7Days(rows, "2026-08-24");

  assert.equal(days.length, 7);
  assert.deepEqual(days.map((x) => x.date),
    ["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24"]);
  assert.equal(days.find((x) => x.date === "2026-08-18").cents, 0);
  assert.equal(days.find((x) => x.date === "2026-08-19").cents, 0);
  assert.equal(days.find((x) => x.date === "2026-08-20").cents, 2000);
  assert.equal(days.find((x) => x.date === "2026-08-21").cents, 0);
  assert.equal(days.find((x) => x.date === "2026-08-22").cents, 2400 - 500);
  assert.equal(days.find((x) => x.date === "2026-08-23").cents, 0);
  assert.equal(days.find((x) => x.date === "2026-08-24").cents, 0);

  const sum = days.reduce((s, x) => s + x.cents, 0);
  assert.equal(sum, 2000 + (2400 - 500));
});

test("SQL.spentByDay: refund vinculado a gasto NO compartido resta ese día; vinculado a compartido no", () => {
  const d = openDb();
  seedMinimal(d);

  const gastoA = tx(d, { date: "2026-08-20", cents: 2000, shared: 0 });
  tx(d, { date: "2026-08-20", type: "refund", cents: 2000, shared: 0, ref: gastoA });

  const gastoB = tx(d, { date: "2026-08-22", cents: 4000, shared: 1 }); // 60% → 2400
  tx(d, { date: "2026-08-22", type: "refund", cents: 1600, shared: 0, ref: gastoB });

  const rows = d.prepare(SQL.spentByDay).all("per-1", "2026-08-18", "2026-08-24");
  const dia20 = rows.find((r) => r.date === "2026-08-20");
  const dia22 = rows.find((r) => r.date === "2026-08-22");

  assert.equal(dia20.cents, 0, "gasto 2000 - refund 2000 (gasto NO compartido) = 0");
  assert.equal(dia22.cents, 2400, "gasto al 60% (2400) - 0 (refund liquida gasto compartido)");
});

test("fillLast7Days: sin filas, devuelve 7 ceros", () => {
  const days = fillLast7Days([], "2026-08-24");
  assert.equal(days.length, 7);
  assert.ok(days.every((d) => d.cents === 0));
  assert.equal(days[6].date, "2026-08-24");
  assert.equal(days[0].date, "2026-08-18");
});

test("fmtDiaIni: iniciales L-D de una semana completa (2026-08-17 lunes .. 08-23 domingo)", () => {
  assert.deepEqual(
    ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"].map(fmtDiaIni),
    ["L", "M", "X", "J", "V", "S", "D"],
  );
});
