import {
  listPeriods, listAllByDay, countUncategorized, allCategoriesById, listAccounts,
  getMetaAll, tagTotals, tagTotalsOfPeriod, spentOfPeriod, budgetsOfPeriod, listGoals,
} from "../repo.js";
import { familyForAccount, parseAccountStyle } from "../account-colors.js";
import { segmentedHtml, wireSegmented, fieldHtml } from "../controls.js";
import { FAMILIES, familyForCategory, iconForCategory, rootOf } from "../category-colors.js";
import { budgetMap } from "../category-spend.js";
import {
  matchesFilter, isUncategorized, groupByDay, daySpentCents, amountBoundCents, isFilterActive, activeCategoryCount,
} from "../movimientos-filter.js";
import { fmtMoney, moneyPartsHtml, hoyISO, prevDayIso, periodTitle, currencySymbol, centsToRaw } from "../format.js";
import { t } from "../i18n/index.js";
import { rootHeaderHtml, buttonHtml, sharedNoteHtml } from "../ui.js";
import { icon } from "../icons.js";
import { displayHtml, dispInkHtml, meterHtml, emptyStateHtml } from "../instrument.js";
import { filterChipHtml, txRowHtml, dayHeaderHtml } from "../entity.js";
import { dayIndexOfPeriod, expectedPeriodDays } from "../prevision.js";
import { pushBack, goBack } from "../back.js";
import { userMessage } from "../errors.js";
import { skeletonHtml } from "../skeleton.js";
import { showSheet } from "../sheet.js";
import { renderMovimientoDetalle } from "./movimiento-detalle.js";
import { escHtml, escAttr } from "../esc.js";

const needsCategory = (tipo) => tipo === "expense" || tipo === "income" || tipo === "refund";

const dayNumber = (iso) => new Date(iso + "T12:00:00").getDate();
const weekdayShort = (iso) => t(`movimientos.weekdayShort.${new Date(iso + "T12:00:00").getDay()}`);

/** Cabecera de día (B-Movimientos): «Hoy dom 13», «Ayer sáb 12»; más atrás, «Vie 11» (el día
 *  solo empieza en mayúscula, como en el mockup). El total es lo gastado ese día entre las filas
 *  visibles (movimientos-filter.js#daySpentCents); sin gasto, sin total. */
function dayHeaderFor(date, hoy, totalCents) {
  const short = `${weekdayShort(date)} ${dayNumber(date)}`;
  const totalHtml = totalCents ? moneyPartsHtml(totalCents) : "";
  if (date === hoy) return dayHeaderHtml({ label: t("common.today"), date: short, totalHtml });
  if (date === prevDayIso(hoy)) return dayHeaderHtml({ label: t("movimientos.yesterday"), date: short, totalHtml });
  return dayHeaderHtml({ label: short.charAt(0).toLocaleUpperCase() + short.slice(1), totalHtml });
}

/** «24,00» del «con Marta, de 24,00» (B-Movimientos): la cifra sin el símbolo de moneda cuando va
 *  detrás; si el locale lo pone delante, se queda (va dentro de `main`). */

/** «Casa › Supermercado» (B-Movimientos, línea 2 de la fila): la raíz y la hoja, o solo la raíz. */
function categoryPath(catId, byId) {
  const cat = catId ? byId[catId] : null;
  if (!cat) return "";
  const parent = cat.parent_id ? byId[cat.parent_id] : null;
  return parent ? `${parent.name} › ${cat.name}` : cat.name;
}

/** Fila de movimiento (entity.js#txRowHtml, B-Movimientos): SIEMPRE un botón, toda fila abre el
 *  detalle. Importe en valor absoluto a peso 500; el signo va por `sign`. Los cinco tipos:
 *   - gasto: familia de su raíz (C6), «−» en tinta (C7);
 *   - ingreso: sin familia, «+» en --pos (C9);
 *   - devolución: familia de su categoría de gasto, «+» (vuelve dinero);
 *   - transferencia y ajuste: no son entidad (C11), sin familia y con icono de UI.
 *  Sin categoría: baldosa neutra con «+» y «toca para categorizar» en la línea 2. Compartido (como
 *  en el mockup): la cifra es MI parte —la misma que suma el total del día— y debajo «con Marta,
 *  de 24,00» (el ticket entero) o, si pagó ella, «pagó Marta». */
