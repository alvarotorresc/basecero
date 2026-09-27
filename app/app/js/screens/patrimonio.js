import {
  balancesAt, netWorthOfBalances, netWorthSeries, goalsWithProgress,
  getAccount, createAccount, updateAccount, listExpenseRootCategories, allCategoriesById,
  createGoal, updateGoal, softDeleteGoal, getAccountLoans, setAccountLoan,
  getAccountStyle, setAccountFamily, defaultAccountId,
} from "../repo.js";
import { familyForCategory, famClass, FAMILIES } from "../category-colors.js";
import { familyForAccount, defaultFamilyForAccount, goalFamily } from "../account-colors.js";
import { fmtMoney, hoyISO, fmtDec1, currencySymbol, parseCentsRaw, centsToRaw } from "../format.js";
import { sparklineSvg } from "../charts.js";
import { t } from "../i18n/index.js";
import { pushBack, goBack } from "../back.js";
import { userMessage } from "../errors.js";
import { showConfirm } from "../modal.js";
import { rootHeaderHtml, subHeaderHtml, buttonHtml } from "../ui.js";
import { segmentedHtml, wireSegmented, switchHtml, stepperHtml } from "../controls.js";
import { tileHtml, filterChipHtml, settingRowHtml, sectionHeaderHtml, familySwatchesHtml, famNumHtml } from "../entity.js";
import { displayHtml, ledHtml, stackedBarHtml, meterHtml, containerHtml, emptyStateHtml } from "../instrument.js";
import { icon } from "../icons.js";
import { escHtml, escAttr } from "../esc.js";
import { renderObjetivo } from "./objetivo.js";
import { renderCuenta } from "./cuenta.js";
import { showToast } from "../toast.js";

// Pantalla Patrimonio en el sistema B (S3; B-Patrimonio y BD-Patrimonio). Todo el color va por
// clase: la familia de cada cuenta (account-colors.js, C8) entra como .fam-<k> y el CSS de la
// sección «patrimonio» de screens.css lee --ft/--fb/--fx. En línea solo va geometría (R-INLINE).

const MINUS = "−"; // «−» tipográfico: mismo ancho que «+» en la mono tabular.

