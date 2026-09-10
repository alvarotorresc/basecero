// pdf-lib con fuentes estandar codifica en WinAnsi y LANZA ante cualquier caracter fuera de esa
// tabla (verificado: `WinAnsi cannot encode "→" (0x2192)`). En esta app los nombres de
// categoria admiten emoji por diseno (CURATED_ICONS, category-colors.js:63) y los comercios vienen
// de CSV ajenos: sin este saneo, el PDF de un usuario normal revienta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { winAnsiSafe, layoutReport, A4, buildPdfBytes, reportFilename } from "../../app/app/js/informe-pdf.js";
import { barRowsGeometry } from "../../app/app/js/charts.js";
import { createRequire } from "node:module";

test("winAnsiSafe: conserva lo que WinAnsi si codifica", () => {
  const ok = "Alimentación ñ áéíóú ü ç — · « » 1.480,15 €";
  assert.equal(winAnsiSafe(ok), ok);
});

test("winAnsiSafe: normaliza el menos tipografico y los espacios finos", () => {
  assert.equal(winAnsiSafe("−17,70 €"), "-17,70 €");
  // fr-FR emite U+202F (narrow no-break space) en sus importes: verificado con Intl en Node 22.
  const fr = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(-1234.5);
  assert.ok(fr.includes(" "));
  assert.ok(!winAnsiSafe(fr).includes(" "));
  assert.ok(winAnsiSafe(fr).includes(" "));
});

test("winAnsiSafe: nunca lanza con emoji ni flechas, y no deja runs de interrogantes", () => {
  assert.doesNotThrow(() => winAnsiSafe("🏠 Casa → 🎉"));
  assert.ok(!/\?\?/.test(winAnsiSafe("🏠🏠🏠 Casa")));
  assert.ok(winAnsiSafe("🏠 Casa").includes("Casa"));
});

test("winAnsiSafe: entradas raras no rompen", () => {
  assert.equal(winAnsiSafe(null), "");
  assert.equal(winAnsiSafe(undefined), "");
  assert.equal(winAnsiSafe(42), "42");
});

// ---- Task 9: layoutReport — geometria sin libreria --------------------------------------------

function smallReport() {
  return {
    meta: {
      periodId: "per-1", name: "Septiembre 2026", startDate: "2026-09-01", endDate: "",
      closeDate: "2026-09-09", isOpen: true, dayIndex: 9, expectedDays: 30, elapsedDays: 8,
      generatedAtIso: "2026-09-09",
    },
    summary: {
      incomeCents: 185000, spentCents: 84720, savedCents: 100280, availableCents: 35280,
      budgetTotalCents: 120000, savingsRatePct: 54, prevSavingsRatePct: null,
    },
    accounts: {
      rows: [
        { id: "acc-1", name: "Cuenta corriente", startCents: 45965, endCents: 148015, deltaCents: 102050 },
        { id: "acc-2", name: "Efectivo", startCents: 6000, endCents: 4230, deltaCents: -1770 },
      ],
      totalStartCents: 51965, totalEndCents: 152245, totalDeltaCents: 100280,
    },
    categories: {
      rows: [
        { rootId: "cat-casa", name: "Casa", color: "#5B9BFF", textColor: "#7FB3FF", icon: "🏠", spentCents: 24560, limitCents: 26000, pctOfLimit: 94, level: "warn", shareOfMax: 100, prevCents: 23800, deltaCents: 760, deltaPct: 3.19, direction: "up" },
        { rootId: "cat-alimentacion", name: "Alimentación", color: "#6BCB3E", textColor: "#8FE05F", icon: "🛒", spentCents: 18740, limitCents: 25000, pctOfLimit: 75, level: "ok", shareOfMax: 76, prevCents: 21490, deltaCents: -2750, deltaPct: -12.8, direction: "down" },
      ],
      totalCents: 43300, prevTotalCents: 45290, totalDeltaPct: -4.4, hasPrev: true,
    },
    movements: {
      count: 4,
      groups: [
        { rootId: "cat-casa", name: "Casa", color: "#5B9BFF", icon: "🏠", totalCents: 24560, count: 1,
          items: [{ id: "t1", date: "2026-09-07", merchant: "Ferretería Ruiz", cents: 6790, type: "expense", isShared: false, paidBy: "me" }] },
        { rootId: "cat-alimentacion", name: "Alimentación", color: "#6BCB3E", icon: "🛒", totalCents: 18740, count: 2,
          items: [
            { id: "t2", date: "2026-09-08", merchant: "Mercadona", cents: 2345, type: "expense", isShared: false, paidBy: "me" },
            { id: "t3", date: "2026-09-02", merchant: "Mercadona", cents: 8430, type: "expense", isShared: true, paidBy: "me" },
          ] },
      ],
      others: { count: 1, items: [{ id: "t4", date: "2026-09-01", merchant: "Nómina agosto", cents: 185000, type: "income", isShared: false, paidBy: "me" }] },
    },
    shared: { partnerName: "Marta", periodTotalCents: 19940, myPartCents: 9970, netCents: 2260, direction: "partner_owes", items: [{ id: "t3", date: "2026-09-02", merchant: "Mercadona", cents: 8430, myCents: 4215, paidBy: "me" }] },
    subscriptions: { activeCount: 3, periodCents: 4998, monthlyCents: 4998, annualCents: 59976 },
  };
}

