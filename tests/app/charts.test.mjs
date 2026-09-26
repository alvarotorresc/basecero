import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { sparklineSvg, barRowsGeometry } from "../../app/app/js/charts.js";
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

// ---- barRowsGeometry (Task 7, PDF del Informe) ---------------------------------------------------

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

test("barRowsGeometry: pasa fam y color tal cual (pantalla con fam, PDF con color)", () => {
  const [g] = barRowsGeometry([{ key: "a", value: 1, max: 2, fam: "ali", color: "rgb-del-pdf" }], { width: 10, rowH: 4, barH: 2 });
  assert.equal(g.fam, "ali");
  assert.equal(g.color, "rgb-del-pdf");
});
