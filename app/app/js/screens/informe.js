import { reportInputs, listPeriods } from "../repo.js";
import { buildReport } from "../informe-logic.js";
import { categoryBarsSvg, comparisonBarsSvg } from "../charts.js";
import { buildPdfBytes, reportFilename } from "../informe-pdf.js";
import { loadPdfLib } from "../pdf-loader.js";
import { download } from "../download.js";
import { fmtMoney, fmtDiaCorto, fmtPct0 } from "../format.js";
import { renderSuscripciones } from "./suscripciones.js";
import { pushBack, goBack } from "../back.js";
import { t } from "../i18n/index.js";
import { userMessage } from "../errors.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");

const BTN_SECONDARY = "background:var(--card2);color:var(--text);border:0;"
  + "border-radius:999px;padding:16px;flex:1;font:600 16px var(--font-ui);cursor:pointer;";

// Filas de movimiento visibles antes de «y N movimientos más» (el resto solo va en el PDF, spec §8.9).
const MOVEMENTS_PREVIEW = 3;

/** Pantalla de error con recuperación (mismo patrón que renderAsistenteError en
 *  periodo-nuevo.js:22-32): banner + «Reintentar» + «Volver», nunca un callejón sin salida. */
function renderInformeError(container, onBack, message, retry) {
  container.innerHTML = `
    <div class="banner-aviso red" style="margin-bottom:14px;">${escHtml(message)}</div>
    <div style="display:flex; gap:8px;">
      <button type="button" class="btn-primary" id="informe-error-retry" style="flex:1;">${t("common.retry")}</button>
      <button type="button" id="informe-error-back" style="${BTN_SECONDARY}">${t("common.goBack")}</button>
    </div>`;
  container.querySelector("#informe-error-retry").onclick = retry;
  container.querySelector("#informe-error-back").onclick = () => onBack();
}

const BACK_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"></path></svg>`;
const CHEVRON_SVG = (deg) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform:rotate(${deg}deg);"><path d="M9 5l7 7-7 7"></path></svg>`;
const DOWNLOAD_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-4px;margin-right:6px;"><path d="M12 3v13m0 0-5-5m5 5 5-5M4 21h16"></path></svg>`;

function headerHtml(report, periods) {
  const m = report.meta;
  const statusHtml = m.isOpen
    ? `<span style="color:var(--warn);">${t("informe.openPeriod", { n: m.dayIndex, m: m.expectedDays })}</span>`
    : `<span style="color:var(--ink-3);">${t("informe.closedPeriod", { start: escHtml(fmtDiaCorto(m.startDate)), end: escHtml(fmtDiaCorto(m.endDate)) })}</span>`;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return `
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
    <button type="button" class="icon-btn" id="informe-back" aria-label="${t("common.goBack")}"
      style="width:44px;height:44px;border-radius:50%;background:var(--card);color:var(--text);font-size:18px;">${BACK_SVG}</button>
    <div style="font-size:20px;font-weight:700;letter-spacing:-0.015em;">${t("informe.title")}</div>
  </div>
  <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px;">
    <div style="font-size:17px;font-weight:700;">${escHtml(m.name)}</div>
    <div style="font-size:13px;">${statusHtml}</div>
  </div>
  <hr class="divider">
  <div style="font-size:11px;color:var(--text-3);margin:10px 0 16px;">${t("informe.generatedAt", { time: hhmm })}</div>
  ${periods.length > 1 ? `
  <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:16px;">
    <span class="section-title">${t("informe.selector.label")}</span>
    <select id="informe-selector">
      ${periods.map((p) => `<option value="${escAttr(p.id)}" ${p.id === report.meta.periodId ? "selected" : ""}>${escHtml(p.name)}</option>`).join("")}
    </select>
  </label>` : ""}`;
}

function downloadHtml(state) {
  return `
  <div style="margin-bottom:20px;">
    <button type="button" class="btn-primary" id="informe-download" ${state.downloading ? "disabled" : ""}>${state.downloading ? t("informe.downloading") : `${DOWNLOAD_SVG}${t("informe.download")}`}</button>
    <div style="font-size:11px;color:var(--text-3);margin-top:8px;">${t("informe.downloadHint")}</div>
    ${state.downloadError ? `<div class="banner-aviso red" style="margin-top:10px;">${escHtml(state.downloadError)}</div>` : ""}
  </div>`;
}

