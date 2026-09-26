import { reportInputs, listPeriods } from "../repo.js";
import { buildReport } from "../informe-logic.js";
import { buildPdfBytes, reportFilename } from "../informe-pdf.js";
import { loadPdfPalette } from "../pdf-palette.js";
import { loadPdfLib } from "../pdf-loader.js";
import { download } from "../download.js";
import { fmtMoney, fmtDiaCorto, fmtPct, fmtPct0 } from "../format.js";
import { t } from "../i18n/index.js";
import { userMessage } from "../errors.js";
import { subHeaderHtml, buttonHtml } from "../ui.js";
import { segmentedHtml, wireSegmented } from "../controls.js";
import { displayHtml, dispInkHtml, bentoHtml, meterHtml, emptyStateHtml, containerHtml } from "../instrument.js";
import { settingRowHtml } from "../entity.js";
import { icon } from "../icons.js";
import { escHtml, escAttr } from "../esc.js";

// Pantalla del Informe del periodo, sistema B (B-Informe / BD-Informe). Lo que se ve es el
// resumen: Segmented de periodos, Display «Ahorras de lo que ingresas», la barra Ingresado ·
// Gastado · Ahorrado, la comparativa con el periodo anterior, el gasto por categoría y dos bloques
// bento. El detalle (saldos por cuenta, suscripciones, la lista completa de movimientos) va en el
// PDF, que se genera en el móvil (informe-pdf.js) con la misma estructura `report`.
// Todo el color y la forma viven en la sección «informe» de css/screens.css; en línea solo va
// geometría (width y flex-basis), como pide R-INLINE.

// Periodos visibles en el Segmented (B-Informe: tres, el más reciente primero). Con más, una cuarta
// opción «Anteriores» despliega la lista de todos los periodos cerrados.
const SEGMENTED_PERIODS = 3;
const OLDER = "__older__";
// Categorías con nombre antes de agrupar el resto en «Resto» (B-Informe: cinco más Resto).
const TOP_CATEGORIES = 5;

/** «Septiembre 2026» → «Septiembre» para la etiqueta corta del Segmented y de la comparativa,
 *  solo si quitar el año deja algo. El nombre lo escribe el usuario: cualquier otro formato se
 *  queda tal cual. */
function shortName(name) {
  const s = String(name ?? "").trim();
  const m = s.match(/^(.+?)\s+\d{4}$/);
  return m ? m[1] : s;
}

/** Pantalla de error con recuperación: aviso + «Reintentar» + «Volver», nunca un callejón. */
function renderInformeError(container, onBack, message, retry) {
  container.innerHTML = `
    ${subHeaderHtml({ id: "informe-back", title: t("informe.title") })}
    <div class="inf">
      <div class="banner-aviso red">${escHtml(message)}</div>
      ${buttonHtml({ kind: "primary", id: "informe-error-retry", label: t("common.retry") })}
      ${buttonHtml({ kind: "secondary", id: "informe-error-leave", label: t("common.goBack") })}
    </div>`;
  container.querySelector("#informe-back").onclick = () => onBack();
  container.querySelector("#informe-error-retry").onclick = retry;
  container.querySelector("#informe-error-leave").onclick = () => onBack();
}

function headerHtml(report) {
  const m = report.meta;
  const subtitle = m.isOpen
    ? t("informe.openPeriod", { n: m.dayIndex, m: m.expectedDays })
    : t("informe.closedPeriod", { start: fmtDiaCorto(m.startDate), end: fmtDiaCorto(m.endDate) });
  return subHeaderHtml({ id: "informe-back", title: t("informe.title"), subtitle });
}

/** Segmented de periodos: los tres más recientes (`periods` llega por fecha de inicio
 *  descendente, sql.js#listPeriods) y, si hay más, «Anteriores». Viendo un periodo más antiguo,
 *  esa cuarta opción lleva su nombre y sale marcada; con la lista abierta, también. */
function periodsHtml(periods, selectedId, olderOpen) {
  if (periods.length < 2) return "";
  const recent = periods.slice(0, SEGMENTED_PERIODS);
  const options = recent.map((p) => ({ value: p.id, label: shortName(p.name) }));
  const inRecent = recent.some((p) => p.id === selectedId);
  if (periods.length > SEGMENTED_PERIODS) {
    const sel = inRecent ? null : periods.find((p) => p.id === selectedId);
    options.push({ value: OLDER, label: sel ? shortName(sel.name) : t("informe.older.label") });
  }
  const value = olderOpen || !inRecent ? OLDER : selectedId;
  return segmentedHtml({ id: "informe-periods", name: t("informe.selector.label"), options, value });
}

