import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { sparklineSvg, netWorthBarsHtml, barRowsGeometry, categoryBarsSvg, comparisonBarsSvg, trendOf, trendSvg, TREND_MIN_H } from "../../app/app/js/charts.js";
import { SQL } from "../../app/app/js/sql.js";
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

test("netWorthBarsHtml: hasta 6 barras planas, la última en lima, etiquetas capitalizadas (no mayúsculas)", () => {
  const series = ["mar", "abr", "may", "jun", "jul", "ago", "sep"].map((label, i) => ({ label, cents: (i + 1) * 100000 }));
  const html = netWorthBarsHtml(series);
  assert.equal((html.match(/border-radius:var\(--r-0\)/g) || []).length, 6); // 7 puntos → 6 barras
  assert.ok(html.includes("var(--accent)"));
  assert.ok(html.includes(">Sep<") && !html.includes(">SEP<"), "la etiqueta capitaliza, no grita");
  assert.ok(!html.includes(">Mar<") && !html.includes(">mar<")); // slice(-6) descarta el más viejo
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

// ---- SQL.spentByDay -------------------------------------------------------

function tx(d, over = {}) {
  const v = {
    id: "t" + Math.floor(Math.random() * 1e9),
    date: "2026-08-20", period: "per-1", type: "expense", cents: 1000,
    account: "acc-n26", counterAccount: "", category: "cat-casa-alquiler",
    merchant: "", note: "", shared: 0, override: null, paidBy: "me", settled: 0,
    ref: "", rule: "", tag: "", external: "", status: "pending",
    ...over,
  };
  d.prepare(SQL.insertTransaction).run(
    v.id, v.date, v.period, v.type, v.cents, v.account, v.counterAccount,
    v.category, v.merchant, v.note, v.shared, v.override, v.paidBy, v.settled,
    v.ref, v.rule, v.tag, v.external, v.status, T, T,
  );
  return v.id;
}

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

test("fmtDiaIni: iniciales L-D de una semana completa (2026-08-17 lunes .. 08-23 domingo)", () => {
  assert.deepEqual(
    ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"].map(fmtDiaIni),
    ["L", "M", "X", "J", "V", "S", "D"],
  );
});

// ---- barRowsGeometry / categoryBarsSvg / comparisonBarsSvg (Task 7, Informe) -------------------
// Esta es LA garantía de que el PDF y la pantalla no divergen: los dos consumen barRowsGeometry.

test("barRowsGeometry: ancho proporcional al valor y filas apiladas", () => {
  const geo = barRowsGeometry([
    { key: "a", value: 50, max: 100, color: "#111111" },
    { key: "b", value: 100, max: 100, color: "#222222" },
  ], { width: 200, rowH: 20, barH: 12, gap: 4 });
  assert.equal(geo[0].w, 100);
  assert.equal(geo[1].w, 200);
  assert.equal(geo[0].y, 0);
  assert.equal(geo[1].y, 20, "filas apiladas: la segunda empieza donde acaba el alto de fila de la primera");
  assert.equal(geo[0].h, 12);
});

test("barRowsGeometry: valor negativo -> w 0; max 0 -> todas a 0, sin NaN", () => {
  const geo = barRowsGeometry([
    { key: "neg", value: -50, max: 100, color: "#111" },
    { key: "sinmax", value: 50, max: 0, color: "#222" },
  ], { width: 100, rowH: 10, barH: 6, gap: 2 });
  assert.equal(geo[0].w, 0);
  assert.equal(geo[1].w, 0);
  assert.ok(!Number.isNaN(geo[0].w));
  assert.ok(!Number.isNaN(geo[1].w));
});

test("barRowsGeometry: es determinista — mismo input, misma geometria", () => {
  const rows = [{ key: "a", value: 30, max: 60, color: "#abcabc" }];
  const opts = { width: 100, rowH: 10, barH: 6, gap: 2 };
  assert.deepEqual(barRowsGeometry(rows, opts), barRowsGeometry(rows, opts));
});

test("categoryBarsSvg: un rect por fila con el color de su categoria", () => {
  const rows = [
    { key: "a", value: 50, max: 100, color: "#ff0000" },
    { key: "b", value: 30, max: 100, color: "#00ff00" },
  ];
  const svg = categoryBarsSvg(rows, { width: 200, rowH: 20, barH: 12, gap: 4 });
  const rects = [...svg.matchAll(/<rect[^>]*fill="([^"]+)"[^>]*>/g)].map((m) => m[1]);
  assert.deepEqual(rects, ["#ff0000", "#00ff00"]);
});

test("comparisonBarsSvg: las dos barras a la MISMA escala (el maximo de ambos periodos)", () => {
  const svg = comparisonBarsSvg(
    [{ key: "a", value: 80, prevValue: 100, color: "#3366ff" }],
    { width: 200, rowH: 40, barH: 14, gap: 4 },
  );
  const widths = [...svg.matchAll(/<rect[^>]*width="(\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
  assert.equal(widths.length, 2, "una barra por periodo");
  const [curW, prevW] = widths;
  assert.equal(curW, 160, "80/100 del maximo compartido (100) sobre 200 de ancho");
  assert.equal(prevW, 200, "100/100 del maximo compartido: la barra llena el ancho entero");
});

test("comparisonBarsSvg: sin periodo anterior no emite la segunda barra", () => {
  const svg = comparisonBarsSvg(
    [{ key: "a", value: 80, prevValue: null, color: "#3366ff" }],
    { width: 200, rowH: 40, barH: 14, gap: 4 },
  );
  const rectCount = (svg.match(/<rect/g) || []).length;
  assert.equal(rectCount, 1, "sin prevValue solo se dibuja la barra actual");
});

// ---- trendOf / trendSvg (Task 8: mini tendencia de 3 periodos, N3 — SISTEMA §4.19) -----------

// La tabla entera de SISTEMA §5 / etiquetas-design §8.2: jul/ago/sep en céntimos, alturas
// esperadas y el `max` de la serie (nunca el actual — Alimentación lo demuestra: su barra de
// 18px es la de AGOSTO, no la de septiembre).
const TREND_ROWS = [
  { name: "Casa", values: [23100, 23800, 24560], heights: [17, 17, 18] },
  { name: "Alimentación", values: [19650, 21490, 18740], heights: [16, 18, 16] },
  { name: "Coche", values: [14320, 7640, 12180], heights: [18, 10, 15] },
  { name: "Restauración", values: [11840, 14210, 9630], heights: [15, 18, 12] },
  { name: "Ocio", values: [7480, 6130, 8995], heights: [15, 12, 18] },
  { name: "Transporte", values: [6100, 5820, 6400], heights: [17, 16, 18] },
  { name: "Salud", values: [2890, 3350, 4215], heights: [12, 14, 18] },
];

test("trendOf: las siete filas de SISTEMA §5, al píxel", () => {
  for (const row of TREND_ROWS) {
    const t = trendOf(row.values);
    assert.deepEqual(t.heights, row.heights, row.name);
    assert.equal(t.max, Math.max(...row.values), row.name);
  }
});

test("trendOf: null con 1 solo valor", () => {
  assert.equal(trendOf([1000]), null);
});

test("trendOf: null con max <= 0 (una raíz con más devoluciones que gasto)", () => {
  assert.equal(trendOf([0, -200, -100]), null);
  assert.equal(trendOf([0, 0]), null);
});

test("trendOf: un valor positivo que redondea a 0 sube a TREND_MIN_H", () => {
  const t = trendOf([120, 50000]); // 120/50000*18 = 0.0432 -> round 0
  assert.equal(t.heights[0], TREND_MIN_H);
  assert.ok(TREND_MIN_H > 0);
});

test("trendOf: 2 valores -> 2 alturas", () => {
  const t = trendOf([10000, 20000]);
  assert.equal(t.heights.length, 2);
  assert.deepEqual(t.heights, [9, 18]);
});

test("trendSvg: una barra por valor, la última a opacidad 1 y las demás a .45, con el color recibido", () => {
  const svg = trendSvg([23100, 23800, 24560], "#ff0000");
  const rects = svg.match(/<rect[^>]*>/g);
  assert.equal(rects.length, 3);
  assert.match(rects[0], /fill-opacity="0\.45"/);
  assert.match(rects[1], /fill-opacity="0\.45"/);
  assert.doesNotMatch(rects[2], /fill-opacity/, "la última va a opacidad 1: sin fill-opacity, o 1 explícito");
  for (const r of rects) assert.match(r, /fill="#ff0000"/);
});

test("trendSvg: devuelve \"\" cuando trendOf da null", () => {
  assert.equal(trendSvg([1000], "#ff0000"), "");
  assert.equal(trendSvg([0, 0], "#ff0000"), "");
});
