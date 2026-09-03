import {
  getOpenPeriod, spentOfPeriod, incomeOfPeriod, listByDay, allCategoriesById,
  pendingSettlements, pendingSettlementNetCents, budgetsOfPeriod, previsionOfPeriod,
  spentByRootCategory, spentLast7Days, getMetaAll, setMeta, hasSharedData,
} from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtMoney, fmtMoneyParts, fmtDiaLargo, fmtDiaCorto, fmtDiaIni, hoyISO, fmtNum2, fmtPct, currencyCode } from "../format.js";
import { dayIndexOfPeriod, expectedPeriodDays, paceDeltaCents } from "../prevision.js";
import { t } from "../i18n/index.js";
import { budgetStatus, budgetMap } from "../category-spend.js";
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

// Compone un importe con los céntimos reducidos en <small> (patrón .amount-hero del design
// system, ver DesignSystem.dc.html): main + <small>céntimos</small> + sufijo, sin reimplementar
// el locale — fmtMoneyParts (format.js) ya hace el split posicional sobre formatToParts.
const moneyPartsHtml = (cents) => {
  const { main, cents: c, suffix } = fmtMoneyParts(cents);
  return `${escHtml(main)}<small>${escHtml(c)}</small>${escHtml(suffix)}`;
};

// Cuántas categorías raíz se listan individualmente en el donut antes de agrupar el resto en
// "Otras N" — mismo criterio visual que docs/design/material-expresivo/Resumen.dc.html:139-213 (6 + "Otras 3").
const DONUT_TOP_N = 6;
// Mismo gris que DEFAULT_COLOR en category-colors.js — no se importa porque este módulo no
// tiene ninguna categoría real que resolver a "sin color", solo el grupo "Otras N".
const DONUT_OTHERS_COLOR = "#9A99A6";

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
      <div class="tx-amount num ${isNeg ? "negative" : "positive"}">${isNeg ? "-" : "+"}${fmtMoney(Math.abs(r.amount_cents))}</div>
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
      <div class="tx-amount num ${amountClass}">${sign}${fmtMoney(r.amount_cents)}</div>
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
  const color = rule.type === "transfer" ? "#9A99A6" : colorForCategory(rule.category_id, byId);
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

/** Tarjeta "Flujo de gasto": barChartSvg de los últimos 7 días naturales (hoy incluido y
 *  marcado como activo) — réplica de docs/design/material-expresivo/Resumen.dc.html:67-107. days7 viene de
 *  repo.spentLast7Days: 7 entradas {date, cents} ya rellenas con 0 en los días sin movimiento. */
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

/** Tarjeta "Disponible del periodo" (PR polish): presupuesto total del periodo menos lo
 *  gastado, con el ritmo del plan (paceDeltaCents, prevision.js: cuánto por encima o por debajo
 *  del gasto prorrateado a hoy). Se oculta entera si no hay presupuestos definidos este periodo
 *  (budgetTotal === 0).
 *
 *  Task 7 (6f): esta tarjeta llevaba TAMBIÉN su propio botón «Liquidar» (#disp-liquidar), con
 *  el mismo gate (partnerName && netCents distinto de 0) y el mismo handler que #shared-liquidar en
 *  sharedBlockHtml — un usuario con presupuestos definidos Y compartidos pendientes veía DOS
 *  botones «Liquidar» a la vez. Consolidado en uno solo: se queda en sharedBlockHtml (la tarjeta
 *  dedicada a compartidos, con nombre de la contraparte/reparto/importe pendiente ya de
 *  contexto — el botón encaja ahí de forma natural) y se retira de aquí, que es sobre el
 *  presupuesto, no sobre compartidos. */
// budgetByCategory (el mapa), no las filas en crudo: budgetsOfPeriod ya deja fuera los límites de
// categorías archivadas o borradas —sumarlos descontaba del disponible un presupuesto que el
// usuario no veía en ninguna lista— y budgetMap colapsa las parejas duplicadas que solo puede dejar
// una hoja editada a mano, que con reduce sobre las filas se contarían dos veces.
function disponibleCardHtml(budgetByCategory, spent, period) {
  const budgetTotal = Object.values(budgetByCategory).reduce((s, c) => s + c, 0);
  if (!budgetTotal) return "";
  const disp = budgetTotal - spent;
  const delta = paceDeltaCents(budgetTotal, spent, period.start_date, hoyISO());
  const over = delta > 0;
  const badge = `<span class="num" style="font-size:11px;font-weight:700;border-radius:999px;padding:4px 10px;color:${over ? "var(--amber)" : "var(--green)"};background:${over ? "rgba(255,190,77,0.14)" : "rgba(79,217,154,0.14)"};">${t(over ? "inicio.available.paceOver" : "inicio.available.paceUnder", { amount: escHtml(fmtMoney(Math.abs(delta))) })}</span>`;
  return `
  <section class="card" style="margin-bottom:16px;">
    <div class="section-title">${t("inicio.available.title")}</div>
    <div class="amount-hero num">${moneyPartsHtml(disp)}</div>
    <div class="num" style="font-size:12px;color:var(--text-2);">${t("inicio.available.ofBudgeted", { amount: escHtml(fmtMoney(budgetTotal)) })}</div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px;">${badge}</div>
  </section>`;
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
  let period, spent, income, rows, byId, sharedRows, netCents, budgets, prevision, rootRows, days7,
    meta, partnerName, showPartnerBanner;
  try {
    period = await getOpenPeriod();
    if (!period) {
      container.innerHTML = `<div class="banner-aviso red">${t("common.noOpenPeriod")}</div>`;
      return;
    }
    [spent, income, rows, byId, sharedRows, netCents, budgets, prevision, rootRows, days7, meta] = await Promise.all([
      spentOfPeriod(period.id),
      incomeOfPeriod(period.id),
      listByDay(period.id),
      allCategoriesById(),
      pendingSettlements(),
      pendingSettlementNetCents(),
      budgetsOfPeriod(period.id),
      previsionOfPeriod(period),
      spentByRootCategory(period.id),
      spentLast7Days(period.id),
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
  const hoy = hoyISO();
  // Saludo por hora local (PR polish): sustituye la "Desde el ..." fija de la cabecera —
  // la fecha de inicio del periodo ya se ve en la línea pequeña vía "día N de M".
  const h = new Date().getHours();
  const saludo = h < 7 ? t("inicio.greeting.evening") : h < 14 ? t("inicio.greeting.morning") : h < 21 ? t("inicio.greeting.afternoon") : t("inicio.greeting.evening");

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

    <button type="button" id="inicio-periodo-header" class="link-btn" style="color:inherit;display:flex;flex-direction:column;gap:2px;margin-bottom:14px;">
      <div style="font-size:12px;font-weight:500;color:var(--text-2);">${t("inicio.header.dayOf", { period: escHtml(period.name), day: dayIndexOfPeriod(period.start_date, hoy), total: expectedPeriodDays(period.start_date) })}</div>
      <div style="font-size:26px;font-weight:800;letter-spacing:-0.02em;">${saludo}</div>
    </button>

    ${disponibleCardHtml(budgetByCategory, spent, period)}

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

  // Task 7 (6f): único botón Liquidar (antes también #disp-liquidar en disponibleCardHtml, ver
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
      });
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
