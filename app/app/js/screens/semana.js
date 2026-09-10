import { getOpenPeriod, spentByDayAndRootCategory, listByDay, allCategoriesById, getMetaAll, recentTxDates } from "../repo.js";
import {
  weekRange, daysWithCategories, maxDayTotal, weekTotals, categoryTotals, movementsOfDay,
  rangeLabelParts,
} from "../semana-logic.js";
import { colorForCategory, iconForCategory, DEFAULT_COLOR } from "../category-colors.js";
import { relativeWidth } from "../category-spend.js";
import { fmtMoney, moneyPartsHtml, fmtDiaCorto, hoyISO } from "../format.js";
import { t, monthLong } from "../i18n/index.js";
import { userMessage } from "../errors.js";
import { openTxDetail } from "../open-tx.js";
import { subHeaderHtml } from "../ui.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");

const chevronSvg = (open, color) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${open ? "M19 14.5 12 8l-7 6.5" : "M5 9.5 12 16l7-6.5"}"></path></svg>`;

// Nombre largo del día de semana vía i18n.weekdaysLong (mismo índice 0=domingo que getDay()).
const weekdayLong = (iso) => t("i18n.weekdaysLong." + new Date(iso + "T12:00:00").getDay());

/** Fila de movimiento dentro de un día desplegado (SISTEMA §4.4): mismo patrón visual que
 *  inicio.js#txRowHtml/movimientos.js#movRowHtml, pero SIEMPRE un <button> — aquí toda fila abre
 *  el detalle (decisión 12/§7), nunca hay una versión estática. */
function movRowHtml(r, byId, partnerName) {
  if (r.type === "adjustment") {
    const isNeg = r.amount_cents < 0;
    return `
    <button type="button" class="tx-row" data-tx="${escAttr(r.id)}" style="width:100%;text-align:left;background:none;border:0;padding:10px 0;cursor:pointer;-webkit-tap-highlight-color:transparent;">
      <div class="dotico" style="--cat:var(--surface-2);">⚖️</div>
      <div class="tx-body">
        <div class="tx-title">${t("common.type.adjustment")}</div>
        <div class="tx-sub">${escHtml(r.merchant || r.note || "")}</div>
      </div>
      <div class="tx-amount num ${isNeg ? "negative" : "positive"}">${isNeg ? "-" : "+"}${moneyPartsHtml(Math.abs(r.amount_cents))}</div>
    </button>`;
  }
  const catName = byId[r.category_id]?.name ?? "";
  const uncategorized = !r.category_id;
  const color = uncategorized ? DEFAULT_COLOR : colorForCategory(r.category_id, byId);
  const icon = uncategorized ? "▫️" : iconForCategory(r.category_id, byId);
  const title = r.merchant || catName || t("semana.uncategorized");
  const sub = uncategorized ? t("semana.uncategorized") : catName;
  const shareSuffix = !r.is_shared ? ""
    : r.paid_by === "partner"
      ? t("movimientos.row.partnerPaid", { name: partnerName || t("movimientos.shared.fallbackName"), amount: fmtMoney(r.my_amount_cents) })
      : t("common.myPartSuffix", { amount: fmtMoney(r.my_amount_cents) });
  const isExpense = r.type === "expense";
  const amountClass = isExpense ? "negative" : "positive";
  const sign = isExpense ? "-" : "+";
  return `
  <button type="button" class="tx-row" data-tx="${escAttr(r.id)}" style="width:100%;text-align:left;background:none;border:0;padding:10px 0;cursor:pointer;-webkit-tap-highlight-color:transparent;">
    <div class="dotico" style="--cat:${color};">${icon}</div>
    <div class="tx-body">
      <div class="tx-title">${escHtml(title)}</div>
      <div class="tx-sub">${escHtml(sub)}${escHtml(shareSuffix)}</div>
    </div>
    <div class="tx-amount num ${amountClass}">${sign}${moneyPartsHtml(r.amount_cents)}</div>
  </button>`;
}

function chipHtml(chip, byId) {
  const catName = chip.rootId ? (byId[chip.rootId]?.name ?? "") : t("semana.uncategorized");
  const color = chip.rootId ? colorForCategory(chip.rootId, byId) : DEFAULT_COLOR;
  const icon = chip.rootId ? iconForCategory(chip.rootId, byId) : "▫️";
  return `
    <div class="week-chip" style="--cat:${color};">
      <span>${icon}</span>
      <span>${escHtml(catName)}</span>
      <span class="num">${escHtml(fmtMoney(chip.cents))}</span>
    </div>`;
}

