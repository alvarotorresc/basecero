import {
  getOpenPeriod, spentOfPeriod, incomeOfPeriod, listAllByDay, spentByRootCategory, budgetsOfPeriod,
  openNextPeriod, getMetaAll, goalsWithProgress, listAllAccounts, defaultAccountId, accountBalanceCents,
} from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { eurToCents } from "../contract.js";
import { fmtMoney, moneyPartsHtml, fmtDiaCorto, hoyISO, prevDayIso, nombrePorDefecto, fmtPct, currencySymbol, centsToRaw } from "../format.js";
import { t } from "../i18n/index.js";
import { PCT_STEP, stepPct } from "../share-pct.js";
import { inheritedBudgetsRaw, budgetMap } from "../category-spend.js";
import { remainderCents, sweepDestinations, sweepPlan } from "../barrido.js";
import { renderInforme } from "./informe.js";
import { userMessage } from "../errors.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const BTN_SECONDARY = "background:var(--card2);color:var(--text);border:0;"
  + "border-radius:999px;padding:16px;flex:1;font:600 16px var(--font-ui);cursor:pointer;";

/** Pantalla de error con recuperación: quien llama ya puso `body.onboarding` (chrome oculto,
 *  nav() bloqueado — ver main.js), así que un simple banner sin salida deja a quien lo use
 *  atrapado. "Reintentar" vuelve a montar la pantalla entera; "Volver" (solo en modo 'next',
 *  donde SÍ hay algo a lo que volver sin haber creado nada) llama a onDone() como cancelación. */
function renderAsistenteError(container, mode, onDone, message) {
  container.innerHTML = `
    <div class="banner-aviso red" style="margin-bottom:14px;">${escHtml(message)}</div>
    <div style="display:flex; gap:8px;">
      <button type="button" class="btn-primary" id="pn-error-retry" style="flex:1;">${t("common.retry")}</button>
      ${mode === "next" ? `<button type="button" id="pn-error-back" style="${BTN_SECONDARY}">${t("common.goBack")}</button>` : ""}
    </div>`;
  container.querySelector("#pn-error-retry").onclick = () => renderPeriodoNuevo(container, { mode, onDone });
  const back = container.querySelector("#pn-error-back");
  if (back) back.onclick = () => onDone();
}

/** Pantalla única (sin tab bar, flecha atrás) para abrir un periodo nuevo: en modo 'next'
 *  cierra el periodo abierto (bloque "Cierras X" con su resumen) y en modo 'first' solo crea
 *  el primero (onboarding, sin nada que cerrar). Presupuestos por categoría RAÍZ de gasto:
 *  spentByRootCategory('' ) en modo 'first' no matchea ningún period_id → devuelve todas las
 *  raíces con spent_cents=0 (mismo LEFT JOIN, sin fila cerrada de la que tirar "mes pasado").
 *  onDone() se llama tanto al abrir con éxito como al cancelar con la flecha atrás (modo 'next'). */