/** Lista desplegada de «Anteriores»: los periodos cerrados que NO están ya en el Segmented (los
 *  tres más recientes no se repiten), cada uno una fila de ajuste con sus fechas; el que se está
 *  viendo lo dice en el valor. Así se abre y se exporta cualquier informe antiguo. */
function olderListHtml(periods, selectedId) {
  const closed = periods.slice(SEGMENTED_PERIODS).filter((p) => p.status === "closed");
  const rows = closed.length
    ? closed.map((p) => settingRowHtml({
      label: p.name,
      sub: t("informe.closedPeriod", { start: fmtDiaCorto(p.start_date), end: fmtDiaCorto(p.end_date) }),
      value: p.id === selectedId ? t("informe.older.viewing") : "",
      data: { period: p.id },
    })).join("")
    : `<p class="inf-older-none">${escHtml(t("informe.older.none"))}</p>`;
  return `<div id="informe-older">${containerHtml({ title: t("informe.older.title"), kind: "list", body: rows })}</div>`;
}

/** Display l (F-12): la tasa de ahorro manda. Con gasto por encima del ingreso la tasa sería
 *  negativa («−146 %» no dice nada): la etiqueta lo dice y la cifra es lo que falta. Sin ingresos
 *  no hay tasa: la cifra es lo ahorrado. El pie compara con el periodo anterior solo si su tasa
 *  existe, no es negativa y hay nombre — nunca «el null %». */
function displayBlockHtml(report, prevName) {
  const s = report.summary;
  if (s.savedCents < 0) {
    return displayHtml({ label: t("informe.display.overspent"), value: fmtMoney(s.savedCents) });
  }
  if (s.savingsRatePct == null) {
    return displayHtml({ label: t("informe.summary.saved"), value: fmtMoney(s.savedCents) });
  }
  const footHtml = s.prevSavingsRatePct != null && s.prevSavingsRatePct >= 0 && prevName
    ? t("informe.display.vsPrev", { name: escHtml(prevName), pct: dispInkHtml(fmtPct0(s.prevSavingsRatePct / 100)) })
    : "";
  return displayHtml({ label: t("informe.display.rate"), value: fmtPct0(s.savingsRatePct / 100), footHtml });
}

/** Ingresado arriba y, debajo, la barra de lo que pasó con ese ingreso (F-10): lo gastado en
 *  --idle y lo ahorrado en --text, cada tramo con su nombre y su cifra dentro (C12). Si el gasto
 *  supera al ingreso no hay tramo de ahorro: la barra es entera gasto. */
function splitHtml(report) {
  const s = report.summary;
  const spent = Math.max(0, s.spentCents);
  const saved = Math.max(0, s.savedCents);
  const total = spent + saved;
  const seg = (cls, label, cents) => `<div class="inf-split-seg ${cls}" style="flex-basis:${((cents / total) * 100).toFixed(2)}%">`
    + `<span class="inf-split-name">${escHtml(label)}</span><span class="num inf-split-amt">${escHtml(fmtMoney(cents))}</span></div>`;
  const aria = t("informe.split.aria", { income: fmtMoney(s.incomeCents), spent: fmtMoney(spent), saved: fmtMoney(saved) });
  const bar = total > 0
    ? `<div class="inf-split" role="img" aria-label="${escAttr(aria)}">${[
      spent > 0 ? seg("is-spent", t("informe.summary.spent"), spent) : "",
      saved > 0 ? seg("is-saved", t("informe.summary.saved"), saved) : "",
    ].join("")}</div>`
    : "";
  return `<section class="box box-chart">
    <div class="inf-line">
      <span class="inf-line-label">${t("informe.split.income")}</span>
      <span class="num inf-income">${escHtml(fmtMoney(s.incomeCents))}</span>
    </div>
    ${bar}
  </section>`;
}

/** Flecha y porcentaje de una variación de gasto: subir es la señal que avisa (--neg), bajar la
 *  buena (--pos); C4, cifras con señal. La dirección va también en texto para el lector (§11: el
 *  color nunca es la única señal). Sin variación o sin base, nada. */
function deltaHtml(direction, pct) {
  if (pct == null || (direction !== "up" && direction !== "down")) return "";
  const up = direction === "up";
  return `<span class="num inf-delta ${up ? "is-up" : "is-down"}">${icon(up ? "trendUp" : "trendDown", { size: 12, width: 2.4 })}`
    + `<span class="inf-sr">${escHtml(t(up ? "informe.compare.up" : "informe.compare.down"))} </span>${escHtml(fmtPct(Math.abs(pct) / 100))}</span>`;
}

