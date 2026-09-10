import {
  listPeriods, listAllByDay, getTransaction, updateTransaction, softDeleteTransaction, countUncategorized,
  listExpenseLeafCategories, listIncomeCategories, listAccounts, allCategoriesById, hasActiveLinkedSettlement,
  getMetaAll, listTags, createTag, tagTotals, tagTotalsOfPeriod,
} from "../repo.js";
import { attachments } from "../attachments.js";
import { colorForCategory, iconForCategory, textColorForCategory, rootOf } from "../category-colors.js";
import { budgetStatus } from "../category-spend.js";
import { matchesFilter, isUncategorized } from "../movimientos-filter.js";
import { fmtMoney, moneyPartsHtml, fmtDiaLargo, fmtDiaCorto, hoyISO, currencySymbol, parseCentsRaw, centsToRaw, appLocale } from "../format.js";
import { resolveAccountId } from "../account-defaults.js";
import { t } from "../i18n/index.js";
import { metaHtml, subHeaderHtml } from "../ui.js";
import { icon } from "../icons.js";
import { dayIndexOfPeriod, expectedPeriodDays } from "../prevision.js";
import { PCT_STEP, normalizePct, stepPct, splitCents } from "../share-pct.js";
import { pushBack, goBack } from "../back.js";
import { userMessage } from "../errors.js";
import { skeletonHtml } from "../skeleton.js";
import { showConfirm } from "../modal.js";
import { showToast } from "../toast.js";

import { escHtml, escAttr } from "../esc.js";
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

// Toda anchura de barra de la tarjeta de etiqueta activa pasa por aquí, mismo criterio que
// etiquetas.js#clampPct/gasto-por-categoria.js#clampPct: budgetStatus() no capa su `.pct`, y
// `width:120%`/`width:-8%` es CSS inválido que el navegador descarta (la barra se queda vacía).
const clampPct = (pct) => Math.min(100, Math.max(0, pct));

