import {
  getOpenPeriod, spentOfPeriod, incomeOfPeriod, listByDay, allCategoriesById,
  pendingSettlements, pendingSettlementNetCents, budgetsOfPeriod, previsionOfPeriod,
  spentByRootCategory, balancesAt, spentByDayAndRootCategory, recentTxDates,
  getMetaAll, setMeta, hasSharedData,
} from "../repo.js";
import { colorForCategory, iconForCategory, DEFAULT_COLOR } from "../category-colors.js";
import { fmtMoney, moneyPartsHtml, fmtDiaLargo, fmtDiaCorto, fmtDiaIni, hoyISO, fmtNum2, fmtPct, currencyCode } from "../format.js";
import { dayIndexOfPeriod, expectedPeriodDays } from "../prevision.js";
import {
  nextAccountId, daysLeftOfPeriod, dailyAllowanceCents, nextDueDateIso, streakDays,
  daysSinceLastEntry, huchaMessage,
} from "../inicio-logic.js";
import { weekRange } from "../semana-logic.js";
import { resolveAccountId } from "../account-defaults.js";
import { t } from "../i18n/index.js";
import { budgetStatus, budgetMap, pctOf, relativeWidth } from "../category-spend.js";
import { barChartSvg, donutSvg } from "../charts.js";
import { renderLiquidar } from "./liquidar.js";
import { renderPeriodoNuevo } from "./periodo-nuevo.js";
import { renderGastoPorCategoria } from "./gasto-por-categoria.js";
import { renderRecurrentes } from "./recurrentes.js";
import { renderRegistro } from "./registro.js";
import { pushBack, goBack } from "../back.js";
import { userMessage } from "../errors.js";
import { showToast } from "../toast.js";
import { skeletonHtml } from "../skeleton.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const centsToStr = (cents) => fmtNum2((cents ?? 0) / 100);
// Porcentaje entero con espacio duro antes del «%» — mismo patrón que gasto-por-categoria.js
// (fmtPctInt): sin el U+00A0 el «%» se parte en su propia línea al estrecharse el contenedor.
// `format.js#fmtPct0` (Task 10) hará esto mismo vía Intl; hasta entonces el porcentaje de la
// hucha ya llega redondeado desde inicio-logic.js#huchaMessage, así que basta con el sufijo.
const fmtPctInt = (pct) => `${pct} %`;

// Cuenta elegida por el selector del héroe (decisión 3 de la spec): vive a nivel de MÓDULO, no del
// closure de renderInicio, porque esa función se re-ejecuta en cada vuelta de subpantalla y un
// `let` local perdería la cuenta elegida en cuanto se repintara. Se valida contra la lista de
// cuentas VIVAS en cada render (una cuenta borrada/archivada entre medias cae al valor por defecto).
let selectedAccountId = null;

// «Ahora no» de la hucha dura la sesión (decisión 16): mismo criterio de módulo que
// selectedAccountId — renderInicio se re-ejecuta en cada vuelta de subpantalla y un Set del
// closure perdería el descarte.
const huchaDismissed = new Set();

// Cuántas categorías raíz se listan individualmente en el donut antes de agrupar el resto en
// "Otras N" — mismo criterio visual que docs/design/material-expresivo/Resumen.dc.html:139-213 (6 + "Otras 3").
const DONUT_TOP_N = 6;
// El gris del grupo "Otras N" es el mismo DEFAULT_COLOR de category-colors.js (importado: cierra
// el punto "paleta triplicada" del BACKLOG, reskin v2 tarea 10), aunque este módulo no tenga
// ninguna categoría real que resolver a "sin color".
const DONUT_OTHERS_COLOR = DEFAULT_COLOR;

/** Agrupa las filas de listByDay (ya vienen ordenadas por date DESC) en bloques por día,
 *  preservando el orden de llegada. */
function groupByDay(rows) {
  const groups = [];
  let current = null;
  for (const r of rows) {
    if (!current || current.date !== r.date) {
      current = { date: r.date, rows: [] };
      groups.push(current);
    }
    current.rows.push(r);
  }
  return groups;
}

