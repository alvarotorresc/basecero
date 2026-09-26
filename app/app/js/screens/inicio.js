import {
  getOpenPeriod, spentOfPeriod, incomeOfPeriod, listByDay, allCategoriesById,
  pendingSettlements, pendingSettlementNetCents, budgetsOfPeriod, previsionOfPeriod,
  spentByRootCategory, balancesAt, spentByDayAndRootCategory, recentTxDates,
  getMetaAll, setMeta, hasSharedData, listRules, getSnoozedRenewals, snoozeRenewal, listGoals,
} from "../repo.js";
import { renewalNotice } from "../subscriptions.js";
import { familyForCategory, iconForCategory, famClass } from "../category-colors.js";
import { familyForAccount, parseAccountStyle } from "../account-colors.js";
import { fmtMoney, fmtMoneyParts, moneyPartsHtml, fmtDiaCorto, fmtDiaIni, hoyISO, fmtPct0, prevDayIso } from "../format.js";
import { dayIndexOfPeriod, expectedPeriodDays } from "../prevision.js";
import {
  nextAccountId, daysLeftOfPeriod, dailyAllowanceCents, daysSinceLastEntry, huchaMessage,
  foldedMovements, groupByDay, savingsSentence, remainingAfterRecurringCents,
  periodRemainingSeries, topCategoriesWithRest,
} from "../inicio-logic.js";
import { weekRange, weekDates, daysWithCategories, weekTotals } from "../semana-logic.js";
import { resolveAccountId } from "../account-defaults.js";
import { icon } from "../icons.js";
import { t } from "../i18n/index.js";
import { budgetMap, pctOf } from "../category-spend.js";
import { rootHeaderHtml, buttonHtml } from "../ui.js";
import { fieldHtml } from "../controls.js";
import { tileHtml, txRowHtml, dayHeaderHtml } from "../entity.js";
import {
  displayHtml, dispInkHtml, bentoHtml, containerHtml, stackedBarHtml, columnsHtml, emptyStateHtml,
} from "../instrument.js";
import { periodChartSvg } from "../charts.js";
import { renderLiquidar } from "./liquidar.js";
import { renderPeriodoNuevo } from "./periodo-nuevo.js";
import { renderGastoPorCategoria } from "./gasto-por-categoria.js";
import { renderRecurrentes } from "./recurrentes.js";
import { renderSuscripciones } from "./suscripciones.js";
import { renderRegistro } from "./registro.js";
import { renderSemana } from "./semana.js";
import { renderInforme } from "./informe.js";
import { pushBack, goBack } from "../back.js";
import { openTxDetail } from "../open-tx.js";
import { goToTab } from "../tabs.js";
import { userMessage } from "../errors.js";
import { showToast } from "../toast.js";
import { skeletonHtml } from "../skeleton.js";
import { escHtml, escAttr } from "../esc.js";

// Pantalla Inicio en el sistema B (S1; DESIGN.md §9, mockups B-Home / BD-Home y B-Inicio-Vacio /
// BD-Inicio-Vacio). Todo el color y la forma van por clase: los componentes (ui.js, entity.js,
// instrument.js, charts.js) y la sección «inicio» de css/screens.css. En línea no queda nada.
//
// Tres modos, según lo que haya:
//  - con datos y límites: Display «Hoy puedes gastar» + bloque de la cuenta con su familia;
//  - sin ningún movimiento todavía (B-Inicio-Vacio): el Display enseña el saldo de la cuenta, la
//    semana en filas de pozo y «Últimos movimientos» en estado vacío con la flecha al añadir;
//  - con movimientos pero sin límites (sin mockup): el mismo Display de saldo del vacío, porque
//    «Hoy puedes gastar» no se puede calcular sin presupuesto.
// Cada bloque que navega es un contenedor con un <button> encima que lo cubre entero
// (.inicio-tap + .inicio-overlay): un único elemento enfocable con nombre, y nada interactivo
// anidado dentro de otro.

// Cuántas categorías raíz van con nombre en la barra apilada; el resto se suma en «Resto» (C11).
const INICIO_TOP_CATEGORIES = 5;

// Cuenta elegida en el bloque de la cuenta (decisión 3 de la spec de Inicio v2): vive a nivel de
// MÓDULO porque renderInicio se re-ejecuta en cada vuelta de subpantalla y un `let` local la
// perdería. Se valida contra las cuentas vivas en cada render.
let selectedAccountId = null;

// «Ahora no» del aviso dura la sesión (decisión 16): mismo criterio de módulo.
const huchaDismissed = new Set();

/** Importe sin símbolo de moneda («168,90»): la cifra 12/600 sobre la columna de hoy (B-Home). */
function plainAmount(cents) {
  const { main, cents: c } = fmtMoneyParts(cents);
  return `${main}${c}`.trim();
}

