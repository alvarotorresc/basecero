import {
  getOpenPeriod, spentOfPeriod, incomeOfPeriod, listByDay, allCategoriesById,
  pendingSettlements, pendingSettlementNetCents, budgetsOfPeriod, previsionOfPeriod,
  spentByRootCategory, balancesAt, spentByDayAndRootCategory, recentTxDates,
  getMetaAll, setMeta, hasSharedData, listRules, getSnoozedRenewals, snoozeRenewal,
} from "../repo.js";
import { renewalNotice } from "../subscriptions.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtMoney, moneyPartsHtml, fmtDiaLargo, fmtDiaCorto, fmtDiaIni, hoyISO, fmtPct0 } from "../format.js";
import { dayIndexOfPeriod, expectedPeriodDays } from "../prevision.js";
import {
  nextAccountId, daysLeftOfPeriod, dailyAllowanceCents, streakDays,
  daysSinceLastEntry, huchaMessage, foldedMovements, groupByDay, savingsSentence,
  remainingAfterRecurringCents,
} from "../inicio-logic.js";
import { weekRange, daysWithCategories, maxDayTotal, weekTotals } from "../semana-logic.js";
import { resolveAccountId } from "../account-defaults.js";
import { t } from "../i18n/index.js";
import { budgetMap, pctOf, relativeWidth } from "../category-spend.js";
import { renderLiquidar } from "./liquidar.js";
import { renderPeriodoNuevo } from "./periodo-nuevo.js";
import { renderGastoPorCategoria } from "./gasto-por-categoria.js";
import { renderRecurrentes } from "./recurrentes.js";
import { renderSuscripciones } from "./suscripciones.js";
import { renderRegistro } from "./registro.js";
import { renderSemana } from "./semana.js";
import { pushBack, goBack } from "../back.js";
import { openTxDetail } from "../open-tx.js";
import { goToTab } from "../tabs.js";
import { userMessage } from "../errors.js";
import { showToast } from "../toast.js";
import { skeletonHtml } from "../skeleton.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
// Porcentaje entero con espacio duro antes del «%» — mismo patrón que gasto-por-categoria.js
// (fmtPctInt): sin el U+00A0 el «%» se parte en su propia línea al estrecharse el contenedor.
// `format.js#fmtPct0` (Task 10) hará esto mismo vía Intl; hasta entonces el porcentaje de la
// hucha ya llega redondeado desde inicio-logic.js#huchaMessage, así que basta con el sufijo.
const fmtPctInt = (pct) => `${pct} %`;

// Cuántas categorías raíz se listan en el bloque «Gasto por categoría» de Inicio (I3): 5 en el
// artboard, sin rueda y sin fila «Otras N» (a diferencia del v1, que agrupaba el resto en una).
const INICIO_TOP_CATEGORIES = 5;

// Cuenta elegida por el selector del héroe (decisión 3 de la spec): vive a nivel de MÓDULO, no del
// closure de renderInicio, porque esa función se re-ejecuta en cada vuelta de subpantalla y un
// `let` local perdería la cuenta elegida en cuanto se repintara. Se valida contra la lista de
// cuentas VIVAS en cada render (una cuenta borrada/archivada entre medias cae al valor por defecto).
let selectedAccountId = null;

// «Ahora no» de la hucha dura la sesión (decisión 16): mismo criterio de módulo que
// selectedAccountId — renderInicio se re-ejecuta en cada vuelta de subpantalla y un Set del
// closure perdería el descarte.
const huchaDismissed = new Set();

// SVG «chevron abajo»/«chevron derecha» del repertorio (SISTEMA §3).
const CHEVRON_DOWN_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9.5 12 16l7-6.5"></path></svg>`;
const CHEVRON_RIGHT_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 5 16 12l-6.5 7"></path></svg>`;

/** Fila de movimiento plegado (I4/I5, Main.dc.html:90-102): SIEMPRE un <button> de 64px que abre
 *  el detalle real vía open-tx.js — antes era un <div> estático. Se conserva ENTERA la rama de
 *  `type === "adjustment"` y el sufijo de compartidos (decisión 13: este bloque no es un
 *  contenedor tocable, cada fila navega por sí sola). */
function txRowHtml(r, byId, partnerName) {
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
  const cat = byId[r.category_id];
  const catName = cat?.name ?? "";
  const color = colorForCategory(r.category_id, byId);
  const icon = iconForCategory(r.category_id, byId);
  const title = r.merchant || catName;
  // Un gasto que pagó la contraparte se anuncia en el sub: sin esto, en la pantalla que más se
  // mira, se lee exactamente igual que uno mío. El importe sigue siendo el ticket entero en rojo
  // (la decisión del controlador sobre §12.3 atenúa el importe SOLO en Movimientos).
  const shareSuffix = !r.is_shared ? ""
    : r.paid_by === "partner"
      ? t("movimientos.row.partnerPaid", { name: partnerName || t("movimientos.shared.fallbackName"), amount: fmtMoney(r.my_amount_cents) })
      : t("common.myPartSuffix", { amount: fmtMoney(r.my_amount_cents) });
  const sub = catName + shareSuffix;
  const isExpense = r.type === "expense";
  const amountClass = isExpense ? "negative" : "positive";
  const sign = isExpense ? "-" : "+";

  return `
    <button type="button" class="tx-row" data-tx="${escAttr(r.id)}" style="width:100%;text-align:left;background:none;border:0;padding:10px 0;cursor:pointer;-webkit-tap-highlight-color:transparent;">
      <div class="dotico" style="--cat:${color};">${icon}</div>
      <div class="tx-body">
        <div class="tx-title">${escHtml(title)}</div>
        <div class="tx-sub">${escHtml(sub)}</div>
      </div>
      <div class="tx-amount num ${amountClass}">${sign}${moneyPartsHtml(r.amount_cents)}</div>
    </button>`;
}

