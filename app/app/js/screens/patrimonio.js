import {
  balancesAt, netWorthOfBalances, netWorthSeries, goalsWithProgress,
  getAccount, createAccount, updateAccount, listExpenseRootCategories, allCategoriesById,
  createGoal, updateGoal, softDeleteGoal, getAccountLoans, setAccountLoan,
  getAccountStyle, setAccountFamily,
} from "../repo.js";
import { familyForCategory, famClass, FAMILIES } from "../category-colors.js";
import { familyForAccount, defaultFamilyForAccount, goalFamily, isDebt } from "../account-colors.js";
import { fmtMoney, hoyISO, fmtDec1, currencySymbol, parseCentsRaw, centsToRaw } from "../format.js";
import { sparklineSvg } from "../charts.js";
import { t } from "../i18n/index.js";
import { pushBack, goBack } from "../back.js";
import { userMessage } from "../errors.js";
import { showConfirm } from "../modal.js";
import { rootHeaderHtml, subHeaderHtml, buttonHtml } from "../ui.js";
import { segmentedHtml, wireSegmented, switchHtml, stepperHtml, fieldHtml } from "../controls.js";
import { tileHtml, filterChipHtml, settingRowHtml, sectionHeaderHtml, familySwatchesHtml } from "../entity.js";
import { displayHtml, ledHtml, stackedBarHtml, meterHtml, containerHtml, emptyStateHtml } from "../instrument.js";
import { icon } from "../icons.js";
import { escHtml, escAttr } from "../esc.js";

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

/** Display xl (B-Patrimonio): cifra neta, LED «Sube»/«Baja», delta del periodo en el pie y la línea
 *  de los últimos ≤6 puntos de netWorthSeries (cerrados + hoy) con su eje de meses. La variación
 *  es el último punto (hoy) contra el penúltimo (el último cierre). Sin ningún cierre (menos de 2
 *  puntos) no hay con qué comparar: ni LED, ni delta, ni línea. El delta positivo va en --ok (C4:
 *  deltas dentro del Display); el negativo en --disp-ink con «−», porque --neg no llega a 3:1 sobre
 *  el panel oscuro. */
