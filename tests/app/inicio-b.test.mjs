// Inicio en el sistema B (S1): las piezas puras nuevas que pide el mockup y que inicio-logic.js no
// tenía — la serie de la línea del Display, la barra apilada con «Resto» — y la línea del periodo
// de charts.js. Los tests de inicio-logic.test.mjs no se tocan (plantilla de aceptación, punto 6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { periodRemainingSeries, topCategoriesWithRest } from "../../app/app/js/inicio-logic.js";
import { periodChartSvg, PERIOD_W, PERIOD_PAD } from "../../app/app/js/charts.js";

// ---- periodRemainingSeries ---------------------------------------------------------------------

test("periodRemainingSeries: empieza en el presupuesto y resta el gasto de cada día", () => {
  assert.deepEqual(periodRemainingSeries(170000, [1000, 0, 2500]), [170000, 169000, 169000, 166500]);
});

test("periodRemainingSeries: un día en negativo (devolución) sube; puede bajar de cero", () => {
  assert.deepEqual(periodRemainingSeries(1000, [-200, 1500]), [1000, 1200, -300]);
});

test("periodRemainingSeries: sin días, solo el presupuesto; un valor no numérico cuenta como 0", () => {
  assert.deepEqual(periodRemainingSeries(500, []), [500]);
  assert.deepEqual(periodRemainingSeries(500, undefined), [500]);
  assert.deepEqual(periodRemainingSeries(500, [NaN, 100]), [500, 500, 400]);
});

test("periodRemainingSeries: con el total del periodo, hoy cuadra con «Quedan» (apuntes futuros incluidos)", () => {
  // 30 € pintados en los días, pero spentOfPeriod dice 50 € (20 € con fecha de mañana).
  assert.deepEqual(periodRemainingSeries(1000, [10, 20], 50), [1000, 990, 950]);
  assert.deepEqual(periodRemainingSeries(1000, [], 50), [950], "sin días, el único punto es hoy");
  assert.deepEqual(periodRemainingSeries(1000, [10], null), [1000, 990], "sin total, como antes");
});

// ---- topCategoriesWithRest ---------------------------------------------------------------------

const row = (id, c) => ({ root_id: id, name: id, spent_cents: c });

test("topCategoriesWithRest: las 5 primeras y el resto sumado; el total es lo que se pinta", () => {
  const rows = [row("a", 600), row("b", 500), row("c", 400), row("d", 300), row("e", 200), row("f", 100), row("g", 50)];
  const r = topCategoriesWithRest(rows);
  assert.deepEqual(r.top.map((x) => x.root_id), ["a", "b", "c", "d", "e"]);
  assert.equal(r.restCents, 150);
  assert.equal(r.totalCents, 2150);
});

test("topCategoriesWithRest: fuera las raíces a cero o en negativo; con pocas no hay resto", () => {
  const r = topCategoriesWithRest([row("a", 300), row("z", 0), row("n", -80), row("b", 100)]);
  assert.deepEqual(r.top.map((x) => x.root_id), ["a", "b"]);
  assert.equal(r.restCents, 0);
  assert.equal(r.totalCents, 400);
  assert.deepEqual(topCategoriesWithRest([]), { top: [], restCents: 0, totalCents: 0 });
  assert.deepEqual(topCategoriesWithRest(null), { top: [], restCents: 0, totalCents: 0 });
});

test("topCategoriesWithRest: ordena por gasto aunque llegue desordenado", () => {
  const r = topCategoriesWithRest([row("b", 1), row("a", 9)], 1);
  assert.deepEqual(r.top.map((x) => x.root_id), ["a"]);
  assert.equal(r.restCents, 1);
});

// ---- periodChartSvg ----------------------------------------------------------------------------

const pts = (html, cls) => html.match(new RegExp(`<polyline class="${cls}" points="([^"]+)"`))[1]
  .trim().split(/\s+/).map((p) => p.split(",").map(Number));

test("periodChartSvg: el eje es el periodo entero; hoy (día 13 de 30) cae al 13/30 del ancho", () => {
  const values = [1000, ...Array.from({ length: 13 }, (_, i) => 1000 - (i + 1) * 30)];
  const html = periodChartSvg({ days: 30, today: 13, values, max: 1000, todayLabel: "hoy", endLabel: "día 30" });
  const line = pts(html, "disp-chart-line");
  assert.equal(line.length, 14, "inicio + 13 días");
  const [x0] = line[0];
  const [xHoy] = line[13];
  assert.equal(x0, PERIOD_PAD);
  assert.ok(Math.abs(xHoy - (PERIOD_PAD + (PERIOD_W - 2 * PERIOD_PAD) * 13 / 30)) < 0.01, `x de hoy ${xHoy}`);
  const dot = html.match(/<circle class="disp-today" cx="([\d.]+)" cy="([\d.]+)"/);
  assert.equal(Number(dot[1]), xHoy, "el punto de hoy es el último de la línea");
  assert.match(html, /<path class="disp-chart-guide" d="M6,10 L312,86"/, "guía del presupuesto al cero en el último día");
  assert.match(html, />hoy<\/text>/);
  assert.match(html, />día 30<\/text>/);
});

