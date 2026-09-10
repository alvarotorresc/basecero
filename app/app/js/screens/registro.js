import {
  addTransaction, getOpenPeriod, listExpenseLeafCategories, listIncomeCategories,
  listAccounts, allCategoriesById, recentForRefund, getMetaAll, softDeleteTransaction,
  loadMerchantMemory, spentByRootCategory, budgetsOfPeriod, listTags, createTag,
} from "../repo.js";
import { colorForCategory, iconForCategory, textColorForCategory } from "../category-colors.js";
import { budgetMap } from "../category-spend.js";
import { limitWarning } from "../limit-warning.js";
import { fmtMoney, fmtMoneyParts, fmtDiaCorto, hoyISO, currencySymbol, parseCentsRaw, centsToRaw } from "../format.js";
import { resolveAccountId } from "../account-defaults.js";
import { icon } from "../icons.js";
import { t, activeLang } from "../i18n/index.js";
import { metaHtml, subHeaderHtml } from "../ui.js";
import { PCT_STEP, normalizePct, stepPct, splitCents } from "../share-pct.js";
import { userMessage } from "../errors.js";
import { focusInput } from "../viewport.js";
import { showReceipt } from "../recibo.js";
import { showToast } from "../toast.js";
import { quickRegisterEnabled, detailsOpen, foldedSummaryParts, visibleCategories } from "../registro-mode.js";
import { normalizeMerchant, memoryPatch } from "../merchant-memory.js";
import { parseNaturalExpense } from "../natural.js";
import { speech } from "../speech.js";

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

// Icono "etiqueta"/"más" del repertorio SISTEMA.md §3 (icons.js), ya no copias locales.
const ICON_TAG = icon("tag", { size: 14 });
const ICON_PLUS_SMALL = icon("plus", { size: 13, width: 2 });

/** Copia de la banda de límite (Registro v2 §6.2): «Con este gasto quedan {amount} de {name}» en
 *  ok/warn, «…te pasas {amount}…» en over. Devuelve texto SIN escapar — quien la use en un
 *  `innerHTML` (render()) lo escapa; quien la use en `textContent` (el oninput del importe) no
 *  necesita, y escaparlo dos veces convertiría un «&» legítimo del nombre de una categoría en
 *  «&amp;amp;». */
function limitBandText(warning) {
  const amount = fmtMoney(Math.abs(warning.remainingAfterCents));
  return warning.level === "over"
    ? t("registro.limit.over", { amount, name: warning.rootName })
    : t("registro.limit.remaining", { amount, name: warning.rootName });
}

/** Monta la pantalla completa de registro rápido de un movimiento (5 tipos).
 *  onDone() se llama tanto al cerrar (✕) como tras guardar con éxito.
 *  prefill opcional (Task 11): {type, amountCents, categoryId, accountId, merchant, ruleId, isShared}.
 *  onUndone opcional (reskin v2, Task 12): refresca la pantalla de detrás cuando se pulsa
 *  «Deshacer» en el recibo — sin esto, el movimiento borrado se queda pintado hasta la siguiente
 *  navegación. */