/** Bloque de compartidos (Main.dc.html:311-321): neto pendiente con la contraparte, de TODOS los
 *  periodos, + «Liquidar». Pierde el badge de reparto y la línea del más antiguo que llevaba el
 *  v1 (Task 9: la pantalla ya no reparte protagonismo, es neto + acción). Se oculta entero sin
 *  partnerName configurado o sin nada pendiente — igual que antes. */
function sharedBlockHtml(sharedRows, netCents, partnerName) {
  if (!partnerName || (sharedRows.length === 0 && netCents === 0)) return "";
  const labelKey = netCents > 0 ? "common.settlement.theyOwe" : netCents < 0 ? "common.settlement.youOwe" : "common.settlement.even";
  const amountColor = netCents > 0 ? "var(--pos)" : netCents < 0 ? "var(--danger)" : "var(--ink)";
  return `
  <div style="display:flex;align-items:center;gap:14px;margin-top:var(--gap-section);">
    <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0;">
      <span style="font-size:13px;font-weight:500;color:var(--ink-3);">${t(labelKey, { name: escHtml(partnerName) })}</span>
      <div class="num" style="font:var(--t-figure-l);color:${amountColor};">${moneyPartsHtml(Math.abs(netCents))}</div>
    </div>
    <button type="button" id="shared-liquidar" class="btn-secondary" style="width:auto;flex-shrink:0;">${t("common.settle")}</button>
  </div>`;
}

/** Banner de migración de una sola vez (PR C, Task 5): se pinta sobre el resumen cuando la BD
 *  trae gastos/reglas compartidos de antes de la contraparte configurable (partner_name vacío
 *  pero hasSharedData() true) — sin nombre, sharedBlockHtml se oculta y este banner es la única
 *  forma de recuperarlo. Desaparece en cuanto se guarda un nombre (partner_name deja de estar
 *  vacío) y no vuelve a aparecer. */
function partnerBannerHtml() {
  return `
  <div class="card" style="margin-bottom:16px; display:flex; flex-direction:column; gap:10px;">
    <div style="font-size:15px; font-weight:700;">${t("inicio.partnerBanner.title")}</div>
    <div style="font-size:12px; color:var(--text-2);">${t("inicio.partnerBanner.body")}</div>
    <div style="display:flex; gap:8px;">
      <input type="text" id="partner-banner-input" placeholder="${t("inicio.partnerBanner.namePlaceholder")}" style="flex:1; min-width:0;">
      <button type="button" id="partner-banner-save" class="btn-primary" style="width:auto; padding:0 18px;">${t("common.save")}</button>
    </div>
    <div id="partner-banner-error" class="banner-aviso red" style="display:none;"></div>
  </div>`;
}

/** Cabecera de Inicio (Main.dc.html:19-28): saludo arriba en --t-body/--ink-2, «{periodo} · día N
 *  de M» debajo en --t-label/--ink-3 (hoy están al revés) + badge de racha a la derecha. El botón
 *  entero sigue abriendo «Periodo nuevo» — es SOLO chrome de layout, el onclick lo pone el
 *  llamante sobre #inicio-periodo-header. */
function cabeceraHtml(period, hoy, saludo, racha) {
  const rachaHtml = racha > 0
    ? `<div style="display:flex;align-items:center;gap:6px;height:30px;border-radius:var(--r-pill);background:var(--surface-2);padding:0 12px;flex-shrink:0;">
        <span style="font-size:13px;font-weight:500;color:var(--ink-2);">${t("inicio.streak", { n: racha })}</span>
      </div>`
    : "";
  return `
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:26px;">
    <button type="button" id="inicio-periodo-header" class="link-btn" style="color:inherit;display:flex;flex-direction:column;gap:3px;text-align:left;padding:7px 0;margin:-7px 0;">
      <span style="font:var(--t-body);color:var(--ink-2);">${escHtml(saludo)}</span>
      <span style="font:var(--t-label);color:var(--ink-3);">${t("inicio.header.dayOf", { period: escHtml(period.name), day: dayIndexOfPeriod(period.start_date, hoy), total: expectedPeriodDays(period.start_date) })}</span>
    </button>
    ${rachaHtml}
  </div>`;
}

/** Héroe con selector de cuenta (Main.dc.html:30-40, decisiones 1-3 de la spec). `cuentas` es
 *  `balancesAt(hoy)`: TODAS las activas (ahorro y pasivo incluidos) en display_order, ya con
 *  `type` (para resolveAccountId) y `balance_cents`. Con una sola cuenta no hay chevron ni
 *  onclick: un botón que no hace nada es peor que un texto. El onclick real (parcheo en sitio,
 *  SIN renderInicio) lo pone wire() más abajo. */