const weekdayShort = (iso) => t(`inicio.b.weekdayShort.${new Date(iso + "T12:00:00").getDay()}`);
const dayNumber = (iso) => new Date(iso + "T12:00:00").getDate();

/** Botón que cubre un bloque entero (.inicio-tap): el nombre accesible es la acción. `inner` es
 *  HTML de confianza (un chevron, como mucho). */
function overlayHtml(id, label, inner = "") {
  return `<button type="button" class="inicio-overlay" id="${escAttr(id)}" aria-label="${escAttr(label)}">${inner}</button>`;
}

/** Banner de migración de una sola vez (PR C, Task 5): BD con compartidos de antes de la
 *  contraparte configurable (partner_name vacío pero hasSharedData()). Sin nombre, el bloque de
 *  compartidos se oculta y este banner es la única forma de recuperarlo. */
function partnerBannerHtml() {
  const body = `<p class="inicio-help">${escHtml(t("inicio.partnerBanner.body"))}</p>
    ${fieldHtml({ id: "partner-banner-input", label: t("inicio.partnerBanner.namePlaceholder") })}
    ${buttonHtml({ kind: "primary", id: "partner-banner-save", label: t("common.save") })}
    <div id="partner-banner-error" class="banner-aviso is-error" hidden></div>`;
  return `<div class="inicio-partner">${containerHtml({ title: t("inicio.partnerBanner.title"), body })}</div>`;
}

/** Display «Hoy puedes gastar» (B-Home, C2): la cifra que manda en ámbar, el pie «Quedan X de Y»
 *  con X en --disp-ink (F-13), el LED «Periodo abierto» y la línea del periodo con el punto de hoy.
 *  Sin margen (lo comprometido se come lo que queda) la cifra es 0,00 €, como antes. */
function allowanceDisplayHtml({ budgetTotal, disponible, allowance, series, days, today }) {
  const budget = escHtml(fmtMoney(budgetTotal));
  const footHtml = disponible >= 0
    ? t("inicio.b.left", { amount: dispInkHtml(fmtMoney(disponible)), budget })
    : t("inicio.b.over", { amount: dispInkHtml(fmtMoney(-disponible)), budget });
  return displayHtml({
    label: t("inicio.available.today"),
    value: fmtMoney(Math.max(0, allowance)),
    size: "xl",
    footHtml,
    led: { state: "ok", text: t("inicio.b.led") },
    slot: periodChartSvg({
      days, today, values: series, max: budgetTotal,
      todayLabel: t("inicio.b.todayMark"), endLabel: t("inicio.b.endMark", { n: days }),
    }),
  });
}

/** Bloque de la cuenta (PR-10, C8): la cuenta con el tinte de SU familia (familyForAccount). Con
 *  varias cuentas, el bloque entero es un botón que pasa a la siguiente (decisiones 1-3 de la spec
 *  de Inicio v2), con el chevron como pista. Dos formas:
 *   - "bento" (junto a «Hoy puedes gastar», B-Home): bento teñido, cifra 20/600 en tinta (C7);
 *   - "display" (vacío y sin límites, B-Inicio-Vacio): el saldo es la cifra del Display. */
function accountBlockHtml(acc, { form, cuentas, styleMap, goals, empty, days, today }) {
  const many = cuentas.length > 1;
  const overlay = many
    ? overlayHtml("inicio-cuenta", t("inicio.b.switchAccount", { name: acc.name }),
      form === "bento" ? `<span class="inicio-chev">${icon("chevronDown", { size: 16 })}</span>` : "")
    : "";
  // En el Display el LED ocupa la esquina: el chevron va pegado a la etiqueta.
  const labelAfter = many && form !== "bento"
    ? `<span class="inicio-chev" aria-hidden="true">${icon("chevronDown", { size: 16 })}</span>`
    : "";
  const block = form === "bento"
    ? bentoHtml({
      cls: acc.balance_cents < 0 ? "inicio-account-neg" : "",
      label: acc.name,
      value: fmtMoney(acc.balance_cents),
      foot: t("inicio.b.balanceToday"),
      fam: familyForAccount(acc, styleMap, goals),
      iconHtml: icon("card", { size: 18 }),
    })
    : displayHtml({
      label: acc.name,
      labelAfter,
      value: fmtMoney(acc.balance_cents),
      size: "xl",
      foot: t(empty ? "inicio.b.balanceStart" : "inicio.b.balanceToday"),
      led: { state: "ok", text: t("inicio.b.led") },
      slot: periodChartSvg({ days, today, todayLabel: t("inicio.b.todayMark"), endLabel: t("inicio.b.endMark", { n: days }) }),
    });
  return `<div class="inicio-account${many ? " inicio-tap" : ""}" id="inicio-cuenta-block">${block}${overlay}</div>`;
}

