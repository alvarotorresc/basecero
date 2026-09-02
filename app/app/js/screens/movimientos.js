import {
  listPeriods, listAllByDay, getTransaction, updateTransaction, softDeleteTransaction, countUncategorized,
  listExpenseLeafCategories, listIncomeCategories, listAccounts, allCategoriesById, hasActiveLinkedRefund,
  getMetaAll,
} from "../repo.js";
import { colorForCategory, iconForCategory, textColorForCategory, rootOf } from "../category-colors.js";
import { matchesFilter, isUncategorized } from "../movimientos-filter.js";
import { fmtMoney, fmtDiaLargo, hoyISO, currencySymbol, parseCentsRaw, centsToRaw } from "../format.js";
import { resolveAccountId } from "../account-defaults.js";
import { t } from "../i18n/index.js";
import { PCT_STEP, normalizePct, stepPct, splitCents } from "../share-pct.js";
import { pushBack, goBack } from "../back.js";

const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const needsCategory = (tipo) => tipo === "expense" || tipo === "income" || tipo === "refund";

/** ¿Es el detalle de un gasto compartido que pagó la contraparte? Gatea la sección de cuentas, el
 *  guard de validación y lo que se guarda — mismo criterio que registro.js#partnerPaid. */
const partnerPaid = (d) => d.type === "expense" && d.isShared && d.paidBy === "partner";

// TIPO_KEY guarda claves, no texto resuelto: es una const de módulo evaluada al importar el
// fichero (antes de que boot() llame a initI18n con el idioma real) — ver mismo comentario en
// registro.js#TIPOS/SAVE_KEY.
const TIPO_KEY = {
  expense: "common.type.expense", income: "common.type.income", transfer: "movimientos.type.transfer",
  refund: "common.type.refund", adjustment: "common.type.adjustment",
};

/** Agrupa las filas de listAllByDay (ya vienen ordenadas por date DESC) en bloques por día,
 *  preservando el orden de llegada (mismo patrón que inicio.js). */
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

// SVG del icono de transferencia — no existe ningún SVG de transferencia ya integrado en la app
// (recurrentes.js/inicio.js usan el emoji "⇄" como icono de sustitución); se copia tal cual del
// artboard de referencia (design/material-expresivo/Movimientos.dc.html:64-67), no se inventa.
// El color va en `style="stroke:..."` (no en el atributo de presentación `stroke="var(...)"`,
// que ningún otro SVG de la app usa con un custom property — ACCOUNT_ICON de patrimonio.js usa
// hex literal, ICON_BACK de registro.js usa currentColor) para no depender de que el motor de
// render resuelva var() dentro de un atributo de presentación SVG.
const ICON_TRANSFER = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="stroke:var(--text-2);" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10l-3 3 3 3M4 13h13M17 8l3-3-3-3M20 5H7"></path></svg>`;
// Icono "+" del dotico punteado de una fila sin categorizar (artboard Movimientos.dc.html:46-48).
const ICON_UNCAT = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" style="stroke:var(--text-2);" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>`;

