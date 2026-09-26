import {
  getOpenPeriod, spentOfPeriod, incomeOfPeriod, listAllByDay, spentByRootCategory, budgetsOfPeriod,
  openNextPeriod, getMetaAll, goalsWithProgress, listAllAccounts, defaultAccountId, accountBalanceCents,
} from "../repo.js";
import { familyForCategory, iconForCategory } from "../category-colors.js";
import { eurToCents } from "../contract.js";
import {
  fmtMoney, moneyPartsHtml, fmtDiaCorto, fmtDiaIni, hoyISO, prevDayIso, nombrePorDefecto, fmtPct,
  currencySymbol, centsToRaw, parseCentsRaw,
} from "../format.js";
import { t } from "../i18n/index.js";
import { PCT_STEP, stepPct, normalizePct } from "../share-pct.js";
import { inheritedBudgetsRaw, budgetMap } from "../category-spend.js";
import { remainderCents, sweepDestinations, sweepPlan } from "../barrido.js";
import { renderInforme } from "./informe.js";
import { userMessage } from "../errors.js";
import { subHeaderHtml, buttonHtml, metaHtml } from "../ui.js";
import { stepperHtml, fieldHtml } from "../controls.js";
import { settingRowHtml, sectionHeaderHtml } from "../entity.js";
import { displayHtml, dispInkHtml, stackedBarHtml, meterHtml } from "../instrument.js";
import { escHtml, escAttr } from "../esc.js";

// Ventana de días seleccionables del picker de fecha (±2 alrededor de hoy, P1 abierto: la
// sugerencia es siempre hoy, nunca un «día de cobro» fijo — ver Omite del brief S11).
const DAY_WINDOW = 2;

function addDaysIso(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE");
}
function dayCandidates() {
  const today = hoyISO();
  return Array.from({ length: DAY_WINDOW * 2 + 1 }, (_, i) => addDaysIso(today, i - DAY_WINDOW));
}

/** Día seleccionable (B-PeriodoNuevo): botón con el patrón de selección «sobre neutro» del sistema
 *  (relleno de acento, C1) vía `aria-pressed` — no `role=radio`/`aria-checked`: R-C1 solo permite
 *  pintar naranja detrás de `[aria-pressed="true"]`, `[aria-selected="true"]` o `:checked`, igual
 *  que entity.js#pickTileHtml para la baldosa de categoría. */
function dayTileHtml(iso, selected) {
  const day = Number(iso.slice(8, 10));
  return `<button type="button" class="pn-day" aria-pressed="${selected ? "true" : "false"}" data-day="${escAttr(iso)}">
    <span class="pn-day-dow">${escHtml(fmtDiaIni(iso))}</span>
    <span class="num pn-day-num">${day}</span>
  </button>`;
}

/** Pantalla de error con recuperación: quien llama ya puso `body.onboarding` (chrome oculto,
 *  nav() bloqueado — ver main.js), así que un simple banner sin salida deja a quien lo use
 *  atrapado. "Reintentar" vuelve a montar la pantalla entera; "Volver" (solo en modo 'next',
 *  donde SÍ hay algo a lo que volver sin haber creado nada) llama a onDone() como cancelación. */
function renderAsistenteError(container, { mode, onDone, onBack, embed, initialSharePct }, message) {
  container.innerHTML = `
    <div class="banner-aviso is-error">${escHtml(message)}</div>
    <div class="pn-error-actions">
      ${buttonHtml({ kind: "primary", id: "pn-error-retry", label: t("common.retry") })}
      ${mode === "next" ? buttonHtml({ id: "pn-error-back", label: t("common.goBack") }) : ""}
    </div>`;
  container.querySelector("#pn-error-retry").onclick =
    () => renderPeriodoNuevo(container, { mode, onDone, onBack, embed, initialSharePct });
  const back = container.querySelector("#pn-error-back");
  if (back) back.onclick = () => (onBack ?? onDone)();
}

/** Pantalla única (sin tab bar, flecha atrás) para abrir un periodo nuevo: en modo 'next'
 *  cierra el periodo abierto (bloque "Cierras X" con su resumen) y en modo 'first' solo crea
 *  el primero (onboarding, sin nada que cerrar). Presupuestos por categoría RAÍZ de gasto:
 *  spentByRootCategory('' ) en modo 'first' no matchea ningún period_id → devuelve todas las
 *  raíces con spent_cents=0 (mismo LEFT JOIN, sin fila cerrada de la que tirar "mes pasado").
 *  onDone() se llama tanto al abrir con éxito como al cancelar con la flecha atrás (modo 'next').
 *  `initialSharePct` (solo modo 'first', S13): el reparto que el onboarding ya pidió en su paso
 *  Ajustes, para que el paso a paso de aquí arranque en él y no en el 50 de siempre. */
