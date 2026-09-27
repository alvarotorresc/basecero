import { getOpenPeriod, spentByDayAndRootCategory, listByDay, allCategoriesById, getMetaAll, recentTxDates } from "../repo.js";
import {
  weekRange, daysWithCategories, maxDayPositive, dayPositiveCents, weekTotals, categoryTotals, movementsOfDay,
  rangeLabelParts,
} from "../semana-logic.js";
import { familyForCategory, iconForCategory, famClass } from "../category-colors.js";
import { fmtMoney, fmtMoneyParts, moneyPartsHtml, fmtDiaIni, hoyISO } from "../format.js";
import { t, monthLong } from "../i18n/index.js";
import { userMessage } from "../errors.js";
import { openTxDetail } from "../open-tx.js";
import { subHeaderHtml, sharedNoteHtml } from "../ui.js";
import { displayHtml, dispInkHtml, columnsHtml, meterHtml, containerHtml, emptyStateHtml } from "../instrument.js";
import { txRowHtml } from "../entity.js";

import { escHtml, escAttr } from "../esc.js";

const dayNum = (iso) => new Date(iso + "T12:00:00").getDate();
// Nombre largo del día de semana vía i18n.weekdaysLong (mismo índice 0=domingo que getDay()).
const weekdayLong = (iso) => t("i18n.weekdaysLong." + new Date(iso + "T12:00:00").getDay());
const capitalize = (s) => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s);
/** «domingo 13» (con mayúscula inicial si abre la frase: «Martes 8»). */
const dayName = (iso) => t("semana.day.name", { weekday: weekdayLong(iso), day: dayNum(iso) });
/** Cifra de la columna elegida SIN símbolo de moneda (B-Semana: «168,90»): con él no cabe en 1/7
 *  del ancho. main+cents de fmtMoneyParts, así no se reimplementa el locale. */
const bareAmount = (cents) => { const p = fmtMoneyParts(cents); return p.main + p.cents; };

/** Fila de movimiento del día elegido (entity.js#txRowHtml, B-Semana): SIEMPRE un botón — toda
 *  fila abre el detalle (decisión 12/§7). Importe en valor absoluto; el signo va por `sign`. */
function movRowHtml(r, byId, partnerName) {
  if (r.type === "adjustment") {
    // Sin familia (C11) y con un icono de UI: el ajuste no es una categoría.
    return txRowHtml({
      fam: null, icon: "pencil", title: t("common.type.adjustment"), line2: r.merchant || r.note || "",
      amountHtml: moneyPartsHtml(Math.abs(r.amount_cents)), sign: r.amount_cents < 0 ? "expense" : "income",
      data: { tx: r.id }, amountWeight: 500,
    });
  }
  const cat = r.category_id ? byId[r.category_id] : null;
  const parent = cat?.parent_id ? byId[cat.parent_id] : null;
  const path = !cat ? t("semana.uncategorized") : parent ? `${parent.name} › ${cat.name}` : cat.name;
  const isExpense = r.type === "expense";
  // C9: los ingresos y «sin categoría» van sin familia (--well, icono en tinta). Una devolución
  // lleva la familia de su categoría de gasto, como en Movimientos e Inicio.
  const fam = (isExpense || r.type === "refund") && cat ? familyForCategory(r.category_id, byId) : null;
  return txRowHtml({
    fam, icon: cat ? iconForCategory(r.category_id, byId) : (isExpense ? "otr" : ""),
    title: r.merchant || cat?.name || t("semana.uncategorized"), line2: path,
    // Compartido: MI parte, con la nota de Movimientos debajo («con Marta, de 24,00» / «pagó Marta»).
    amountHtml: moneyPartsHtml(Math.abs(r.is_shared ? r.my_amount_cents : r.amount_cents)), sign: isExpense ? "expense" : "income",
    amountNoteHtml: sharedNoteHtml(r, partnerName),
    data: { tx: r.id },
    // B-Semana: cifra 500 (F-34 retirada, Álvaro 2026-09-27); el alto de 56 lo pone screens.css.
    amountWeight: 500,
  });
}