function movRowHtml(r, byId, accById, partnerName) {
  if (r.type === "transfer") {
    const from = accById[r.account_id]?.name ?? "?";
    const to = accById[r.counter_account_id]?.name ?? "?";
    return `
    <button type="button" class="tx-row" data-tx="${r.id}" style="width:100%;text-align:left;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;">
      <div class="dotico" style="--cat:var(--card2);">${icon("transfer", { size: 16, stroke: "var(--ink-3)" })}</div>
      <div class="tx-body">
        <div class="tx-title">${escHtml(from)} → ${escHtml(to)}</div>
        <div class="tx-sub">${escHtml(r.merchant || r.note || t("movimientos.type.transfer"))}</div>
      </div>
      <div class="tx-amount num">${moneyPartsHtml(r.amount_cents)}</div>
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
      <div class="tx-amount num ${isNeg ? "negative" : "positive"}">${isNeg ? "-" : "+"}${moneyPartsHtml(Math.abs(r.amount_cents))}</div>
    </button>`;
  }
  const cat = byId[r.category_id];
  const catName = cat?.name ?? "";
  const uncategorized = isUncategorized(r);
  const color = uncategorized ? "var(--card2)" : colorForCategory(r.category_id, byId);
  // catIcon, no `icon`: ese nombre queda para la función importada de icons.js, y un `const icon`
  // local aquí la taparía con un error de TDZ en la propia línea (uncategorized ? icon(...) : ...).
  const catIcon = uncategorized ? icon("plus", { size: 15, width: 2, stroke: "var(--ink-3)" }) : iconForCategory(r.category_id, byId);
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
    <div class="dotico" style="--cat:${color};${dashedStyle}">${catIcon}</div>
    <div class="tx-body">
      <div class="tx-title">${escHtml(title)}</div>
      <div class="tx-sub" style="${uncategorized ? "color:var(--amber);" : ""}">${escHtml(subBase)}${escHtml(shareSuffix)}</div>
    </div>
    <div class="${amountClasses}"${amountStyle}>${sign}${moneyPartsHtml(r.amount_cents)}</div>
  </button>`;
}

/** Pantalla Movimientos: selector de periodo, bandeja de sin-categorizar y lista agrupada por día
 *  (los 5 tipos), con subvista de detalle para editar/borrar cada movimiento.
 *
 *  Modo «solo detalle» (Inicio v2, I5): `{ detailTxId, onDetailClose }` deja que otra pantalla —
 *  Inicio, Semana— reutilice ESTA vista de detalle, la única que existe, sin duplicar
 *  renderDetail(). Sin comportamiento nuevo para la pestaña Movimientos: los dos parámetros son
 *  opcionales y por defecto no cambian nada. Tres diferencias respecto al modo normal, las tres a
 *  propósito:
 *    · NO se escribe container.dataset.screen: ese testigo decide si Inicio repinta su silueta
 *      gris (inicio.js), dejarlo en "movimientos" haría parpadear a Inicio al volver.
 *    · NO se pinta el esqueleto de la lista: la lista no se va a ver nunca en este modo.
 *    · openDetail NO apunta su propia entrada de historial: la apuntó el llamante (open-tx.js). */
export async function renderMovimientos(container, { detailTxId = null, onDetailClose = null, tagId = null } = {}) {
  const detailOnly = !!detailTxId;
  // Silueta gris mientras llega la primera consulta (mismo criterio que inicio.js): selector de
  // periodo, fila de chips y lista. Solo en el PRIMER pintado de esta pantalla — el testigo
  // container.dataset.screen lo escriben SOLO Inicio y Movimientos.
  if (!detailOnly && container.dataset.screen !== "movimientos") {
    container.dataset.screen = "movimientos";
    container.innerHTML = skeletonHtml([72, 56, 320]);
  }
  let periods, expenseCats, incomeCats, accountsAll, byId, meta, tagsAll;
  try {
    [periods, expenseCats, incomeCats, accountsAll, byId, meta, tagsAll] = await Promise.all([
      listPeriods(), listExpenseLeafCategories(), listIncomeCategories(), listAccounts(), allCategoriesById(),
      getMetaAll(), listTags(),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">${t("movimientos.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }
  if (periods.length === 0) {
    container.innerHTML = `<header class="screen-header"><h1 style="font: var(--t-title); letter-spacing:-.01em;">${t("common.movements")}</h1></header>
      <div class="banner-aviso red">${t("movimientos.noPeriods")}</div>`;
    return;
  }
  const accById = Object.fromEntries(accountsAll.map((a) => [a.id, a]));
  const partnerName = (meta.partner_name || "").trim();
  // Cabecera §4.1: el subtítulo «día N de M» siempre describe el periodo ABIERTO, no el que se
  // esté navegando con el selector de flechas — dayIndexOfPeriod cuenta días desde hoy, así que
  // solo tiene sentido para el periodo en curso (un periodo cerrado daría un "día 47 de 31").
  const openPeriod = periods.find((p) => p.status === "open") ?? null;

  const state = {
    view: "list",
    periodId: periods.find((p) => p.status === "open")?.id ?? periods[0].id,
    rows: [],
    uncategorizedCount: 0,
    tagTotalsPeriod: [], // Task 12: n/spent_cents por etiqueta EN ESTE periodo (chips + línea de la tarjeta)
    tagTotalsAll: [], // Task 12: total de SIEMPRE por etiqueta (D7) — nombre, límite y barra de la tarjeta
    // Task 4: filtro cliente sobre state.rows (buscador + chips por categoría raíz). Los tres
    // campos se combinan con AND en matchesFilter (movimientos-filter.js); la UI garantiza que
    // rootCatId y uncat no estén activos a la vez (chips de selección única, ver wireList).
    // «Todos» = los tres en su valor neutro. tagId (Etiquetas, N11) llega de nav("movimientos",
    // { tagId }) al entrar desde la pantalla Etiquetas — D13: NUNCA se autolimpia (a diferencia de
    // rootCatId, ver loadPeriodData) y sobrevive a un cambio de periodo (ver el onchange de
    // #mov-period): una etiqueta es transversal por definición.
    filter: { query: "", rootCatId: null, uncat: false, tagId },
    // Muestra/oculta el input de búsqueda bajo la lupa del header — no forma parte del filtro en
    // sí (tener texto buscado con el input oculto sería confuso, así que cerrar limpia
    // filter.query, ver wireList#mov-search-toggle).
    searchOpen: false,
    detailId: null,
    detail: null,
    opening: false, // apertura de detalle en curso (ver openDetail)
  };
  let errorMsg = "";
  // Foto del ticket (N5, spec §9.8): la URL del Blob leído en openDetail (state.detail.photoBlob).
  // Se revoca y se vuelve a crear en CADA renderDetail() (updateDetail -> render() repinta con
  // innerHTML en cada cambio de estado) y también al salir del detalle (backToList) — sin esto,
  // cada repintado filtraría una foto entera en memoria.
  let detailPhotoUrl = null;

  async function loadPeriodData() {
    [state.rows, state.uncategorizedCount, state.tagTotalsPeriod, state.tagTotalsAll] = await Promise.all([
      listAllByDay(state.periodId), countUncategorized(state.periodId),
      tagTotalsOfPeriod(state.periodId), tagTotals(),
    ]);
    // sin esto, categorizar/borrar el último movimiento sin categorizar con el filtro activo
    // deja la lista vacía sin forma de volver: el chip desaparece (count=0) pero el filtro seguía activo.
    if (state.uncategorizedCount === 0) state.filter.uncat = false;
    // mismo invariante para la chip de categoría raíz activa: si el último movimiento de esa raíz
    // se recategoriza/borra, su chip desaparece de presentRootCats() (ya no hay nada que mostrar
    // en ella) pero el filtro seguía activo — la lista se quedaría vacía con ninguna chip marcada.
    if (state.filter.rootCatId && !presentRootCats().includes(state.filter.rootCatId)) state.filter.rootCatId = null;
    // D13: filter.tagId NUNCA se autolimpia aquí, a propósito — a diferencia de rootCatId arriba.
    // Una etiqueta es transversal a los periodos (D7): que en ESTE periodo no quede ningún
    // movimiento con esa etiqueta no significa que el filtro "esté mal", solo que la lista sale
    // vacía (mismo mensaje que cualquier otro filtro sin resultados) — el usuario decide si lo
    // quita, igual que decide si cambia de periodo con una búsqueda de texto puesta.
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

  /** Segunda fila de chips (Task 12, artboard Movimientos.dc.html:50-59): una por etiqueta con
   *  movimientos EN ESTE PERIODO, más siempre la activa (aunque su periodo dé n=0, para que el
   *  filtro puesto siga teniendo una chip que lo represente y se pueda quitar tocándola). No es
   *  is_archived quien decide si aparece: tagTotalsOfPeriod ya incluye archivadas a propósito (un
   *  movimiento del periodo puede llevar una que se archivó después), ver su comentario en sql.js. */
  function tagChipsHtml() {
    const activeId = state.filter.tagId;
    const periodById = Object.fromEntries(state.tagTotalsPeriod.map((tg) => [tg.id, tg]));
    const visible = state.tagTotalsAll.filter((tg) => (periodById[tg.id]?.n ?? 0) > 0 || tg.id === activeId);
    if (visible.length === 0) return "";
    return `<div class="chips-row" style="margin-bottom:14px;">
      ${visible.map((tg) => {
        const active = tg.id === activeId;
        return `<button type="button" class="chip${active ? " active" : ""}" data-chip-tag="${escAttr(tg.id)}"
          style="padding:0 14px;display:inline-flex;align-items:center;gap:7px;">${icon("tag", { size: 14 })}${escHtml(tg.name)}</button>`;
      }).join("")}
    </div>`;
  }

  /** Tarjeta de la etiqueta activa (Task 12, artboard Movimientos.dc.html:61-83): nombre + nº de
   *  movimientos de SIEMPRE (tagTotalsAll, D7), total global con barra SOLO si tiene límite, y la
   *  línea del periodo abierto (tagTotalsPeriod). Nada si no hay ninguna etiqueta activa o si la
   *  etiqueta activa ya no existe (borrado real, fuera del alcance de esta app — ver D5: solo se
   *  archiva — pero una FK huérfana no debe reventar el render). */
  function tagCardHtml() {
    const tagId = state.filter.tagId;
    if (!tagId) return "";
    const tag = state.tagTotalsAll.find((tg) => tg.id === tagId);
    if (!tag) return "";
    const periodTag = state.tagTotalsPeriod.find((tg) => tg.id === tagId) ?? { n: 0, spent_cents: 0 };
    const hasLimit = tag.budget_cents > 0;
    const periodName = periods.find((p) => p.id === state.periodId)?.name ?? "";
    let limitHtml = "";
    if (hasLimit) {
      const st = budgetStatus(tag.spent_cents, tag.budget_cents);
      limitHtml = `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;">
          <span class="num" style="font-size:20px;font-weight:700;">${fmtMoney(tag.spent_cents)}</span>
          <span class="num" style="font-size:13px;color:var(--text-3);">${t("movimientos.tagCard.ofLimit", { limit: fmtMoney(tag.budget_cents) })}</span>
        </div>
        <div class="bar" style="--cat:var(--ink-2);"><i style="width:${clampPct(st.pct)}%;"></i></div>
      </div>`;
    }
    return `
    <div class="card" style="display:flex;flex-direction:column;gap:12px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="display:flex;align-items:center;gap:7px;">
          <span style="display:flex;color:var(--text-2);">${icon("tag", { size: 14 })}</span>
          <span style="font-size:15px;font-weight:600;">${escHtml(tag.name)}</span>
        </div>
        <span style="font-size:11px;font-weight:500;color:var(--text-3);">${t("movimientos.tagCard.movements", { n: tag.n })}</span>
      </div>
      ${limitHtml}
      <span style="font-size:13px;font-weight:500;color:var(--text-3);">${t("movimientos.tagCard.periodLine", { amount: fmtMoney(periodTag.spent_cents), period: escHtml(periodName), n: periodTag.n })}</span>
    </div>`;
  }

  /** Nota de cierre del filtro de etiqueta (Movimientos.dc.html:146-148): cuántos movimientos de
   *  la etiqueta activa quedan FUERA de este periodo — tagTotalsAll.n (de siempre) menos
   *  tagTotalsPeriod.n (de este periodo). Solo se pinta con una etiqueta activa y resto > 0: es
   *  el mismo dato que ya calcula tagCardHtml, sin cargar nada nuevo. */
  function tagOlderNoteHtml() {
    const tagId = state.filter.tagId;
    if (!tagId) return "";
    const tag = state.tagTotalsAll.find((tg) => tg.id === tagId);
    if (!tag) return "";
    const periodTag = state.tagTotalsPeriod.find((tg) => tg.id === tagId);
    const older = tag.n - (periodTag?.n ?? 0);
    if (older <= 0) return "";
    const periodName = periods.find((p) => p.id === state.periodId)?.name ?? "";
    return `
    <div style="padding-top:22px;">
      <span style="font:var(--t-label);color:var(--ink-3);line-height:1.45;display:block;">${t("movimientos.tag.olderNote", { n: older, tag: escHtml(tag.name), period: escHtml(periodName) })}</span>
    </div>`;
  }

  function updateDetail(patch) {
    Object.assign(state.detail, patch);
    render();
  }

  async function openDetail(id, { push = true } = {}) {
    // Guard de apertura en curso: la lista sigue viva durante el await, y dos toques seguidos
    // apuntarían DOS entradas de historial para una sola vista abierta.
    if (state.opening) return;
    state.opening = true;
    let row;
    try {
      row = await getTransaction(id);
    } catch (e) {
      if (detailOnly) { showToast(t("movimientos.error.openDetail", { error: userMessage(e) })); onDetailClose?.(); return; }
      errorMsg = t("movimientos.error.openDetail", { error: userMessage(e) });
      state.opening = false;
      render();
      return;
    }
    // Fila inexistente (borrada en otra pestaña mientras esta pantalla estaba abierta): en modo
    // solo detalle, un `return` a secas dejaría la pantalla EN BLANCO y la entrada de historial
    // que apuntó el llamante (open-tx.js) colgando sin nada que la cierre.
    if (!row) { state.opening = false; if (detailOnly) onDetailClose?.(); return; }
    state.detailId = id;
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
      // Foto del ticket (N5): photoBlob se lee AQUÍ (openDetail es async; renderDetail no puede
      // esperar a OPFS). has_attachment=1 sin fichero (hoja .xlsx restaurada, o un fallo del paso
      // 3 de §9.4) se trata como "sin foto" — null, sin banner ni error (spec §9.2/§13.11): el
      // FICHERO es la verdad, la columna solo evita sondear OPFS en la lista.
      photoBlob: null,
      photoViewerOpen: false,
    };
    if (row.has_attachment && attachments) {
      try { state.detail.photoBlob = await attachments.blob(id); } catch { state.detail.photoBlob = null; }
    }
    state.linkedExpense = null;
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
    // En modo solo detalle la entrada de historial ya la apuntó el llamante (open-tx.js): apuntar
    // otra aquí obligaría a pulsar «atrás» dos veces para volver a la pantalla de origen.
    if (push) pushBack(backToList);
    state.view = "detail";
    errorMsg = "";
    state.opening = false;
    render();
  }

  function backToList() {
    // Foto del ticket: se sale del detalle sin pasar por otro renderDetail() que revoque la URL
    // vigente — hay que hacerlo aquí, el único otro punto de salida.
    if (detailPhotoUrl) { URL.revokeObjectURL(detailPhotoUrl); detailPhotoUrl = null; }
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
            const catIcon = iconForCategory(c.id, byId);
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
        render();
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
          tagId: d.tagId || "",
        });
        await loadPeriodData();
        goBack();
      } catch (e) {
        btn.disabled = false;
        errorMsg = t("common.saveFailed", { error: userMessage(e) });
        render();
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
            await loadPeriodData();
            goBack();
          } catch (e) {
            if (btn) btn.disabled = false;
            errorMsg = t("movimientos.error.delete", { error: userMessage(e) });
            render();
          }
        },
      });
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
            <div class="day-label" style="font:var(--t-label);font-weight:600;color:var(--ink);">${g.date === hoy ? t("common.today") : fmtDiaCorto(g.date)}</div>
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
    // Índice de state.periodId en `periods` (ORDER BY start_date DESC, sql.js#listPeriods): el
    // índice 0 es el más reciente. "Periodo anterior" (icon back, izquierda) avanza el índice
    // hacia atrás en el tiempo → +1; "Periodo siguiente" (chevronRight, derecha) → -1.
    const periodIdx = periods.findIndex((p) => p.id === state.periodId);
    const currentPeriod = periods[periodIdx] ?? periods[0];

    // Chips por categoría raíz (artboard Movimientos.dc.html:32-35): activa = tinta invertida
    // (.chip.active del sistema); inactiva = texto en --ink-2 neutro (el color de .chip por
    // defecto), SOLO el emoji lleva el tinte de la categoría — el artboard aquí es texto plano
    // con el emoji delante, sin tinte de fondo (a diferencia de .chip-icon, que sí lleva círculo).
    // Por eso el color va en un <span> alrededor del emoji, nunca en el botón entero: un color
    // inline en el botón SIEMPRE ganaría sobre .chip.active y rompería la inversión al activarse.
    const catChipsHtml = rootCats.map((catId) => {
      const active = state.filter.rootCatId === catId;
      // catIcon: mismo criterio que movRowHtml — deja el nombre `icon` libre para la función
      // importada de icons.js, que esta misma función renderList ya usa más abajo.
      const catIcon = iconForCategory(catId, byId);
      const name = byId[catId]?.name ?? "";
      const color = textColorForCategory(catId, byId);
      return `<button type="button" class="chip${active ? " active" : ""}" data-chip-cat="${catId}" style="padding:0 14px;">
        <span style="${active ? "" : `color:${color};`}">${catIcon}</span> ${escHtml(name)}
      </button>`;
    }).join("");

    // Chip "Sin categoría · N" (artboard Movimientos.dc.html:35): activa = tinta invertida;
    // inactiva = borde discontinuo --rule, padding simétrico porque no lleva icono (mismo criterio
    // que ya tenía antes de Task 4).
    const uncatChipHtml = state.uncategorizedCount > 0
      ? `<button type="button" data-chip-uncat class="chip${state.filter.uncat ? " active" : ""}" style="padding:0 14px;${state.filter.uncat ? "" : "background:transparent;border:1px dashed var(--rule);"}">${t("movimientos.uncategorizedChip", { n: state.uncategorizedCount })}</button>`
      : "";

    container.innerHTML = `
      <header class="screen-header" style="flex-direction:row;align-items:flex-start;justify-content:space-between;">
        <div style="display:flex;flex-direction:column;gap:3px;">
          <h1 style="font: var(--t-title); letter-spacing:-.01em;">${t("common.movements")}</h1>
          ${openPeriod ? `<span style="font:var(--t-label);color:var(--ink-3);">${t("inicio.header.dayOf", { period: escHtml(openPeriod.name), day: dayIndexOfPeriod(openPeriod.start_date, hoyISO()), total: expectedPeriodDays(openPeriod.start_date) })}</span>` : ""}
        </div>
        <button type="button" class="icon-btn" id="mov-search-toggle" aria-label="${t("movimientos.filter.toggle")}">${icon("filter")}</button>
      </header>

      ${state.searchOpen ? `
      <label class="field field-stack" style="margin-bottom:14px;">
        <span class="field-label">${t("movimientos.search.label")}</span>
        <input type="text" id="mov-search-input" value="${escAttr(state.filter.query)}" placeholder="${t("movimientos.search.placeholder")}">
      </label>` : ""}

      <div class="period-picker">
        <button type="button" id="mov-period-prev" aria-label="${t("movimientos.period.prev")}" ${periodIdx >= periods.length - 1 ? "disabled" : ""}>${icon("back", { size: 18 })}</button>
        <div style="display:flex;align-items:center;gap:8px;">
          ${icon("calendar", { size: 17, stroke: "var(--ink-3)" })}
          <span style="font-size:15px;font-weight:600;color:var(--ink);">${escHtml(currentPeriod.name)}</span>
        </div>
        <button type="button" id="mov-period-next" aria-label="${t("movimientos.period.next")}" ${periodIdx <= 0 ? "disabled" : ""}>${icon("chevronRight", { size: 18 })}</button>
      </div>

      <div class="chips-row" style="margin-bottom:14px;">
        <button type="button" data-chip-all class="chip${allActive ? " active" : ""}" style="padding:0 14px;">${t("movimientos.chipAll")}</button>
        ${catChipsHtml}
        ${uncatChipHtml}
      </div>

      ${tagChipsHtml()}
      ${tagCardHtml()}

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      <div id="mov-list-body">${listBodyHtml()}</div>
      ${tagOlderNoteHtml()}
    `;
    wireList();
  }

  async function changePeriod(id) {
    state.periodId = id;
    // D13: tagId sobrevive a un cambio de periodo (una etiqueta es transversal, D7) — el resto
    // del filtro sí es intrínseco al periodo que se deja atrás y se resetea como siempre.
    state.filter = { query: "", rootCatId: null, uncat: false, tagId: state.filter.tagId };
    state.searchOpen = false;
    try {
      await loadPeriodData();
    } catch (err) {
      errorMsg = t("movimientos.error.loadPeriod", { error: userMessage(err) });
    }
    render();
  }

  function wireList() {
    // Los botones ya llegan `disabled` en el extremo correspondiente (ver renderList): un botón
    // disabled no dispara click, así que no hace falta repetir aquí la comprobación de índice.
    container.querySelector("#mov-period-prev").onclick = () => {
      const idx = periods.findIndex((p) => p.id === state.periodId);
      if (idx < periods.length - 1) changePeriod(periods[idx + 1].id);
    };
    container.querySelector("#mov-period-next").onclick = () => {
      const idx = periods.findIndex((p) => p.id === state.periodId);
      if (idx > 0) changePeriod(periods[idx - 1].id);
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

    // Chips de etiqueta (Task 12): filtro independiente de categoría/sin-categoría — se combinan
    // con AND en matchesFilter, ninguno toca al otro. Tocar la ya activa vuelve a "Todas" (mismo
    // toggle que la chip "Sin categoría"); no hay chip "Todas" propia de esta fila.
    container.querySelectorAll("[data-chip-tag]").forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.chipTag;
        state.filter.tagId = state.filter.tagId === id ? null : id;
        render();
      };
    });

    wireListBody();
  }

  function render() {
    if (state.view === "detail") renderDetail();
    else renderList();
  }

  try {
    await loadPeriodData();
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">${t("movimientos.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }
  // Modo solo detalle: la lista no llega a pintarse nunca — se abre directo en el detalle pedido,
  // sin apuntar una segunda entrada de historial (push:false, ver openDetail más arriba).
  if (detailOnly) { await openDetail(detailTxId, { push: false }); return; }
  render();
}
