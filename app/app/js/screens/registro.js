import {
  addTransaction, getOpenPeriod, listExpenseLeafCategories, listIncomeCategories,
  listAccounts, allCategoriesById, recentForRefund, getMetaAll, softDeleteTransaction,
  loadMerchantMemory,
} from "../repo.js";
import { colorForCategory, iconForCategory, textColorForCategory } from "../category-colors.js";
import { fmtMoney, fmtMoneyParts, fmtDiaCorto, hoyISO, currencySymbol, parseCentsRaw, centsToRaw } from "../format.js";
import { resolveAccountId } from "../account-defaults.js";
import { t } from "../i18n/index.js";
import { PCT_STEP, normalizePct, stepPct, splitCents } from "../share-pct.js";
import { userMessage } from "../errors.js";
import { focusInput } from "../viewport.js";
import { showReceipt } from "../recibo.js";
import { showToast } from "../toast.js";
import { quickRegisterEnabled, detailsOpen, foldedSummaryParts, visibleCategories } from "../registro-mode.js";
import { normalizeMerchant, memoryPatch } from "../merchant-memory.js";

// labelKey/SAVE_KEY en vez de texto resuelto: son consts de módulo, evaluadas al importar el
// fichero (antes de que boot() llame a initI18n con el idioma real) — si guardaran el string ya
// traducido, quedarían congeladas en español para siempre. Se resuelven con t() en cada render.
const TIPOS = [
  { id: "expense", labelKey: "common.type.expense" },
  { id: "income", labelKey: "common.type.income" },
  { id: "transfer", labelKey: "registro.type.transfer" },
  { id: "refund", labelKey: "common.type.refund" },
  { id: "adjustment", labelKey: "common.type.adjustment" },
];
const SAVE_KEY = {
  expense: "registro.save.expense", income: "registro.save.income", transfer: "registro.save.transfer",
  refund: "registro.save.refund", adjustment: "registro.save.adjustment",
};
const needsCategory = (tipo) => tipo === "expense" || tipo === "income" || tipo === "refund";
// §4.2 de la spec: dos filas de cuatro (Registro.dc.html). El literal vive aquí, no en
// registro-mode.js — el módulo puro solo decide CUÁNTAS entran, no el número en sí.
const CATS_GRID_LIMIT = 8;

const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Monta la pantalla completa de registro rápido de un movimiento (5 tipos).
 *  onDone() se llama tanto al cerrar (✕) como tras guardar con éxito.
 *  prefill opcional (Task 11): {type, amountCents, categoryId, accountId, merchant, ruleId, isShared}.
 *  onUndone opcional (reskin v2, Task 12): refresca la pantalla de detrás cuando se pulsa
 *  «Deshacer» en el recibo — sin esto, el movimiento borrado se queda pintado hasta la siguiente
 *  navegación. */
