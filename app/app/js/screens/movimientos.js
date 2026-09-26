import {
  listPeriods, listAllByDay, countUncategorized, allCategoriesById, listAccounts,
  getMetaAll, tagTotals, tagTotalsOfPeriod, spentOfPeriod, budgetsOfPeriod,
} from "../repo.js";
import { FAMILIES, familyForCategory, iconForCategory, rootOf } from "../category-colors.js";
import { budgetMap } from "../category-spend.js";
import { matchesFilter, isUncategorized, groupByDay, daySpentCents } from "../movimientos-filter.js";
import { fmtMoney, fmtMoneyParts, moneyPartsHtml, hoyISO, prevDayIso } from "../format.js";
import { t } from "../i18n/index.js";
import { rootHeaderHtml, buttonHtml } from "../ui.js";
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
function bareAmount(cents) {
  const { main, cents: c } = fmtMoneyParts(Math.abs(cents));
  return `${main}${c}`.trim();
}

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
  const who = escHtml(partnerName || t("movimientos.shared.fallbackName"));
  const shareNoteHtml = !shared ? ""
    : r.paid_by === "partner"
      ? t("movimientos.row.partnerPaid", { name: who })
      : t("movimientos.row.sharedOf", { name: who, amount: `<span class="num">${escHtml(bareAmount(r.amount_cents))}</span>` });
  return txRowHtml({
    fam,
    icon: uncategorized ? "plus" : iconForCategory(r.category_id, byId),
    title: r.merchant || catName || t("movimientos.uncategorized"),
    line2: uncategorized ? t("movimientos.tapToCategorize") : categoryPath(r.category_id, byId),
    amountHtml: moneyPartsHtml(Math.abs(shared ? r.my_amount_cents : r.amount_cents)),
    sign: isExpense ? "expense" : "income",
    amountWeight: 500,
    amountNoteHtml: shareNoteHtml,
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
  let periods, accountsAll, byId, meta;
  try {
    [periods, accountsAll, byId, meta] = await Promise.all([listPeriods(), listAccounts(), allCategoriesById(), getMetaAll()]);
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

  const state = {
    periodId: periods.find((p) => p.status === "open")?.id ?? periods[0].id,
    rows: [],
    rowsById: {},
    uncategorizedCount: 0,
    spentCents: 0,
    budgetCents: 0,
    tagTotalsPeriod: [], // Task 12: n/spent_cents por etiqueta EN ESTE periodo (chips + línea de la tarjeta)
    tagTotalsAll: [], // Task 12: total de SIEMPRE por etiqueta (D7) — nombre, límite y barra de la tarjeta
    // Task 4: filtro cliente sobre state.rows (buscador + categoría raíz + sin categoría + etiqueta).
    // Las cuatro condiciones se combinan con AND en matchesFilter (movimientos-filter.js); la UI
    // garantiza que rootCatId y uncat no estén activos a la vez (selección única). «Todos» = sin
    // categoría ni «sin categoría». tagId: D13, NUNCA se autolimpia (a diferencia de rootCatId, ver
    // loadPeriodData) y sobrevive a un cambio de periodo: una etiqueta es transversal por definición.
    filter: { query: "", rootCatId: null, uncat: false, tagId },
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
    // mismo invariante para la categoría raíz activa: si el último movimiento de esa raíz se
    // recategoriza/borra, su chip desaparece de presentRootCats() pero el filtro seguía activo.
    if (state.filter.rootCatId && !presentRootCats().includes(state.filter.rootCatId)) state.filter.rootCatId = null;
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
          : state.filter.uncat
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

  /** Fila de chips (B-Movimientos): «Todos» neutro (relleno --accent al estar elegido), una por
   *  categoría raíz presente con su muestra -b, «Sin categoría N» si hay, y la etiqueta activa
   *  (si la hay) para poder quitarla de un toque. Selección única, como siempre. */
  function chipsRowHtml() {
    const f = state.filter;
    const activeTag = f.tagId ? state.tagTotalsAll.find((tg) => tg.id === f.tagId) : null;
    const others = [
      ...presentRootCats().map((id) => rootChipHtml(id, f.rootCatId === id)),
      state.uncategorizedCount > 0 ? uncatChipHtml(f.uncat) : "",
      activeTag ? tagChipHtml(activeTag, true) : "",
    ].filter(Boolean);
    // Sin nada que elegir (periodo vacío), un «Todos» solo no dice nada: no se pinta la fila.
    if (others.length === 0) return "";
    const chips = [
      filterChipHtml({ label: t("movimientos.chipAll"), selected: !f.rootCatId && !f.uncat, data: { chipAll: "1" } }),
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
    const nothingToFilter = presentRootCats().length === 0 && state.uncategorizedCount === 0 && visibleTags(state.filter.tagId).length === 0;

    container.innerHTML = `
      <div class="mov">
        <div class="mov-head">
          ${rootHeaderHtml({ title: current.name, subtitle })}
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
    // D13: tagId sobrevive a un cambio de periodo (una etiqueta es transversal, D7) — el resto
    // del filtro sí es intrínseco al periodo que se deja atrás y se resetea como siempre.
    state.filter = { query: "", rootCatId: null, uncat: false, tagId: state.filter.tagId };
    try {
      await loadPeriodData();
    } catch (err) {
      errorMsg = t("movimientos.error.loadPeriod", { error: userMessage(err) });
    }
    // En un extremo el botón pulsado queda disabled y no puede recibir el foco: se da al otro.
    renderList({ focus: [`${focus}:not(:disabled)`, ".mov-period-nav .icon-btn:not(:disabled)"] });
  }

  /** Hoja de filtros (B-Movimientos-Filtros, sheet.js) con la semántica de siempre. Trabaja sobre
   *  un BORRADOR: «Ver N movimientos» lo aplica; el velo, Escape o el atrás del sistema lo
   *  descartan. N cuenta las filas que dejaría el borrador (búsqueda incluida). Solo se pintan las
   *  secciones que la lógica actual sabe filtrar (B-2, filtros múltiples, queda fuera). */
  function openFilters() {
    const draft = { rootCatId: state.filter.rootCatId, uncat: state.filter.uncat, tagId: state.filter.tagId };
    let apply = false;
    const count = () => state.rows.filter((r) => matchesFilter(r, { ...state.filter, ...draft }, byId)).length;

    const bodyHtml = () => {
      // En la hoja van en el orden de las familias (Casa, Alimentación, Restauración…; las que no
      // tienen familia, al final), no en el de aparición, y la elegida lleva además su check
      // detrás (B-Movimientos-Filtros). sort es estable: a igual familia, el orden de aparición.
      const order = (id) => { const i = FAMILIES.indexOf(familyForCategory(id, byId)); return i < 0 ? FAMILIES.length : i; };
      const cats = [...presentRootCats()].sort((a, b) => order(a) - order(b))
        .map((id) => rootChipHtml(id, draft.rootCatId === id, true));
      if (state.uncategorizedCount > 0) cats.push(uncatChipHtml(draft.uncat));
      const tags = visibleTags(draft.tagId).map((tg) => tagChipHtml(tg, draft.tagId === tg.id));
      const section = (id, title, chips, count = 0) => (chips.length ? `
        <section class="mov-flt-sec" aria-labelledby="${id}">
          <h3 class="mov-flt-label" id="${id}">${escHtml(title)}${count ? ` <span class="num mov-flt-count">${count}</span>` : ""}</h3>
          <div class="mov-flt-chips" role="group" aria-labelledby="${id}">${chips.join("")}</div>
        </section>` : "");
      return `
        ${section("mov-flt-cat", t("movimientos.filter.categories"), cats, draft.rootCatId || draft.uncat ? 1 : 0)}
        ${section("mov-flt-tag", t("movimientos.filter.tag"), tags)}
        <div class="mov-flt-foot">${buttonHtml({ kind: "primary", id: "mov-flt-apply", label: t("movimientos.filter.apply", { n: count() }) })}</div>`;
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
      body.innerHTML = bodyHtml();
      wireSheet();
      if (focus) dlg.querySelector(focus)?.focus();
    };
    function wireSheet() {
      body.querySelectorAll("[data-chip-cat]").forEach((b) => {
        b.onclick = () => {
          const id = b.dataset.chipCat;
          draft.rootCatId = draft.rootCatId === id ? null : id;
          draft.uncat = false;
          repaint(`[data-chip-cat="${id}"]`);
        };
      });
      const uncat = body.querySelector("[data-chip-uncat]");
      if (uncat) uncat.onclick = () => {
        draft.uncat = !draft.uncat;
        if (draft.uncat) draft.rootCatId = null;
        repaint("[data-chip-uncat]");
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
      draft.rootCatId = null;
      draft.uncat = false;
      draft.tagId = null;
      repaint("");
    };
    wireSheet();
    // Tras el "close" de sheet.js (que ya devolvió el foco al botón «Filtrar»): mientras la hoja
    // sigue abierta el resto de la página es inerte, así que el repintado espera a este momento.
    dlg.addEventListener("close", () => {
      if (!apply) return;
      Object.assign(state.filter, draft);
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
      state.filter.rootCatId = null;
      state.filter.uncat = false;
      renderList({ focus: "[data-chip-all]" });
    };

    container.querySelectorAll(".mov-chips [data-chip-cat]").forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.chipCat;
        // tocar el chip ya activo vuelve a «Todos» (mismo toggle que «Sin categoría»).
        state.filter.rootCatId = state.filter.rootCatId === id ? null : id;
        state.filter.uncat = false;
        renderList({ focus: `.mov-chips [data-chip-cat="${id}"]` });
      };
    });

    const chipUncat = container.querySelector(".mov-chips [data-chip-uncat]");
    if (chipUncat) chipUncat.onclick = () => {
      state.filter.uncat = !state.filter.uncat;
      if (state.filter.uncat) state.filter.rootCatId = null;
      renderList({ focus: ".mov-chips [data-chip-uncat]" });
    };

    // Chip de la etiqueta activa: tocarlo quita el filtro de etiqueta (se elige en la hoja).
    const chipTag = container.querySelector(".mov-chips [data-chip-tag]");
    if (chipTag) chipTag.onclick = () => {
      state.filter.tagId = null;
      renderList({ focus: ["[data-chip-all]", "#mov-filter"] });
    };

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