/** Informe con `n` movimientos en un unico grupo (para hacer crecer el numero de paginas de
 *  forma controlada) — `opts.categoryName`/`opts.merchant` permiten forzar un texto concreto en
 *  la primera fila (Task 10: una categoria con emoji, un comercio con flecha). */
function reportWith(n, opts = {}) {
  const base = smallReport();
  const catName = opts.categoryName ?? "Otros gastos";
  const merchant = opts.merchant ?? "Comercio";
  const items = Array.from({ length: n }, (_, i) => ({
    id: "item-" + i,
    date: "2026-09-" + String((i % 28) + 1).padStart(2, "0"),
    merchant: i === 0 ? merchant : `${merchant} ${i}`,
    cents: 1000 + i,
    type: "expense",
    isShared: false,
    paidBy: "me",
  }));
  const group = {
    rootId: "cat-generado", name: catName, color: "#8A8794", icon: "▫️",
    totalCents: items.reduce((s, it) => s + it.cents, 0), count: items.length, items,
  };
  return {
    ...base,
    movements: { count: n + base.movements.others.count, groups: [group], others: base.movements.others },
  };
}

/** Informe con `n` grupos de UN movimiento cada uno — para probar de forma genérica (sin acoplarse
 *  a las constantes internas de layout) que una cabecera de grupo nunca queda sola al final de una
 *  página: con muchos grupos, alguna cabecera caerá justo en el límite de página tarde o temprano. */
function reportWithManyGroups(n) {
  const base = smallReport();
  const groups = Array.from({ length: n }, (_, i) => ({
    rootId: "cat-g" + i, name: "Grupo " + i, color: "#123456", icon: "•", totalCents: 1000, count: 1,
    items: [{ id: "gi-" + i, date: "2026-09-01", merchant: "Comercio " + i, cents: 1000, type: "expense", isShared: false, paidBy: "me" }],
  }));
  return { ...base, movements: { count: n, groups, others: { count: 0, items: [] } } };
}

test("layoutReport: A4 y margenes, y ningun bloque por debajo del margen inferior", () => {
  const { pageSize, margin, pages } = layoutReport(smallReport());
  assert.deepEqual(pageSize, A4);
  assert.deepEqual(pageSize, { w: 595.28, h: 841.89 });
  for (const p of pages) for (const b of p.blocks) assert.ok(b.y >= margin);
});

test("layoutReport: las secciones salen en el orden del artboard", () => {
  const kinds = layoutReport(smallReport()).pages[0].blocks.map((b) => b.section);
  assert.deepEqual([...new Set(kinds)].slice(0, 4), ["header", "summary", "accounts", "categories"]);
});

// No se afirma un numero absoluto de paginas: se romperia al mover una constante de layout.
test("layoutReport: mas movimientos, mas paginas", () => {
  assert.ok(layoutReport(reportWith(60)).pages.length > layoutReport(reportWith(3)).pages.length);
});