export async function renderRegistro(container, onDone, prefill, onUndone) {
  let period, expenseCats, incomeCats, accountsAll, byId, meta, merchantMemoryMap, tagsAll;
  try {
    [period, expenseCats, incomeCats, accountsAll, byId, meta, merchantMemoryMap, tagsAll] = await Promise.all([
      getOpenPeriod(),
      listExpenseLeafCategories(),
      listIncomeCategories(),
      listAccounts(),
      allCategoriesById(),
      getMetaAll(),
      loadMerchantMemory(),
      listTags(),
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

  // Registro v2 §6.2: datos del aviso de límite, cargados aquí (no en el Promise.all de arriba)
  // porque necesitan period.id, que ese Promise.all todavía está resolviendo. Mismo criterio y
  // mismo try/catch que refundCandidates: un fallo aquí degrada a "sin aviso", no rompe la pantalla.
  let spentByRoot = {}, budgetByCategory = {};
  if (period) {
    try {
      const [spentRows, budgetRows] = await Promise.all([spentByRootCategory(period.id), budgetsOfPeriod(period.id)]);
      spentByRoot = Object.fromEntries(spentRows.map((r) => [r.root_id, r.spent_cents]));
      budgetByCategory = budgetMap(budgetRows);
    } catch { spentByRoot = {}; budgetByCategory = {}; }
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
    // Etiquetas de proyecto (N11, Task 13): D11 — jamás llega de merchantMemory/memoryPatch (ver
    // merchant-memory.test.mjs), solo de un prefill explícito (p.ej. una regla recurrente que ya
    // trajera una). tagPickerOpen/newTagDraft son puro estado de UI del selector inline, igual que
    // en movimientos.js#openDetail.
    tagId: prefill?.tagId ?? null,
    tagPickerOpen: false,
    newTagDraft: null,
    adjustmentSign: "+",
    refundPickerOpen: false,
    // Registro v2 §8.6: caja de lenguaje natural. `text` es lo tecleado o dictado (NO se
    // interpreta en el oninput: eso mataría el cursor, igual que #reg-raw/#reg-merchant); `parsed`
    // es el último resultado de parseNaturalExpense, y es lo que pinta los chips; `micOff` se
    // enciende para el resto de la sesión de pantalla si el usuario deniega el permiso.
    natural: { text: "", parsed: null, listening: false, micOff: false },
    // Registro v2 §4: quick gobierna qué se pinta (registro-mode.js#detailsOpen); expanded es el
    // «Más» tocado a mano en ESTE formulario (nunca persiste entre aperturas de Registro).
    // allCats: se pasó de las CATS_GRID_LIMIT primeras categorías a la lista entera («Ver las N
    // categorías»); una vez tocado no se vuelve a plegar en este formulario.
    quick: quickRegisterEnabled(meta.quick_register),
    expanded: false,
    allCats: false,
    // Registro v2 §9.3: el desplegable manual de "los otros tres tipos" — se cierra al cambiar de
    // tipo (ver el handler de [data-tipo]); typeSelectorHtml lo vuelve a abrir solo si hace falta.
    typeMoreOpen: false,
    // Registro v2 §5.4: campos que el usuario ya tocó a mano en ESTE formulario — la memoria de
    // comercios nunca vuelve a pisarlos (registro-mode no interviene aquí; es del formulario, no
    // de la densidad). merchantRemembered pinta la pista «recordado de la última vez». Un prefill
    // (Task 11: regla recurrente, importación…) YA es una decisión explícita para los campos que
    // trae puestos — se siembra touched con ellos para que escribir el comercio después no los
    // pise con lo que dice la memoria.
    touched: new Set(["categoryId", "accountId", "isShared", "paidBy", "sharePct"].filter((f) => prefill && prefill[f] !== undefined)),
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
    state.touched.add("categoryId");
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

  /** Caja de lenguaje natural (Registro v2 §8.6). Vacía: fila de reposo de 44px con el micro (solo
   *  si `speech.supported` y el usuario no lo ha apagado esta sesión) y el ejemplo. Con texto: el
   *  bloque interpretado sobre --accent-tint con la frase entre comillas, el enlace «Borrar» y
   *  hasta cuatro chips — importe/categoría/comercio/compartido, uno por cada campo que el parser
   *  SÍ entendió (spec: "lo que el parser no entendió simplemente no produce chip"). Solo para
   *  gasto e ingreso: una frase no puede describir una transferencia, devolución ni ajuste.
   *  Estilos inline (nunca app.css, spec §8.6/§8.7: el fichero queda fuera de los dos paquetes de
   *  esta PR para que el único cherry-pick delicado —dos paquetes tocando registro.js— no tenga
   *  que fundir también una hoja de estilos). */
  function naturalBoxHtml() {
    if (state.tipo !== "expense" && state.tipo !== "income") return "";
    const { text } = state.natural;
    const micAvailable = !!speech?.supported && !state.natural.micOff;
    // §13.10 de la spec (a validar por Álvaro, recomendación adoptada): el reconocimiento de voz
    // del navegador NO es local — el audio sale a un servidor del fabricante. Se dice bajo la caja,
    // solo cuando el micro está disponible (si no hay soporte, o el usuario ya lo apagó esta
    // sesión, no hay nada que avisar).
    const micNotice = micAvailable
      ? `<span style="font-size:11px; color:var(--ink-3);">${t("registro.natural.micNotice")}</span>` : "";
    if (!text.trim()) {
      // Mientras el reconocedor está abierto no hay input editable que mostrar: la fila se
      // sustituye por «Escuchando…» (registro.natural.micListening) hasta que llegue el resultado
      // o el error — ver el handler de #reg-nat-mic en wire().
      const rowInner = state.natural.listening
        ? `${icon("mic", { size: 20, stroke: "var(--accent)" })}<span style="font-size:14px; color:var(--ink-3);">${t("registro.natural.micListening")}</span>`
        : `${micAvailable ? `<button type="button" id="reg-nat-mic" aria-label="${escAttr(t("registro.natural.mic"))}" style="border:0; background:transparent; padding:0; display:flex; align-items:center; flex-shrink:0; cursor:pointer;">${icon("mic", { size: 20, stroke: "var(--accent)" })}</button>` : ""}
           <input type="text" id="reg-nat-input" value="${escAttr(text)}" placeholder="${escAttr(t("registro.natural.placeholder"))}" autocomplete="off"
             style="flex:1; min-width:0; border:0; background:none; color:var(--ink); font-size:14px; outline:none;">`;
      return `
      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px;">
        <div style="display:flex; align-items:center; gap:11px; height:44px; background:var(--surface-2); border:1px solid var(--hairline); padding:0 14px; box-sizing:border-box;">
          ${rowInner}
        </div>
        ${micNotice}
      </div>`;
    }
    const parsed = state.natural.parsed;
    const chips = [];
    if (parsed?.cents != null) {
      chips.push(`<button type="button" data-nat-chip="amount" style="height:44px;border-radius:999px;border:1px solid var(--hairline-strong);background:var(--surface-2);color:var(--ink);font:600 13px var(--font-num);padding:0 13px;cursor:pointer;">${escHtml(fmtMoney(parsed.cents))}</button>`);
    }
    if (parsed?.categoryId && byId[parsed.categoryId]) {
      const color = colorForCategory(parsed.categoryId, byId);
      const textColor = textColorForCategory(parsed.categoryId, byId);
      const catEmoji = iconForCategory(parsed.categoryId, byId);
      chips.push(`<button type="button" data-nat-chip="category" style="height:44px;border-radius:999px;border:1px solid color-mix(in srgb, ${color} 42%, transparent);background:color-mix(in srgb, ${color} 16%, transparent);color:${textColor};font-size:13px;font-weight:500;padding:0 12px;display:flex;align-items:center;gap:6px;cursor:pointer;"><span style="font-size:13px;" aria-hidden="true">${catEmoji}</span>${escHtml(byId[parsed.categoryId].name)}</button>`);
    }
    if (parsed?.merchant) {
      chips.push(`<button type="button" data-nat-chip="merchant" style="height:44px;border-radius:999px;border:1px solid var(--hairline-strong);background:var(--surface-2);color:var(--ink);font-size:13px;font-weight:500;padding:0 13px;cursor:pointer;">${escHtml(parsed.merchant)}</button>`);
    }
    if (parsed?.shared) {
      chips.push(`<button type="button" data-nat-chip="shared" style="height:44px;border-radius:999px;border:1px solid var(--hairline-strong);background:var(--surface-2);color:var(--ink);font-size:13px;font-weight:500;padding:0 13px;cursor:pointer;">${escHtml(t("registro.natural.sharedChip", { name: partnerName, pct: parsed.sharePct ?? state.sharePct }))}</button>`);
    }
    return `
    <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px;">
      <div style="display:flex; flex-direction:column; gap:11px; padding:16px; background:var(--accent-tint);">
        <div style="display:flex; align-items:flex-start; gap:11px;">
          ${icon("mic", { size: 20, stroke: "var(--accent)", style: "flex-shrink:0;margin-top:1px;" })}
          <span style="font-size:15px; line-height:1.4; color:var(--ink); flex:1; min-width:0;">${chips.length ? `«${escHtml(text)}»` : escHtml(t("registro.natural.notUnderstood"))}</span>
          <button type="button" id="reg-nat-reset" style="border:0; background:transparent; color:var(--ink-3); font-size:13px; font-weight:500; padding:0; height:24px; flex-shrink:0; cursor:pointer;">${t("registro.natural.reset")}</button>
        </div>
        ${chips.length ? `<div style="display:flex; flex-wrap:wrap; gap:7px;">${chips.join("")}</div>` : ""}
      </div>
      ${micNotice}
    </div>`;
  }

  /** Interpreta `text` (tecleado o dictado) y aplica al formulario lo que el parser entendió
   *  (Registro v2 §8.6). LA FRASE GANA SOBRE `touched`: es el acto explícito más reciente del
   *  usuario, así que cada campo que toca aquí entra también en `state.touched` para que el
   *  `oninput` del comercio (memoryPatch, más abajo) no lo vuelva a pisar después con lo que diga
   *  la memoria — la memoria sigue cediendo, igual que hoy. `sharePct` pasa por `normalizePct`,
   *  igual que el parche de la memoria. No pide foco: el foco al importe lo pide SIEMPRE quien
   *  llama, después de esta función (invariante de foco, `:862-871` — nunca desde aquí ni desde
   *  render()). */
  function applyNatural(text) {
    state.natural.text = text;
    const parsed = parseNaturalExpense(text, {
      categories: categoriesFor(), accounts, merchants: merchantMemoryMap,
      counterpartName: partnerName, today: hoyISO(), lang: activeLang(),
    });
    state.natural.parsed = parsed;
    if (parsed.cents != null) { state.cents = parsed.cents; state.raw = centsToRaw(parsed.cents); }
    if (parsed.merchant != null) state.merchant = parsed.merchant;
    if (parsed.categoryId != null) { state.categoryId = parsed.categoryId; state.touched.add("categoryId"); }
    if (parsed.accountId != null) { state.accountId = parsed.accountId; state.touched.add("accountId"); }
    if (parsed.date != null) state.fecha = parsed.date;
    if (parsed.shared) {
      state.isShared = true;
      state.touched.add("isShared");
      if (parsed.sharePct != null) { state.sharePct = normalizePct(parsed.sharePct, state.sharePct); state.touched.add("sharePct"); }
    }
    render();
  }

  /** Nombre de una etiqueta por id (Task 13). `tagsAll` es SOLO activas (listTags, un movimiento
   *  nuevo no puede nacer con una ya archivada salvo por un prefill futuro que hoy nadie manda) —
   *  a diferencia de movimientos.js#tagName, que resuelve contra tagTotalsAll para poder enseñar
   *  el nombre de una archivada ya asignada a un movimiento existente. */
  function tagName(id) {
    return tagsAll.find((tg) => tg.id === id)?.name ?? "";
  }

  /** Control «Etiqueta» (Task 13, mismo selector inline que movimientos.js#renderTagControl —
   *  ver el Step 2 del plan: «mismo que el detalle»). Vive dentro del bloque que se pliega tras
   *  «Más» en modo rápido (misma guarda que cuenta/comercio/fecha/nota, ver render()). */
  function renderTagControl() {
    if (!state.tagPickerOpen) {
      const hasTag = !!state.tagId;
      return `
      <button type="button" class="chip${hasTag ? " is-tag" : ""}" id="reg-tag-chip"
        style="align-self:flex-start;padding:0 14px;display:inline-flex;align-items:center;gap:7px;${hasTag ? "" : "background:transparent;border:1px dashed var(--rule);"}">
        ${ICON_TAG}${hasTag ? escHtml(tagName(state.tagId)) : t("movimientos.detail.noTag")}
      </button>`;
    }
    return `
    <div class="chips">
      <button type="button" class="chip${!state.tagId ? " active" : ""}" data-tag-pick="">${t("movimientos.detail.noTag")}</button>
      ${tagsAll.map((tg) => `<button type="button" class="chip${state.tagId === tg.id ? " active" : ""}" data-tag-pick="${escAttr(tg.id)}">${ICON_TAG}${escHtml(tg.name)}</button>`).join("")}
      ${state.newTagDraft == null ? `
      <button type="button" id="reg-tag-new" class="chip" style="background:transparent;border:1px dashed var(--rule);">${ICON_PLUS_SMALL}${t("movimientos.detail.newTag")}</button>
      ` : `
      <span style="display:inline-flex;align-items:center;gap:6px;">
        <input type="text" id="reg-tag-new-input" value="${escAttr(state.newTagDraft)}" placeholder="${escAttr(t("etiquetas.form.namePlaceholder"))}"
          style="height:44px;min-width:0;border:1px solid var(--rule);border-radius:999px;padding:0 14px;background:none;color:var(--text);font:14px inherit;">
        <button type="button" id="reg-tag-new-save" class="icon-btn" aria-label="${t("common.save")}" style="width:44px;height:44px;flex-shrink:0;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"></path></svg>
        </button>
      </span>`}
    </div>`;
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
          ${metaHtml([label, fmtMoney(linked.amount_cents)])}
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
    // partnerName SIN escHtml aquí: summaryHtml (abajo) escapa cada trozo del resumen una vez —
    // escaparlo también aquí convertiría un «&» legítimo del nombre en «&amp;amp;».
    const sharedLabel = needsCategory(state.tipo) && state.tipo !== "income" && partnerName && state.isShared
      ? t("common.sharedWith", { name: partnerName })
      : "";
    const tagLabel = state.tagId ? tagName(state.tagId) : "";
    const parts = foldedSummaryParts({ accountName, dateLabel, hasNote, hasPhoto: false, sharedLabel, tagName: tagLabel }, t);
    const summaryHtml = parts.map((p, i) => (i === 0 ? "" : `<span style="width:1px;height:11px;background:var(--hairline-strong);flex-shrink:0;"></span>`)
      + `<span style="font-size:12px;font-weight:500;color:var(--text-3);">${escHtml(p)}</span>`).join("");
    return `
    <button type="button" id="reg-more-toggle" aria-expanded="false" style="display:flex; align-items:center; gap:12px; width:100%; min-height:60px; padding:10px 0; margin-top:12px; border:0; border-top:1px solid var(--hairline); border-bottom:1px solid var(--hairline); background:transparent; color:inherit; text-align:left; cursor:pointer; -webkit-tap-highlight-color:transparent;">
      <div style="display:flex; flex-direction:column; gap:4px; flex:1; min-width:0;">
        <span style="font-size:14px; font-weight:600;">${t("registro.more.toggle")}</span>
        <div style="display:flex; align-items:center; gap:9px; flex-wrap:wrap;">${summaryHtml}</div>
      </div>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;"><path d="M5 9.5 12 16l7-6.5"></path></svg>
    </button>`;
  }

  /** Selector de tipo (Registro v2 §9.3): en modo rápido, CON el bloque plegable cerrado, NO se
   *  pinta — el formulario queda fijo a gasto. En cuanto el bloque está abierto (modo completo, o
   *  modo rápido tras tocar «Más» — detailsOpen() es el mismo criterio que gatea cuenta/comercio/
   *  fecha/nota) aparecen dos píldoras siempre visibles (Gasto/Ingreso) + un botón circular de
   *  30px que despliega los otros tres tipos (transferencia/devolución/ajuste). La rejilla extra se
   *  enseña si el usuario la ha abierto a mano O si el tipo activo ya es uno de esos tres — así un
   *  prefill de transferencia no aterriza con su propio tipo escondido. */
  function typeSelectorHtml(formOpen) {
    if (!formOpen) return "";
    const mainTipos = TIPOS.filter((tp) => tp.id === "expense" || tp.id === "income");
    const extraTipos = TIPOS.filter((tp) => tp.id !== "expense" && tp.id !== "income");
    const extraOpen = state.typeMoreOpen || extraTipos.some((tp) => tp.id === state.tipo);
    const pillStyle = (active) => active
      ? "height:44px;border-radius:999px;border:0;background:var(--surface-2);color:var(--ink);font-size:13px;font-weight:600;padding:0 13px;cursor:pointer;"
      : "height:44px;border-radius:999px;border:1px solid var(--hairline-strong);background:transparent;color:var(--ink-3);font-size:13px;font-weight:500;padding:0 13px;cursor:pointer;";
    return `
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
      <div style="display:flex; align-items:center; gap:6px;">
        ${mainTipos.map((tp) => `<button type="button" data-tipo="${tp.id}" style="${pillStyle(state.tipo === tp.id)}">${t(tp.labelKey)}</button>`).join("")}
        <button type="button" id="reg-type-more" aria-label="${escAttr(t("registro.type.more"))}" aria-expanded="${extraOpen ? "true" : "false"}"
          style="width:30px;height:30px;border-radius:999px;border:1px solid var(--hairline-strong);background:transparent;color:var(--ink-3);display:flex;align-items:center;justify-content:center;padding:0;flex-shrink:0;cursor:pointer;">
          ${icon("chevronDown", { size: 16 })}
        </button>
      </div>
      ${extraOpen ? `
      <div class="chips">
        ${extraTipos.map((tp) => `<button type="button" data-tipo="${tp.id}" class="chip${state.tipo === tp.id ? " active" : ""}">${t(tp.labelKey)}</button>`).join("")}
      </div>` : ""}
    </div>`;
  }

  function render() {
    const cats = categoriesFor();
    const { mine: myCents, partner: partnerCents } = state.isShared ? splitCents(state.cents, state.sharePct) : { mine: state.cents, partner: 0 };
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
    // Registro v2 §6: solo un GASTO gasta contra un límite (limit-warning.js no recibe `tipo`:
    // el gating de qué tipos preguntan es de aquí). amountCents es MI PARTE (myCents), no el
    // ticket completo — MY_AMOUNT es también el criterio de SQL.spentByRootCategory.
    const warning = state.tipo === "expense"
      ? limitWarning({ categoryId: state.categoryId, amountCents: myCents, byId, spentByRoot, budgetByCategory })
      : null;
    // D13: el héroe de 56px es solo el registro rápido "de verdad" (bloque plegable cerrado); en
    // cuanto se ve el resto del formulario —modo completo, o modo rápido tras tocar «Más»— la
    // pantalla ya es visualmente RegistroCompleto.dc.html, con el importe a 36px.
    const formOpen = detailsOpen({ quick: state.quick, expanded: state.expanded, tipo: state.tipo });

    container.innerHTML = `
      ${subHeaderHtml({ id: null, title: t("registro.title"), action: { id: "reg-close", icon: "close", label: t("registro.close") } })}

      ${naturalBoxHtml()}

      ${typeSelectorHtml(formOpen)}

      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px; padding-bottom:10px; border-bottom:2px solid var(--accent);">
        <span style="font-size:13px; font-weight:500; color:var(--accent);">${t("common.amount")}</span>
        <div class="amount-display" style="align-items:center;">
          ${state.tipo === "adjustment" ? `<button type="button" class="icon-btn" id="reg-sign" aria-label="${t("common.changeSign")}" style="font-size:18px; font-weight:700;">${state.adjustmentSign}</button>` : ""}
          <input type="text" inputmode="decimal" id="reg-raw" value="${escAttr(state.raw)}" placeholder="0" autocomplete="off"
            style="border:0;background:none;color:var(--ink);font:600 ${formOpen ? "36" : "56"}px var(--font-num);letter-spacing:-0.02em;width:100%;outline:none;">
          <span class="amount-currency">${escHtml(currencySymbol())}</span>
        </div>
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
            const categoryEmoji = iconForCategory(c.id, byId);
            const active = state.categoryId === c.id;
            const chipStyle = active
              ? `--cat:${color};background:color-mix(in srgb, ${color} 16%, transparent);color:${textColor};font-weight:700;`
              : `--cat:${color};`;
            // Celda plana (Registro v2 §9.3): SIN la insignia circular de .chip-icon, que es para
            // la fila horizontal de filtro — aquí el emoji va suelto a 21px, como el artboard.
            return `<button type="button" class="chip-v${active ? " active" : ""}" data-cat="${c.id}" style="${chipStyle}">
              <span style="font-size:21px;line-height:1;" aria-hidden="true">${categoryEmoji}</span><span>${escHtml(c.name)}</span>
            </button>`;
          }).join("")}
        </div>
        ${hidden > 0 ? `
        <button type="button" id="reg-cats-more" aria-expanded="false" style="border:0;background:transparent;color:var(--text-3);font-size:13px;font-weight:500;padding:0;height:44px;display:flex;align-items:center;gap:6px;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          ${t("registro.categories.showAll", { n: cats.length })}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9.5 12 16l7-6.5"></path></svg>
        </button>` : ""}
      </div>`;
      })() : ""}

      ${warning ? `
      <div class="limit-band ${warning.level}" id="reg-limit-band" role="status" aria-live="polite">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4.5 21 19.5H3z"></path><path d="M12 10v4"></path><path d="M12 17h.01"></path></svg>
        <span id="reg-limit-text">${escHtml(limitBandText(warning))}</span>
      </div>` : ""}

      ${detailsOpen({ quick: state.quick, expanded: state.expanded, tipo: state.tipo }) ? `
      ${partnerPaid() ? "" : renderAccountsSection()}

      ${state.tipo === "refund" ? renderRefundPicker() : ""}

      <div style="display:flex; gap:8px; margin-bottom:12px;">
        <label class="field field-stack" style="flex:1;">
          <span style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
            <span class="field-label">${t("common.merchant")}</span>
            ${state.merchantRemembered ? `<span style="font-size:11px; font-weight:500; color:var(--accent);">${t("registro.merchant.remembered")}</span>` : ""}
          </span>
          <input type="text" id="reg-merchant" list="reg-merchants" value="${escAttr(state.merchant)}" placeholder="${t("common.optional")}">
        </label>
        <label class="field field-stack" style="flex:1;">
          <span class="field-label">${t("common.date")}</span>
          <input type="date" id="reg-fecha" value="${state.fecha}">
        </label>
      </div>
      <datalist id="reg-merchants">
        ${merchantOptions.map((e) => `<option value="${escAttr(e.display)}"></option>`).join("")}
      </datalist>

      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">${t("movimientos.detail.tagLabel")}</div>
        ${renderTagControl()}
      </div>

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
              <div style="font-size:10px; color:var(--text-3);">${metaHtml([t("common.myShare"), t("common.pctValue", { pct: state.sharePct })])}</div>
              <div class="num" id="reg-split-mine" style="font-size:15px; font-weight:600;">${fmtMoney(myCents)}</div>
            </div>
            <div style="flex:1; background:var(--card2); border-radius:0; padding:10px 11px;">
              <div style="font-size:10px; color:var(--text-3);">${partnerPaid() ? metaHtml([t("common.paidByName", { name: partnerName }), t("common.paidTotal")]) : metaHtml([partnerName, t("common.pctValue", { pct: 100 - state.sharePct })])}</div>
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

    // PB-1 · Lenguaje natural (Registro v2 §8.6): un único camino de interpretación para el texto,
    // Enter, blur y el resultado de voz. El oninput de la caja SOLO guarda el texto y NUNCA repinta
    // ni interpreta — repintar en cada tecla mataría el cursor, mismo criterio que #reg-raw/
    // #reg-merchant/#reg-tag-new-input.
    const natInput = container.querySelector("#reg-nat-input");
    if (natInput) {
      natInput.oninput = (e) => { state.natural.text = e.target.value; };
      natInput.onkeydown = (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        applyNatural(natInput.value);
        focusInput(container.querySelector("#reg-raw"));
      };
      // Simplificación deliberada respecto al plan («si el texto cambió desde la última
      // interpretación»): volver a interpretar un texto ya interpretado es idempotente (mismo
      // resultado, mismo render()), así que blur siempre interpreta si hay texto — evita tener que
      // guardar un campo extra de "último texto interpretado" fuera de la forma exacta de estado
      // que fija el plan ({text, parsed, listening, micOff}).
      natInput.onblur = () => {
        if (natInput.value.trim()) applyNatural(natInput.value);
      };
    }

    const natMicBtn = container.querySelector("#reg-nat-mic");
    if (natMicBtn) natMicBtn.onclick = () => {
      state.natural.listening = true;
      render();
      speech.start(
        (resultText) => {
          state.natural.listening = false;
          applyNatural(resultText);
          focusInput(container.querySelector("#reg-raw"));
        },
        () => {
          state.natural.listening = false;
          state.natural.micOff = true;
          render();
          showToast(t("registro.natural.micDenied"));
        },
      );
    };

    const natReset = container.querySelector("#reg-nat-reset");
    if (natReset) natReset.onclick = () => {
      // micOff NO se resetea: es de sesión de pantalla (spec §8.6), sobrevive a «Borrar». Tampoco
      // deshace lo que ya rellenó en el formulario — eso lo edita el usuario campo a campo.
      state.natural = { text: "", parsed: null, listening: false, micOff: state.natural.micOff };
      render();
    };

    container.querySelectorAll("[data-nat-chip]").forEach((b) => {
      b.onclick = () => {
        const field = b.dataset.natChip;
        // Solo comercio y compartido viven dentro del bloque plegable de "Más" (registro.js real:
        // la rejilla de categorías y el importe están SIEMPRE visibles, nunca detrás de "Más" —
        // desviación de la redacción literal de la spec §8.6 respecto al código real, que pide
        // "despliega Más si hace falta" también para el chip de categoría; se resuelve a favor del
        // código, que ya garantiza la categoría elegida visible vía visibleCategories, :429).
        const needsExpand = (field === "merchant" || field === "shared")
          && !detailsOpen({ quick: state.quick, expanded: state.expanded, tipo: state.tipo });
        if (needsExpand) state.expanded = true;
        render();
        if (field === "amount") {
          focusInput(container.querySelector("#reg-raw"));
        } else if (field === "category" && state.categoryId) {
          container.querySelector(`[data-cat="${state.categoryId}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
        } else if (field === "merchant") {
          focusInput(container.querySelector("#reg-merchant"));
        } else if (field === "shared") {
          container.querySelector("#reg-shared")?.scrollIntoView({ block: "nearest" });
        }
      };
    });

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
        // Cierra el desplegable manual: typeSelectorHtml lo reabre solo si el tipo elegido es uno
        // de los tres que vive dentro de él.
        state.typeMoreOpen = false;
        errorMsg = "";
        render();
      };
    });

    const typeMoreBtn = container.querySelector("#reg-type-more");
    if (typeMoreBtn) typeMoreBtn.onclick = () => {
      state.typeMoreOpen = !state.typeMoreOpen;
      render();
    };

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
        state.touched.add("paidBy");
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
      const { mine: myCents, partner: partnerCents } = splitCents(state.cents, state.sharePct);
      const mineEl = container.querySelector("#reg-split-mine");
      const partnerEl = container.querySelector("#reg-split-partner");
      if (state.isShared && mineEl && partnerEl) {
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
      // Registro v2 §6.2: la banda de límite se recalcula en el oninput y se PARCHEA (texto +
      // clase), igual que el reparto de arriba — nunca render() completo aquí. La banda solo
      // existe ya en el DOM si categoría+límite estaban puestos en el último render(): typing el
      // importe nunca hace aparecer ni desaparecer la banda, solo cambia su contenido.
      const limitBandEl = container.querySelector("#reg-limit-band");
      if (limitBandEl && state.tipo === "expense") {
        const w = limitWarning({ categoryId: state.categoryId, amountCents: state.isShared ? myCents : state.cents, byId, spentByRoot, budgetByCategory });
        if (w) {
          limitBandEl.className = `limit-band ${w.level}`;
          limitBandEl.querySelector("#reg-limit-text").textContent = limitBandText(w);
        }
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
        // merchantHistory mezcla expense/income/refund del mismo comercio: la categoría recordada
        // puede ser de un tipo distinto al que se está rellenando ahora (merchant-memory.js#memoryPatch).
        const patch = memoryPatch(entry, state.touched, categoriesFor().map((c) => c.id));
        // Sin pareja, el toggle de compartido ni se pinta (línea 408): un isShared/paidBy/sharePct
        // recordado de cuando SÍ había pareja (partnerName cambiado o borrado desde entonces)
        // colaría un partnerPaid() falso y ocultaría la cuenta como obligatoria sin decirlo.
        if (!partnerName) { delete patch.isShared; delete patch.paidBy; delete patch.sharePct; }
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

    // Selector de etiqueta (Task 13): mismo criterio que movimientos.js#wireDetail — puro estado
    // de UI hasta guardar. Invariante del foco (§4.5): SOLO el handler de «Nueva etiqueta» pide
    // foco tras su propio render(), nunca desde render() en sí — el foco de #reg-raw al arrancar
    // la pantalla (línea final de renderRegistro) no debe volver a robarse en cada repintado.
    const tagChip = container.querySelector("#reg-tag-chip");
    if (tagChip) tagChip.onclick = () => { state.tagPickerOpen = true; render(); };
    container.querySelectorAll("[data-tag-pick]").forEach((b) => {
      b.onclick = () => {
        state.tagId = b.dataset.tagPick || null;
        state.tagPickerOpen = false;
        state.newTagDraft = null;
        render();
      };
    });
    const tagNewBtn = container.querySelector("#reg-tag-new");
    if (tagNewBtn) tagNewBtn.onclick = () => {
      state.newTagDraft = "";
      render();
      focusInput(container.querySelector("#reg-tag-new-input"));
    };
    const tagNewInput = container.querySelector("#reg-tag-new-input");
    if (tagNewInput) {
      // Sin render() en oninput (perdería el foco, mismo motivo que #reg-raw/#reg-merchant): el
      // valor tecleado solo se lee al pulsar guardar o Enter, ver submitNewTag.
      tagNewInput.oninput = (e) => { state.newTagDraft = e.target.value; };
      tagNewInput.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submitNewTag(); } };
    }
    const tagNewSave = container.querySelector("#reg-tag-new-save");
    if (tagNewSave) tagNewSave.onclick = () => submitNewTag();

    async function submitNewTag() {
      const btn = container.querySelector("#reg-tag-new-save");
      if (btn) btn.disabled = true;
      try {
        const newId = await createTag({ name: state.newTagDraft });
        tagsAll = await listTags();
        state.tagId = newId;
        state.tagPickerOpen = false;
        state.newTagDraft = null;
        render();
      } catch (e) {
        if (btn) btn.disabled = false;
        errorMsg = t("common.saveFailed", { error: userMessage(e) });
        render();
      }
    }

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
    if (pctDown) pctDown.onclick = () => { state.sharePct = stepPct(state.sharePct, -PCT_STEP); state.touched.add("sharePct"); render(); };
    const pctUp = container.querySelector("#reg-pct-up");
    if (pctUp) pctUp.onclick = () => { state.sharePct = stepPct(state.sharePct, PCT_STEP); state.touched.add("sharePct"); render(); };

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
          tagId: state.tagId || "",
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
            { label: t("recibo.tagLabel"), value: state.tagId ? tagName(state.tagId) : "" },
            { label: t("common.split.label"), value: effectiveIsShared ? `${partnerName} ${state.sharePct} %` : "" },
            { label: t("recibo.myPart"), value: effectiveIsShared ? fmtMoney(splitCents(state.cents, state.sharePct).mine) : "" },
          ],
          total: fmtMoneyParts(state.cents),
          stampDate: `${fmtDiaCorto(hoyISO()).toUpperCase()} ${now.getFullYear()}`,
          labels: { brand: "BaseCero", stamp: t("recibo.stamp"), total: t("recibo.total"), undo: t("recibo.undo") },
          onUndo: async () => {
            try {
              // Borrado LÓGICO (softDeleteTransaction), NUNCA un DELETE: si lo que se acaba de
              // guardar era una devolución/ajuste enlazado por refId, addTransaction ya puso
              // settled=1 en el gasto que enlaza (repo.js) — solo la rama refund/adjustment de
              // softDeleteTransaction (repo.js:399-403) deshace ese settled con
              // unsettleIfNoActiveSettlements. Un DELETE dejaría ese gasto marcado como liquidado
              // por un apunte que ya no existe.
              await softDeleteTransaction(newId);
              showToast(t("recibo.undone"));
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