function heroCuentaHtml(cuenta, cuentas) {
  const negativo = cuenta.balance_cents < 0;
  const nombreHtml = `<span id="inicio-cuenta-nombre" style="font-size:13px;font-weight:500;">${escHtml(cuenta.name)}</span>`;
  // Con una sola cuenta no hay a qué ciclar: un <button> que no hace nada es peor que un texto
  // (decisión de la spec), así que ni chevron ni elemento interactivo.
  const selectorHtml = cuentas.length > 1
    ? `<button type="button" id="inicio-cuenta" class="link-btn" aria-label="${escAttr(t("inicio.account.switch"))}"
        style="display:flex;align-items:center;gap:7px;color:var(--ink-3);padding:10px 0;margin:-10px 0;align-self:flex-start;">
        ${nombreHtml}${CHEVRON_DOWN_SVG}
      </button>`
    : `<div style="display:flex;align-items:center;gap:7px;color:var(--ink-3);">${nombreHtml}</div>`;
  return `
  <div class="hero-account" style="margin-bottom:26px;">
    ${selectorHtml}
    <div class="balance num${negativo ? " is-negative" : ""}" id="inicio-saldo">${moneyPartsHtml(cuenta.balance_cents)}</div>
  </div>`;
}

/** «Disponible del periodo» + «Hoy puedes gastar» (Main.dc.html:42-62, N7 §5.2). `budgetTotal` ya
 *  viene calculado del llamante (lo reutiliza también «Te quedarán»): con 0 esta función no se
 *  invoca. La barra se rellena con lo GASTADO, no con lo que queda (decisión 6). */
function disponibleHtml(budgetTotal, spent, period, comprometidoCents, hoy) {
  const disponible = budgetTotal - spent;
  const diasLabel = Math.max(0, daysLeftOfPeriod(period.start_date, hoy));
  const allowance = dailyAllowanceCents(disponible, comprometidoCents, period.start_date, hoy);
  const allowanceOk = allowance > 0;
  return `
  <div style="display:flex;flex-direction:column;gap:11px;margin-bottom:26px;">
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;">
      <div style="display:flex;flex-direction:column;gap:4px;">
        <span style="font-size:13px;font-weight:500;color:var(--ink-3);">${t("inicio.available.title")}</span>
        <div class="num" style="font:var(--t-figure-xl);letter-spacing:-.015em;">${moneyPartsHtml(disponible)}</div>
      </div>
      <span class="num" style="font-size:13px;font-weight:500;color:var(--ink-3);padding-bottom:3px;">${t("inicio.available.days", { n: diasLabel })}</span>
    </div>
    <div class="bar"><i style="width:${relativeWidth(spent, budgetTotal)}%;"></i></div>
    <span style="font-size:13px;font-weight:500;color:var(--ink-3);">${t("inicio.available.spentOf", { spent: escHtml(fmtMoney(spent)), budget: escHtml(fmtMoney(budgetTotal)) })}</span>
    <div style="display:flex;align-items:center;gap:8px;padding-top:3px;">
      <span style="font-size:14px;font-weight:500;color:var(--ink-2);">${t("inicio.available.today")}</span>
      <span class="num" style="font-size:15px;font-weight:600;color:${allowanceOk ? "var(--accent)" : "var(--danger)"};">${escHtml(fmtMoney(allowanceOk ? allowance : 0))}</span>
    </div>
  </div>`;
}

// Icono de la hucha (SISTEMA §4.15), repintado con el acento del sistema: rx="112" es la única
// excepción de radio de todo el sistema (SISTEMA §2.4, es la marca, no una superficie de UI).
const HUCHA_SVG = `
  <svg viewBox="0 0 512 512" width="34" height="34" style="flex-shrink:0;border-radius:9px;" aria-hidden="true">
    <rect width="512" height="512" rx="112" fill="var(--accent)"></rect>
    <path d="M193.43 112.79A41 42 0 1 0 166 186A41 42 0 1 1 138.57 259.21" fill="none" stroke="var(--accent-ink)" stroke-width="40" stroke-linecap="round"></path>
    <rect x="149" y="78" width="34" height="216" rx="17" fill="var(--accent-ink)"></rect>
    <path d="M373.43 112.79A41 42 0 1 0 346 186A41 42 0 1 1 318.57 259.21" fill="none" stroke="var(--accent-ink)" stroke-width="40" stroke-linecap="round"></path>
    <rect x="329" y="78" width="34" height="216" rx="17" fill="var(--accent-ink)"></rect>
    <rect x="138" y="349" width="236" height="50" rx="25" fill="var(--accent-ink)"></rect>
  </svg>`;

/** La hucha (Main.dc.html:64-80, SISTEMA §4.15): una frase calculada en local (huchaMessage,
 *  inicio-logic.js), como mucho dos acciones de texto, nunca un botón primario. Sin nada que
 *  decir, `msg` es null y no se pinta nada — no existe el estado «hola, todo bien». */
function huchaHtml(msg) {
  if (!msg) return "";
  let text, actionKey;
  if (msg.kind === "renewal") {
    text = t("inicio.hucha.renewal", { name: escHtml(msg.params.name), date: fmtDiaCorto(msg.params.date), amount: escHtml(fmtMoney(msg.params.amount)) });
    actionKey = "inicio.hucha.action.renewal";
  } else if (msg.kind === "limit") {
    text = t("inicio.hucha.limit", { name: escHtml(msg.params.name), pct: fmtPctInt(msg.params.pct) });
    actionKey = "inicio.hucha.action.limit";
  } else if (msg.kind === "idle") {
    text = t("inicio.hucha.idle", { n: msg.params.n });
    actionKey = "inicio.hucha.action.idle";
  } else {
    // periodEnd: n===0 es la variante «se cierra hoy» (periodo pasado de largo incluido).
    text = msg.params.n === 0 ? t("inicio.hucha.periodEndToday") : t("inicio.hucha.periodEnd", { n: msg.params.n });
    actionKey = "inicio.hucha.action.periodEnd";
  }
  return `
  <div class="hucha">
    ${HUCHA_SVG}
    <div style="display:flex;flex-direction:column;gap:10px;flex:1;min-width:0;">
      <span style="font-size:14px;line-height:1.45;color:var(--ink);">${text}</span>
      <div style="display:flex;align-items:center;gap:18px;">
        <button type="button" id="inicio-hucha-action" style="border:0;background:transparent;color:var(--accent);font-size:14px;font-weight:600;padding:12px 0;margin:-12px 0;cursor:pointer;-webkit-tap-highlight-color:transparent;">${t(actionKey)}</button>
        <button type="button" id="inicio-hucha-dismiss" style="border:0;background:transparent;color:var(--ink-3);font-size:14px;font-weight:500;padding:12px 0;margin:-12px 0;cursor:pointer;-webkit-tap-highlight-color:transparent;">${t("inicio.hucha.dismiss")}</button>
      </div>
    </div>
  </div>`;
}

