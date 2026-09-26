import {
  listPeriods, getTransaction, updateTransaction, softDeleteTransaction,
  listExpenseLeafCategories, listIncomeCategories, listAccounts, allCategoriesById, hasActiveLinkedSettlement,
  getMetaAll, listTags, createTag, tagTotals,
} from "../repo.js";
import { attachments } from "../attachments.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtMoney, fmtDiaLargo, hoyISO, currencySymbol, parseCentsRaw, centsToRaw, appLocale } from "../format.js";
import { resolveAccountId } from "../account-defaults.js";
import { t } from "../i18n/index.js";
import { metaHtml, subHeaderHtml } from "../ui.js";
import { icon, catIcon as catSvg } from "../icons.js";
import { PCT_STEP, normalizePct, stepPct, splitCents } from "../share-pct.js";
import { goBack } from "../back.js";
import { userMessage } from "../errors.js";
import { showConfirm } from "../modal.js";
import { escHtml, escAttr } from "../esc.js";

// Detalle de un movimiento: editar, borrar y visor de la foto del ticket. Sale de movimientos.js
// en la S5 del rediseño B (la lista pasa al sistema B y este fichero se queda en PENDIENTES hasta
// la S6, que lo rediseña). El código es el de siempre; solo cambia de dónde saca sus datos.

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

/** Pinta el detalle del movimiento `txId` en `container`.
 *
 *  Quién lo abre decide el historial: la lista de Movimientos apunta su entrada de «atrás» en
 *  `onOpen` (justo antes del primer pintado, solo si el movimiento existe); open-tx.js (Inicio,
 *  Semana) la apunta antes de llamar. Aquí dentro, «Atrás», Guardar y Borrar terminan siempre en
 *  goBack(), que deshace esa entrada.
 *  `onChanged`: se espera ANTES de goBack() tras guardar o borrar (la lista recarga su periodo ahí,
 *  para que al volver ya pinte los datos nuevos).
 *
 *  @returns {Promise<(() => void)|null>} null si el movimiento ya no existe (borrado en otra
 *  pestaña); si no, `dispose`, que revoca la URL de la foto: quien abre lo llama al volver.
 *  Lanza si falla la carga: quien abre decide cómo avisarlo. */