test("layoutReport: una cabecera de grupo nunca se queda sola al final de pagina", () => {
  const { pages } = layoutReport(reportWithManyGroups(40));
  for (const p of pages) {
    const last = p.blocks[p.blocks.length - 1];
    assert.notEqual(last?.groupHeader, true, "una cabecera de grupo no puede ser el ultimo bloque de una pagina");
  }
});

test("layoutReport: cada pagina lleva su pie numerado {n}/{total}", () => {
  const { pages } = layoutReport(reportWith(60));
  const total = pages.length;
  pages.forEach((p, i) => {
    const footer = p.blocks.find((b) => b.section === "footer");
    assert.ok(footer, `la pagina ${i + 1} debe llevar pie`);
    assert.equal(footer.text, `${i + 1}/${total}`);
  });
});

test("layoutReport: los rects de las barras salen de barRowsGeometry", () => {
  const report = smallReport();
  const { pageSize, margin, pages } = layoutReport(report);
  const contentW = pageSize.w - margin * 2;
  const casa = report.categories.rows.find((r) => r.rootId === "cat-casa");
  const maxSpent = Math.max(...report.categories.rows.map((r) => r.spentCents));
  const [expected] = barRowsGeometry(
    [{ key: "row", value: casa.spentCents, max: maxSpent, color: casa.color }],
    { width: contentW, rowH: 16, barH: 6 },
  );
  const rect = pages.flatMap((p) => p.blocks).find((b) => b.kind === "rect" && b.section === "categories" && b.color === casa.color);
  assert.ok(rect, "debe haber un rect de barra para la categoria Casa");
  assert.equal(rect.w, expected.w);
  assert.equal(rect.h, expected.h);
});

// ---- Task 10: buildPdfBytes y pdf-loader.js -----------------------------------------------------
// pdf-lib se carga con createRequire, igual que tests/app/helpers.mjs:5-6 hace con xlsx (el UMD
// expone module.exports).

const require = createRequire(import.meta.url);
const PDFLib = require("../../app/app/vendor/pdf-lib/pdf-lib.min.js");

test("buildPdfBytes: los bytes son un PDF valido", async () => {
  const bytes = await buildPdfBytes(PDFLib, smallReport());
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
});

test("buildPdfBytes: las paginas del PDF son las que dijo layoutReport", async () => {
  const report = reportWith(60);
  const bytes = await buildPdfBytes(PDFLib, report);
  const doc = await PDFLib.PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 2);
  assert.equal(doc.getPageCount(), layoutReport(report).pages.length);
});

test("buildPdfBytes: un informe grande da estrictamente mas paginas que uno pequeno", async () => {
  const [bigBytes, smallBytes] = await Promise.all([
    buildPdfBytes(PDFLib, reportWith(60)),
    buildPdfBytes(PDFLib, reportWith(3)),
  ]);
  const [bigDoc, smallDoc] = await Promise.all([PDFLib.PDFDocument.load(bigBytes), PDFLib.PDFDocument.load(smallBytes)]);
  assert.ok(bigDoc.getPageCount() > smallDoc.getPageCount());
});

// El caso que revienta en producción si falta winAnsiSafe.
test("buildPdfBytes: una categoria con emoji y un comercio con flecha no lanzan", async () => {
  const report = reportWith(3, { categoryName: "🏠 Casa", merchant: "Bar → La Plaza" });
  await assert.doesNotReject(() => buildPdfBytes(PDFLib, report));
});

test("buildPdfBytes: un importe de fr-FR (con U+202F) no lanza", async () => {
  const frAmount = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(-1234.5);
  const report = reportWith(3, { merchant: `Pedido ${frAmount}` });
  await assert.doesNotReject(() => buildPdfBytes(PDFLib, report));
});

test("reportFilename: determinista y sin caracteres de ruta", () => {
  assert.equal(reportFilename(smallReport()), "basecero-informe-2026-09-01.pdf");
  assert.ok(!/[/\\:]/.test(reportFilename(smallReport())));
});