/** Movimientos plegados (I4/I5, Main.dc.html:82-131): sección + «Ver todos» → pestaña Movimientos
 *  (tabs.js, sin importar main.js). Cuerpo: groupByDay(foldedMovements(rows, hoy)), con «Hoy» para
 *  el día de hoy y la fecha larga para el resto. El bloque NO es un contenedor tocable entero
 *  (decisión 13): solo «Ver todos» navega, cada fila abre su propio detalle.
 *  `rows` viene de listByDay(period.id): vacío tanto para un usuario sin ningún movimiento nunca
 *  como para uno con meses de historial que acaba de abrir un periodo nuevo. hasHistory (derivado
 *  de recentTxDates(), sin filtro de periodo) distingue los dos casos para no invitar a "registra
 *  tu primer gasto" a quien ya tiene datos — bug heredado de v1, donde pasaba menos porque el
 *  bloque no era el primer contenido bajo la cabecera.
 *  «Ver todos» lleva el mismo `padding:12px 0;margin:-12px 0` de objetivo táctil que el resto de
 *  la pantalla (ver pendingHtml): su área ampliada invade unos px del primer `.tx-row` de debajo,
 *  misma limitación conocida, aceptada por ser el mismo truco ya en uso. */
function movimientosPlegadosHtml(rows, hoy, byId, partnerName, hasHistory) {
  const headerHtml = `
  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;">
    <span style="font-size:15px;font-weight:600;color:var(--ink);">${t("common.movements")}</span>
    <button type="button" id="inicio-movimientos-ver" class="link-btn" style="display:flex;align-items:center;gap:5px;padding:12px 0;margin:-12px 0;">${t("inicio.movements.viewAll")}${CHEVRON_RIGHT_SVG}</button>
  </div>`;
  if (rows.length === 0) {
    const msg = hasHistory ? t("inicio.movements.emptyPeriod") : t("inicio.movements.empty");
    return `${headerHtml}<div style="font-size:12px;color:var(--ink-3);">${msg}</div>`;
  }
  const groups = groupByDay(foldedMovements(rows, hoy));
  return `
  ${headerHtml}
  <div>
    ${groups.map((g) => `
      <div class="day-label" style="padding:8px 0 4px 0;">${g.date === hoy ? t("common.today") : fmtDiaLargo(g.date)}</div>
      ${g.rows.map((r) => txRowHtml(r, byId, partnerName)).join("")}
    `).join("")}
  </div>`;
}

/** Fila compacta de la espina de Inicio (I2, Main.dc.html:143-218, 34px): comparte constructor
 *  (daysWithCategories) con la pantalla Semana — solo cambia la densidad, nunca los datos. */
function spineRowCompactHtml(day, isLast, max, byId) {
  const hoy = day.date === hoyISO();
  const hasBar = day.segments.length > 0;
  const nodeStyle = hoy
    ? "width:12px;height:12px;background:var(--accent);box-shadow:0 0 0 4px var(--accent-tint);"
    : hasBar
      ? `width:10px;height:10px;background:${colorForCategory(day.dominantRootId || "", byId)};`
      : "width:8px;height:8px;background:var(--bg);border:1px solid var(--hairline-strong);box-sizing:border-box;";
  // flex:1 inline: esta espina es horizontal (día · barra · importe), a diferencia de la de
  // Semana y de la barra de categoría de Inicio (ambas en columna) — ver el comentario de
  // .day-bar en app.css sobre por qué el flex:1 no puede vivir en la clase.
  const barHtml = hasBar
    ? `<div class="day-bar" style="flex:1;min-width:0;">${day.segments.map((seg) => `<div class="day-seg" style="width:${relativeWidth(seg.cents, max)}%;--cat:${colorForCategory(seg.rootId || "", byId)};"></div>`).join("")}</div>`
    : `<div class="day-bar" style="flex:1;min-width:0;"></div>`;
  const dayNum = new Date(day.date + "T12:00:00").getDate();
  // El rail es hijo directo de .spine-row (que hace stretch por defecto) para que la línea de 2px
  // siga continua entre filas; el contenido va en un flex interno aparte para poder centrarlo
  // verticalmente SIN encoger el rail (align-items:center en la fila entera lo habría hecho).
  return `
  <div class="spine-row" style="min-height:34px;">
    <div class="spine-rail">
      <div class="spine-line"${isLast ? ' style="height:50%;"' : ""}></div>
      <div class="spine-node" style="${nodeStyle}"></div>
    </div>
    <div style="flex:1;min-width:0;display:flex;align-items:center;gap:12px;">
      <span class="num" style="width:40px;flex-shrink:0;font-size:12px;font-weight:${hoy ? "600" : "500"};color:${hoy ? "var(--accent)" : "var(--ink-3)"};">${escHtml(fmtDiaIni(day.date))} ${dayNum}</span>
      ${barHtml}
      <span class="num" style="font-size:13px;font-weight:${hoy ? "600" : "500"};color:var(--ink);min-width:62px;text-align:right;">${escHtml(fmtMoney(day.totalCents))}</span>
    </div>
  </div>`;
}