/** Bloque de compartidos (B-Home, F-25): quién debe a quién y el neto de TODOS los periodos, con el
 *  secundario S «Liquidar». La cifra va en tinta: el signo lo dice la etiqueta, no el color (C4).
 *  Oculto sin contraparte o sin nada pendiente, como antes. */
function sharedBlockHtml(sharedRows, netCents, partnerName) {
  if (!partnerName || (sharedRows.length === 0 && netCents === 0)) return "";
  const labelKey = netCents > 0 ? "common.settlement.theyOwe" : netCents < 0 ? "common.settlement.youOwe" : "common.settlement.even";
  return bentoHtml({
    label: t(labelKey, { name: partnerName }),
    value: fmtMoney(Math.abs(netCents)),
    cls: "inicio-shared",
    slot: buttonHtml({ kind: "secondary", size: "s", id: "shared-liquidar", label: t("common.settle"), icon: "check" }),
  });
}

/** «Esta semana» (B-Home): columnas en --idle y hoy en tinta con su cifra encima (columnsHtml).
 *  Los 7 días que terminan hoy (semana-logic.js, la misma ventana que la pantalla Semana). Sin
 *  gasto en toda la semana, las columnas son filas de pozo (B-Inicio-Vacio). El bloque entero
 *  abre Semana. */
function weekBlockHtml(days, total, hoy) {
  const cols = columnsHtml(days.map((d) => {
    const today = d.date === hoy;
    return {
      label: fmtDiaIni(d.date),
      name: `${t(`i18n.weekdaysLong.${new Date(d.date + "T12:00:00").getDay()}`)} ${dayNumber(d.date)}`,
      value: Math.max(0, d.totalCents),
      today,
      amount: today && d.totalCents > 0 ? plainAmount(d.totalCents) : "",
    };
  }), { label: t("inicio.week.title") });
  const body = `<div class="inicio-week-head"><h2 class="inicio-label">${escHtml(t("inicio.week.title"))}</h2>`
    + `<span class="num inicio-week-total">${escHtml(fmtMoney(total.totalCents))}</span></div>${cols}`;
  const zero = days.every((d) => d.totalCents <= 0);
  return `<div class="inicio-week inicio-tap${zero ? " is-zero" : ""}">${containerHtml({ body })}${overlayHtml("inicio-semana", t("inicio.week.viewAll"))}</div>`;
}

/** «Ahorras 47 %» (B-Home, F-09, C11): bento neutro, la tasa en mono 20/600 en tinta y debajo lo
 *  ahorrado «de» lo ingresado. Sin ingresos o gastando de más no hay tasa que dar (savingsSentence):
 *  la cifra es «—» y lo ahorrado sale con su «−» en --neg (C4). El bloque entero abre el Informe. */
function savingsBlockHtml(income, spent, periodName) {
  const s = savingsSentence(income, spent);
  const ahorrado = income - spent;
  const slot = `<div class="inicio-savings-foot">
      <span class="num inicio-savings-amt${ahorrado < 0 ? " is-neg" : ""}${fmtMoney(ahorrado).length > 10 ? " is-long" : ""}">${escHtml(fmtMoney(ahorrado))}</span>
      <span class="inicio-savings-of">${escHtml(t("inicio.b.savingsOf", { amount: fmtMoney(income) }))}</span>
    </div>`;
  const value = s?.kind === "saves" ? fmtPct0(s.ratio) : "—";
  const bento = bentoHtml({
    label: t("inicio.b.savings"),
    value,
    // En la columna de 1/3 caben ~77 px: una cifra larga baja a 17 en vez de partirse.
    cls: `inicio-savings${value.length > 5 ? " is-long" : ""}`,
    slot,
  });
  return `<div class="inicio-tap">${bento}${overlayHtml("inicio-informe-link", t("informe.entry.fromHome", { name: periodName }))}</div>`;
}

/** El aviso (antes «la hucha», B-Home: «Gimnasio se renueva…»): una tarjeta de entidad con el tinte
 *  de la familia de su categoría cuando habla de una (renovación, límite) y neutra cuando no
 *  (días sin apuntar, fin de periodo; C11). huchaMessage (inicio-logic.js) sigue decidiendo cuál;
 *  las acciones son las de siempre: la suya (secundario S) y «Ahora no» (terciario). */