function movRowHtml(r, byId, accById, partnerName) {
  if (r.type === "transfer") {
    const from = accById[r.account_id]?.name ?? "?";
    const to = accById[r.counter_account_id]?.name ?? "?";
    return `
    <button type="button" class="tx-row" data-tx="${r.id}" style="width:100%;text-align:left;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;">
      <div class="dotico" style="--cat:var(--card2);">${ICON_TRANSFER}</div>
      <div class="tx-body">
        <div class="tx-title">${escHtml(from)} → ${escHtml(to)}</div>
        <div class="tx-sub">${escHtml(r.merchant || r.note || t("movimientos.type.transfer"))}</div>
      </div>
      <div class="tx-amount num">${fmtMoney(r.amount_cents)}</div>
    </button>`;
  }
  if (r.type === "adjustment") {
    const isNeg = r.amount_cents < 0;
    return `
    <button type="button" class="tx-row" data-tx="${r.id}" style="width:100%;text-align:left;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;">
      <div class="dotico" style="--cat:var(--card2);">⚖️</div>
      <div class="tx-body">
        <div class="tx-title">${t("common.type.adjustment")}</div>
        <div class="tx-sub">${escHtml(r.merchant || r.note || "")}</div>
      </div>
      <div class="tx-amount num ${isNeg ? "negative" : "positive"}">${isNeg ? "-" : "+"}${fmtMoney(Math.abs(r.amount_cents))}</div>
    </button>`;
  }
  const cat = byId[r.category_id];
  const catName = cat?.name ?? "";
  const uncategorized = isUncategorized(r);
  const color = uncategorized ? "var(--card2)" : colorForCategory(r.category_id, byId);
  const icon = uncategorized ? ICON_UNCAT : iconForCategory(r.category_id, byId);
  const dashedStyle = uncategorized ? "border:1.5px dashed var(--rule);" : "";
  const title = r.merchant || catName || t("movimientos.uncategorized");
  const subBase = uncategorized ? t("movimientos.tapToCategorize") : (catName || t("movimientos.uncategorized"));
  const shareSuffix = !r.is_shared ? ""
    : r.paid_by === "partner"
      ? t("movimientos.row.partnerPaid", { name: partnerName || t("movimientos.shared.fallbackName"), amount: fmtMoney(r.my_amount_cents) })
      : t("common.myPartSuffix", { amount: fmtMoney(r.my_amount_cents) });
  const isExpense = r.type === "expense";
  // Un gasto que pagó la contraparte enseña el ticket entero (coherencia con el resto de la lista)
  // pero ATENUADO, no en rojo: ese dinero no salió de ninguna cuenta mía.
  const partnerPaidRow = isExpense && !!r.is_shared && r.paid_by === "partner";
  const amountClass = partnerPaidRow ? "" : isExpense ? "negative" : "positive";
  const amountStyle = partnerPaidRow ? ' style="color:var(--text-3);"' : "";
  const sign = isExpense ? "-" : "+";
  // filter/join en vez de interpolar amountClass directo: cuando está vacío (fila pagada por la
  // contraparte) no deja el atributo con un espacio final ("tx-amount num ").
  const amountClasses = ["tx-amount", "num", amountClass].filter(Boolean).join(" ");
  return `
  <button type="button" class="tx-row" data-tx="${r.id}" style="width:100%;text-align:left;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;">
    <div class="dotico" style="--cat:${color};${dashedStyle}">${icon}</div>
    <div class="tx-body">
      <div class="tx-title">${escHtml(title)}</div>
      <div class="tx-sub" style="${uncategorized ? "color:var(--amber);" : ""}">${escHtml(subBase)}${escHtml(shareSuffix)}</div>
    </div>
    <div class="${amountClasses}"${amountStyle}>${sign}${fmtMoney(r.amount_cents)}</div>
  </button>`;
}

/** Pantalla Movimientos: selector de periodo, bandeja de sin-categorizar y lista agrupada por día
 *  (los 5 tipos), con subvista de detalle para editar/borrar cada movimiento. */
