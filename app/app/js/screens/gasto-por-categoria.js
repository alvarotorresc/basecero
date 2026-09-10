import {
  getOpenPeriod, spentByRootCategory, spentByChildCategory, budgetsOfPeriod,
  allCategoriesById, upsertBudget, deleteBudget, rootSpendHistory,
} from "../repo.js";
import { colorForCategory, iconForCategory, textColorForCategory } from "../category-colors.js";
import { budgetStatus, pctOf, relativeWidth, limitTotals, sortRootRows, budgetMap, compareRoots, spentSeriesByRoot } from "../category-spend.js";
import { trendSvg } from "../charts.js";
import { eurToCents } from "../contract.js";
import { fmtMoney, moneyPartsHtml, hoyISO, currencySymbol, fmtPct } from "../format.js";
import { dayIndexOfPeriod, expectedPeriodDays } from "../prevision.js";
import { t } from "../i18n/index.js";
import { userMessage } from "../errors.js";
import { showToast } from "../toast.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// Espacio DURO (U+00A0) antes del %: sin él el porcentaje se parte en dos líneas al estrecharse el
// contenedor. fmtPct de format.js no sirve: emite un decimal ("38,8 %").
const fmtPctInt = (pct) => `${Math.round(pct)}\u00A0%`;

// Toda anchura de barra pasa por aquí: spentByRootCategory puede devolver spent_cents NEGATIVO
// (una devolución mayor que el gasto de la raíz) y `width:-12%` es CSS inválido — el navegador
// descarta la declaración y el relleno se pinta al 100 %.
const clampPct = (pct) => Math.min(100, Math.max(0, pct));

const chevronSvg = (deg) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform:rotate(${deg}deg);"><path d="M9 5l7 7-7 7"></path></svg>`;

// Flechas "tendencia sube"/"tendencia baja" del repertorio SISTEMA.md §3 — NUNCA un chevron
// rotado (SISTEMA §4.19 lo dice explícito): son un glifo propio, no chevronSvg(±90) disfrazado.
const ICON_TREND_UP = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"></path></svg>`;
const ICON_TREND_DOWN = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v13M6.5 12.5 12 18l5.5-5.5"></path></svg>`;

/** Pantalla «Gasto por categoría»: total del periodo + TODAS las raíces de gasto activas, cada una
 *  desplegable para ver su detalle por subcategoría y poner, cambiar o quitar su límite.
 *  Réplica de docs/design/gasto-por-categoria/Main.dc.html y Limite.dc.html.
 *
 *  El subtítulo de la cabecera es el mismo «{periodo} · día N de M» de Inicio, con los mismos
 *  helpers (dayIndexOfPeriod/expectedPeriodDays de prevision.js): M es la duración nominal de un
 *  mes desde start_date, no la fecha real de cierre del periodo (eso llega con la nómina).
 *
 *  La fila tocable es SOLO la cabecera de cada categoría (un <button> de verdad, hermano de la
 *  barra y del bloque desplegado, nunca su envoltorio): el bloque desplegado contiene a su vez
 *  botones y un input, y un botón dentro de otro es HTML inválido que el navegador desarma (mismo
 *  criterio que categorias.js#rootRowHtml). */
