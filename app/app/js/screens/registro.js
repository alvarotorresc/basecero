import {
  addTransaction, getOpenPeriod, listExpenseLeafCategories, listIncomeCategories,
  listAccounts, allCategoriesById, recentForRefund, getMetaAll, softDeleteTransaction,
  loadMerchantMemory, spentByRootCategory, budgetsOfPeriod, listTags, createTag, setAttachmentFlag,
  listGoals, spentOfPeriod, previsionOfPeriod,
} from "../repo.js";
import { attachments, compressImage } from "../attachments.js";
import { familyForCategory, iconForCategory, rootOf, famClass } from "../category-colors.js";
import { familyForAccount, parseAccountStyle } from "../account-colors.js";
import { budgetMap } from "../category-spend.js";
import { limitWarning } from "../limit-warning.js";
import { fmtMoney, fmtMoneyParts, fmtDiaCorto, hoyISO, currencySymbol, parseCentsRaw, centsToRaw, appLocale } from "../format.js";
import { resolveAccountId } from "../account-defaults.js";
import { dailyAllowanceCents } from "../inicio-logic.js";
import { periodMonth } from "../prevision.js";
import { icon } from "../icons.js";
import { t, activeLang } from "../i18n/index.js";
import { metaHtml } from "../ui.js";
import { segmentedHtml, wireSegmented, switchHtml, stepperHtml, fieldHtml } from "../controls.js";
import { pickTileHtml, chosenCategoryHtml, filterChipHtml, badgeHtml, txRowHtml } from "../entity.js";
import { PCT_STEP, normalizePct, stepPct, splitCents } from "../share-pct.js";
import { userMessage } from "../errors.js";
import { focusInput } from "../viewport.js";
import { showReceipt } from "../recibo.js";
import { showToast } from "../toast.js";
import { quickRegisterEnabled, detailsOpen, foldedSummaryParts, visibleCategories } from "../registro-mode.js";
import { normalizeMerchant, memoryPatch } from "../merchant-memory.js";
import { parseNaturalExpense } from "../natural.js";
import { speech } from "../speech.js";
import { escHtml, escAttr } from "../esc.js";

// labelKey/SAVE_KEY en vez de texto resuelto: son consts de módulo, evaluadas al importar el
// fichero (antes de que boot() llame a initI18n con el idioma real) — si guardaran el string ya
// traducido, quedarían congeladas en español para siempre. Se resuelven con t() en cada render.
// Los tres primeros van en el Segmented de la cabecera (B-Gasto); devolución y ajuste, debajo.
const TIPOS_MAIN = [
  { id: "expense", labelKey: "common.type.expense" },
  { id: "income", labelKey: "common.type.income" },
  { id: "transfer", labelKey: "registro.type.transfer" },
];
const TIPOS_EXTRA = [
  { id: "refund", labelKey: "common.type.refund" },
  { id: "adjustment", labelKey: "common.type.adjustment" },
];
const TIPO_LABEL = Object.fromEntries([...TIPOS_MAIN, ...TIPOS_EXTRA].map((tp) => [tp.id, tp.labelKey]));
const SAVE_KEY = {
  expense: "registro.save.expense", income: "registro.save.income", transfer: "registro.save.transfer",
  refund: "registro.save.refund", adjustment: "registro.save.adjustment",
};
const needsCategory = (tipo) => tipo === "expense" || tipo === "income" || tipo === "refund";
// Columnas de la rejilla de familias (B-Gasto: 3 × 4 = las 12 familias sembradas).
const GRID_COLS = 3;
// Registro rápido plegado: cuántas familias se ven antes de «Ver las N categorías» (tres filas de
// tres). El literal vive aquí, no en registro-mode.js — el módulo puro solo decide CUÁLES entran.
const CATS_GRID_LIMIT = 9;

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

/** Ancho del input del importe en `ch` (la mono es tabular: un carácter, un ch). Así el símbolo de
 *  la moneda va pegado a la cifra, como en B-Gasto, en vez de al otro extremo del Display. */
const amountWidth = (raw) => `${Math.max(1, String(raw ?? "").length)}ch`;

/** Etiqueta del primario: «Guardar gasto de 18,50 €» (cifra en mono) solo para gasto con importe.
 *  HTML: el importe va escapado dentro de su <span>. */