/** Pantalla «Semana» (B-Semana): Display con el total y la media, columnas apiladas por familia
 *  de los 7 días de semana-logic.js con los días pulsables debajo, el día elegido con sus
 *  movimientos y «Dónde se ha ido» como medidores con nombre (la leyenda de las columnas, C12).
 *  Misma firma que renderGastoPorCategoria (load/render/wire + el mismo tratamiento de error y de
 *  periodo cerrado en otra pestaña).
 *  `openDay`: el día que hay que dejar elegido al pintar, en vez de hoyISO() — lo usa el onBack de
 *  abrir un detalle para que volver de un movimiento no cambie el día que el usuario miraba. */
export async function renderSemana(container, onBack, { openDay } = {}) {
  const state = { day: openDay ?? hoyISO(), focusDay: false };
  let days = [];
  let total = { totalCents: 0, avgCents: 0 };
  let chips = [];
  let movsByDate = new Map();
  let byId = {};
  let partnerName = "";
  let rangeLabel = "";
  let hasHistory = false;

  async function load() {
    const period = await getOpenPeriod();
    if (!period) return false;
    // MISMA ventana que usa Inicio (semana-logic.js#weekRange): las dos pantallas no pueden leer
    // fechas distintas.
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
    // abierto de un usuario que nunca ha apuntado nada.
    hasHistory = recentDates.length > 0;
    const parts = rangeLabelParts(week.start, week.end);
    rangeLabel = parts.sameMonth
      ? t("semana.range.sameMonth", { from: parts.fromDay, to: parts.toDay, month: monthLong(parts.fromMonth) })
      : t("semana.range.crossMonth", { from: parts.fromDay, fromMonth: monthLong(parts.fromMonth), to: parts.toDay, toMonth: monthLong(parts.toMonth) });
    // Un día elegido fuera de la ventana (volver de un detalle al día siguiente) cae en hoy.
    if (!days.some((d) => d.date === state.day)) state.day = days[days.length - 1]?.date ?? hoyISO();
    return true;
  }

  const rootName = (rootId) => (rootId ? byId[rootId]?.name : "") || t("semana.uncategorized");
  const rootFam = (rootId) => (rootId ? familyForCategory(rootId, byId) : null);

  /** Columnas apiladas (instrument.js#columnsHtml con `segments`) + línea discontinua de la media +
   *  los 7 días pulsables. La columna elegida lleva su cifra encima y se hunde en un pozo. */
  function chartHtml() {
    const max = maxDayPositive(days);
    const cols = days.map((d) => {
      const selected = d.date === state.day;
      const positive = dayPositiveCents(d);
      return {
        label: fmtDiaIni(d.date),
        name: dayName(d.date),
        value: positive,
        selected,
        amount: selected && d.totalCents > 0 ? bareAmount(d.totalCents) : "",
        segments: d.segments.map((s) => ({ fam: rootFam(s.rootId), value: s.cents, name: rootName(s.rootId) })),
      };
    });
    // La media se dibuja a la misma escala que las columnas (tope 76 % de columnsHtml).
    const avgAt = max > 0 && total.avgCents > 0 ? Math.min(76, Math.round((total.avgCents / max) * 76)) : 0;
    const today = hoyISO();
    const dayBtns = days.map((d) => {
      const selected = d.date === state.day;
      const name = capitalize(dayName(d.date));
      const amount = fmtMoney(d.totalCents);
      const aria = d.date === today ? t("semana.day.ariaToday", { day: name, amount }) : t("semana.day.aria", { day: name, amount });
      return `<button type="button" class="sem-daybtn" data-day="${escAttr(d.date)}" aria-pressed="${selected ? "true" : "false"}" aria-label="${escAttr(aria)}">`
        + `${escHtml(fmtDiaIni(d.date))}<span class="num">${dayNum(d.date)}</span></button>`;
    }).join("");
    return `
      <section class="sem-chart" aria-label="${escAttr(t("semana.chart.label"))}">
        <div class="sem-plot"${avgAt ? ` style="--avg:${avgAt}%"` : ""}>
          ${avgAt ? `<span class="sem-avg-line" aria-hidden="true"></span><span class="sem-avg-label" aria-hidden="true">${escHtml(t("semana.chart.avg"))}</span>` : ""}
          ${columnsHtml(cols, { label: t("semana.chart.label"), labels: false })}
        </div>
        <div class="sem-days">${dayBtns}</div>
      </section>`;
  }

  /** Tarjeta del día elegido, con la muesca apuntando a su columna (--i = índice del día). */
  function dayCardHtml() {
    const i = Math.max(0, days.findIndex((d) => d.date === state.day));
    const day = days[i];
    const movs = movsByDate.get(day.date) ?? [];
    const name = dayName(day.date);
    const title = day.date === hoyISO() ? t("semana.day.today", { day: name }) : capitalize(name);
    const rows = movs.map((r) => movRowHtml(r, byId, partnerName)).join('<div class="sem-day-div" aria-hidden="true"></div>');
    return `
      <section class="sem-day" style="--i:${i}">
        <span class="sem-day-notch" aria-hidden="true"></span>
        <div class="sem-day-head">
          <h2 class="sem-day-title">${escHtml(title)}</h2>
          ${movs.length ? `<span class="num sem-day-total">${escHtml(fmtMoney(day.totalCents))}</span>` : ""}
        </div>
        ${movs.length ? `<div class="sem-day-rows">${rows}</div>` : `<p class="sem-day-empty">${escHtml(t("semana.noSpend"))}</p>`}
      </section>`;
  }

  /** «Dónde se ha ido»: neto por raíz de la semana como medidores con nombre, relativos a la que
   *  más se llevó. Es la leyenda de las columnas apiladas: mismo color de familia y su nombre. La
   *  fila lleva la clase de su familia para que la pista del medidor vaya en su tinte (B-Semana;
   *  F-45 retirada, Álvaro 2026-09-27). */
  function whereHtml() {
    if (!chips.length) return "";
    const top = chips[0].cents;
    const body = `<div class="sem-where">${chips.map((c) => `
      <div class="sem-where-row${famClass(rootFam(c.rootId)) ? ` ${famClass(rootFam(c.rootId))}` : ""}">
        <div class="sem-where-head">
          <span class="sem-where-name">${escHtml(rootName(c.rootId))}</span>
          <span class="num sem-where-amt">${escHtml(fmtMoney(c.cents))}</span>
        </div>
        ${meterHtml({ fam: rootFam(c.rootId), value: c.cents, max: top })}
      </div>`).join("")}</div>`;
    return containerHtml({ title: t("semana.where.title"), body });
  }

  function render() {
    // Sin ningún movimiento en la ventana de 7 días de ESTE periodo se pinta igual el Display (a
    // cero) y las columnas vacías, y el estado vacío ocupa el sitio del día: `semana.emptyPeriod`
    // con historial en otro periodo, `semana.empty` para quien no ha apuntado nada nunca.
    const weekEmpty = [...movsByDate.values()].every((m) => m.length === 0);
    container.innerHTML = `
      <div class="sem">
        ${subHeaderHtml({ id: "semana-back", title: t("semana.title"), subtitle: rangeLabel })}
        ${displayHtml({
          label: t("semana.display.label"), value: fmtMoney(total.totalCents), size: "l",
          slot: `<div class="sem-avg"><span>${escHtml(t("semana.avgPerDay"))}</span>${dispInkHtml(fmtMoney(total.avgCents))}</div>`,
        })}
        ${chartHtml()}
        ${weekEmpty ? emptyStateHtml({ title: hasHistory ? t("semana.emptyPeriod") : t("semana.empty"), rows: 2 }) : dayCardHtml()}
        ${whereHtml()}
      </div>`;
    wire();
  }

  function wire() {
    container.querySelector("#semana-back").onclick = () => onBack();
    container.querySelectorAll("[data-day]").forEach((el) => {
      el.onclick = () => {
        state.day = el.dataset.day;
        state.focusDay = true;
        render();
      };
    });
    container.querySelectorAll("[data-tx]").forEach((el) => {
      el.onclick = () => openTxDetail(container, el.dataset.tx, () => renderSemana(container, onBack, { openDay: state.day }));
    });
    // K12: el innerHTML se lleva el foco al <body>; se devuelve al día que se acaba de pulsar.
    if (state.focusDay) {
      state.focusDay = false;
      container.querySelector(`[data-day="${state.day}"]`)?.focus();
    }
  }

  try {
    // load() a false = ya no hay periodo abierto: otra pestaña lo cerró mientras esta pantalla se
    // abría. Se sale a la pantalla anterior (mismo criterio que gasto-por-categoria.js#saveLimit).
    if (!(await load())) { onBack(); return; }
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso is-error">${t("semana.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }
  render();
}