export async function renderGastoPorCategoria(container, onBack) {
  // rootErrors: rootId → mensaje, para la línea roja inline de una raíz cuyo desglose no se pudo
  // leer. Se limpia al volver a intentarlo y al plegar, para que no se quede pegada para siempre.
  const state = { expanded: new Set(), editing: null, editRaw: "", editError: "", rootErrors: new Map() };
  // Cache del desglose por raíz: solo se pide al desplegar, y editar un límite NO cambia el gasto,
  // así que sobrevive a los re-render posteriores a guardar/quitar.
  const childrenByRoot = new Map();
  let period = null;
  let rootRows = [];
  let budgetByCategory = {};
  let byId = {};
  // Comparativa y mini tendencia (N3, Task 14): prevPeriod es el periodo INMEDIATAMENTE anterior
  // (null si este es el primero), cmpByRoot es compareRoots() indexado por root_id y seriesByRoot
  // es spentSeriesByRoot() indexado igual — mismo criterio de índice que informe-logic.js#buildCategories
  // (cmpByRoot), que es de donde se extrajo compareRoots en el Task 6.
  let prevPeriod = null;
  let cmpByRoot = {};
  let seriesByRoot = {};

  async function load() {
    period = await getOpenPeriod();
    if (!period) return false;
    const [rows, budgetRows, cats, history] = await Promise.all([
      spentByRootCategory(period.id),
      budgetsOfPeriod(period.id),
      allCategoriesById(),
      rootSpendHistory(period.id, 3),
    ]);
    rootRows = rows;
    budgetByCategory = budgetMap(budgetRows);
    byId = cats;
    // history: del más antiguo al más reciente, el actual siempre al final (repo.rootSpendHistory).
    // El anterior es el penúltimo elemento; con un único periodo (sin historia previa) no hay
    // penúltimo y la comparativa entera se omite (Step 3: compareRoots con prevRows=[] da
    // direction "new"/deltaPct null en todas las filas, y comparisonLineHtml no pinta nada).
    const hasPrevPeriod = history.length >= 2;
    prevPeriod = hasPrevPeriod ? history[history.length - 2].period : null;
    const prevRows = hasPrevPeriod ? history[history.length - 2].rows : [];
    cmpByRoot = Object.fromEntries(compareRoots(rows, prevRows).map((c) => [c.rootId, c]));
    seriesByRoot = spentSeriesByRoot(history);
    return true;
  }

  /** ¿Esta raíz tiene alguna hija en el árbol? Se mira `byId` (allCategoriesById, que trae TODAS
   *  las categorías vivas) buscando alguna con `parent_id` = la raíz. NO se filtra `is_archived`:
   *  esa columna ni siquiera viene en la consulta, y una hija archivada sigue pudiendo tener
   *  historial. De serie hay cuatro raíces sin hijas (Ropa y cuidado personal, Regalos y
   *  donaciones, Impuestos y tasas, Otros gastos) y el usuario puede crear más. */
  const hasChildren = (rootId) => Object.values(byId).some((c) => c.parent_id === rootId);

  /** Filas del desglose que se pintan: las de gasto distinto de cero, ya ordenadas por el SQL. La
   *  de la propia raíz es el gasto anotado directamente en ella («Sin subcategoría»).
   *
   *  Una raíz SIN hijas no tiene desglose que enseñar: todo su gasto es, por definición, directo,
   *  así que la lista sería una única línea «Sin subcategoría» repitiendo la cifra que está justo
   *  encima. En esas raíces el bloque desplegado se queda solo con la fila de límite (y su modo
   *  edición), que es lo único que aporta algo. */
  function subRowsHtml(rootId) {
    if (!hasChildren(rootId)) return "";
    const rows = (childrenByRoot.get(rootId) ?? []).filter((c) => c.spent_cents !== 0);
    return rows.map((c) => `
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="flex:1;min-width:0;font-size:12.5px;font-weight:600;">${escHtml(c.category_id === rootId ? t("gastoCategoria.detail.noSubcategory") : c.name)}</div>
        <div class="num" style="font-size:12.5px;font-weight:700;white-space:nowrap;">${escHtml(fmtMoney(c.spent_cents))}</div>
      </div>`).join("");
  }

  function limitRowHtml(row, limitCents) {
    const hasLimit = limitCents > 0;
    return `
      <button type="button" data-limit="${escAttr(row.root_id)}"
        style="display:flex;align-items:center;justify-content:space-between;gap:10px;height:30px;width:100%;
        background:none;border:0;padding:0;margin:0;color:inherit;font:inherit;text-align:left;cursor:pointer;
        -webkit-tap-highlight-color:transparent;">
        <span style="font-size:12.5px;font-weight:700;">${hasLimit ? t("gastoCategoria.detail.changeLimit") : t("gastoCategoria.detail.setLimit")}</span>
        <span class="num" style="font-size:11px;color:var(--text-2);">${hasLimit ? t("gastoCategoria.detail.limitOfPeriod", { amount: escHtml(fmtMoney(limitCents)) }) : t("gastoCategoria.detail.noLimit")}</span>
      </button>`;
  }

  function editHtml(row, limitCents) {
    const empty = state.editRaw === "";
    return `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div class="section-title" id="gc-limit-label">${t("gastoCategoria.edit.title", { name: escHtml(row.name) })}</div>
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="position:relative;flex-shrink:0;">
            <input type="number" min="0" step="0.01" inputmode="decimal" id="gc-limit-input" aria-labelledby="gc-limit-label"
              placeholder="${escAttr(t("gastoCategoria.edit.placeholder"))}" value="${escAttr(state.editRaw)}"
              class="budget-input${empty ? " is-empty" : ""}">
            <span class="budget-eur" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);
              font-size:12px;color:var(--text-3);pointer-events:none;display:${empty ? "none" : ""};">${escHtml(currencySymbol())}</span>
          </div>
          <button type="button" id="gc-limit-save" class="btn-primary"
            style="flex:1;width:auto;height:44px;font:700 14px var(--font-ui);">${t("gastoCategoria.edit.save")}</button>
        </div>
        ${state.editError ? `<div style="font-size:11px;color:var(--red);">${escHtml(state.editError)}</div>` : ""}
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div style="font-size:11px;color:var(--text-2);">${t("gastoCategoria.edit.onlyThisPeriod")}</div>
          ${limitCents > 0 ? `<button type="button" id="gc-limit-remove"
            style="height:44px;background:none;border:0;padding:0;font-size:13px;font-weight:600;color:var(--red);
            cursor:pointer;-webkit-tap-highlight-color:transparent;">${t("gastoCategoria.edit.remove")}</button>` : ""}
        </div>
      </div>`;
  }

  function expandedHtml(row, limitCents) {
    const subs = subRowsHtml(row.root_id);
    return `
      <div style="margin:2px 0 4px;background:var(--card2);border-radius:0;padding:10px 12px;
        display:flex;flex-direction:column;gap:10px;">
        ${subs}
        ${subs ? '<hr class="divider">' : ""}
        ${state.editing === row.root_id ? editHtml(row, limitCents) : limitRowHtml(row, limitCents)}
      </div>`;
  }

  /** Línea de comparativa (N3, Task 14, artboard etiquetas-design §8): a la izquierda el nombre del
   *  periodo anterior y su cifra; a la derecha la mini tendencia de 3 periodos (trendSvg) + la
   *  flecha del repertorio §3 (nunca un chevron) + el delta a un decimal — --danger si "up"
   *  (gastó más), --pos si "down" (gastó menos: SISTEMA §4.19, "gastar menos es bueno").
   *  Sin periodo anterior (prevPeriod null) NO se pinta nada (Step 3). Con prevPeriod pero sin un
   *  tercer periodo, trendSvg da igualmente una tendencia — de dos barras, no null (necesita >=2
   *  valores, y aquí hay exactamente 2: anterior y actual). "flat"/"new" no llevan flecha: no hay
   *  "más" ni "menos" que anunciar (flat: mismo gasto exacto; new: no había nada que comparar). */
  function comparisonLineHtml(row) {
    if (!prevPeriod) return "";
    const cmp = cmpByRoot[row.root_id];
    if (!cmp) return "";
    const color = colorForCategory(row.root_id, byId);
    const spark = trendSvg(seriesByRoot[row.root_id] ?? [], color);
    const showArrow = cmp.direction === "up" || cmp.direction === "down";
    const trendColor = cmp.direction === "up" ? "var(--danger)" : cmp.direction === "down" ? "var(--pos)" : "var(--text-2)";
    const arrowIcon = cmp.direction === "up" ? ICON_TREND_UP : cmp.direction === "down" ? ICON_TREND_DOWN : "";
    const deltaText = cmp.deltaPct != null
      ? `${cmp.deltaPct > 0 ? "+" : cmp.deltaPct < 0 ? "−" : ""}${escHtml(fmtPct(Math.abs(cmp.deltaPct) / 100))}`
      : "";
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:1px;">
        <span class="num" style="font-size:11px;color:var(--text-3);">${t("gastoCategoria.compare.prev", { name: escHtml(prevPeriod.name), amount: escHtml(fmtMoney(cmp.prevCents)) })}</span>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          ${spark}
          ${deltaText ? `
          <span style="display:flex;align-items:center;gap:3px;color:${trendColor};">
            ${showArrow ? `<span style="display:flex;" aria-hidden="true">${arrowIcon}</span>` : ""}
            <span class="num" style="font-size:11px;font-weight:700;">${deltaText}</span>
          </span>` : ""}
        </div>
      </div>`;
  }

  function rootRowHtml(row, maxSpent) {
    const limitCents = budgetByCategory[row.root_id] ?? 0;
    const st = budgetStatus(row.spent_cents, limitCents);
    const color = colorForCategory(row.root_id, byId);
    const icon = iconForCategory(row.root_id, byId);
    const expanded = state.expanded.has(row.root_id);
    const noBar = row.spent_cents <= 0;
    // Una raíz sin límite y sin gasto no aporta nada este periodo: se atenúa entera para que la
    // lista completa (12 raíces de serie) no compita con las que sí tienen algo que contar.
    const dim = !st && noBar;

    // Pasado el límite, el exceso va escrito: «450,00 € de 300,00 € · superado por 150,00 €».
    // Solo en 'over' — en ok/warn el número que falta es el que queda, y ese ya sale en el pie de
    // la tarjeta de arriba.
    const sub = st
      ? st.level === "over"
        ? t("gastoCategoria.row.ofLimitOver", {
          spent: escHtml(fmtMoney(row.spent_cents)),
          limit: escHtml(fmtMoney(limitCents)),
          over: escHtml(fmtMoney(row.spent_cents - limitCents)),
        })
        : t("gastoCategoria.row.ofLimit", { spent: escHtml(fmtMoney(row.spent_cents)), limit: escHtml(fmtMoney(limitCents)) })
      : t("gastoCategoria.row.noLimit", { spent: escHtml(fmtMoney(row.spent_cents)) });

    const pctColor = !st ? "var(--text-2)"
      : st.level === "over" ? "var(--red)"
      : st.level === "warn" ? "var(--amber)"
      : textColorForCategory(row.root_id, byId);
    const pctText = st ? fmtPctInt(st.pct) : t("gastoCategoria.row.noPct");

    let barHtml = "";
    if (!noBar && st) {
      const barColor = st.level === "over" ? "var(--red)" : st.level === "warn" ? "var(--amber)" : color;
      barHtml = `<div class="bar" style="--cat:${barColor};"><i style="width:${clampPct(st.pct)}%;"></i></div>`;
    } else if (!noBar) {
      // Sin límite no hay porcentaje que enseñar: la barra pasa a ser comparativa (su gasto frente
      // al de la raíz que más gastó) y se tiñe al 55 % para que no se lea como "vas por X %".
      barHtml = `<div class="bar" style="--cat:color-mix(in srgb, ${color} 55%, transparent);"><i style="width:${relativeWidth(row.spent_cents, maxSpent)}%;"></i></div>`;
    }

    const rootError = state.rootErrors.get(row.root_id);

    // La atenuación de una raíz sin gasto ni límite se queda SOLO en la cabecera y su barra. Antes
    // envolvía toda la fila, y `opacity` crea un grupo de composición: todo lo de dentro se pinta
    // ya fusionado al 50 % y ningún hijo puede recuperarse con opacity:1. Así salían medio
    // borrados el aviso rojo de un desglose que no se pudo cargar y —peor— el editor de límite al
    // desplegar una categoría sin gasto, que es justo el caso más habitual de ponerle uno.
    return `
      <div style="display:flex;flex-direction:column;gap:8px;padding:13px 0;">
        <div style="display:flex;flex-direction:column;gap:8px;${dim ? "opacity:.5;" : ""}">
          <button type="button" data-root="${escAttr(row.root_id)}" aria-expanded="${expanded ? "true" : "false"}"
            style="display:flex;align-items:center;gap:10px;width:100%;background:none;border:0;padding:0;margin:0;
            color:inherit;font:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;">
            <div class="dotico" style="--cat:${color};">${icon}</div>
            <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;">
              <div style="font-size:13.5px;font-weight:600;">${escHtml(row.name)}</div>
              <div class="num" style="font-size:11px;color:var(--text-2);">${sub}</div>
            </div>
            <div class="num" style="font-size:14px;font-weight:700;white-space:nowrap;flex-shrink:0;color:${pctColor};">${pctText}</div>
            <span style="width:44px;height:44px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
              color:${expanded ? "var(--text)" : "var(--text-2)"};">${chevronSvg(expanded ? 90 : 0)}</span>
          </button>
          ${barHtml}
          ${comparisonLineHtml(row)}
        </div>
        ${rootError ? `<div style="font-size:11px;color:var(--red);">${escHtml(rootError)}</div>` : ""}
        ${expanded ? expandedHtml(row, limitCents) : ""}
      </div>`;
  }

  function render() {
    const rows = sortRootRows(rootRows, budgetByCategory);
    const maxSpent = rows.reduce((m, r) => Math.max(m, r.spent_cents), 0);
    // El héroe es el gasto TOTAL categorizado del periodo (suma de TODAS las raíces), no solo el de
    // las que tienen límite: la pantalla ya no va del presupuesto, va del gasto.
    const totalSpent = rows.reduce((s, r) => s + r.spent_cents, 0);
    const lim = limitTotals(rows, budgetByCategory);
    const limPct = pctOf(lim.spent, lim.limit);
    const remaining = lim.limit - lim.spent;

    const remainingSpan = `<span class="num" style="color:var(--green);font-weight:700;">${escHtml(fmtMoney(remaining))}</span>`;
    const overSpan = `<span class="num" style="color:var(--red);font-weight:700;">${escHtml(fmtMoney(-remaining))}</span>`;

    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
        <button type="button" class="icon-btn" id="gc-back" aria-label="${t("common.goBack")}"
          style="width:44px;height:44px;border-radius:50%;background:var(--card);color:var(--text);font-size:18px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"></path></svg></button>
        <div style="display:flex;flex-direction:column;gap:2px;">
          <div style="font-size:20px;font-weight:700;letter-spacing:-0.015em;">${t("gastoCategoria.title")}</div>
          <div style="font-size:11px;color:var(--text-3);">${t("gastoCategoria.header.dayOf", { period: escHtml(period.name), day: dayIndexOfPeriod(period.start_date, hoyISO()), total: expectedPeriodDays(period.start_date) })}</div>
        </div>
      </div>

      <div class="card" style="display:flex;flex-direction:column;gap:12px;margin-bottom:18px;">
        <div style="display:flex;flex-direction:column;gap:5px;">
          <div class="section-title">${t("gastoCategoria.total.title")}</div>
          <div class="amount-hero num">${moneyPartsHtml(totalSpent)}</div>
          ${lim.count > 0 ? `<div class="num" style="font-size:13px;color:var(--text-2);">${t("gastoCategoria.total.withLimit", { n: lim.count, spent: escHtml(fmtMoney(lim.spent)), limit: escHtml(fmtMoney(lim.limit)), pct: fmtPctInt(limPct) })}</div>` : ""}
        </div>
        ${lim.count > 0 ? `
        <div class="bar" style="--cat:var(--text);height:10px;"><i style="width:${clampPct(limPct)}%;"></i></div>
        <div style="font-size:11px;color:var(--text-2);">
          ${remaining >= 0
            ? t("gastoCategoria.total.remaining", { n: lim.count, amount: remainingSpan })
            : t("gastoCategoria.total.over", { n: lim.count, amount: overSpan })}
        </div>` : `
        <div style="font-size:11px;color:var(--text-2);">${t("gastoCategoria.total.noLimits")}</div>`}
      </div>

      <div style="display:flex;flex-direction:column;gap:3px;padding-top:2px;margin-bottom:12px;">
        <div style="font-size:15px;font-weight:700;">${t("gastoCategoria.byCategory.title")}</div>
        <div style="font-size:11px;color:var(--text-3);">${t("gastoCategoria.byCategory.hint")}</div>
      </div>

      ${rows.length === 0 ? `
      <div class="card" style="text-align:center;color:var(--text-3);margin-bottom:16px;">
        <p>${t("gastoCategoria.byCategory.empty")}</p>
      </div>` : `
      <div class="card" style="padding:6px 16px;display:flex;flex-direction:column;margin-bottom:16px;">
        ${rows.map((r) => rootRowHtml(r, maxSpent)).join('<hr class="divider">')}
      </div>`}

      ${prevPeriod ? `
      <div style="font-size:11px;color:var(--text-3);margin:-6px 0 16px;">${t("informe.categories.orientativo", {
        prev: escHtml(prevPeriod.name), current: escHtml(period.name),
        day: dayIndexOfPeriod(period.start_date, hoyISO()), total: expectedPeriodDays(period.start_date),
      })}</div>` : ""}
    `;

    wire();
  }

  /** Cierra el modo edición (al colapsar la raíz que se estaba editando o tras guardar). */
  function closeEdit() {
    state.editing = null;
    state.editRaw = "";
    state.editError = "";
  }

  /** Escribe el límite y vuelve a leer los datos. Dos try SEPARADOS a propósito: si lo que falla es
   *  la RECARGA, el límite ya está guardado y decir «No se pudo guardar el límite» sería mentira —
   *  el usuario volvería a darle a Guardar sobre un dato que ya está en la base. Se muestra
   *  entonces el error de carga de la pantalla, el mismo que su banner de arranque.
   *  Si falla la escritura, el modo edición SE QUEDA abierto con el error debajo del input: el
   *  usuario no pierde lo que había escrito. */
  async function saveLimit(rootId, cents) {
    try {
      if (cents === null) await deleteBudget(period.id, rootId);
      else await upsertBudget(period.id, rootId, cents);
    } catch (e) {
      state.editError = t("gastoCategoria.edit.saveFailed", { error: userMessage(e) });
      render();
      return;
    }
    // Acuse de recibo: al guardar, el bloque desplegado se cierra y la lista vuelve a pintarse
    // parecida — sin esto no se distingue de no haber hecho nada.
    showToast(t(cents === null ? "toast.limitRemoved" : "toast.limitSaved"));
    try {
      // load() a false = ya no hay periodo abierto: otra pestaña lo cerró mientras esta pantalla
      // estaba encima. `period` se queda a null y el render() de abajo reventaría en period.name,
      // así que se sale a la pantalla anterior, que sí sabe qué pintar sin periodo. El límite ya
      // está guardado: no se pierde nada.
      if (!(await load())) { onBack(); return; }
      closeEdit();
    } catch (e) {
      state.editError = t("gastoCategoria.error.load", { error: userMessage(e) });
    }
    render();
  }

  function wire() {
    container.querySelector("#gc-back").onclick = () => onBack();

    container.querySelectorAll("[data-root]").forEach((el) => {
      el.onclick = async () => {
        // Mismo caso que en saveLimit: si otra pestaña cerró el periodo, `period` es null y el
        // spentByChildCategory(period.id, …) de más abajo reventaría con un TypeError crudo.
        if (!period) { onBack(); return; }
        const id = el.dataset.root;
        if (state.expanded.has(id)) {
          state.expanded.delete(id);
          state.rootErrors.delete(id);
          if (state.editing === id) closeEdit();
        } else {
          // Reintentar limpia el error anterior: si vuelve a fallar, se vuelve a poner abajo.
          state.rootErrors.delete(id);
          state.expanded.add(id);
          // Una raíz sin hijas no tiene desglose que pedir (ver subRowsHtml): se despliega
          // directamente con su fila de límite, sin ir a la BD.
          if (hasChildren(id) && !childrenByRoot.has(id)) {
            try {
              childrenByRoot.set(id, await spentByChildCategory(period.id, id));
            } catch (e) {
              // Antes se plegaba en SILENCIO y la pantalla quedaba igual que antes de tocarla: el
              // usuario tocaba, no pasaba nada, y no había forma de saber por qué. Ahora se pliega
              // igual (el bloque desplegado sin datos no aporta nada) pero la fila explica el fallo.
              state.expanded.delete(id);
              state.rootErrors.set(id, t("gastoCategoria.error.detail", { error: userMessage(e) }));
            }
          }
        }
        render();
      };
    });

    container.querySelectorAll("[data-limit]").forEach((el) => {
      el.onclick = () => {
        const id = el.dataset.limit;
        const cents = budgetByCategory[id] ?? 0;
        // Solo una raíz en edición a la vez: abrir una cierra la anterior.
        state.editing = id;
        // El input admite céntimos (step 0.01); se prefiere el valor exacto guardado, sin redondear,
        // para que un «Guardar» sin cambios no reescriba el límite. periodo-nuevo.js sigue capturando euros enteros.
        state.editRaw = cents > 0 ? String(cents / 100) : "";
        state.editError = "";
        render();
        container.querySelector("#gc-limit-input")?.focus();
      };
    });

    // querySelector en singular a propósito: `state.editing` es UN rootId, así que en el DOM
    // solo puede existir un #gc-limit-input. Si algún día se permitieran dos ediciones a la vez,
    // esto cablearía solo la primera en silencio.
    const input = container.querySelector("#gc-limit-input");
    const saveBtn = container.querySelector("#gc-limit-save");

    /** Guarda lo que hay escrito. UNA sola función, compartida por el botón «Guardar» y por el
     *  Enter del teclado: con una copia en cada handler acabarían tratando distinto el campo
     *  vacío. Vacío o 0 equivale a quitar el límite; cualquier otra cosa va a upsertBudget, cuyo
     *  guard rechaza lo que no sea un entero de céntimos > 0 (NaN de un texto, negativos...). */
    const submitLimit = () => {
      if (saveBtn && saveBtn.disabled) return;
      const rootId = state.editing;
      const raw = state.editRaw.trim();
      const cents = raw === "" || Number(raw) === 0 ? null : eurToCents(raw);
      if (saveBtn) saveBtn.disabled = true;
      saveLimit(rootId, cents);
    };

    if (input) {
      input.oninput = (e) => {
        // Sin render(): re-pintar aquí perdería el foco a media escritura (mismo motivo que el
        // handler de [data-budget] en periodo-nuevo.js). Se parchean la clase y el símbolo en sitio.
        state.editRaw = e.target.value;
        const empty = state.editRaw === "";
        input.classList.toggle("is-empty", empty);
        const suffix = input.parentElement.querySelector(".budget-eur");
        if (suffix) suffix.style.display = empty ? "none" : "";
      };
      // El input va suelto (aquí no hay <form>), así que el Enter del teclado no dispara nada por
      // su cuenta: sin esto, en el móvil hay que cerrar el teclado para poder tocar «Guardar».
      input.onkeydown = (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        submitLimit();
      };
    }

    if (saveBtn) saveBtn.onclick = submitLimit;

    const removeBtn = container.querySelector("#gc-limit-remove");
    if (removeBtn) removeBtn.onclick = () => {
      const rootId = state.editing;
      removeBtn.disabled = true;
      saveLimit(rootId, null);
    };
  }

  try {
    if (!(await load())) {
      container.innerHTML = `<div class="banner-aviso red">${t("common.noOpenPeriod")}</div>`;
      return;
    }
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">${t("gastoCategoria.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }
  render();
}