export async function renderMovimientos(container) {
  let periods, expenseCats, incomeCats, accountsAll, byId, meta;
  try {
    [periods, expenseCats, incomeCats, accountsAll, byId, meta] = await Promise.all([
      listPeriods(), listExpenseLeafCategories(), listIncomeCategories(), listAccounts(), allCategoriesById(),
      getMetaAll(),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">${t("movimientos.error.load", { error: escHtml(e.message) })}</div>`;
    return;
  }
  if (periods.length === 0) {
    container.innerHTML = `<header class="screen-header"><h1 style="font-size:24px;font-weight:800;letter-spacing:-0.02em;">${t("common.movements")}</h1></header>
      <div class="banner-aviso red">${t("movimientos.noPeriods")}</div>`;
    return;
  }
  const accById = Object.fromEntries(accountsAll.map((a) => [a.id, a]));
  const partnerName = (meta.partner_name || "").trim();

  const state = {
    view: "list",
    periodId: periods.find((p) => p.status === "open")?.id ?? periods[0].id,
    rows: [],
    uncategorizedCount: 0,
    // Task 4: filtro cliente sobre state.rows (buscador + chips por categoría raíz). Los tres
    // campos se combinan con AND en matchesFilter (movimientos-filter.js); la UI garantiza que
    // rootCatId y uncat no estén activos a la vez (chips de selección única, ver wireList).
    // «Todos» = los tres en su valor neutro.
    filter: { query: "", rootCatId: null, uncat: false },
    // Muestra/oculta el input de búsqueda bajo la lupa del header — no forma parte del filtro en
    // sí (tener texto buscado con el input oculto sería confuso, así que cerrar limpia
    // filter.query, ver wireList#mov-search-toggle).
    searchOpen: false,
    detailId: null,
    detail: null,
    deleteConfirm: false,
    opening: false, // apertura de detalle en curso (ver openDetail)
  };
  let errorMsg = "";

  async function loadPeriodData() {
    [state.rows, state.uncategorizedCount] = await Promise.all([
      listAllByDay(state.periodId), countUncategorized(state.periodId),
    ]);
    // sin esto, categorizar/borrar el último movimiento sin categorizar con el filtro activo
    // deja la lista vacía sin forma de volver: el chip desaparece (count=0) pero el filtro seguía activo.
    if (state.uncategorizedCount === 0) state.filter.uncat = false;
    // mismo invariante para la chip de categoría raíz activa: si el último movimiento de esa raíz
    // se recategoriza/borra, su chip desaparece de presentRootCats() (ya no hay nada que mostrar
    // en ella) pero el filtro seguía activo — la lista se quedaría vacía con ninguna chip marcada.
    if (state.filter.rootCatId && !presentRootCats().includes(state.filter.rootCatId)) state.filter.rootCatId = null;
  }

  function categoriesFor(tipo) {
    if (tipo === "income") return incomeCats;
    if (needsCategory(tipo)) return expenseCats;
    return [];
  }

  /** Categorías raíz presentes en las rows cargadas del periodo (Task 4): una chip por cada una,
   *  en orden de primera aparición (listAllByDay ya viene ordenado por fecha desc). transfer/
   *  adjustment y filas sin categoría quedan fuera — no aportan chip de categoría (las sin
   *  categoría tienen su propia chip "Sin categoría · N", ver renderList). */
  function presentRootCats() {
    const seen = new Set();
    const out = [];
    for (const r of state.rows) {
      if (!needsCategory(r.type) || r.category_id === "") continue;
      const root = rootOf(r.category_id, byId);
      if (!seen.has(root)) { seen.add(root); out.push(root); }
    }
    return out;
  }

  function updateDetail(patch) {
    Object.assign(state.detail, patch);
    state.deleteConfirm = false;
    render();
  }

  async function openDetail(id) {
    // Guard de apertura en curso: la lista sigue viva durante el await, y dos toques seguidos
    // apuntarían DOS entradas de historial para una sola vista abierta.
    if (state.opening) return;
    state.opening = true;
    let row;
    try {
      row = await getTransaction(id);
    } catch (e) {
      errorMsg = t("movimientos.error.openDetail", { error: e.message });
      state.opening = false;
      render();
      return;
    }
    if (!row) { state.opening = false; return; }
    state.detailId = id;
    state.deleteConfirm = false;
    state.detail = {
      type: row.type,
      raw: centsToRaw(row.amount_cents),
      cents: Math.abs(row.amount_cents),
      sign: row.amount_cents < 0 ? "-" : "+",
      categoryId: row.category_id || null,
      accountId: row.account_id,
      counterAccountId: row.counter_account_id,
      isShared: !!row.is_shared,
      paidBy: row.paid_by,
      // Fija en apertura si el movimiento YA era compartido, distinto del isShared vivo que cambia
      // con el toggle: gatea la visibilidad del bloque compartido para que no desaparezca al desmarcar
      // sin contraparte configurada, dejando al usuario sin forma de volver a marcarlo antes de guardar.
      wasShared: !!row.is_shared,
      // El override manda; si no hay (null), el % del periodo del propio gasto (no el abierto).
      sharePct: normalizePct(row.share_pct_override ?? periods.find((p) => p.id === row.period_id)?.my_share_pct, 100),
      fecha: row.date,
      merchant: row.merchant,
      note: row.note,
      refId: row.ref_id,
      ruleId: row.rule_id,
    };
    state.linkedRefund = null;
    // El apunte de liquidación tiene DOS formas desde Task 3: la devolución ENTRANTE (refund) y el
    // ajuste SALIENTE (adjustment con ref_id, el que se crea cuando pagó ella). Los dos apuntan a un
    // gasto por ref_id y los dos los cubre refundAmountLocked en repo.js.
    if ((row.type === "refund" || row.type === "adjustment") && row.ref_id) {
      try { state.linkedRefund = await getTransaction(row.ref_id); } catch { state.linkedRefund = null; }
    }
    // Task 17 ronda 2 (controller ruling, finding A): un gasto ya liquidado con la contraparte (settled=1
    // Y con un refund activo enlazado) bloquea importe/compartido — editar el importe aquí sin
    // tocar el refund deja la deuda con la contraparte mal calculada y sin nada pendiente que lo delate.
    state.detail.settledLocked = row.type === "expense" && !!row.settled
      && (await hasActiveLinkedRefund(id).catch(() => false));
    // Task 7 (5d): espejo en UI del guard refundAmountLocked (repo.js) — el lado del REFUND. Si el
    // gasto enlazado ya está settled, bajar aquí el importe del refund descuadra la deuda liquidada
    // en silencio (el guard de repo lo rechazaría en save, pero mejor prevenirlo en el input).
    state.detail.refundLocked = (row.type === "refund" || row.type === "adjustment") && !!state.linkedRefund?.settled;
    pushBack(backToList);
    state.view = "detail";
    errorMsg = "";
    state.opening = false;
    render();
  }

  function backToList() {
    state.view = "list";
    state.detailId = null;
    state.detail = null;
    errorMsg = "";
    render();
  }

  function validationError() {
    const d = state.detail;
    // Guard que el detalle no tenía: desmarcar «Compartido» en una fila que pagó la contraparte
    // (guardada con account_id='') devuelve la cuenta al juego y hay que exigirla — si no, el save
    // escribiría un gasto mío sin cuenta.
    if (d.type === "expense" && !partnerPaid(d) && !d.accountId) return t("common.needAccount");
    if (d.type === "transfer") {
      if (d.cents <= 0) return t("common.enterAmount");
      if (!d.counterAccountId || d.counterAccountId === d.accountId) return t("common.pickTwoAccounts");
      return "";
    }
    if (d.type === "adjustment") return d.cents <= 0 ? t("common.enterAmount") : "";
    if (d.cents <= 0 && !d.categoryId) return t("common.enterAmountAndCategory");
    if (d.cents <= 0) return t("common.enterAmount");
    if (!d.categoryId) return t("common.pickCategory");
    return "";
  }

  function renderAccountsSection(d) {
    // Un gasto que pagó la contraparte no tiene cuenta que elegir: el dinero no salió de mi banco.
    if (partnerPaid(d)) return "";
    const accounts = accountsAll.filter((a) => a.type !== "liability");
    if (d.type === "transfer") {
      return `
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">${t("common.from")}</div>
        <div class="chips">
          ${accounts.map((a) => `<button type="button" class="chip${d.accountId === a.id ? " active" : ""}" data-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">${t("common.to")}</div>
        <div class="chips">
          ${accountsAll.filter((a) => a.id !== d.accountId).map((a) => `<button type="button" class="chip${d.counterAccountId === a.id ? " active" : ""}" data-counter-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
        </div>
      </div>`;
    }
    return `
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
      <div class="section-title">${d.type === "refund" ? t("common.destAccount") : t("common.account")}</div>
      <div class="chips">
        ${accounts.map((a) => `<button type="button" class="chip${d.accountId === a.id ? " active" : ""}" data-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
      </div>
    </div>`;
  }

  function renderDetail() {
    const d = state.detail;
    const cats = categoriesFor(d.type);
    const { mine: myCents, partner: partnerCents } = d.isShared ? splitCents(d.cents, d.sharePct) : { mine: d.cents, partner: 0 };
    const locked = !!d.settledLocked;
    // Task 7 (5d): además de `locked` (lado del gasto), el importe del apunte de liquidación
    // (refund entrante o adjustment saliente) se bloquea si su gasto enlazado ya está settled —
    // ver refundLocked en openDetail.
    const amountLocked = locked || !!d.refundLocked;

    const prevChipsScroll = container.querySelector(".chips-scroll")?.scrollLeft;

    container.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;">
        <button type="button" class="icon-btn" id="mov-back" aria-label="${t("common.goBack")}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"></path></svg></button>
        <h1 style="font-size:19px; font-weight:700; letter-spacing:-0.01em;">${t(TIPO_KEY[d.type])}</h1>
        <span style="width:36px;"></span>
      </div>

      ${locked ? `
      <div class="banner-aviso" style="margin-bottom:18px;">
        <p>${t("movimientos.detail.lockedNote")}</p>
      </div>` : ""}

      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px;">
        <div class="section-title">${t("common.amount")}</div>
        <div class="amount-display" style="align-items:center;">
          ${d.type === "adjustment" ? `<button type="button" class="icon-btn" id="mov-sign" aria-label="${t("common.changeSign")}" style="font-size:18px; font-weight:700;${amountLocked ? "opacity:.5;" : ""}" ${amountLocked ? "disabled" : ""}>${d.sign}</button>` : ""}
          <input type="text" inputmode="decimal" id="mov-raw" value="${escAttr(d.raw)}" placeholder="0" ${amountLocked ? "disabled" : ""}
            style="border:0;background:none;color:var(--text);font:600 56px var(--font-num);letter-spacing:-0.02em;width:100%;outline:none;${amountLocked ? "opacity:.5;" : ""}">
          <span class="amount-currency">${currencySymbol()}</span>
        </div>
        <hr class="divider" style="margin-top:6px;">
      </div>

      ${cats.length ? `
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">${t("common.category")}</div>
        <div class="chips-scroll">
          ${cats.map((c) => {
            const color = colorForCategory(c.id, byId);
            const icon = iconForCategory(c.id, byId);
            const active = d.categoryId === c.id;
            return `<button type="button" class="chip-v${active ? " active" : ""}" data-cat="${c.id}" style="--cat:${color};">
              <span class="chip-icon">${icon}</span><span>${escHtml(c.name)}</span>
            </button>`;
          }).join("")}
        </div>
      </div>` : ""}

      ${renderAccountsSection(d)}

      ${d.type === "refund" && state.linkedRefund ? `
      <div class="card" style="padding:12px 14px; margin-bottom:18px;">
        <div style="font-size:10px; color:var(--text-3);">${t("common.linkedTo")}</div>
        <div style="font-size:14px; font-weight:600;">
          ${escHtml(state.linkedRefund.merchant || byId[state.linkedRefund.category_id]?.name || t("common.type.expense"))} · ${fmtMoney(state.linkedRefund.amount_cents)}
        </div>
      </div>` : ""}

      <div style="display:flex; gap:8px; margin-bottom:12px;">
        <label class="field field-stack" style="flex:1;">
          <span class="field-label">${t("common.merchant")}</span>
          <input type="text" id="mov-merchant" value="${escAttr(d.merchant)}" placeholder="${t("common.optional")}">
        </label>
        <label class="field field-stack" style="flex:1;">
          <span class="field-label">${t("common.date")}</span>
          <input type="date" id="mov-fecha" value="${escAttr(d.fecha)}">
        </label>
      </div>
      <label class="field field-stack" style="margin-bottom:18px;">
        <span class="field-label">${t("common.note")}</span>
        <input type="text" id="mov-note" value="${escAttr(d.note)}" placeholder="${t("common.optional")}">
      </label>

      ${needsCategory(d.type) && d.type !== "income" && (d.wasShared || partnerName) ? `
      <div class="card" style="padding:0 16px; margin-bottom:18px;">
        <label style="height:56px; display:flex; align-items:center; justify-content:space-between; gap:12px; cursor:${locked ? "default" : "pointer"};${locked ? "opacity:.5;" : ""}">
          <span style="font-size:15px; font-weight:600;">${t("common.sharedWith", { name: escHtml(partnerName) || t("movimientos.shared.fallbackName") })}</span>
          <span class="toggle">
            <input type="checkbox" id="mov-shared" ${d.isShared ? "checked" : ""} ${locked ? "disabled" : ""}>
            <span class="toggle-track"><span class="toggle-knob"></span></span>
          </span>
        </label>
        ${d.isShared ? `
        <div style="display:flex; flex-direction:column; gap:10px; padding:0 0 14px;${locked ? "opacity:.5;" : ""}">
          ${d.type === "expense" ? `
          <div style="display:flex; flex-direction:column; gap:6px;">
            <div class="section-title">${t("common.paidBy.label")}</div>
            <div class="segmented" style="border-radius:999px;">
              <button type="button" data-paidby="me" class="${d.paidBy === "me" ? "active" : ""}" ${locked ? "disabled" : ""}
                style="flex:1;border-radius:999px;${d.paidBy === "me" ? "background:var(--card2);color:var(--text);font-weight:700;" : ""}">${t("common.paidBy.me")}</button>
              <button type="button" data-paidby="partner" class="${d.paidBy === "partner" ? "active" : ""}" ${locked ? "disabled" : ""}
                style="flex:1;border-radius:999px;${d.paidBy === "partner" ? "background:var(--card2);color:var(--text);font-weight:700;" : ""}">${t("common.paidBy.partner", { name: escHtml(partnerName) || t("movimientos.shared.fallbackName") })}</button>
            </div>
          </div>` : ""}
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="flex:1; min-width:0;">
              <div style="font-size:14px; font-weight:600;">${t("common.split.label")}</div>
              <div style="font-size:11px; color:var(--text-3);">${t("common.split.hint", { name: escHtml(partnerName || t("movimientos.shared.fallbackName")), pct: 100 - d.sharePct })}</div>
            </div>
            <button type="button" id="mov-pct-down" class="stepper-btn lg" aria-label="${t("common.split.decreaseAria")}" ${locked ? "disabled" : ""}>−</button>
            <div class="num" style="font-size:20px; font-weight:700; width:56px; text-align:center; flex-shrink:0;">${d.sharePct} %</div>
            <button type="button" id="mov-pct-up" class="stepper-btn lg" aria-label="${t("common.split.increaseAria")}" ${locked ? "disabled" : ""}>+</button>
          </div>
          <div style="display:flex; gap:8px;">
            <div style="flex:1; background:var(--card2); border-radius:14px; padding:10px 11px;">
              <div style="font-size:10px; color:var(--text-3);">${t("common.myShare", { pct: d.sharePct })}</div>
              <div class="num" id="mov-split-mine" style="font-size:15px; font-weight:600;">${fmtMoney(myCents)}</div>
            </div>
            <div style="flex:1; background:var(--card2); border-radius:14px; padding:10px 11px;">
              <div style="font-size:10px; color:var(--text-3);">${partnerPaid(d) ? t("common.paidFull", { name: escHtml(partnerName) || t("movimientos.shared.fallbackLabel") }) : `${escHtml(partnerName) || t("movimientos.shared.fallbackLabel")} · ${100 - d.sharePct}%`}</div>
              <div class="num" id="mov-split-partner" style="font-size:15px; font-weight:600; color:var(--text-2);">${fmtMoney(partnerPaid(d) ? d.cents : partnerCents)}</div>
            </div>
          </div>
        </div>` : ""}
      </div>` : ""}

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      <button type="button" class="btn-primary" id="mov-save" style="margin-bottom:10px;">${t("common.save")}</button>
      <button type="button" id="mov-delete"
        style="width:100%;background:${state.deleteConfirm ? "var(--red)" : "transparent"};color:${state.deleteConfirm ? "#fff" : "var(--red)"};
          border:1px solid var(--red);border-radius:var(--radius-sm);padding:16px;font:600 16px var(--font-ui);cursor:pointer;">
        ${state.deleteConfirm ? t("movimientos.delete.confirm") : t("movimientos.delete.button")}
      </button>
    `;

    if (prevChipsScroll != null) {
      const chipsEl = container.querySelector(".chips-scroll");
      if (chipsEl) chipsEl.scrollLeft = prevChipsScroll;
    }

    wireDetail();
  }

  function wireDetail() {
    const d = state.detail;
    container.querySelector("#mov-back").onclick = () => goBack();

    container.querySelectorAll("[data-cat]").forEach((b) => {
      b.onclick = () => updateDetail({ categoryId: b.dataset.cat });
    });
    container.querySelectorAll("[data-acc]").forEach((b) => {
      b.onclick = () => updateDetail({
        accountId: b.dataset.acc,
        counterAccountId: d.counterAccountId === b.dataset.acc ? "" : d.counterAccountId,
      });
    });
    container.querySelectorAll("[data-counter-acc]").forEach((b) => {
      b.onclick = () => updateDetail({ counterAccountId: b.dataset.counterAcc });
    });

    const signBtn = container.querySelector("#mov-sign");
    if (signBtn) signBtn.onclick = () => updateDetail({ sign: d.sign === "+" ? "-" : "+" });

    container.querySelector("#mov-raw").oninput = (e) => {
      d.raw = e.target.value;
      d.cents = parseCentsRaw(d.raw);
      errorMsg = "";
      state.deleteConfirm = false;
      // No se llama a render() aquí (perdería el foco/cursor del input mientras se escribe), pero
      // el preview "Tu parte / contraparte" de un gasto compartido se queda con el importe viejo si no se
      // actualiza a mano — parche puntual de los dos nodos en vez de un re-render completo.
      const mineEl = container.querySelector("#mov-split-mine");
      const partnerEl = container.querySelector("#mov-split-partner");
      if (d.isShared && mineEl && partnerEl) {
        const { mine: myCents, partner: partnerCents } = splitCents(d.cents, d.sharePct);
        mineEl.textContent = fmtMoney(myCents);
        partnerEl.textContent = fmtMoney(partnerPaid(d) ? d.cents : partnerCents);
      }
    };
    container.querySelector("#mov-merchant").oninput = (e) => { d.merchant = e.target.value; state.deleteConfirm = false; };
    container.querySelector("#mov-note").oninput = (e) => { d.note = e.target.value; state.deleteConfirm = false; };
    container.querySelector("#mov-fecha").onchange = (e) => updateDetail({ fecha: e.target.value || hoyISO() });

    const sharedToggle = container.querySelector("#mov-shared");
    if (sharedToggle) sharedToggle.onchange = (e) => updateDetail({ isShared: e.target.checked });

    container.querySelectorAll("[data-paidby]").forEach((b) => {
      b.onclick = () => {
        const paidBy = b.dataset.paidby;
        // Volver a «Pagué yo» en una fila guardada sin cuenta: se precarga la cuenta por defecto
        // para que el guard de validationError no deje al usuario sin salida.
        const accounts = accountsAll.filter((a) => a.type !== "liability");
        updateDetail({
          paidBy,
          accountId: paidBy === "me" ? (d.accountId || resolveAccountId(meta.default_account_id, accounts) || "") : d.accountId,
        });
      };
    });

    const pctDown = container.querySelector("#mov-pct-down");
    if (pctDown) pctDown.onclick = () => updateDetail({ sharePct: stepPct(d.sharePct, -PCT_STEP) });
    const pctUp = container.querySelector("#mov-pct-up");
    if (pctUp) pctUp.onclick = () => updateDetail({ sharePct: stepPct(d.sharePct, PCT_STEP) });

    container.querySelector("#mov-save").onclick = async () => {
      const btn = container.querySelector("#mov-save");
      const msg = validationError();
      if (msg) {
        errorMsg = msg;
        render();
        const savedBtn = container.querySelector("#mov-save");
        savedBtn.classList.add("shake");
        setTimeout(() => savedBtn.classList.remove("shake"), 400);
        return;
      }
      btn.disabled = true;
      try {
        const withCategory = needsCategory(d.type);
        await updateTransaction(state.detailId, {
          type: d.type,
          amountCents: d.type === "adjustment" && d.sign === "-" ? -d.cents : d.cents,
          date: d.fecha,
          categoryId: withCategory ? d.categoryId : "",
          // Un gasto que pagó la contraparte no toca ninguna cuenta mía hasta liquidar (el repo
          // además lo blanquea por su cuenta, pero el payload no debe contradecirlo).
          accountId: partnerPaid(d) ? "" : d.accountId,
          counterAccountId: d.type === "transfer" ? d.counterAccountId : "",
          merchant: d.merchant,
          note: d.note,
          isShared: withCategory && d.type !== "income" ? d.isShared : false,
          // Locked (gasto liquidado con apunte enlazado): se deja undefined para que updateTransaction
          // conserve el valor guardado — si mandáramos d.sharePct explícito, un gasto antiguo con override
          // NULL dispararía sharedFieldsLocked al editar solo la nota o la fecha.
          sharePctOverride: d.settledLocked ? undefined : (withCategory && d.type !== "income" && d.isShared ? d.sharePct : null),
          // Mismo motivo que sharePctOverride: undefined conserva el paid_by guardado. Desmarcar
          // «Compartido» cae a "me" — el guard del repo rechazaría un 'partner' sin is_shared.
          paidBy: d.settledLocked ? undefined : (withCategory && d.type === "expense" && d.isShared ? d.paidBy : "me"),
          refId: d.refId,
          ruleId: d.ruleId,
        });
        await loadPeriodData();
        goBack();
      } catch (e) {
        btn.disabled = false;
        errorMsg = t("common.saveFailed", { error: e.message });
        render();
      }
    };

    container.querySelector("#mov-delete").onclick = async () => {
      if (!state.deleteConfirm) {
        state.deleteConfirm = true;
        render();
        return;
      }
      const btn = container.querySelector("#mov-delete");
      btn.disabled = true;
      try {
        await softDeleteTransaction(state.detailId);
        await loadPeriodData();
        goBack();
      } catch (e) {
        btn.disabled = false;
        errorMsg = t("movimientos.error.delete", { error: e.message });
        state.deleteConfirm = false;
        render();
      }
    };
  }

  /** Cuerpo de la lista (día a día o vacío) filtrado con matchesFilter — Task 4. Vive en su propio
   *  contenedor (#mov-list-body, ver renderList) para poder refrescarlo solo a él desde el
   *  buscador sin recrear cabecera/chips/input: eso es lo que mantiene el foco/cursor del input
   *  mientras se escribe (mismo motivo que el parche puntual de #mov-raw más abajo). */
  function listBodyHtml() {
    const hoy = hoyISO();
    const visible = state.rows.filter((r) => matchesFilter(r, state.filter, byId));

    if (visible.length === 0) {
      // query primero: si hay texto buscado, "no hay coincidencias" es el mensaje relevante aunque
      // la chip "Sin categoría" también esté activa (query+uncat se combinan con AND en
      // matchesFilter) — solo sin query el vacío se atribuye a la chip de categoría.
      const msg = state.rows.length === 0
        ? t("movimientos.empty.noPeriod")
        : state.filter.query
          ? t("movimientos.empty.noResults")
          : state.filter.uncat
            ? t("movimientos.empty.noUncategorized")
            : t("movimientos.empty.noResults");
      return `<div class="card" style="text-align:center;color:var(--text-3)"><p>${msg}</p></div>`;
    }
    return `<div class="card" style="display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;flex-direction:column;gap:12px;">
          ${groupByDay(visible).map((g) => `
            <div class="day-label">${g.date === hoy ? t("common.today") : fmtDiaLargo(g.date)}</div>
            ${g.rows.map((r) => movRowHtml(r, byId, accById, partnerName)).join("")}
          `).join("")}
        </div>
      </div>`;
  }

  function wireListBody() {
    container.querySelectorAll("#mov-list-body [data-tx]").forEach((b) => {
      b.onclick = () => openDetail(b.dataset.tx);
    });
  }

  /** Refresca SOLO #mov-list-body (sin tocar cabecera/chips/input de búsqueda) — ver comentario de
   *  listBodyHtml. Es lo que llama el oninput del buscador en vez de render(). */
  function refreshListBody() {
    const body = container.querySelector("#mov-list-body");
    if (!body) return;
    body.innerHTML = listBodyHtml();
    wireListBody();
  }

  function renderList() {
    const rootCats = presentRootCats();
    const allActive = !state.filter.rootCatId && !state.filter.uncat;

    // Chips por categoría raíz (artboard Movimientos.dc.html:32-35): activa = tinta invertida
    // (.chip.active del sistema). Un color inline SIEMPRE gana sobre una regla de clase, así que
    // fijar style="color:X" también cuando está activa taparía el color:var(--bg) de .chip.active
    // y rompería la inversión — por eso el textColorForCategory de la raíz solo se fija inline
    // cuando la chip NO está activa; sin tinte de fondo (a diferencia de .chip-icon, que sí lleva
    // círculo — el artboard aquí es texto plano con el emoji delante).
    const catChipsHtml = rootCats.map((catId) => {
      const active = state.filter.rootCatId === catId;
      const icon = iconForCategory(catId, byId);
      const name = byId[catId]?.name ?? "";
      const color = textColorForCategory(catId, byId);
      return `<button type="button" class="chip${active ? " active" : ""}" data-chip-cat="${catId}" style="padding:0 14px;${active ? "" : `color:${color};`}">${icon} ${escHtml(name)}</button>`;
    }).join("");

    // Chip "Sin categoría · N" (artboard Movimientos.dc.html:35): activa = tinta invertida;
    // inactiva = borde discontinuo --rule, padding simétrico porque no lleva icono (mismo criterio
    // que ya tenía antes de Task 4).
    const uncatChipHtml = state.uncategorizedCount > 0
      ? `<button type="button" data-chip-uncat class="chip${state.filter.uncat ? " active" : ""}" style="padding:0 14px;${state.filter.uncat ? "" : "background:transparent;border:1px dashed var(--rule);"}">${t("movimientos.uncategorizedChip", { n: state.uncategorizedCount })}</button>`
      : "";

    container.innerHTML = `
      <header class="screen-header" style="flex-direction:row;align-items:center;justify-content:space-between;">
        <h1 style="font-size:24px;font-weight:800;letter-spacing:-0.02em;">${t("common.movements")}</h1>
        <button type="button" class="icon-btn" id="mov-search-toggle" aria-label="${t("movimientos.search.toggle")}">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"></circle><path d="M20 20l-4.2-4.2"></path></svg>
        </button>
      </header>

      ${state.searchOpen ? `
      <label class="field field-stack" style="margin-bottom:14px;">
        <span class="field-label">${t("movimientos.search.label")}</span>
        <input type="text" id="mov-search-input" value="${escAttr(state.filter.query)}" placeholder="${t("movimientos.search.placeholder")}">
      </label>` : ""}

      <label class="field field-stack" style="margin-bottom:14px;">
        <span class="field-label">${t("movimientos.periodLabel")}</span>
        <select id="mov-period">
          ${periods.map((p) => `<option value="${p.id}" ${p.id === state.periodId ? "selected" : ""}>${escHtml(p.name)}</option>`).join("")}
        </select>
      </label>

      <div class="chips-row" style="margin-bottom:14px;">
        <button type="button" data-chip-all class="chip${allActive ? " active" : ""}" style="padding:0 14px;">${t("movimientos.chipAll")}</button>
        ${catChipsHtml}
        ${uncatChipHtml}
      </div>

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      <div id="mov-list-body">${listBodyHtml()}</div>
    `;
    wireList();
  }

  function wireList() {
    container.querySelector("#mov-period").onchange = async (e) => {
      state.periodId = e.target.value;
      state.filter = { query: "", rootCatId: null, uncat: false };
      state.searchOpen = false;
      try {
        await loadPeriodData();
      } catch (err) {
        errorMsg = t("movimientos.error.loadPeriod", { error: err.message });
      }
      render();
    };

    const searchToggle = container.querySelector("#mov-search-toggle");
    if (searchToggle) searchToggle.onclick = () => {
      const opening = !state.searchOpen;
      state.searchOpen = opening;
      // cerrar sin limpiar dejaría un filtro activo invisible (el input desaparece pero
      // filter.query seguiría filtrando la lista sin ninguna pista de por qué).
      if (!opening) state.filter.query = "";
      render();
      if (opening) container.querySelector("#mov-search-input")?.focus();
    };

    const searchInput = container.querySelector("#mov-search-input");
    if (searchInput) searchInput.oninput = (e) => {
      state.filter.query = e.target.value;
      // NO se llama a render() aquí (perdería el foco/cursor del input mientras se escribe, mismo
      // motivo que el oninput de #mov-raw en wireDetail): se refresca solo #mov-list-body.
      refreshListBody();
    };

    const chipAll = container.querySelector("[data-chip-all]");
    if (chipAll) chipAll.onclick = () => {
      state.filter.rootCatId = null;
      state.filter.uncat = false;
      render();
    };

    container.querySelectorAll("[data-chip-cat]").forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.chipCat;
        // tocar la chip ya activa vuelve a «Todos» (mismo toggle que ya tenía "Sin categoría").
        state.filter.rootCatId = state.filter.rootCatId === id ? null : id;
        state.filter.uncat = false;
        render();
      };
    });

    const chipUncat = container.querySelector("[data-chip-uncat]");
    if (chipUncat) chipUncat.onclick = () => {
      state.filter.uncat = !state.filter.uncat;
      if (state.filter.uncat) state.filter.rootCatId = null;
      render();
    };

    wireListBody();
  }

  function render() {
    if (state.view === "detail") renderDetail();
    else renderList();
  }

  try {
    await loadPeriodData();
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">${t("movimientos.error.load", { error: escHtml(e.message) })}</div>`;
    return;
  }
  render();
}