export async function renderRegistro(container, onDone, prefill, onUndone) {
  let period, expenseCats, incomeCats, accountsAll, byId, meta, merchantMemoryMap;
  try {
    [period, expenseCats, incomeCats, accountsAll, byId, meta, merchantMemoryMap] = await Promise.all([
      getOpenPeriod(),
      listExpenseLeafCategories(),
      listIncomeCategories(),
      listAccounts(),
      allCategoriesById(),
      getMetaAll(),
      loadMerchantMemory(),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">${t("registro.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }

  // Registro v2 §5.4: opciones del <datalist> nativo, ordenadas por uso (count desc) y luego por
  // la más reciente, cap 200 — no cambian durante la sesión de este formulario, así que se
  // calculan UNA vez y no en cada render().
  const merchantOptions = Object.values(merchantMemoryMap)
    .sort((a, b) => b.count - a.count || String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)))
    .slice(0, 200);

  let refundCandidates = [];
  if (period) {
    try { refundCandidates = await recentForRefund(period.id); } catch { refundCandidates = []; }
  }

  const accounts = accountsAll.filter((a) => a.type !== "liability");
  const partnerName = (meta.partner_name || "").trim();

  const state = {
    tipo: prefill?.type ?? "expense",
    raw: centsToRaw(prefill?.amountCents),
    cents: prefill?.amountCents ?? 0,
    categoryId: prefill?.categoryId ?? null,
    accountId: prefill?.accountId ?? resolveAccountId(meta.default_account_id, accounts) ?? "",
    counterAccountId: "",
    isShared: partnerName ? (prefill?.isShared ?? false) : false,
    paidBy: "me",
    sharePct: normalizePct(period?.my_share_pct, 100),
    fecha: hoyISO(),
    merchant: prefill?.merchant ?? "",
    note: "",
    refId: "",
    ruleId: prefill?.ruleId ?? "",
    adjustmentSign: "+",
    refundPickerOpen: false,
    // Registro v2 §4: quick gobierna qué se pinta (registro-mode.js#detailsOpen); expanded es el
    // «Más» tocado a mano en ESTE formulario (nunca persiste entre aperturas de Registro).
    // allCats: se pasó de las CATS_GRID_LIMIT primeras categorías a la lista entera («Ver las N
    // categorías»); una vez tocado no se vuelve a plegar en este formulario.
    quick: quickRegisterEnabled(meta.quick_register),
    expanded: false,
    allCats: false,
    // Registro v2 §5.4: campos que el usuario ya tocó a mano en ESTE formulario — la memoria de
    // comercios nunca vuelve a pisarlos (registro-mode no interviene aquí; es del formulario, no
    // de la densidad). merchantRemembered pinta la pista «recordado de la última vez».
    touched: new Set(),
    merchantRemembered: false,
  };
  let errorMsg = "";

  const categoriesFor = () => {
    if (state.tipo === "income") return incomeCats;
    if (needsCategory(state.tipo)) return expenseCats;
    return [];
  };

  /** ¿Es un gasto compartido que pagó la contraparte? Gatea la sección de cuentas, el guard de
   *  validación y lo que se guarda. Solo tiene sentido para expense: la tarjeta de compartido se
   *  pinta también para refund, pero ahí no hay control de quién pagó. */
  const partnerPaid = () => state.tipo === "expense" && state.isShared && state.paidBy === "partner";

  function selectRefundRow(row) {
    state.refId = row.id;
    state.categoryId = row.category_id;
    if (row.is_shared) {
      // Solo precarga categoría + importe de la parte de la contraparte; el refund de
      // liquidación en sí NO se marca compartido (mismo criterio que
      // repo.settleAllSharedStmts: is_shared=0, ya es el 100% de lo que la contraparte debe).
      // Usa el pct EFECTIVO del gasto enlazado (su propio override, o el pct
      // de SU periodo), no el del periodo abierto: el gasto puede venir de un
      // periodo cerrado con reparto distinto o llevar su propio override.
      const { partner: partnerPart } = splitCents(row.amount_cents, normalizePct(row.share_pct_override ?? row.period_pct, 100));
      state.raw = centsToRaw(partnerPart);
      state.cents = partnerPart;
    } else {
      // Gasto NO compartido: lo normal es que la tienda devuelva el importe entero — se precarga
      // completo y editable (devolución parcial = corregir el importe a mano).
      state.raw = centsToRaw(row.amount_cents);
      state.cents = row.amount_cents;
    }
    state.refundPickerOpen = false;
    errorMsg = "";
    render();
  }

  function clearRefundLink() {
    state.refId = "";
    render();
  }

  function validationError() {
    // Un gasto que pagó la contraparte no toca ninguna cuenta mía: es el único caso sin cuenta que
    // exigir. Para todo lo demás (incluida la transferencia, que además valida su cuenta destino)
    // el guard sigue siendo universal.
    if (!partnerPaid() && !state.accountId) return t("common.needAccount");
    if (state.tipo === "transfer") {
      if (state.cents <= 0) return t("common.enterAmount");
      if (!state.counterAccountId || state.counterAccountId === state.accountId)
        return t("common.pickTwoAccounts");
      return "";
    }
    if (state.tipo === "adjustment") return state.cents <= 0 ? t("common.enterAmount") : "";
    // expense / income / refund
    if (state.cents <= 0 && !state.categoryId) return t("common.enterAmountAndCategory");
    if (state.cents <= 0) return t("common.enterAmount");
    if (!state.categoryId) return t("common.pickCategory");
    return "";
  }

  function renderRefundPicker() {
    const linked = state.refId ? refundCandidates.find((r) => r.id === state.refId) : null;
    if (linked) {
      const label = linked.merchant || byId[linked.category_id]?.name || t("common.type.expense");
      return `
      <div class="card" style="padding:12px 14px; margin-bottom:18px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div style="min-width:0;">
          <div style="font-size:10px; color:var(--text-3);">${t("common.linkedTo")}</div>
          <div style="font-size:14px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${escHtml(label)} · ${fmtMoney(linked.amount_cents)}
          </div>
        </div>
        <button type="button" id="reg-refund-unlink" class="icon-btn" aria-label="${t("registro.refund.unlink")}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg></button>
      </div>`;
    }
    return `
    <div style="margin-bottom:18px;">
      <button type="button" id="reg-refund-toggle" class="refund-toggle">${t("registro.refund.toggle", { arrow: state.refundPickerOpen ? "▲" : "▼" })}</button>
      ${state.refundPickerOpen ? `
      <div class="card refund-list" style="padding:4px 14px; margin-top:8px;">
        ${refundCandidates.length === 0
          ? `<div style="padding:14px 0; font-size:13px; color:var(--text-3);">${t("registro.refund.empty")}</div>`
          : refundCandidates.map((r) => {
            // Un gasto con algo ya devuelto sigue siendo elegible (una devolución parcial es
            // legítima): solo se atenúa y se etiqueta. El SQL ya lo ha empujado al final de la
            // lista (sql.js#recentForRefund), aquí no se reordena nada.
            const done = r.refunded_cents > 0;
            // ...pero «ya devuelto» y «liquidado» no son lo mismo: settled lo pone repo.addTransaction
            // para CUALQUIER devolución o ajuste enlazado por refId (repo.js ~82-83), no solo los
            // apuntes que crea Liquidar. Por eso un gasto compartido con una devolución de tienda
            // enlazada y aún sin liquidar también sale aquí como «Liquidado» — límite conocido,
            // anotado en el backlog; el arreglo real es marcar los apuntes de liquidación.
            const settledShared = !!r.is_shared && !!r.settled;
            const doneLabel = settledShared
              ? t("registro.refund.settledLabel", { amount: escHtml(fmtMoney(r.refunded_cents)) })
              : t("registro.refund.alreadyRefunded", { amount: escHtml(fmtMoney(r.refunded_cents)) });
            return `
            <button type="button" class="refund-row" data-refund-row="${escAttr(r.id)}"${done ? ' style="opacity:.55;"' : ""}>
              <span style="flex:1; min-width:0; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                ${escHtml(r.merchant || byId[r.category_id]?.name || t("common.type.expense"))}${r.is_shared ? t("registro.refund.sharedSuffix") : ""}
              </span>
              ${done ? `<span style="font-size:10.5px; color:var(--text-3); white-space:nowrap; flex-shrink:0;">${doneLabel}</span>` : ""}
              <span class="num">${fmtMoney(r.amount_cents)}</span>
            </button>`;
          }).join("")}
      </div>` : ""}
    </div>`;
  }

  function renderAccountsSection() {
    if (state.tipo === "transfer") {
      return `
      <div class="card" style="border-radius:0; display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">${t("common.from")}</div>
        <div class="chips">
          ${accounts.map((a) => `<button type="button" class="chip${state.accountId === a.id ? " active" : ""}" data-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
        </div>
      </div>
      <div class="card" style="border-radius:0; display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">${t("common.to")}</div>
        <div class="chips">
          ${accountsAll.filter((a) => a.id !== state.accountId).map((a) => `<button type="button" class="chip${state.counterAccountId === a.id ? " active" : ""}" data-counter-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
        </div>
      </div>`;
    }
    return `
    <div class="card" style="border-radius:0; display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
      <div class="section-title">${state.tipo === "refund" ? t("common.destAccount") : t("common.account")}</div>
      <div class="chips">
        ${accounts.map((a) => `<button type="button" class="chip${state.accountId === a.id ? " active" : ""}" data-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
      </div>
    </div>`;
  }

  /** Fila «Más» que sustituye a cuenta/comercio/fecha/nota/compartido cuando `detailsOpen` dice que
   *  no toca pintarlos (Registro v2 §4.3). El resumen sale de registro-mode.js#foldedSummaryParts
   *  (array, nunca un string con «·»); aquí solo se decide QUÉ entra en cada campo del resumen y se
   *  pinta con divisores de 1px entre trozos (SISTEMA.md §1). */
  function moreRowHtml() {
    const accountName = partnerPaid() ? "" : (accounts.find((a) => a.id === state.accountId)?.name ?? "");
    const dateLabel = state.fecha === hoyISO() ? t("registro.more.summaryToday") : fmtDiaCorto(state.fecha);
    const hasNote = !!state.note.trim();
    const sharedLabel = needsCategory(state.tipo) && state.tipo !== "income" && partnerName && state.isShared
      ? t("common.sharedWith", { name: escHtml(partnerName) })
      : "";
    const parts = foldedSummaryParts({ accountName, dateLabel, hasNote, hasPhoto: false, sharedLabel }, t);
    const summaryHtml = parts.map((p, i) => (i === 0 ? "" : `<span style="width:1px;height:11px;background:var(--hairline-strong);flex-shrink:0;"></span>`)
      + `<span style="font-size:12px;font-weight:500;color:var(--text-3);">${escHtml(p)}</span>`).join("");
    return `
    <button type="button" id="reg-more-toggle" style="display:flex; align-items:center; gap:12px; width:100%; min-height:60px; padding:10px 0; margin-top:12px; border:0; border-top:1px solid var(--hairline); border-bottom:1px solid var(--hairline); background:transparent; color:inherit; text-align:left; cursor:pointer; -webkit-tap-highlight-color:transparent;">
      <div style="display:flex; flex-direction:column; gap:4px; flex:1; min-width:0;">
        <span style="font-size:14px; font-weight:600;">${t("registro.more.toggle")}</span>
        <div style="display:flex; align-items:center; gap:9px; flex-wrap:wrap;">${summaryHtml}</div>
      </div>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;"><path d="M5 9.5 12 16l7-6.5"></path></svg>
    </button>`;
  }

  function render() {
    const cats = categoriesFor();
    const { mine: myCents, partner: partnerCents } = state.isShared ? splitCents(state.cents, state.sharePct) : { mine: state.cents, partner: 0 };
    // Color del display/importe y del botón de guardar: se leen del state en CADA pintado, así
    // que basta con el render() que ya dispara el click de categoría — sin estado nuevo.
    const amountColor = state.categoryId ? textColorForCategory(state.categoryId, byId) : "var(--text)";
    // §1 principio 2: un solo acento. El CTA es SIEMPRE lima, ya no toma el color de la categoría.
    const saveStyle = needsCategory(state.tipo) && state.categoryId
      ? `background:var(--accent);color:var(--accent-ink);`
      : "";
    // Registro v2 §4.3: el CTA lleva el importe («Guardar gasto de 45,20 €») SOLO para gasto — es
    // la clave que trae la spec (registro.save.expenseWithAmount), no una por tipo. Con importe a
    // 0 se cae al texto de siempre.
    const saveLabel = state.tipo === "expense" && state.cents > 0
      ? t("registro.save.expenseWithAmount", { amount: escHtml(fmtMoney(state.cents)) })
      : t(SAVE_KEY[state.tipo]);

    container.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;">
        <h1 style="font-size:19px; font-weight:700; letter-spacing:-0.01em;">${t("registro.title")}</h1>
        <button type="button" class="icon-btn" id="reg-close" aria-label="${t("registro.close")}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg></button>
      </div>

      <div class="segmented" style="margin-bottom:18px;border-radius:999px;">
        ${TIPOS.map((tp) => {
          const active = state.tipo === tp.id;
          const segStyle = active
            ? "border-radius:999px;background:var(--accent);color:var(--accent-ink);font-weight:600;"
            : "border-radius:999px;";
          return `<button type="button" data-tipo="${tp.id}" class="${active ? "active" : ""}" style="${segStyle}">${t(tp.labelKey)}</button>`;
        }).join("")}
      </div>

      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px;">
        <div class="section-title">${t("common.amount")}</div>
        <div class="amount-display" style="align-items:center;">
          ${state.tipo === "adjustment" ? `<button type="button" class="icon-btn" id="reg-sign" aria-label="${t("common.changeSign")}" style="font-size:18px; font-weight:700;">${state.adjustmentSign}</button>` : ""}
          <input type="text" inputmode="decimal" id="reg-raw" value="${escAttr(state.raw)}" placeholder="0" autocomplete="off"
            style="border:0;background:none;color:${amountColor};font:600 56px var(--font-num);letter-spacing:-0.02em;width:100%;outline:none;">
          <span class="amount-currency" style="color:${amountColor};">${escHtml(currencySymbol())}</span>
        </div>
        <hr class="divider" style="margin-top:6px;">
      </div>

      ${cats.length ? (() => {
        // Registro v2 §4.3: rejilla estática de 2 filas de 4 en vez del scroll horizontal
        // (.chips-scroll la siguen usando recurrentes.js/movimientos.js — no se toca esa clase).
        // «Ver las N» ya tocado (state.allCats) enseña la lista entera; si no, visibleCategories
        // decide y la seleccionada nunca queda escondida.
        const { shown, hidden } = state.allCats
          ? { shown: cats, hidden: 0 }
          : visibleCategories(cats, state.categoryId, CATS_GRID_LIMIT);
        return `
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">${t("common.category")}</div>
        <div class="chips-grid">
          ${shown.map((c) => {
            const color = colorForCategory(c.id, byId);
            const textColor = textColorForCategory(c.id, byId);
            const icon = iconForCategory(c.id, byId);
            const active = state.categoryId === c.id;
            const chipStyle = active
              ? `--cat:${color};background:color-mix(in srgb, ${color} 16%, transparent);color:${textColor};font-weight:700;`
              : `--cat:${color};`;
            return `<button type="button" class="chip-v${active ? " active" : ""}" data-cat="${c.id}" style="${chipStyle}">
              <span class="chip-icon">${icon}</span><span>${escHtml(c.name)}</span>
            </button>`;
          }).join("")}
        </div>
        ${hidden > 0 ? `
        <button type="button" id="reg-cats-more" style="border:0;background:transparent;color:var(--text-3);font-size:13px;font-weight:500;padding:0;height:32px;display:flex;align-items:center;gap:6px;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          ${t("registro.categories.showAll", { n: cats.length })}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9.5 12 16l7-6.5"></path></svg>
        </button>` : ""}
      </div>`;
      })() : ""}

      ${detailsOpen({ quick: state.quick, expanded: state.expanded, tipo: state.tipo }) ? `
      ${partnerPaid() ? "" : renderAccountsSection()}

      ${state.tipo === "refund" ? renderRefundPicker() : ""}

      <div style="display:flex; gap:8px; margin-bottom:12px;">
        <label class="field field-stack" style="flex:1;">
          <span style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
            <span class="field-label">${t("common.merchant")}</span>
            ${state.merchantRemembered ? `<span style="font-size:11px; font-weight:500; color:var(--accent);">${t("registro.merchant.remembered")}</span>` : ""}
          </span>
          <input type="text" id="reg-merchant" list="reg-merchants" value="${escAttr(state.merchant)}" placeholder="${t("common.optional")}" aria-label="${t("registro.merchant.listLabel")}">
        </label>
        <label class="field field-stack" style="flex:1;">
          <span class="field-label">${t("common.date")}</span>
          <input type="date" id="reg-fecha" value="${state.fecha}">
        </label>
      </div>
      <datalist id="reg-merchants">
        ${merchantOptions.map((e) => `<option value="${escAttr(e.display)}"></option>`).join("")}
      </datalist>
      <label class="field field-stack" style="margin-bottom:18px;">
        <span class="field-label">${t("common.note")}</span>
        <input type="text" id="reg-note" value="${escAttr(state.note)}" placeholder="${t("common.optional")}">
      </label>

      ${needsCategory(state.tipo) && state.tipo !== "income" && partnerName ? `
      <div class="card" style="border-radius:0; padding:0 16px; margin-bottom:18px;">
        <label style="height:56px; display:flex; align-items:center; justify-content:space-between; gap:12px; cursor:pointer;">
          <span style="font-size:15px; font-weight:600;">${t("common.sharedWith", { name: escHtml(partnerName) })}</span>
          <span class="toggle">
            <input type="checkbox" id="reg-shared" ${state.isShared ? "checked" : ""}>
            <span class="toggle-track"><span class="toggle-knob"></span></span>
          </span>
        </label>
        ${state.isShared ? `
        <div style="display:flex; flex-direction:column; gap:10px; padding:0 0 14px;">
          ${state.tipo === "expense" ? `
          <div style="display:flex; flex-direction:column; gap:6px;">
            <div class="section-title">${t("common.paidBy.label")}</div>
            <div class="segmented" style="border-radius:999px;">
              <button type="button" data-paidby="me" class="${state.paidBy === "me" ? "active" : ""}"
                style="flex:1;border-radius:999px;${state.paidBy === "me" ? "background:var(--accent);color:var(--accent-ink);font-weight:600;" : ""}">${t("common.paidBy.me")}</button>
              <button type="button" data-paidby="partner" class="${state.paidBy === "partner" ? "active" : ""}"
                style="flex:1;border-radius:999px;${state.paidBy === "partner" ? "background:var(--accent);color:var(--accent-ink);font-weight:600;" : ""}">${t("common.paidBy.partner", { name: escHtml(partnerName) })}</button>
            </div>
          </div>` : ""}
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="flex:1; min-width:0;">
              <div style="font-size:14px; font-weight:600;">${t("common.split.label")}</div>
              <div style="font-size:11px; color:var(--text-3);">${t("common.split.hint", { name: escHtml(partnerName), pct: 100 - state.sharePct })}</div>
            </div>
            <button type="button" id="reg-pct-down" class="stepper-btn lg" aria-label="${t("common.split.decreaseAria")}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path></svg></button>
            <div class="num" style="font-size:20px; font-weight:700; width:56px; text-align:center; flex-shrink:0;">${state.sharePct} %</div>
            <button type="button" id="reg-pct-up" class="stepper-btn lg" aria-label="${t("common.split.increaseAria")}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>
          </div>
          <div style="display:flex; gap:8px;">
            <div style="flex:1; background:var(--card2); border-radius:0; padding:10px 11px;">
              <div style="font-size:10px; color:var(--text-3);">${t("common.myShare", { pct: state.sharePct })}</div>
              <div class="num" id="reg-split-mine" style="font-size:15px; font-weight:600;">${fmtMoney(myCents)}</div>
            </div>
            <div style="flex:1; background:var(--card2); border-radius:0; padding:10px 11px;">
              <div style="font-size:10px; color:var(--text-3);">${partnerPaid() ? t("common.paidFull", { name: escHtml(partnerName) }) : `${escHtml(partnerName)} · ${100 - state.sharePct}%`}</div>
              <div class="num" id="reg-split-partner" style="font-size:15px; font-weight:600; color:var(--text-2);">${fmtMoney(partnerPaid() ? state.cents : partnerCents)}</div>
            </div>
          </div>
        </div>` : ""}
      </div>` : ""}
      ` : moreRowHtml()}

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      <button type="button" class="btn-primary" id="reg-save" style="${saveStyle}">${saveLabel}</button>
    `;

    wire();
  }

  function wire() {
    container.querySelector("#reg-close").onclick = () => onDone();

    container.querySelectorAll("[data-tipo]").forEach((b) => {
      b.onclick = () => {
        state.tipo = b.dataset.tipo;
        state.categoryId = null;
        state.refId = "";
        state.refundPickerOpen = false;
        state.counterAccountId = "";
        // Mismo criterio que el guard B4 de ingresos: un 'partner' heredado no puede colarse con el
        // control oculto (solo se pinta para expense).
        state.paidBy = "me";
        // Un touched de un tipo anterior (p.ej. categoryId de un gasto) no tiene sentido para el
        // tipo nuevo — categoryId ya se acaba de borrar dos líneas arriba.
        state.touched = new Set();
        errorMsg = "";
        render();
      };
    });

    container.querySelectorAll("[data-cat]").forEach((b) => {
      b.onclick = () => {
        state.categoryId = b.dataset.cat;
        state.touched.add("categoryId");
        errorMsg = "";
        render();
      };
    });

    container.querySelectorAll("[data-paidby]").forEach((b) => {
      b.onclick = () => {
        // state.accountId NO se borra: volver a «Pagué yo» recupera la cuenta ya seleccionada.
        state.paidBy = b.dataset.paidby;
        errorMsg = "";
        render();
      };
    });

    container.querySelectorAll("[data-acc]").forEach((b) => {
      b.onclick = () => {
        state.accountId = b.dataset.acc;
        state.touched.add("accountId");
        if (state.counterAccountId === state.accountId) state.counterAccountId = "";
        render();
      };
    });

    container.querySelectorAll("[data-counter-acc]").forEach((b) => {
      b.onclick = () => {
        state.counterAccountId = b.dataset.counterAcc;
        render();
      };
    });

    const signBtn = container.querySelector("#reg-sign");
    if (signBtn) signBtn.onclick = () => {
      state.adjustmentSign = state.adjustmentSign === "+" ? "-" : "+";
      render();
    };

    container.querySelector("#reg-raw").oninput = (e) => {
      state.raw = e.target.value;
      state.cents = parseCentsRaw(state.raw);
      errorMsg = "";
      const mineEl = container.querySelector("#reg-split-mine");
      const partnerEl = container.querySelector("#reg-split-partner");
      if (state.isShared && mineEl && partnerEl) {
        const { mine: myCents, partner: partnerCents } = splitCents(state.cents, state.sharePct);
        mineEl.textContent = fmtMoney(myCents);
        partnerEl.textContent = fmtMoney(partnerPaid() ? state.cents : partnerCents);
      }
      // Registro v2 §4.3: el CTA lleva el importe en vivo — nunca un render() completo aquí
      // (mataría el cursor del input, mismo criterio que el reparto de arriba).
      if (state.tipo === "expense") {
        container.querySelector("#reg-save").textContent = state.cents > 0
          ? t("registro.save.expenseWithAmount", { amount: fmtMoney(state.cents) })
          : t(SAVE_KEY.expense);
      }
    };

    const refundToggle = container.querySelector("#reg-refund-toggle");
    if (refundToggle) refundToggle.onclick = () => {
      state.refundPickerOpen = !state.refundPickerOpen;
      render();
    };

    container.querySelectorAll("[data-refund-row]").forEach((b) => {
      b.onclick = () => {
        const row = refundCandidates.find((r) => r.id === b.dataset.refundRow);
        if (row) selectRefundRow(row);
      };
    });

    const unlinkBtn = container.querySelector("#reg-refund-unlink");
    if (unlinkBtn) unlinkBtn.onclick = () => clearRefundLink();

    // Registro v2 §4.3: los tres viven dentro del bloque que se pliega tras «Más» en modo rápido
    // — sin el guard, wire() lanzaría al no encontrar el elemento con el bloque plegado.
    const merchantInput = container.querySelector("#reg-merchant");
    if (merchantInput) merchantInput.oninput = (e) => {
      state.merchant = e.target.value;
      // Registro v2 §5.4: casar EXACTO por valor normalizado, nunca por prefijo (rellenaría la
      // categoría a media palabra). Todo lo rellenado es editable y respeta `touched`
      // (memoryPatch). Un render() completo hace falta porque el parche puede tocar categoría,
      // cuenta y el toggle de compartido a la vez — se refoca el propio campo desde AQUÍ, nunca
      // desde render() (mismo criterio que el «Más», §4.5).
      const entry = merchantMemoryMap[normalizeMerchant(state.merchant)];
      if (entry) {
        const patch = memoryPatch(entry, state.touched);
        Object.assign(state, patch);
        // share_pct_override llega crudo de la BD (REAL, puede venir fuera de rango): se normaliza
        // igual que cualquier otro pct que entra desde fuera del propio stepper.
        if ("sharePct" in patch) state.sharePct = normalizePct(patch.sharePct, state.sharePct);
        state.merchantRemembered = true;
        render();
        focusInput(container.querySelector("#reg-merchant"));
      } else if (state.merchantRemembered) {
        state.merchantRemembered = false;
        render();
        focusInput(container.querySelector("#reg-merchant"));
      }
    };
    const noteInput = container.querySelector("#reg-note");
    if (noteInput) noteInput.oninput = (e) => { state.note = e.target.value; };
    const fechaInput = container.querySelector("#reg-fecha");
    if (fechaInput) fechaInput.onchange = (e) => { state.fecha = e.target.value || hoyISO(); };

    const catsMoreBtn = container.querySelector("#reg-cats-more");
    if (catsMoreBtn) catsMoreBtn.onclick = () => {
      state.allCats = true;
      render();
    };

    const moreToggle = container.querySelector("#reg-more-toggle");
    if (moreToggle) moreToggle.onclick = () => {
      state.expanded = true;
      render();
      // Invariante de foco (§4.5): SOLO desde el handler, nunca desde render() — si no, cada
      // repintado (p.ej. tocar un chip de categoría) robaría el foco al importe.
      focusInput(container.querySelector("#reg-merchant"));
    };

    const sharedToggle = container.querySelector("#reg-shared");
    if (sharedToggle) sharedToggle.onchange = (e) => {
      state.isShared = e.target.checked;
      state.touched.add("isShared");
      // Desmarcar compartido devuelve el gasto a «Pagué yo»: sin esto un 'partner' heredado
      // sobreviviría con el control oculto y la cuenta volvería a ser obligatoria sin decirlo.
      state.paidBy = "me";
      render();
    };

    const pctDown = container.querySelector("#reg-pct-down");
    if (pctDown) pctDown.onclick = () => { state.sharePct = stepPct(state.sharePct, -PCT_STEP); render(); };
    const pctUp = container.querySelector("#reg-pct-up");
    if (pctUp) pctUp.onclick = () => { state.sharePct = stepPct(state.sharePct, PCT_STEP); render(); };

    container.querySelector("#reg-save").onclick = async () => {
      const btn = container.querySelector("#reg-save");
      state.cents = parseCentsRaw(state.raw);
      const msg = validationError();
      if (msg) {
        errorMsg = msg;
        render();
        const savedBtn = container.querySelector("#reg-save");
        savedBtn.classList.add("shake");
        setTimeout(() => savedBtn.classList.remove("shake"), 400);
        return;
      }
      btn.disabled = true;
      try {
        const withCategory = needsCategory(state.tipo);
        // Mismo guard que sharePctOverride/isShared de abajo: el reparto no se ofrece para
        // ingresos, así que el recibo tampoco debe imprimir una línea de reparto heredada.
        const effectiveIsShared = withCategory && state.tipo !== "income" ? state.isShared : false;
        const effectiveAccountId = partnerPaid() ? "" : state.accountId;
        const newId = await addTransaction({
          type: state.tipo,
          amountCents: state.tipo === "adjustment" && state.adjustmentSign === "-" ? -state.cents : state.cents,
          date: state.fecha,
          categoryId: withCategory ? state.categoryId : "",
          // Un gasto que pagó la contraparte no toca ninguna cuenta mía hasta liquidar.
          accountId: effectiveAccountId,
          counterAccountId: state.tipo === "transfer" ? state.counterAccountId : "",
          merchant: state.merchant,
          note: state.note,
          // B4 ruling: el reparto ya no se OFRECE para ingresos (incomeOfPeriod sigue contando
          // al 100%, ver sql.js) — este guard evita que un isShared heredado (p.ej. prefill de
          // una regla recurrente marcada compartida, inicio.js) se cuele en el guardado aunque
          // el toggle esté oculto para tipo=income.
          isShared: effectiveIsShared,
          sharePctOverride: effectiveIsShared ? state.sharePct : null,
          paidBy: partnerPaid() ? "partner" : "me",
          refId: state.tipo === "refund" ? state.refId : "",
          ruleId: state.ruleId,
        });
        onDone();   // primero: el ticket cae sobre la pantalla ya repintada (ReciboGuardado.dc.html)
        const [y, m, d] = state.fecha.split("-");
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        showReceipt({
          dateTime: `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}  ${pad(now.getHours())}:${pad(now.getMinutes())}`,
          lines: [
            { label: t("common.merchant"), value: state.merchant || "" },
            { label: t("common.category"), value: withCategory ? (byId[state.categoryId]?.name ?? "") : "" },
            { label: t("common.account"), value: accountsAll.find((a) => a.id === effectiveAccountId)?.name ?? "" },
            { label: t("common.date"), value: `${d}/${m}/${y}` },
            { label: t("common.split.label"), value: effectiveIsShared ? `${partnerName} ${state.sharePct} %` : "" },
            { label: t("recibo.myPart"), value: effectiveIsShared ? fmtMoney(splitCents(state.cents, state.sharePct).mine) : "" },
          ],
          total: fmtMoneyParts(state.cents),
          stampDate: `${fmtDiaCorto(hoyISO()).toUpperCase()} ${now.getFullYear()}`,
          labels: { brand: "BaseCero", stamp: t("recibo.stamp"), total: t("recibo.total"), undo: t("recibo.undo") },
          onUndo: async () => {
            try {
              await softDeleteTransaction(newId);
              onUndone?.();
            } catch (e) {
              showToast(t("recibo.undoFailed", { error: userMessage(e) }));
            }
          },
        });
      } catch (e) {
        btn.disabled = false;
        errorMsg = t("common.saveFailed", { error: userMessage(e) });
        render();
      }
    };
  }

  render();
  // Foco en el importe SOLO tras el primer pintado: render() se repite en cada cambio de estado y
  // enfocar ahí robaría el foco a cada toque de chip.
  // Siempre, sin olfatear si la pantalla es táctil: en escritorio no hay teclado del sistema que
  // abrir y las heurísticas de "pointer: coarse" fallan justo donde importa (portátil táctil,
  // móvil con teclado bluetooth). En el móvil el teclado probablemente NO salte: esto corre tras
  // seis consultas, muy lejos del gesto que abrió la pantalla, y iOS solo levanta el teclado para
  // un focus() dentro del contexto de activación del usuario. Lo que arregla "hay que subir para
  // escribir el importe" es el scroll (Task 2); esto es escritorio y accesibilidad.
  focusInput(container.querySelector("#reg-raw"));
}