function netWorthDisplayHtml(netWorthCents, series) {
  const pts = series.slice(-6);
  const n = pts.length;
  if (n < 2) {
    return displayHtml({ label: t("patrimonio.netWorth.title"), value: fmtMoney(netWorthCents), size: "xl" });
  }
  const variation = pts[n - 1].cents - pts[n - 2].cents;
  const up = variation >= 0;
  const footHtml = `<span class="num pat-delta ${up ? "is-up" : "is-down"}">${escHtml(signedMoney(variation, { plus: true }))}</span> ${escHtml(t("patrimonio.netWorth.thisPeriod"))}`;
  return displayHtml({
    label: t("patrimonio.netWorth.title"),
    value: fmtMoney(netWorthCents),
    size: "xl",
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
  const body = `${bar}
    <div class="pat-split">
      <div class="pat-split-col"><span class="pat-split-label">${escHtml(t("patrimonio.composition.have"))}</span><span class="num pat-split-fig">${escHtml(fmtMoney(have))}</span></div>
      <div class="pat-split-col is-end"><span class="pat-split-label">${escHtml(t("patrimonio.composition.owe"))}</span><span class="num pat-split-fig">${escHtml(signedMoney(owe))}</span></div>
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

/** Línea 2 de la tarjeta, en HTML (texto en --fx; la cifra de la cuota, en tinta dim — C7):
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
    return tNums("patrimonio.accountLine.installments", { amount: fmtMoney(monthly) }, { n });
  }
  return escHtml(typeLabel(a.type));
}

/** Tarjeta de cuenta (B-Patrimonio): tinte de su familia, baldosa 40 sobre --chip (la deuda, con
 *  la trama), nombre 15/600, línea 2 y saldo mono 17/600 en tinta (la deuda con «−», también en
 *  tinta: F-16). Ancha (fila) o media (apilada), según la rejilla. Toda la tarjeta abre la edición. */
function accountCardHtml(a, { fam, wide, isDefault, linkedGoal, accountLoans }) {
  const key = accountIcon(a, linkedGoal);
  // Sin línea 2 cuando solo repetiría el nombre (una cuenta «Ahorro» de tipo Ahorro, B-Patrimonio).
  const lineRaw = accountLineHtml(a, { isDefault, linkedGoal, accountLoans });
  const line = lineRaw.trim().toLowerCase() === escHtml(a.name).trim().toLowerCase() ? "" : lineRaw;
  const tile = isDebt(a)
    ? `<span class="ent-tile ${famClass(fam)} acc-debt">${icon(key)}</span>`
    : tileHtml({ fam, icon: key, onTint: true });
  return `<button type="button" class="pat-acc ${famClass(fam) || "no-fam"}${wide ? " is-wide" : ""}" data-acc="${escAttr(a.id)}">
      ${tile}
      <span class="pat-acc-body">
        <span class="pat-acc-name">${escHtml(a.name)}</span>
        ${line ? `<span class="pat-acc-line">${line}</span>` : ""}
      </span>
      <span class="num pat-acc-fig">${escHtml(signedMoney(a.balance_cents))}</span>
    </button>`;
}

/** Rejilla de cuentas (B-Patrimonio): corrientes y deudas a lo ancho; las de ahorro, de dos en
 *  dos (si queda una suelta, va a lo ancho para no dejar un hueco). Orden: corriente, ahorro,
 *  deuda (el de la barra). La cuenta «por defecto» es la primera corriente, como hasta ahora. */
function cuentasHtml(accounts, { famOf, linkedGoalOf, accountLoans }) {
  const header = sectionWithAddHtml({ title: t("patrimonio.accounts.title"), btnId: "btn-nueva-cuenta", btnLabel: t("patrimonio.accounts.new") });
  if (accounts.length === 0) {
    return `${header}${emptyStateHtml({ title: t("patrimonio.accounts.empty"), rows: 1 })}`;
  }
  const defaultId = accounts.find((a) => a.type === "checking")?.id;
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

/** Tarjeta de objetivo (B-Patrimonio, con medidor en vez de anillo según el brief de S3): tinte de
 *  la familia de su cuenta (C8) o, sin cuenta (techo de gasto, tasa de ahorro), --raised con borde
 *  y medidor --idle (C11). Nombre, medidor, «actual de objetivo» en --fx con las cifras en tinta y
 *  el porcentaje a la derecha; un techo de gasto sobrepasado lo marca en --neg (C4). */
function goalCardHtml(g, { fam, wide }) {
  const { goal, currentCents, targetCents, pct, level } = g;
  const pctRound = Math.round(pct);
  const line = tNums("patrimonio.goals.ofTarget", { current: fmtGoalAmount(goal, currentCents), target: fmtGoalAmount(goal, targetCents) });
  return `<button type="button" class="pat-goal ${famClass(fam) || "no-fam"}${wide ? " is-wide" : ""}" data-goal="${escAttr(goal.id)}">
      <span class="pat-goal-name">${escHtml(goal.name)}</span>
      ${meterHtml({ fam, value: Math.max(0, pct), max: 100, onTint: Boolean(fam), label: t("patrimonio.goals.progress", { name: goal.name, pct: pctRound }) })}
      <span class="pat-goal-foot">
        <span class="pat-goal-line">${line}</span>
        <span class="num pat-goal-pct${level === "over" ? " is-over" : ""}">${pctRound} %</span>
      </span>
    </button>`;
}

function objetivosHtml(goals, goalFamOf) {
  const header = sectionWithAddHtml({ title: t("patrimonio.goals.title"), btnId: "btn-nuevo-objetivo", btnLabel: t("patrimonio.goals.new") });
  if (goals.length === 0) return `${header}${emptyStateHtml({ title: t("patrimonio.goals.empty"), rows: 1 })}`;
  const odd = goals.length % 2 === 1;
  const cards = goals.map((g, i) => goalCardHtml(g, { fam: goalFamOf(g.goal), wide: odd && i === goals.length - 1 })).join("");
  return `${header}<div class="pat-grid">${cards}</div>`;
}

// ---- Pantalla ---------------------------------------------------------------------------------

/** Pantalla «Patrimonio»: Display, composición, cuentas y objetivos, con subvistas de formulario
 *  para crear/editar cuentas y objetivos (view interno 'main' | 'account-form' | 'goal-form', sin
 *  onBack: Patrimonio es pestaña de nivel superior y la subvista vuelve a su propio 'main'). El
 *  detalle de cuenta (B-6) y de objetivo (B-7) es lógica nueva bloqueada: un toque sigue abriendo
 *  la edición. */
export async function renderPatrimonio(container) {
  let series, accounts, goals, expenseRootCats, byId, accountLoans, accountStyle;

  async function loadData() {
    // accountLoans y accountStyle (meta.account_loans / meta.account_style) solo los usa esta
    // pantalla: se leen en cada loadData, sin estado global (mismo criterio que getAccountLoans).
    [series, accounts, goals, expenseRootCats, byId, accountLoans, accountStyle] = await Promise.all([
      netWorthSeries(), balancesAt(hoyISO()), goalsWithProgress(), listExpenseRootCategories(), allCategoriesById(),
      getAccountLoans(), getAccountStyle(),
    ]);
  }

  try {
    await loadData();
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">${t("patrimonio.error.load", { error: escHtml(userMessage(e)) })}</div>`;
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
    editingGoalId: null, goalForm: null,
    opening: false, // apertura de formulario de cuenta en curso (ver openAccountEdit)
  };
  let errorMsg = "";

  const errorHtml = () => (errorMsg ? `<div class="banner-aviso red">${escHtml(errorMsg)}</div>` : "");

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

  async function openAccountEdit(id) {
    // Guard de apertura en curso: la vista principal sigue viva durante el await, y dos toques
    // seguidos apuntarían DOS entradas de historial para un solo formulario abierto.
    if (state.opening) return;
    state.opening = true;
    let row;
    try {
      row = await getAccount(id);
    } catch (e) {
      errorMsg = t("patrimonio.error.openAccount", { error: userMessage(e) });
      state.opening = false;
      render();
      return;
    }
    if (!row) { state.opening = false; return; }
    state.editingAccountId = id;
    // monthlyCents: de accountLoans (meta.account_loans), no de `row` — no vive en la tabla.
    const monthlyCents = accountLoans[id]?.monthlyCents ?? 0;
    state.accountForm = {
      name: row.name, type: row.type,
      raw: centsToRaw(Math.abs(row.opening_balance_cents)),
      cents: Math.abs(row.opening_balance_cents),
      sign: row.opening_balance_cents < 0 ? "-" : "+",
      loanRaw: monthlyCents ? centsToRaw(monthlyCents) : "", loanCents: monthlyCents,
      fam: familyForAccount(row, accountStyle, rawGoals()), famTouched: false,
      hasOverride: Object.hasOwn(accountStyle, id),
    };
    errorMsg = "";
    pushBack(backToMain);
    state.view = "account-form";
    state.opening = false;
    render();
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

    container.innerHTML = `
      ${subHeaderHtml({ id: "cuenta-back", title: editing ? t("patrimonio.account.title.edit") : t("patrimonio.accounts.new") })}
      <div class="pat-form">
        <section class="pat-group">
          ${sectionHeaderHtml({ title: t("patrimonio.account.settings"), level: "group" })}
          <div class="pat-block ${famClass(f.fam) || "no-fam"}">
            ${fieldHtml({ id: "cuenta-name", label: t("common.name"), value: f.name, placeholder: t("common.egPlaceholder", { example: "Revolut" }) })}
            <div class="pat-field">
              <span class="ctl-field-label" id="cuenta-tipo-label">${escHtml(t("common.typeLabel"))}</span>
              ${segmentedHtml({ id: "cuenta-tipo", name: t("common.typeLabel"), labelledBy: "cuenta-tipo-label", value: f.type, options: ACCOUNT_TYPES.map((k) => ({ value: k, label: typeLabel(k) })) })}
            </div>
            <div class="pat-amount-row">
              <button type="button" class="icon-btn pat-sign" id="cuenta-sign" aria-label="${escAttr(t("common.changeSign"))}">${f.sign === "-" ? MINUS : "+"}</button>
              ${fieldHtml({ id: "cuenta-raw", label: t("patrimonio.account.openingBalance"), value: f.raw, inputmode: "decimal", placeholder: "0", num: true, suffix: currencySymbol() })}
            </div>
            ${f.type === "liability" ? fieldHtml({ id: "cuenta-loan-raw", label: t("patrimonio.account.monthlyInstallment"), value: f.loanRaw, inputmode: "decimal", placeholder: "0", num: true, suffix: currencySymbol() }) : ""}
          </div>
          <p class="pat-help">${escHtml(t(f.type === "liability" ? "patrimonio.account.note.liability" : "patrimonio.account.note.default"))}</p>
        </section>

        <section class="pat-group">
          ${sectionHeaderHtml({ title: t("patrimonio.account.color"), level: "group" })}
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
        // borra el override para que siga al tipo.
        if (f.famTouched) {
          const byDefault = defaultFamilyForAccount({ id: accountId, type: f.type }, rawGoals());
          await setAccountFamily(accountId, f.fam === byDefault ? null : f.fam);
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

  function openGoalEdit(goal) {
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
    pushBack(backToMain);
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
  function goalConditionalHtml(f) {
    if (f.type === "emergency_fund") {
      return `<div class="pat-row">
        <span class="pat-row-label" id="goal-months-label">${escHtml(t("patrimonio.goal.monthsLabel"))}</span>
        ${stepperHtml({ id: "goal-months", value: String(f.months), decId: "goal-months-dec", incId: "goal-months-inc", decLabel: t("patrimonio.goal.monthLess"), incLabel: t("patrimonio.goal.monthMore") })}
      </div>`;
    }
    if (f.type === "savings_rate") {
      return fieldHtml({ id: "goal-pct", label: t("patrimonio.goal.pctLabel"), value: f.pct, inputmode: "decimal", placeholder: "20", num: true, suffix: "%" });
    }
    const amountLabel = f.type === "provision" ? t("patrimonio.goal.amountLabel.annual") : t("patrimonio.goal.amountLabel.default");
    const amount = fieldHtml({ id: "goal-raw", label: amountLabel, value: f.raw, inputmode: "decimal", placeholder: "0", num: true, suffix: currencySymbol() });
    if (f.type === "savings_target") {
      return `${amount}${fieldHtml({ id: "goal-date", label: t("patrimonio.goal.dateLabel"), type: "date", value: f.targetDate })}`;
    }
    if (f.type === "spending_cap") {
      const chips = expenseRootCats.map((c) => filterChipHtml({
        fam: familyForCategory(c.id, byId), label: c.name, selected: f.categoryId === c.id, data: { goalCat: c.id },
      })).join("");
      return `${amount}
        <div class="pat-field">
          <span class="ctl-field-label" id="goal-cat-label">${escHtml(t("common.category"))}</span>
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
      ? `<div class="pat-row"><span class="pat-row-label">${escHtml(t("common.typeLabel"))}</span><span class="pat-row-value">${escHtml(goalTypeLabel(f.type))}</span></div>`
      : `<div class="pat-field">
          <span class="ctl-field-label" id="goal-tipo-label">${escHtml(t("common.typeLabel"))}</span>
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

    container.innerHTML = `
      ${subHeaderHtml({ id: "goal-back", title: editing ? t("patrimonio.goal.title.edit") : t("patrimonio.goals.new") })}
      <div class="pat-form">
        ${progressHtml}
        <section class="pat-group">
          ${sectionHeaderHtml({ title: t("patrimonio.goal.settings"), level: "group" })}
          <div class="pat-block ${famClass(fam) || "no-fam"}">
            ${fieldHtml({ id: "goal-name", label: t("common.name"), value: f.name, placeholder: t("common.egPlaceholder", { example: goalTypeLabel(f.type) }) })}
            ${typeHtml}
            ${goalConditionalHtml(f)}
            ${editing && isHucha ? `<div class="pat-row"><span class="pat-row-label">${escHtml(t("patrimonio.goal.linkedSavings"))}</span><span class="pat-row-value">${escHtml(f.accountName || "—")}</span></div>` : ""}
            ${settingRowHtml({ id: "goal-active-row", label: t("patrimonio.goal.activeLabel"), controlHtml: switchHtml({ id: "goal-active", checked: f.isActive, label: t("patrimonio.goal.activeLabel") }) })}
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

  // ---- vista principal ------------------------------------------------------

  function renderMain() {
    container.innerHTML = `
      <div class="pat">
        ${rootHeaderHtml({ title: t("patrimonio.title") })}
        ${errorHtml()}
        ${netWorthDisplayHtml(netWorthOfBalances(accounts), series)}
        ${compositionHtml(accounts, famOf)}
        ${cuentasHtml(accounts, { famOf, linkedGoalOf, accountLoans })}
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
      b.onclick = () => openAccountEdit(b.dataset.acc);
    });
    container.querySelectorAll("[data-goal]").forEach((b) => {
      b.onclick = () => {
        const g = goals.find((x) => x.goal.id === b.dataset.goal);
        if (g) openGoalEdit(g.goal);
      };
    });
  }

  function render() {
    if (state.view === "account-form") renderAccountForm();
    else if (state.view === "goal-form") renderGoalForm();
    else renderMain();
  }

  render();
}