export async function renderMovimientoDetalle(container, txId, { onOpen = () => {}, onChanged = async () => {} } = {}) {
  const [periods, expenseCats, incomeCats, accountsAll, byId, meta, tagsLoaded, tagTotalsAll, row] = await Promise.all([
    listPeriods(), listExpenseLeafCategories(), listIncomeCategories(), listAccounts(), allCategoriesById(),
    getMetaAll(), listTags(), tagTotals(), getTransaction(txId),
  ]);
  if (!row) return null;
  let tagsAll = tagsLoaded;
  const partnerName = (meta.partner_name || "").trim();
  const state = { detailId: txId, detail: null, linkedExpense: null, tagTotalsAll };
  let errorMsg = "";
  // Foto del ticket (N5, spec §9.8): la URL del Blob leído al abrir (state.detail.photoBlob). Se
  // revoca y se vuelve a crear en CADA renderDetail() (updateDetail repinta con innerHTML en cada
  // cambio de estado) y también al salir del detalle (dispose) — sin esto, cada repintado filtraría
  // una foto entera en memoria.
  let detailPhotoUrl = null;

  const id = txId;
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
    tagId: row.tag_id || null,
    tagPickerOpen: false, // Task 12: solo UI, nunca se manda al guardar
    newTagDraft: null, // Task 12: != null mientras se escribe el nombre de una etiqueta nueva
    // Foto del ticket (N5): photoBlob se lee AQUÍ (renderDetail no puede esperar a OPFS).
    // has_attachment=1 sin fichero (hoja .xlsx restaurada, o un fallo del paso 3 de §9.4) se trata
    // como "sin foto" — null, sin banner ni error (spec §9.2/§13.11): el FICHERO es la verdad, la
    // columna solo evita sondear OPFS en la lista.
    photoBlob: null,
    photoViewerOpen: false,
  };
  if (row.has_attachment && attachments) {
    try { state.detail.photoBlob = await attachments.blob(id); } catch { state.detail.photoBlob = null; }
  }
  // El apunte de liquidación tiene DOS formas desde Task 3: la devolución ENTRANTE (refund) y el
  // ajuste SALIENTE (adjustment con ref_id, el que se crea cuando pagó ella). Los dos apuntan a un
  // gasto por ref_id y los dos los cubre settlementAmountLocked en repo.js.
  if ((row.type === "refund" || row.type === "adjustment") && row.ref_id) {
    try { state.linkedExpense = await getTransaction(row.ref_id); } catch { state.linkedExpense = null; }
  }
  // Task 17 ronda 2 (controller ruling, finding A): un gasto ya liquidado con la contraparte (settled=1
  // Y con un refund activo enlazado) bloquea importe/compartido — editar el importe aquí sin
  // tocar el refund deja la deuda con la contraparte mal calculada y sin nada pendiente que lo delate.
  state.detail.settledLocked = row.type === "expense" && !!row.settled
    && (await hasActiveLinkedSettlement(id).catch(() => false));
  // Task 7 (5d): espejo en UI del guard settlementAmountLocked (repo.js) — el lado del REFUND. Si el
  // gasto enlazado ya está settled, bajar aquí el importe del refund descuadra la deuda liquidada
  // en silencio (el guard de repo lo rechazaría en save, pero mejor prevenirlo en el input).
  state.detail.refundLocked = (row.type === "refund" || row.type === "adjustment") && !!state.linkedExpense?.settled;

  function categoriesFor(tipo) {
    if (tipo === "income") return incomeCats;
    if (needsCategory(tipo)) return expenseCats;
    return [];
  }

  /** Nombre de una etiqueta por id, resuelto contra tagTotalsAll (D7: TODAS las vivas, archivadas
   *  incluidas) y no contra `tagsAll` (solo activas, listTags — selector de alta): un movimiento
   *  guardado puede llevar una etiqueta archivada después, y su nombre tiene que seguir resolviendo. */
  function tagName(id) {
    return state.tagTotalsAll.find((tg) => tg.id === id)?.name ?? "";
  }

  /** Opciones del selector inline del detalle: las activas (`tagsAll`, mismo criterio que Registro,
   *  Task 13) más la asignada actualmente si es una archivada que ya no está en `tagsAll` — así no
   *  desaparece de golpe del selector al abrirlo (mismo criterio que etiquetas.js, que sigue
   *  enseñando las archivadas en su propia lista, atenuadas, en vez de ocultarlas). */
  function tagOptions() {
    const currentId = state.detail?.tagId;
    if (!currentId || tagsAll.some((tg) => tg.id === currentId)) return tagsAll;
    const current = state.tagTotalsAll.find((tg) => tg.id === currentId);
    return current ? [...tagsAll, current] : tagsAll;
  }

  function updateDetail(patch) {
    Object.assign(state.detail, patch);
    renderDetail();
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
    // Cuenta en una sola fila (MovimientoDetalle.dc.html:84-90): etiqueta a la izquierda, chips
    // alineados a la derecha — a diferencia de De/Hacia arriba, que sí apilan (el artboard no
    // dibuja un origen/destino de transferencia).
    return `
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:18px;">
      <div class="section-title" style="flex-shrink:0;">${d.type === "refund" ? t("common.destAccount") : t("common.account")}</div>
      <div class="chips" style="flex:1; justify-content:flex-end;">
        ${accounts.map((a) => `<button type="button" class="chip${d.accountId === a.id ? " active" : ""}" data-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
      </div>
    </div>`;
  }

  /** Fila «Tipo» (MovimientoDetalle.dc.html:38-44): dos píldoras de SOLO LECTURA — el tipo de un
   *  movimiento guardado no se cambia aquí, así que van como <span>, no como chip de acción.
   *  Solo se pinta para gasto/ingreso: transferencia, devolución y ajuste ya llevan su nombre
   *  completo en el título de la cabecera (TIPO_KEY) y no hay "el otro tipo" que enseñar junto
   *  al suyo — la dualidad Gasto/Ingreso del artboard no se extiende a los cinco tipos. */
  function typePillsHtml(tipo) {
    if (tipo !== "expense" && tipo !== "income") return "";
    return `
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:18px;">
      <span class="section-title">${t("movimientos.detail.typeLabel")}</span>
      <div style="display:flex; gap:6px;">
        <span class="type-pill${tipo === "expense" ? " active" : ""}">${t("common.type.expense")}</span>
        <span class="type-pill${tipo === "income" ? " active" : ""}">${t("common.type.income")}</span>
      </div>
    </div>`;
  }

  /** Control «Etiqueta» del detalle (Task 12, artboard MovimientoDetalle.dc.html:102-105): chip
   *  cerrado con la etiqueta actual (o "Sin etiqueta" en punteado si no lleva) que al tocarlo abre
   *  el selector inline — lista de activas, "Sin etiqueta" y "Nueva etiqueta" (esta última se
   *  convierte en un campo de texto in situ, sin modal: mismo criterio de "un campo menos que
   *  pedir" que el resto del detalle). Registro (Task 13) reutiliza este mismo patrón de UI. */
  function renderTagControl(d) {
    if (!d.tagPickerOpen) {
      const hasTag = !!d.tagId;
      return `
      <button type="button" class="chip${hasTag ? " active" : ""}" id="mov-tag-chip"
        style="align-self:flex-start;padding:0 14px;display:inline-flex;align-items:center;gap:7px;${hasTag ? "" : "background:transparent;border:1px dashed var(--rule);"}">
        ${icon("tag", { size: 14 })}${hasTag ? escHtml(tagName(d.tagId)) : t("movimientos.detail.noTag")}
      </button>`;
    }
    const options = tagOptions();
    return `
    <div class="chips">
      <button type="button" class="chip${!d.tagId ? " active" : ""}" data-tag-pick="">${t("movimientos.detail.noTag")}</button>
      ${options.map((tg) => `<button type="button" class="chip${d.tagId === tg.id ? " active" : ""}" data-tag-pick="${escAttr(tg.id)}">${icon("tag", { size: 14 })}${escHtml(tg.name)}</button>`).join("")}
      ${d.newTagDraft == null ? `
      <button type="button" id="mov-tag-new" class="chip" style="background:transparent;border:1px dashed var(--rule);">${icon("plus", { size: 13 })}${t("movimientos.detail.newTag")}</button>
      ` : `
      <span style="display:inline-flex;align-items:center;gap:6px;">
        <input type="text" id="mov-tag-new-input" value="${escAttr(d.newTagDraft)}" placeholder="${escAttr(t("etiquetas.form.namePlaceholder"))}"
          style="height:44px;min-width:0;border:1px solid var(--rule);border-radius:999px;padding:0 14px;background:none;color:var(--text);font:14px inherit;">
        <button type="button" id="mov-tag-new-save" class="icon-btn" aria-label="${t("common.save")}" style="width:44px;height:44px;flex-shrink:0;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"></path></svg>
        </button>
      </span>`}
    </div>`;
  }

  /** Caja de fecha de solo lectura APARENTE (MovimientoDetalle.dc.html:97-101): icono calendario +
   *  fecha en dd/mm/aaaa mono. El `<input type="date">` real sigue ahí — mismo id `mov-fecha`,
   *  mismo onchange de wireDetail() — pero transparente y a sangre sobre la caja: tocar CUALQUIER
   *  punto de la caja abre el selector nativo, en vez de solo el pequeño icono de calendario que
   *  pinta el navegador. `.field-date:focus-within` (bloque P1 de app.css) le da el anillo de foco
   *  que un input con opacity:0 no puede pintarse a sí mismo. */
  function fechaBoxHtml(d) {
    const display = new Date(d.fecha + "T12:00:00").toLocaleDateString(appLocale(), { day: "2-digit", month: "2-digit", year: "numeric" });
    return `
    <label class="field-date">
      ${icon("calendar", { size: 18, stroke: "var(--ink-3)" })}
      <span class="num" style="font-size:13px;font-weight:500;">${escHtml(display)}</span>
      <input type="date" id="mov-fecha" value="${escAttr(d.fecha)}" aria-label="${escAttr(t("common.date"))}">
    </label>`;
  }

  function renderDetail() {
    const d = state.detail;
    // Foto del ticket: revocar SIEMPRE la URL del repintado anterior antes de crear la nueva —
    // ver el comentario de detailPhotoUrl más arriba. d.photoBlob no cambia durante la sesión de
    // detalle (solo openDetail lo rellena), así que esto es barato: una URL por repintado, nunca
    // dos vivas a la vez.
    if (detailPhotoUrl) { URL.revokeObjectURL(detailPhotoUrl); detailPhotoUrl = null; }
    if (d.photoBlob) detailPhotoUrl = URL.createObjectURL(d.photoBlob);
    const cats = categoriesFor(d.type);
    const { mine: myCents, partner: partnerCents } = d.isShared ? splitCents(d.cents, d.sharePct) : { mine: d.cents, partner: 0 };
    const locked = !!d.settledLocked;
    // Task 7 (5d): además de `locked` (lado del gasto), el importe del apunte de liquidación
    // (refund entrante o adjustment saliente) se bloquea si su gasto enlazado ya está settled —
    // ver refundLocked en openDetail.
    const amountLocked = locked || !!d.refundLocked;

    container.innerHTML = `
      ${subHeaderHtml({ id: "mov-back", title: t(TIPO_KEY[d.type]) })}

      ${locked ? `
      <div class="banner-aviso" style="margin-bottom:18px;">
        <p>${t("movimientos.detail.lockedNote")}</p>
      </div>` : ""}

      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px;">
        <div class="section-title">${t("common.amount")}</div>
        <div class="amount-display" style="align-items:center;">
          ${d.type === "adjustment" ? `<button type="button" class="icon-btn" id="mov-sign" aria-label="${t("common.changeSign")}" style="font-size:18px; font-weight:700;${amountLocked ? "opacity:.5;" : ""}" ${amountLocked ? "disabled" : ""}>${d.sign}</button>` : ""}
          <input type="text" inputmode="decimal" id="mov-raw" value="${escAttr(d.raw)}" placeholder="0" ${amountLocked ? "disabled" : ""}
            style="border:0;background:none;color:var(--text);font:var(--t-figure-xl);letter-spacing:-.015em;width:100%;outline:none;${amountLocked ? "opacity:.5;" : ""}">
          <span class="amount-currency">${currencySymbol()}</span>
        </div>
        <hr class="divider" style="margin-top:6px;">
      </div>

      ${typePillsHtml(d.type)}

      ${cats.length ? `
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">${t("common.category")}</div>
        <div class="chips-grid">
          ${cats.map((c) => {
            const color = colorForCategory(c.id, byId);
            // catIcon: mismo criterio que movRowHtml — deja el nombre `icon` libre para la
            // función importada de icons.js.
            const catIcon = catSvg(iconForCategory(c.id, byId), { size: "1em" });
            const active = d.categoryId === c.id;
            return `<button type="button" class="chip-v${active ? " active" : ""}" data-cat="${c.id}" style="--cat:${color};">
              <span class="chip-icon">${catIcon}</span><span>${escHtml(c.name)}</span>
            </button>`;
          }).join("")}
        </div>
      </div>` : ""}

      ${renderAccountsSection(d)}

      ${d.type === "refund" && state.linkedExpense ? `
      <div class="card" style="padding:12px 14px; margin-bottom:18px;">
        <div style="font-size:10px; color:var(--text-3);">${t("common.linkedTo")}</div>
        ${metaHtml([state.linkedExpense.merchant || byId[state.linkedExpense.category_id]?.name || t("common.type.expense"), fmtMoney(state.linkedExpense.amount_cents)])}
      </div>` : ""}

      <label class="field field-stack" style="margin-bottom:12px;">
        <span class="field-label">${t("common.merchant")}</span>
        <input type="text" id="mov-merchant" value="${escAttr(d.merchant)}" placeholder="${t("common.optional")}">
      </label>

      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:18px;">
        ${fechaBoxHtml(d)}
        ${renderTagControl(d)}
        ${detailPhotoUrl ? `
        <button type="button" id="mov-photo-thumb" aria-label="${escAttr(t("registro.photo.viewAria"))}"
          style="width:44px;height:44px;border-radius:var(--r-1);border:1px solid var(--hairline-strong);padding:0;overflow:hidden;flex-shrink:0;cursor:pointer;background:var(--surface-2);">
          <img src="${escAttr(detailPhotoUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">
        </button>` : ""}
      </div>

      ${d.photoViewerOpen && detailPhotoUrl ? `
      <div id="mov-photo-viewer" role="dialog" aria-label="${escAttr(t("registro.photo.viewAria"))}" tabindex="-1"
        style="position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;cursor:pointer;">
        <button type="button" id="mov-photo-viewer-close" aria-label="${escAttr(t("movimientos.detail.photoClose"))}"
          style="position:absolute;top:16px;right:16px;width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.3);background:transparent;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;">
          ${icon("close", { size: 20, stroke: "#fff" })}
        </button>
        <img src="${escAttr(detailPhotoUrl)}" alt="" style="max-width:100%;max-height:100%;object-fit:contain;">
      </div>` : ""}

      <label class="field field-stack" style="margin-bottom:18px;">
        <span class="field-label">${t("common.note")}</span>
        <input type="text" id="mov-note" value="${escAttr(d.note)}" placeholder="${t("common.optional")}">
      </label>

      ${needsCategory(d.type) && d.type !== "income" && (d.wasShared || partnerName) ? `
      <div class="card" style="background:var(--surface); padding:14px 16px; margin-bottom:18px;">
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
                style="flex:1;border-radius:999px;${d.paidBy === "me" ? "background:var(--accent);color:var(--accent-ink);font-weight:600;" : ""}">${t("common.paidBy.me")}</button>
              <button type="button" data-paidby="partner" class="${d.paidBy === "partner" ? "active" : ""}" ${locked ? "disabled" : ""}
                style="flex:1;border-radius:999px;${d.paidBy === "partner" ? "background:var(--accent);color:var(--accent-ink);font-weight:600;" : ""}">${t("common.paidBy.partner", { name: escHtml(partnerName) || t("movimientos.shared.fallbackName") })}</button>
            </div>
          </div>` : ""}
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="flex:1; min-width:0;">
              <div style="font-size:14px; font-weight:600;">${t("common.split.label")}</div>
              <div style="font-size:11px; color:var(--text-3);">${t("common.split.hint", { name: escHtml(partnerName || t("movimientos.shared.fallbackName")), pct: 100 - d.sharePct })}</div>
            </div>
            <button type="button" id="mov-pct-down" class="stepper-btn lg" aria-label="${t("common.split.decreaseAria")}" ${locked ? "disabled" : ""}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path></svg></button>
            <div class="num" style="font-size:20px; font-weight:700; width:56px; text-align:center; flex-shrink:0;">${d.sharePct} %</div>
            <button type="button" id="mov-pct-up" class="stepper-btn lg" aria-label="${t("common.split.increaseAria")}" ${locked ? "disabled" : ""}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>
          </div>
          <div style="display:flex; gap:8px;">
            <div style="flex:1; background:var(--card2); border-radius:0; padding:10px 11px;">
              <div style="font-size:10px; color:var(--text-3);">${metaHtml([t("common.myShare"), t("common.pctValue", { pct: d.sharePct })])}</div>
              <div class="num" id="mov-split-mine" style="font-size:15px; font-weight:600;">${fmtMoney(myCents)}</div>
            </div>
            <div style="flex:1; background:var(--card2); border-radius:0; padding:10px 11px;">
              <div style="font-size:10px; color:var(--text-3);">${partnerPaid(d) ? metaHtml([t("common.paidByName", { name: partnerName || t("movimientos.shared.fallbackLabel") }), t("common.paidTotal")]) : metaHtml([partnerName || t("movimientos.shared.fallbackLabel"), t("common.pctValue", { pct: 100 - d.sharePct })])}</div>
              <div class="num" id="mov-split-partner" style="font-size:15px; font-weight:600; color:var(--text-2);">${fmtMoney(partnerPaid(d) ? d.cents : partnerCents)}</div>
            </div>
          </div>
        </div>` : ""}
      </div>` : ""}

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      <button type="button" class="btn-primary" id="mov-save" style="margin-bottom:10px;">${t("common.save")}</button>
      <button type="button" class="btn-danger" id="mov-delete">${t("movimientos.delete.button")}</button>
    `;

    wireDetail();
  }

  function wireDetail() {
    const d = state.detail;
    container.querySelector("#mov-back").onclick = () => goBack();

    // Foto del ticket: miniatura abre el visor a pantalla completa; el visor se cierra al tocar
    // en cualquier sitio, con el botón explícito o con Escape (spec §9.8).
    const photoThumb = container.querySelector("#mov-photo-thumb");
    if (photoThumb) photoThumb.onclick = () => updateDetail({ photoViewerOpen: true });
    const photoViewer = container.querySelector("#mov-photo-viewer");
    if (photoViewer) {
      photoViewer.onclick = () => updateDetail({ photoViewerOpen: false });
      photoViewer.onkeydown = (e) => { if (e.key === "Escape") updateDetail({ photoViewerOpen: false }); };
      photoViewer.focus();
    }
    const photoViewerClose = container.querySelector("#mov-photo-viewer-close");
    if (photoViewerClose) photoViewerClose.onclick = (e) => { e.stopPropagation(); updateDetail({ photoViewerOpen: false }); };

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
    container.querySelector("#mov-merchant").oninput = (e) => { d.merchant = e.target.value; };
    container.querySelector("#mov-note").oninput = (e) => { d.note = e.target.value; };
    container.querySelector("#mov-fecha").onchange = (e) => updateDetail({ fecha: e.target.value || hoyISO() });

    // Selector de etiqueta (Task 12): abrir/cerrar y elegir son puro estado de UI en state.detail,
    // ninguno toca la BD hasta pulsar «Guardar» (igual que categoryId/accountId más arriba).
    const tagChip = container.querySelector("#mov-tag-chip");
    if (tagChip) tagChip.onclick = () => updateDetail({ tagPickerOpen: true });
    container.querySelectorAll("[data-tag-pick]").forEach((b) => {
      b.onclick = () => updateDetail({ tagId: b.dataset.tagPick || null, tagPickerOpen: false, newTagDraft: null });
    });
    const tagNewBtn = container.querySelector("#mov-tag-new");
    if (tagNewBtn) tagNewBtn.onclick = () => updateDetail({ newTagDraft: "" });
    const tagNewInput = container.querySelector("#mov-tag-new-input");
    if (tagNewInput) {
      // Sin render() en oninput (perdería el foco, mismo motivo que #mov-raw/#mov-merchant): el
      // valor tecleado solo se lee al guardar, ver submitNewTag.
      tagNewInput.oninput = (e) => { d.newTagDraft = e.target.value; };
      tagNewInput.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submitNewTag(); } };
    }
    const tagNewSave = container.querySelector("#mov-tag-new-save");
    if (tagNewSave) tagNewSave.onclick = () => submitNewTag();

    async function submitNewTag() {
      const btn = container.querySelector("#mov-tag-new-save");
      if (btn) btn.disabled = true;
      try {
        const newId = await createTag({ name: d.newTagDraft });
        [tagsAll, state.tagTotalsAll] = await Promise.all([listTags(), tagTotals()]);
        updateDetail({ tagId: newId, tagPickerOpen: false, newTagDraft: null });
      } catch (e) {
        if (btn) btn.disabled = false;
        errorMsg = t("common.saveFailed", { error: userMessage(e) });
        renderDetail();
      }
    }

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
        renderDetail();
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
          tagId: d.tagId || "",
        });
        await onChanged();
        goBack();
      } catch (e) {
        btn.disabled = false;
        errorMsg = t("common.saveFailed", { error: userMessage(e) });
        renderDetail();
      }
    };

    container.querySelector("#mov-delete").onclick = () => {
      const what = t("movimientos.delete.what", {
        merchant: d.merchant || byId[d.categoryId]?.name || t(TIPO_KEY[d.type]),
        amount: fmtMoney(d.cents),
        date: fmtDiaLargo(d.fecha),
      });
      showConfirm({
        title: t("movimientos.delete.title"),
        message: t("movimientos.delete.message", { what }),
        cancelText: t("common.cancel"),
        confirmText: t("common.delete"),
        onConfirm: async () => {
          // El modal ya se ha desmontado; el botón sigue vivo detrás hasta que goBack() cierre el
          // detalle, así que se deshabilita para que un segundo toque no abra otro modal.
          const btn = container.querySelector("#mov-delete");
          if (btn) btn.disabled = true;
          try {
            await softDeleteTransaction(state.detailId);
            await onChanged();
            goBack();
          } catch (e) {
            if (btn) btn.disabled = false;
            errorMsg = t("movimientos.error.delete", { error: userMessage(e) });
            renderDetail();
          }
        },
      });
    };
  }

  onOpen();
  renderDetail();
  return () => {
    if (detailPhotoUrl) { URL.revokeObjectURL(detailPhotoUrl); detailPhotoUrl = null; }
  };
}