function noticeHtml(msg, { byId, rules, leftAfterRenewal }) {
  if (!msg) return "";
  let fam = null, iconKey = "otr", title, line2 = "", foot = "", actionLabel;
  if (msg.kind === "renewal") {
    const rule = rules.find((r) => r.id === msg.key.slice("renewal:".length));
    fam = rule ? familyForCategory(rule.category_id, byId) : null;
    iconKey = rule ? iconForCategory(rule.category_id, byId) : "sus";
    title = t("inicio.b.renewalTitle", { name: msg.params.name, date: fmtDiaCorto(msg.params.date) });
    line2 = `<span class="num inicio-notice-amt">${escHtml(fmtMoney(msg.params.amount))}</span> ${escHtml(t("inicio.b.renewalAsk"))}`;
    if (leftAfterRenewal != null) {
      foot = `<span class="inicio-notice-left">${t("inicio.b.afterPay", { amount: `<span class="num inicio-notice-amt">${escHtml(fmtMoney(leftAfterRenewal))}</span>` })}</span>`;
    }
    actionLabel = t("inicio.b.review");
  } else if (msg.kind === "limit") {
    fam = familyForCategory(msg.key.slice("limit:".length), byId);
    iconKey = iconForCategory(msg.key.slice("limit:".length), byId);
    title = t("inicio.hucha.limit", { name: msg.params.name, pct: `${msg.params.pct}\u00A0%` });
    actionLabel = t("inicio.hucha.action.limit");
  } else if (msg.kind === "idle") {
    iconKey = "pencil";
    title = t("inicio.hucha.idle", { n: msg.params.n });
    actionLabel = t("inicio.hucha.action.idle");
  } else {
    // periodEnd: n===0 es la variante «se cierra hoy» (periodo pasado de largo incluido).
    iconKey = "calendar";
    title = msg.params.n === 0 ? t("inicio.hucha.periodEndToday") : t("inicio.hucha.periodEnd", { n: msg.params.n });
    actionLabel = t("inicio.hucha.action.periodEnd");
  }
  const tinted = Boolean(famClass(fam));
  const tile = tileHtml({ fam, icon: iconKey, onTint: tinted });
  const cls = tinted ? `inicio-notice ${famClass(fam)}` : "inicio-notice is-neutral";
  return `<section class="${cls}">
    <div class="inicio-notice-top">${tile}<div class="inicio-notice-body">
      <span class="inicio-notice-title">${escHtml(title)}</span>
      ${line2 ? `<span class="inicio-notice-line2">${line2}</span>` : ""}
    </div></div>
    ${foot}
    <div class="inicio-notice-actions">
      ${buttonHtml({ kind: "tertiary", id: "inicio-hucha-dismiss", label: t("inicio.hucha.dismiss") })}
      ${buttonHtml({ kind: "secondary", size: "s", id: "inicio-hucha-action", label: actionLabel })}
    </div>
  </section>`;
}

/** «Gasto por categoría» (B-Home, C12, F-10): barra apilada grande con el nombre y el importe de
 *  cada una de las 5 raíces que más gastan y «Resto» en --idle. El bloque entero abre la pantalla
 *  Gasto por categoría. Sin gasto categorizado, una línea en su lugar. */
function categoriesBlockHtml(rootRows, byId) {
  const title = t("inicio.categorySpend.title");
  const { top, restCents, totalCents } = topCategoriesWithRest(rootRows, INICIO_TOP_CATEGORIES);
  let body;
  if (totalCents > 0) {
    const segs = top.map((r) => ({
      fam: familyForCategory(r.root_id, byId), value: r.spent_cents, name: r.name, amount: fmtMoney(r.spent_cents),
    }));
    if (restCents > 0) segs.push({ idle: true, value: restCents, name: t("inicio.b.rest"), amount: fmtMoney(restCents) });
    body = stackedBarHtml(segs, { label: title });
  } else {
    body = `<p class="inicio-help">${escHtml(t("inicio.categorySpend.empty"))}</p>`;
  }
  const box = containerHtml({ title, total: totalCents > 0 ? fmtMoney(totalCents) : "", body });
  return `<div class="inicio-tap">${box}${overlayHtml("inicio-categoria", title)}</div>`;
}

/** Fila de movimiento (B-Movimientos, §9): entity.js#txRowHtml con la familia de la categoría, la
 *  ruta «Raíz › Sub» en la línea 2 y el importe absoluto con su signo. Se conserva el sufijo de
 *  compartidos (un gasto que pagó la contraparte se anuncia) y la rama de los ajustes, que pueden
 *  ser negativos. Cada fila abre su detalle (data-tx). */