/** «Frente a agosto» (C12): el gasto de este periodo y el del anterior, cada barra con el nombre
 *  del periodo al lado y a la misma escala. Sin periodo anterior no hay comparativa. */
function compareHtml(report, curName, prevName) {
  const c = report.categories;
  if (!c.hasPrev || !prevName) return "";
  const max = Math.max(c.totalCents, c.prevTotalCents, 0);
  const w = (v) => (max > 0 ? ((Math.max(0, v) / max) * 100).toFixed(2) : "0");
  const direction = c.totalDeltaPct == null ? "flat" : c.totalDeltaPct > 0 ? "up" : c.totalDeltaPct < 0 ? "down" : "flat";
  return `<section class="box box-chart inf-gap-16">
    <h2 class="box-title">${escHtml(t("informe.compare.title", { name: prevName }))}</h2>
    <div class="inf-cmp">
      <div class="inf-line">
        <span class="inf-line-label">${t("informe.summary.spent")}</span>
        ${deltaHtml(direction, c.totalDeltaPct)}
      </div>
      <div class="inf-cmp-grid">
        <span class="inf-cmp-name">${escHtml(curName)}</span>
        <div class="inf-cmp-track"><span class="inf-cmp-fill is-cur" style="width:${w(c.totalCents)}%"></span></div>
        <span class="num inf-cmp-amt">${escHtml(fmtMoney(c.totalCents))}</span>
        <span class="inf-cmp-name is-prev">${escHtml(prevName)}</span>
        <div class="inf-cmp-track"><span class="inf-cmp-fill is-prev" style="width:${w(c.prevTotalCents)}%"></span></div>
        <span class="num inf-cmp-amt is-prev">${escHtml(fmtMoney(c.prevTotalCents))}</span>
      </div>
    </div>
  </section>`;
}

/** «Por categoría»: las cinco raíces que más gastan, cada una con su medidor en la barra de su
 *  familia (-b, C6) y su variación frente al periodo anterior; el resto sumado en «Resto», en
 *  --idle (C11). El nombre va siempre junto a la barra (C12); la cifra, en tinta (C7). */
function categoriesHtml(report, prevName) {
  const rows = report.categories.rows.filter((r) => r.spentCents > 0).sort((a, b) => b.spentCents - a.spentCents);
  if (!rows.length) return "";
  const top = rows.slice(0, TOP_CATEGORIES);
  const rest = rows.slice(TOP_CATEGORIES).reduce((sum, r) => sum + r.spentCents, 0);
  const max = rows[0].spentCents;
  const row = ({ name, fam = null, spentCents, direction, deltaPct }, isRest = false) => `
    <div class="inf-cat${isRest ? " is-rest" : ""}">
      <div class="inf-cat-line">
        <span class="inf-cat-name">${escHtml(name)}</span>
        <span class="num inf-cat-amt">${escHtml(fmtMoney(spentCents))}</span>
        <span class="inf-cat-delta">${isRest ? "" : deltaHtml(direction, deltaPct)}</span>
      </div>
      <div class="inf-cat-meter">${meterHtml({ fam: isRest ? null : fam, value: spentCents, max })}</div>
    </div>`;
  return `<section class="box box-chart inf-gap-16">
    <div class="box-head">
      <h2 class="box-title">${t("informe.categories.byCategory")}</h2>
      ${report.categories.hasPrev && prevName ? `<span class="inf-vs">${escHtml(t("informe.categories.vsPrev", { name: prevName }))}</span>` : ""}
    </div>
    <div class="inf-cats">
      ${top.map((r) => row(r)).join("")}
      ${rest > 0 ? row({ name: t("informe.categories.rest"), spentCents: rest }, true) : ""}
    </div>
  </section>`;
}

/** Bento: lo que queda con la contraparte (si hay compartidos en el periodo) y cuántos
 *  movimientos tiene. Cifras en tinta (C3, C7). */
function bentosHtml(report) {
  const s = report.shared;
  const shared = s
    ? bentoHtml({
      label: s.direction === "partner_owes" ? t("informe.shared.net.theyOwe", { name: s.partnerName })
        : s.direction === "i_owe" ? t("informe.shared.net.youOwe", { name: s.partnerName })
        : t("informe.shared.net.even"),
      value: fmtMoney(Math.abs(s.netCents)),
    })
    : "";
  const movements = bentoHtml({ label: t("informe.bento.movements"), value: String(report.movements.count) });
  return `<div class="inf-bento${shared ? "" : " is-single"}">${shared}${movements}</div>`;
}

