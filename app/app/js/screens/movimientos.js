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
import { icon, catIcon as catSvg } from "../icons.js";
import { dayIndexOfPeriod, expectedPeriodDays } from "../prevision.js";
import { PCT_STEP, normalizePct, stepPct, splitCents } from "../share-pct.js";
import { pushBack, goBack } from "../back.js";
import { userMessage } from "../errors.js";
import { skeletonHtml } from "../skeleton.js";
import { renderMovimientoDetalle } from "./movimiento-detalle.js";
import { showConfirm } from "../modal.js";
import { showToast } from "../toast.js";

import { escHtml, escAttr } from "../esc.js";
const needsCategory = (tipo) => tipo === "expense" || tipo === "income" || tipo === "refund";

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
  const catIcon = uncategorized ? icon("plus", { size: 15, width: 2, stroke: "var(--ink-3)" }) : catSvg(iconForCategory(r.category_id, byId), { size: "1em" });
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
 *  (los 5 tipos). Tocar una fila abre el detalle (movimiento-detalle.js) en este mismo contenedor. */
export async function renderMovimientos(container, { tagId = null } = {}) {
  // Silueta gris mientras llega la primera consulta (mismo criterio que inicio.js): selector de
  // periodo, fila de chips y lista. Solo en el PRIMER pintado de esta pantalla — el testigo
  // container.dataset.screen lo escriben SOLO Inicio y Movimientos.
  if (container.dataset.screen !== "movimientos") {
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
    opening: false, // apertura de detalle en curso (ver openDetail)
  };
  let errorMsg = "";
  // dispose del detalle abierto (revoca la URL de la foto del ticket): lo llama backToList.
  let disposeDetail = null;

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

  async function openDetail(id) {
    // Guard de apertura en curso: la lista sigue viva durante el await, y dos toques seguidos
    // apuntarían DOS entradas de historial para una sola vista abierta.
    if (state.opening) return;
    state.opening = true;
    try {
      // El detalle vive en movimiento-detalle.js (S5). Apunta la entrada de «atrás» solo si el
      // movimiento existe (onOpen); tras guardar o borrar recarga el periodo antes de volver.
      const dispose = await renderMovimientoDetalle(container, id, {
        onOpen: () => { pushBack(backToList); errorMsg = ""; },
        onChanged: loadPeriodData,
      });
      if (dispose) disposeDetail = dispose;
    } catch (e) {
      errorMsg = t("movimientos.error.openDetail", { error: userMessage(e) });
      render();
    } finally {
      state.opening = false;
    }
  }

  function backToList() {
    // Foto del ticket: se sale del detalle sin pasar por otro repintado suyo que revoque la URL
    // vigente — hay que hacerlo aquí, el único otro punto de salida.
    disposeDetail?.();
    disposeDetail = null;
    errorMsg = "";
    render();
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
      const catIcon = catSvg(iconForCategory(catId, byId), { size: "1em" });
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
    renderList();
  }

  try {
    await loadPeriodData();
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">${t("movimientos.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }
  render();
}