function summaryHtml(report, prevPeriodName) {
  const s = report.summary;
  // Gastos > ingresos -> savingsRatePct negativo ("Ahorras el −146 %" no dice nada): mismo
  // criterio que Inicio (inicio-logic.js#savingsSentence), reutilizando su misma clave. Segunda
  // mitad («En agosto, el 43 %.») solo si hay tasa del periodo anterior, ES POSITIVA (no hay "el
  // -12 %" con el que comparar tampoco) Y nombre de ese periodo — sin alguno de los tres, se
  // queda solo la primera frase, nunca "el X% / null%".
  let sentence = s.savedCents < 0 ? t("inicio.savings.negative")
    : s.savingsRatePct != null ? t("informe.summary.savingsRate", { pct: s.savingsRatePct })
    : "";
  if (sentence && s.prevSavingsRatePct != null && s.prevSavingsRatePct >= 0 && prevPeriodName) {
    sentence += t("informe.summary.savingsRateVsPrev", { name: escHtml(prevPeriodName), pct: s.prevSavingsRatePct });
  }
  return `
  <div style="margin-bottom:24px;">
    <div class="section-title" style="margin-bottom:10px;">${t("informe.summary.title")}</div>
    <div class="stat-grid" style="grid-template-columns:repeat(2,1fr);">
      <div>
        <span style="font-size:12px;font-weight:500;color:var(--ink-3);">${t("informe.summary.income")}</span>
        <span class="num" style="font:600 15px var(--font-mono);color:var(--pos);">${escHtml(fmtMoney(s.incomeCents))}</span>
      </div>
      <div>
        <span style="font-size:12px;font-weight:500;color:var(--ink-3);">${t("informe.summary.spent")}</span>
        <span class="num" style="font:600 15px var(--font-mono);color:var(--ink);">${escHtml(fmtMoney(s.spentCents))}</span>
      </div>
      <div>
        <span style="font-size:12px;font-weight:500;color:var(--ink-3);">${t("informe.summary.saved")}</span>
        <span class="num" style="font:600 15px var(--font-mono);color:${s.savedCents < 0 ? "var(--danger)" : "var(--ink)"};">${escHtml(fmtMoney(s.savedCents))}</span>
      </div>
      <div>
        <span style="font-size:12px;font-weight:500;color:var(--ink-3);">${t("informe.summary.available")}</span>
        <span class="num" style="font:600 15px var(--font-mono);color:var(--ink);">${escHtml(fmtMoney(s.availableCents))}</span>
      </div>
    </div>
    ${sentence ? `<div style="padding-top:10px;font-size:13px;color:var(--ink-3);">${sentence}</div>` : ""}
  </div>`;
}

// Tabla de tres columnas (cuenta / apertura / cierre) con la variación por cuenta debajo y a la
// derecha, en --pos/--danger (spec §8.5, la audacia del artboard es la comparativa, no esta
// tabla, pero sigue su forma: cabecera de fecha + fila por cuenta + total con su propia variación).
function accountRowHtml(r, bold = false) {
  return `
  <div style="display:flex; flex-direction:column; gap:4px; padding:11px 0;">
    <div style="display:flex; align-items:baseline; gap:10px;">
      <span style="flex:1; min-width:0; font-size:14px; font-weight:${bold ? 700 : 500};">${escHtml(r.name)}</span>
      <span class="num" style="font-size:12px; color:var(--ink-3); flex-shrink:0;">${escHtml(fmtMoney(r.startCents))}</span>
      <span class="num" style="font-size:${bold ? 14 : 13}px; font-weight:${bold ? 700 : 600}; flex-shrink:0; min-width:64px; text-align:right;">${escHtml(fmtMoney(r.endCents))}</span>
    </div>
    <div style="text-align:right;">
      <span class="num" style="font-size:11px; color:${r.deltaCents < 0 ? "var(--danger)" : "var(--pos)"};">${r.deltaCents >= 0 ? "+" : ""}${escHtml(fmtMoney(r.deltaCents))}</span>
    </div>
  </div>`;
}