/** Importe con signo tipográfico: «−4.300,00 €» / «+737,51 €» / «3.374,26 €». */
function signedMoney(cents, { plus = false } = {}) {
  if (cents < 0) return `${MINUS}${fmtMoney(Math.abs(cents))}`;
  return `${plus ? "+" : ""}${fmtMoney(cents)}`;
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** t() escapado en el que las cifras de `nums` salen en mono (<span class="num">), sin partir la
 *  frase traducida: cada cifra entra como marca y se sustituye ya escapada. */
function tNums(key, nums, vars = {}) {
  const names = Object.keys(nums);
  const mark = (i) => `\u0001${i}\u0001`;
  let html = escHtml(t(key, { ...vars, ...Object.fromEntries(names.map((k, i) => [k, mark(i)])) }));
  names.forEach((k, i) => { html = html.replace(mark(i), `<span class="num">${escHtml(nums[k])}</span>`); });
  return html;
}

// ---- Display «Patrimonio neto» ------------------------------------------------------------------

// Cifra del Display a 44, la de B-Patrimonio (escala de tres RETIRADA, Álvaro 2026-09-27).
const DISPLAY_PX = 44;

/** Display (B-Patrimonio): cifra neta, LED «Sube»/«Baja», delta del periodo en el pie y la línea
 *  de los últimos ≤6 puntos de netWorthSeries (cerrados + hoy) con su eje de meses. La variación
 *  es el último punto (hoy) contra el penúltimo (el último cierre). Sin ningún cierre (menos de 2
 *  puntos) no hay con qué comparar: ni LED, ni delta, ni línea. El delta positivo va en --ok (C4:
 *  deltas dentro del Display); el negativo en --disp-ink con «−», porque --neg no llega a 3:1 sobre
 *  el panel oscuro. */
function netWorthDisplayHtml(netWorthCents, series) {
  const pts = series.slice(-6);
  const n = pts.length;
  if (n < 2) {
    return displayHtml({ label: t("patrimonio.netWorth.title"), value: fmtMoney(netWorthCents), size: DISPLAY_PX });
  }
  const variation = pts[n - 1].cents - pts[n - 2].cents;
  const up = variation >= 0;
  const footHtml = `<span class="num pat-delta ${up ? "is-up" : "is-down"}">${escHtml(signedMoney(variation, { plus: true }))}</span> ${escHtml(t("patrimonio.netWorth.thisPeriod"))}`;
  return displayHtml({
    label: t("patrimonio.netWorth.title"),
    value: fmtMoney(netWorthCents),
    size: DISPLAY_PX,
    led: { state: up ? "ok" : "idle", text: t(up ? "patrimonio.netWorth.up" : "patrimonio.netWorth.down") },
    footHtml,
    slot: sparklineSvg(pts.map((p) => p.cents), { labels: pts.map((p) => cap(String(p.label))), dots: true }),
  });
}

// ---- Composición: barra apilada + Tienes / Debes + operativo -------------------------------------

/** Bloque bajo el Display (B-Patrimonio): la barra apilada grande con un segmento por cuenta (su
 *  familia; la deuda con la trama --stripe-debt), Tienes / Debes a los lados y, tras el separador,
 *  el operativo (las cuentas corrientes). Los segmentos llevan su nombre (C12) en el aria-label de
 *  la barra; a la vista, los nombran Tienes / Debes y las tarjetas de cuenta de debajo, con el
 *  mismo color. Una cuenta que no es deuda pero está en negativo cuenta en «Debes» y se pinta
 *  rayada: es dinero que se debe. Sin ningún saldo distinto de cero, no se pinta. */
function compositionHtml(accounts, famOf) {
  const segments = accounts.filter((a) => a.balance_cents !== 0).map((a) => ({
    name: a.name,
    amount: signedMoney(a.balance_cents),
    value: Math.abs(a.balance_cents),
    fam: famOf(a),
    debt: a.balance_cents < 0,
  }));
  // Deuda al final (B-Patrimonio): lo que tienes, luego lo que debes.
  segments.sort((x, y) => Number(x.debt) - Number(y.debt));
  const bar = stackedBarHtml(segments, { legend: false, label: t("patrimonio.composition.label") });
  if (!bar) return "";
  const have = accounts.reduce((s, a) => s + Math.max(0, a.balance_cents), 0);
  const owe = accounts.reduce((s, a) => s + Math.min(0, a.balance_cents), 0);
  const operational = accounts.filter((a) => a.type === "checking").reduce((s, a) => s + a.balance_cents, 0);
  // «Debes» en el -x de la familia de la deuda, como el original (C7 retirada ahí). Con deudas de
  // familias distintas no hay un color que las nombre a todas: tinta.
  const debtFams = [...new Set(accounts.filter((a) => a.balance_cents < 0).map((a) => famOf(a)))];
  const oweFam = debtFams.length === 1 ? debtFams[0] : null;
  const body = `${bar}
    <div class="pat-split">
      <div class="pat-split-col"><span class="pat-split-label">${escHtml(t("patrimonio.composition.have"))}</span><span class="pat-split-fig num">${escHtml(fmtMoney(have))}</span></div>
      <div class="pat-split-col is-end"><span class="pat-split-label">${escHtml(t("patrimonio.composition.owe"))}</span><span class="pat-split-fig">${famNumHtml(signedMoney(owe), oweFam)}</span></div>
    </div>
    <div class="pat-oper"><span class="pat-oper-label">${escHtml(t("patrimonio.composition.operational"))}</span><span class="num pat-oper-fig">${escHtml(signedMoney(operational))}</span></div>`;
  return containerHtml({ kind: "chart", label: t("patrimonio.composition.label"), body });
}

// ---- Cuentas ----------------------------------------------------------------------------------

const ACCOUNT_TYPES = ["checking", "savings", "liability"];
const TYPE_ORDER = Object.fromEntries(ACCOUNT_TYPES.map((k, i) => [k, i]));
const typeLabel = (type) => t(`patrimonio.accountType.${ACCOUNT_TYPES.includes(type) ? type : "checking"}`);

/** Cabecera de sección con el botón de añadir a la derecha (B-Patrimonio: «Cuentas» +). */
function sectionWithAddHtml({ title, btnId, btnLabel }) {
  return `<div class="pat-sec">${sectionHeaderHtml({ title })}`
    + `<button type="button" class="icon-btn" id="${escAttr(btnId)}" aria-label="${escAttr(btnLabel)}">${icon("plus")}</button></div>`;
}

/** Icono de la cuenta por lo que es: tarjeta, banco, hucha (ahorro enlazado a un objetivo) o recibo. */
function accountIcon(a, linkedGoal) {
  if (a.type === "liability") return "debt";
  if (a.type === "savings") return linkedGoal ? "piggy" : "bank";
  return "card";
}

/** Línea 2 de la tarjeta, en HTML (en --fx, también la cifra de la cuota, como el original):
 *  corriente → «Corriente» / «Corriente, por defecto»; hucha → el objetivo al que sirve; pasivo con
 *  cuota y saldo pendiente → «215,00 €/mes, quedan 20 cuotas»; el resto, su tipo. Un pasivo ya
 *  pagado (saldo ≥ 0) no cuenta cuotas: «quedan 0 cuotas» se leería como un error. */
function accountLineHtml(a, { isDefault, linkedGoal, accountLoans }) {
  if (a.type === "checking") {
    return escHtml(isDefault ? t("patrimonio.accountLine.checkingDefault", { type: typeLabel(a.type) }) : typeLabel(a.type));
  }
  if (a.type === "savings") return escHtml(linkedGoal ? linkedGoal.name : typeLabel(a.type));
  const monthly = Object.hasOwn(accountLoans, a.id) ? accountLoans[a.id]?.monthlyCents : 0;
  if (monthly > 0 && a.balance_cents < 0) {
    const n = Math.ceil(Math.abs(a.balance_cents) / monthly);
    // Todo en el cuerpo y en -x, cifras incluidas, como el «215 €/mes, quedan 20 cuotas» original.
    return escHtml(t("patrimonio.accountLine.installments", { amount: fmtMoney(monthly), n }));
  }
  return escHtml(typeLabel(a.type));
}

/** Tarjeta de cuenta (B-Patrimonio): tinte de su familia, baldosa 40 sobre --chip (también la de
 *  la deuda: la trama va en la barra), nombre 15/600, línea 2 en -x y saldo mono 17/600 en tinta; la
 *  deuda, con «−» y en el -x de su familia, como el original (F-16 retirada, Álvaro 2026-09-27).
 *  Ancha (fila) o media (apilada), según la rejilla. Toda la tarjeta abre la edición. */
function accountCardHtml(a, { fam, wide, isDefault, linkedGoal, accountLoans }) {
  const key = accountIcon(a, linkedGoal);
  // Sin línea 2 cuando solo repetiría el nombre (una cuenta «Ahorro» de tipo Ahorro, B-Patrimonio).
  const lineRaw = accountLineHtml(a, { isDefault, linkedGoal, accountLoans });
  const line = lineRaw.trim().toLowerCase() === escHtml(a.name).trim().toLowerCase() ? "" : lineRaw;
  const tile = tileHtml({ fam, icon: key, onTint: true });
  const fig = a.balance_cents < 0 ? famNumHtml(signedMoney(a.balance_cents), fam) : escHtml(signedMoney(a.balance_cents));
  return `<button type="button" class="pat-acc ${famClass(fam) || "no-fam"}${wide ? " is-wide" : ""}" data-acc="${escAttr(a.id)}">
      ${tile}
      <span class="pat-acc-body">
        <span class="pat-acc-name">${escHtml(a.name)}</span>
        ${line ? `<span class="pat-acc-line">${line}</span>` : ""}
      </span>
      <span class="num pat-acc-fig">${fig}</span>
    </button>`;
}

/** Rejilla de cuentas (B-Patrimonio): corrientes y deudas a lo ancho; las de ahorro, de dos en
 *  dos (si queda una suelta, va a lo ancho para no dejar un hueco). Orden: corriente, ahorro,
 *  deuda (el de la barra). La cuenta «por defecto» es la primera corriente, como hasta ahora. */
function cuentasHtml(accounts, { famOf, linkedGoalOf, accountLoans, defaultAccId }) {
  const header = sectionWithAddHtml({ title: t("patrimonio.accounts.title"), btnId: "btn-nueva-cuenta", btnLabel: t("patrimonio.accounts.new") });
  if (accounts.length === 0) {
    return `${header}${emptyStateHtml({ title: t("patrimonio.accounts.empty"), rows: 1 })}`;
  }
  // meta.default_account_id resuelta (repo.defaultAccountId): la que se elige en el detalle de la
  // cuenta (B-6); sin elegir, la primera corriente, como hasta ahora.
  const defaultId = defaultAccId ?? accounts.find((a) => a.type === "checking")?.id;
  const sorted = [...accounts].sort((x, y) => (TYPE_ORDER[x.type] ?? 0) - (TYPE_ORDER[y.type] ?? 0));
  const savings = sorted.filter((a) => a.type === "savings");
  const loneSavingsId = savings.length % 2 === 1 ? savings[savings.length - 1].id : null;
  const cards = sorted.map((a) => accountCardHtml(a, {
    fam: famOf(a),
    wide: a.type !== "savings" || a.id === loneSavingsId,
    isDefault: a.id === defaultId,
    linkedGoal: linkedGoalOf(a),
    accountLoans,
  })).join("");
  return `${header}<div class="pat-grid">${cards}</div>`;
}

// ---- Objetivos --------------------------------------------------------------------------------

const GOAL_TYPES = ["emergency_fund", "savings_target", "provision", "spending_cap", "savings_rate"];
const goalTypeLabel = (type) => t(`patrimonio.goalType.${GOAL_TYPES.includes(type) ? type : "emergency_fund"}`);

// Tipos con hucha propia (mismo criterio que repo.js#HUCHA_GOAL_TYPES): al crearlos sin cuenta se
// les crea una savings dedicada. El formulario lo usa para la fila y la nota de la hucha.
const HUCHA_GOAL_TYPES = new Set(["emergency_fund", "savings_target", "provision"]);
// La hucha que createGoal creará (savings enlazada a su objetivo): da la familia del bloque del
// formulario de un objetivo nuevo con hucha, antes de que exista la cuenta.
const NEW_HUCHA = { id: "nueva-hucha", type: "savings" };

/** savings_rate guarda puntos porcentuales en currentCents/targetCents (repo.goalProgress): se
 *  muestran como «%»; el resto, como importe. */
function fmtGoalAmount(goal, cents) {
  return goal.type === "savings_rate" ? `${fmtDec1(cents)} %` : fmtMoney(cents);
}

// Anillo de 56 de B-Patrimonio: radio 22 y trazo 6 (circunferencia 2π·22).
const RING_R = 22;
const RING_LEN = 2 * Math.PI * RING_R;

/** Anillo de progreso de la tarjeta de objetivo (B-Patrimonio): pista --raised sobre el tinte (sin
 *  familia, --well), arco del sólido de la familia (-b) y el porcentaje 13/600 en su -x en el
 *  centro. Un techo sobrepasado pinta el porcentaje en --neg (C4). Es un role="img" con el
 *  progreso escrito; el SVG es decorativo. Local a Patrimonio: candidato a pieza compartida si
 *  Inicio (B-Home) dibuja los mismos anillos. */
function goalRingHtml({ fam, pct, over, label }) {
  const ratio = Math.min(1, Math.max(0, pct / 100));
  const arc = Number((RING_LEN * ratio).toFixed(1));
  const pctText = `${Math.round(pct)}%`;
  const pctHtml = over || !fam
    ? `<span class="num pat-ring-pct${over ? " is-over" : ""}">${escHtml(pctText)}</span>`
    : `<span class="pat-ring-pct">${famNumHtml(pctText, fam)}</span>`;
  return `<span class="pat-ring" role="img" aria-label="${escAttr(label)}">
      <svg class="pat-ring-svg" width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
        <circle class="pat-ring-track" cx="28" cy="28" r="${RING_R}" fill="none" stroke-width="6"></circle>
        ${arc > 0 ? `<circle class="pat-ring-arc" cx="28" cy="28" r="${RING_R}" fill="none" stroke-width="6" stroke-linecap="round" stroke-dasharray="${arc} ${Number(RING_LEN.toFixed(1))}"></circle>` : ""}
      </svg>
      ${pctHtml}
    </span>`;
}

/** Tarjeta de objetivo (B-Patrimonio): tinte de la familia de su cuenta (C8) o, sin cuenta (techo
 *  de gasto, tasa de ahorro), --raised con borde (C11). Anillo con el porcentaje, nombre 15/600 y
 *  «actual de objetivo» 13/500 en el -x de la familia, con la cifra actual a 600. Media anchura
 *  siempre, como en el original. */
function goalCardHtml(g, { fam }) {
  const { goal, currentCents, targetCents, pct, level } = g;
  const pctRound = Math.round(pct);
  const line = tNums("patrimonio.goals.ofTarget", { current: fmtGoalAmount(goal, currentCents), target: fmtGoalAmount(goal, targetCents) });
  return `<button type="button" class="pat-goal ${famClass(fam) || "no-fam"}" data-goal="${escAttr(goal.id)}">
      ${goalRingHtml({ fam, pct: Math.max(0, pct), over: level === "over", label: t("patrimonio.goals.progress", { name: goal.name, pct: pctRound }) })}
      <span class="pat-goal-body">
        <span class="pat-goal-name">${escHtml(goal.name)}</span>
        <span class="pat-goal-line">${line}</span>
      </span>
    </button>`;
}

function objetivosHtml(goals, goalFamOf) {
  const header = sectionWithAddHtml({ title: t("patrimonio.goals.title"), btnId: "btn-nuevo-objetivo", btnLabel: t("patrimonio.goals.new") });
  if (goals.length === 0) return `${header}${emptyStateHtml({ title: t("patrimonio.goals.empty"), rows: 1 })}`;
  const cards = goals.map((g) => goalCardHtml(g, { fam: goalFamOf(g.goal) })).join("");
  return `${header}<div class="pat-grid">${cards}</div>`;
}

// ---- Formularios: filas de «Ajustes de la cuenta / del objetivo» (B-Cuenta, B-Objetivo) --------

/** Fila de ajuste de formulario (anatomía de B-Cuenta/B-Objetivo): baldosa rellena del sólido de
 *  la familia con icono claro, etiqueta 15/500 y, a la derecha, el control. Con `forId` la etiqueta
 *  es el <label> del input de la fila; `head` es la cabecera de 30 de una fila con el control
 *  debajo (Tipo, Categoría); `tall`, la de 64 con paso a paso (Meses a cubrir). */
function formRowHtml({ fam, icon: key, label, forId = "", labelId = "", controlHtml = "", head = false, tall = false }) {
  const text = escHtml(label);
  const lab = forId
    ? `<label class="ent-set-label pat-frow-label" for="${escAttr(forId)}">${text}</label>`
    : `<span class="ent-set-label pat-frow-label"${labelId ? ` id="${escAttr(labelId)}"` : ""}>${text}</span>`;
  return `<div class="ent-set pat-frow${head ? " is-head" : ""}${tall ? " is-tall" : ""}">`
    + `${tileHtml({ fam, icon: key, size: 30, filled: true })}${lab}${controlHtml}</div>`;
}

/** El valor de la fila ES el input (B-Cuenta: «Cuenta corriente», «1.480,15 €» en el -x de la
 *  familia, a la derecha): sin pozo, 16 (K9) y con la unidad detrás en el mismo color. */
function inlineInputHtml({ id, fam, value = "", type = "text", inputmode = "", placeholder = "", num = false, suffix = "" }) {
  const ink = famClass(fam) ? `${famClass(fam)} is-fam-ink` : "";
  return `<input class="pat-input${num ? " is-num" : ""}${ink ? ` ${ink}` : ""}" id="${escAttr(id)}" type="${escAttr(type)}" value="${escAttr(value)}"`
    + `${inputmode ? ` inputmode="${escAttr(inputmode)}"` : ""}${placeholder ? ` placeholder="${escAttr(placeholder)}"` : ""} autocomplete="off">`
    + `${suffix ? `<span class="pat-input-suffix${num ? " num" : ""}${ink ? ` ${ink}` : ""}" aria-hidden="true">${escHtml(suffix)}</span>` : ""}`;
}

/** Valor de solo lectura de una fila (Tipo de un objetivo ya creado, Hucha vinculada), en -x. */
function rowValueHtml(text, fam) {
  const ink = famClass(fam) ? ` ${famClass(fam)} is-fam-ink` : "";
  return `<span class="ent-set-value${ink}">${escHtml(text)}</span>`;
}

const SEP = '<div class="pat-sep" aria-hidden="true"></div>';

// ---- Pantalla ---------------------------------------------------------------------------------

/** Pantalla «Patrimonio»: Display, composición, cuentas y objetivos, con subvistas de formulario
 *  para crear/editar cuentas y objetivos (view interno 'main' | 'account-form' | 'goal-form', sin
 *  onBack: Patrimonio es pestaña de nivel superior y la subvista vuelve a su propio 'main').
 *  Tocar una cuenta abre su detalle (B-6, screens/cuenta.js), con su propia entrada de historial;
 *  el formulario de la cuenta se abre desde ahí y vuelve al detalle. Igual con un objetivo:
 *  su detalle (B-7, screens/objetivo.js), y desde él su formulario. */
export async function renderPatrimonio(container) {
  let series, accounts, goals, expenseRootCats, byId, accountLoans, accountStyle;
  let defaultAccId = null;

  async function loadData() {
    // accountLoans y accountStyle (meta.account_loans / meta.account_style) solo los usa esta
    // pantalla: se leen en cada loadData, sin estado global (mismo criterio que getAccountLoans).
    [series, accounts, goals, expenseRootCats, byId, accountLoans, accountStyle] = await Promise.all([
      netWorthSeries(), balancesAt(hoyISO()), goalsWithProgress(), listExpenseRootCategories(), allCategoriesById(),
      getAccountLoans(), getAccountStyle(),
    ]);
    defaultAccId = await defaultAccountId();
  }

  try {
    await loadData();
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso is-error">${t("patrimonio.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }

  const rawGoals = () => goals.map((g) => g.goal);
  const accountsById = () => Object.fromEntries(accounts.map((a) => [a.id, a]));
  const famOf = (a) => familyForAccount(a, accountStyle, rawGoals());
  const linkedGoalOf = (a) => rawGoals().find((g) => g.account_id && g.account_id === a.id) ?? null;
  const goalFamOf = (goal) => goalFamily(goal, accountsById(), accountStyle);

  const state = {
    view: "main",
    editingAccountId: null, accountForm: null,
    editingGoalId: null, goalForm: null, detailGoalId: null,
    opening: false, // apertura de formulario de cuenta en curso (ver openAccountEdit)
  };
  let errorMsg = "";

  const errorHtml = () => (errorMsg ? `<div class="banner-aviso is-error">${escHtml(errorMsg)}</div>` : "");

  function backToMain() {
    state.view = "main";
    state.editingAccountId = null; state.accountForm = null;
    state.editingGoalId = null; state.goalForm = null;
    errorMsg = "";
    render();
  }

  /** Tras un render que rehace el formulario, devuelve el foco al control que lo pidió (K12). */
  function refocus(selector) {
    container.querySelector(selector)?.focus();
  }

  function shake(id) {
    const b = container.querySelector(`#${id}`);
    if (!b) return;
    b.classList.add("shake");
    setTimeout(() => b.classList.remove("shake"), 400);
  }

  // ---- subvista: formulario de cuenta --------------------------------------

  function openAccountNew() {
    state.editingAccountId = null;
    state.accountForm = {
      name: "", type: "checking", raw: "", cents: 0, sign: "+", loanRaw: "", loanCents: 0,
      fam: defaultFamilyForAccount({ type: "checking" }, []), famTouched: false, hasOverride: false,
    };
    errorMsg = "";
    pushBack(backToMain);
    state.view = "account-form";
    render();
  }

  async function openAccountEdit(id, { fromDetail = false } = {}) {
    // Guard de apertura en curso: la vista principal sigue viva durante el await, y dos toques
    // seguidos apuntarían DOS entradas de historial para un solo formulario abierto.
    if (state.opening) return;
    state.opening = true;
    let row;
    try {
      row = await getAccount(id);
    } catch (e) {
      state.opening = false;
      // Desde el detalle, la pantalla que se ve es la de la cuenta: aviso sin repintar Patrimonio.
      if (fromDetail) { showToast(t("patrimonio.error.openAccount", { error: userMessage(e) })); return; }
      errorMsg = t("patrimonio.error.openAccount", { error: userMessage(e) });
      render();
      return;
    }
    if (!row) { state.opening = false; return; }
    state.editingAccountId = id;
    // monthlyCents: de accountLoans (meta.account_loans), no de `row` — no vive en la tabla.
    const monthlyCents = accountLoans[id]?.monthlyCents ?? 0;
    state.accountForm = {
      name: row.name, savedName: row.name, type: row.type,
      raw: centsToRaw(Math.abs(row.opening_balance_cents)),
      cents: Math.abs(row.opening_balance_cents),
      sign: row.opening_balance_cents < 0 ? "-" : "+",
      loanRaw: monthlyCents ? centsToRaw(monthlyCents) : "", loanCents: monthlyCents,
      fam: familyForAccount(row, accountStyle, rawGoals()), famTouched: false,
      hasOverride: Object.hasOwn(accountStyle, id),
    };
    errorMsg = "";
    pushBack(fromDetail ? () => backToAccountDetail(id) : backToMain);
    state.view = "account-form";
    state.opening = false;
    render();
  }

  // ---- subvista: detalle de cuenta (B-6, screens/cuenta.js) -----------------

  /** Pinta el detalle SIN apuntar historial (lo apunta openAccountDetail; el volver del
   *  formulario y el de un movimiento repintan sobre la misma entrada). Si la cuenta ya no
   *  existe, vuelve. */
  async function showAccountDetail(id) {
    const shown = await renderCuenta(container, id, {
      onBack: () => goBack(),
      onEdit: () => openAccountEdit(id, { fromDetail: true }),
    });
    if (!shown) goBack();
  }

  /** Toque en una cuenta: el detalle, con su entrada de historial. Al volver se recargan los
   *  datos: desde el detalle se pueden editar la cuenta y sus movimientos. */
  async function openAccountDetail(id) {
    if (state.opening) return;
    state.opening = true;
    pushBack(async () => {
      try { await loadData(); } catch { /* se pinta lo que había */ }
      backToMain();
    });
    try {
      await showAccountDetail(id);
    } finally {
      state.opening = false;
    }
  }

  /** Vuelta del formulario abierto desde el detalle: al detalle, recargado. */
  function backToAccountDetail(id) {
    state.view = "main";
    state.editingAccountId = null; state.accountForm = null;
    errorMsg = "";
    showAccountDetail(id);
  }

  /** Quién usa ya cada familia (para «la usa X» / «la misma que X», C8): primero las otras
   *  cuentas, luego las categorías raíz de gasto. La colisión se acepta; el icono las distingue. */
  function familyUsers(excludeAccountId) {
    const users = {};
    for (const a of accounts) {
      if (a.id === excludeAccountId) continue;
      const fam = famOf(a);
      if (fam && !users[fam]) users[fam] = a.name;
    }
    for (const c of expenseRootCats) {
      const fam = familyForCategory(c.id, byId);
      if (fam && !users[fam]) users[fam] = c.name;
    }
    return users;
  }

  function renderAccountForm() {
    const f = state.accountForm;
    const editing = !!state.editingAccountId;
    const users = familyUsers(state.editingAccountId);
    const colorName = (fam) => t(`families.${fam}`);
    const swatches = familySwatchesHtml({
      id: "cuenta-fam",
      label: t("patrimonio.account.color"),
      value: f.fam,
      options: FAMILIES.map((fam) => ({
        fam,
        label: users[fam] ? t("patrimonio.account.colorUsedBy", { color: colorName(fam), name: users[fam] }) : colorName(fam),
      })),
    });
    const famHint = users[f.fam]
      ? escHtml(t("patrimonio.account.colorShared", { color: colorName(f.fam), name: users[f.fam] }))
        .replace(escHtml(colorName(f.fam)), `<b class="pat-hint-strong">${escHtml(colorName(f.fam))}</b>`)
      : `<b class="pat-hint-strong">${escHtml(colorName(f.fam))}</b>`;

    const fam = f.fam;
    const money = { inputmode: "decimal", placeholder: "0", num: true, suffix: currencySymbol(), fam };
    // B-Cuenta: título con el nombre de la cuenta y su baldosa delante (F-15 retirada, Álvaro
    // 2026-09-27). El nombre es el guardado: el que se está tecleando va en su fila.
    const title = editing ? f.savedName : t("patrimonio.accounts.new");
    container.innerHTML = `
      ${subHeaderHtml({ id: "cuenta-back", title, leadHtml: tileHtml({ fam, icon: accountIcon({ type: f.type }, editing ? linkedGoalOf({ id: state.editingAccountId }) : null), size: 32 }) })}
      <div class="pat-form">
        <section class="pat-group">
          ${sectionHeaderHtml({ title: t("patrimonio.account.settings"), level: "group", fam })}
          <div class="pat-block ${famClass(fam) || "no-fam"}">
            ${formRowHtml({ fam, icon: "pencil", label: t("common.name"), forId: "cuenta-name",
              controlHtml: inlineInputHtml({ id: "cuenta-name", fam, value: f.name, placeholder: t("common.egPlaceholder", { example: "Revolut" }) }) })}
            ${SEP}
            <div class="pat-sub">
              ${formRowHtml({ fam, icon: "grid", label: t("common.typeLabel"), labelId: "cuenta-tipo-label", head: true })}
              ${segmentedHtml({ id: "cuenta-tipo", name: t("common.typeLabel"), labelledBy: "cuenta-tipo-label", value: f.type, options: ACCOUNT_TYPES.map((k) => ({ value: k, label: typeLabel(k) })) })}
            </div>
            ${SEP}
            ${formRowHtml({ fam, icon: "chart", label: t("patrimonio.account.openingBalance"), forId: "cuenta-raw",
              controlHtml: `<button type="button" class="icon-btn pat-sign" id="cuenta-sign" aria-label="${escAttr(t("common.changeSign"))}">${f.sign === "-" ? MINUS : "+"}</button>`
                + inlineInputHtml({ id: "cuenta-raw", value: f.raw, ...money }) })}
            ${f.type === "liability" ? SEP + formRowHtml({ fam, icon: "calendar", label: t("patrimonio.account.monthlyInstallment"), forId: "cuenta-loan-raw",
              controlHtml: inlineInputHtml({ id: "cuenta-loan-raw", value: f.loanRaw, ...money }) }) : ""}
          </div>
          <p class="pat-help">${escHtml(t(f.type === "liability" ? "patrimonio.account.note.liability" : "patrimonio.account.note.default"))}</p>
        </section>

        <section class="pat-group">
          ${sectionHeaderHtml({ title: t("patrimonio.account.color"), level: "group", fam })}
          ${swatches}
          <p class="pat-help ${famClass(f.fam)}">${famHint}</p>
        </section>

        ${errorHtml()}
        ${buttonHtml({ kind: "primary", id: "cuenta-save", label: editing ? t("common.saveChanges") : t("patrimonio.account.create") })}
      </div>
    `;

    wireAccountForm();
  }

  function wireAccountForm() {
    const f = state.accountForm;
    container.querySelector("#cuenta-back").onclick = () => goBack();
    container.querySelector("#cuenta-name").oninput = (e) => { f.name = e.target.value; };

    wireSegmented(container.querySelector("#cuenta-tipo"), (type) => {
      f.type = type;
      // Solo empuja el signo a negativo si el importe todavía no se ha tocado: no pisa un
      // valor que el usuario ya haya escrito a mano.
      if (f.type === "liability" && f.cents === 0) f.sign = "-";
      // La familia sigue al tipo mientras nadie la haya elegido (C8: por defecto según el tipo).
      if (!f.famTouched && !f.hasOverride) {
        f.fam = defaultFamilyForAccount({ id: state.editingAccountId, type }, rawGoals());
      }
      render();
      refocus('#cuenta-tipo [aria-checked="true"]');
    });

    container.querySelectorAll("#cuenta-fam [data-fam]").forEach((b) => {
      b.onclick = () => {
        f.fam = b.dataset.fam;
        f.famTouched = true;
        render();
        refocus(`#cuenta-fam [data-fam="${f.fam}"]`);
      };
    });

    container.querySelector("#cuenta-sign").onclick = () => {
      f.sign = f.sign === "+" ? "-" : "+";
      render();
      refocus("#cuenta-sign");
    };

    container.querySelector("#cuenta-raw").oninput = (e) => {
      f.raw = e.target.value;
      // Math.abs: el signo lo pone el botón, no lo tecleado.
      f.cents = Math.abs(parseCentsRaw(f.raw));
      errorMsg = "";
    };

    const loanRawInput = container.querySelector("#cuenta-loan-raw");
    if (loanRawInput) loanRawInput.oninput = (e) => {
      f.loanRaw = e.target.value;
      // Math.abs: sin él, un «-189» tecleado guardaría monthlyCents negativo, que setAccountLoan
      // interpretaría como «borrar la cuota» en silencio.
      f.loanCents = Math.abs(parseCentsRaw(f.loanRaw));
      errorMsg = "";
    };

    container.querySelector("#cuenta-save").onclick = async () => {
      const btn = container.querySelector("#cuenta-save");
      if (!f.name.trim()) {
        errorMsg = t("patrimonio.account.validation.name");
        render();
        shake("cuenta-save");
        return;
      }
      btn.disabled = true;
      try {
        const openingBalanceCents = f.sign === "-" ? -f.cents : f.cents;
        // Cuota mensual: solo en pasivos. Otro tipo manda 0, que setAccountLoan lee como «borrar
        // la entrada» (no queda una cuota huérfana al pasar de pasivo a otra cosa).
        const monthlyCents = f.type === "liability" ? f.loanCents : 0;
        let accountId = state.editingAccountId;
        if (accountId) {
          await updateAccount(accountId, { name: f.name.trim(), type: f.type, openingBalanceCents });
        } else {
          accountId = await createAccount({ name: f.name.trim(), type: f.type, openingBalanceCents });
        }
        await setAccountLoan(accountId, monthlyCents);
        // Familia (C8): solo se escribe si se eligió a mano. Si coincide con la de su tipo, se
        // borra el override para que siga al tipo. Solo cuando coincide con y sin objetivos: el
        // defecto de una cuenta de ahorro depende de si su objetivo está activo (listGoals no trae
        // los pausados), así que en ella la familia elegida se guarda siempre como override.
        if (f.famTouched) {
          const acc = { id: accountId, type: f.type };
          const byDefault = f.fam === defaultFamilyForAccount(acc, rawGoals()) && f.fam === defaultFamilyForAccount(acc, []);
          await setAccountFamily(accountId, byDefault ? null : f.fam);
        }
        await loadData();
        goBack();
      } catch (e) {
        btn.disabled = false;
        errorMsg = t("common.saveFailed", { error: userMessage(e) });
        render();
      }
    };
  }

  // ---- subvista: formulario de objetivo ------------------------------------

  function openGoalNew() {
    state.editingGoalId = null;
    state.goalForm = {
      name: "", type: "emergency_fund", raw: "", cents: 0, months: 3, pct: "",
      targetDate: "", categoryId: null, isActive: true, accountName: "", goal: null,
    };
    errorMsg = "";
    pushBack(backToMain);
    state.view = "goal-form";
    render();
  }

  // Desde el detalle (B-7), «atrás» y guardar/borrar vuelven al detalle, no a la lista.
  function openGoalEdit(goal, onBack = backToMain) {
    state.editingGoalId = goal.id;
    state.goalForm = {
      name: goal.name, type: goal.type,
      raw: goal.target_amount_cents ? centsToRaw(goal.target_amount_cents) : "",
      cents: goal.target_amount_cents ?? 0,
      months: goal.target_months != null ? Number(goal.target_months) : 3,
      pct: goal.target_pct != null ? String(goal.target_pct).replace(".", ",") : "",
      targetDate: goal.target_date || "",
      categoryId: goal.category_id || null,
      isActive: !!goal.is_active,
      accountName: accountsById()[goal.account_id]?.name ?? "",
      goal,
    };
    errorMsg = "";
    pushBack(onBack);
    state.view = "goal-form";
    render();
  }

  function validationGoal() {
    const f = state.goalForm;
    if (!f.name.trim()) return t("patrimonio.goal.validation.name");
    if (f.type === "emergency_fund") {
      if (!(f.months >= 1)) return t("patrimonio.goal.validation.months");
    } else if (f.type === "savings_target" || f.type === "provision") {
      if (f.cents <= 0) return t("patrimonio.goal.validation.amount");
    } else if (f.type === "spending_cap") {
      if (f.cents <= 0) return t("patrimonio.goal.validation.amount");
      if (!f.categoryId) return t("common.pickCategory");
    } else if (f.type === "savings_rate") {
      const p = parseFloat((f.pct || "0").replace(",", "."));
      if (!p || p <= 0) return t("patrimonio.goal.validation.savingsRate");
    }
    return "";
  }

  /** Arma los fields camelCase que espera createGoal/updateGoal. Los 3 campos NULLABLE_NUM
   *  (target_amount_cents/target_months/target_pct) se ponen a `null` EXPLÍCITAMENTE salvo el
   *  que use el tipo elegido. accountId no se toca aquí: al crear, createGoal decide sola si le
   *  crea hucha; al editar, updateGoal conserva la cuenta ya vinculada. */
  function buildGoalFields() {
    const f = state.goalForm;
    const fields = {
      name: f.name.trim(), type: f.type,
      targetAmountCents: null, targetMonths: null, targetPct: null,
      targetDate: "", categoryId: "", isActive: f.isActive,
    };
    if (f.type === "emergency_fund") fields.targetMonths = f.months || null;
    if (f.type === "savings_target") { fields.targetAmountCents = f.cents; fields.targetDate = f.targetDate || ""; }
    if (f.type === "provision") fields.targetAmountCents = f.cents;
    if (f.type === "spending_cap") { fields.targetAmountCents = f.cents; fields.categoryId = f.categoryId || ""; }
    if (f.type === "savings_rate") fields.targetPct = parseFloat((f.pct || "0").replace(",", ".")) || null;
    return fields;
  }

  /** Campos que dependen del tipo: meses (paso a paso, B-Objetivo), porcentaje, importe, fecha y
   *  categoría del techo de gasto (chips de filtro con la familia de cada categoría). */
  function goalConditionalHtml(f, fam) {
    if (f.type === "emergency_fund") {
      return formRowHtml({ fam, icon: "calendar", label: t("patrimonio.goal.monthsLabel"), labelId: "goal-months-label", tall: true,
        controlHtml: stepperHtml({ id: "goal-months", value: String(f.months), decId: "goal-months-dec", incId: "goal-months-inc", decLabel: t("patrimonio.goal.monthLess"), incLabel: t("patrimonio.goal.monthMore") }) });
    }
    if (f.type === "savings_rate") {
      return formRowHtml({ fam, icon: "chart", label: t("patrimonio.goal.pctLabel"), forId: "goal-pct",
        controlHtml: inlineInputHtml({ id: "goal-pct", fam, value: f.pct, inputmode: "decimal", placeholder: "20", num: true, suffix: "%" }) });
    }
    const amountLabel = f.type === "provision" ? t("patrimonio.goal.amountLabel.annual") : t("patrimonio.goal.amountLabel.default");
    const amount = formRowHtml({ fam, icon: "currency", label: amountLabel, forId: "goal-raw",
      controlHtml: inlineInputHtml({ id: "goal-raw", fam, value: f.raw, inputmode: "decimal", placeholder: "0", num: true, suffix: currencySymbol() }) });
    if (f.type === "savings_target") {
      return `${amount}${SEP}${formRowHtml({ fam, icon: "calendar", label: t("patrimonio.goal.dateLabel"), forId: "goal-date",
        controlHtml: inlineInputHtml({ id: "goal-date", fam, type: "date", value: f.targetDate }) })}`;
    }
    if (f.type === "spending_cap") {
      const chips = expenseRootCats.map((c) => filterChipHtml({
        fam: familyForCategory(c.id, byId), label: c.name, selected: f.categoryId === c.id, data: { goalCat: c.id },
      })).join("");
      return `${amount}${SEP}
        <div class="pat-sub">
          ${formRowHtml({ fam, icon: "grid", label: t("common.category"), labelId: "goal-cat-label", head: true })}
          <div class="pat-chips" role="group" aria-labelledby="goal-cat-label">${chips}</div>
        </div>`;
    }
    return amount; // provision
  }

  function renderGoalForm() {
    const f = state.goalForm;
    const editing = !!state.editingGoalId;
    const isHucha = HUCHA_GOAL_TYPES.has(f.type);
    // La familia del bloque es la de su cuenta (C8). Uno nuevo con hucha tendrá una savings
    // enlazada, cuya familia por defecto es la de hucha; sin hucha no hay familia (C11).
    const fam = editing ? goalFamOf(f.goal) : isHucha ? defaultFamilyForAccount(NEW_HUCHA, [{ account_id: NEW_HUCHA.id }]) : null;
    const progress = editing ? goals.find((x) => x.goal.id === state.editingGoalId) : null;

    const typeHtml = editing
      ? formRowHtml({ fam, icon: "grid", label: t("common.typeLabel"), controlHtml: rowValueHtml(goalTypeLabel(f.type), fam) })
      : `<div class="pat-sub">
          ${formRowHtml({ fam, icon: "grid", label: t("common.typeLabel"), labelId: "goal-tipo-label", head: true })}
          <div class="pat-chips" role="group" aria-labelledby="goal-tipo-label">
            ${GOAL_TYPES.map((k) => filterChipHtml({ label: goalTypeLabel(k), selected: f.type === k, data: { goalTipo: k } })).join("")}
          </div>
        </div>`;

    const progressHtml = progress ? containerHtml({
      kind: "chart",
      label: t("patrimonio.goal.savedToday"),
      body: `<div class="pat-row">
          <span class="pat-row-label">${escHtml(t("patrimonio.goal.savedToday"))}</span>
          <span class="num pat-progress-fig">${escHtml(fmtGoalAmount(progress.goal, progress.currentCents))}</span>
        </div>
        ${meterHtml({ fam, value: Math.max(0, progress.pct), max: 100 })}
        <span class="num pat-progress-pct">${Math.round(progress.pct)} %</span>`,
    }) : "";

    const helpKey = editing ? "patrimonio.goal.typeLockedNote" : isHucha ? "patrimonio.goal.autoSavingsNote" : "";

    // B-Objetivo: el título es el nombre del objetivo (el guardado, no el que se teclea).
    const title = editing ? f.goal.name : t("patrimonio.goals.new");
    container.innerHTML = `
      ${subHeaderHtml({ id: "goal-back", title })}
      <div class="pat-form">
        ${progressHtml}
        <section class="pat-group">
          ${sectionHeaderHtml({ title: t("patrimonio.goal.settings"), level: "group", fam })}
          <div class="pat-block ${famClass(fam) || "no-fam"}">
            ${formRowHtml({ fam, icon: "pencil", label: t("common.name"), forId: "goal-name",
              controlHtml: inlineInputHtml({ id: "goal-name", fam, value: f.name, placeholder: t("common.egPlaceholder", { example: goalTypeLabel(f.type) }) }) })}
            ${SEP}
            ${typeHtml}
            ${SEP}
            ${goalConditionalHtml(f, fam)}
            ${editing && isHucha ? SEP + formRowHtml({ fam, icon: "piggy", label: t("patrimonio.goal.linkedSavings"), controlHtml: rowValueHtml(f.accountName || "—", fam) }) : ""}
            ${SEP}
            ${settingRowHtml({ id: "goal-active-row", icon: "check", fam, tileFilled: true, label: t("patrimonio.goal.activeLabel"), controlHtml: switchHtml({ id: "goal-active", checked: f.isActive, label: t("patrimonio.goal.activeLabel") }) })}
          </div>
          ${helpKey ? `<p class="pat-help">${escHtml(t(helpKey))}</p>` : ""}
        </section>

        ${errorHtml()}
        <div class="pat-actions">
          ${buttonHtml({ kind: "primary", id: "goal-save", label: editing ? t("common.saveChanges") : t("patrimonio.goal.create") })}
          ${editing ? buttonHtml({ kind: "tertiary-danger", id: "goal-delete", label: t("patrimonio.goal.delete"), icon: "trash" }) : ""}
        </div>
      </div>
    `;

    wireGoalForm();
  }

  function wireGoalForm() {
    const f = state.goalForm;
    container.querySelector("#goal-back").onclick = () => goBack();
    container.querySelector("#goal-name").oninput = (e) => { f.name = e.target.value; };

    container.querySelectorAll("[data-goal-tipo]").forEach((b) => {
      b.onclick = () => {
        f.type = b.dataset.goalTipo;
        errorMsg = "";
        render();
        refocus(`[data-goal-tipo="${f.type}"]`);
      };
    });

    const rawInput = container.querySelector("#goal-raw");
    if (rawInput) rawInput.oninput = (e) => {
      f.raw = e.target.value;
      f.cents = parseCentsRaw(f.raw);
      errorMsg = "";
    };

    // Paso a paso de meses: se actualiza en su sitio (sin render), así el foco no se mueve.
    const monthsValue = container.querySelector("#goal-months .ctl-stepper-value");
    // Sin re-render el lector de pantalla no se entera del valor nuevo: se anuncia en vivo (K12).
    monthsValue?.setAttribute("aria-live", "polite");
    const stepMonths = (d) => {
      f.months = Math.min(99, Math.max(1, (f.months || 1) + d));
      if (monthsValue) monthsValue.textContent = String(f.months);
      errorMsg = "";
    };
    const dec = container.querySelector("#goal-months-dec");
    const inc = container.querySelector("#goal-months-inc");
    if (dec) dec.onclick = () => stepMonths(-1);
    if (inc) inc.onclick = () => stepMonths(1);

    const pctInput = container.querySelector("#goal-pct");
    if (pctInput) pctInput.oninput = (e) => { f.pct = e.target.value; errorMsg = ""; };

    const dateInput = container.querySelector("#goal-date");
    if (dateInput) dateInput.onchange = (e) => { f.targetDate = e.target.value; };

    container.querySelectorAll("[data-goal-cat]").forEach((b) => {
      b.onclick = () => {
        f.categoryId = b.dataset.goalCat;
        errorMsg = "";
        render();
        refocus(`[data-goal-cat="${f.categoryId}"]`);
      };
    });

    const activeSwitch = container.querySelector("#goal-active");
    activeSwitch.onclick = () => {
      f.isActive = !f.isActive;
      activeSwitch.setAttribute("aria-checked", f.isActive ? "true" : "false");
    };

    container.querySelector("#goal-save").onclick = async () => {
      const btn = container.querySelector("#goal-save");
      const msg = validationGoal();
      if (msg) {
        errorMsg = msg;
        render();
        shake("goal-save");
        return;
      }
      btn.disabled = true;
      try {
        const fields = buildGoalFields();
        if (state.editingGoalId) await updateGoal(state.editingGoalId, fields);
        else await createGoal(fields);
        await loadData();
        goBack();
      } catch (e) {
        btn.disabled = false;
        errorMsg = t("common.saveFailed", { error: userMessage(e) });
        render();
      }
    };

    const deleteBtn = container.querySelector("#goal-delete");
    if (deleteBtn) deleteBtn.onclick = () => {
      showConfirm({
        title: t("patrimonio.goal.deleteTitle"),
        message: t("patrimonio.goal.deleteMessage", { name: f.name }),
        cancelText: t("common.cancel"),
        confirmText: t("common.delete"),
        onConfirm: async () => {
          const btn = container.querySelector("#goal-delete");
          if (btn) btn.disabled = true;
          try {
            await softDeleteGoal(state.editingGoalId);
            await loadData();
            goBack();
          } catch (e) {
            if (btn) btn.disabled = false;
            errorMsg = t("common.deleteFailed", { error: userMessage(e) });
            render();
          }
        },
      });
    };
  }

  // ---- subvista: detalle de objetivo (B-7, screens/objetivo.js) -------------

  /** Toque en la tarjeta: abre el detalle. Al volver se recargan los datos (el detalle puede haber
   *  pasado dinero a la hucha, cambiado los meses, pausado o borrado el objetivo). */
  function openGoalDetail(id) {
    pushBack(async () => {
      try { await loadData(); } catch (e) { errorMsg = t("patrimonio.error.load", { error: userMessage(e) }); }
      backToMain();
    });
    showGoalDetail(id);
  }

  function showGoalDetail(id) {
    state.view = "goal-detail";
    state.detailGoalId = id;
    state.editingGoalId = null; state.goalForm = null;
    errorMsg = "";
    renderObjetivo(container, { goalId: id, onEdit: (goal) => openGoalEdit(goal, () => showGoalDetail(id)) });
  }

  // ---- vista principal ------------------------------------------------------

  function renderMain() {
    container.innerHTML = `
      <div class="pat">
        ${rootHeaderHtml({ title: t("patrimonio.title") })}
        ${errorHtml()}
        ${netWorthDisplayHtml(netWorthOfBalances(accounts), series)}
        ${compositionHtml(accounts, famOf)}
        ${cuentasHtml(accounts, { famOf, linkedGoalOf, accountLoans, defaultAccId })}
        ${objetivosHtml(goals, goalFamOf)}
      </div>
    `;
    wireMain();
  }

  function wireMain() {
    const nuevaCuentaBtn = container.querySelector("#btn-nueva-cuenta");
    if (nuevaCuentaBtn) nuevaCuentaBtn.onclick = () => openAccountNew();

    const nuevoObjetivoBtn = container.querySelector("#btn-nuevo-objetivo");
    if (nuevoObjetivoBtn) nuevoObjetivoBtn.onclick = () => openGoalNew();

    container.querySelectorAll("[data-acc]").forEach((b) => {
      b.onclick = () => openAccountDetail(b.dataset.acc);
    });
    container.querySelectorAll("[data-goal]").forEach((b) => {
      b.onclick = () => {
        const g = goals.find((x) => x.goal.id === b.dataset.goal);
        if (g) openGoalDetail(g.goal.id);
      };
    });
  }

  function render() {
    if (state.view === "account-form") renderAccountForm();
    else if (state.view === "goal-form") renderGoalForm();
    else if (state.view === "goal-detail") showGoalDetail(state.detailGoalId);
    else renderMain();
  }

  render();
}