export async function renderPeriodoNuevo(container, { mode, onDone, onBack, embed = false, initialSharePct }) {
  let closingPeriod = null, closingSpent = 0, closingIncome = 0, closingCount = 0, rootRows = [], meta = {};
  let closingBudgets = [];
  // Barrido (N4): goals con progreso, cuentas vivas y la cuenta de origen por defecto — solo hace
  // falta en modo 'next' (bloqueBarrido() más abajo).
  let goalsProgress = [], allAccounts = [], sourceAccountId = "", sourceBalanceCents = 0;
  try {
    if (mode === "next") {
      closingPeriod = await getOpenPeriod();
      if (!closingPeriod) {
        renderAsistenteError(container, { mode, onDone, onBack, embed, initialSharePct }, t("periodo.error.noOpenToClose"));
        return;
      }
      const [spent, income, all, roots, budgetRows, metaAll, goals, accounts, defaultAccId] = await Promise.all([
        spentOfPeriod(closingPeriod.id),
        incomeOfPeriod(closingPeriod.id),
        listAllByDay(closingPeriod.id),
        spentByRootCategory(closingPeriod.id),
        budgetsOfPeriod(closingPeriod.id),
        getMetaAll(),
        goalsWithProgress(),
        listAllAccounts(),
        defaultAccountId(),
      ]);
      closingSpent = spent; closingIncome = income; closingCount = all.length; rootRows = roots;
      closingBudgets = budgetRows; meta = metaAll;
      goalsProgress = goals; allAccounts = accounts; sourceAccountId = defaultAccId || "";
      if (sourceAccountId) sourceBalanceCents = await accountBalanceCents(sourceAccountId, hoyISO());
    } else {
      [rootRows, meta] = await Promise.all([spentByRootCategory(""), getMetaAll()]);
    }
  } catch (e) {
    renderAsistenteError(container, { mode, onDone, onBack, embed, initialSharePct }, t("periodo.error.load", { error: userMessage(e) }));
    return;
  }
  const partnerName = (meta.partner_name || "").trim();
  const accountsById = Object.fromEntries(allAccounts.map((a) => [a.id, a]));

  // byId "de mentira" solo con lo que familyForCategory/iconForCategory necesitan (rootOf sube
  // por parent_id hasta encontrar la raíz): como root_id YA es una raíz, basta con parent_id=''.
  const byId = Object.fromEntries(rootRows.map((r) => [r.root_id, { id: r.root_id, parent_id: "" }]));

  // El periodo nuevo arranca con los límites del que se cierra, rellenados y editables: vaciar un
  // campo vuelve a dejar esa categoría sin límite (el submit ya salta los vacíos). En modo 'first'
  // no hay periodo previo del que heredar nada.
  const inherited = mode === "next" ? inheritedBudgetsRaw(closingBudgets, rootRows) : {};

  // Barrido (N4): el remanente del periodo que se cierra (mismo criterio que "Disponible del
  // periodo" de Inicio) y los destinos elegibles a la cuenta de origen por defecto. No se pinta
  // si el remanente es 0, si no hay ningún destino elegible, o si el saldo de origen es ≤ 0 (D10).
  const closingBudgetTotalCents = Object.values(budgetMap(closingBudgets)).reduce((s, c) => s + c, 0);
  const remainder = mode === "next"
    ? remainderCents({ budgetTotalCents: closingBudgetTotalCents, incomeCents: closingIncome, spentCents: closingSpent })
    : { cents: 0, basis: "income" };
  // Funciones, no consts: el saldo de origen (state.sourceBalanceCents) cambia si el usuario mueve
  // la fecha de inicio, así que los destinos elegibles hay que recalcularlos en cada render(), no
  // fijarlos una vez con el saldo inicial.
  function currentDestinations() {
    return remainder.cents > 0 && state.sourceBalanceCents > 0
      ? sweepDestinations(goalsProgress, accountsById, remainder.cents, state.sourceAccountId)
      : [];
  }
  function currentShowBarrido() {
    return mode === "next" && remainder.cents > 0 && state.sourceBalanceCents > 0 && currentDestinations().length > 0;
  }
  // Destinos con el saldo de origen INICIAL, solo para precargar sweepChoice antes de que exista
  // `state` (currentDestinations() ya podría usarse después, una vez `state` está construido).
  const initialDestinations = remainder.cents > 0 && sourceBalanceCents > 0
    ? sweepDestinations(goalsProgress, accountsById, remainder.cents, sourceAccountId)
    : [];

  const state = {
    startDate: hoyISO(),
    name: nombrePorDefecto(),
    sharePct: mode === "next" ? closingPeriod.my_share_pct : normalizePct(initialSharePct, 50),
    budgets: { ...inherited }, // rootId -> string en euros tal cual lo escribe el usuario ("" = sin límite)
    // Una raíz con límite heredado TIENE que estar visible: totalPresupuestadoCents suma todo lo
    // que haya en state.budgets, así que una fila oculta metería en el «Presupuestado» del pie un
    // importe que el usuario no ve, no puede editar y no puede quitar. Las que ya salían por tener
    // gasto siguen saliendo.
    visible: new Set([
      ...rootRows.filter((r) => r.spent_cents > 0).map((r) => r.root_id),
      ...Object.keys(inherited),
    ]),
    addOpen: false,
    saving: false,
    // Selector de fecha (B-PeriodoNuevo): «Otra fecha» revela el campo nativo aunque la fecha
    // elegida siga dentro de la ventana de días (bloqueFecha() también lo revela sola si
    // startDate cae fuera de la ventana, p. ej. al volver a montar la pantalla).
    showCustomDate: false,
    // Barrido: preseleccionado el primero (más cerca de cumplirse, spec §9.4); precargado con el
    // remanente entero. sourceAccountId/sourceBalanceCents viven en el state porque la fecha de
    // inicio puede cambiar el saldo de origen (la transferencia lleva esa fecha).
    sweepChoice: initialDestinations[0]?.goalId ?? "keep",
    // La anatomía de importe del sistema es SIEMPRE `type="text" inputmode="decimal"` +
    // parseCentsRaw, nunca `type="number"`: con coma decimal, un <input type="number"> rechaza el
    // valor en silencio y el campo se ve vacío.
    sweepAmountRaw: centsToRaw(remainder.cents),
    sourceAccountId,
    sourceBalanceCents,
    // D11: "Ingresos previstos" del primer periodo — efímero, solo en modo 'first'. Misma
    // anatomía que #pn-sweep-amount (texto + parseCentsRaw), nunca se manda a openNextPeriod.
    expectedIncomeRaw: "",
  };
  let errorMsg = "";

  /** Categorías con un límite válido (>0) tecleado, con su familia y su importe en céntimos: base
   *  de totalPresupuestadoCents() y de la barra apilada de bloqueTotal() (una sola fuente). */
  function budgetSegments() {
    return rootRows.filter((r) => state.visible.has(r.root_id)).flatMap((r) => {
      const raw = state.budgets[r.root_id];
      if (raw === "" || raw == null) return [];
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return [];
      return [{ fam: familyForCategory(r.root_id, byId), name: r.name, value: eurToCents(raw) }];
    });
  }
  function totalPresupuestadoCents() {
    return budgetSegments().reduce((s, seg) => s + seg.value, 0);
  }

  /** Ingresos que alimentan la barra/nota de "Presupuestado" (D11): en modo 'next' es
   *  closingIncome, ya conocido; en 'first' es el importe efímero que el usuario teclea —
   *  null mientras esté vacío o a 0, que es lo que hoy ya apaga la barra y la nota. */
  function currentIngresos() {
    if (mode === "next") return closingIncome;
    const cents = parseCentsRaw(state.expectedIncomeRaw);
    return cents > 0 ? cents : null;
  }

  /** Barra apilada de "Presupuestado" (C6, C12): un segmento por categoría con límite, en su
   *  familia, más un segmento gris (--idle) con lo que queda sin asignar de los ingresos. Sin
   *  ingresos conocidos no hay barra que dibujar (mismo criterio que antes con la barra plana). */
  function budgetBarHtml(presupuestado, ingresos) {
    if (ingresos == null) return "";
    const segs = budgetSegments().map(({ fam, name, value }) => ({ fam, name, value }));
    const unassigned = ingresos - presupuestado;
    if (unassigned > 0) segs.push({ fam: null, name: t("periodo.total.unassigned"), value: unassigned });
    return stackedBarHtml(segs, { size: 8, legend: false, label: t("periodo.total.budgetedTitle") });
  }

  function notaSinAsignarHtml(sinAsignar) {
    return sinAsignar >= 0
      ? t("periodo.total.remaining", { amount: `<span class="num pn-note-amount">${escHtml(fmtMoney(sinAsignar))}</span>` })
      : t("periodo.total.over", { amount: `<span class="num pn-note-amount is-over">${escHtml(fmtMoney(-sinAsignar))}</span>` });
  }

  /** Actualiza SOLO el total/barra/nota tras editar un importe, sin re-renderizar toda la
   *  pantalla: un render() completo en cada tecleo destruiría el input que tiene el foco (y
   *  cualquier otro que el usuario esté a punto de tocar), tragándose el toque siguiente. */
  function patchTotal() {
    const presupuestado = totalPresupuestadoCents();
    const presupEl = container.querySelector("#pn-presupuestado");
    if (presupEl) presupEl.innerHTML = moneyPartsHtml(presupuestado);
    // D11: en modo 'first' la barra/nota nacen ocultas (bloqueTotal) porque ingresos empieza a
    // null — pero el <div> SIGUE en el DOM, para que teclear el primer dígito de "Ingresos
    // previstos" pueda mostrarlas con un patch, sin el render() completo que le robaría el foco.
    const ingresos = currentIngresos();
    const barWrapEl = container.querySelector("#pn-total-bar-wrap");
    const notaEl = container.querySelector("#pn-nota");
    if (barWrapEl && notaEl) {
      barWrapEl.classList.toggle("is-visible", ingresos != null);
      notaEl.classList.toggle("is-visible", ingresos != null);
      if (ingresos != null) {
        barWrapEl.innerHTML = budgetBarHtml(presupuestado, ingresos);
        notaEl.innerHTML = notaSinAsignarHtml(ingresos - presupuestado);
      }
    }
  }

  /** Actualiza SOLO el aviso de tope y el «quedaría en X» de cada destino tras teclear en
   *  «Cantidad a barrer» — mismo criterio que patchTotal(): un render() completo por tecla
   *  destruiría el input con el foco (comentario de referencia arriba). */
  function patchSweepPreview() {
    if (!currentShowBarrido()) return;
    const plan = sweepPlan({ rawAmount: state.sweepAmountRaw, sourceBalanceCents: state.sourceBalanceCents });
    const cappedEl = container.querySelector("#pn-sweep-capped");
    if (cappedEl) {
      cappedEl.classList.toggle("is-visible", plan.capped);
      cappedEl.textContent = plan.capped
        ? t("barrido.capped", { amount: fmtMoney(plan.amountCents), account: accountsById[state.sourceAccountId]?.name ?? "" })
        : "";
    }
    const liveDestinations = sweepDestinations(goalsProgress, accountsById, plan.amountCents, state.sourceAccountId);
    for (const d of liveDestinations) {
      const line = container.querySelector(`[data-sweep-afterline="${d.goalId}"]`);
      // innerHTML, no textContent: sweepAfterLineText devuelve el HTML de metaHtml (el divisor de
      // 1px), no una cadena plana.
      if (line) line.innerHTML = sweepAfterLineText(d);
    }
  }

  // Cabecera con atrás (DESIGN.md §9): título a la izquierda con subtítulo — en modo 'next' con
  // el nombre del periodo que se cierra (periodo.header.closing); en 'first' no hay periodo que
  // cerrar (periodo.header.first).
  function bloqueHeader() {
    // "Cierras {name} y abres {next}" (B-PeriodoNuevo): {next} es el mismo nombre que ya calcula
    // dateTitle() más abajo (el campo Nombre si se tocó, si no el de nombrePorDefecto()) — nunca un
    // "el siguiente" genérico. Sin lógica nueva: reutiliza el valor que la pantalla ya conoce.
    const subtitle = mode === "next"
      ? t("periodo.header.closing", { name: closingPeriod.name, next: state.name.trim() || nombrePorDefecto() })
      : t("periodo.header.first");
    return subHeaderHtml({
      id: mode === "next" || onBack ? "pn-back" : null,
      title: t("periodo.header.title"),
      subtitle,
    });
  }

  /** El Display del cierre (F-13, F-02: --pos sin brillo fuera del Display no aplica aquí, no hay
   *  cifra de ingreso suelta): "{name} ahorró" con el pie de 3 datos (Ingresos/Gastado/Movimientos)
   *  en --disp-ink, que antes vivía en una tarjeta de rejilla 2×2 aparte. Solo en modo 'next': en
   *  'first' no hay periodo cerrado del que enseñar ahorro. */
  function bloqueDisplay() {
    if (mode !== "next") return "";
    const ahorrado = closingIncome - closingSpent;
    const tasa = closingIncome > 0 ? fmtPct(ahorrado / closingIncome) : "—";
    const rangeEnd = prevDayIso(state.startDate || hoyISO());
    const rangeLabel = `${fmtDiaCorto(closingPeriod.start_date)} – ${fmtDiaCorto(rangeEnd)}`;
    const filas = [
      [t("periodo.closing.income"), fmtMoney(closingIncome)],
      [t("periodo.closing.spent"), fmtMoney(closingSpent)],
      [t("periodo.closing.count"), String(closingCount)],
    ];
    return displayHtml({
      label: t("periodo.closing.saved", { name: closingPeriod.name }),
      value: fmtMoney(ahorrado),
      size: 48, // B-PeriodoNuevo (medido en el mockup): 48px, no el "l" de 44 de las demás subpantallas.
      aside: rangeLabel,
      footHtml: t("periodo.closing.savedPct", { pct: dispInkHtml(tasa) }),
      slot: `<div class="pn-closing-grid">${filas.map(([label, value]) => `<div class="pn-closing-item">
        <span class="pn-closing-label">${escHtml(label)}</span>
        <span class="num disp-ink pn-closing-value">${escHtml(value)}</span>
      </div>`).join("")}</div>`,
    });
  }

  /** Fila de un destino elegible (N4): tarjeta con borde de acento cuando está elegida (K3: el
   *  naranja solo por CSS, nunca leído aquí — el radio real es lo que dispara el borde con
   *  `input:checked + .pn-sweep-tile`, ver screens.css). */
  function barridoDestinoHtml(d) {
    const checked = state.sweepChoice === d.goalId;
    const hasTarget = d.targetCents > 0;
    return `
    <label class="pn-sweep-row">
      <input type="radio" name="pn-sweep-dest" class="pn-sweep-radio" value="${escAttr(d.goalId)}" ${checked ? "checked" : ""}>
      <span class="pn-sweep-tile">
        <span class="pn-sweep-head">
          <span class="pn-sweep-name">${t("barrido.toGoal", { name: escHtml(d.name) })}</span>
          <span class="num pn-sweep-amt">${escHtml(fmtMoney(d.currentCents))}${hasTarget ? ` / ${escHtml(fmtMoney(d.targetCents))}` : ""}</span>
        </span>
        ${hasTarget ? meterHtml({ value: d.currentCents, max: d.targetCents }) : ""}
        <span class="num pn-sweep-after" data-sweep-afterline="${escAttr(d.goalId)}">${sweepAfterLineText(d)}</span>
      </span>
    </label>`;
  }

  // metaHtml (no prosa): esta línea se pinta tanto interpolada en barridoDestinoHtml() como
  // reescrita por patchSweepPreview() vía innerHTML — las dos rutas quedan consistentes porque
  // metaHtml es lo único que se llama en los dos sitios.
  function sweepAfterLineText(d) {
    return metaHtml([t("barrido.wouldBe", { amount: fmtMoney(d.afterCents) }), d.completes ? t("barrido.completes") : ""]);
  }

  /** El paso «Barrido» del cierre (N4, spec §9.4): entre el resumen del periodo que se cierra y el
   *  nombre del nuevo, y SOLO en modo 'next'. No se pinta si el remanente es 0, si no hay ningún
   *  destino elegible, o si el saldo de la cuenta de origen es ≤ 0 (D10). No cubierto por el
   *  brief S11 (no aparece en B-PeriodoNuevo, remanente 0 en el escenario del mockup): se
   *  retoca con tokens del sistema, no con un componente nuevo. */
  function bloqueBarrido() {
    if (!currentShowBarrido()) return "";
    const destinations = currentDestinations();
    const titleKey = remainder.basis === "budget" ? "barrido.title" : "barrido.titleIncome";
    const plan = sweepPlan({ rawAmount: state.sweepAmountRaw, sourceBalanceCents: state.sourceBalanceCents });
    const sourceAccountName = accountsById[state.sourceAccountId]?.name ?? "";
    const disabled = state.sweepChoice === "keep";
    return `
    <div class="box box-chart">
      ${sectionHeaderHtml({ title: t(titleKey, { amount: fmtMoney(remainder.cents) }) })}
      <p class="pn-hint">${escHtml(t("barrido.question"))}</p>
      <div class="pn-sweep-list">
        ${destinations.map((d, i) => `${i > 0 ? '<hr class="pn-row-sep">' : ""}${barridoDestinoHtml(d)}`).join("")}
        <hr class="pn-row-sep">
        <label class="pn-sweep-row">
          <input type="radio" name="pn-sweep-dest" class="pn-sweep-radio" value="keep" ${disabled ? "checked" : ""}>
          <span class="pn-sweep-keep">${escHtml(t("barrido.leaveIt"))}</span>
        </label>
      </div>
      <div class="pn-sweep-amount${disabled ? " is-disabled" : ""}">
        <span class="pn-total-label">${escHtml(t("barrido.amount"))}</span>
        <span class="pn-amount-wrap${state.sweepAmountRaw ? " has-value" : ""}">
          <input type="text" inputmode="decimal" id="pn-sweep-amount" value="${escAttr(state.sweepAmountRaw)}" placeholder="0" autocomplete="off"
            ${disabled ? "disabled" : ""} class="pn-amount-input pn-amount-input-lg${state.sweepAmountRaw ? "" : " is-empty"}">
          <span class="pn-amount-suffix">${escHtml(currencySymbol())}</span>
        </span>
        <p id="pn-sweep-capped" class="pn-hint pn-sweep-capped${plan.capped ? " is-visible" : ""}">${plan.capped ? escHtml(t("barrido.capped", { amount: fmtMoney(plan.amountCents), account: sourceAccountName })) : ""}</p>
      </div>
    </div>`;
  }

  // Campo hundido (§9, "Campo hundido"): el nombre editable del periodo nuevo. Sin tarjeta propia
  // (el sistema ya la da el propio campo); no está en el mockup (no hay forma de renombrar el
  // periodo en B-PeriodoNuevo) — se conserva por función: sin esto no habría forma de corregir el
  // nombre por defecto antes de abrir el periodo.
  function bloqueNombre() {
    return fieldHtml({ id: "pn-nombre", label: t("common.name"), value: state.name });
  }

  /** Fecha de inicio (B-PeriodoNuevo): 5 días alrededor de hoy como baldosas seleccionables (P1
   *  abierto: la sugerencia siempre es hoy, nunca un día de cobro fijo), más «Otra fecha» para
   *  cualquier fecha fuera de esa ventana vía el campo hundido nativo. El botón hace de ida y
   *  vuelta (#pn-otra-fecha/#pn-dias-cercanos en wire()): sin él, una vez abierto el campo no
   *  habría manera de volver a las baldosas. */
  function bloqueFecha() {
    const candidates = dayCandidates();
    const showField = state.showCustomDate || !candidates.includes(state.startDate);
    return `
    <section class="pn-section">
      ${sectionHeaderHtml({ title: dateTitle(), id: "pn-date-title" })}
      ${showField
        ? fieldHtml({ id: "pn-fecha", label: t("periodo.date.customLabel"), type: "date", value: state.startDate })
        : `<div class="pn-day-grid" role="group" aria-label="${escAttr(t("periodo.date.groupAria"))}">${candidates.map((iso) => dayTileHtml(iso, iso === state.startDate)).join("")}</div>`}
      ${showField
        ? buttonHtml({ kind: "tertiary", id: "pn-dias-cercanos", icon: "calendar", label: t("periodo.date.quickPick") })
        : buttonHtml({ kind: "tertiary", id: "pn-otra-fecha", icon: "calendar", label: t("periodo.date.other") })}
    </section>`;
  }
  function dateTitle() {
    return t("periodo.date.title", { name: state.name.trim() || nombrePorDefecto() });
  }

  // Paso a paso (§9, controls.js#stepperHtml): el reparto con la contraparte, dentro de un bloque
  // --surface con borde (B-PeriodoNuevo, "Pagas de lo compartido").
  function bloqueReparto() {
    if (!partnerName) return "";
    const restante = 100 - state.sharePct;
    return `
    <div class="pn-share">
      <div class="pn-share-body">
        <span class="pn-share-label">${t("periodo.share.youPay")}</span>
        <span class="pn-share-sub">${t("periodo.share.partnerPays", { name: escHtml(partnerName), pct: restante })}</span>
      </div>
      ${stepperHtml({
        value: `${state.sharePct} %`, decId: "pn-pct-down", incId: "pn-pct-up",
        decLabel: t("periodo.share.decreaseAria"), incLabel: t("periodo.share.increaseAria"),
      })}
    </div>`;
  }

  /** Control del límite de una categoría (F-35, "el valor en tinta"): campo de 44 sobre --well,
   *  centrado y con placeholder mientras está vacío, a la derecha en cuanto tiene importe. */
  function budgetFieldHtml(r) {
    const raw = state.budgets[r.root_id] ?? "";
    const empty = raw === "";
    return `<span class="pn-amount-wrap${empty ? "" : " has-value"}">
      <input type="number" min="0" step="0.01" inputmode="decimal" placeholder="${escAttr(t("periodo.budget.noLimitPlaceholder"))}"
        data-budget="${escAttr(r.root_id)}" value="${escAttr(raw)}" class="pn-amount-input${empty ? " is-empty" : ""}">
      <span class="pn-amount-suffix">${escHtml(currencySymbol())}</span>
    </span>`;
  }

  // Fila de ajuste (§9, entity.js#settingRowHtml, F-35: 48 de alto): baldosa de la categoría,
  // "Mes pasado" del periodo que se cierra y el control de límite a la derecha.
  function budgetRowHtml(r) {
    const sub = mode === "next" ? t("periodo.budget.lastMonth", { name: closingPeriod.name, amount: fmtMoney(r.spent_cents) }) : "";
    return settingRowHtml({
      icon: iconForCategory(r.root_id, byId), fam: familyForCategory(r.root_id, byId), tileFilled: true,
      label: r.name, sub, controlHtml: budgetFieldHtml(r), id: `pn-budget-row-${r.root_id}`,
    });
  }

  function bloqueLimites() {
    if (rootRows.length === 0) {
      return `<div class="pn-empty-cats">${escHtml(t("periodo.budget.noCategories"))}</div>`;
    }
    const visibleRows = rootRows.filter((r) => state.visible.has(r.root_id));
    const hiddenRows = rootRows.filter((r) => !state.visible.has(r.root_id));
    return `
    <section class="pn-section">
      <div class="pn-section-head">
        ${sectionHeaderHtml({ title: t("periodo.budget.question") })}
        <p class="pn-hint">${escHtml(t("periodo.budget.hint"))}</p>
      </div>
      <div class="pn-row-list">
        ${visibleRows.map((r, i) => `${i > 0 ? '<hr class="pn-row-sep">' : ""}${budgetRowHtml(r)}`).join("")}
        ${hiddenRows.length ? `
        ${visibleRows.length ? '<hr class="pn-row-sep">' : ""}
        ${settingRowHtml({ icon: "plus", label: t("periodo.budget.addAnother"), chevron: false, id: "pn-add-limite" })}
        ${state.addOpen ? `<div class="pn-add-list">${hiddenRows.map((r) => settingRowHtml({
          icon: iconForCategory(r.root_id, byId), fam: familyForCategory(r.root_id, byId), tileFilled: true, label: r.name,
          chevron: false, id: `pn-add-cat-${r.root_id}`, data: { addRoot: r.root_id },
        })).join("")}</div>` : ""}` : ""}
      </div>
    </section>`;
  }

  /** "Presupuestado" a 20 (F-14, C3): ya no es el importe héroe de la pantalla. A la derecha, los
   *  ingresos ya conocidos (modo 'next') o el campo efímero "Ingresos previstos" (D11, modo
   *  'first'). Debajo, la barra apilada por familia (budgetBarHtml) y la nota de lo que queda. */
  function bloqueTotal() {
    const presupuestado = totalPresupuestadoCents();
    const ingresos = currentIngresos();
    const incomeSlotHtml = mode === "next"
      ? `<span class="pn-total-income-line">${t("periodo.total.expectedIncome")}</span>
         <span class="num pn-total-income-value">${escHtml(fmtMoney(ingresos))}</span>`
      : `<span class="pn-total-income-line">${t("periodo.first.expectedIncome")}</span>
         <span class="pn-amount-wrap${state.expectedIncomeRaw ? " has-value" : ""}">
           <input type="text" inputmode="decimal" id="pn-expected-income" value="${escAttr(state.expectedIncomeRaw)}"
             placeholder="0" autocomplete="off" class="pn-amount-input pn-amount-input-lg${state.expectedIncomeRaw ? "" : " is-empty"}">
           <span class="pn-amount-suffix">${escHtml(currencySymbol())}</span>
         </span>`;
    return `
    <div class="box box-chart">
      <div class="pn-total-head">
        <div class="pn-total-figure">
          <span class="pn-total-label">${escHtml(t("periodo.total.budgetedTitle"))}</span>
          <span class="num pn-total-amount" id="pn-presupuestado">${moneyPartsHtml(presupuestado)}</span>
        </div>
        <div class="pn-total-income">${incomeSlotHtml}</div>
      </div>
      <div id="pn-total-bar-wrap" class="pn-total-bar${ingresos == null ? "" : " is-visible"}">${budgetBarHtml(presupuestado, ingresos)}</div>
      <p id="pn-nota" class="pn-total-note${ingresos == null ? "" : " is-visible"}">${ingresos != null ? notaSinAsignarHtml(ingresos - presupuestado) : ""}</p>
    </div>`;
  }

  // CTA final: primario con la nota debajo (§9 "Primario", B-PeriodoNuevo es su propio mockup de
  // referencia) y, solo en modo 'next', el enlace terciario a la previsualización del informe.
  function bloqueCTA() {
    return `
    <div class="pn-cta">
      ${errorMsg ? `<div class="banner-aviso is-error">${escHtml(errorMsg)}</div>` : ""}
      ${buttonHtml({
        kind: "primary", id: "pn-submit", disabled: state.saving,
        label: state.saving ? t("periodo.cta.saving") : t("periodo.cta.submit"),
        note: mode === "next" ? t("periodo.cta.reportNote") : "",
      })}
      ${mode === "next" ? `<div class="pn-cta-link">${buttonHtml({ kind: "tertiary", id: "pn-preview-informe", label: t("periodo.finish.seeReport") })}</div>` : ""}
    </div>`;
  }

  function render() {
    container.innerHTML = `
      ${embed ? "" : bloqueHeader()}
      <div class="pn-blocks">
        ${bloqueDisplay()}
        ${bloqueBarrido()}
        ${bloqueNombre()}
        ${bloqueFecha()}
        ${bloqueReparto()}
        ${bloqueLimites()}
        ${bloqueTotal()}
        ${bloqueCTA()}
      </div>
    `;
    wire();
  }

  function wire() {
    const back = container.querySelector("#pn-back");
    if (back) back.onclick = () => (onBack ?? onDone)();

    container.querySelectorAll("[data-day]").forEach((btn) => {
      btn.onclick = async () => {
        state.startDate = btn.dataset.day;
        state.showCustomDate = false;
        if (state.sourceAccountId) {
          try { state.sourceBalanceCents = await accountBalanceCents(state.sourceAccountId, state.startDate); }
          catch { state.sourceBalanceCents = 0; }
        }
        render();
      };
    });
    const otraFechaBtn = container.querySelector("#pn-otra-fecha");
    if (otraFechaBtn) otraFechaBtn.onclick = () => { state.showCustomDate = true; render(); };
    // Ida y vuelta del campo nativo a las baldosas: sin esto, tras "Otra fecha" no habría forma de
    // volver — el día vuelve a ser el de hoy (P1: la sugerencia siempre es hoy).
    const diasCercanosBtn = container.querySelector("#pn-dias-cercanos");
    if (diasCercanosBtn) diasCercanosBtn.onclick = async () => {
      state.showCustomDate = false;
      state.startDate = hoyISO();
      if (state.sourceAccountId) {
        try { state.sourceBalanceCents = await accountBalanceCents(state.sourceAccountId, state.startDate); }
        catch { state.sourceBalanceCents = 0; }
      }
      render();
    };
    const fechaInput = container.querySelector("#pn-fecha");
    if (fechaInput) fechaInput.onchange = async (e) => {
      state.startDate = e.target.value || hoyISO();
      // La transferencia del barrido lleva ESTA fecha (no "hoy"): al mover el inicio del periodo
      // nuevo hay que releer el saldo de la cuenta de origen a esa fecha exacta.
      if (state.sourceAccountId) {
        try { state.sourceBalanceCents = await accountBalanceCents(state.sourceAccountId, state.startDate); }
        catch { state.sourceBalanceCents = 0; }
      }
      render();
    };

    container.querySelector("#pn-nombre").oninput = (e) => {
      state.name = e.target.value;
      // "{name} empieza el" (bloqueFecha) se queda con el nombre de cuando se pintó por última
      // vez: un render() completo aquí perdería el foco del campo, así que se parchea solo el
      // título (mismo criterio que patchTotal/patchSweepPreview).
      const titleEl = container.querySelector("#pn-date-title");
      if (titleEl) titleEl.textContent = dateTitle();
    };

    // D11: solo existe en modo 'first' (bloqueTotal). oninput + patchTotal(), nunca render()
    // completo — perdería el foco a cada dígito, igual que #pn-sweep-amount.
    const expectedIncomeInput = container.querySelector("#pn-expected-income");
    if (expectedIncomeInput) {
      expectedIncomeInput.oninput = (e) => {
        state.expectedIncomeRaw = e.target.value;
        const empty = state.expectedIncomeRaw === "";
        expectedIncomeInput.classList.toggle("is-empty", empty);
        expectedIncomeInput.closest(".pn-amount-wrap")?.classList.toggle("has-value", !empty);
        patchTotal();
      };
    }

    // Bloque 6 ANTES de guardar (§9.5): previsualiza el informe del periodo que se está a punto de
    // cerrar. El onBack es el propio render() de esta pantalla (no goBack/pushBack): el asistente
    // sigue sin cablear al historial global, igual que renderClosedPanel más abajo.
    const previewInformeBtn = container.querySelector("#pn-preview-informe");
    if (previewInformeBtn) previewInformeBtn.onclick = () => {
      renderInforme(container, () => render(), { periodId: closingPeriod.id });
    };

    container.querySelectorAll(".pn-sweep-radio").forEach((r) => {
      r.onchange = () => { state.sweepChoice = r.value; render(); };
    });
    const sweepAmountInput = container.querySelector("#pn-sweep-amount");
    if (sweepAmountInput) {
      sweepAmountInput.oninput = (e) => {
        state.sweepAmountRaw = e.target.value;
        const empty = state.sweepAmountRaw === "";
        sweepAmountInput.classList.toggle("is-empty", empty);
        sweepAmountInput.closest(".pn-amount-wrap")?.classList.toggle("has-value", !empty);
        patchSweepPreview();
      };
    }

    const pctUp = container.querySelector("#pn-pct-up");
    if (pctUp) pctUp.onclick = () => { state.sharePct = stepPct(state.sharePct, PCT_STEP); render(); };
    const pctDown = container.querySelector("#pn-pct-down");
    if (pctDown) pctDown.onclick = () => { state.sharePct = stepPct(state.sharePct, -PCT_STEP); render(); };

    container.querySelectorAll("[data-budget]").forEach((el) => {
      // oninput (no render()) para no perder el foco a media escritura ni "tragarse" el
      // siguiente toque si el usuario salta a otra fila (ver patchTotal más arriba).
      el.oninput = (e) => {
        const raw = e.target.value;
        state.budgets[el.dataset.budget] = raw;
        const empty = raw === "";
        el.classList.toggle("is-empty", empty);
        el.closest(".pn-amount-wrap")?.classList.toggle("has-value", !empty);
        patchTotal();
      };
    });

    const addBtn = container.querySelector("#pn-add-limite");
    if (addBtn) addBtn.onclick = () => { state.addOpen = !state.addOpen; render(); };

    container.querySelectorAll("[data-add-root]").forEach((b) => {
      b.onclick = () => {
        state.visible.add(b.dataset.addRoot);
        state.addOpen = false;
        render();
      };
    });

    container.querySelector("#pn-submit").onclick = async () => {
      if (state.saving) return;
      state.saving = true;
      errorMsg = "";
      render();
      try {
        const budgetsPayload = [];
        for (const [categoryId, raw] of Object.entries(state.budgets)) {
          if (raw === "" || raw == null) continue;
          const n = Number(raw);
          if (!Number.isFinite(n) || n <= 0) continue;
          budgetsPayload.push({ categoryId, amountCents: eurToCents(raw) });
        }
        // El sweep solo viaja si hay un destino elegido (no «Dejarlo en la cuenta») Y la cantidad
        // tecleada es válida (sweepPlan) — sin esto, dejar el campo a medias no debe escribir nada.
        let sweep;
        if (currentShowBarrido() && state.sweepChoice !== "keep") {
          const plan = sweepPlan({ rawAmount: state.sweepAmountRaw, sourceBalanceCents: state.sourceBalanceCents });
          const dest = currentDestinations().find((d) => d.goalId === state.sweepChoice);
          if (dest && plan.valid) {
            sweep = { amountCents: plan.amountCents, fromAccountId: state.sourceAccountId, toAccountId: dest.accountId, goalName: dest.name };
          }
        }
        await openNextPeriod({
          name: state.name.trim() || nombrePorDefecto(),
          startDate: state.startDate || hoyISO(),
          sharePct: partnerName ? Math.min(100, Math.max(0, state.sharePct)) : 100,
          budgets: budgetsPayload,
          sweep,
        });
        // Bloque 6 del artboard: en modo 'next' hay un periodo recién cerrado del que enseñar el
        // informe; en 'first' (onboarding) no existe ese periodo, así que se sigue como hasta
        // ahora, sin panel.
        if (mode === "next") renderClosedPanel();
        else onDone();
      } catch (e) {
        state.saving = false;
        errorMsg = t("periodo.error.open", { error: userMessage(e) });
        render();
      }
    };
  }

  /** Panel final tras cerrar con éxito (Bloque 6 de PeriodoNuevo.dc.html): «Ver el informe» monta
   *  renderInforme EN EL MISMO contenedor, con body.onboarding todavía puesto (el chrome sigue
   *  oculto y nav() bloqueado, main.js:28) — volver desde ahí repinta este mismo panel, nunca sale
   *  del asistente por sorpresa. «Hecho» es la única salida real. */
  function renderClosedPanel() {
    // Sin la nota "Al cerrar se genera el informe…" (periodo.finish.autoReport): ya la dice
    // bloqueCTA() ANTES de guardar (periodo.cta.reportNote, §9.5) — este panel es el acuse de
    // recibo real, no un segundo aviso. La clave se queda en el diccionario sin consumidor.
    container.innerHTML = `
    <div class="pn-closed-panel">
      ${buttonHtml({ kind: "primary", id: "pn-ver-informe", label: t("periodo.finish.seeReport") })}
      ${buttonHtml({ id: "pn-hecho", label: t("periodo.finish.done") })}
    </div>`;
    container.querySelector("#pn-ver-informe").onclick = () => {
      renderInforme(container, renderClosedPanel, { periodId: closingPeriod.id });
    };
    container.querySelector("#pn-hecho").onclick = () => onDone();
  }

  render();
}