function txRowHtml(r, byId, partnerName) {
  // Una liquidación deja DOS apuntes (repo.js#settleAllSharedStmts): la devolución ENTRANTE de un
  // gasto que pagué yo y el ajuste SALIENTE —negativo, sin categoría— de uno que pagó ella. Antes
  // listByDay escondía los ajustes y aquí solo se veía la mitad del movimiento de dinero.
  // Se pinta igual que en Movimientos (movimientos.js:70-81): balanza sobre el gris de tarjeta,
  // «Ajuste» de título y el comercio debajo («Liquidación con {nombre}» cuando lo es). El signo
  // sale del importe, que en un adjustment PUEDE ser negativo — sin este caso, la rama genérica de
  // abajo pintaría «+-45,20 €» en verde, porque da por hecho que solo los gastos restan.
  if (r.type === "adjustment") {
    const isNeg = r.amount_cents < 0;
    return `
    <div class="tx-row">
      <div class="dotico" style="--cat:var(--card2);">⚖️</div>
      <div class="tx-body">
        <div class="tx-title">${t("common.type.adjustment")}</div>
        <div class="tx-sub">${escHtml(r.merchant || r.note || "")}</div>
      </div>
      <div class="tx-amount num ${isNeg ? "negative" : "positive"}">${isNeg ? "-" : "+"}${moneyPartsHtml(Math.abs(r.amount_cents))}</div>
    </div>`;
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
    <div class="tx-row">
      <div class="dotico" style="--cat:${color};">${icon}</div>
      <div class="tx-body">
        <div class="tx-title">${escHtml(title)}</div>
        <div class="tx-sub">${escHtml(sub)}</div>
      </div>
      <div class="tx-amount num ${amountClass}">${sign}${moneyPartsHtml(r.amount_cents)}</div>
    </div>`;
}

/** Bloque de compartidos: neto pendiente con la contraparte, de TODOS los periodos
 *  (pendingSettlements/-Net cubren cualquier gasto compartido sin liquidar en las dos
 *  direcciones, no solo los del periodo abierto). Se oculta entero si no hay partnerName
 *  configurado (PR C, Task 5: sin nombre no hay a quién liquidar — ver partnerBannerHtml para el
 *  caso "hay compartidos pero falta el nombre") o si no hay nada pendiente. */
function sharedBlockHtml(period, sharedRows, netCents, partnerName) {
  if (!partnerName || (sharedRows.length === 0 && netCents === 0)) return "";
  const miPct = period.my_share_pct;
  const n = sharedRows.length;
  const masAntiguo = sharedRows[0]?.date;
  return `
    <div class="card" style="display:flex;flex-direction:column;gap:14px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="font-size:15px;font-weight:700;">${t("inicio.shared.withPartner", { name: escHtml(partnerName) })}</div>
        <div style="font-size:11px;font-weight:600;color:var(--text-2);background:var(--card2);border-radius:999px;padding:5px 10px;">
          ${t("inicio.shared.periodSplit", { mine: miPct, theirs: 100 - miPct })}
        </div>
      </div>
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;">
        <div style="display:flex;flex-direction:column;gap:5px;">
          <div style="font-size:11px;color:var(--text-3);">${netCents > 0
            ? t("common.settlement.theyOwe", { name: escHtml(partnerName) })
            : netCents < 0
              ? t("common.settlement.youOwe", { name: escHtml(partnerName) })
              : t("common.settlement.even")}</div>
          <div class="num${netCents > 0 ? " text-green" : netCents < 0 ? " text-red" : ""}" style="font-size:30px;font-weight:600;letter-spacing:-0.02em;">${fmtMoney(Math.abs(netCents))}</div>
        </div>
        <button type="button" id="shared-liquidar" style="height:44px;padding:0 18px;border-radius:999px;
          background:var(--card2);color:var(--text);border:0;font-size:12px;font-weight:700;cursor:pointer;
          -webkit-tap-highlight-color:transparent;">${t("common.settle")}</button>
      </div>
      ${n > 0 ? `<div style="font-size:11px;color:var(--text-3);">
        ${t("inicio.shared.oldest", { n, date: fmtDiaCorto(masAntiguo) })}
      </div>` : ""}
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

function previsionRowHtml(item, byId) {
  const { rule, myCents, paid } = item;
  const color = rule.type === "transfer" ? DEFAULT_COLOR : colorForCategory(rule.category_id, byId);
  const icon = rule.type === "transfer" ? "⇄" : iconForCategory(rule.category_id, byId);
  const amountStyle = paid
    ? "font-size:14px;font-weight:700;flex-shrink:0;color:var(--text-2);text-decoration:line-through;"
    : "font-size:14px;font-weight:700;flex-shrink:0;";
  const inner = `
      <div class="dotico" style="--cat:${color};">${icon}</div>
      <div class="tx-body">
        <div class="tx-title">${escHtml(rule.name)}</div>
        <div class="tx-sub">${paid ? t("inicio.prevision.paid") : t("inicio.prevision.pending")}</div>
      </div>
      <div class="num" style="${amountStyle}">${fmtMoney(myCents)}</div>`;
  // Pagada: fila estática (nada que hacer). Pendiente: <button> real (no un <div> con onclick),
  // igual criterio que recurrentes.js ruleRowHtml — accesible por teclado/lector de pantalla.
  return paid
    ? `<div class="tx-row">${inner}</div>`
    : `<button type="button" class="tx-row" data-prevision-rule="${escAttr(rule.id)}"
        style="width:100%;text-align:left;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;">${inner}</button>`;
}

/** Bloque "Previsión": reglas recurrentes que aplican este mes (pagadas o pendientes), con
 *  el "comprometido restante" y el "disponible real" destacado. Se oculta entero si no hay
 *  ninguna regla aplicable este mes (aunque estén todas ya pagadas, el bloque se muestra). */
function previsionHtml(prevision, byId) {
  if (prevision.items.length === 0) return "";
  return `
    <div class="card" style="display:flex;flex-direction:column;gap:14px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div class="section-title">${t("inicio.prevision.title")}</div>
        <button type="button" id="prevision-gestionar" class="link-btn" style="white-space:nowrap;">${t("inicio.prevision.manage")}</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${prevision.items.map((it) => previsionRowHtml(it, byId)).join("")}
      </div>
      <hr class="divider">
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
          <div style="font-size:12px;color:var(--text-2);">${t("inicio.prevision.committed")}</div>
          <div class="num" style="font-size:14px;font-weight:600;">${fmtMoney(prevision.comprometidoCents)}</div>
        </div>
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
          <div style="font-size:13px;font-weight:700;">${t("inicio.prevision.available")}</div>
          <div class="num ${prevision.disponibleCents >= 0 ? "text-green" : "text-red"}"
            style="font-size:20px;font-weight:700;letter-spacing:-0.02em;">${fmtMoney(prevision.disponibleCents)}</div>
        </div>
      </div>
    </div>`;
}

/** Tarjeta "Flujo de gasto" (v1, todavía viva en este commit — la sustituye la espina en la
 *  Task 9): barChartSvg de los últimos 7 días naturales (hoy incluido y marcado como activo) —
 *  réplica de docs/design/material-expresivo/Resumen.dc.html:67-107. days7: 7 entradas {date,
 *  cents} ya rellenas con 0 en los días sin movimiento (ver renderInicio, derivadas ahora de
 *  spentByDayAndRootCategory en vez de la consulta que tenía esta tarjeta antes). */
function flujoDeGastoHtml(days7) {
  const hoy = hoyISO();
  const total7 = days7.reduce((s, d) => s + d.cents, 0);
  const days = days7.map((d) => ({ label: fmtDiaIni(d.date), cents: d.cents, active: d.date === hoy }));
  return `
    <div class="card" style="display:flex;flex-direction:column;gap:16px;margin-bottom:16px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
        <div style="font-size:15px;font-weight:700;">${t("inicio.flow.title")}</div>
        <div style="font-size:11px;color:var(--text-3);">${t("inicio.flow.last7", { total: fmtMoney(total7) })}</div>
      </div>
      ${barChartSvg(days)}
    </div>`;
}

/** Color de la barra de estado de una fila del donut: igual criterio que
 *  gasto-por-categoria.js#rootRowHtml (ok -> color propio de la categoría, warn/over -> ámbar/rojo). No
 *  se reutiliza directamente porque esa pantalla no la exporta (es de detalle interno de esa
 *  pantalla) — aquí además el texto NO se colorea en warn (solo la barra), a diferencia de
 *  gasto-por-categoria.js (rootRowHtml colorea el % en ámbar en warn; esta tarjeta no). */
function donutBarColor(level, catColor) {
  if (level === "warn") return "var(--amber)";
  if (level === "over") return "var(--red)";
  return catColor;
}

/** Una fila de la lista de categorías del donut: punto de color + nombre + "X € de Y €" con
 *  mini-barra (categorías CON límite este periodo) o "X € sin límite" sin barra (el resto y el
 *  grupo "Otras N") — réplica de docs/design/material-expresivo/Resumen.dc.html:140-213. */
function categoriaDonutRowHtml(name, color, spentCents, limitCents) {
  if (limitCents > 0) {
    const st = budgetStatus(spentCents, limitCents);
    const barColor = donutBarColor(st.level, color);
    const numColor = st.level === "over" ? "var(--red)" : "var(--text)";
    const barPct = Math.min(100, Math.max(0, st.pct));
    return `
      <div style="display:flex;flex-direction:column;gap:6px;">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="width:9px;height:9px;border-radius:3px;background:${color};flex-shrink:0;"></div>
            <div style="font-size:12.5px;font-weight:600;color:var(--text-2);">${escHtml(name)}</div>
          </div>
          <div class="num" style="font-size:12.5px;font-weight:700;color:${numColor};white-space:nowrap;">${fmtMoney(spentCents)} <span style="font-weight:500;color:var(--text-3);">${t("inicio.categorySpend.of", { limit: fmtMoney(limitCents) })}</span></div>
        </div>
        <div style="height:5px;background:var(--card2);border-radius:999px;overflow:hidden;">
          <div style="width:${barPct}%;height:5px;background:${barColor};border-radius:999px;"></div>
        </div>
      </div>`;
  }
  return `
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:9px;height:9px;border-radius:3px;background:${color};flex-shrink:0;"></div>
        <div style="font-size:12.5px;font-weight:600;color:var(--text-2);">${escHtml(name)}</div>
      </div>
      <div class="num" style="font-size:12.5px;font-weight:700;white-space:nowrap;">${fmtMoney(spentCents)} <span style="font-weight:500;color:var(--text-3);">${t("inicio.categorySpend.noLimit")}</span></div>
    </div>`;
}

/** Tarjeta "Gasto por categoría": donut + lista de categorías raíz con gasto, agrupando las que
 *  sobran más allá de DONUT_TOP_N en "Otras N" — réplica de
 *  docs/design/gasto-por-categoria/Inicio.dc.html.
 *
 *  El centro del donut muestra la SUMA DE LAS RAÍCES (= suma de los arcos), NO spentOfPeriod():
 *  un movimiento sin categorizar (category_id='') no cae bajo ninguna raíz (spentByRootCategory
 *  no lo agrupa) y por tanto no aparece en el anillo — si el centro mostrara el total del
 *  periodo, podría ser mayor que la suma de los arcos dibujados, dando la falsa impresión de que
 *  "falta" un trozo. Mostrando la suma de lo categorizado, el número del centro SIEMPRE coincide
 *  con el 100% del anillo.
 *
 *  La tarjeta ENTERA es el punto de entrada a la pantalla «Gasto por categoría» y se muestra
 *  SIEMPRE: antes solo había un enlace, y encima detrás de un gate (había que tener presupuestos
 *  este periodo) que dejaba la pantalla inalcanzable justo para quien todavía no ha puesto ningún
 *  límite — es decir, para quien más falta le hace entrar a ponerlos. Sin gasto categorizado se
 *  pinta la versión reducida: cabecera + texto vacío + pie.
 *
 *  Nada de role ARIA de botón ni tabindex en el contenedor: ese role marca sus hijos como
 *  Children Presentational en ARIA, así que Chrome/WebKit los sacan del árbol de accesibilidad —
 *  el total del centro del donut y el "X € de Y €" de cada fila desaparecerían para lectores de
 *  pantalla. En vez de eso, el .card entero se queda con onclick + cursor:pointer (tap en
 *  cualquier punto sigue navegando para ratón/dedo) y el pie "Ver por categoría →" es un
 *  <button> real: su click (de puntero o sintetizado por teclado) burbujea al onclick del
 *  contenedor, así que un solo listener basta y el foco de teclado/lector de pantalla aterriza en
 *  un control con nombre correcto. */
function gastoPorCategoriaHtml(rootRows, byId, budgetByCategory) {
  const headerHtml = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
      <div style="display:flex;flex-direction:column;gap:3px;">
        <div style="font-size:15px;font-weight:700;">${t("inicio.categorySpend.title")}</div>
        <div style="font-size:11px;color:var(--text-3);">${t("inicio.categorySpend.subtitle")}</div>
      </div>
      <div style="width:24px;height:24px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--text-2);">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"></path></svg>
      </div>
    </div>`;
  const footerHtml = `
    <hr class="divider">
    <div style="height:44px;display:flex;align-items:center;justify-content:center;">
      <button type="button" id="inicio-categoria-ver" class="link-btn" style="white-space:nowrap;">${t("inicio.categorySpend.viewAll")}</button>
    </div>`;
  const cardAttrs = `class="card" id="inicio-categoria-card"`;

  const withSpend = rootRows.filter((r) => r.spent_cents > 0);
  if (withSpend.length === 0) {
    return `
      <div ${cardAttrs} style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px;padding:16px 16px 8px;cursor:pointer;-webkit-tap-highlight-color:transparent;">
        ${headerHtml}
        <div style="font-size:12px;color:var(--text-3);">${t("inicio.categorySpend.empty")}</div>
        ${footerHtml}
      </div>`;
  }

  const top = withSpend.slice(0, DONUT_TOP_N);
  const rest = withSpend.slice(DONUT_TOP_N);
  const restTotal = rest.reduce((s, r) => s + r.spent_cents, 0);
  // El número del centro es el NETO de TODAS las raíces, incluidas las que quedan en negativo (una
  // devolución mayor que el gasto de su categoría): es exactamente la misma suma que el héroe de
  // «Gasto por categoría» (gasto-por-categoria.js#render), la pantalla que abre esta tarjeta.
  // Antes aquí se sumaban solo las positivas y las dos cifras no cuadraban.
  // Las PORCIONES del anillo siguen saliendo solo de las raíces con gasto > 0 (`withSpend`): una
  // porción de ángulo negativo no existe.
  const netTotal = rootRows.reduce((s, r) => s + r.spent_cents, 0);

  const slices = top.map((r) => ({ color: colorForCategory(r.root_id, byId), cents: r.spent_cents }));
  if (rest.length > 0) slices.push({ color: DONUT_OTHERS_COLOR, cents: restTotal });

  const rowsHtml = top
    .map((r) => categoriaDonutRowHtml(r.name, colorForCategory(r.root_id, byId), r.spent_cents, budgetByCategory[r.root_id] ?? 0))
    .join("");
  const otrasRowHtml = rest.length > 0 ? categoriaDonutRowHtml(t("inicio.categorySpend.others", { n: rest.length }), DONUT_OTHERS_COLOR, restTotal, 0) : "";

  return `
    <div ${cardAttrs} style="display:flex;flex-direction:column;gap:16px;margin-bottom:16px;padding:16px 16px 8px;cursor:pointer;-webkit-tap-highlight-color:transparent;">
      ${headerHtml}
      <div style="display:flex;justify-content:center;">
        ${donutSvg(slices, centsToStr(netTotal), t("inicio.categorySpend.spent", { currency: currencyCode() }))}
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        ${rowsHtml}${otrasRowHtml}
      </div>
      ${footerHtml}
    </div>`;
}

// SVG «chevron abajo» del repertorio (SISTEMA §3): abre el ciclo de cuentas del héroe.
const CHEVRON_DOWN_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9.5 12 16l7-6.5"></path></svg>`;

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

/** «Disponible del periodo» + «Hoy puedes gastar» (Main.dc.html:42-62, N7 §5.2). Sustituye a la
 *  antigua tarjeta «Disponible del periodo» v1. Oculto entero sin límites definidos (budgetTotal === 0) — la línea
 *  de «hoy puedes gastar» y «Te quedarán» (Task 9) comparten esa misma guarda. La barra se rellena
 *  con lo GASTADO, no con lo que queda (decisión 6). */
function disponibleHtml(budgetByCategory, spent, period, comprometidoCents, hoy) {
  const budgetTotal = Object.values(budgetByCategory).reduce((s, c) => s + c, 0);
  if (!budgetTotal) return "";
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
        <button type="button" id="inicio-hucha-action" style="border:0;background:transparent;color:var(--accent);font-size:14px;font-weight:600;padding:0;height:24px;cursor:pointer;-webkit-tap-highlight-color:transparent;">${t(actionKey)}</button>
        <button type="button" id="inicio-hucha-dismiss" style="border:0;background:transparent;color:var(--ink-3);font-size:14px;font-weight:500;padding:0;height:24px;cursor:pointer;-webkit-tap-highlight-color:transparent;">${t("inicio.hucha.dismiss")}</button>
      </div>
    </div>
  </div>`;
}

/** Pantalla Inicio: cabecera del periodo abierto (gastado, ingresos, ahorrado, tasa),
 *  tarjetas "Flujo de gasto" y "Gasto por categoría", bloque de compartidos (pendiente/liquidar),
 *  bloque "Previsión" (reglas recurrentes del mes) y sus movimientos agrupados por día. */
export async function renderInicio(container) {
  // Silueta gris mientras llega la primera consulta: antes la pantalla se quedaba EN BLANCO desde
  // que se tocaba la pestaña hasta que volvía el Worker.
  // Solo en el PRIMER pintado: un re-render (guardar el nombre de la contraparte, volver de una
  // subpantalla) tiene que repintar directo, sin un parpadeo gris de por medio. El testigo es
  // container.dataset.screen, que escriben SOLO esta pantalla y Movimientos — ninguna otra lo toca
  // (si alguna lo escribiera, las dos empezarían a parpadear cuando no toca).
  if (container.dataset.screen !== "inicio") {
    container.dataset.screen = "inicio";
    container.innerHTML = skeletonHtml([72, 168, 236, 320]);
  }
  const hoy = hoyISO();
  let period, spent, income, rows, byId, sharedRows, netCents, budgets, prevision, rootRows,
    cuentas, weekRootRows, recentDates, meta, partnerName, showPartnerBanner;
  try {
    period = await getOpenPeriod();
    if (!period) {
      container.innerHTML = `<div class="banner-aviso red">${t("common.noOpenPeriod")}</div>`;
      return;
    }
    // weekRange(hoy) da la MISMA ventana de 7 días que usan Semana y repo.fillLast7Days —
    // semana-logic.js es la única fuente, así que Inicio no puede llevar una tercera.
    const week = weekRange(hoy);
    [spent, income, rows, byId, sharedRows, netCents, budgets, prevision, rootRows,
      cuentas, weekRootRows, recentDates, meta] = await Promise.all([
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
    ]);
    partnerName = (meta.partner_name || "").trim();
    // Sin nombre, comprobamos si hay compartidos "huérfanos" (Task 5): con nombre ya configurado
    // no hace falta esta query extra — sharedBlockHtml decide solo con sharedRows/netCents.
    showPartnerBanner = !partnerName && await hasSharedData();
  } catch (e) {
    // userMessage: si el error está escrito para el usuario (un UserError) se enseña tal cual; si
    // es técnico (SQLite, un bug), se va a console.error y aquí queda el texto genérico. Sigue
    // pasando por escHtml porque va dentro de un innerHTML.
    container.innerHTML = `<div class="banner-aviso red">${t("inicio.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }

  const budgetByCategory = budgetMap(budgets);

  const ahorrado = income - spent;
  const tasa = income > 0 ? fmtPct(ahorrado / income) : "—";
  // Saludo por hora local (PR polish): sustituye la "Desde el ..." fija de la cabecera —
  // la fecha de inicio del periodo ya se ve en la línea pequeña vía "día N de M".
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
  const renewals = prevision.items
    .filter((it) => !it.paid && it.rule.type !== "income")
    // N6: cuando exista recurring_rules.is_subscription, aquí entra .filter(it => it.rule.is_subscription).
    .map((it) => ({ id: it.rule.id, name: it.rule.name, amountCents: it.myCents, dueDateIso: nextDueDateIso(it.rule, hoy) }))
    .filter((r) => r.dueDateIso != null)
    .sort((a, b) => a.dueDateIso.localeCompare(b.dueDateIso));
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

  // Ventana de 7 días en la forma {date,cents} que sigue esperando flujoDeGastoHtml (v1, todavía
  // sin tocar en este commit): se deriva de spentByDayAndRootCategory para no repetir la consulta
  // que ya se pidió arriba. La Task 9 sustituye este bloque entero por la espina de
  // semana-logic.js#daysWithCategories y esta variable desaparece con él.
  const totalsByDate = {};
  for (const r of weekRootRows) totalsByDate[r.date] = (totalsByDate[r.date] ?? 0) + r.cents;
  const days7 = weekRange(hoy).dates.map((date) => ({ date, cents: totalsByDate[date] ?? 0 }));

  const movimientosHtml = rows.length === 0
    ? `<div class="card" style="text-align:center;color:var(--text-3)">
        <p>${t("inicio.movements.empty")}</p></div>`
    : `<div class="card" style="display:flex;flex-direction:column;gap:16px;">
        <div class="section-title">${t("common.movements")}</div>
        <div style="display:flex;flex-direction:column;gap:12px;">
          ${groupByDay(rows).map((g) => `
            <div class="day-label">${g.date === hoy ? t("common.today") : fmtDiaLargo(g.date)}</div>
            ${g.rows.map((r) => txRowHtml(r, byId, partnerName)).join("")}
          `).join("")}
        </div>
      </div>`;

  container.innerHTML = `
    ${showPartnerBanner ? partnerBannerHtml() : ""}

    ${cabeceraHtml(period, hoy, saludo, racha)}

    ${cuentaActual ? heroCuentaHtml(cuentaActual, cuentas) : ""}

    ${disponibleHtml(budgetByCategory, spent, period, prevision.comprometidoCents, hoy)}

    ${huchaHtml(hucha)}

    <div class="card" style="display:flex;flex-direction:column;gap:4px;margin-bottom:16px;">
      <div class="section-title">${t("inicio.spent.title")}</div>
      <div class="amount-hero num">${moneyPartsHtml(spent)}</div>

      <hr class="divider" style="margin-top:8px;">

      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:8px;">
        <div style="display:flex;flex-direction:column;gap:5px;">
          <div style="font-size:11px;color:var(--text-3);">${t("inicio.spent.income")}</div>
          <div class="num text-green" style="font-size:15px;font-weight:600;">${fmtMoney(income)}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;">
          <div style="font-size:11px;color:var(--text-3);">${t("inicio.spent.saved")}</div>
          <div class="num ${ahorrado >= 0 ? "text-green" : "text-red"}" style="font-size:15px;font-weight:600;">${fmtMoney(ahorrado)}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;">
          <div style="font-size:11px;color:var(--text-3);">${t("inicio.spent.rate")}</div>
          <div class="num" style="font-size:15px;font-weight:600;">${tasa}</div>
        </div>
      </div>
    </div>

    ${flujoDeGastoHtml(days7)}

    ${gastoPorCategoriaHtml(rootRows, byId, budgetByCategory)}

    ${sharedBlockHtml(period, sharedRows, netCents, partnerName)}

    ${previsionHtml(prevision, byId)}

    ${movimientosHtml}
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
    container.querySelector("#inicio-hucha-dismiss").onclick = () => {
      huchaDismissed.add(hucha.key);
      renderInicio(container);
    };
    container.querySelector("#inicio-hucha-action").onclick = () => {
      if (hucha.kind === "renewal") {
        pushBack(() => renderInicio(container));
        renderRecurrentes(container, goBack);
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

  // Task 7 (6f): único botón Liquidar (antes también #disp-liquidar en la antigua tarjeta v1 de disponible, ver
  // comentario ahí) — un solo id, un solo listener.
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