test("periodChartSvg: lo que se sale del presupuesto se recorta arriba y abajo (sin NaN)", () => {
  const html = periodChartSvg({ days: 30, today: 2, values: [100, 250, -400], max: 100 });
  const ys = pts(html, "disp-chart-line").map(([, y]) => y);
  assert.deepEqual(ys, [10, 10, 86]);
  assert.doesNotMatch(html, /NaN/);
});

test("periodChartSvg: un periodo que se alarga estira el eje en vez de salirse", () => {
  const values = Array.from({ length: 36 }, (_, i) => 1000 - i);
  const line = pts(periodChartSvg({ days: 30, today: 35, values, max: 1000 }), "disp-chart-line");
  assert.ok(line.every(([x]) => x <= PERIOD_W - PERIOD_PAD + 0.01));
});

test("periodChartSvg: sin serie, línea de tiempo plana con el punto en el día de hoy", () => {
  const dia1 = periodChartSvg({ days: 30, today: 1, todayLabel: "hoy", endLabel: "día 30" });
  assert.doesNotMatch(dia1, /<polyline/);
  assert.match(dia1, /<path class="disp-chart-guide" d="M6,14 L312,14"/);
  assert.match(dia1, /<circle class="disp-today" cx="16.2" cy="14"/, "el final del día 1 de 30");
  // «hoy» en el mismo x en los dos modos.
  const cx = (h) => Number(h.match(/<circle class="disp-today" cx="([\d.]+)"/)[1]);
  const plana = periodChartSvg({ days: 30, today: 13 });
  const baja = periodChartSvg({ days: 30, today: 13, values: Array.from({ length: 14 }, (_, i) => 100 - i), max: 100 });
  assert.equal(cx(plana), cx(baja));
  assert.match(dia1, />día 30<\/text>/);
  // Sin presupuesto (max 0) también es la línea plana, aunque llegue una serie.
  assert.doesNotMatch(periodChartSvg({ days: 30, today: 5, values: [0, 1], max: 0 }), /<polyline/);
});

test("periodChartSvg: cerca del final, «hoy» va a la izquierda del punto y el rótulo final se calla", () => {
  const html = periodChartSvg({ days: 30, today: 30, todayLabel: "hoy", endLabel: "día 30" });
  assert.match(html, /text-anchor="end">hoy<\/text>/);
  assert.doesNotMatch(html, /día 30/);
});

test("periodChartSvg: ningún color en el HTML y los rótulos escapados", () => {
  const html = periodChartSvg({ days: 30, today: 3, values: [10, 9, 8, 7], max: 10, todayLabel: "<hoy>", endLabel: "a&b" });
  assert.doesNotMatch(html, /(fill|stroke)="var\(/);
  assert.doesNotMatch(html, /style=/);
  assert.doesNotMatch(html, /#[0-9a-f]{3,8}\b/i);
  assert.match(html, /&lt;hoy>|&lt;hoy&gt;/);
  assert.match(html, /a&amp;b/);
});

test("periodChartSvg: con el punto de hoy en el suelo, el rótulo «hoy» no baja del cero (línea a sangre)", () => {
  const html = periodChartSvg({ days: 30, today: 2, values: [100, 50, -400], max: 100, todayLabel: "hoy" });
  const y = Number(html.match(/<text class="disp-chart-label" x="[\d.]+" y="([\d.]+)"[^>]*>hoy<\/text>/)[1]);
  assert.equal(y, 86);
  const alto = periodChartSvg({ days: 30, today: 2, values: [100, 80, 60], max: 100, todayLabel: "hoy" });
  const cy = Number(alto.match(/<circle class="disp-today" cx="[\d.]+" cy="([\d.]+)"/)[1]);
  const y2 = Number(alto.match(/y="([\d.]+)"[^>]*>hoy<\/text>/)[1]);
  assert.equal(y2, Number((cy + 4).toFixed(2)), "más arriba, a la altura del punto como siempre");
});