function movRowHtml(r, byId, accById, partnerName) {
  const data = { tx: r.id };
  if (r.type === "transfer") {
    const from = accById[r.account_id]?.name ?? "?";
    const to = accById[r.counter_account_id]?.name ?? "?";
    return txRowHtml({
      fam: null, icon: "transfer", title: `${from} → ${to}`, line2: r.merchant || r.note || t("movimientos.type.transfer"),
      amountHtml: moneyPartsHtml(Math.abs(r.amount_cents)), sign: "none", amountWeight: 500, data,
    });
  }
  if (r.type === "adjustment") {
    return txRowHtml({
      fam: null, icon: "pencil", title: t("common.type.adjustment"), line2: r.merchant || r.note || "",
      amountHtml: moneyPartsHtml(Math.abs(r.amount_cents)), sign: r.amount_cents < 0 ? "expense" : "income", amountWeight: 500, data,
    });
  }
  const uncategorized = isUncategorized(r);
  const catName = byId[r.category_id]?.name ?? "";
  const isExpense = r.type === "expense";
  const fam = uncategorized || r.type === "income" ? null : familyForCategory(r.category_id, byId);
  const shared = !!r.is_shared;
  return txRowHtml({
    fam,
    icon: uncategorized ? "plus" : iconForCategory(r.category_id, byId),
    title: r.merchant || catName || t("movimientos.uncategorized"),
    line2: uncategorized ? t("movimientos.tapToCategorize") : categoryPath(r.category_id, byId),
    amountHtml: moneyPartsHtml(Math.abs(shared ? r.my_amount_cents : r.amount_cents)),
    sign: isExpense ? "expense" : "income",
    amountWeight: 500,
    amountNoteHtml: sharedNoteHtml(r, partnerName),
    data,
  });
}

/** Pantalla Movimientos (B-Movimientos): cabecera de raíz con ‹ › de periodo, Display compacto
 *  «Gastado en el periodo», buscador, chips de categoría y lista por día. «Filtrar» abre la hoja
 *  de filtros (B-Movimientos-Filtros) con la semántica de siempre (matchesFilter): una categoría
 *  raíz o «sin categoría», y una etiqueta. Tocar una fila abre el detalle (movimiento-detalle.js)
 *  en este mismo contenedor.
 *  `tagId` (Etiquetas, N11) llega de nav("movimientos", { tagId }) al entrar desde Etiquetas. */
