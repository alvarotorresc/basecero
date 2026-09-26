import {
  getOpenPeriod, spentByRootCategory, spentByChildCategory, budgetsOfPeriod,
  allCategoriesById, upsertBudget, deleteBudget, rootSpendHistory,
} from "../repo.js";
import { familyForCategory, iconForCategory, famClass } from "../category-colors.js";
import { budgetStatus, pctOf, sortRootRows, budgetMap, compareRoots } from "../category-spend.js";
import { eurToCents } from "../contract.js";
import { fmtMoney, hoyISO, currencySymbol, fmtPct } from "../format.js";
import { dayIndexOfPeriod, expectedPeriodDays } from "../prevision.js";
import { t } from "../i18n/index.js";
import { userMessage } from "../errors.js";
import { showToast } from "../toast.js";
import { subHeaderHtml, buttonHtml } from "../ui.js";
import { fieldHtml } from "../controls.js";
import { displayHtml, dispInkHtml, meterHtml } from "../instrument.js";
import { tileHtml } from "../entity.js";
import { icon } from "../icons.js";

import { escHtml, escAttr } from "../esc.js";

// Espacio DURO (U+00A0) antes del %: sin él el porcentaje se parte en dos líneas al estrecharse el
// contenedor. fmtPct de format.js no sirve aquí: emite un decimal ("38,8 %").
const fmtPctInt = (pct) => `${Math.round(pct)} %`;

/** El medidor dentro del botón de cabecera: un <button> solo admite contenido de frase, así que el
 *  <div> de meterHtml pasa a <span> (display:block en screens.css). Mismo HTML, otra etiqueta. */
const meterInline = (o) => meterHtml(o).replace(/^<div/, "<span").replace(/<\/div>$/, "</span>");

/** «Agosto 2026» → «Agosto» (B-GastoCategoria: «Agosto 390,00 €»), solo si quitar el año deja
 *  algo; cualquier otro nombre que escriba el usuario se queda tal cual (mismo criterio que
 *  informe.js#shortName). */
function shortName(name) {
  const s = String(name ?? "").trim();
  const m = s.match(/^(.+?)\s+\d{4}$/);
  return m ? m[1] : s;
}

// Flechas "tendencia sube"/"tendencia baja" del repertorio (icons.js), NUNCA un chevron rotado.
const ICON_TREND_UP = icon("trendUp", { size: 14, width: 2.2 });
const ICON_TREND_DOWN = icon("trendDown", { size: 14, width: 2.2 });
// Aviso de límite (≥ 85 % o superado): el icono de aviso del repertorio, en tinta.
const ICON_WARN = icon("warn", { size: 14 });

/** Pantalla «Gasto por categoría» (B-GastoCategoria): Display con el gasto del periodo, su medidor
 *  frente al presupuesto y la marca del día; debajo, cada raíz de gasto como medidor con nombre,
 *  desplegable en un bloque teñido con sus subcategorías, la comparativa con el periodo anterior y
 *  el límite. Las raíces sin gasto ni límite se resumen en una línea «Sin gasto:» que las despliega.
 *
 *  El subtítulo de la cabecera es el mismo «{periodo}, día N de M» de Inicio, con los mismos
 *  helpers (dayIndexOfPeriod/expectedPeriodDays de prevision.js).
 *
 *  La fila tocable es SOLO la cabecera de cada categoría (un <button> de verdad, hermano del bloque
 *  desplegado, nunca su envoltorio): el bloque desplegado contiene a su vez botones y un input, y
 *  un botón dentro de otro es HTML inválido que el navegador desarma. El bloque desplegado lleva
 *  el anillo naranja de 2 y el filete en la barra de su familia, como el original (F-18 retirada,
 *  Álvaro 2026-09-27: igual que el mockup); el estado lo dice aria-expanded. */