/** «Esta semana» (I2, Main.dc.html:133-219): cabecera con el total + «Ver la semana» y la espina
 *  compacta. Contenedor tocable ENTERO (mismo patrón que #inicio-categoria-card, decisión 13):
 *  abre la pantalla Semana. */
function estaSemanaHtml(days, total, byId) {
  const max = maxDayTotal(days);
  return `
  <div id="inicio-semana-card" style="margin-top:var(--gap-section);cursor:pointer;-webkit-tap-highlight-color:transparent;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:15px;font-weight:600;color:var(--ink);">${t("inicio.week.title")}</span>
        <span style="width:1px;height:13px;background:var(--hairline-strong);"></span>
        <span class="num" style="font-size:13px;font-weight:500;color:var(--ink-3);">${escHtml(fmtMoney(total.totalCents))}</span>
      </div>
      <button type="button" id="inicio-semana-ver" class="link-btn" style="display:flex;align-items:center;gap:5px;">${t("inicio.week.viewAll")}${CHEVRON_RIGHT_SVG}</button>
    </div>
    <div class="spine">
      ${days.map((d, i) => spineRowCompactHtml(d, i === days.length - 1, max, byId)).join("")}
    </div>
  </div>`;
}

/** Una fila de «Gasto por categoría» en Inicio (I3, Main.dc.html:227-291): insignia de 36px,
 *  nombre, importe, barra de 6px relativa a la raíz que más gasta. Con límite superado, el tramo
 *  hasta el límite en el color de la categoría y el exceso en --danger — reutiliza .day-bar/
 *  .day-seg (pista+tramos a hueso): pese al nombre no son «días», son la misma pieza genérica. */
function categoriaRowHtml(row, byId, budgetByCategory, maxSpent) {
  const color = colorForCategory(row.root_id, byId);
  const icon = iconForCategory(row.root_id, byId);
  const limit = budgetByCategory[row.root_id] ?? 0;
  const spent = row.spent_cents;
  const over = limit > 0 && spent > limit;
  const limitPct = relativeWidth(limit, maxSpent);
  const totalPct = relativeWidth(spent, maxSpent);
  const barHtml = over
    ? `<div class="day-bar" style="height:6px;">
        <div class="day-seg" style="width:${limitPct}%;--cat:${color};"></div>
        <div class="day-seg" style="width:${Math.max(0, totalPct - limitPct)}%;--cat:var(--danger);"></div>
      </div>`
    : `<div class="bar" style="height:6px;"><i style="width:${totalPct}%;--cat:${color};"></i></div>`;
  const overLabel = over
    ? `<span style="font-size:12px;font-weight:500;color:var(--danger);">${t("inicio.categorySpend.over", { amount: escHtml(fmtMoney(spent - limit)) })}</span>`
    : "";
  return `
  <div style="display:flex;align-items:center;gap:12px;">
    <div class="dotico" style="width:36px;height:36px;font-size:16px;--cat:${color};">${icon}</div>
    <div style="display:flex;flex-direction:column;gap:5px;flex:1;min-width:0;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
        <div style="display:flex;align-items:baseline;gap:8px;min-width:0;">
          <span style="font-size:14px;font-weight:500;color:var(--ink);">${escHtml(row.name)}</span>
          ${overLabel}
        </div>
        <span class="num" style="font-size:13px;font-weight:500;color:${over ? "var(--danger)" : "var(--ink)"};flex-shrink:0;">${escHtml(fmtMoney(spent))}</span>
      </div>
      ${barHtml}
    </div>
  </div>`;
}

/** «Gasto por categoría» en Inicio (I3): las 5 raíces con más gasto, sin rueda y sin «Otras N» (a
 *  diferencia del v1). Contenedor tocable ENTERO (decisión 13, mismo patrón de siempre): un solo
 *  onclick + el botón «Ver todas» del pie burbujea hasta él — nada de role de botón (borraría los
 *  importes del árbol de accesibilidad). Sin gasto categorizado, versión reducida. */
