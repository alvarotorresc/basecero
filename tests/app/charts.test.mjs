import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { barChartSvg, donutSvg, sparklineSvg, netWorthBarsHtml } from "../../app/app/js/charts.js";
import { SQL } from "../../app/app/js/sql.js";
import { fillLast7Days } from "../../app/app/js/repo.js";
import { fmtDiaIni } from "../../app/app/js/format.js";
import { openDb, seedMinimal } from "./helpers.mjs";

const T = "2026-08-24T18:00:00Z";
const CIRC = 2 * Math.PI * 54;

// ---- donutSvg ----------------------------------------------------------

test("donutSvg: la suma de los arcos (stroke-dasharray 'on') ≈ 2π·54, un circle por slice con su color", () => {
  const slices = [
    { color: "#8b9ff5", cents: 69000 },
    { color: "#58d68d", cents: 31245 },
    { color: "#ddb455", cents: 24615 },
  ];
  const svg = donutSvg(slices, "1.247,60", "EUR gastados");

  const circles = [...svg.matchAll(/<circle[^>]*stroke="(#[0-9a-f]{6})"[^>]*stroke-dasharray="([\d.]+) ([\d.]+)"/gi)];
  assert.equal(circles.length, slices.length, "un <circle> por slice");
  circles.forEach((m, i) => assert.equal(m[1], slices[i].color));

  const total = circles.reduce((s, m) => s + Number(m[2]), 0);
  assert.ok(Math.abs(total - CIRC) <= 1, `suma ${total} debería ser ≈ ${CIRC} (±1)`);

  assert.ok(svg.includes("1.247,60"));
  assert.ok(svg.includes("EUR gastados"));
});

test("donutSvg: sin gasto (todo a 0) no revienta y no pinta arcos con NaN", () => {
  const svg = donutSvg([{ color: "#8b9ff5", cents: 0 }], "0,00", "EUR gastados");
  assert.ok(!svg.includes("NaN"));
});

// ---- barChartSvg --------------------------------------------------------

test("barChartSvg: la barra de mayor importe tiene la altura máxima; la activa lleva el marcador de acento", () => {
  const days = [
    { label: "L", cents: 2600, active: false },
    { label: "M", cents: 6400, active: false },
    { label: "X", cents: 1900, active: false },
    { label: "J", cents: 4400, active: false },
    { label: "V", cents: 3500, active: false },
    { label: "S", cents: 9640, active: true },
    { label: "D", cents: 9000, active: false },
  ];
  const html = barChartSvg(days);

  // una barra por día, con su cents y altura
  const bars = [...html.matchAll(/data-cents="(\d+)"[^]*?height:(\d+)px/g)];
  assert.equal(bars.length, days.length);

  const heights = bars.map((m) => Number(m[2]));
  const maxHeightBarIdx = heights.indexOf(Math.max(...heights));
  // el día de mayor cents (S, índice 5, 9640) debe llevar la altura máxima
  assert.equal(Number(bars[maxHeightBarIdx][1]), 9640);

  // la barra activa lleva la clase/marcador de acento
  assert.ok(html.includes("flujo-bar--active"));
  assert.ok(html.includes("var(--accent)"));

  // la inicial de HOY (S, la marcada active:true) lleva su propia clase de acento — no basta con
  // que ">S<" aparezca en algún sitio, tiene que ser justo la etiqueta con el marcador
  assert.match(html, /flujo-day-label--active"[^>]*>S</);
});

test("barChartSvg: todos los días a 0 no revienta (altura mínima, sin NaN)", () => {
  const days = [0, 0, 0, 0, 0, 0, 0].map((cents, i) => ({ label: "LMXJVSD"[i], cents, active: i === 6 }));
  const html = barChartSvg(days);
  assert.ok(!html.includes("NaN"));
  assert.ok(!html.includes("Infinity"));
});

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
    merchant: "", note: "", shared: 0, override: null, settled: 0,
    ref: "", rule: "", external: "", status: "pending",
    ...over,
  };
  d.prepare(SQL.insertTransaction).run(
    v.id, v.date, v.period, v.type, v.cents, v.account, v.counterAccount,
    v.category, v.merchant, v.note, v.shared, v.override, v.settled,
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