function saveLabelHtml(tipo, cents) {
  return tipo === "expense" && cents > 0
    ? t("registro.save.expenseWithAmount", { amount: `<span class="num">${escHtml(fmtMoney(cents))}</span>` })
    : escHtml(t(SAVE_KEY[tipo]));
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
    container.innerHTML = `<div class="reg-error" role="alert">${icon("warn", { size: 18 })}<span>${t("registro.error.load", { error: escHtml(userMessage(e)) })}</span></div>`;
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
  // porque necesitan period.id. Un fallo aquí degrada a "sin aviso", no rompe la pantalla.
  let spentByRoot = {}, budgetByCategory = {};
  if (period) {
    try {
      const [spentRows, budgetRows] = await Promise.all([spentByRootCategory(period.id), budgetsOfPeriod(period.id)]);
      spentByRoot = Object.fromEntries(spentRows.map((r) => [r.root_id, r.spent_cents]));
      budgetByCategory = budgetMap(budgetRows);
    } catch { spentByRoot = {}; budgetByCategory = {}; }
  }

  // Familia de cada cuenta (C8, PR-10): la muestra de 10 de la fila de cuenta y del recibo. Los
  // objetivos solo deciden la familia por defecto de una hucha; si fallan, cae al tipo de cuenta.
  let goals = [];
  try { goals = await listGoals(); } catch { goals = []; }
  const accountStyle = parseAccountStyle(meta.account_style);
  const accountFam = (a) => (a ? familyForAccount(a, accountStyle, goals) : null);

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
    // merchant-memory.test.mjs), solo de un prefill explícito. tagPickerOpen/newTagDraft son puro
    // estado de UI del selector inline, igual que en movimientos.js#openDetail.
    tagId: prefill?.tagId ?? null,
    tagPickerOpen: false,
    newTagDraft: null,
    adjustmentSign: "+",
    refundPickerOpen: false,
    // Registro v2 §8.6: caja de lenguaje natural. `text` es lo tecleado o dictado (NO se
    // interpreta en el oninput: eso mataría el cursor); `parsed` es el último resultado de
    // parseNaturalExpense, y es lo que pinta los chips; `micOff` se enciende para el resto de la
    // sesión de pantalla si el usuario deniega el permiso.
    natural: { text: "", parsed: null, listening: false, micOff: false },
    // Registro v2 §4: quick gobierna qué se pinta (registro-mode.js#detailsOpen). Plegado: solo
    // importe y categoría, y la fila «Más» con el resumen. `expanded` es el «Más» tocado a mano en
    // ESTE formulario (nunca persiste). Con el ajuste apagado, B-Gasto completo. `allCats`: se
    // tocó «Ver las N categorías» (solo existe plegado). `noteOpen`: el botón de nota tocado.
    quick: quickRegisterEnabled(meta.quick_register),
    expanded: false,
    allCats: false,
    noteOpen: false,
    // Rejilla de familias (B-Gasto): qué baldosa tiene desplegadas sus subcategorías. null =
    // automático (la raíz de la categoría elegida); "" = cerrada a mano; un id = esa raíz.
    // Desplegar NO es seleccionar (DESIGN §9): la selección es siempre `categoryId`.
    openRoot: null,
    // Desplegables de cuenta ("from" | "to" | null) y de «Devolución o ajuste».
    accPicker: null,
    typeMoreOpen: false,
    // Registro v2 §5.4: campos que el usuario ya tocó a mano en ESTE formulario — la memoria de
    // comercios nunca vuelve a pisarlos. merchantRemembered pinta la pista «La que usas en…». Un
    // prefill YA es una decisión explícita para los campos que trae puestos.
    touched: new Set(["categoryId", "accountId", "isShared", "paidBy", "sharePct"].filter((f) => prefill && prefill[f] !== undefined)),
    merchantRemembered: false,
    // Foto del ticket (N5, Registro v2 §9.4): el Blob YA comprimido (compressImage), listo para
    // subir. El fichero no se escribe en OPFS hasta tener el id del movimiento.
    photo: null,
  };
  let errorMsg = "";
  // Foto del ticket (N5): URL del Blob de state.photo YA creada, o null. render() la reutiliza
  // (crear una nueva en cada repintado filtraría memoria) y la revoca en cuanto state.photo
  // cambia de referencia o se vacía.
  let photoObjectUrl = null;
  // D-3/D-4 (revisión de código): vida de la pantalla. Un callback async que resuelve DESPUÉS de
  // cerrar Registro (voz tardía, foto que tarda en comprimirse) no debe repintar `container` encima
  // de la pantalla que `nav()` ya puso detrás. Se apaga en los dos puntos de salida (✕ y guardar).
  let alive = true;
  const releasePhotoUrl = () => { if (photoObjectUrl) { URL.revokeObjectURL(photoObjectUrl); photoObjectUrl = null; } };
  // D-5 (revisión de código): último texto ya interpretado por Enter/blur/voz — un blur sobre un
  // texto sin cambios desde la última interpretación no repinta.
  let lastInterpreted = null;

  const categoriesFor = () => {
    if (state.tipo === "income") return incomeCats;
    if (needsCategory(state.tipo)) return expenseCats;
    return [];
  };

  /** Familia de una categoría para ESTE formulario: los ingresos no llevan familia (C9), aunque el
   *  byId de allCategoriesById no traiga `flow` para decirlo. */
  const catFam = (id) => (state.tipo === "income" ? null : familyForCategory(id, byId));

  /** ¿Es un gasto compartido que pagó la contraparte? Gatea la fila de cuenta, el guard de
   *  validación y lo que se guarda. Solo tiene sentido para expense. */
  const partnerPaid = () => state.tipo === "expense" && state.isShared && state.paidBy === "partner";

  /** Grupos de la rejilla: una baldosa por raíz, en el orden de la consulta (que ya agrupa por la
   *  posición de la raíz). `direct`: la raíz no tiene hijas que elegir — la baldosa elige ella
   *  misma, sin desplegar nada. Los ingresos llegan con raíces e hijas mezcladas: la raíz, si
   *  está, entra como una opción más de su grupo. */
  function categoryGroups(cats) {
    const order = [];
    const byRoot = new Map();
    for (const c of cats) {
      const root = rootOf(c.id, byId);
      if (!byRoot.has(root)) { byRoot.set(root, []); order.push(root); }
      byRoot.get(root).push(c);
    }
    return order.map((root) => {
      const items = byRoot.get(root);
      return { root, name: byId[root]?.name ?? items[0].name, items, direct: items.length === 1 && items[0].id === root };
    });
  }

  function selectRefundRow(row) {
    state.refId = row.id;
    state.categoryId = row.category_id;
    state.openRoot = null;
    state.touched.add("categoryId");
    if (row.is_shared) {
      // Solo precarga categoría + importe de la parte de la contraparte; el refund de
      // liquidación en sí NO se marca compartido (mismo criterio que
      // repo.settleAllSharedStmts: is_shared=0, ya es el 100% de lo que la contraparte debe).
      // Usa el pct EFECTIVO del gasto enlazado (su propio override, o el pct de SU periodo).
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

  /** Lenguaje natural (Registro v2 §8.6) solo para gasto e ingreso: una frase no puede describir
   *  una transferencia, devolución ni ajuste. */
  const naturalAllowed = () => state.tipo === "expense" || state.tipo === "income";
  const micAvailable = () => naturalAllowed() && !!speech?.supported && !state.natural.micOff;

  /** Pie del Display (F-48, B-Gasto): la caja de lenguaje natural. Vacía, es un input con «o dicta
   *  «12,50 en el bar»» de placeholder; mientras el micro escucha, «Escuchando…»; con una frase ya
   *  interpretada, la frase entre comillas y «Borrar». */
  function displayFootHtml() {
    if (!naturalAllowed()) return "";
    const { text } = state.natural;
    let inner;
    if (state.natural.listening) {
      inner = `<span class="reg-nat-status">${t("registro.natural.micListening")}</span>`;
    } else if (!text.trim()) {
      const ph = micAvailable() ? t("registro.natural.placeholder") : t("registro.natural.placeholderNoMic");
      inner = `<input type="text" id="reg-nat-input" class="reg-nat-input" value="${escAttr(text)}" placeholder="${escAttr(ph)}" aria-label="${escAttr(ph)}" autocomplete="off">`;
    } else {
      const understood = naturalChips().length > 0;
      inner = `<span class="reg-nat-quote">${understood ? `«${escHtml(text)}»` : escHtml(t("registro.natural.notUnderstood"))}</span>
        <button type="button" id="reg-nat-reset" class="reg-nat-reset">${t("registro.natural.reset")}</button>`;
    }
    return `<div class="reg-disp-foot">${inner}</div>`;
  }

  /** Chips de lo que el parser SÍ entendió (spec: "lo que el parser no entendió simplemente no
   *  produce chip"): importe, categoría, comercio y compartido. Cada uno salta a su campo. */
  function naturalChips() {
    const parsed = state.natural.parsed;
    if (!parsed || !state.natural.text.trim()) return [];
    const chips = [];
    if (parsed.cents != null) chips.push(filterChipHtml({ label: fmtMoney(parsed.cents), data: { natChip: "amount" } }));
    if (parsed.categoryId && byId[parsed.categoryId]) {
      chips.push(filterChipHtml({ fam: catFam(parsed.categoryId), label: byId[parsed.categoryId].name, data: { natChip: "category" } }));
    }
    if (parsed.merchant) chips.push(filterChipHtml({ label: parsed.merchant, data: { natChip: "merchant" } }));
    // M-5 (revisión de código): el guardado descarta isShared para income — el chip no debe
    // prometer un reparto que no se guarda.
    if (parsed.shared && state.tipo === "expense") {
      chips.push(filterChipHtml({ label: t("registro.natural.sharedChip", { name: partnerName, pct: parsed.sharePct ?? state.sharePct }), data: { natChip: "shared" } }));
    }
    return chips;
  }

  /** Interpreta `text` (tecleado o dictado) y aplica al formulario lo que el parser entendió
   *  (Registro v2 §8.6). LA FRASE GANA SOBRE `touched`: es el acto explícito más reciente del
   *  usuario, así que cada campo que toca aquí entra también en `state.touched` para que la
   *  memoria de comercios no lo vuelva a pisar después. No pide foco: el foco al importe lo pide
   *  SIEMPRE quien llama, después de esta función (nunca desde aquí ni desde render()). */
  function applyNatural(text) {
    state.natural.text = text;
    const parsed = parseNaturalExpense(text, {
      categories: categoriesFor(), accounts, merchants: merchantMemoryMap,
      counterpartName: partnerName, today: hoyISO(), lang: activeLang(),
    });
    state.natural.parsed = parsed;
    if (parsed.cents != null) { state.cents = parsed.cents; state.raw = centsToRaw(parsed.cents); }
    if (parsed.merchant != null) state.merchant = parsed.merchant;
    if (parsed.categoryId != null) { state.categoryId = parsed.categoryId; state.openRoot = null; state.touched.add("categoryId"); }
    if (parsed.accountId != null) { state.accountId = parsed.accountId; state.touched.add("accountId"); }
    // D-1 (revisión de código): findDate SIEMPRE devuelve una fecha (today cuando no encuentra
    // nada), así que solo `spans.date` distingue "la frase decía una fecha" de "no decía nada".
    if (parsed.spans?.date) state.fecha = parsed.date;
    if (parsed.shared) {
      state.isShared = true;
      state.touched.add("isShared");
      if (parsed.sharePct != null) { state.sharePct = normalizePct(parsed.sharePct, state.sharePct); state.touched.add("sharePct"); }
    }
    render();
  }

  /** Nombre de una etiqueta por id (Task 13). `tagsAll` es SOLO activas (listTags). */
  function tagName(id) {
    return tagsAll.find((tg) => tg.id === id)?.name ?? "";
  }

  /** Selector de etiqueta (Task 13, mismo que movimientos.js#renderTagControl): chips neutros de
   *  etiqueta (C10) + «Nueva etiqueta». Cerrado, si hay una puesta, se ve como ficha. */
  function tagControlHtml() {
    if (!state.tagPickerOpen) {
      return state.tagId ? `<div class="reg-tag-current">${badgeHtml({ tag: true, label: tagName(state.tagId) })}</div>` : "";
    }
    const draft = state.newTagDraft == null
      ? filterChipHtml({ label: t("movimientos.detail.newTag"), id: "reg-tag-new" })
      : `<span class="reg-newtag">
          <span class="ctl-field reg-newtag-field"><input type="text" class="ctl-field-input" id="reg-tag-new-input" value="${escAttr(state.newTagDraft)}" placeholder="${escAttr(t("etiquetas.form.namePlaceholder"))}" aria-label="${escAttr(t("movimientos.detail.newTag"))}"></span>
          <button type="button" id="reg-tag-new-save" class="icon-btn" aria-label="${escAttr(t("common.save"))}">${icon("check", { size: 18 })}</button>
        </span>`;
    return `<div class="reg-chips" role="group" aria-label="${escAttr(t("movimientos.detail.tagLabel"))}">
      ${filterChipHtml({ label: t("movimientos.detail.noTag"), selected: !state.tagId, check: true, data: { tagPick: "" } })}
      ${tagsAll.map((tg) => filterChipHtml({ tag: true, label: tg.name, selected: state.tagId === tg.id, data: { tagPick: tg.id } })).join("")}
      ${draft}
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

  /** Selector «¿Devuelve un gasto?» (tipo devolución): filas de movimiento de los gastos recientes;
   *  enlazado, una tarjeta con el gasto y el botón para quitar el vínculo. */
  function refundPickerHtml() {
    const linked = state.refId ? refundCandidates.find((r) => r.id === state.refId) : null;
    if (linked) {
      const label = linked.merchant || byId[linked.category_id]?.name || t("common.type.expense");
      return `
      <div class="reg-linked">
        <div class="reg-linked-body">
          <span class="reg-linked-label">${t("common.linkedTo")}</span>
          ${metaHtml([label, fmtMoney(linked.amount_cents)], { cls: "reg-linked-meta" })}
        </div>
        <button type="button" id="reg-refund-unlink" class="icon-btn" aria-label="${escAttr(t("registro.refund.unlink"))}">${icon("close", { size: 18 })}</button>
      </div>`;
    }
    return `
    <div class="reg-refund">
      <button type="button" id="reg-refund-toggle" class="reg-pill reg-pill-wide" aria-expanded="${state.refundPickerOpen}">
        <span class="reg-pill-text">${t("registro.refund.toggle")}</span>${icon("chevronDown", { size: 16, cls: "reg-pill-chev" })}
      </button>
      ${state.refundPickerOpen ? `
      <div class="reg-refund-list">
        ${refundCandidates.length === 0
          ? `<p class="reg-empty">${t("registro.refund.empty")}</p>`
          : refundCandidates.map((r) => {
            // Un gasto con algo ya devuelto sigue siendo elegible (una devolución parcial es
            // legítima): solo se atenúa y se etiqueta. El SQL ya lo empuja al final de la lista.
            const done = r.refunded_cents > 0;
            // «ya devuelto» y «liquidado» no son lo mismo: settled lo pone repo.addTransaction para
            // CUALQUIER devolución o ajuste enlazado por refId — límite conocido, anotado en el
            // backlog; el arreglo real es marcar los apuntes de liquidación.
            const settledShared = !!r.is_shared && !!r.settled;
            const doneLabel = settledShared
              ? t("registro.refund.settledLabel", { amount: fmtMoney(r.refunded_cents) })
              : t("registro.refund.alreadyRefunded", { amount: fmtMoney(r.refunded_cents) });
            const title = `${r.merchant || byId[r.category_id]?.name || t("common.type.expense")}${r.is_shared ? t("registro.refund.sharedSuffix") : ""}`;
            const row = txRowHtml({
              fam: familyForCategory(r.category_id, byId), icon: iconForCategory(r.category_id, byId),
              title, line2: done ? doneLabel : (byId[r.category_id]?.name ?? ""),
              amountHtml: escHtml(fmtMoney(r.amount_cents)), sign: "none", data: { refundRow: r.id },
            });
            return done ? `<div class="reg-refund-done">${row}</div>` : row;
          }).join("")}
      </div>` : ""}
    </div>`;
  }

  /** Rejilla de familias (B-Gasto): baldosas seleccionables de 56 en filas de 3; tocar una raíz con
   *  hijas despliega debajo de SU fila las subcategorías como chips neutros (el elegido, relleno
   *  --accent con check). Una raíz sin hijas se elige directamente. */
  function categoryGridHtml(cats) {
    const all = categoryGroups(cats);
    const selRoot = state.categoryId ? rootOf(state.categoryId, byId) : null;
    // Plegado: las 9 primeras familias (la elegida siempre entra, visibleCategories) y «Ver las N».
    const limited = !formOpen() && !state.allCats;
    const { shown, hidden } = limited
      ? visibleCategories(all.map((g) => ({ ...g, id: g.root })), selRoot, CATS_GRID_LIMIT)
      : { shown: all, hidden: 0 };
    const groups = shown;
    const selGroup = groups.find((g) => g.root === selRoot);
    const openRoot = state.openRoot ?? (selGroup && !selGroup.direct ? selRoot : "");
    const rows = [];
    for (let i = 0; i < groups.length; i += GRID_COLS) rows.push(groups.slice(i, i + GRID_COLS));
    return `<div class="reg-grid-wrap">${rows.map((row) => {
      const tiles = row.map((g) => pickTileHtml({
        fam: catFam(g.root), icon: iconForCategory(g.root, byId), label: g.name,
        selected: g.root === selRoot, expanded: g.direct ? null : g.root === openRoot,
        data: { root: g.root },
      })).join("");
      const openIdx = row.findIndex((g) => g.root === openRoot && !g.direct);
      let panel = "";
      if (openIdx >= 0) {
        const g = row[openIdx];
        const fc = famClass(catFam(g.root));
        panel = `<div class="reg-subs ${fc || "reg-subs-neutral"}" style="--col:${openIdx}" role="group" aria-label="${escAttr(g.name)}">
          ${g.items.map((c) => filterChipHtml({ label: c.name, selected: state.categoryId === c.id, check: true, data: { cat: c.id } })).join("")}
        </div>`;
      }
      return `<div class="reg-grid">${tiles}</div>${panel}`;
    }).join("")}
    ${hidden > 0 ? `<button type="button" class="btn-tertiary reg-cats-more" id="reg-cats-more" aria-expanded="false">${t("registro.categories.showAll", { n: all.length })}</button>` : ""}
    </div>`;
  }

  /** Fila «Más» del registro rápido plegado (Registro v2 §4.3, anatomía B de fila de 60): «Más»
   *  15/600, el resumen de registro-mode.js#foldedSummaryParts con el divisor de metaHtml (nunca un
   *  «·») y el chevron. Despliega cuenta, fecha, «Con Marta», etiqueta, foto y nota. */
  function moreRowHtml() {
    const accountName = partnerPaid() ? "" : (accounts.find((a) => a.id === state.accountId)?.name ?? "");
    const dateLabel = state.fecha === hoyISO() ? t("registro.more.summaryToday") : fmtDiaCorto(state.fecha);
    const sharedLabel = needsCategory(state.tipo) && state.tipo !== "income" && partnerName && state.isShared
      ? t("common.sharedWith", { name: partnerName }) : "";
    const parts = foldedSummaryParts({
      accountName, dateLabel, hasNote: !!state.note.trim(), hasPhoto: !!state.photo, sharedLabel,
      tagName: state.tagId ? tagName(state.tagId) : "",
    }, t);
    return `<button type="button" class="reg-more" id="reg-more-toggle" aria-expanded="false">
      <span class="reg-more-body">
        <span class="reg-more-label">${t("registro.more.toggle")}</span>
        ${metaHtml(parts, { cls: "reg-more-sum" })}
      </span>
      ${icon("chevronDown", { size: 20, cls: "reg-pill-chev" })}
    </button>`;
  }

  /** Tarjeta de la categoría elegida (§9, sin borde): nombre de la hoja y, debajo, «La que usas en
   *  Bar Pepe» si la ha puesto la memoria de comercios, o la ruta de su familia. */
  function chosenHtml() {
    const c = state.categoryId ? byId[state.categoryId] : null;
    if (!c) return "";
    const root = rootOf(c.id, byId);
    const path = state.merchantRemembered && state.merchant.trim()
      ? t("registro.chosen.remembered", { merchant: state.merchant.trim() })
      : (root !== c.id ? (byId[root]?.name ?? "") : "");
    return chosenCategoryHtml({ fam: catFam(c.id), icon: iconForCategory(c.id, byId), name: c.name, path });
  }

  /** Píldora de cuenta (B-Gasto): muestra de 10 en la familia de la cuenta (C8) + nombre + chevron.
   *  Abre debajo la lista de cuentas como chips de filtro. */
  function accountPillHtml(which, accId, prefix, showPrefix = false) {
    const acc = accountsAll.find((a) => a.id === accId);
    const fc = famClass(accountFam(acc));
    const name = acc?.name ?? "";
    return `<button type="button" class="reg-pill" data-acc-toggle="${which}" aria-expanded="${state.accPicker === which}" aria-label="${escAttr(name ? `${prefix}: ${name}` : prefix)}">
      ${fc ? `<span class="ent-swatch ${fc}" aria-hidden="true"></span>` : ""}
      ${showPrefix || !name ? `<span class="reg-pill-pre">${escHtml(prefix)}</span>` : ""}
      <span class="reg-pill-text">${escHtml(name)}</span>${icon("chevronDown", { size: 16, cls: "reg-pill-chev" })}
    </button>`;
  }

  function accountListHtml() {
    if (state.accPicker === "from") {
      return `<div class="reg-chips" role="group">${accounts.map((a) => filterChipHtml({ fam: accountFam(a), label: a.name, selected: state.accountId === a.id, data: { acc: a.id } })).join("")}</div>`;
    }
    if (state.accPicker === "to") {
      return `<div class="reg-chips" role="group">${accountsAll.filter((a) => a.id !== state.accountId).map((a) => filterChipHtml({ fam: accountFam(a), label: a.name, selected: state.counterAccountId === a.id, data: { counterAcc: a.id } })).join("")}</div>`;
    }
    return "";
  }

  /** Fecha: píldora con el <input type=date> nativo encima, transparente — tocarla abre el selector
   *  del sistema (y showPicker() en escritorio, ver wire()). */
  function datePillHtml() {
    const label = state.fecha === hoyISO() ? t("registro.date.today") : fmtDiaCorto(state.fecha);
    return `<label class="reg-pill reg-date">
      ${icon("calendar", { size: 18, cls: "reg-pill-ico" })}<span class="reg-pill-text">${escHtml(label)}</span>${icon("chevronDown", { size: 16, cls: "reg-pill-chev" })}
      <input type="date" id="reg-fecha" class="reg-date-input" value="${escAttr(state.fecha)}" aria-label="${escAttr(t("common.date"))}">
    </label>`;
  }

  function accountRowsHtml() {
    if (state.tipo === "transfer") {
      return `
      <div class="reg-row2">${accountPillHtml("from", state.accountId, t("common.from"), true)}${accountPillHtml("to", state.counterAccountId, t("common.to"), true)}</div>
      ${accountListHtml()}
      <div class="reg-row2">${datePillHtml()}</div>`;
    }
    const prefix = state.tipo === "refund" ? t("common.destAccount") : t("common.account");
    return `
      <div class="reg-row2">${partnerPaid() ? "" : accountPillHtml("from", state.accountId, prefix)}${datePillHtml()}</div>
      ${partnerPaid() ? "" : accountListHtml()}`;
  }

  /** Fila «Con Marta 50 %» (F-20, interruptor 44×26) + etiqueta, foto y nota como botones de 48. */
  function extrasRowHtml() {
    const sharedOffered = needsCategory(state.tipo) && state.tipo !== "income" && partnerName;
    const shared = sharedOffered ? `
      <div class="reg-pill reg-shared" id="reg-shared-row">
        <span class="reg-pill-text" id="reg-shared-label">${escHtml(t("registro.shared.row", { name: partnerName }))} <span class="num reg-shared-pct">${state.sharePct} %</span></span>
        ${switchHtml({ id: "reg-shared", checked: state.isShared, label: t("common.sharedWith", { name: partnerName }) })}
      </div>` : "";
    const photoBtn = attachments?.available()
      ? `<button type="button" class="reg-round" id="reg-photo-btn" aria-label="${escAttr(state.photo ? t("registro.photo.replace") : t("registro.photo.add"))}">${icon("camera", { size: 20 })}</button>
         <input type="file" id="reg-photo-input" class="reg-file" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true">`
      : "";
    return `<div class="reg-extras${sharedOffered ? "" : " is-icons-only"}">
      ${shared}
      <button type="button" class="reg-round" id="reg-tag-btn" aria-label="${escAttr(t("movimientos.detail.tagLabel"))}" aria-expanded="${state.tagPickerOpen}">${icon("tag", { size: 20 })}</button>
      ${photoBtn}
      <button type="button" class="reg-round" id="reg-note-btn" aria-label="${escAttr(t("common.note"))}" aria-expanded="${noteVisible()}">${icon("note", { size: 20 })}</button>
    </div>`;
  }

  /** La nota se ve si hay texto, si se tocó el botón o en modo completo (Ajustes, «Registro
   *  rápido» desplegado con «Más», como antes de B). */
  const noteVisible = () => !!state.note.trim() || state.noteOpen || (state.quick && state.expanded);
  /** ¿Se pinta todo (B-Gasto completo) o el registro rápido plegado? */
  const formOpen = () => detailsOpen({ quick: state.quick, expanded: state.expanded, tipo: state.tipo });

  /** Detalle del reparto cuando el interruptor está encendido: quién pagó (solo gasto), el paso a
   *  paso del % y las dos partes. */
  function sharedDetailHtml(myCents, partnerCents) {
    if (!(needsCategory(state.tipo) && state.tipo !== "income" && partnerName && state.isShared)) return "";
    return `
    <div class="reg-block">
      ${state.tipo === "expense" ? `
      <div class="reg-block-sec">
        <span class="reg-block-label" id="reg-paidby-label">${t("common.paidBy.label")}</span>
        ${segmentedHtml({ id: "reg-paidby", name: t("common.paidBy.label"), labelledBy: "reg-paidby-label", value: state.paidBy,
          options: [{ value: "me", label: t("common.paidBy.me") }, { value: "partner", label: t("common.paidBy.partner", { name: partnerName }) }] })}
      </div>` : ""}
      <div class="reg-split-row">
        <div class="reg-split-text">
          <span class="reg-block-title">${t("common.split.label")}</span>
          <span class="reg-block-hint">${escHtml(t("common.split.hint", { name: partnerName, pct: 100 - state.sharePct }))}</span>
        </div>
        ${stepperHtml({ value: `${state.sharePct} %`, decId: "reg-pct-down", incId: "reg-pct-up", decLabel: t("common.split.decreaseAria"), incLabel: t("common.split.increaseAria") })}
      </div>
      <div class="reg-split">
        <div class="reg-split-cell">
          ${metaHtml([t("common.myShare"), t("common.pctValue", { pct: state.sharePct })], { cls: "reg-split-label" })}
          <span class="num reg-split-value" id="reg-split-mine">${escHtml(fmtMoney(myCents))}</span>
        </div>
        <div class="reg-split-cell">
          ${partnerPaid() ? metaHtml([t("common.paidByName", { name: partnerName }), t("common.paidTotal")], { cls: "reg-split-label" }) : metaHtml([partnerName, t("common.pctValue", { pct: 100 - state.sharePct })], { cls: "reg-split-label" })}
          <span class="num reg-split-value" id="reg-split-partner">${escHtml(fmtMoney(partnerPaid() ? state.cents : partnerCents))}</span>
        </div>
      </div>
    </div>`;
  }

  function photoHtml() {
    if (!attachments?.available()) return "";
    // Foto del ticket (N5, §9.3): el módulo devuelve un Blob, nunca una URL — la pantalla es dueña
    // del par crear/revocar. Se reutiliza la URL ya creada mientras state.photo no cambie.
    if (state.photo && !photoObjectUrl) photoObjectUrl = URL.createObjectURL(state.photo);
    if (!state.photo && photoObjectUrl) { URL.revokeObjectURL(photoObjectUrl); photoObjectUrl = null; }
    if (!state.photo) return "";
    return `<div class="reg-photo">
      <img class="reg-photo-img" src="${escAttr(photoObjectUrl)}" alt="${escAttr(t("registro.photo.viewAria"))}">
      <button type="button" class="btn-tertiary" id="reg-photo-remove">${t("registro.photo.remove")}</button>
    </div>`;
  }

  /** Devolución y ajuste (fuera del Segmented de la cabecera, que solo cabe con tres): terciario
   *  que despliega sus dos chips. Abierto solo si se tocó o si el tipo activo es uno de ellos. */
  function extraTypesHtml() {
    const active = TIPOS_EXTRA.some((tp) => tp.id === state.tipo);
    const open = state.typeMoreOpen || active;
    return `<div class="reg-types-extra">
      <button type="button" class="btn-tertiary" id="reg-type-more" aria-expanded="${open}">${t("registro.type.others")}</button>
      ${open ? `<div class="reg-chips" role="group" aria-label="${escAttr(t("registro.type.others"))}">
        ${TIPOS_EXTRA.map((tp) => filterChipHtml({ label: t(tp.labelKey), selected: state.tipo === tp.id, check: true, data: { tipo: tp.id } })).join("")}
      </div>` : ""}
    </div>`;
  }

  function render() {
    const cats = categoriesFor();
    const { mine: myCents, partner: partnerCents } = state.isShared ? splitCents(state.cents, state.sharePct) : { mine: state.cents, partner: 0 };
    // Registro v2 §6: solo un GASTO gasta contra un límite. amountCents es MI PARTE (myCents), no
    // el ticket completo — MY_AMOUNT es también el criterio de SQL.spentByRootCategory.
    const warning = state.tipo === "expense"
      ? limitWarning({ categoryId: state.categoryId, amountCents: myCents, byId, spentByRoot, budgetByCategory })
      : null;
    const chips = naturalChips();
    const open = formOpen();

    container.innerHTML = `
    <div class="reg">
      <header class="reg-head">
        <h1 class="reg-title">${escHtml(t("registro.title"))}</h1>
        <button type="button" class="icon-btn" id="reg-close" aria-label="${escAttr(t("registro.close"))}">${icon("close")}</button>
        ${open ? segmentedHtml({ id: "reg-type", name: t("registro.type.label"), value: state.tipo, allowNone: true,
          options: TIPOS_MAIN.map((tp) => ({ value: tp.id, label: t(tp.labelKey) })) }) : ""}
      </header>

      <section class="disp reg-disp">
        <div class="reg-disp-main">
          <div class="reg-disp-fields">
            ${open ? `<input type="text" id="reg-merchant" class="reg-merchant-input" list="reg-merchants" value="${escAttr(state.merchant)}"
              placeholder="${escAttr(t("registro.merchant.placeholder"))}" aria-label="${escAttr(t("common.merchant"))}" autocomplete="off">`
              : `<span class="disp-label">${escHtml(state.merchant.trim() || t("common.amount"))}</span>`}
            <div class="num disp-value disp-value-xl reg-amount">
              ${state.tipo === "adjustment" ? `<button type="button" class="reg-sign" id="reg-sign" aria-label="${escAttr(t("common.changeSign"))}">${state.adjustmentSign === "-" ? "−" : "+"}</button>` : ""}
              <input type="text" inputmode="decimal" id="reg-raw" class="reg-amount-input" value="${escAttr(state.raw)}" placeholder="0" autocomplete="off"
                aria-label="${escAttr(t("common.amount"))}" style="width:${amountWidth(state.raw)}">
              <span class="reg-amount-cur" aria-hidden="true">${escHtml(currencySymbol())}</span>
            </div>
          </div>
          ${micAvailable() && !state.natural.text.trim() ? `<button type="button" class="reg-mic" id="reg-nat-mic" aria-label="${escAttr(t("registro.natural.mic"))}">${icon("mic", { size: 22 })}</button>` : ""}
        </div>
        ${displayFootHtml()}
      </section>
      <datalist id="reg-merchants">
        ${merchantOptions.map((e) => `<option value="${escAttr(e.display)}"></option>`).join("")}
      </datalist>
      ${chips.length ? `<div class="reg-chips">${chips.join("")}</div>` : ""}
      ${micAvailable() ? `<p class="reg-help">${t("registro.natural.micNotice")}</p>` : ""}

      ${state.tipo === "refund" ? refundPickerHtml() : ""}

      ${cats.length ? `${chosenHtml()}${categoryGridHtml(cats)}` : ""}

      ${warning ? `
      <div class="reg-limit is-${warning.level}" id="reg-limit-band" role="status" aria-live="polite">
        ${icon("warn", { size: 18 })}<span id="reg-limit-text">${escHtml(limitBandText(warning))}</span>
      </div>` : ""}

      ${open ? `
      ${accountRowsHtml()}
      ${extrasRowHtml()}
      ${sharedDetailHtml(myCents, partnerCents)}
      ${photoHtml()}
      ${tagControlHtml()}
      ${noteVisible() ? fieldHtml({ id: "reg-note", label: t("common.note"), value: state.note }) : ""}
      ${extraTypesHtml()}` : moreRowHtml()}

      ${errorMsg ? `<div class="reg-error" role="alert">${icon("warn", { size: 18 })}<span>${escHtml(errorMsg)}</span></div>` : ""}

      <button type="button" class="btn-primary reg-save" id="reg-save">${saveLabelHtml(state.tipo, state.cents)}</button>
    </div>`;

    wire();
  }

  function setTipo(tipo) {
    if (tipo === state.tipo) return;
    state.tipo = tipo;
    state.categoryId = null;
    state.openRoot = null;
    state.refId = "";
    state.refundPickerOpen = false;
    state.counterAccountId = "";
    state.accPicker = null;
    // Mismo criterio que el guard B4 de ingresos: un 'partner' heredado no puede colarse con el
    // control oculto (solo se pinta para expense).
    state.paidBy = "me";
    // Un touched de un tipo anterior no tiene sentido para el tipo nuevo.
    state.touched = new Set();
    state.typeMoreOpen = false;
    // M-4 (revisión de código): un chip de una interpretación anterior no debe sobrevivir al
    // cambio de tipo. micOff SÍ sobrevive: es de sesión de pantalla.
    state.natural = { text: "", parsed: null, listening: false, micOff: state.natural.micOff };
    lastInterpreted = null;
    errorMsg = "";
    render();
  }

  function wire() {
    container.querySelector("#reg-close").onclick = () => {
      alive = false;
      speech?.stop();
      releasePhotoUrl();
      onDone();
    };

    // render() rehace el DOM: el foco vuelve al radio elegido para que las flechas sigan (K12).
    const typeSeg = container.querySelector("#reg-type");
    if (typeSeg) wireSegmented(typeSeg, (v) => {
      setTipo(v);
      container.querySelector(`#reg-type [data-value="${v}"]`)?.focus();
    });
    container.querySelectorAll("[data-tipo]").forEach((b) => { b.onclick = () => setTipo(b.dataset.tipo); });
    const typeMoreBtn = container.querySelector("#reg-type-more");
    if (typeMoreBtn) typeMoreBtn.onclick = () => { state.typeMoreOpen = !state.typeMoreOpen; render(); };

    // PB-1 · Lenguaje natural (Registro v2 §8.6): un único camino de interpretación para el texto,
    // Enter, blur y el resultado de voz. El oninput SOLO guarda el texto y NUNCA repinta.
    const natInput = container.querySelector("#reg-nat-input");
    if (natInput) {
      natInput.oninput = (e) => { state.natural.text = e.target.value; };
      natInput.onkeydown = (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        lastInterpreted = natInput.value;
        applyNatural(natInput.value);
        focusInput(container.querySelector("#reg-raw"));
      };
      // D-5 (revisión de código): un applyNatural síncrono en el blur reconstruye el innerHTML
      // ANTES de que el click que provocó el blur llegue a su objetivo — el primer toque se perdía.
      // Diferir con setTimeout(0) deja que ese click termine de despachar.
      natInput.onblur = () => {
        const value = natInput.value;
        if (!value.trim() || value === lastInterpreted) return;
        setTimeout(() => {
          if (!alive) return;
          lastInterpreted = value;
          applyNatural(value);
        }, 0);
      };
    }

    const natMicBtn = container.querySelector("#reg-nat-mic");
    if (natMicBtn) natMicBtn.onclick = () => {
      state.natural.listening = true;
      render();
      speech.start(
        // D-4: guard de vida — un resultado que llega después de cerrar Registro no repinta.
        (resultText) => {
          if (!alive) return;
          state.natural.listening = false;
          lastInterpreted = resultText;
          applyNatural(resultText);
          focusInput(container.querySelector("#reg-raw"));
        },
        () => {
          if (!alive) return;
          state.natural.listening = false;
          state.natural.micOff = true;
          render();
          showToast(t("registro.natural.micDenied"));
        },
      );
    };

    const natReset = container.querySelector("#reg-nat-reset");
    if (natReset) natReset.onclick = () => {
      // micOff NO se resetea (es de sesión de pantalla). Tampoco deshace lo ya rellenado.
      state.natural = { text: "", parsed: null, listening: false, micOff: state.natural.micOff };
      lastInterpreted = null;
      render();
      focusInput(container.querySelector("#reg-nat-input"));
    };

    container.querySelectorAll("[data-nat-chip]").forEach((b) => {
      b.onclick = () => {
        const field = b.dataset.natChip;
        // Comercio y compartido viven tras «Más» en el registro rápido plegado: se despliega.
        if ((field === "merchant" || field === "shared") && !formOpen()) { state.expanded = true; render(); }
        if (field === "amount") focusInput(container.querySelector("#reg-raw"));
        else if (field === "category") container.querySelector(".ent-chosen, .reg-grid-wrap")?.scrollIntoView({ block: "nearest" });
        else if (field === "merchant") focusInput(container.querySelector("#reg-merchant"));
        else if (field === "shared") container.querySelector("#reg-shared-row")?.scrollIntoView({ block: "nearest" });
      };
    });

    // Rejilla: una raíz sin hijas se elige; una con hijas despliega o pliega su panel.
    container.querySelectorAll("[data-root]").forEach((b) => {
      b.onclick = () => {
        const root = b.dataset.root;
        const group = categoryGroups(categoriesFor()).find((g) => g.root === root);
        if (group?.direct) {
          state.categoryId = root;
          state.openRoot = "";
          state.touched.add("categoryId");
          state.merchantRemembered = false;
          errorMsg = "";
        } else {
          const isOpen = b.getAttribute("aria-expanded") === "true";
          state.openRoot = isOpen ? "" : root;
        }
        render();
      };
    });
    container.querySelectorAll("[data-cat]").forEach((b) => {
      b.onclick = () => {
        state.categoryId = b.dataset.cat;
        state.openRoot = null;
        state.touched.add("categoryId");
        state.merchantRemembered = false;
        errorMsg = "";
        render();
      };
    });

    container.querySelectorAll("[data-acc-toggle]").forEach((b) => {
      b.onclick = () => {
        const which = b.dataset.accToggle;
        state.accPicker = state.accPicker === which ? null : which;
        render();
      };
    });
    container.querySelectorAll("[data-acc]").forEach((b) => {
      b.onclick = () => {
        state.accountId = b.dataset.acc;
        state.touched.add("accountId");
        if (state.counterAccountId === state.accountId) state.counterAccountId = "";
        state.accPicker = null;
        render();
      };
    });
    container.querySelectorAll("[data-counter-acc]").forEach((b) => {
      b.onclick = () => {
        state.counterAccountId = b.dataset.counterAcc;
        state.accPicker = null;
        render();
      };
    });

    const paidBySeg = container.querySelector("#reg-paidby");
    if (paidBySeg) wireSegmented(paidBySeg, (v) => {
      // state.accountId NO se borra: volver a «Pagué yo» recupera la cuenta ya seleccionada.
      state.paidBy = v;
      state.touched.add("paidBy");
      errorMsg = "";
      render();
      container.querySelector(`#reg-paidby [data-value="${v}"]`)?.focus();
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
      e.target.style.width = amountWidth(state.raw);
      const { mine: myCents, partner: partnerCents } = splitCents(state.cents, state.sharePct);
      const mineEl = container.querySelector("#reg-split-mine");
      const partnerEl = container.querySelector("#reg-split-partner");
      if (state.isShared && mineEl && partnerEl) {
        mineEl.textContent = fmtMoney(myCents);
        partnerEl.textContent = fmtMoney(partnerPaid() ? state.cents : partnerCents);
      }
      // El CTA lleva el importe en vivo — nunca un render() completo aquí (mataría el cursor).
      container.querySelector("#reg-save").innerHTML = saveLabelHtml(state.tipo, state.cents);
      // Registro v2 §6.2: la banda de límite se PARCHEA (texto + clase), nunca render() aquí.
      const limitBandEl = container.querySelector("#reg-limit-band");
      if (limitBandEl && state.tipo === "expense") {
        const w = limitWarning({ categoryId: state.categoryId, amountCents: state.isShared ? myCents : state.cents, byId, spentByRoot, budgetByCategory });
        if (w) {
          limitBandEl.className = `reg-limit is-${w.level}`;
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

    const catsMoreBtn = container.querySelector("#reg-cats-more");
    if (catsMoreBtn) catsMoreBtn.onclick = () => { state.allCats = true; render(); };
    const moreToggle = container.querySelector("#reg-more-toggle");
    if (moreToggle) moreToggle.onclick = () => {
      state.expanded = true;
      render();
      // Invariante de foco (§4.5): SOLO desde el handler, nunca desde render().
      focusInput(container.querySelector("#reg-merchant"));
    };

    const merchantInput = container.querySelector("#reg-merchant");
    if (merchantInput) merchantInput.oninput = (e) => {
      state.merchant = e.target.value;
      // Registro v2 §5.4: casar EXACTO por valor normalizado, nunca por prefijo. Todo lo rellenado
      // es editable y respeta `touched` (memoryPatch). Un render() completo hace falta porque el
      // parche puede tocar categoría, cuenta y compartido a la vez — se refoca el propio campo
      // desde AQUÍ, nunca desde render().
      const entry = merchantMemoryMap[normalizeMerchant(state.merchant)];
      if (entry) {
        // merchantHistory mezcla expense/income/refund del mismo comercio: la categoría recordada
        // puede ser de un tipo distinto al que se está rellenando (memoryPatch lo filtra).
        const patch = memoryPatch(entry, state.touched, categoriesFor().map((c) => c.id));
        // Sin pareja, el interruptor de compartido ni se pinta: un isShared/paidBy/sharePct
        // recordado de cuando SÍ había pareja colaría un partnerPaid() falso.
        if (!partnerName) { delete patch.isShared; delete patch.paidBy; delete patch.sharePct; }
        Object.assign(state, patch);
        if ("categoryId" in patch) state.openRoot = null;
        // share_pct_override llega crudo de la BD (REAL, puede venir fuera de rango).
        if ("sharePct" in patch) state.sharePct = normalizePct(patch.sharePct, state.sharePct);
        state.merchantRemembered = "categoryId" in patch;
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
    const noteBtn = container.querySelector("#reg-note-btn");
    if (noteBtn) noteBtn.onclick = () => {
      state.noteOpen = !noteVisible();
      render();
      if (state.noteOpen) focusInput(container.querySelector("#reg-note"));
    };

    const fechaInput = container.querySelector("#reg-fecha");
    if (fechaInput) fechaInput.onchange = (e) => { state.fecha = e.target.value || hoyISO(); render(); };
    // En escritorio el input de fecha transparente solo abre el calendario desde su icono: se pide
    // explícitamente. Donde showPicker no existe, el toque nativo ya lo abre.
    if (fechaInput) fechaInput.onclick = () => { try { fechaInput.showPicker?.(); } catch { /* sin gesto válido */ } };

    // Foto del ticket (N5, Registro v2 §9.4): el botón dispara el input oculto, que comprime la
    // foto elegida y la guarda en state.photo — no se escribe en OPFS hasta el guardado.
    const photoBtn = container.querySelector("#reg-photo-btn");
    if (photoBtn) photoBtn.onclick = () => container.querySelector("#reg-photo-input").click();
    const photoInput = container.querySelector("#reg-photo-input");
    if (photoInput) photoInput.onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = ""; // permite re-elegir el MISMO fichero
      if (!file) return;
      try {
        const compressed = await compressImage(file);
        // D-4: compressImage es async — si Registro se cerró mientras comprimía, no repintar.
        if (!alive) return;
        // Reemplazar una foto ya elegida: la URL vieja apunta al Blob viejo.
        if (photoObjectUrl) { URL.revokeObjectURL(photoObjectUrl); photoObjectUrl = null; }
        state.photo = compressed;
        render();
      } catch (err) {
        if (!alive) return;
        // El formulario NO pierde nada: state.photo se queda como estaba.
        showToast(t("errors.attachments.writeFailed", { error: userMessage(err) }));
      }
    };
    const photoRemoveBtn = container.querySelector("#reg-photo-remove");
    if (photoRemoveBtn) photoRemoveBtn.onclick = () => { state.photo = null; render(); };

    // Selector de etiqueta (Task 13): puro estado de UI hasta guardar. SOLO el handler de «Nueva
    // etiqueta» pide foco tras su propio render(), nunca desde render() en sí.
    const tagBtn = container.querySelector("#reg-tag-btn");
    if (tagBtn) tagBtn.onclick = () => { state.tagPickerOpen = !state.tagPickerOpen; state.newTagDraft = null; render(); };
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
      // Sin render() en oninput (perdería el foco): el valor solo se lee al guardar o con Enter.
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

    // Interruptor de compartido: toda la píldora lo acciona (el switch es su parte visible).
    const sharedRow = container.querySelector("#reg-shared-row");
    if (sharedRow) sharedRow.onclick = () => {
      state.isShared = !state.isShared;
      state.touched.add("isShared");
      // Apagar compartido devuelve el gasto a «Pagué yo»: sin esto un 'partner' heredado
      // sobreviviría con el control oculto y la cuenta volvería a ser obligatoria sin decirlo.
      state.paidBy = "me";
      render();
      container.querySelector("#reg-shared")?.focus();
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
          // B4 ruling: el reparto ya no se OFRECE para ingresos — este guard evita que un isShared
          // heredado (p.ej. prefill de una regla recurrente) se cuele en el guardado.
          isShared: effectiveIsShared,
          sharePctOverride: effectiveIsShared ? state.sharePct : null,
          paidBy: partnerPaid() ? "partner" : "me",
          refId: state.tipo === "refund" ? state.refId : "",
          ruleId: state.ruleId,
          tagId: state.tagId || "",
        });
        // Foto del ticket (N5, §9.4): SIEMPRE DESPUÉS de que newId exista y ANTES de onDone(). Si
        // la foto falla, el gasto YA está guardado (addTransaction sin hasAttachment).
        if (state.photo) {
          try {
            await attachments.put(newId, state.photo);
            await setAttachmentFlag(newId, true);
          } catch { showToast(t("registro.photo.savedWithout")); }
        }
        const periodLines = await receiptPeriodLines();
        // D-3/D-4: guardar con éxito es el otro punto de salida de la pantalla.
        alive = false;
        speech?.stop();
        releasePhotoUrl();
        onDone();   // primero: el ticket cae sobre la pantalla ya repintada
        showReceipt({ ...receiptData(newId, withCategory, effectiveIsShared, effectiveAccountId), periodLines });
      } catch (e) {
        btn.disabled = false;
        errorMsg = t("common.saveFailed", { error: userMessage(e) });
        render();
      }
    };
  }

  /** «Quedan en septiembre» y «Hoy puedes gastar» del recibo (B-Recibo): las MISMAS cuentas que el
   *  Display de Inicio (disponibleHtml) —límites del periodo menos lo gastado, y
   *  inicio-logic#dailyAllowanceCents con lo comprometido de previsionOfPeriod—, leídas DESPUÉS de
   *  guardar para que incluyan este gasto y coincidan con el Inicio que se repinta detrás. Sin
   *  límites (Inicio tampoco pinta el disponible) o si algo falla, no hay líneas: el recibo nunca
   *  bloquea el guardado. */
  async function receiptPeriodLines() {
    if (!period) return [];
    try {
      const [spentNow, budgetsNow, prevision] = await Promise.all([
        spentOfPeriod(period.id), budgetsOfPeriod(period.id), previsionOfPeriod(period),
      ]);
      const budgetTotal = Object.values(budgetMap(budgetsNow)).reduce((s, c) => s + c, 0);
      if (!budgetTotal) return [];
      const hoy = hoyISO();
      const disponible = budgetTotal - spentNow;
      const allowance = dailyAllowanceCents(disponible, prevision.comprometidoCents, period.start_date, hoy);
      const monthIdx = periodMonth(period.start_date, period.end_date) - 1;
      const month = new Date(2000, monthIdx, 15).toLocaleDateString(appLocale(), { month: "long" });
      return [
        { label: t("recibo.left", { month }), value: fmtMoney(disponible), num: true },
        // Mismo suelo que Inicio: sin margen se enseña 0, no una cifra negativa por día.
        { label: t("recibo.today"), value: fmtMoney(Math.max(0, allowance)), num: true },
      ];
    } catch {
      return [];
    }
  }

  /** Datos del recibo (B-Recibo): comercio y tipo, la ficha de la categoría, cuenta con su muestra,
   *  fecha, etiqueta y reparto. */
  function receiptData(newId, withCategory, effectiveIsShared, effectiveAccountId) {
    const [y, m, d] = state.fecha.split("-");
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const cat = withCategory ? byId[state.categoryId] : null;
    const root = cat ? rootOf(cat.id, byId) : null;
    const catPath = cat ? (root && root !== cat.id && byId[root] ? `${byId[root].name} › ${cat.name}` : cat.name) : "";
    const fam = cat ? catFam(cat.id) : null;
    const typeLabel = t(TIPO_LABEL[state.tipo]);
    const account = accountsAll.find((a) => a.id === effectiveAccountId);
    const counter = state.tipo === "transfer" ? accountsAll.find((a) => a.id === state.counterAccountId) : null;
    const merchant = state.merchant.trim();
    return {
      dateTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      title: merchant || cat?.name || typeLabel,
      subtitle: typeLabel,
      badge: cat ? { fam, income: state.tipo === "income", icon: iconForCategory(cat.id, byId), label: catPath } : null,
      lines: [
        { label: state.tipo === "transfer" ? t("common.from") : t("common.account"), value: account?.name ?? "", fam: accountFam(account) },
        { label: t("common.to"), value: counter?.name ?? "", fam: accountFam(counter) },
        { label: t("common.date"), value: state.fecha === hoyISO() ? t("registro.date.today") : `${d}/${m}/${y}` },
        { label: t("recibo.tagLabel"), value: state.tagId ? tagName(state.tagId) : "" },
        { label: t("common.split.label"), value: effectiveIsShared ? `${partnerName} ${state.sharePct} %` : "" },
        { label: t("recibo.myPart"), value: effectiveIsShared ? fmtMoney(splitCents(state.cents, state.sharePct).mine) : "", num: true },
      ],
      total: fmtMoneyParts(state.cents),
      stampDate: `${fmtDiaCorto(hoyISO())} ${now.getFullYear()}`,
      stampFam: fam,
      labels: { brand: "BaseCero", stamp: t("recibo.stamp"), total: t("recibo.total"), undo: t("recibo.undo") },
      onUndo: async () => {
        try {
          // Borrado LÓGICO (softDeleteTransaction), NUNCA un DELETE: si lo que se acaba de guardar
          // era una devolución/ajuste enlazado por refId, addTransaction ya puso settled=1 en el
          // gasto que enlaza — solo la rama refund/adjustment de softDeleteTransaction deshace ese
          // settled con unsettleIfNoActiveSettlements.
          await softDeleteTransaction(newId);
          showToast(t("recibo.undone"));
          onUndone?.();
        } catch (e) {
          showToast(t("recibo.undoFailed", { error: userMessage(e) }));
        }
      },
    };
  }

  render();
  // Foco en el importe SOLO tras el primer pintado: render() se repite en cada cambio de estado y
  // enfocar ahí robaría el foco a cada toque. En el móvil el teclado probablemente NO salte (iOS
  // solo lo levanta dentro del gesto del usuario); esto es escritorio y accesibilidad.
  focusInput(container.querySelector("#reg-raw"));
}