/** El primario (uno por pantalla, C1) con UNA nota debajo (F-11). */
function downloadHtml(state, report) {
  return `<div class="inf-download">
    ${buttonHtml({
      kind: "primary", id: "informe-download", icon: state.downloading ? "" : "download",
      label: state.downloading ? t("informe.downloading") : t("informe.download"),
      note: report.movements.count ? t("informe.downloadNote", { n: report.movements.count }) : t("informe.downloadNoteEmpty"),
      disabled: state.downloading,
    })}
    ${state.downloadError ? `<div class="banner-aviso red">${escHtml(state.downloadError)}</div>` : ""}
  </div>`;
}

/** Pantalla del Informe del periodo (F1). Sin `periodId`, el periodo abierto (o el más reciente
 *  si no hay ninguno abierto). */
export async function renderInforme(container, onBack, { periodId } = {}) {
  const state = { periodId, downloading: false, downloadError: "", periods: [], report: null, prevPeriodName: "", olderOpen: false };

  async function load() {
    const [inputs, periods] = await Promise.all([reportInputs(state.periodId), listPeriods()]);
    state.periodId = inputs.period.id;
    state.periods = periods;
    state.report = buildReport(inputs);
    state.prevPeriodName = inputs.prevPeriod?.name ?? "";
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
    const curName = shortName(report.meta.name);
    const prevName = shortName(state.prevPeriodName);
    // Periodo sin movimientos: estado vacío (§9) en vez de un Display a cero, pero el PDF se
    // sigue pudiendo descargar, como el de cualquier otro periodo.
    const body = report.movements.count === 0
      ? `${emptyStateHtml({ title: t("informe.empty.title"), text: t("informe.empty.text") })}
        ${downloadHtml(state, report)}`
      : `${displayBlockHtml(report, prevName)}
        ${splitHtml(report)}
        ${compareHtml(report, curName, prevName)}
        ${categoriesHtml(report, prevName)}
        ${bentosHtml(report)}
        ${downloadHtml(state, report)}`;
    container.innerHTML = `
      ${headerHtml(report)}
      <div class="inf">
        ${periodsHtml(state.periods, state.periodId, state.olderOpen)}
        ${state.olderOpen ? olderListHtml(state.periods, state.periodId) : ""}
        ${body}
      </div>`;
    wire();
  }

  async function choosePeriod(id) {
    state.periodId = id;
    state.downloadError = "";
    try {
      await load();
    } catch (err) {
      renderInformeError(container, onBack, t("informe.error.load", { error: userMessage(err) }), boot);
      return;
    }
    render();
  }

  function wire() {
    container.querySelector("#informe-back").onclick = () => onBack();

    const seg = container.querySelector("#informe-periods");
    const focusSegmented = (value) => [...container.querySelectorAll("#informe-periods [role=\"radio\"]")]
      .find((b) => b.dataset.value === value)?.focus();

    if (seg) wireSegmented(seg, async (value) => {
      // «Anteriores» abre (o, pulsado otra vez, cierra) la lista; no carga nada por sí solo.
      if (value === OLDER) {
        state.olderOpen = !state.olderOpen;
        render();
        focusSegmented(OLDER);
        return;
      }
      state.olderOpen = false;
      if (value === state.periodId) { render(); focusSegmented(value); return; }
      await choosePeriod(value);
      // El render rehace el Segmented: el foco vuelve al periodo elegido (K12, flechas seguidas).
      focusSegmented(state.periodId);
    });

    container.querySelectorAll("#informe-older [data-period]").forEach((b) => {
      b.onclick = async () => {
        state.olderOpen = false;
        await choosePeriod(b.dataset.period);
        focusSegmented(OLDER);
      };
    });

    const dl = container.querySelector("#informe-download");
    if (dl) dl.onclick = async () => {
      state.downloading = true; state.downloadError = ""; render();
      try {
        const [PDFLib, palette] = await Promise.all([loadPdfLib(), loadPdfPalette()]);
        const bytes = await buildPdfBytes(PDFLib, state.report, { palette });
        download(new Blob([bytes], { type: "application/pdf" }), reportFilename(state.report));
      } catch (e) {
        state.downloadError = t("informe.error.pdf", { error: userMessage(e) });
      } finally {
        state.downloading = false; render();
      }
    };
  }

  await boot();
}