function movementRowHtml(r, byId, partnerName) {
  if (r.type === "adjustment") {
    const isNeg = r.amount_cents < 0;
    return txRowHtml({
      fam: null, icon: "pencil", title: t("common.type.adjustment"), line2: r.merchant || r.note || "",
      amountHtml: moneyPartsHtml(Math.abs(r.amount_cents)), sign: isNeg ? "expense" : "income", data: { tx: r.id },
    });
  }
  const cat = byId[r.category_id];
  const parent = cat?.parent_id ? byId[cat.parent_id] : null;
  const path = cat ? (parent ? `${parent.name} › ${cat.name}` : cat.name) : "";
  const shareNote = !r.is_shared ? ""
    : r.paid_by === "partner"
      ? t("movimientos.row.partnerPaid", { name: partnerName || t("movimientos.shared.fallbackName"), amount: fmtMoney(r.my_amount_cents) })
      : t("common.myPartSuffix", { amount: fmtMoney(r.my_amount_cents) });
  return txRowHtml({
    fam: familyForCategory(r.category_id, byId),
    icon: iconForCategory(r.category_id, byId),
    // Sin comercio ni categoría, el mismo «Sin categorizar» que Movimientos: la fila nunca sin nombre.
    title: r.merchant || cat?.name || t("movimientos.uncategorized"),
    line2: path,
    amountHtml: moneyPartsHtml(Math.abs(r.amount_cents)),
    sign: r.type === "expense" ? "expense" : "income",
    // La nota de compartido va debajo de la cifra, como en Movimientos y Semana.
    amountNote: shareNote.replace(/^,\s*/, ""),
    data: { tx: r.id },
  });
}

/** Cabecera de día canónica (B-Home): «Hoy dom 13», «Ayer sáb 12»; más atrás, «vie 11». */
function dayHeaderFor(date, hoy) {
  const short = `${weekdayShort(date)} ${dayNumber(date)}`;
  if (date === hoy) return dayHeaderHtml({ label: t("common.today"), date: short });
  if (date === prevDayIso(hoy)) return dayHeaderHtml({ label: t("inicio.b.yesterday"), date: short });
  return dayHeaderHtml({ label: short });
}

/** «Últimos movimientos» (B-Home): los de hoy y, si son menos de 3, los siguientes más recientes,
 *  por día y con filas de 60. «Ver todos» lleva a la pestaña Movimientos. Un periodo nuevo sin
 *  movimientos (pero con historia) lo dice en una línea. */
function movementsBlockHtml(rows, hoy, byId, partnerName) {
  const aside = buttonHtml({ kind: "tertiary", id: "inicio-movimientos-ver", label: t("inicio.movements.viewAll") });
  const body = rows.length === 0
    ? `<p class="inicio-help inicio-list-help">${escHtml(t("inicio.movements.emptyPeriod"))}</p>`
    : groupByDay(foldedMovements(rows, hoy)).map((g) =>
      dayHeaderFor(g.date, hoy) + g.rows.map((r) => movementRowHtml(r, byId, partnerName)).join("")).join("");
  return `<div class="inicio-movements">${containerHtml({ title: t("inicio.b.lastMovements"), aside, body, kind: "list" })}</div>`;
}

/** «Últimos movimientos» sin ningún movimiento todavía (B-Inicio-Vacio): filas fantasma en pozo,
 *  el título, una línea y la flecha discontinua que baja hacia el botón de añadir. */
function emptyMovementsHtml() {
  const body = emptyStateHtml({ title: t("inicio.b.emptyTitle"), text: t("inicio.b.emptyText"), rows: 2, arrow: true });
  return `<div class="inicio-empty">${containerHtml({ title: t("inicio.b.lastMovements"), body })}</div>`;
}

/** «Queda por pagar» + «Te quedarán» (sin mockup en B; se conserva porque tiene comportamiento):
 *  una fila por recurrente pendiente que no sea ingreso, que abre Registro precargado
 *  (data-prevision-rule), y «Te quedarán» = remainingAfterRecurringCents(disponible, comprometido)
 *  si hay límites. «Recurrentes» abre la pantalla de recurrentes. Sin pendientes, nada. */
function pendingHtml(prevision, remaining, byId) {
  const pending = prevision.items.filter((it) => !it.paid && it.rule.type !== "income");
  // Sin pendientes no se pinta: «Te quedarán» sería el mismo «Quedan» del Display.
  if (pending.length === 0) return "";
  const rows = pending.map((it) => txRowHtml({
    fam: familyForCategory(it.rule.category_id, byId),
    icon: iconForCategory(it.rule.category_id, byId),
    title: it.rule.name,
    line2: byId[it.rule.category_id]?.name ?? "",
    amountHtml: moneyPartsHtml(it.myCents),
    data: { previsionRule: it.rule.id },
  })).join("");
  const left = remaining == null ? "" : `<div class="inicio-left-row">
      <span class="inicio-left-label">${escHtml(t("inicio.pending.left"))}</span>
      <span class="num inicio-left-amt${remaining < 0 ? " is-neg" : ""}">${escHtml(fmtMoney(remaining))}</span>
    </div>`;
  const aside = buttonHtml({ kind: "tertiary", id: "prevision-gestionar", label: t("inicio.prevision.manage") });
  return `<div class="inicio-pending">${containerHtml({ title: t("inicio.pending.title"), aside, body: rows + left, kind: "list" })}</div>`;
}