export async function renderMovimientos(container, { tagId = null } = {}) {
  // Silueta gris mientras llega la primera consulta (mismo criterio que inicio.js). Solo en el
  // PRIMER pintado de esta pantalla — el testigo container.dataset.screen lo escriben SOLO Inicio y
  // Movimientos.
  if (container.dataset.screen !== "movimientos") {
    container.dataset.screen = "movimientos";
    container.innerHTML = skeletonHtml([72, 96, 56, 320]);
  }
  let periods, accountsAll, byId, meta, goals;
  try {
    [periods, accountsAll, byId, meta, goals] = await Promise.all([listPeriods(), listAccounts(), allCategoriesById(), getMetaAll(), listGoals()]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso is-error">${t("movimientos.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }
  if (periods.length === 0) {
    container.innerHTML = `<div class="mov">${rootHeaderHtml({ title: t("common.movements") })}
      ${emptyStateHtml({ title: t("movimientos.noPeriods"), rows: 2 })}</div>`;
    return;
  }
  const accById = Object.fromEntries(accountsAll.map((a) => [a.id, a]));
  const partnerName = (meta.partner_name || "").trim();
  // B-2: la familia de cada cuenta (muestra del Segmented «Cuenta» y de su chip). Con los objetivos,
  // para que la hucha salga en su familia (D-impl-2).
  const accountStyle = parseAccountStyle(meta.account_style);
  const accFam = (id) => familyForAccount(accById[id], accountStyle, goals);

  const state = {
    periodId: periods.find((p) => p.status === "open")?.id ?? periods[0].id,
    rows: [],
    rowsById: {},
    uncategorizedCount: 0,
    spentCents: 0,
    budgetCents: 0,
    tagTotalsPeriod: [], // Task 12: n/spent_cents por etiqueta EN ESTE periodo (chips + línea de la tarjeta)
    tagTotalsAll: [], // Task 12: total de SIEMPRE por etiqueta (D7) — nombre, límite y barra de la tarjeta
    // Filtro cliente sobre state.rows (matchesFilter, movimientos-filter.js). B-2 (filtros
    // múltiples): varias categorías raíz en O (rootCatIds; «sin categoría» es una opción más de esa
    // sección), y en Y con ellas la cuenta, el rango de importe, «solo compartidos», la etiqueta y
    // la búsqueda. «Todos» = ninguna categoría elegida. Vive solo mientras dura esta pantalla: al
    // salir de Movimientos se pierde (no se guarda en ningún sitio).
    // tagId: D13, NUNCA se autolimpia (a diferencia de rootCatIds, ver loadPeriodData) y sobrevive a
    // un cambio de periodo, igual que cuenta, importe y compartidos: no dependen del periodo.
    filter: { query: "", rootCatIds: [], uncat: false, tagId, accountId: null, minCents: null, maxCents: null, sharedOnly: false },
    opening: false, // apertura de detalle en curso (ver openDetail)
  };
  let errorMsg = "";
  // dispose del detalle abierto (revoca la URL de la foto del ticket): lo llama backToList.
  let disposeDetail = null;

  async function loadPeriodData() {
    let budgets;
    [state.rows, state.uncategorizedCount, state.tagTotalsPeriod, state.tagTotalsAll, state.spentCents, budgets] = await Promise.all([
      listAllByDay(state.periodId), countUncategorized(state.periodId),
      tagTotalsOfPeriod(state.periodId), tagTotals(), spentOfPeriod(state.periodId), budgetsOfPeriod(state.periodId),
    ]);
    state.rowsById = Object.fromEntries(state.rows.map((r) => [r.id, r]));
    // El «de» del Display: la suma de los límites del periodo, mismo cálculo que Inicio.
    state.budgetCents = Object.values(budgetMap(budgets)).reduce((s, c) => s + c, 0);
    // sin esto, categorizar/borrar el último movimiento sin categorizar con el filtro activo
    // deja la lista vacía sin forma de volver: el chip desaparece (count=0) pero el filtro seguía activo.
    if (state.uncategorizedCount === 0) state.filter.uncat = false;
    // mismo invariante para las categorías raíz elegidas: si el último movimiento de una raíz se
    // recategoriza/borra, su chip desaparece de presentRootCats() pero el filtro seguía activo.
    const present = presentRootCats();
    state.filter.rootCatIds = state.filter.rootCatIds.filter((id) => present.includes(id));
    // D13: filter.tagId NUNCA se autolimpia aquí, a propósito (ver el comentario de state.filter).
  }

  /** Categorías raíz presentes en las rows cargadas del periodo (Task 4): un chip por cada una, en
   *  orden de primera aparición. transfer/adjustment y filas sin categoría quedan fuera (las sin
   *  categoría tienen su propio chip «Sin categoría N»). */
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

  /** Etiquetas con movimientos EN ESTE PERIODO, más siempre la activa (aunque aquí dé n=0, para
   *  que el filtro puesto tenga un chip que lo represente y se pueda quitar). tagTotalsOfPeriod ya
   *  incluye archivadas a propósito, ver su comentario en sql.js. */
  function visibleTags(activeId) {
    const periodById = Object.fromEntries(state.tagTotalsPeriod.map((tg) => [tg.id, tg]));
    return state.tagTotalsAll.filter((tg) => (periodById[tg.id]?.n ?? 0) > 0 || tg.id === activeId);
  }

  const rootChipHtml = (catId, selected, trailCheck = false) => filterChipHtml({
    fam: familyForCategory(catId, byId), label: byId[catId]?.name ?? "", selected, data: { chipCat: catId }, trailCheck,
  });
  const uncatChipHtml = (selected) => filterChipHtml({
    label: t("movimientos.uncategorizedChip", { n: state.uncategorizedCount }), selected, data: { chipUncat: "1" },
  });
  const tagChipHtml = (tg, selected) => filterChipHtml({ tag: true, label: tg.name, selected, data: { chipTag: tg.id } });

  /** Cuentas que ofrece la hoja (B-2): las que aparecen en los movimientos del periodo (como
   *  origen o destino) más la elegida, en el orden de Patrimonio (listAccounts). */
  function presentAccounts(activeId) {
    const used = new Set();
    for (const r of state.rows) {
      if (r.account_id) used.add(r.account_id);
      if (r.counter_account_id) used.add(r.counter_account_id);
    }
    return accountsAll.filter((a) => used.has(a.id) || a.id === activeId);
  }

  /** «Solo compartidos» solo tiene sentido si se comparte algo: con pareja configurada, con algún
   *  compartido en el periodo o con el filtro ya puesto (para poder quitarlo). */
  const sharingInUse = (on) => !!partnerName || on || state.rows.some((r) => r.is_shared);

  /** Texto del chip de importe de la fila de arriba: «Desde 10,00 €», «Hasta 50,00 €» o ambos. */
  function amountChipLabel(min, max) {
    if (min !== null && max !== null) return t("movimientos.filter.chipRange", { min: fmtMoney(min), max: fmtMoney(max) });
    if (min !== null) return t("movimientos.filter.chipFrom", { amount: fmtMoney(min) });
    return t("movimientos.filter.chipTo", { amount: fmtMoney(max) });
  }

  /** Tarjeta de la etiqueta activa (Task 12): nombre y nº de movimientos de SIEMPRE (tagTotalsAll,
   *  D7), total global con medidor SOLO si tiene límite, y la línea del periodo que se mira. Nada
   *  sin etiqueta activa o si ya no existe (FK huérfana: no debe reventar el pintado). Etiqueta
   *  neutra (C10): sin color propio, el medidor en --idle. */
  function tagCardHtml() {
    const id = state.filter.tagId;
    if (!id) return "";
    const tag = state.tagTotalsAll.find((tg) => tg.id === id);
    if (!tag) return "";
    const periodTag = state.tagTotalsPeriod.find((tg) => tg.id === id) ?? { n: 0, spent_cents: 0 };
    const periodName = periods.find((p) => p.id === state.periodId)?.name ?? "";
    const limit = tag.budget_cents > 0 ? `
      <div class="mov-tag-limit">
        <span class="num mov-tag-amt">${escHtml(fmtMoney(tag.spent_cents))}</span>
        <span class="mov-tag-of">${escHtml(t("movimientos.tagCard.ofLimit", { limit: fmtMoney(tag.budget_cents) }))}</span>
      </div>
      ${meterHtml({ value: tag.spent_cents, max: tag.budget_cents })}` : "";
    return `
      <section class="mov-tag" aria-label="${escAttr(tag.name)}">
        <div class="mov-tag-head">
          <span class="mov-tag-name">${icon("tag", { size: 16 })}<span>${escHtml(tag.name)}</span></span>
          <span class="mov-tag-count">${escHtml(t("movimientos.tagCard.movements", { n: tag.n }))}</span>
        </div>
        ${limit}
        <span class="mov-tag-period">${escHtml(t("movimientos.tagCard.periodLine", { amount: fmtMoney(periodTag.spent_cents), period: periodName, n: periodTag.n }))}</span>
      </section>`;
  }

  /** Nota de cierre del filtro de etiqueta: cuántos movimientos de la etiqueta activa quedan FUERA
   *  de este periodo (tagTotalsAll.n menos tagTotalsPeriod.n). Solo con resto > 0. */
  function tagOlderNoteHtml() {
    const id = state.filter.tagId;
    if (!id) return "";
    const tag = state.tagTotalsAll.find((tg) => tg.id === id);
    if (!tag) return "";
    const older = tag.n - (state.tagTotalsPeriod.find((tg) => tg.id === id)?.n ?? 0);
    if (older <= 0) return "";
    const periodName = periods.find((p) => p.id === state.periodId)?.name ?? "";
    return `<p class="mov-note">${escHtml(t("movimientos.tag.olderNote", { n: older, tag: tag.name, period: periodName }))}</p>`;
  }

  async function openDetail(id) {
    // Guard de apertura en curso: la lista sigue viva durante el await, y dos toques seguidos
    // apuntarían DOS entradas de historial para una sola vista abierta.
    if (state.opening) return;
    state.opening = true;
    try {
      // El detalle vive en movimiento-detalle.js. Apunta la entrada de «atrás» solo si el
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

  /** Cuerpo de la lista (día a día o vacío) filtrado con matchesFilter. Vive en su propio
   *  contenedor (#mov-list-body) para poder refrescarlo solo a él desde el buscador sin recrear el
   *  campo: eso es lo que mantiene el foco/cursor mientras se escribe. */
  function listBodyHtml() {
    const hoy = hoyISO();
    const visible = state.rows.filter((r) => matchesFilter(r, state.filter, byId));
    if (visible.length === 0) {
      // query primero: si hay texto buscado, «ninguno coincide» es el mensaje relevante aunque el
      // chip «Sin categoría» también esté activo — solo sin query el vacío se atribuye al chip.
      const msg = state.rows.length === 0
        ? t("movimientos.empty.noPeriod")
        : state.filter.query
          ? t("movimientos.empty.noResults")
          : state.filter.uncat && !isFilterActive({ ...state.filter, uncat: false })
            ? t("movimientos.empty.noUncategorized")
            : t("movimientos.empty.noResults");
      return emptyStateHtml({ title: msg, rows: 2 });
    }
    return groupByDay(visible).map((g) => `
      <section class="mov-day">
        ${dayHeaderFor(g.date, hoy, daySpentCents(g.rows, state.rowsById))}
        <div class="mov-card">${g.rows.map((r) => movRowHtml(r, byId, accById, partnerName)).join('<div class="mov-hr" aria-hidden="true"></div>')}</div>
      </section>`).join("");
  }

  function wireListBody() {
    container.querySelectorAll("#mov-list-body [data-tx]").forEach((b) => {
      b.onclick = () => openDetail(b.dataset.tx);
    });
  }

  function refreshListBody() {
    const body = container.querySelector("#mov-list-body");
    if (!body) return;
    body.innerHTML = listBodyHtml();
    wireListBody();
  }

  /** Display m (B-Movimientos): lo gastado en el periodo (spentOfPeriod, mi parte y devoluciones
   *  restadas, como Inicio) y, si el periodo tiene límites, «de X» con el medidor de 8. */
  function displayBlockHtml() {
    const budget = state.budgetCents;
    return `<div class="mov-disp">${displayHtml({
      label: t("movimientos.display.label"),
      value: fmtMoney(state.spentCents),
      size: "m",
      footHtml: budget > 0 ? t("movimientos.display.of", { amount: dispInkHtml(fmtMoney(budget)) }) : "",
      slot: budget > 0 ? meterHtml({ value: Math.max(0, state.spentCents), max: budget, onDisplay: true, label: t("movimientos.display.meter") }) : "",
    })}</div>`;
  }

  /** Fila de chips (B-Movimientos): «Todos» neutro (relleno --accent al estar elegido); detrás,
   *  los filtros de la hoja que estén puestos (cuenta, importe, compartidos, etiqueta), elegidos, y
   *  cada uno se quita de un toque; luego una chip por categoría raíz presente con su muestra -b y
   *  «Sin categoría N» si hay. Las categorías se suman o se quitan de una en una (B-2: varias en O). */
  function chipsRowHtml() {
    const f = state.filter;
    const activeTag = f.tagId ? state.tagTotalsAll.find((tg) => tg.id === f.tagId) : null;
    const activeAcc = f.accountId ? accById[f.accountId] : null;
    const others = [
      activeAcc ? filterChipHtml({ fam: accFam(activeAcc.id), label: activeAcc.name, selected: true, data: { chipAcc: activeAcc.id } }) : "",
      f.minCents !== null || f.maxCents !== null
        ? filterChipHtml({ label: amountChipLabel(f.minCents, f.maxCents), selected: true, data: { chipAmount: "1" } }) : "",
      f.sharedOnly ? filterChipHtml({ label: t("movimientos.filter.chipShared"), selected: true, data: { chipShared: "1" } }) : "",
      activeTag ? tagChipHtml(activeTag, true) : "",
      ...presentRootCats().map((id) => rootChipHtml(id, f.rootCatIds.includes(id))),
      state.uncategorizedCount > 0 ? uncatChipHtml(f.uncat) : "",
    ].filter(Boolean);
    // Sin nada que elegir (periodo vacío), un «Todos» solo no dice nada: no se pinta la fila.
    if (others.length === 0) return "";
    const chips = [
      filterChipHtml({ label: t("movimientos.chipAll"), selected: activeCategoryCount(f) === 0, data: { chipAll: "1" } }),
      ...others,
    ];
    return `<div class="mov-chips" role="group" aria-label="${escAttr(t("movimientos.filter.category"))}">${chips.join("")}</div>`;
  }

  function renderList({ focus = "" } = {}) {
    const periodIdx = periods.findIndex((p) => p.id === state.periodId);
    const current = periods[periodIdx] ?? periods[0];
    const hoy = hoyISO();
    // Subtítulo: «Día N de M, quedan K días» solo para el periodo ABIERTO que se mira
    // (dayIndexOfPeriod cuenta desde hoy: en un periodo cerrado daría un «día 47 de 31»).
    let subtitle = t("movimientos.header.closed");
    if (current.status === "open") {
      const total = expectedPeriodDays(current.start_date);
      const day = dayIndexOfPeriod(current.start_date, hoy);
      subtitle = t("movimientos.header.sub", { day, total, n: Math.max(0, total - day) });
    }
    // Índice de state.periodId en `periods` (ORDER BY start_date DESC): 0 es el más reciente.
    // ‹ (anterior) avanza el índice hacia atrás en el tiempo → +1; › (siguiente) → -1.
    // B-2: con movimientos siempre hay algo que filtrar (cuenta, importe); sin ellos, el botón sigue
    // vivo si hay un filtro puesto, para poder quitarlo.
    const nothingToFilter = state.rows.length === 0 && !isFilterActive(state.filter) && visibleTags(state.filter.tagId).length === 0;

    container.innerHTML = `
      <div class="mov">
        <div class="mov-head">
          ${rootHeaderHtml({ title: periodTitle(current.name, hoyISO()), subtitle })}
          <div class="mov-period-nav">
            <button type="button" class="icon-btn" id="mov-period-prev" aria-label="${escAttr(t("movimientos.period.prev"))}" ${periodIdx >= periods.length - 1 ? "disabled" : ""}>${icon("chevronLeft")}</button>
            <button type="button" class="icon-btn" id="mov-period-next" aria-label="${escAttr(t("movimientos.period.next"))}" ${periodIdx <= 0 ? "disabled" : ""}>${icon("chevronRight")}</button>
          </div>
        </div>

        ${displayBlockHtml()}

        <div class="mov-tools">
          <label class="mov-search">
            ${icon("search")}
            <input type="search" id="mov-search-input" class="mov-search-input" value="${escAttr(state.filter.query)}"
              aria-label="${escAttr(t("movimientos.search.label"))}" placeholder="${escAttr(t("movimientos.search.placeholder"))}" enterkeyhint="search" autocomplete="off">
          </label>
          <button type="button" class="icon-btn mov-filter-btn" id="mov-filter" aria-haspopup="dialog"
            aria-label="${escAttr(t("movimientos.filter.toggle"))}" ${nothingToFilter ? "disabled" : ""}>${icon("filterLines")}</button>
        </div>

        ${chipsRowHtml()}
        ${tagCardHtml()}

        ${errorMsg ? `<div class="banner-aviso is-error">${escHtml(errorMsg)}</div>` : ""}

        <div id="mov-list-body" class="mov-list">${listBodyHtml()}</div>
        ${tagOlderNoteHtml()}
      </div>`;
    wireList();
    // K12: el innerHTML se lleva el foco al <body>; se devuelve al control que se acaba de pulsar
    // (o al primero de la lista de selectores que exista).
    for (const sel of [focus].flat().filter(Boolean)) {
      const el = container.querySelector(sel);
      if (el) { el.focus(); break; }
    }
  }

  async function changePeriod(id, focus) {
    state.periodId = id;
    // D13: tagId sobrevive a un cambio de periodo (una etiqueta es transversal, D7), y con él la
    // cuenta, el importe y «solo compartidos» (B-2). Búsqueda y categorías sí son del periodo que
    // se deja atrás (sus chips salen de sus filas) y se resetean como siempre.
    state.filter = { ...state.filter, query: "", rootCatIds: [], uncat: false };
    try {
      await loadPeriodData();
    } catch (err) {
      errorMsg = t("movimientos.error.loadPeriod", { error: userMessage(err) });
    }
    // En un extremo el botón pulsado queda disabled y no puede recibir el foco: se da al otro.
    renderList({ focus: [`${focus}:not(:disabled)`, ".mov-period-nav .icon-btn:not(:disabled)"] });
  }

  /** Hoja de filtros (B-Movimientos-Filtros, sheet.js), B-2: Categorías (varias, en O; «sin
   *  categoría» es una más), Cuenta (Segmented), Importe desde/hasta, «Solo compartidos» y
   *  Etiqueta. Trabaja sobre un BORRADOR: «Ver N movimientos» lo aplica; el velo, Escape o el atrás
   *  del sistema lo descartan. N cuenta las filas que dejaría el borrador (búsqueda incluida) y se
   *  recalcula al teclear un importe SIN repintar la hoja (el campo conserva foco y cursor). */
  function openFilters() {
    const f = state.filter;
    const rawOf = (c) => (c === null ? "" : c === 0 ? "0" : centsToRaw(c));
    const draft = {
      rootCatIds: [...f.rootCatIds], uncat: f.uncat, tagId: f.tagId, accountId: f.accountId, sharedOnly: f.sharedOnly,
      minRaw: rawOf(f.minCents), maxRaw: rawOf(f.maxCents),
    };
    let apply = false;
    const draftFilter = () => ({
      rootCatIds: draft.rootCatIds, uncat: draft.uncat, tagId: draft.tagId, accountId: draft.accountId,
      sharedOnly: draft.sharedOnly, minCents: amountBoundCents(draft.minRaw), maxCents: amountBoundCents(draft.maxRaw),
    });
    const count = () => state.rows.filter((r) => matchesFilter(r, { ...state.filter, ...draftFilter() }, byId)).length;
    const applyLabel = () => t("movimientos.filter.apply", { n: count() });

    const bodyHtml = () => {
      // En la hoja van en el orden de las familias (Casa, Alimentación, Restauración…; las que no
      // tienen familia, al final), no en el de aparición, y las elegidas llevan además su check
      // detrás (B-Movimientos-Filtros). sort es estable: a igual familia, el orden de aparición.
      const order = (id) => { const i = FAMILIES.indexOf(familyForCategory(id, byId)); return i < 0 ? FAMILIES.length : i; };
      const cats = [...presentRootCats()].sort((a, b) => order(a) - order(b))
        .map((id) => rootChipHtml(id, draft.rootCatIds.includes(id), true));
      if (state.uncategorizedCount > 0) cats.push(uncatChipHtml(draft.uncat));
      const tags = visibleTags(draft.tagId).map((tg) => tagChipHtml(tg, draft.tagId === tg.id));
      const label = (id, title, n = 0) => `<h3 class="mov-flt-label" id="${id}">${escHtml(title)}${n ? ` <span class="num mov-flt-count">${n}</span>` : ""}</h3>`;
      const section = (id, title, chips, n = 0) => (chips.length ? `
        <section class="mov-flt-sec" aria-labelledby="${id}">
          ${label(id, title, n)}
          <div class="mov-flt-chips" role="group" aria-labelledby="${id}">${chips.join("")}</div>
        </section>` : "");

      // Cuenta: «Todas» + las cuentas del periodo, cada una con la muestra de su familia. Con una
      // sola cuenta no hay nada que elegir y la sección no se pinta.
      const accs = presentAccounts(draft.accountId);
      const accountSec = accs.length > 1 || draft.accountId ? `
        <section class="mov-flt-sec" aria-labelledby="mov-flt-acc">
          ${label("mov-flt-acc", t("movimientos.filter.account"))}
          ${segmentedHtml({
            id: "mov-flt-acc-seg", name: t("movimientos.filter.account"), labelledBy: "mov-flt-acc",
            options: [{ value: "", label: t("movimientos.filter.allAccounts") }, ...accs.map((a) => ({ value: a.id, label: a.name, fam: accFam(a.id) }))],
            value: draft.accountId ?? "",
          })}
        </section>` : "";

      const amtLead = (key) => `<span class="mov-flt-amt-lead">${escHtml(t(key))}</span>`;
      const amountSec = state.rows.length ? `
        <section class="mov-flt-sec" aria-labelledby="mov-flt-amt">
          ${label("mov-flt-amt", t("movimientos.filter.amount"))}
          <div class="mov-flt-amt">
            ${fieldHtml({ id: "mov-flt-min", label: t("movimientos.filter.fromLabel"), value: draft.minRaw, inputmode: "decimal", num: true, suffix: currencySymbol(), lead: amtLead("movimientos.filter.from"), pill: true, hideLabel: true })}
            ${fieldHtml({ id: "mov-flt-max", label: t("movimientos.filter.toLabel"), value: draft.maxRaw, inputmode: "decimal", num: true, suffix: currencySymbol(), placeholder: t("movimientos.filter.noLimit"), lead: amtLead("movimientos.filter.to"), pill: true, hideLabel: true })}
          </div>
        </section>` : "";

      const sharedLabel = partnerName ? t("movimientos.filter.sharedWith", { name: partnerName }) : t("movimientos.filter.shared");
      const sharedSec = sharingInUse(draft.sharedOnly) ? `
        <button type="button" class="mov-flt-shared" id="mov-flt-shared" role="switch" aria-checked="${draft.sharedOnly ? "true" : "false"}">
          ${icon("people", { size: 20 })}
          <span class="mov-flt-shared-label">${escHtml(sharedLabel)}</span>
          <span class="ctl-switch is-accent" aria-checked="${draft.sharedOnly ? "true" : "false"}" aria-hidden="true"><span class="ctl-switch-knob"></span></span>
        </button>` : "";

      return `
        ${section("mov-flt-cat", t("movimientos.filter.categories"), cats, activeCategoryCount(draft))}
        ${accountSec}
        ${amountSec}
        ${sharedSec}
        ${section("mov-flt-tag", t("movimientos.filter.tag"), tags)}
        <div class="mov-flt-foot">${buttonHtml({ kind: "primary", id: "mov-flt-apply", label: applyLabel() })}</div>`;
    };

    const dlg = showSheet({
      title: t("movimientos.filter.title"),
      action: buttonHtml({ kind: "tertiary", id: "mov-flt-clear", label: t("movimientos.filter.clear") }),
      body: bodyHtml(),
    });
    if (!dlg) return;
    dlg.classList.add("mov-flt");
    const body = dlg.querySelector(".sheet-body");

    const repaint = (focus) => {
      const scroll = body.scrollTop;
      body.innerHTML = bodyHtml();
      body.scrollTop = scroll;
      wireSheet();
      if (focus) dlg.querySelector(focus)?.focus();
    };
    // Solo la etiqueta del botón: repintar la hoja al teclear se llevaría el foco del importe.
    const refreshApply = () => {
      const btn = body.querySelector("#mov-flt-apply");
      const lbl = btn?.querySelector("span");
      if (lbl) lbl.textContent = applyLabel();
    };
    function wireSheet() {
      body.querySelectorAll("[data-chip-cat]").forEach((b) => {
        b.onclick = () => {
          const id = b.dataset.chipCat;
          draft.rootCatIds = draft.rootCatIds.includes(id) ? draft.rootCatIds.filter((x) => x !== id) : [...draft.rootCatIds, id];
          repaint(`[data-chip-cat="${id}"]`);
        };
      });
      const uncat = body.querySelector("[data-chip-uncat]");
      if (uncat) uncat.onclick = () => {
        draft.uncat = !draft.uncat;
        repaint("[data-chip-uncat]");
      };
      const seg = body.querySelector("#mov-flt-acc-seg");
      if (seg) wireSegmented(seg, (v) => { draft.accountId = v || null; refreshApply(); });
      for (const [id, key] of [["#mov-flt-min", "minRaw"], ["#mov-flt-max", "maxRaw"]]) {
        const input = body.querySelector(id);
        if (input) input.oninput = (e) => { draft[key] = e.target.value; refreshApply(); };
      }
      const shared = body.querySelector("#mov-flt-shared");
      if (shared) shared.onclick = () => {
        draft.sharedOnly = !draft.sharedOnly;
        repaint("#mov-flt-shared");
      };
      body.querySelectorAll("[data-chip-tag]").forEach((b) => {
        b.onclick = () => {
          const id = b.dataset.chipTag;
          draft.tagId = draft.tagId === id ? null : id;
          repaint(`[data-chip-tag="${id}"]`);
        };
      });
      body.querySelector("#mov-flt-apply").onclick = () => { apply = true; goBack(); };
    }
    dlg.querySelector("#mov-flt-clear").onclick = () => {
      Object.assign(draft, { rootCatIds: [], uncat: false, tagId: null, accountId: null, sharedOnly: false, minRaw: "", maxRaw: "" });
      repaint("");
    };
    wireSheet();
    // Tras el "close" de sheet.js (que ya devolvió el foco al botón «Filtrar»): mientras la hoja
    // sigue abierta el resto de la página es inerte, así que el repintado espera a este momento.
    dlg.addEventListener("close", () => {
      if (!apply) return;
      Object.assign(state.filter, draftFilter());
      renderList({ focus: "#mov-filter" });
    });
  }

  function wireList() {
    // Los botones ya llegan `disabled` en el extremo correspondiente: un botón disabled no dispara
    // click, así que no hace falta repetir aquí la comprobación de índice.
    container.querySelector("#mov-period-prev").onclick = () => {
      const idx = periods.findIndex((p) => p.id === state.periodId);
      if (idx < periods.length - 1) changePeriod(periods[idx + 1].id, "#mov-period-prev");
    };
    container.querySelector("#mov-period-next").onclick = () => {
      const idx = periods.findIndex((p) => p.id === state.periodId);
      if (idx > 0) changePeriod(periods[idx - 1].id, "#mov-period-next");
    };

    container.querySelector("#mov-search-input").oninput = (e) => {
      state.filter.query = e.target.value;
      // NO se repinta la pantalla (perdería el foco/cursor del campo): solo #mov-list-body.
      refreshListBody();
    };

    container.querySelector("#mov-filter").onclick = () => openFilters();

    const chipAll = container.querySelector("[data-chip-all]");
    if (chipAll) chipAll.onclick = () => {
      state.filter.rootCatIds = [];
      state.filter.uncat = false;
      renderList({ focus: "[data-chip-all]" });
    };

    container.querySelectorAll(".mov-chips [data-chip-cat]").forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.chipCat;
        // B-2: cada chip suma o quita su categoría (varias a la vez, en O); sin ninguna, «Todos».
        const ids = state.filter.rootCatIds;
        state.filter.rootCatIds = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
        renderList({ focus: `.mov-chips [data-chip-cat="${id}"]` });
      };
    });

    const chipUncat = container.querySelector(".mov-chips [data-chip-uncat]");
    if (chipUncat) chipUncat.onclick = () => {
      state.filter.uncat = !state.filter.uncat;
      renderList({ focus: ".mov-chips [data-chip-uncat]" });
    };

    // Chips de los filtros de la hoja (etiqueta, cuenta, importe, compartidos): tocar uno lo quita
    // (se eligen en la hoja).
    const removers = [
      ["[data-chip-tag]", () => { state.filter.tagId = null; }],
      ["[data-chip-acc]", () => { state.filter.accountId = null; }],
      ["[data-chip-amount]", () => { state.filter.minCents = null; state.filter.maxCents = null; }],
      ["[data-chip-shared]", () => { state.filter.sharedOnly = false; }],
    ];
    for (const [sel, clear] of removers) {
      const chip = container.querySelector(`.mov-chips ${sel}`);
      if (chip) chip.onclick = () => { clear(); renderList({ focus: ["[data-chip-all]", "#mov-filter"] }); };
    }

    wireListBody();
  }

  function render() {
    renderList();
  }

  try {
    await loadPeriodData();
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso is-error">${t("movimientos.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }
  render();
}