function categoriaPorCategoriaHtml(rootRows, byId, budgetByCategory) {
  const withSpend = rootRows.filter((r) => r.spent_cents > 0).slice(0, INICIO_TOP_CATEGORIES);
  const headerHtml = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <span style="font-size:15px;font-weight:600;color:var(--ink);">${t("inicio.categorySpend.title")}</span>
      <button type="button" id="inicio-categoria-ver" class="link-btn" style="display:flex;align-items:center;gap:5px;">${t("inicio.categorySpend.viewAll")}${CHEVRON_RIGHT_SVG}</button>
    </div>`;
  let bodyHtml;
  if (withSpend.length === 0) {
    bodyHtml = `<div style="font-size:12px;color:var(--ink-3);margin-top:12px;">${t("inicio.categorySpend.empty")}</div>`;
  } else {
    const maxSpent = Math.max(...withSpend.map((r) => r.spent_cents));
    bodyHtml = `<div style="display:flex;flex-direction:column;gap:14px;margin-top:14px;">
      ${withSpend.map((r) => categoriaRowHtml(r, byId, budgetByCategory, maxSpent)).join("")}
    </div>`;
  }
  return `
  <div id="inicio-categoria-card" style="margin-top:var(--gap-section);cursor:pointer;-webkit-tap-highlight-color:transparent;">
    ${headerHtml}
    ${bodyHtml}
  </div>`;
}

/** Gastado / Ingresos / Ahorrado (I1, Main.dc.html:293-306): grid de 3 columnas separadas por un
 *  filete de 1px. Ingresos en --pos, Ahorrado en --danger si es negativo. */
function statGridHtml(spent, income, ahorrado) {
  return `
  <div class="stat-grid">
    <div>
      <span style="font-size:12px;font-weight:500;color:var(--ink-3);">${t("inicio.spent.title")}</span>
      <span class="num" style="font:600 15px var(--font-mono);letter-spacing:-.02em;color:var(--ink);">${escHtml(fmtMoney(spent))}</span>
    </div>
    <div>
      <span style="font-size:12px;font-weight:500;color:var(--ink-3);">${t("inicio.spent.income")}</span>
      <span class="num" style="font:600 15px var(--font-mono);letter-spacing:-.02em;color:var(--pos);">${escHtml(fmtMoney(income))}</span>
    </div>
    <div>
      <span style="font-size:12px;font-weight:500;color:var(--ink-3);">${t("inicio.spent.saved")}</span>
      <span class="num" style="font:600 15px var(--font-mono);letter-spacing:-.02em;color:${ahorrado < 0 ? "var(--danger)" : "var(--ink)"};">${escHtml(fmtMoney(ahorrado))}</span>
    </div>
  </div>`;
}

/** «Ahorras el X % de lo que ingresas» (I1, Main.dc.html:307-309): savingsSentence decide el
 *  kind; sin ingresos, null → no se pinta nada. fmtPct0 (Task 10, sin decimales: «54 %») en vez
 *  de fmtPct (que mete un decimal, «54,2 %») — coherente con el resto de cifras de la pantalla,
 *  que van a un vistazo, no a precisión contable. */
function savingsLineHtml(income, spent) {
  const s = savingsSentence(income, spent);
  if (!s) return "";
  const text = s.kind === "saves"
    ? t("inicio.savings.rate", { pct: fmtPct0(s.ratio) })
    : t("inicio.savings.negative");
  return `<div style="padding-top:10px;"><span style="font-size:13px;font-weight:500;color:var(--ink-3);">${text}</span></div>`;
}

/** «Queda por pagar» + «Te quedarán» (Main.dc.html:323-344): una fila por recurrente PENDIENTE
 *  que no sea ingreso — siguen siendo `<button data-prevision-rule>` que abren Registro
 *  precargado (se conserva íntegro, ver el wiring en renderInicio). Cierra con «Te quedarán» =
 *  remainingAfterRecurringCents(disponible, comprometido); sin límites definidos (`remaining`
 *  null) esa última fila no se pinta.
 *  Objetivo táctil (revisión de código): `padding:12px 0;margin:-12px 0` en cada fila para llegar
 *  a 44px sin mover un píxel el layout — LIMITACIÓN CONOCIDA: con gap:12px entre filas el área
 *  ampliada de una fila invade la de su vecina; el navegador se lo lleva la que esté más abajo en
 *  el DOM, así que un toque justo en el hueco puede abrir la regla de debajo en vez de la de
 *  encima. Aceptado (mismo margen que ya usan #inicio-cuenta/#inicio-periodo-header). */
function pendingHtml(prevision, remaining) {
  const pending = prevision.items.filter((it) => !it.paid && it.rule.type !== "income");
  if (pending.length === 0 && remaining == null) return "";
  const rowsHtml = pending.map((it) => `
    <button type="button" data-prevision-rule="${escAttr(it.rule.id)}" style="display:flex;align-items:center;gap:10px;width:100%;background:none;border:0;padding:12px 0;margin:-12px 0;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;">
      <span style="font-size:14px;font-weight:500;color:var(--ink-2);flex:1;min-width:0;">${escHtml(it.rule.name)}</span>
      <span class="num" style="font-size:13px;font-weight:500;color:var(--warn);">${escHtml(fmtMoney(it.myCents))}</span>
    </button>`).join("");
  const remainingHtml = remaining == null ? "" : `
    <div style="display:flex;align-items:center;gap:10px;padding-top:10px;border-top:1px solid var(--hairline);">
      <span style="font-size:14px;font-weight:500;color:var(--ink);flex:1;min-width:0;">${t("inicio.pending.left")}</span>
      <span class="num" style="font-size:15px;font-weight:600;color:var(--ink);">${escHtml(fmtMoney(remaining))}</span>
    </div>`;
  return `
  <div style="margin-top:var(--gap-section);">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;">
      <span style="font-size:15px;font-weight:600;color:var(--ink);">${t("inicio.pending.title")}</span>
      <button type="button" id="prevision-gestionar" class="link-btn" style="display:flex;align-items:center;gap:5px;padding:12px 0;margin:-12px 0;">${t("inicio.prevision.manage")}${CHEVRON_RIGHT_SVG}</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:12px;">
      ${rowsHtml}${remainingHtml}
    </div>
  </div>`;
}

/** Pantalla Inicio v2 («saldo primero», spec docs/superpowers/specs/2026-09-10-inicio-v2-design.md):
 *  saldo de la cuenta principal, disponible del periodo + «hoy puedes gastar», la hucha,
 *  movimientos plegados, la semana en espina, gasto por categoría en barras, compartidos,
 *  recurrentes pendientes y «Te quedarán». */
export async function renderInicio(container) {
  // Silueta gris mientras llega la primera consulta: antes la pantalla se quedaba EN BLANCO desde
  // que se tocaba la pestaña hasta que volvía el Worker. Solo en el PRIMER pintado — ver el
  // testigo container.dataset.screen, que escriben SOLO esta pantalla y Movimientos.
  if (container.dataset.screen !== "inicio") {
    container.dataset.screen = "inicio";
    container.innerHTML = skeletonHtml([72, 168, 236, 320]);
  }
  const hoy = hoyISO();
  let period, spent, income, rows, byId, sharedRows, netCents, budgets, prevision, rootRows,
    cuentas, weekRootRows, recentDates, meta, partnerName, showPartnerBanner, rules, snoozedRenewals;
  try {
    period = await getOpenPeriod();
    if (!period) {
      container.innerHTML = `<div class="banner-aviso red">${t("common.noOpenPeriod")}</div>`;
      return;
    }
    // weekRange(hoy) da la MISMA ventana de 7 días que usa Semana — semana-logic.js es la única
    // fuente, así que Inicio no puede llevar una tercera.
    const week = weekRange(hoy);
    [spent, income, rows, byId, sharedRows, netCents, budgets, prevision, rootRows,
      cuentas, weekRootRows, recentDates, meta, rules, snoozedRenewals] = await Promise.all([
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
    ]);
    partnerName = (meta.partner_name || "").trim();
    // Sin nombre, comprobamos si hay compartidos "huérfanos" (Task 5): con nombre ya configurado
    // no hace falta esta query extra — sharedBlockHtml decide solo con sharedRows/netCents.
    showPartnerBanner = !partnerName && await hasSharedData();
  } catch (e) {
    // userMessage: si el error está escrito para el usuario (un UserError) se enseña tal cual; si
    // es técnico (SQLite, un bug), se va a console.error y aquí queda el texto genérico.
    container.innerHTML = `<div class="banner-aviso red">${t("inicio.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }

  const budgetByCategory = budgetMap(budgets);
  const budgetTotal = Object.values(budgetByCategory).reduce((s, c) => s + c, 0);
  const ahorrado = income - spent;
  // Saludo por hora local (PR polish): sustituye la "Desde el ..." fija de la cabecera — la fecha
  // de inicio del periodo ya se ve en la línea pequeña vía "día N de M".
  const h = new Date().getHours();
  const saludo = h < 7 ? t("inicio.greeting.evening") : h < 14 ? t("inicio.greeting.morning") : h < 21 ? t("inicio.greeting.afternoon") : t("inicio.greeting.evening");

  // -- Selector de cuenta (decisiones 1-3): la elegida sobrevive a un repintado en la MISMA
  // sesión (selectedAccountId es de módulo); si dejó de ser válida (borrada/archivada entre
  // medias) cae a la resuelta por meta.default_account_id, la misma que usa previsionOfPeriod.
  if (!(selectedAccountId && cuentas.some((a) => a.id === selectedAccountId))) {
    selectedAccountId = resolveAccountId(meta.default_account_id, cuentas);
  }
  const cuentaActual = cuentas.find((a) => a.id === selectedAccountId) ?? cuentas[0] ?? null;

  // -- Racha (§3.17) y la hucha (§8): las dos usan recentTxDates(), sin filtro de periodo.
  const racha = streakDays(recentDates, hoy);
  // N6: la renovación de la hucha sale del radar de suscripciones (subscriptions.js#renewalNotice),
  // no de toda recurrente pendiente — ya filtra marcadas, activas, no semanales, ≤7 días y
  // respeta lo silenciado con «Ahora no» (snoozeRenewal). huchaMessage sigue decidiendo la
  // prioridad entre esta y las demás reglas; aquí solo se adapta la forma de su única candidata.
  const notice = renewalNotice(rules, hoy, snoozedRenewals);
  // La hucha no puede reñir por un cargo que "Queda por pagar" (pendingHtml, de prevision.items)
  // ya da por resuelto: si la regla de `notice` tiene un item en prevision.items y ese item está
  // `paid` (ya se registró el cargo este periodo), se descarta el aviso entero. Si tiene item y
  // no está pagado, se usa su `myCents` — el importe YA prorrateado por my_share_pct, el mismo
  // que enseña "Queda por pagar" — en vez del importe ÍNTEGRO de notice.amountCents (D3 de
  // subscriptions.js es correcto para el radar, pero aquí la hucha y la lista de pendientes
  // tienen que coincidir en la misma cifra). notice.amountCents queda solo de reserva por si la
  // regla no aparece en prevision.items (p. ej. no aplica este mes por algún borde de ruleApplies).
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
    daysLeftOfPeriod: daysLeftOfPeriod(period.start_date, hoy),
    todayIso: hoy,
    dismissed: huchaDismissed,
  });

  // -- Esta semana (I2): el MISMO constructor que usa la pantalla Semana, a partir de la misma
  // consulta ya cargada arriba — ninguna divergencia posible entre las dos vistas de la ventana.
  const semanaDias = daysWithCategories(weekRootRows, weekRange(hoy).dates);
  const semanaTotal = weekTotals(semanaDias);

  // -- «Te quedarán» (§2.1): disponible del periodo (mismo que alimenta disponibleHtml) menos lo
  // comprometido en recurrentes. Sin límites definidos, null: ni la fila ni el bloque que no tenga
  // más pendientes se pintan (ver pendingHtml).
  const remaining = budgetTotal ? remainingAfterRecurringCents(budgetTotal - spent, prevision.comprometidoCents) : null;

  container.innerHTML = `
    ${showPartnerBanner ? partnerBannerHtml() : ""}

    ${cabeceraHtml(period, hoy, saludo, racha)}

    ${cuentaActual ? heroCuentaHtml(cuentaActual, cuentas) : ""}

    ${budgetTotal ? disponibleHtml(budgetTotal, spent, period, prevision.comprometidoCents, hoy) : ""}

    ${huchaHtml(hucha)}

    ${movimientosPlegadosHtml(rows, hoy, byId, partnerName, recentDates.length > 0)}

    ${estaSemanaHtml(semanaDias, semanaTotal, byId)}

    ${categoriaPorCategoriaHtml(rootRows, byId, budgetByCategory)}

    ${statGridHtml(spent, income, ahorrado)}
    ${savingsLineHtml(income, spent)}

    ${sharedBlockHtml(sharedRows, netCents, partnerName)}

    ${pendingHtml(prevision, remaining)}

    <div style="height:152px;"></div>
  `;

  const partnerBannerSaveBtn = container.querySelector("#partner-banner-save");
  if (partnerBannerSaveBtn) partnerBannerSaveBtn.onclick = async () => {
    const input = container.querySelector("#partner-banner-input");
    const errEl = container.querySelector("#partner-banner-error");
    if (errEl) errEl.style.display = "none";
    const value = (input.value || "").trim();
    if (!value) {
      partnerBannerSaveBtn.classList.add("shake");
      setTimeout(() => partnerBannerSaveBtn.classList.remove("shake"), 400);
      return;
    }
    partnerBannerSaveBtn.disabled = true;
    try {
      // partner_name va sin bcSanitizeCell a propósito: SheetJS exporta la celda como string (sin riesgo
      // de fórmula) y sanitizar ensuciaría el nombre en toda la UI («+Ana» → «'+Ana»).
      await setMeta("partner_name", value);
      // El banner desaparece al repintar y la pantalla queda igual que estaba: sin esto, guardar
      // el nombre no se distingue de no haber hecho nada.
      showToast(t("toast.saved"));
      renderInicio(container);
    } catch (e) {
      partnerBannerSaveBtn.disabled = false;
      partnerBannerSaveBtn.classList.add("shake");
      setTimeout(() => partnerBannerSaveBtn.classList.remove("shake"), 400);
      if (errEl) {
        errEl.innerHTML = t("common.saveFailed", { error: escHtml(userMessage(e)) });
        errEl.style.display = "";
      }
    }
  };

  // Selector de cuenta (decisión 3): parcheo en sitio de los dos nodos con los saldos que YA
  // vinieron en la carga — nada de renderInicio() aquí, perdería el scroll y parpadearía.
  const cuentaBtn = container.querySelector("#inicio-cuenta");
  if (cuentaBtn) cuentaBtn.onclick = () => {
    selectedAccountId = nextAccountId(cuentas, selectedAccountId);
    const acc = cuentas.find((a) => a.id === selectedAccountId);
    container.querySelector("#inicio-cuenta-nombre").textContent = acc.name;
    const saldoEl = container.querySelector("#inicio-saldo");
    saldoEl.classList.toggle("is-negative", acc.balance_cents < 0);
    saldoEl.innerHTML = moneyPartsHtml(acc.balance_cents);
  };

  if (hucha) {
    const huchaDismissBtn = container.querySelector("#inicio-hucha-dismiss");
    huchaDismissBtn.onclick = async () => {
      // La renovación, además del descarte de sesión, silencia ESA fecha de verdad (persistida en
      // meta.renewal_snoozed): sin esto, «Ahora no» solo duraría hasta el próximo repintado de
      // Inicio, no hasta la próxima sesión (spec suscripciones §8).
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

  // Cualquier fila de movimiento (plegados o dentro de un adjustment) abre el detalle real —
  // ✕/Guardar/Borrar vuelven a Inicio (onBack de openTxDetail).
  container.querySelectorAll("[data-tx]").forEach((el) => {
    el.onclick = () => openTxDetail(container, el.dataset.tx, () => renderInicio(container));
  });

  const movimientosVerBtn = container.querySelector("#inicio-movimientos-ver");
  if (movimientosVerBtn) movimientosVerBtn.onclick = () => goToTab("movimientos");

  const semanaCard = container.querySelector("#inicio-semana-card");
  if (semanaCard) {
    // Un solo listener: el click del <button id="inicio-semana-ver"> del pie burbujea hasta aquí.
    semanaCard.onclick = () => {
      pushBack(() => renderInicio(container));
      renderSemana(container, goBack);
    };
  }

  // Task 7 (6f): único botón Liquidar — un solo id, un solo listener.
  const liquidarBtn = container.querySelector("#shared-liquidar");
  if (liquidarBtn) liquidarBtn.onclick = () => {
    pushBack(() => renderInicio(container));
    renderLiquidar(container, goBack);
  };

  const categoriaCard = container.querySelector("#inicio-categoria-card");
  if (categoriaCard) {
    // Un solo listener: el click del <button id="inicio-categoria-ver"> del pie (de puntero o
    // sintetizado al activarlo por teclado) burbujea hasta aquí, así que no hace falta cablear
    // el botón aparte.
    categoriaCard.onclick = () => {
      pushBack(() => renderInicio(container));
      renderGastoPorCategoria(container, goBack);
    };
  }

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