export async function renderPeriodoNuevo(container, { mode, onDone, onBack }) {
  let closingPeriod = null, closingSpent = 0, closingIncome = 0, closingCount = 0, rootRows = [], meta = {};
  let closingBudgets = [];
  // Barrido (N4): goals con progreso, cuentas vivas y la cuenta de origen por defecto — solo hace
  // falta en modo 'next' (bloqueBarrido() más abajo).
  let goalsProgress = [], allAccounts = [], sourceAccountId = "", sourceBalanceCents = 0;
  try {
    if (mode === "next") {
      closingPeriod = await getOpenPeriod();
      if (!closingPeriod) {
        renderAsistenteError(container, mode, onDone, t("periodo.error.noOpenToClose"));
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
    renderAsistenteError(container, mode, onDone, t("periodo.error.load", { error: userMessage(e) }));
    return;
  }
  const partnerName = (meta.partner_name || "").trim();
  const accountsById = Object.fromEntries(allAccounts.map((a) => [a.id, a]));

  // byId "de mentira" solo con lo que colorForCategory/iconForCategory necesitan (rootOf sube
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
  // la fecha de inicio (#pn-fecha), así que los destinos elegibles hay que recalcularlos en cada
  // render(), no fijarlos una vez con el saldo inicial.
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
    sharePct: mode === "next" ? closingPeriod.my_share_pct : 50,
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
    // Barrido: preseleccionado el primero (más cerca de cumplirse, spec §9.4); precargado con el
    // remanente entero. sourceAccountId/sourceBalanceCents viven en el state porque la fecha de
    // inicio (#pn-fecha) puede cambiar el saldo de origen (la transferencia lleva esa fecha).
    sweepChoice: initialDestinations[0]?.goalId ?? "keep",
    sweepAmountRaw: centsToRaw(remainder.cents),
    sourceAccountId,
    sourceBalanceCents,
  };
  let errorMsg = "";

  function totalPresupuestadoCents() {
    let sum = 0;
    for (const raw of Object.values(state.budgets)) {
      if (raw === "" || raw == null) continue;
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) sum += eurToCents(raw);
    }
    return sum;
  }

  function notaSinAsignarHtml(sinAsignar) {
    return sinAsignar >= 0
      ? t("periodo.total.remaining", { amount: `<span style="color:var(--green); font-weight:700;">${fmtMoney(sinAsignar)}</span>` })
      : t("periodo.total.over", { amount: `<span style="color:var(--red); font-weight:700;">${fmtMoney(-sinAsignar)}</span>` });
  }

  /** Actualiza SOLO el total/barra/nota tras editar un importe, sin re-renderizar toda la
   *  pantalla: un render() completo en cada tecleo destruiría el input que tiene el foco (y
   *  cualquier otro que el usuario esté a punto de tocar), tragándose el toque siguiente. */
  function patchTotal() {
    const presupuestado = totalPresupuestadoCents();
    const presupEl = container.querySelector("#pn-presupuestado");
    // innerHTML (no textContent): #pn-presupuestado ahora lleva moneyPartsHtml (main + <small>
    // céntimos</small> + sufijo) — un textContent aquí borraría el <small> en el primer tecleo.
    if (presupEl) presupEl.innerHTML = moneyPartsHtml(presupuestado);
    if (mode === "next") {
      const pctBarra = closingIncome > 0 ? Math.min(100, Math.round((presupuestado / closingIncome) * 100)) : 0;
      const sinAsignar = closingIncome - presupuestado;
      const barEl = container.querySelector("#pn-bar");
      if (barEl) barEl.style.width = pctBarra + "%";
      const notaEl = container.querySelector("#pn-nota");
      if (notaEl) notaEl.innerHTML = notaSinAsignarHtml(sinAsignar);
    }
  }

  /** Actualiza SOLO el aviso de tope y el «quedaría en X» de cada destino tras teclear en
   *  «Cantidad a barrer» — mismo criterio que patchTotal(): un render() completo por tecla
   *  destruiría el input con el foco (comentario de referencia arriba, líneas 112-114). */
  function patchSweepPreview() {
    if (!currentShowBarrido()) return;
    const plan = sweepPlan({ rawAmount: state.sweepAmountRaw, sourceBalanceCents: state.sourceBalanceCents });
    const cappedEl = container.querySelector("#pn-sweep-capped");
    if (cappedEl) {
      if (plan.capped) {
        cappedEl.style.display = "";
        cappedEl.textContent = t("barrido.capped", {
          amount: fmtMoney(plan.amountCents), account: accountsById[state.sourceAccountId]?.name ?? "",
        });
      } else {
        cappedEl.style.display = "none";
      }
    }
    const liveDestinations = sweepDestinations(goalsProgress, accountsById, plan.amountCents, state.sourceAccountId);
    for (const d of liveDestinations) {
      const line = container.querySelector(`[data-sweep-afterline="${d.goalId}"]`);
      if (line) line.textContent = sweepAfterLineText(d);
    }
  }

  // Kicker versalitas verde (.day-label, misma fórmula que .section-title, --green del sistema):
  // en modo 'next' compone "Cierra {periodo real} · abre el siguiente" con el nombre YA cargado
  // (closingPeriod.name, el mismo dato que bloqueCierre usa debajo); en 'first' no hay periodo que
  // cerrar, así que no hay dato del que derivar la frase del artboard — "Primer periodo" es la
  // única etiqueta que no inventa nada. El sub "Paso único..." (copy real, ya existía en ambos
  // modos) se conserva tal cual en vez del texto nuevo del artboard para esa línea.
  function bloqueHeader() {
    const kicker = mode === "next" ? t("periodo.header.closing", { name: escHtml(closingPeriod.name) }) : t("periodo.header.first");
    return `
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
      ${mode === "next" || onBack ? `<button type="button" class="icon-btn" id="pn-back" aria-label="${t("common.goBack")}"
        style="width:44px;height:44px;border-radius:50%;background:var(--card);color:var(--text);font-size:18px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"></path></svg></button>` : ""}
      <div style="display:flex; flex-direction:column; gap:4px;">
        <div class="day-label" style="color:var(--green);">${kicker}</div>
        <div style="font-size:24px; font-weight:800; letter-spacing:-0.02em;">${t("periodo.header.title")}</div>
        <div style="font-size:11px; color:var(--text-3);">${t("periodo.header.subtitle")}</div>
      </div>
    </div>`;
  }

  function bloqueCierre() {
    if (mode !== "next") return "";
    const ahorrado = closingIncome - closingSpent;
    const tasa = closingIncome > 0 ? fmtPct(ahorrado / closingIncome) : "—";
    const rangeEnd = prevDayIso(state.startDate || hoyISO());
    return `
    <div class="card" style="display:flex; flex-direction:column; gap:14px; margin-bottom:16px;">
      <div style="display:flex; flex-direction:column; gap:3px;">
        <div style="font-size:15px; font-weight:700;">${t("periodo.closing.title", { name: escHtml(closingPeriod.name) })}</div>
        <div style="font-size:11px; color:var(--text-3);">
          ${fmtDiaCorto(closingPeriod.start_date)} – ${fmtDiaCorto(rangeEnd)} · ${t("periodo.closing.movementCount", { n: closingCount })}
        </div>
      </div>
      <hr class="divider">
      <div style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px;">
        <div style="display:flex; flex-direction:column; gap:5px;">
          <div style="font-size:11px; color:var(--text-3);">${t("periodo.closing.spent")}</div>
          <div class="num" style="font-size:15px; font-weight:600;">${fmtMoney(closingSpent)}</div>
        </div>
        <div style="display:flex; flex-direction:column; gap:5px;">
          <div style="font-size:11px; color:var(--text-3);">${t("periodo.closing.saved")}</div>
          <div class="num ${ahorrado >= 0 ? "text-green" : "text-red"}" style="font-size:15px; font-weight:600;">${fmtMoney(ahorrado)}</div>
        </div>
        <div style="display:flex; flex-direction:column; gap:5px;">
          <div style="font-size:11px; color:var(--text-3);">${t("periodo.closing.savingsRate")}</div>
          <div class="num" style="font-size:15px; font-weight:600;">${tasa}</div>
        </div>
      </div>
    </div>`;
  }

  /** Fila de un destino elegible (Bloque 2 de PeriodoNuevo.dc.html, N4): tarjeta de radio con
   *  nombre, current/target, barra y «quedaría en {importe}». El `data-sweep-afterline` es lo que
   *  patchSweepPreview() reescribe al teclear en el importe, sin re-renderizar toda la pantalla. */
  function barridoDestinoHtml(d, withDivider) {
    const checked = state.sweepChoice === d.goalId;
    const pct = Math.min(100, Math.max(0, d.pct));
    return `
    ${withDivider ? '<hr class="divider">' : ""}
    <label style="display:flex; align-items:center; gap:12px; padding:12px 0; cursor:pointer; -webkit-tap-highlight-color:transparent;">
      <input type="radio" name="pn-sweep-dest" value="${escAttr(d.goalId)}" data-sweep-radio ${checked ? "checked" : ""} style="width:20px; height:20px; flex-shrink:0;">
      <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:5px;">
        <div style="display:flex; align-items:baseline; justify-content:space-between; gap:8px;">
          <span style="font-size:14px; font-weight:600;">${t("barrido.toGoal", { name: escHtml(d.name) })}</span>
          <span class="num" style="font-size:11px; color:var(--text-3); flex-shrink:0;">${escHtml(fmtMoney(d.currentCents))} / ${escHtml(fmtMoney(d.targetCents))}</span>
        </div>
        <div class="bar" style="height:6px;"><i style="width:${pct}%;"></i></div>
        <div class="num" style="font-size:11px; color:var(--text-3);" data-sweep-afterline="${escAttr(d.goalId)}">${sweepAfterLineText(d)}</div>
      </div>
    </label>`;
  }

  function sweepAfterLineText(d) {
    return t("barrido.wouldBe", { amount: escHtml(fmtMoney(d.afterCents)) }) + (d.completes ? " · " + t("barrido.completes") : "");
  }

  /** El paso «Barrido» del cierre (N4, spec §9.4): entre el resumen del periodo que se cierra y el
   *  nombre del nuevo, y SOLO en modo 'next'. No se pinta si el remanente es 0, si no hay ningún
   *  destino elegible, o si el saldo de la cuenta de origen es ≤ 0 (D10). */
  function bloqueBarrido() {
    if (!currentShowBarrido()) return "";
    const destinations = currentDestinations();
    const titleKey = remainder.basis === "budget" ? "barrido.title" : "barrido.titleIncome";
    const plan = sweepPlan({ rawAmount: state.sweepAmountRaw, sourceBalanceCents: state.sourceBalanceCents });
    const sourceAccountName = accountsById[state.sourceAccountId]?.name ?? "";
    return `
    <div class="card" style="display:flex; flex-direction:column; gap:14px; margin-bottom:16px;">
      <div style="display:flex; flex-direction:column; gap:3px;">
        <div style="font-size:15px; font-weight:700;">${t(titleKey, { amount: escHtml(fmtMoney(remainder.cents)) })}</div>
        <div style="font-size:11px; color:var(--text-3);">${t("barrido.question")}</div>
      </div>
      <div style="display:flex; flex-direction:column;">
        ${destinations.map((d, i) => barridoDestinoHtml(d, i > 0)).join("")}
        <hr class="divider">
        <label style="display:flex; align-items:center; gap:12px; padding:12px 0; cursor:pointer; -webkit-tap-highlight-color:transparent;">
          <input type="radio" name="pn-sweep-dest" value="keep" data-sweep-radio ${state.sweepChoice === "keep" ? "checked" : ""} style="width:20px; height:20px; flex-shrink:0;">
          <span style="font-size:14px; font-weight:600;">${t("barrido.leaveIt")}</span>
        </label>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px; ${state.sweepChoice === "keep" ? "opacity:.5;" : ""}">
        <div class="section-title">${t("barrido.amount")}</div>
        <input type="number" min="0" step="0.01" inputmode="decimal" id="pn-sweep-amount" value="${escAttr(state.sweepAmountRaw)}"
          ${state.sweepChoice === "keep" ? "disabled" : ""}
          style="height:44px; padding:0 14px; background:var(--card2); border:0; border-radius:0; color:var(--text); font:600 15px var(--font-num); width:100%; outline:none;">
        <div id="pn-sweep-capped" class="num" style="font-size:11px; color:var(--amber, var(--text-3)); ${plan.capped ? "" : "display:none;"}">${plan.capped ? escHtml(t("barrido.capped", { amount: fmtMoney(plan.amountCents), account: escHtml(sourceAccountName) })) : ""}</div>
      </div>
    </div>`;
  }

  // Tres cards independientes (una por bloque: nombre, fecha, reparto), réplica de la estructura
  // de PeriodoNuevo.dc.html — antes era un único .card con <hr> entre secciones; el artboard las
  // separa. Nombre/fecha siguen siendo <input> reales (el input manda, no se convierten a texto),
  // solo re-vestidos como tile --card2 (antes hex #1b1e21 suelto).
  function bloqueNombre() {
    return `
    <div class="card" style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
      <div class="section-title">${t("common.name")}</div>
      <input type="text" id="pn-nombre" value="${escAttr(state.name)}"
        style="height:44px; padding:0 14px; background:var(--card2); border:0; border-radius:0; color:var(--text);
        font:700 15px var(--font-ui); width:100%; outline:none;">
    </div>`;
  }

  // Tile calendario decorativo (sin onclick): el input type=date ya trae su propio selector nativo
  // en toda su superficie — añadirle un handler al tile duplicaría esa interacción sin aportar
  // nada nuevo, y sería la única pieza de "lógica" de esta tarjeta que no viene ya del navegador.
  function bloqueFecha() {
    return `
    <div class="card" style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
      <div class="section-title">${t("periodo.date.title")}</div>
      <div style="display:flex; align-items:center; gap:10px;">
        <input type="date" id="pn-fecha" value="${state.startDate}"
          style="flex:1; height:44px; padding:0 14px; background:var(--card2); border:0; border-radius:0;
          color:var(--text); font:600 14px var(--font-num); min-width:0;">
        <div style="width:44px; height:44px; border-radius:0; background:var(--card2); flex-shrink:0;
          display:flex; align-items:center; justify-content:center;" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="stroke:var(--text);" stroke-width="1.6"
            stroke-linecap="round" stroke-linejoin="round">
            <rect x="3.5" y="5" width="17" height="16" rx="2.5"></rect><path d="M3.5 9.5h17M8 3v4M16 3v4"></path>
          </svg>
        </div>
      </div>
    </div>`;
  }

  // Steppers 44px/radius14 (antes ▲/▼ apiladas de 20×19 — .stepper-btn base se pisa por instancia,
  // mismo criterio que .ring 52px en patrimonio.js o el botón "+Nueva" 44px de recurrentes.js) +
  // el texto del % existente, sin cambios de dato/copy.
  function bloqueReparto() {
    if (!partnerName) return "";
    const restante = 100 - state.sharePct;
    return `
    <div class="card" style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
      <div class="section-title">${t("periodo.share.title")}</div>
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="flex:1; min-width:0;">
          <div style="font-size:14px; font-weight:600;">${t("periodo.share.youPay")}</div>
          <div style="font-size:11px; color:var(--text-3);">${t("periodo.share.partnerPays", { name: escHtml(partnerName), pct: restante })}</div>
        </div>
        <button type="button" id="pn-pct-down" class="stepper-btn lg"
          aria-label="${t("periodo.share.decreaseAria")}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path></svg></button>
        <div class="num" style="font-size:20px; font-weight:700; width:56px; text-align:center; flex-shrink:0;">${state.sharePct} %</div>
        <button type="button" id="pn-pct-up" class="stepper-btn lg"
          aria-label="${t("periodo.share.increaseAria")}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>
      </div>
    </div>`;
  }

  function budgetRowHtml(r, withDivider) {
    const color = colorForCategory(r.root_id, byId);
    const icon = iconForCategory(r.root_id, byId);
    const raw = state.budgets[r.root_id] ?? "";
    const empty = raw === "";
    return `
    ${withDivider ? '<hr class="divider">' : ""}
    <div style="display:flex; align-items:center; gap:12px; padding:13px 0;">
      <div class="tx-icon" style="--cat:${color};">${icon}</div>
      <div style="display:flex; flex-direction:column; gap:3px; flex-grow:1; min-width:0;">
        <div style="font-size:14px; font-weight:600;">${escHtml(r.name)}</div>
        ${mode === "next" ? `<div style="font-size:11px; color:var(--text-3);">${t("periodo.budget.lastMonth", { amount: fmtMoney(r.spent_cents) })}</div>` : ""}
      </div>
      <div style="position:relative; flex-shrink:0;">
        <input type="number" min="0" step="0.01" inputmode="decimal" placeholder="${t("periodo.budget.noLimitPlaceholder")}"
          data-budget="${r.root_id}" value="${escAttr(raw)}" class="budget-input${empty ? " is-empty" : ""}">
        <span class="budget-eur" style="position:absolute; right:10px; top:50%; transform:translateY(-50%); font-size:12px;
          color:var(--text-3); pointer-events:none; display:${empty ? "none" : ""};">${currencySymbol()}</span>
      </div>
    </div>`;
  }

  function bloqueLimites() {
    const visibleRows = rootRows.filter((r) => state.visible.has(r.root_id));
    const hiddenRows = rootRows.filter((r) => !state.visible.has(r.root_id));
    if (rootRows.length === 0) {
      return `
      <div class="card" style="text-align:center; color:var(--text-3); margin-bottom:16px;">
        <p>${t("periodo.budget.noCategories")}</p>
      </div>`;
    }
    return `
    <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:16px;">
      <div style="display:flex; flex-direction:column; gap:4px;">
        <div style="font-size:15px; font-weight:700;">${t("periodo.budget.question")}</div>
        <div style="font-size:11px; color:var(--text-3); line-height:1.5;">
          ${t("periodo.budget.hint")}
        </div>
      </div>
      <div class="card" style="padding:4px 16px; display:flex; flex-direction:column;">
        ${visibleRows.map((r, i) => budgetRowHtml(r, i > 0)).join("")}
        ${hiddenRows.length ? `
        ${visibleRows.length ? '<hr class="divider">' : ""}
        <button type="button" id="pn-add-limite"
          style="display:flex; align-items:center; gap:12px; padding:14px 0; background:none; border:0; width:100%;
          text-align:left; cursor:pointer; -webkit-tap-highlight-color:transparent;">
          <div class="tx-icon" style="--cat:var(--text);">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5.5v13M5.5 12h13"></path></svg>
          </div>
          <span style="font-size:14px; font-weight:600; color:var(--text);">${t("periodo.budget.addAnother")}</span>
        </button>
        ${state.addOpen ? `
        <div style="display:flex; flex-direction:column; padding-bottom:10px;">
          ${hiddenRows.map((r) => `
          <button type="button" data-add-root="${r.root_id}"
            style="display:flex; align-items:center; gap:10px; padding:9px 0 9px 52px; background:none; border:0;
            width:100%; text-align:left; cursor:pointer; -webkit-tap-highlight-color:transparent;">
            <span style="font-size:16px; line-height:1;">${iconForCategory(r.root_id, byId)}</span>
            <span style="font-size:13px; color:var(--text-2);">${escHtml(r.name)}</span>
          </button>`).join("")}
        </div>` : ""}
        ` : ""}
      </div>
    </div>`;
  }

  // "Presupuestado" con céntimos small (fmtMoneyParts/moneyPartsHtml, patrón inicio.js/
  // patrimonio.js/gasto-por-categoria.js): es un importe COMPUESTO/derivado (suma de los budget-input,
  // no un campo editable en sí), así que sí se convierte al patrón .amount-hero — a diferencia de
  // los budget-input de bloqueLimites, que siguen siendo inputs reales sin tocar. Barra: mismo
  // patrón que gasto-por-categoria.js — clase .bar con --cat:var(--text) en vez del
  // var(--accent) suelto de antes. CTA + error se sacan a bloqueCTA() (bloque final separado,
  // como en el artboard) — el id #pn-presupuestado/#pn-bar/#pn-nota los sigue actualizando
  // patchTotal() sin re-render completo (ver su comentario más abajo).
  function bloqueTotal() {
    const presupuestado = totalPresupuestadoCents();
    const ingresos = mode === "next" ? closingIncome : null;
    const pctBarra = ingresos > 0 ? Math.min(100, Math.round((presupuestado / ingresos) * 100)) : 0;
    const sinAsignar = ingresos != null ? ingresos - presupuestado : null;
    return `
    <div class="card" style="display:flex; flex-direction:column; gap:14px; margin-bottom:16px;">
      <div style="display:flex; align-items:flex-end; justify-content:space-between; gap:12px;">
        <div style="display:flex; flex-direction:column; gap:5px;">
          <div class="section-title">${t("periodo.total.budgetedTitle")}</div>
          <div class="amount-hero num" id="pn-presupuestado">${moneyPartsHtml(presupuestado)}</div>
        </div>
        ${ingresos != null ? `
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:5px;">
          <div style="font-size:11px; color:var(--text-3);">${t("periodo.total.expectedIncome")}</div>
          <div class="num" style="font-size:15px; font-weight:600; color:var(--text-2);">${fmtMoney(ingresos)}</div>
        </div>` : ""}
      </div>
      ${ingresos != null ? `
      <div class="bar" style="--cat:var(--text);"><i id="pn-bar" style="width:${pctBarra}%;"></i></div>
      <div id="pn-nota" style="font-size:11px; color:var(--text-3); line-height:1.5;">${notaSinAsignarHtml(sinAsignar)}</div>` : ""}
    </div>`;
  }

  // CTA final, fuera de la card del total (como en el artboard): mismo id/label EXISTENTE
  // ("Abrir periodo"/"Abriendo…" — no el "Abrir Septiembre 2026" fijo del artboard, que fabricaría
  // un texto con el nombre siempre en mayúscula fija en vez del state.name real).
  function bloqueCTA() {
    return `
    ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}
    <button type="button" class="btn-primary" id="pn-submit" ${state.saving ? "disabled" : ""}>${state.saving ? t("periodo.cta.saving") : t("periodo.cta.submit")}</button>`;
  }

  function render() {
    container.innerHTML = `
      ${bloqueHeader()}
      ${bloqueCierre()}
      ${bloqueBarrido()}
      ${bloqueNombre()}
      ${bloqueFecha()}
      ${bloqueReparto()}
      ${bloqueLimites()}
      ${bloqueTotal()}
      ${bloqueCTA()}
    `;
    wire();
  }

  function wire() {
    const back = container.querySelector("#pn-back");
    if (back) back.onclick = () => (onBack ?? onDone)();

    container.querySelector("#pn-fecha").onchange = async (e) => {
      state.startDate = e.target.value || hoyISO();
      // La transferencia del barrido lleva ESTA fecha (no "hoy"): al mover el inicio del periodo
      // nuevo hay que releer el saldo de la cuenta de origen a esa fecha exacta.
      if (state.sourceAccountId) {
        try { state.sourceBalanceCents = await accountBalanceCents(state.sourceAccountId, state.startDate); }
        catch { state.sourceBalanceCents = 0; }
      }
      render();
    };
    container.querySelector("#pn-nombre").oninput = (e) => { state.name = e.target.value; };

    container.querySelectorAll("[data-sweep-radio]").forEach((r) => {
      r.onchange = () => { state.sweepChoice = r.value; render(); };
    });
    const sweepAmountInput = container.querySelector("#pn-sweep-amount");
    if (sweepAmountInput) {
      sweepAmountInput.oninput = (e) => {
        state.sweepAmountRaw = e.target.value;
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
        const suffix = el.parentElement.querySelector(".budget-eur");
        if (suffix) suffix.style.display = empty ? "none" : "";
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
        const budgets = [];
        for (const [categoryId, raw] of Object.entries(state.budgets)) {
          if (raw === "" || raw == null) continue;
          const n = Number(raw);
          if (!Number.isFinite(n) || n <= 0) continue;
          budgets.push({ categoryId, amountCents: eurToCents(raw) });
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
          budgets,
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
    container.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:18px; align-items:center; text-align:center; padding-top:40px;">
      <div style="font-size:20px; font-weight:800; letter-spacing:-0.02em;">${t("periodo.finish.autoReport", { name: escHtml(closingPeriod.name) })}</div>
      <button type="button" class="btn-primary" id="pn-ver-informe" style="width:100%;">${t("periodo.finish.seeReport")}</button>
      <button type="button" id="pn-hecho" style="${BTN_SECONDARY}">${t("periodo.finish.done")}</button>
    </div>`;
    container.querySelector("#pn-ver-informe").onclick = () => {
      renderInforme(container, renderClosedPanel, { periodId: closingPeriod.id });
    };
    container.querySelector("#pn-hecho").onclick = () => onDone();
  }

  render();
}