export async function renderGastoPorCategoria(container, onBack) {
  // rootErrors: rootId → mensaje, para la línea inline de una raíz cuyo desglose no se pudo leer.
  // Se limpia al volver a intentarlo y al plegar. showIdle: la línea «Sin gasto:» desplegada.
  // focus: el control al que devolver el foco tras el re-render (K12; innerHTML se lo lleva).
  const state = {
    expanded: new Set(), editing: null, editRaw: "", editError: "", rootErrors: new Map(),
    showIdle: false, focus: null,
  };
  // Cache del desglose por raíz: solo se pide al desplegar, y editar un límite NO cambia el gasto,
  // así que sobrevive a los re-render posteriores a guardar/quitar.
  const childrenByRoot = new Map();
  let period = null;
  let rootRows = [];
  let budgetByCategory = {};
  let byId = {};
  // Comparativa: prevPeriod es el periodo INMEDIATAMENTE anterior (null si este es el primero) y
  // cmpByRoot es compareRoots() indexado por root_id.
  let prevPeriod = null;
  let cmpByRoot = {};

  async function load() {
    period = await getOpenPeriod();
    if (!period) return false;
    const [rows, budgetRows, cats, history] = await Promise.all([
      spentByRootCategory(period.id),
      budgetsOfPeriod(period.id),
      allCategoriesById(),
      rootSpendHistory(period.id, 2),
    ]);
    rootRows = rows;
    budgetByCategory = budgetMap(budgetRows);
    byId = cats;
    // history: del más antiguo al más reciente, el actual siempre al final. hasPrevPeriod
    // explícito en compareRoots: un periodo anterior REAL sin gasto también llega con prevRows=[],
    // y ahí SÍ hay con qué comparar (0 gastado).
    const hasPrevPeriod = history.length >= 2;
    prevPeriod = hasPrevPeriod ? history[history.length - 2].period : null;
    const prevRows = hasPrevPeriod ? history[history.length - 2].rows : [];
    cmpByRoot = Object.fromEntries(compareRoots(rows, prevRows, hasPrevPeriod).map((c) => [c.rootId, c]));
    return true;
  }

  /** ¿Esta raíz tiene alguna hija en el árbol? Se mira `byId` (TODAS las categorías vivas). NO se
   *  filtra `is_archived`: una hija archivada sigue pudiendo tener historial. */
  const hasChildren = (rootId) => Object.values(byId).some((c) => c.parent_id === rootId);
  const limitOf = (rootId) => budgetByCategory[rootId] ?? 0;
  /** Sin gasto (exactamente 0) y sin límite: va a la línea «Sin gasto:». Una raíz con neto
   *  negativo (más devuelto que gastado) o con límite sí tiene algo que contar y va a la lista. */
  const isIdle = (row) => row.spent_cents === 0 && !(limitOf(row.root_id) > 0);

  /** Subcategorías con gasto distinto de cero, ya ordenadas por el SQL, como medidores sobre el
   *  tinte relativos al gasto de la raíz. La fila de la propia raíz es lo anotado directamente en
   *  ella («Sin subcategoría»). Una raíz SIN hijas no tiene desglose: sería una línea repitiendo
   *  la cifra de la cabecera, así que su bloque se queda con la comparativa y el límite. */
  function subRowsHtml(row, fam) {
    if (!hasChildren(row.root_id)) return "";
    const rows = (childrenByRoot.get(row.root_id) ?? []).filter((c) => c.spent_cents !== 0);
    if (!rows.length) return "";
    const max = Math.max(row.spent_cents, ...rows.map((c) => c.spent_cents));
    return `<div class="gc-subs">${rows.map((c) => `
      <div class="gc-sub">
        <div class="gc-sub-line">
          <span class="gc-sub-name">${escHtml(c.category_id === row.root_id ? t("gastoCategoria.detail.noSubcategory") : c.name)}</span>
          <span class="num gc-sub-amt">${escHtml(fmtMoney(c.spent_cents))}</span>
        </div>
        ${meterHtml({ fam, value: c.spent_cents, max, onTint: true })}
      </div>`).join("")}</div>`;
  }

  /** Comparativa con el periodo anterior (B-GastoCategoria): «Agosto 390,00 €» entero en el -x de
   *  la familia, y la flecha del repertorio con el delta a un decimal — --neg si se gastó más,
   *  --pos si menos (C4: señal en cifras). Sin periodo anterior no se pinta nada; "flat"/"new" sin
   *  flecha. Dos hermanos sueltos del pie, como en el original, junto al secundario del límite. */
  function comparisonHtml(row) {
    if (!prevPeriod) return "";
    const cmp = cmpByRoot[row.root_id];
    if (!cmp) return "";
    const dir = cmp.direction === "up" || cmp.direction === "down" ? cmp.direction : "";
    const delta = cmp.deltaPct != null
      ? `<span class="num gc-delta${dir ? ` is-${dir}` : ""}">${dir === "up" ? ICON_TREND_UP : dir === "down" ? ICON_TREND_DOWN : ""}${escHtml(fmtPct(Math.abs(cmp.deltaPct) / 100))}</span>`
      : "";
    return `<span class="gc-cmp">${escHtml(shortName(prevPeriod.name))} <span class="num">${escHtml(fmtMoney(cmp.prevCents))}</span></span>${delta}`;
  }

  function editHtml(row, limitCents) {
    return `
      <div class="gc-edit">
        ${fieldHtml({
          id: "gc-limit-input", label: t("gastoCategoria.edit.title", { name: row.name }), type: "number",
          value: state.editRaw, placeholder: t("gastoCategoria.edit.placeholder"), inputmode: "decimal",
          min: "0", step: "0.01", suffix: currencySymbol(),
        })}
        ${state.editError ? `<p class="gc-error" role="alert">${escHtml(state.editError)}</p>` : ""}
        ${buttonHtml({ kind: "primary", id: "gc-limit-save", label: t("gastoCategoria.edit.save") })}
        <div class="gc-edit-foot">
          <span class="gc-edit-note">${escHtml(t("gastoCategoria.edit.onlyThisPeriod"))}</span>
          ${limitCents > 0 ? buttonHtml({ kind: "tertiary-danger", id: "gc-limit-remove", label: t("gastoCategoria.edit.remove") }) : ""}
        </div>
      </div>`;
  }

  /** Cabecera de una raíz: baldosa 32 · nombre y cifra · medidor (límite como marca de 2 px) · pie
   *  con el límite o el exceso · chevron. Desplegada va sobre el tinte (baldosa y pista en --chip,
   *  nombre 700 y cifra 17/600). */
  function headHtml(row, fam, scaleMax, expanded) {
    const limitCents = limitOf(row.root_id);
    // Mismo umbral de siempre (budgetStatus: warn >= 85 %, over > 100 %), sin ámbar: el aviso es
    // texto en tinta con el icono de aviso; solo la cifra superada va en --neg (C4, «−» que avisa).
    const st = budgetStatus(row.spent_cents, limitCents);
    let foot = "";
    if (st?.level === "over") {
      const over = escHtml(fmtMoney(row.spent_cents - limitCents));
      const text = escHtml(t("gastoCategoria.row.overBy", { over: fmtMoney(row.spent_cents - limitCents) }))
        .replace(over, `<span class="num gc-over">${over}</span>`);
      foot = `<span class="gc-foot is-alert">${ICON_WARN}<span>${text}</span></span>`;
    } else if (st?.level === "warn") {
      foot = `<span class="gc-foot is-alert">${ICON_WARN}<span>${escHtml(t("gastoCategoria.row.nearLimit", { pct: fmtPctInt(st.pct), limit: fmtMoney(limitCents) }))}</span></span>`;
    } else if (st) {
      // «límite 350,00 €» con la cifra en mono, como el original.
      const lim = escHtml(fmtMoney(limitCents));
      const text = escHtml(t("gastoCategoria.row.limit", { limit: fmtMoney(limitCents) }))
        .replace(lim, `<span class="num">${lim}</span>`);
      foot = `<span class="gc-foot">${text}</span>`;
    }
    return `
      <button type="button" class="gc-head" data-root="${escAttr(row.root_id)}" aria-expanded="${expanded ? "true" : "false"}">
        ${tileHtml({ fam, icon: iconForCategory(row.root_id, byId), size: 32, onTint: expanded })}
        <span class="gc-main">
          <span class="gc-line">
            <span class="gc-name">${escHtml(row.name)}</span>
            <span class="num gc-amt">${escHtml(fmtMoney(row.spent_cents))}</span>
          </span>
          ${meterInline({ fam, value: row.spent_cents, max: scaleMax, limit: limitCents > 0 ? limitCents : null, onTint: expanded })}
          ${foot}
        </span>
        <span class="gc-chev" aria-hidden="true">${icon(expanded ? "chevronDown" : "chevronRight", { size: 16 })}</span>
      </button>`;
  }

  function itemHtml(row, scaleMax) {
    const fam = familyForCategory(row.root_id, byId);
    const expanded = state.expanded.has(row.root_id);
    const rootError = state.rootErrors.get(row.root_id);
    const idle = isIdle(row) ? " is-idle" : "";
    if (!expanded) {
      return `<div class="gc-item${idle}">${headHtml(row, fam, scaleMax, false)}${rootError ? `<p class="gc-error" role="alert">${escHtml(rootError)}</p>` : ""}</div>`;
    }
    const limitCents = limitOf(row.root_id);
    const editing = state.editing === row.root_id;
    return `
      <div class="gc-item gc-block ${famClass(fam)}">
        ${headHtml(row, fam, scaleMax, true)}
        ${subRowsHtml(row, fam)}
        ${editing ? editHtml(row, limitCents) : `
        <div class="gc-block-foot">
          ${comparisonHtml(row)}
          ${buttonHtml({ kind: "secondary", size: "s", id: `gc-limit-btn-${row.root_id}`, label: limitCents > 0 ? t("gastoCategoria.detail.changeLimit") : t("gastoCategoria.detail.setLimit") })}
        </div>`}
      </div>`;
  }

  /** «Sin gasto: Coche, Impuestos, Regalos» (B-GastoCategoria): una línea dim con una muestra por
   *  familia. Es un botón: despliega esas raíces en la lista para poder ponerles límite (antes
   *  eran filas atenuadas; es el caso más habitual de poner uno). */
  function idleLineHtml(idleRows) {
    if (!idleRows.length) return "";
    // Tres nombres como mucho y «y N más»: con las 12 raíces la línea ocupaba 4+ renglones. El
    // botón sigue desplegando todas.
    const names = idleRows.slice(0, 3).map((r) => r.name).join(", ");
    const rest = idleRows.length - 3;
    // Como mucho tres muestras (B-GastoCategoria): con más, la fila de muestras se come la línea.
    const swatches = idleRows.slice(0, 3).map((r) => `<span class="gc-idle-swatch ${famClass(familyForCategory(r.root_id, byId))}"></span>`).join("");
    return `
      <button type="button" class="gc-idle" id="gc-idle" aria-expanded="${state.showIdle ? "true" : "false"}">
        <span class="gc-idle-swatches" aria-hidden="true">${swatches}</span>
        <span class="gc-idle-text">${escHtml(rest > 0 ? t("gastoCategoria.noSpendMore", { names, n: rest }) : t("gastoCategoria.noSpend", { names }))}</span>
        <span class="gc-chev" aria-hidden="true">${icon(state.showIdle ? "chevronDown" : "chevronRight", { size: 16 })}</span>
      </button>`;
  }

  function render() {
    const rows = sortRootRows(rootRows, budgetByCategory);
    // Una raíz sin gasto que se ha desplegado ya está en la lista: no se repite en «Sin gasto:».
    const idleRows = rows.filter((r) => isIdle(r) && !state.expanded.has(r.root_id));
    const listed = rows.filter((r) => !isIdle(r) || state.showIdle || state.expanded.has(r.root_id));
    // Una sola escala para toda la lista: la mayor entre gasto y límite, así ninguna marca de
    // límite se sale de su pista.
    const scaleMax = listed.reduce((m, r) => Math.max(m, r.spent_cents, limitOf(r.root_id)), 0);
    // El héroe es el gasto TOTAL categorizado del periodo (suma de TODAS las raíces).
    const totalSpent = rows.reduce((s, r) => s + r.spent_cents, 0);
    // El presupuesto GENERAL del periodo es la suma de TODOS los budgetsOfPeriod.
    const budgetTotalCents = Object.values(budgetByCategory).reduce((s, c) => s + c, 0);
    const day = dayIndexOfPeriod(period.start_date, hoyISO());
    const days = expectedPeriodDays(period.start_date);
    const dayFrac = days > 0 ? Math.min(1, Math.max(0, day / days)) : 0;

    // Pasado el 75 % del periodo, «día N» caería encima del % de la derecha: el % pasa a la izquierda.
    const gauge = budgetTotalCents > 0 ? `
      <div class="gc-gauge${dayFrac > 0.75 ? " is-late" : ""}" style="--at:${Number((dayFrac * 100).toFixed(2))}%">
        ${meterHtml({ value: totalSpent, max: budgetTotalCents, limit: budgetTotalCents * dayFrac, onDisplay: true })}
        <div class="gc-gauge-scale">
          <span class="num gc-daymark">${escHtml(t("gastoCategoria.total.dayMark", { day }))}</span>
          <span class="num gc-pct">${escHtml(fmtPctInt(pctOf(totalSpent, budgetTotalCents)))}</span>
        </div>
      </div>` : "";

    // Divisor entre dos filas plegadas seguidas; un bloque desplegado ya se separa por su tinte.
    const items = listed.map((r, i) => {
      const prevOpen = i > 0 && state.expanded.has(listed[i - 1].root_id);
      const div = i > 0 && !prevOpen && !state.expanded.has(r.root_id) ? '<div class="gc-div" aria-hidden="true"></div>' : "";
      return div + itemHtml(r, scaleMax);
    }).join("");

    container.innerHTML = `
      <div class="gc">
        ${subHeaderHtml({ id: "gc-back", title: t("gastoCategoria.title"), subtitle: t("gastoCategoria.header.dayOf", { period: shortName(period.name), day, total: days }) })}
        ${displayHtml({
          label: t("gastoCategoria.total.title"), value: fmtMoney(totalSpent), size: "l",
          ...(budgetTotalCents > 0
            ? { footHtml: t("gastoCategoria.total.ofBudget", { budget: dispInkHtml(fmtMoney(budgetTotalCents)) }), slot: gauge }
            : { foot: t("gastoCategoria.total.noLimits") }),
        })}
        ${rows.length === 0
          ? `<p class="gc-empty">${escHtml(t("gastoCategoria.byCategory.empty"))}</p>`
          : `${listed.length ? `<section class="gc-list" aria-label="${escAttr(t("gastoCategoria.byCategory.title"))}">${items}</section>` : ""}
             ${idleLineHtml(idleRows)}`}
      </div>`;

    wire();
  }

  /** Cierra el modo edición (al colapsar la raíz que se estaba editando o tras guardar). */
  function closeEdit() {
    state.editing = null;
    state.editRaw = "";
    state.editError = "";
  }

  /** Escribe el límite y vuelve a leer los datos. Dos try SEPARADOS a propósito: si lo que falla es
   *  la RECARGA, el límite ya está guardado y decir «No se pudo guardar el límite» sería mentira.
   *  Se muestra entonces el error de carga de la pantalla.
   *  Si falla la escritura, el modo edición SE QUEDA abierto con el error: no se pierde lo escrito. */
  async function saveLimit(rootId, cents) {
    try {
      if (cents === null) await deleteBudget(period.id, rootId);
      else await upsertBudget(period.id, rootId, cents);
    } catch (e) {
      state.editError = t("gastoCategoria.edit.saveFailed", { error: userMessage(e) });
      state.focus = "#gc-limit-input";
      render();
      return;
    }
    // Acuse de recibo: sin esto no se distingue de no haber hecho nada.
    showToast(t(cents === null ? "toast.limitRemoved" : "toast.limitSaved"));
    try {
      // load() a false = ya no hay periodo abierto: otra pestaña lo cerró. Se sale a la pantalla
      // anterior, que sí sabe qué pintar sin periodo. El límite ya está guardado.
      if (!(await load())) { onBack(); return; }
      closeEdit();
      state.focus = `[data-root="${rootId}"]`;
    } catch (e) {
      state.editError = t("gastoCategoria.error.load", { error: userMessage(e) });
    }
    render();
  }

  function wire() {
    container.querySelector("#gc-back").onclick = () => onBack();

    const idleBtn = container.querySelector("#gc-idle");
    if (idleBtn) idleBtn.onclick = () => {
      state.showIdle = !state.showIdle;
      state.focus = "#gc-idle";
      render();
    };

    container.querySelectorAll("[data-root]").forEach((el) => {
      el.onclick = async () => {
        // Si otra pestaña cerró el periodo, `period` es null y spentByChildCategory reventaría.
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
          // Una raíz sin hijas no tiene desglose que pedir: se despliega sin ir a la BD.
          if (hasChildren(id) && !childrenByRoot.has(id)) {
            try {
              childrenByRoot.set(id, await spentByChildCategory(period.id, id));
            } catch (e) {
              // Se pliega (el bloque sin datos no aporta nada) pero la fila explica el fallo.
              state.expanded.delete(id);
              state.rootErrors.set(id, t("gastoCategoria.error.detail", { error: userMessage(e) }));
            }
          }
        }
        state.focus = `[data-root="${id}"]`;
        render();
      };
    });

    container.querySelectorAll('[id^="gc-limit-btn-"]').forEach((el) => {
      el.onclick = () => {
        const id = el.id.slice("gc-limit-btn-".length);
        const cents = limitOf(id);
        // Solo una raíz en edición a la vez: abrir una cierra la anterior.
        state.editing = id;
        // El input admite céntimos (step 0.01); se prefiere el valor exacto guardado, sin redondear,
        // para que un «Guardar» sin cambios no reescriba el límite.
        state.editRaw = cents > 0 ? String(cents / 100) : "";
        state.editError = "";
        state.focus = "#gc-limit-input";
        render();
      };
    });

    // querySelector en singular a propósito: `state.editing` es UN rootId, así que solo puede
    // existir un #gc-limit-input.
    const input = container.querySelector("#gc-limit-input");
    const saveBtn = container.querySelector("#gc-limit-save");

    /** Guarda lo que hay escrito. UNA sola función para «Guardar» y para el Enter del teclado.
     *  Vacío o 0 equivale a quitar el límite; lo demás va a upsertBudget, cuyo guard rechaza lo
     *  que no sea un entero de céntimos > 0. */
    const submitLimit = () => {
      if (saveBtn && saveBtn.disabled) return;
      const rootId = state.editing;
      const raw = state.editRaw.trim();
      const cents = raw === "" || Number(raw) === 0 ? null : eurToCents(raw);
      if (saveBtn) saveBtn.disabled = true;
      saveLimit(rootId, cents);
    };

    if (input) {
      // Sin render(): re-pintar aquí perdería el foco a media escritura. La unidad se oculta sola
      // con el campo vacío (controls.js#fieldHtml, :placeholder-shown).
      input.oninput = (e) => { state.editRaw = e.target.value; };
      // Sin <form>, el Enter del teclado no dispara nada por su cuenta.
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

    // K12: el innerHTML se lleva el foco al <body>; se devuelve al control que lo tenía.
    if (state.focus) {
      const sel = state.focus;
      state.focus = null;
      container.querySelector(sel)?.focus();
    }
  }

  try {
    if (!(await load())) {
      container.innerHTML = `<div class="banner-aviso is-error">${t("common.noOpenPeriod")}</div>`;
      return;
    }
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso is-error">${t("gastoCategoria.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }
  render();
}