function accountsHtml(report) {
  const a = report.accounts;
  const m = report.meta;
  return `
  <div style="margin-bottom:24px;">
    <div style="display:flex; align-items:baseline; gap:10px; margin-bottom:6px;">
      <span class="section-title" style="flex:1;">${t("informe.accounts.title")}</span>
      <span style="font-size:11px; color:var(--ink-3);">${escHtml(fmtDiaCorto(m.startDate))}</span>
      <span style="font-size:11px; color:var(--ink-3); min-width:64px; text-align:right;">${m.isOpen ? t("common.today") : escHtml(fmtDiaCorto(m.endDate))}</span>
    </div>
    <div style="display:flex; flex-direction:column;">
      ${a.rows.map((r, i) => (i > 0 ? '<hr class="divider">' : "") + accountRowHtml(r)).join("")}
    </div>
    <hr class="divider">
    ${accountRowHtml({ name: t("informe.accounts.total"), startCents: a.totalStartCents, endCents: a.totalEndCents, deltaCents: a.totalDeltaCents }, true)}
  </div>`;
}

function categoriesHtml(report, prevPeriodName) {
  const c = report.categories;
  const maxSpent = Math.max(0, ...c.rows.map((x) => x.spentCents));
  const rows = c.rows.map((r) => {
    const bar = categoryBarsSvg([{ key: r.rootId, value: r.spentCents, max: maxSpent, color: r.color }],
      { width: 260, rowH: 8, barH: 8 });
    // Mini tendencia (SISTEMA §4.19): las dos barras —actual y anterior, atenuada— a la MISMA
    // escala (comparisonBarsSvg, D3): es la garantía de que esta miniatura y la barra principal
    // de arriba nunca puedan divergir, porque las dos salen de barRowsGeometry.
    const miniTrend = c.hasPrev && r.prevCents != null
      ? comparisonBarsSvg([{ key: r.rootId, value: r.spentCents, prevValue: r.prevCents, color: r.color }],
        { width: 22, rowH: 14, barH: 6 })
      : "";
    const trend = r.direction === "new" ? "" : `
      <span style="color:${r.direction === "down" ? "var(--pos)" : r.direction === "up" ? "var(--danger)" : "var(--ink-3)"};">
        ${r.direction === "down" ? "↓" : r.direction === "up" ? "↑" : "·"} ${r.deltaPct != null ? escHtml(fmtPct0(Math.abs(r.deltaPct) / 100)) : ""}
      </span>`;
    return `
    <div style="display:flex;flex-direction:column;gap:6px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="dotico" style="--cat:${r.color};">${escHtml(r.icon)}</div>
        <span style="flex:1;min-width:0;font-size:14px;font-weight:500;">${escHtml(r.name)}</span>
        <span class="num" style="font-size:13px;font-weight:600;">${escHtml(fmtMoney(r.spentCents))}</span>
      </div>
      ${bar}
      ${c.hasPrev && r.prevCents != null ? `<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ink-3);">
        <span>${escHtml(prevPeriodName ?? "")} ${escHtml(fmtMoney(r.prevCents))}</span>${miniTrend}${trend}
      </div>` : ""}
    </div>`;
  }).join("");
  const orientativo = report.meta.isOpen && c.hasPrev
    ? `<div style="font-size:11px;color:var(--ink-3);margin-top:10px;">${t("informe.categories.orientativo", {
      prev: escHtml(prevPeriodName ?? ""), current: escHtml(report.meta.name), day: report.meta.dayIndex, total: report.meta.expectedDays,
    })}</div>`
    : "";
  return `
  <div style="margin-bottom:24px;">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px;">
      <div class="section-title">${t("informe.categories.title")}</div>
      ${c.hasPrev ? `<span style="font-size:11px;color:var(--ink-3);">${t("informe.categories.vsPrev", { name: escHtml(prevPeriodName ?? "") })}</span>` : ""}
    </div>
    <div style="display:flex;flex-direction:column;gap:16px;">${rows}</div>
    <hr class="divider" style="margin:14px 0;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <span style="font-size:14px;font-weight:700;">${t("informe.categories.total")}</span>
      <span class="num" style="font-size:14px;font-weight:700;">${escHtml(fmtMoney(c.totalCents))}${c.hasPrev ? ` <span style="color:var(--ink-3);font-weight:500;">/ ${escHtml(fmtMoney(c.prevTotalCents))}</span>` : ""}</span>
    </div>
    ${!c.hasPrev ? `<div style="font-size:11px;color:var(--ink-3);margin-top:8px;">${t("informe.categories.noPrev")}</div>` : orientativo}
  </div>`;
}