/** Pantalla «Semana»: línea de tiempo día a día de la ventana de 7 días de semana-logic.js, con el
 *  día de hoy abierto por defecto y un acordeón de uno (Semana.dc.html). Misma firma que
 *  renderGastoPorCategoria (load/render/wire + el mismo tratamiento de error y de periodo cerrado
 *  en otra pestaña) — ver spec §8 y el patrón real en gasto-por-categoria.js.
 *  `openDay` (revisión de código): el día que hay que dejar desplegado al pintar, en vez de
 *  hoyISO() por defecto — lo usa el onBack de abrir un detalle (más abajo) para que volver de un
 *  movimiento no cierre el día que el usuario tenía abierto. */
export async function renderSemana(container, onBack, { openDay } = {}) {
  const state = { open: openDay ?? hoyISO() };
  let period = null;
  let days = [];
  let total = { totalCents: 0, avgCents: 0 };
  let chips = [];
  let movsByDate = new Map();
  let byId = {};
  let partnerName = "";
  let rangeLabel = "";
  let hasHistory = false;

  async function load() {
    period = await getOpenPeriod();
    if (!period) return false;
    // MISMA ventana que usa Inicio (semana-logic.js#weekRange): la espina de las dos pantallas no
    // puede leer fechas distintas.
    const week = weekRange(hoyISO());
    const [rootRows, rows, cats, meta, recentDates] = await Promise.all([
      spentByDayAndRootCategory(period.id, week.start, week.end),
      listByDay(period.id),
      allCategoriesById(),
      getMetaAll(),
      recentTxDates(),
    ]);
    days = daysWithCategories(rootRows, week.dates);
    total = weekTotals(days);
    chips = categoryTotals(rootRows);
    movsByDate = new Map(days.map((d) => [d.date, movementsOfDay(rows, d.date)]));
    byId = cats;
    partnerName = (meta.partner_name || "").trim();
    // SIN filtro de periodo (mismo criterio que inicio.js#hasHistory): distingue un periodo recién
    // abierto de un usuario que nunca ha apuntado nada, para no repetir aquí el "empty" genérico.
    hasHistory = recentDates.length > 0;
    const parts = rangeLabelParts(week.start, week.end);
    rangeLabel = parts.sameMonth
      ? t("semana.range.sameMonth", { from: parts.fromDay, to: parts.toDay, month: monthLong(parts.fromMonth) })
      : t("semana.range.crossMonth", { from: parts.fromDay, fromMonth: monthLong(parts.fromMonth), to: parts.toDay, toMonth: monthLong(parts.toMonth) });
    return true;
  }

  function dayRowHtml(day, isLast) {
    const hoy = day.date === hoyISO();
    const dayMovs = movsByDate.get(day.date) ?? [];
    const hasMovs = dayMovs.length > 0;
    const hasBar = day.segments.length > 0;
    const isOpen = state.open === day.date;
    const max = maxDayTotal(days);

    const nodeStyle = hoy
      ? "width:12px;height:12px;background:var(--accent);box-shadow:0 0 0 4px var(--accent-tint);"
      : hasBar
        ? `width:10px;height:10px;background:${colorForCategory(day.dominantRootId || "", byId)};`
        : "width:8px;height:8px;background:var(--bg);border:1px solid var(--hairline-strong);box-sizing:border-box;";
    const railHtml = `
      <div class="spine-rail">
        <div class="spine-line"${isLast && !isOpen ? ' style="height:50%;"' : ""}></div>
        <div class="spine-node" style="${nodeStyle}"></div>
      </div>`;
    const dayNameHtml = `
      <span class="week-day-name" style="font-size:14px;font-weight:${hoy ? "600" : "500"};color:${hoy ? "var(--accent)" : (hasMovs ? "var(--ink)" : "var(--ink-3)")};">${hoy ? t("semana.today") : escHtml(weekdayLong(day.date))}</span>
      <span class="num" style="font-size:12px;font-weight:500;color:var(--ink-3);">${escHtml(fmtDiaCorto(day.date))}</span>`;

    // Día sin NINGÚN movimiento: no se despliega, sin barra — «sin gastos» (decisión de la spec).
    if (!hasMovs) {
      return `
      <div class="spine-row" style="min-height:52px;">
        ${railHtml}
        <div style="flex:1;min-width:0;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;">
          <div style="display:flex;align-items:baseline;gap:9px;">${dayNameHtml}</div>
          <span style="font-size:13px;font-weight:500;color:var(--ink-3);">${t("semana.noSpend")}</span>
        </div>
      </div>`;
    }

    const barHtml = hasBar ? `
      <div class="day-bar">
        ${day.segments.map((seg) => `<div class="day-seg" style="width:${relativeWidth(seg.cents, max)}%;--cat:${colorForCategory(seg.rootId || "", byId)};"></div>`).join("")}
      </div>` : "";
    const amountHtml = `<span class="num" style="font-size:15px;font-weight:${hoy ? "600" : "500"};color:var(--ink);">${escHtml(fmtMoney(day.totalCents))}</span>`;

    // Un día con movimientos SIEMPRE se puede abrir, aunque su neto categorizado sea 0 o negativo
    // (más devuelto que gastado): esconder ese movimiento sería peor que la asimetría con la barra
    // (decisión 11 de la spec).
    const nestedHtml = isOpen ? `
      <div class="spine-row">
        <div class="spine-rail"><div class="spine-line" style="height:100%;"></div></div>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;">
          ${dayMovs.map((r) => movRowHtml(r, byId, partnerName)).join("")}
        </div>
      </div>` : "";

    return `
      <button type="button" class="spine-row" data-day="${escAttr(day.date)}" style="min-height:52px;width:100%;text-align:left;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;">
        ${railHtml}
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:7px;padding:12px 0;">
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
            <div style="display:flex;align-items:baseline;gap:9px;">${dayNameHtml}</div>
            <div style="display:flex;align-items:center;gap:10px;">${amountHtml}${chevronSvg(isOpen, hoy ? "var(--accent)" : "var(--ink-3)")}</div>
          </div>
          ${barHtml}
        </div>
      </button>
      ${nestedHtml}`;
  }

  function render() {
    // Sin ningún movimiento en la ventana de 7 días de ESTE periodo (día 1-2 de un periodo nuevo
    // incluido): antes esto colapsaba la pantalla entera al banner de vacío, perdiendo la espina,
    // el total y la media aunque hubiera historial de periodos anteriores. Ahora se pinta SIEMPRE
    // el bloque completo (con ceros — cada día sin movimientos ya se pinta "sin gastos" vía
    // dayRowHtml, y sin gasto categorizado los chips simplemente no aparecen) y el banner se añade
    // ENCIMA solo para explicar el porqué: `semana.emptyPeriod` con historial en otro periodo,
    // `semana.empty` (el genérico de siempre) para quien no ha apuntado nada nunca.
    const weekEmpty = [...movsByDate.values()].every((m) => m.length === 0);
    const emptyMsg = hasHistory ? t("semana.emptyPeriod") : t("semana.empty");
    container.innerHTML = `
      ${subHeaderHtml({ id: "semana-back", title: t("semana.title") })}

      ${weekEmpty ? `<div class="banner-aviso" style="margin-bottom:20px;">${emptyMsg}</div>` : ""}

      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:26px;">
        <div style="display:flex;flex-direction:column;gap:5px;">
          <span style="font-size:13px;font-weight:500;color:var(--ink-3);">${rangeLabel}</span>
          <div class="num" style="font:var(--t-figure-xl);letter-spacing:-.015em;">${moneyPartsHtml(total.totalCents)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;padding-bottom:2px;">
          <span style="font-size:12px;font-weight:500;color:var(--ink-3);">${t("semana.avgPerDay")}</span>
          <span class="num" style="font-size:15px;font-weight:600;">${escHtml(fmtMoney(total.avgCents))}</span>
        </div>
      </div>

      <div class="spine">
        ${days.map((d, i) => dayRowHtml(d, i === days.length - 1)).join("")}
      </div>

      ${chips.length > 0 ? `
      <div style="margin:30px 0 12px 0;">
        <span style="font-size:15px;font-weight:600;color:var(--ink);">${t("semana.where.title")}</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${chips.map((c) => chipHtml(c, byId)).join("")}
      </div>` : ""}
    `;
    wire();
  }

  function wire() {
    container.querySelector("#semana-back").onclick = () => onBack();
    container.querySelectorAll("[data-day]").forEach((el) => {
      el.onclick = () => {
        state.open = state.open === el.dataset.day ? null : el.dataset.day;
        render();
      };
    });
    container.querySelectorAll("[data-tx]").forEach((el) => {
      el.onclick = () => openTxDetail(container, el.dataset.tx, () => renderSemana(container, onBack, { openDay: state.open }));
    });
  }

  try {
    // load() a false = ya no hay periodo abierto: otra pestaña lo cerró mientras esta pantalla se
    // abría. Se sale a la pantalla anterior (mismo criterio que gasto-por-categoria.js#saveLimit).
    if (!(await load())) { onBack(); return; }
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">${t("semana.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }
  render();
}
