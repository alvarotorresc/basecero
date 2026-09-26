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

// ---- sparklineSvg (la línea del Display, PR-07) -------------------------------------------

test("sparklineSvg: N puntos → polyline con N pares, área con N+2 y el punto de hoy", () => {
  const points = [10, 40, 25, 60, 55, 80];
  const html = sparklineSvg(points);
  const m = html.match(/<polyline class="disp-chart-line" points="([^"]+)"/);
  assert.ok(m, "la línea es un <polyline> con la clase de la línea del Display");
  const pairs = m[1].trim().split(/\s+/);
  assert.equal(pairs.length, points.length);
  pairs.forEach((p) => assert.match(p, /^-?[\d.]+,-?[\d.]+$/));
  const pg = html.match(/<polygon class="disp-chart-line is-area" points="([^"]+)"/);
  assert.ok(pg, "el área bajo la línea");
  assert.equal(pg[1].trim().split(/\s+/).length, points.length + 2);
  assert.equal((html.match(/<circle class="disp-today"/g) || []).length, 1, "un solo punto de hoy");
});

test("sparklineSvg: ningún color en el HTML (ni atributo fill con var() ni style de color)", () => {
  const html = sparklineSvg([1, 3, 2], { labels: ["jul", "ago", "sep"], dots: true });
  assert.doesNotMatch(html, /(fill|stroke)="var\(/);
  assert.doesNotMatch(html, /style="[^"]*(fill|stroke|color|background)/);
  assert.doesNotMatch(html, /#[0-9a-f]{3,8}\b/i);
});

test("sparklineSvg: eje de meses con la última etiqueta como hoy, escapado", () => {
  const html = sparklineSvg([1, 2, 3], { labels: ["Jul", "Ago", "<Sep>"] });
  assert.match(html, /class="disp-chart-axis num" style="--n:3"/);
  assert.match(html, /<span class="disp-today">&lt;Sep&gt;<\/span>/);
});

test("sparklineSvg: dots pinta un punto por valor además del de hoy", () => {
  const html = sparklineSvg([1, 2, 3, 4], { dots: true });
  assert.equal((html.match(/is-dot/g) || []).length, 3);
});

test("sparklineSvg: un único punto o ninguno no revienta (sin NaN)", () => {
  assert.ok(!sparklineSvg([50]).includes("NaN"));
  assert.ok(!sparklineSvg([]).includes("NaN"));
});

// ---- netWorthBarsHtml (compatibilidad de Patrimonio, sobre columnsHtml) ---------------------

test("netWorthBarsHtml: hasta 6 columnas, la última es hoy (tinta) y las demás --idle; etiquetas capitalizadas", () => {
  const series = ["mar", "abr", "may", "jun", "jul", "ago", "sep"].map((label, i) => ({ label, cents: (i + 1) * 100000 }));
  const html = netWorthBarsHtml(series);
  assert.equal((html.match(/class="col-bar"/g) || []).length, 6); // 7 puntos → 6 columnas
  assert.equal((html.match(/class="col is-today"/g) || []).length, 1);
  assert.ok(html.includes(">Sep<") && !html.includes(">SEP<"), "la etiqueta capitaliza, no grita");
  assert.ok(!html.includes(">Mar<") && !html.includes(">mar<")); // slice(-6) descarta el más viejo
  assert.doesNotMatch(html, /var\(--(accent|red|card2|r-0)/);
});

test("netWorthBarsHtml: oculto con menos de 2 puntos", () => {
  assert.equal(netWorthBarsHtml([{ label: "ago", cents: 100 }]), "");
  assert.equal(netWorthBarsHtml([]), "");
});

// Sistema B (C4): el rojo solo va en cifras. Un cierre negativo mide por su valor absoluto.
test("netWorthBarsHtml: un cierre negativo no pinta ningún rojo y mide por su valor absoluto", () => {
  const html = netWorthBarsHtml([{ label: "jul", cents: 50000 }, { label: "ago", cents: -50000 }]);
  assert.doesNotMatch(html, /--red|--neg/);
  const hs = [...html.matchAll(/style="height:(\d+)%"/g)].map((m) => Number(m[1]));
  assert.deepEqual(hs, [76, 76]);
});

// ---- SQL.spentByDay -------------------------------------------------------

function tx(d, over = {}) {
  const v = {
    id: "t" + Math.floor(Math.random() * 1e9),
    date: "2026-08-20", period: "per-1", type: "expense", cents: 1000,
    account: "acc-n26", counterAccount: "", category: "cat-casa-alquiler",
    merchant: "", note: "", shared: 0, override: null, paidBy: "me", settled: 0,
    ref: "", rule: "", tag: "", external: "", hasAttachment: 0, status: "pending",
    ...over,
  };
  d.prepare(SQL.insertTransaction).run(
    v.id, v.date, v.period, v.type, v.cents, v.account, v.counterAccount,
    v.category, v.merchant, v.note, v.shared, v.override, v.paidBy, v.settled,
    v.ref, v.rule, v.tag, v.external, v.hasAttachment, v.status, T, T,
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

test("categoryBarsSvg: un rect por fila con la clase de su familia; sin familia, --idle (C11)", () => {
  const rows = [
    { key: "a", value: 50, max: 100, fam: "casa" },
    { key: "b", value: 30, max: 100, fam: "otr" },
    { key: "c", value: 20, max: 100, fam: null },
  ];
  const svg = categoryBarsSvg(rows, { width: 200, rowH: 20, barH: 12, gap: 4 });
  const cls = [...svg.matchAll(/<rect class="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(cls, ["chart-bar fam-casa", "chart-bar fam-otr", "chart-bar is-idle"]);
  assert.doesNotMatch(svg, /style=|fill="/, "el color lo pone components.css, no el SVG");
});

test("barRowsGeometry: pasa fam y color tal cual (pantalla con fam, PDF con color)", () => {
  const [g] = barRowsGeometry([{ key: "a", value: 1, max: 2, fam: "ali", color: "rgb-del-pdf" }], { width: 10, rowH: 4, barH: 2 });
  assert.equal(g.fam, "ali");
  assert.equal(g.color, "rgb-del-pdf");
});

test("comparisonBarsSvg: las dos barras a la MISMA escala (el maximo de ambos periodos)", () => {
  const svg = comparisonBarsSvg(
    [{ key: "a", value: 80, prevValue: 100, fam: "tra" }],
    { width: 200, rowH: 40, barH: 14, gap: 4 },
  );
  const widths = [...svg.matchAll(/<rect[^>]*width="(\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
  assert.equal(widths.length, 2, "una barra por periodo");
  const [curW, prevW] = widths;
  assert.equal(curW, 160, "80/100 del maximo compartido (100) sobre 200 de ancho");
  assert.equal(prevW, 200, "100/100 del maximo compartido: la barra llena el ancho entero");
});

test("comparisonBarsSvg: la actual en su familia y la anterior en --idle (C11: comparativas en gris)", () => {
  const svg = comparisonBarsSvg(
    [{ key: "a", value: 80, prevValue: 100, fam: "tra" }],
    { width: 200, rowH: 40, barH: 14, gap: 4 },
  );
  const cls = [...svg.matchAll(/<rect class="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(cls, ["chart-bar fam-tra", "chart-bar is-idle"]);
  assert.doesNotMatch(svg, /style=|fill="/);
});

test("comparisonBarsSvg: sin periodo anterior no emite la segunda barra", () => {
  const svg = comparisonBarsSvg(
    [{ key: "a", value: 80, prevValue: null, fam: "tra" }],
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

test("trendSvg: una barra por valor, la última a opacidad 1 y las demás a .45, en la familia recibida", () => {
  const svg = trendSvg([23100, 23800, 24560], "sal");
  const rects = svg.match(/<rect[^>]*>/g);
  assert.equal(rects.length, 3);
  assert.match(rects[0], /fill-opacity="0\.45"/);
  assert.match(rects[1], /fill-opacity="0\.45"/);
  assert.doesNotMatch(rects[2], /fill-opacity/, "la última va a opacidad 1: sin fill-opacity, o 1 explícito");
  for (const r of rects) assert.match(r, /class="chart-bar fam-sal"/);
  assert.doesNotMatch(svg, /style=/);
});

test("trendSvg: sin familia (o una clave desconocida) pinta en --idle, nunca en otr", () => {
  assert.match(trendSvg([1, 2], null), /class="chart-bar is-idle"/);
  assert.match(trendSvg([1, 2], "zzz"), /class="chart-bar is-idle"/);
});

test("trendSvg: devuelve \"\" cuando trendOf da null", () => {
  assert.equal(trendSvg([1000], "casa"), "");
  assert.equal(trendSvg([0, 0], "casa"), "");
});