function sharedHtml(report) {
  const s = report.shared;
  if (!s) return "";
  const labelKey = s.direction === "partner_owes" ? "informe.shared.net.theyOwe" : s.direction === "i_owe" ? "informe.shared.net.youOwe" : "informe.shared.net.even";
  const color = s.direction === "partner_owes" ? "var(--pos)" : s.direction === "i_owe" ? "var(--danger)" : "var(--ink)";
  return `
  <div style="margin-bottom:24px;">
    <div class="section-title" style="margin-bottom:10px;">${t("informe.shared.title", { name: escHtml(s.partnerName) })}</div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <span style="font-size:14px;font-weight:500;">${t("informe.shared.periodTotal")}</span>
      <span class="num" style="font-size:14px;font-weight:600;">${escHtml(fmtMoney(s.periodTotalCents))}</span>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:6px;">
      <span style="font-size:14px;font-weight:500;">${t("informe.shared.myPart")}</span>
      <span class="num" style="font-size:14px;font-weight:600;">${escHtml(fmtMoney(s.myPartCents))}</span>
    </div>
    <hr class="divider" style="margin:10px 0;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <span style="font-size:14px;font-weight:600;">${t(labelKey, { name: escHtml(s.partnerName) })}</span>
      <span class="num" style="font-size:15px;font-weight:700;color:${color};">${escHtml(fmtMoney(Math.abs(s.netCents)))}</span>
    </div>
  </div>`;
}

function subscriptionsHtml(report) {
  const s = report.subscriptions;
  if (!s) return "";
  return `
  <div style="margin-bottom:24px;">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px;">
      <span class="section-title">${t("informe.subscriptions.title")}</span>
      <button type="button" id="informe-suscripciones-link" class="link-btn" style="display:flex;align-items:center;gap:4px;">${t("informe.subscriptions.link")}${CHEVRON_SVG(0)}</button>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <span style="font-size:14px;font-weight:500;">${t("informe.subscriptions.active", { n: s.activeCount })}</span>
      <span class="num" style="font-size:14px;font-weight:600;color:var(--warn);">${escHtml(fmtMoney(s.monthlyCents))}</span>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:6px;">
      <span style="font-size:14px;font-weight:500;">${t("informe.subscriptions.yearly")}</span>
      <span class="num" style="font-size:14px;font-weight:600;color:var(--warn);">${escHtml(fmtMoney(s.annualCents))}</span>
    </div>
  </div>`;
}

/** Cabecera de grupo pulsable = un <button> HERMANO del bloque desplegable, nunca envolviéndolo
 *  (criterio de gasto-por-categoria.js:34-38: un botón dentro de otro es HTML inválido). */
function movementGroupHtml(g, expanded) {
  const rowsHtml = g.items.slice(0, MOVEMENTS_PREVIEW).map((it) => `
    <div style="display:flex;align-items:center;gap:10px;padding:6px 0;">
      <span style="flex:1;min-width:0;font-size:13px;color:var(--ink-2);">${escHtml(it.merchant || "")}</span>
      <span class="num" style="font-size:12px;color:var(--ink-3);">${escHtml(fmtDiaCorto(it.date))}</span>
      <span class="num" style="font-size:13px;font-weight:600;">${escHtml(fmtMoney(it.cents))}</span>
    </div>`).join("");
  const more = g.items.length > MOVEMENTS_PREVIEW
    ? `<div style="font-size:11px;color:var(--ink-3);padding-top:4px;">${t("informe.movements.andMore", { n: g.items.length - MOVEMENTS_PREVIEW })}</div>` : "";
  return `
  <div style="display:flex;flex-direction:column;gap:6px;">
    <button type="button" data-group="${escAttr(g.rootId)}" aria-expanded="${expanded ? "true" : "false"}"
      style="display:flex;align-items:center;gap:10px;width:100%;background:none;border:0;padding:0;margin:0;
      color:inherit;font:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;">
      <div class="dotico" style="--cat:${g.color};">${escHtml(g.icon)}</div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;">
        <span style="font-size:14px;font-weight:600;">${escHtml(g.name)}</span>
        <span class="num" style="font-size:11px;color:var(--ink-3);">${t("informe.movements.groupCount", { n: g.count ?? g.items.length })}</span>
      </div>
      <span class="num" style="font-size:13px;font-weight:600;">${escHtml(fmtMoney(g.totalCents))}</span>
      <span style="width:28px;height:28px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--ink-3);">${CHEVRON_SVG(expanded ? 90 : 0)}</span>
    </button>
    ${expanded ? `<div style="padding-left:46px;">${rowsHtml}${more}</div>` : ""}
  </div>`;
}