/** Pantalla Inicio (sistema B, S1). */
export async function renderInicio(container) {
  // Silueta gris mientras llega la primera consulta, solo en el PRIMER pintado (testigo
  // container.dataset.screen, que escriben solo esta pantalla y Movimientos).
  if (container.dataset.screen !== "inicio") {
    container.dataset.screen = "inicio";
    container.innerHTML = skeletonHtml([56, 210, 140, 150]);
  }
  const hoy = hoyISO();
  let period, spent, income, rows, byId, sharedRows, netCents, budgets, prevision, rootRows,
    cuentas, weekRootRows, recentDates, meta, partnerName, showPartnerBanner, rules, snoozedRenewals,
    goals, periodRootRows;
  try {
    period = await getOpenPeriod();
    if (!period) {
      container.innerHTML = `<div class="banner-aviso is-error">${t("common.noOpenPeriod")}</div>`;
      return;
    }
    // weekRange(hoy) da la MISMA ventana de 7 días que usa Semana (semana-logic.js).
    const week = weekRange(hoy);
    [spent, income, rows, byId, sharedRows, netCents, budgets, prevision, rootRows,
      cuentas, weekRootRows, recentDates, meta, rules, snoozedRenewals, goals, periodRootRows] = await Promise.all([
      spentOfPeriod(period.id),
      incomeOfPeriod(period.id),
      listByDay(period.id),
      allCategoriesById(),
      pendingSettlements(),
      pendingSettlementNetCents(),
      budgetsOfPeriod(period.id),
      previsionOfPeriod(period),
      spentByRootCategory(period.id),
      balancesAt(hoy),
      spentByDayAndRootCategory(period.id, week.start, week.end),
      recentTxDates(),
      getMetaAll(),
      listRules(),
      getSnoozedRenewals(),
      // La familia de una hucha sale de su objetivo (account-colors.js, D-impl-2).
      listGoals(),
      // La línea del Display: el gasto de cada día del periodo hasta hoy, con el mismo criterio
      // que spentOfPeriod (sql.js#spentByDayRootCategory).
      spentByDayAndRootCategory(period.id, period.start_date, hoy),
    ]);
    partnerName = (meta.partner_name || "").trim();
    // Sin nombre, se mira si hay compartidos «huérfanos» (Task 5).
    showPartnerBanner = !partnerName && await hasSharedData();
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso is-error">${t("inicio.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }

  const budgetByCategory = budgetMap(budgets);
  const budgetTotal = Object.values(budgetByCategory).reduce((s, c) => s + c, 0);
  const disponible = budgetTotal - spent;
  const days = expectedPeriodDays(period.start_date);
  const today = dayIndexOfPeriod(period.start_date, hoy);
  const daysLeft = daysLeftOfPeriod(period.start_date, hoy);
  const isEmpty = recentDates.length === 0;
  const allowanceMode = budgetTotal > 0;
  const styleMap = parseAccountStyle(meta.account_style);

  // -- Cuenta del bloque (decisiones 1-3): la elegida sobrevive a un repintado en la misma sesión;
  // si dejó de ser válida cae a la de meta.default_account_id, la misma que usa previsionOfPeriod.
  if (!(selectedAccountId && cuentas.some((a) => a.id === selectedAccountId))) {
    selectedAccountId = resolveAccountId(meta.default_account_id, cuentas);
  }
  const cuentaActual = cuentas.find((a) => a.id === selectedAccountId) ?? cuentas[0] ?? null;
  const accountOpts = { form: allowanceMode ? "bento" : "display", cuentas, styleMap, goals, empty: isEmpty, days, today };

  // -- El aviso (§8 de la spec de Inicio v2). La renovación sale del radar de suscripciones; si
  // «Queda por pagar» ya la da por pagada se descarta, y si no se usa su importe prorrateado
  // (myCents), el mismo que enseña esa lista.
  const notice = renewalNotice(rules, hoy, snoozedRenewals);
  const noticeItem = notice ? prevision.items.find((it) => it.rule.id === notice.ruleId) : null;
  const renewals = notice && !noticeItem?.paid
    ? [{ id: notice.ruleId, name: notice.name, amountCents: noticeItem ? noticeItem.myCents : notice.amountCents, dueDateIso: notice.dueIso }]
    : [];
  const huchaCategories = rootRows
    .filter((r) => (budgetByCategory[r.root_id] ?? 0) > 0)
    .map((r) => ({ id: r.root_id, name: r.name, pct: pctOf(r.spent_cents, budgetByCategory[r.root_id]) }));
  const hucha = huchaMessage({
    renewals,
    categories: huchaCategories,
    daysSinceLastEntry: daysSinceLastEntry(recentDates, hoy),
    daysLeftOfPeriod: daysLeft,
    todayIso: hoy,
    dismissed: huchaDismissed,
  });
  // «Tras pagarlo te quedarán» (B-Home): lo que queda del periodo menos ESA renovación. Sin
  // límites no hay «lo que queda».
  const leftAfterRenewal = hucha?.kind === "renewal" && budgetTotal > 0
    ? remainingAfterRecurringCents(disponible, hucha.params.amount) : null;

  // -- Esta semana: el MISMO constructor que usa la pantalla Semana.
  const semanaDias = daysWithCategories(weekRootRows, weekRange(hoy).dates);
  const semanaTotal = weekTotals(semanaDias);

  // -- La línea del Display: lo que queda al cerrar cada día del periodo hasta hoy.
  const periodDays = daysWithCategories(periodRootRows, weekDates(hoy, today));
  const series = periodRemainingSeries(budgetTotal, periodDays.map((d) => d.totalCents), spent);

  // -- «Te quedarán»: disponible menos lo comprometido en recurrentes (null sin límites).
  const remaining = budgetTotal ? remainingAfterRecurringCents(disponible, prevision.comprometidoCents) : null;

  const header = rootHeaderHtml({
    title: period.name,
    subtitle: t("inicio.b.sub", { day: today, total: days, n: Math.max(0, daysLeft) }),
    subtitleAction: { id: "inicio-periodo-header", label: t("periodo.header.title") },
  });
  const accountHtml = cuentaActual ? accountBlockHtml(cuentaActual, accountOpts) : "";
  const shared = sharedBlockHtml(sharedRows, netCents, partnerName);
  const noticeBlock = noticeHtml(hucha, { byId, rules, leftAfterRenewal });

  // Con límites, el Display es «Hoy puedes gastar» (también recién hecho el onboarding, sin
  // movimientos) y la cuenta va en su bento; sin límites, el saldo de la cuenta es el Display.
  // Sin ningún movimiento todavía, fuera Ahorras y Gasto por categoría, y los movimientos en
  // estado vacío (B-Inicio-Vacio).
  const displayBlock = allowanceMode
    ? allowanceDisplayHtml({
      budgetTotal, disponible, series, days, today,
      allowance: dailyAllowanceCents(disponible, prevision.comprometidoCents, period.start_date, hoy),
    })
    : accountHtml;
  const duo = (allowanceMode ? accountHtml : "") + shared;
  const body = `
      ${displayBlock}
      ${duo ? `<div class="inicio-duo">${duo}</div>` : ""}
      <div class="inicio-trio">${weekBlockHtml(semanaDias, semanaTotal, hoy)}${isEmpty ? "" : savingsBlockHtml(income, spent, period.name)}</div>
      ${noticeBlock}
      ${isEmpty ? "" : categoriesBlockHtml(rootRows, byId)}
      ${pendingHtml(prevision, remaining, byId)}
      ${isEmpty ? emptyMovementsHtml() : movementsBlockHtml(rows, hoy, byId, partnerName)}`;

  container.innerHTML = `<div class="inicio">
    ${header}
    ${showPartnerBanner ? partnerBannerHtml() : ""}
    ${body}
  </div>`;

  const partnerBannerSaveBtn = container.querySelector("#partner-banner-save");
  if (partnerBannerSaveBtn) partnerBannerSaveBtn.onclick = async () => {
    const input = container.querySelector("#partner-banner-input");
    const errEl = container.querySelector("#partner-banner-error");
    if (errEl) errEl.hidden = true;
    const value = (input.value || "").trim();
    if (!value) {
      partnerBannerSaveBtn.classList.add("shake");
      setTimeout(() => partnerBannerSaveBtn.classList.remove("shake"), 400);
      return;
    }
    partnerBannerSaveBtn.disabled = true;
    try {
      // partner_name va sin bcSanitizeCell a propósito: SheetJS exporta la celda como string (sin
      // riesgo de fórmula) y sanitizar ensuciaría el nombre en toda la UI («+Ana» → «'+Ana»).
      await setMeta("partner_name", value);
      showToast(t("toast.saved"));
      renderInicio(container);
    } catch (e) {
      partnerBannerSaveBtn.disabled = false;
      partnerBannerSaveBtn.classList.add("shake");
      setTimeout(() => partnerBannerSaveBtn.classList.remove("shake"), 400);
      if (errEl) {
        errEl.innerHTML = t("common.saveFailed", { error: escHtml(userMessage(e)) });
        errEl.hidden = false;
      }
    }
  };

  // Cambio de cuenta (decisión 3): se sustituye SOLO el bloque de la cuenta (su familia cambia con
  // ella) con los saldos que ya vinieron en la carga; nada de renderInicio(), que perdería el
  // scroll. El foco vuelve al botón nuevo.
  const wireAccount = () => {
    const btn = container.querySelector("#inicio-cuenta");
    if (!btn) return;
    btn.onclick = () => {
      selectedAccountId = nextAccountId(cuentas, selectedAccountId);
      const acc = cuentas.find((a) => a.id === selectedAccountId);
      const block = container.querySelector("#inicio-cuenta-block");
      if (!acc || !block) return;
      block.outerHTML = accountBlockHtml(acc, accountOpts);
      wireAccount();
      container.querySelector("#inicio-cuenta")?.focus();
    };
  };
  wireAccount();

  if (hucha) {
    const huchaDismissBtn = container.querySelector("#inicio-hucha-dismiss");
    huchaDismissBtn.onclick = async () => {
      // La renovación, además del descarte de sesión, silencia ESA fecha de verdad (persistida en
      // meta.renewal_snoozed), no solo hasta el próximo repintado (spec suscripciones §8).
      if (hucha.kind === "renewal") {
        huchaDismissBtn.disabled = true;
        try {
          await snoozeRenewal(hucha.key.slice("renewal:".length), hucha.params.date, hoy);
          showToast(t("toast.renewalSnoozed"));
        } catch {
          // Baja fricción, sin banner propio: se reintenta tocando otra vez.
          huchaDismissBtn.disabled = false;
          return;
        }
      }
      huchaDismissed.add(hucha.key);
      renderInicio(container);
    };
    container.querySelector("#inicio-hucha-action").onclick = () => {
      if (hucha.kind === "renewal") {
        pushBack(() => renderInicio(container));
        renderSuscripciones(container, goBack);
      } else if (hucha.kind === "limit") {
        pushBack(() => renderInicio(container));
        renderGastoPorCategoria(container, goBack);
      } else if (hucha.kind === "idle") {
        pushBack(() => renderInicio(container));
        renderRegistro(container, goBack, undefined, () => renderInicio(container));
      } else {
        document.body.classList.add("onboarding");
        pushBack(() => {
          document.body.classList.remove("onboarding");
          renderInicio(container);
        });
        renderPeriodoNuevo(container, { mode: "next", onDone: goBack });
      }
    };
  }

  // Cada fila de movimiento abre su detalle; cerrar, Guardar y Borrar vuelven a Inicio.
  container.querySelectorAll("[data-tx]").forEach((el) => {
    el.onclick = () => openTxDetail(container, el.dataset.tx, () => renderInicio(container));
  });

  const movimientosVerBtn = container.querySelector("#inicio-movimientos-ver");
  if (movimientosVerBtn) movimientosVerBtn.onclick = () => goToTab("movimientos");

  const semanaBtn = container.querySelector("#inicio-semana");
  if (semanaBtn) semanaBtn.onclick = () => {
    pushBack(() => renderInicio(container));
    renderSemana(container, goBack);
  };

  // Entrada al Informe del periodo desde «Ahorras» (Task 12 del plan 2026-09-10).
  const informeLink = container.querySelector("#inicio-informe-link");
  if (informeLink) informeLink.onclick = () => {
    pushBack(() => renderInicio(container));
    renderInforme(container, goBack);
  };

  const liquidarBtn = container.querySelector("#shared-liquidar");
  if (liquidarBtn) liquidarBtn.onclick = () => {
    pushBack(() => renderInicio(container));
    renderLiquidar(container, goBack);
  };

  const categoriaBtn = container.querySelector("#inicio-categoria");
  if (categoriaBtn) categoriaBtn.onclick = () => {
    pushBack(() => renderInicio(container));
    renderGastoPorCategoria(container, goBack);
  };

  const gestionarBtn = container.querySelector("#prevision-gestionar");
  if (gestionarBtn) gestionarBtn.onclick = () => {
    pushBack(() => renderInicio(container));
    renderRecurrentes(container, goBack);
  };

  container.querySelectorAll("[data-prevision-rule]").forEach((el) => {
    el.onclick = () => {
      const item = prevision.items.find((it) => it.rule.id === el.dataset.previsionRule);
      if (!item) return;
      const { rule } = item;
      pushBack(() => renderInicio(container));
      renderRegistro(container, goBack, {
        type: rule.type,
        amountCents: rule.amount_cents,
        categoryId: rule.category_id,
        accountId: rule.account_id,
        merchant: rule.name,
        ruleId: rule.id,
        isShared: !!rule.is_shared,
      }, () => renderInicio(container));
    };
  });

  container.querySelector("#inicio-periodo-header").onclick = () => {
    document.body.classList.add("onboarding");
    pushBack(() => {
      document.body.classList.remove("onboarding");
      renderInicio(container);
    });
    renderPeriodoNuevo(container, { mode: "next", onDone: goBack });
  };
}