function movementsHtml(report, expandedGroup) {
  const m = report.movements;
  return `
  <div style="margin-bottom:24px;">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px;">
      <div class="section-title">${t("informe.movements.title")}</div>
      <span style="font-size:11px;color:var(--ink-3);">${t("informe.movements.count", { n: m.count })}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:14px;">
      ${m.groups.map((g) => movementGroupHtml(g, g.rootId === expandedGroup)).join("")}
      ${m.others.items.length ? movementGroupHtml({
        rootId: "__others__", name: t("informe.movements.others"), color: "var(--ink-3)", icon: "•",
        totalCents: m.others.items.reduce((s, it) => s + it.cents, 0), items: m.others.items,
      }, expandedGroup === "__others__") : ""}
    </div>
  </div>`;
}

function footerHtml(report) {
  return `<div style="font-size:11px;color:var(--ink-3);padding-bottom:24px;">${t("informe.footer", { n: report.movements.count })}</div>`;
}

/** Pantalla del Informe del periodo (F1): resumen, saldos de cuenta al inicio/fin, gasto por
 *  categoría con comparativa (N3), movimientos por categoría, compartidos y suscripciones — y la
 *  descarga del PDF, generado en el propio móvil con las mismas gráficas (informe-pdf.js).
 *  Sin `periodId`, el periodo abierto (o el más reciente si no hay ninguno abierto). */
export async function renderInforme(container, onBack, { periodId } = {}) {
  const state = { periodId, downloading: false, downloadError: "", expandedGroup: null, periods: [], report: null };

  async function load() {
    const [inputs, periods] = await Promise.all([reportInputs(state.periodId), listPeriods()]);
    state.periodId = inputs.period.id;
    state.periods = periods;
    state.report = buildReport(inputs);
    state.prevPeriodName = inputs.prevPeriod?.name ?? "";
    if (state.expandedGroup == null) {
      state.expandedGroup = state.report.movements.groups[0]?.rootId
        ?? (state.report.movements.others.items.length ? "__others__" : null);
    }
  }

  async function boot() {
    try {
      await load();
    } catch (e) {
      renderInformeError(container, onBack, t("informe.error.load", { error: userMessage(e) }), boot);
      return;
    }
    render();
  }

  function render() {
    const report = state.report;
    container.innerHTML = `
      ${headerHtml(report, state.periods)}
      ${downloadHtml(state)}
      ${summaryHtml(report, state.prevPeriodName)}
      ${accountsHtml(report)}
      ${categoriesHtml(report, state.prevPeriodName)}
      ${sharedHtml(report)}
      ${subscriptionsHtml(report)}
      ${movementsHtml(report, state.expandedGroup)}
      ${footerHtml(report)}
    `;
    wire();
  }

  function wire() {
    container.querySelector("#informe-back").onclick = () => onBack();

    const selector = container.querySelector("#informe-selector");
    if (selector) selector.onchange = async (e) => {
      state.periodId = e.target.value;
      state.expandedGroup = null;
      try {
        await load();
      } catch (err) {
        renderInformeError(container, onBack, t("informe.error.load", { error: userMessage(err) }), boot);
        return;
      }
      render();
    };

    container.querySelector("#informe-download").onclick = async () => {
      state.downloading = true; state.downloadError = ""; render();
      try {
        const PDFLib = await loadPdfLib();
        const bytes = await buildPdfBytes(PDFLib, state.report);
        download(new Blob([bytes], { type: "application/pdf" }), reportFilename(state.report));
      } catch (e) {
        state.downloadError = t("informe.error.pdf", { error: userMessage(e) });
      } finally {
        state.downloading = false; render();
      }
    };

    container.querySelectorAll("[data-group]").forEach((el) => {
      el.onclick = () => {
        const id = el.dataset.group;
        state.expandedGroup = state.expandedGroup === id ? null : id;
        render();
      };
    });

    const susLink = container.querySelector("#informe-suscripciones-link");
    if (susLink) susLink.onclick = () => {
      pushBack(() => render());
      renderSuscripciones(container, goBack);
    };
  }

  await boot();
}
