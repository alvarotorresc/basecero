import {
  balancesAt, netWorthOfBalances, netWorthSeries, goalsWithProgress,
  getAccount, createAccount, updateAccount, listExpenseRootCategories, allCategoriesById,
  createGoal, updateGoal, softDeleteGoal, getAccountLoans, setAccountLoan,
} from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtMoney, fmtMoneyParts, moneyPartsHtml, hoyISO, fmtDec1, currencySymbol, parseCentsRaw, centsToRaw } from "../format.js";
import { netWorthBarsHtml } from "../charts.js";
import { t } from "../i18n/index.js";
import { pushBack, goBack } from "../back.js";
import { userMessage } from "../errors.js";
import { showConfirm } from "../modal.js";
import { subHeaderHtml, metaHtml } from "../ui.js";
import { icon } from "../icons.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// ---- tarjeta "Patrimonio neto" --------------------------------------------

/** Tarjeta "Patrimonio neto": importe héroe (.amount-hero.lg, 56px) + variación en texto plano
 *  (sin píldora, sin flecha, §1.6) + línea de "operativo" (suma de las cuentas checking, el
 *  subconjunto que ya lee balancesAt) + evolución en barras (netWorthBarsHtml, charts.js) —
 *  réplica de Patrimonio.dc.html:24-40. La variación es el propio penúltimo vs último punto de
 *  `series` (el último es siempre "hoy"; el penúltimo, si existe, es el del último cerrado —
 *  mismos puntos que ya trae netWorthSeries, sin repetir la query, y que pinta netWorthBarsHtml).
 *  Sin ningún cerrado (series.length<2) no hay nada con qué comparar: se oculta la variación. */
function netWorthCardHtml(netWorthCents, series, accounts) {
  const n = series.length;
  const variation = n >= 2 ? series[n - 1].cents - series[n - 2].cents : null;
  const operationalCents = accounts
    .filter((a) => a.type === "checking")
    .reduce((sum, a) => sum + a.balance_cents, 0);

  // Anatomía del importe (§2.3) a mano, no moneyPartsHtml: sus tres spans fijan su propio color
  // (money-cents en --ink-2, money-cur en --ink-3, app.css:780-781), que aquí pisaría el verde/
  // rojo de la variación entera — el mismo problema que resuelve .amount-hero.text-green para el
  // héroe, pero a 20px (no es un .amount-hero), así que se construye aquí en vez de reutilizarlo.
  const variationHtml = variation === null ? "" : (() => {
    const up = variation >= 0;
    const color = up ? "var(--pos)" : "var(--danger)";
    const { main, cents, suffix } = fmtMoneyParts(variation);
    return `
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">
      <div class="num" style="display:flex;align-items:baseline;font-size:20px;font-weight:600;letter-spacing:-.01em;color:${color};">
        ${up ? "+" : ""}${escHtml(main)}<span style="font-size:14px;">${escHtml(cents)}</span><span style="font-size:12px;font-weight:500;margin-left:2px;">${escHtml(suffix)}</span>
      </div>
      <span style="font-size:13px;color:var(--ink-2);">${t("patrimonio.netWorth.thisPeriod")}</span>
    </div>`;
  })();

  const barsHtml = netWorthBarsHtml(series);

  return `
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
      <div class="section-title">${t("patrimonio.netWorth.title")}</div>
      <div class="amount-hero lg num">${moneyPartsHtml(netWorthCents)}</div>
      ${variationHtml}
      <div style="font-size:11px;color:var(--ink-3);">${t("patrimonio.operational", { amount: escHtml(fmtMoney(operationalCents)) })}</div>
      ${barsHtml ? `<div style="margin-top:6px;">${barsHtml}</div>` : ""}
    </div>`;
}

// ---- tarjeta "Cuentas" -----------------------------------------------------

// SISTEMA.md §2.2 es explícito: una cuenta no tiene ni icono ni color propios — se identifica
// por su nombre y su tipo ESCRITOS. La fila ya no lleva insignia (Task 7, P2): esto reemplaza al
// antiguo ACCOUNT_ICON, que se borra con su único consumidor (cuentaRowHtml).
const ACCOUNT_TYPES = [
  { id: "checking", labelKey: "patrimonio.accountType.checking" },
  { id: "savings", labelKey: "patrimonio.accountType.savings" },
  { id: "liability", labelKey: "patrimonio.accountType.liability" },
];
const ACCOUNT_TYPE_KEY = Object.fromEntries(ACCOUNT_TYPES.map((at) => [at.id, at.labelKey]));

/** Segmentos del sub de una fila de cuenta, para metaHtml([tipo, …]): el tipo (mismo texto que
 *  el chip del formulario) y, opcionalmente, un segundo dato — "Por defecto" en la cuenta
 *  corriente por defecto, o "quedan N cuotas" en un PASIVO con cuota mensual definida (Task 6,
 *  meta.account_loans — ver account-defaults.js#sanitizeLoanMap y repo.setAccountLoan/
 *  getAccountLoans) = techo(|balance| / monthlyCents) — balance_cents es negativo en un pasivo,
 *  de ahí el valor absoluto. Un pasivo ya pagado (saldo 0, o en positivo si se pagó de más) no
 *  tiene ninguna cuota que contar, y Math.ceil(0 / monthlyCents) daba «quedan 0 cuotas», que se
 *  lee como un error de la app — cae al tipo solo, igual que un pasivo sin cuota definida. */
function accountSubtitleSegments(a, isDefault, accountLoans) {
  const typeLabel = t(ACCOUNT_TYPE_KEY[a.type] ?? ACCOUNT_TYPE_KEY.checking);
  if (a.type === "checking") return [typeLabel, isDefault ? t("patrimonio.accountSubtitle.default") : null];
  if (a.type === "savings") return [typeLabel];
  const monthlyCents = accountLoans[a.id]?.monthlyCents;
  if (monthlyCents > 0 && a.balance_cents < 0) {
    const n = Math.ceil(Math.abs(a.balance_cents) / monthlyCents);
    return [typeLabel, t("patrimonio.accountSubtitle.installmentsLeft", { n })];
  }
  return [typeLabel];
}

/** Fila de cuenta (60px, §2.2): sin insignia ni icono — solo nombre + tipo escrito. Un pasivo va
 *  entero (las tres partes del importe) en --danger. */
function cuentaRowHtml(a, isDefault, accountLoans) {
  const isLiability = a.type === "liability";
  return `
    <button type="button" class="list-row" data-acc="${a.id}"
      style="width:100%;min-height:60px;text-align:left;background:none;border:0;padding:10px 0;cursor:pointer;-webkit-tap-highlight-color:transparent;">
      <div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:0;">
        <span style="font-size:15px;font-weight:500;color:var(--ink);">${escHtml(a.name)}</span>
        ${metaHtml(accountSubtitleSegments(a, isDefault, accountLoans))}
      </div>
      <div class="num" style="flex-shrink:0;font-size:16px;font-weight:500;${isLiability ? "color:var(--danger);" : ""}">${moneyPartsHtml(a.balance_cents)}</div>
    </button>`;
}

/** Cabecera de sección compartida por "Cuentas" y "Objetivos" (SISTEMA.md §4.6): título 15/600 +
 *  divisor de 1px + recuento en metaHtml (§1.3) + .icon-btn de 44px con icon("plus") a la
 *  derecha. El divisor es el mismo `.meta-sep` que publica ui.js — se reutiliza su markup en vez
 *  de duplicar la regla, aunque aquí no venga de una llamada a metaHtml (el título no es un
 *  segmento de metadatos: lleva su propio tamaño y color, --t-section/--ink, no --t-label/
 *  --ink-3). */
function sectionHeaderHtml({ title, count, btnId, btnLabel }) {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="section-title">${escHtml(title)}</span>
        <span class="meta-sep" aria-hidden="true"></span>
        ${metaHtml([count])}
      </div>
      <button type="button" class="icon-btn" id="${escAttr(btnId)}" aria-label="${escAttr(btnLabel)}">${icon("plus")}</button>
    </div>`;
}

/** Tarjeta "Cuentas": una fila por cuenta activa (balancesAt ya excluye archivadas/borradas),
 *  separadas por <hr class="divider"> — réplica de Patrimonio.dc.html:61-125, + botón "Nueva
 *  cuenta" en la cabecera. Cada fila abre la subvista de edición. */
function cuentasCardHtml(accounts, accountLoans) {
  const n = accounts.length;
  const header = sectionHeaderHtml({
    title: t("patrimonio.accounts.title"),
    count: t("patrimonio.accounts.countActive", { n }),
    btnId: "btn-nueva-cuenta", btnLabel: t("patrimonio.accounts.new"),
  });

  if (n === 0) {
    return `
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
        ${header}
        <div class="card" style="text-align:center;color:var(--ink-3);">${t("patrimonio.accounts.empty")}</div>
      </div>`;
  }

  const firstCheckingId = accounts.find((a) => a.type === "checking")?.id;
  const rowsHtml = accounts.map((a) => cuentaRowHtml(a, a.id === firstCheckingId, accountLoans)).join('<hr class="divider">');

  return `
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
      ${header}
      <div style="display:flex;flex-direction:column;">
        ${rowsHtml}
      </div>
    </div>`;
}

// ---- tarjeta "Objetivos" ---------------------------------------------------

const LEVEL_COLOR = { ok: "var(--pos)", warn: "var(--warn)", over: "var(--danger)" };

const GOAL_TYPES = [
  { id: "emergency_fund", labelKey: "patrimonio.goalType.emergency_fund" },
  { id: "savings_target", labelKey: "patrimonio.goalType.savings_target" },
  { id: "provision", labelKey: "patrimonio.goalType.provision" },
  { id: "spending_cap", labelKey: "patrimonio.goalType.spending_cap" },
  { id: "savings_rate", labelKey: "patrimonio.goalType.savings_rate" },
];
const GOAL_TYPE_KEY = Object.fromEntries(GOAL_TYPES.map((gt) => [gt.id, gt.labelKey]));

// Tipos con hucha propia (mismo criterio que repo.js#HUCHA_GOAL_TYPES): al crearlos sin cuenta
// se les crea una savings dedicada — el formulario (renderGoalForm) usa este set para saber
// cuándo mostrar la nota/bloque de "hucha vinculada" al editar. Ya NO decide el layout de la
// fila en la tarjeta Objetivos (Task 6, P2): los tres tipos de goal se pintan igual, en barra —
// spec §3.1.9, "barra para los tres, nunca anillo".
const HUCHA_GOAL_TYPES = new Set(["emergency_fund", "savings_target", "provision"]);

/** savings_rate guarda puntos porcentuales en currentCents/targetCents (ver repo.goalProgress):
 *  se muestran como "%", el resto de tipos como € (fmtMoney). */
function fmtGoalAmount(goal, cents) {
  return goal.type === "savings_rate" ? `${fmtDec1(cents)} %` : fmtMoney(cents);
}

/** Fila de un goal, SIEMPRE en barra (§3.1.9 — nunca anillo, ya no hay ring): título + "actual /
 *  objetivo", barra .bar de 8px, y al pie "{current} de {target}" + la etiqueta corta del tipo
 *  (Hucha / Límite de gasto, D15 — las frases largas de repo.goalProgress se quedan donde ya
 *  estaban, p.ej. PeriodoNuevo) unidos con el divisor de metaHtml, y el porcentaje a la derecha —
 *  réplica de Patrimonio.dc.html:138-190. El color (verde/ámbar/rojo) sigue el `level` de
 *  repo.goalProgress: solo se colorea texto cuando level≠'ok'; la barra es la única que lleva
 *  siempre su color de estado. Solo la fila SIN hucha (spending_cap) lleva `.dotico.sm` con el
 *  emoji de su categoría, delante del nombre. La fila entera es un botón: abre la subvista de
 *  edición. */
function goalBarRowHtml(g, byId) {
  const { goal, currentCents, targetCents, pct, level } = g;
  const barColor = LEVEL_COLOR[level];
  const stateColor = level === "ok" ? null : LEVEL_COLOR[level];
  const barPct = Math.min(100, Math.max(0, pct));
  const isCap = goal.type === "spending_cap";
  const doticoHtml = isCap
    ? `<div class="dotico sm" style="--cat:${colorForCategory(goal.category_id, byId)};" aria-hidden="true">${iconForCategory(goal.category_id, byId)}</div>`
    : "";
  const kindLabel = t(isCap ? "patrimonio.goals.kind.cap" : "patrimonio.goals.kind.savings");

  return `
    <button type="button" data-goal="${goal.id}"
      style="width:100%;text-align:left;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;display:flex;flex-direction:column;gap:9px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          ${doticoHtml}
          <span style="font-size:15px;font-weight:600;color:var(--ink);">${escHtml(goal.name)}</span>
        </div>
        <div class="num" style="font-size:15px;font-weight:600;color:${stateColor ?? "var(--ink)"};white-space:nowrap;flex-shrink:0;">
          ${fmtGoalAmount(goal, currentCents)} <span style="color:var(--ink-3);">/ ${fmtGoalAmount(goal, targetCents)}</span>
        </div>
      </div>
      <div class="bar" style="--cat:${barColor};">
        <i style="width:${barPct}%;"></i>
      </div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
        ${metaHtml([t("patrimonio.goals.ofTarget", { current: fmtGoalAmount(goal, currentCents), target: fmtGoalAmount(goal, targetCents) }), kindLabel])}
        <span class="num" style="font-size:12px;font-weight:700;color:${stateColor ?? "var(--ink-2)"};white-space:nowrap;flex-shrink:0;">${Math.round(pct)} %</span>
      </div>
    </button>`;
}

/** Tarjeta "Objetivos": una fila por goal activo, siempre en barra — réplica de
 *  Patrimonio.dc.html:127-190, + botón "Nuevo objetivo" en la cabecera. Cada fila abre la
 *  subvista de edición. */
function objetivosCardHtml(goals, byId) {
  const n = goals.length;
  const header = sectionHeaderHtml({
    title: t("patrimonio.goals.title"),
    count: t("patrimonio.goals.countActive", { n }),
    btnId: "btn-nuevo-objetivo", btnLabel: t("patrimonio.goals.new"),
  });

  if (n === 0) {
    return `
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${header}
        <div class="card" style="text-align:center;color:var(--ink-3);">${t("patrimonio.goals.empty")}</div>
      </div>`;
  }

  return `
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${header}
      <div style="display:flex;flex-direction:column;gap:24px;">
        ${goals.map((g) => goalBarRowHtml(g, byId)).join("")}
      </div>
    </div>`;
}

/** Pantalla "Patrimonio" (Task 13 + formularios de Task 14): cabecera + tarjeta de patrimonio
 *  neto (con su evolución) + tarjeta Cuentas + tarjeta Objetivos, con subvistas de formulario
 *  para crear/editar cuentas y objetivos (mismo patrón detalle que movimientos.js/recurrentes.js:
 *  view interno 'main' | 'account-form' | 'goal-form', sin onBack — Patrimonio es pestaña de
 *  nivel superior, la subvista siempre vuelve a su propio 'main'). */
export async function renderPatrimonio(container) {
  let series, accounts, goals, expenseRootCats, byId, accountLoans;

  async function loadData() {
    // accountLoans (meta.account_loans, Task 6): a diferencia de category_style, que se
    // inicializa como singleton en el boot (main.js) porque colorForCategory/iconForCategory se
    // llaman desde varias pantallas, account_loans SOLO lo usa Patrimonio (accountSubtitle) — se
    // carga aquí en cada loadData en vez de un estado global, sin tocar main.js.
    [series, accounts, goals, expenseRootCats, byId, accountLoans] = await Promise.all([
      netWorthSeries(), balancesAt(hoyISO()), goalsWithProgress(), listExpenseRootCategories(), allCategoriesById(),
      getAccountLoans(),
    ]);
  }

  try {
    await loadData();
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">${t("patrimonio.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }

  const accountNameById = () => Object.fromEntries(accounts.map((a) => [a.id, a.name]));

  const state = {
    view: "main",
    editingAccountId: null, accountForm: null,
    editingGoalId: null, goalForm: null,
    opening: false, // apertura de formulario de cuenta en curso (ver openAccountEdit)
  };
  let errorMsg = "";

  function backToMain() {
    state.view = "main";
    state.editingAccountId = null; state.accountForm = null;
    state.editingGoalId = null; state.goalForm = null;
    errorMsg = "";
    render();
  }

  // ---- subvista: formulario de cuenta --------------------------------------

  function openAccountNew() {
    state.editingAccountId = null;
    state.accountForm = { name: "", type: "checking", raw: "", cents: 0, sign: "+", loanRaw: "", loanCents: 0 };
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
    // monthlyCents (Task 6): precarga desde accountLoans (cargado en loadData), no desde `row` —
    // vive en meta.account_loans, no en la tabla accounts (config-in-meta, sin migración).
    const monthlyCents = accountLoans[id]?.monthlyCents ?? 0;
    state.accountForm = {
      name: row.name, type: row.type,
      raw: centsToRaw(row.opening_balance_cents),
      cents: Math.abs(row.opening_balance_cents),
      sign: row.opening_balance_cents < 0 ? "-" : "+",
      loanRaw: centsToRaw(monthlyCents), loanCents: monthlyCents,
    };
    errorMsg = "";
    pushBack(backToMain);
    state.view = "account-form";
    state.opening = false;
    render();
  }

  function renderAccountForm() {
    const f = state.accountForm;
    const editing = !!state.editingAccountId;

    container.innerHTML = `
      ${subHeaderHtml({ id: "acc-back", title: editing ? t("patrimonio.account.title.edit") : t("patrimonio.accounts.new") })}

      <label class="field field-stack" style="margin-bottom:18px;">
        <span class="field-label">${t("common.name")}</span>
        <input type="text" id="acc-name" value="${escAttr(f.name)}" placeholder="${t("common.egPlaceholder", { example: "Revolut" })}">
      </label>

      <div class="segmented" style="margin-bottom:18px;">
        ${ACCOUNT_TYPES.map((at) => `<button type="button" data-acc-tipo="${at.id}" class="${f.type === at.id ? "active" : ""}">${t(at.labelKey)}</button>`).join("")}
      </div>

      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:8px;">
        <div class="section-title">${t("patrimonio.account.openingBalance")}</div>
        <div class="amount-display" style="align-items:center;">
          <button type="button" class="icon-btn" id="acc-sign" aria-label="${t("common.changeSign")}" style="font-size:18px; font-weight:700;">${f.sign}</button>
          <input type="text" inputmode="decimal" id="acc-raw" value="${escAttr(f.raw)}" placeholder="0"
            style="border:0;background:none;color:var(--text);font:600 56px var(--font-num);letter-spacing:-0.02em;width:100%;outline:none;">
          <span class="amount-currency">${currencySymbol()}</span>
        </div>
        <hr class="divider" style="margin-top:6px;">
      </div>
      <div style="font-size:11px;color:var(--text-3);margin-bottom:18px;">
        ${f.type === "liability"
          ? t("patrimonio.account.note.liability")
          : t("patrimonio.account.note.default")}
      </div>

      ${f.type === "liability" ? `
      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px;">
        <div class="section-title">${t("patrimonio.account.monthlyInstallment")}</div>
        <div class="amount-display" style="align-items:center;">
          <input type="text" inputmode="decimal" id="acc-loan-raw" value="${escAttr(f.loanRaw)}" placeholder="0"
            style="border:0;background:none;color:var(--text);font:600 32px var(--font-num);letter-spacing:-0.02em;width:100%;outline:none;">
          <span class="amount-currency">${currencySymbol()}</span>
        </div>
        <hr class="divider" style="margin-top:6px;">
      </div>` : ""}

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      <button type="button" class="btn-primary" id="acc-save">${editing ? t("common.saveChanges") : t("patrimonio.account.create")}</button>
    `;

    wireAccountForm();
  }

  function wireAccountForm() {
    const f = state.accountForm;
    container.querySelector("#acc-back").onclick = () => goBack();

    container.querySelector("#acc-name").oninput = (e) => { f.name = e.target.value; };

    container.querySelectorAll("[data-acc-tipo]").forEach((b) => {
      b.onclick = () => {
        f.type = b.dataset.accTipo;
        // Solo empuja el signo a negativo si el importe todavía no se ha tocado: no pisa un
        // valor que el usuario ya haya escrito a mano.
        if (f.type === "liability" && f.cents === 0) f.sign = "-";
        render();
      };
    });

    container.querySelector("#acc-sign").onclick = () => { f.sign = f.sign === "+" ? "-" : "+"; render(); };

    container.querySelector("#acc-raw").oninput = (e) => {
      f.raw = e.target.value;
      f.cents = parseCentsRaw(f.raw);
      errorMsg = "";
    };

    const loanRawInput = container.querySelector("#acc-loan-raw");
    if (loanRawInput) loanRawInput.oninput = (e) => {
      f.loanRaw = e.target.value;
      // Math.abs: a diferencia de #acc-raw (saldo), este campo no tiene botón de signo — pero
      // parseCentsRaw respeta el signo tecleado (el flip queda siempre en el llamante, ver
      // format.js). En un pasivo el signo de #acc-raw ya suele ser "-": sin este abs, un usuario
      // que teclee "-189" aquí guardaría monthlyCents negativo, que setAccountLoan interpretaría
      // como "borrar la cuota" en silencio, sin ningún aviso.
      f.loanCents = Math.abs(parseCentsRaw(f.loanRaw));
      errorMsg = "";
    };

    container.querySelector("#acc-save").onclick = async () => {
      const btn = container.querySelector("#acc-save");
      if (!f.name.trim()) {
        errorMsg = t("patrimonio.account.validation.name");
        render();
        const savedBtn = container.querySelector("#acc-save");
        savedBtn.classList.add("shake");
        setTimeout(() => savedBtn.classList.remove("shake"), 400);
        return;
      }
      btn.disabled = true;
      try {
        const openingBalanceCents = f.sign === "-" ? -f.cents : f.cents;
        // Cuota mensual (Task 6): solo se persiste para pasivos — un tipo distinto manda
        // monthlyCents 0, que setAccountLoan interpreta como "borrar la entrada" (p.ej. si el
        // usuario cambia el tipo de la cuenta de pasivo a otra cosa, no debe quedar una cuota
        // huérfana en meta.account_loans).
        const monthlyCents = f.type === "liability" ? f.loanCents : 0;
        let accountId = state.editingAccountId;
        if (accountId) {
          await updateAccount(accountId, { name: f.name.trim(), type: f.type, openingBalanceCents });
        } else {
          accountId = await createAccount({ name: f.name.trim(), type: f.type, openingBalanceCents });
        }
        await setAccountLoan(accountId, monthlyCents);
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
      name: "", type: "emergency_fund", raw: "", cents: 0, months: "", pct: "",
      targetDate: "", categoryId: null, isActive: true, accountName: "",
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
      raw: centsToRaw(goal.target_amount_cents ?? 0),
      cents: goal.target_amount_cents ?? 0,
      months: goal.target_months != null ? String(goal.target_months) : "",
      pct: goal.target_pct != null ? String(goal.target_pct).replace(".", ",") : "",
      targetDate: goal.target_date || "",
      categoryId: goal.category_id || null,
      isActive: !!goal.is_active,
      accountName: accountNameById()[goal.account_id] ?? "",
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
      const m = parseInt(f.months, 10);
      if (!m || m < 1) return t("patrimonio.goal.validation.months");
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
   *  que use el tipo elegido — así al editar un goal y cambiarle el tipo, los campos del tipo
   *  anterior se limpian en vez de quedar con un valor obsoleto. accountId no se toca aquí:
   *  al crear, createGoal decide sola si le crea hucha; al editar, updateGoal conserva la
   *  cuenta ya vinculada (no se permite cambiarla desde este formulario). */
  function buildGoalFields() {
    const f = state.goalForm;
    const fields = {
      name: f.name.trim(), type: f.type,
      targetAmountCents: null, targetMonths: null, targetPct: null,
      targetDate: "", categoryId: "", isActive: f.isActive,
    };
    if (f.type === "emergency_fund") fields.targetMonths = parseInt(f.months, 10) || null;
    if (f.type === "savings_target") { fields.targetAmountCents = f.cents; fields.targetDate = f.targetDate || ""; }
    if (f.type === "provision") fields.targetAmountCents = f.cents;
    if (f.type === "spending_cap") { fields.targetAmountCents = f.cents; fields.categoryId = f.categoryId || ""; }
    if (f.type === "savings_rate") fields.targetPct = parseFloat((f.pct || "0").replace(",", ".")) || null;
    return fields;
  }

  function renderGoalConditionalFields(f) {
    if (f.type === "emergency_fund") {
      return `
      <label class="field field-stack" style="margin-bottom:18px;">
        <span class="field-label">${t("patrimonio.goal.monthsLabel")}</span>
        <input type="number" min="1" id="goal-months" value="${escAttr(f.months)}" placeholder="${t("common.egPlaceholder", { example: "3" })}">
      </label>`;
    }
    if (f.type === "savings_rate") {
      return `
      <label class="field field-stack" style="margin-bottom:18px;">
        <span class="field-label">${t("patrimonio.goal.pctLabel")}</span>
        <input type="text" inputmode="decimal" id="goal-pct" value="${escAttr(f.pct)}" placeholder="${t("common.egPlaceholder", { example: "20" })}">
      </label>`;
    }
    // savings_target / provision / spending_cap: los 3 llevan un importe objetivo.
    const amountLabel = f.type === "provision" ? t("patrimonio.goal.amountLabel.annual") : t("patrimonio.goal.amountLabel.default");
    const amountHtml = `
      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px;">
        <div class="section-title">${amountLabel}</div>
        <div class="amount-display" style="align-items:center;">
          <input type="text" inputmode="decimal" id="goal-raw" value="${escAttr(f.raw)}" placeholder="0"
            style="border:0;background:none;color:var(--text);font:600 56px var(--font-num);letter-spacing:-0.02em;width:100%;outline:none;">
          <span class="amount-currency">${currencySymbol()}</span>
        </div>
        <hr class="divider" style="margin-top:6px;">
      </div>`;

    if (f.type === "savings_target") {
      return `${amountHtml}
      <label class="field field-stack" style="margin-bottom:18px;">
        <span class="field-label">${t("patrimonio.goal.dateLabel")}</span>
        <input type="date" id="goal-date" value="${escAttr(f.targetDate)}">
      </label>`;
    }

    if (f.type === "spending_cap") {
      return `${amountHtml}
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">${t("common.category")}</div>
        <div class="chips-scroll">
          ${expenseRootCats.map((c) => {
            const color = colorForCategory(c.id, byId);
            const icon = iconForCategory(c.id, byId);
            const active = f.categoryId === c.id;
            return `<button type="button" class="chip-v${active ? " active" : ""}" data-goal-cat="${c.id}" style="--cat:${color};">
              <span class="chip-icon">${icon}</span><span>${escHtml(c.name)}</span>
            </button>`;
          }).join("")}
        </div>
      </div>`;
    }

    return amountHtml; // provision
  }

  function renderGoalForm() {
    const f = state.goalForm;
    const editing = !!state.editingGoalId;
    const isHucha = HUCHA_GOAL_TYPES.has(f.type);

    const prevChipsScroll = container.querySelector(".chips-scroll")?.scrollLeft;

    container.innerHTML = `
      ${subHeaderHtml({ id: "goal-back", title: editing ? t("patrimonio.goal.title.edit") : t("patrimonio.goals.new") })}

      <label class="field field-stack" style="margin-bottom:18px;">
        <span class="field-label">${t("common.name")}</span>
        <input type="text" id="goal-name" value="${escAttr(f.name)}" placeholder="${t("common.egPlaceholder", { example: t(GOAL_TYPE_KEY[f.type]) })}">
      </label>

      ${editing ? `
      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px;">
        <span class="field-label">${t("common.typeLabel")}</span>
        <div style="padding:14px 16px;font-size:15px;font-weight:600;background:var(--card2);border-radius:var(--radius-sm);">${t(GOAL_TYPE_KEY[f.type])}</div>
        <div style="font-size:11px;color:var(--text-3);">${t("patrimonio.goal.typeLockedNote")}</div>
      </div>` : `
      <div class="segmented" style="margin-bottom:18px;">
        ${GOAL_TYPES.map((gt) => `<button type="button" data-goal-tipo="${gt.id}" class="${f.type === gt.id ? "active" : ""}">${t(gt.labelKey)}</button>`).join("")}
      </div>`}

      ${renderGoalConditionalFields(f)}

      ${isHucha ? `
      <div class="card" style="padding:12px 14px; margin-bottom:18px;">
        ${editing ? `
        <div style="font-size:10px; color:var(--text-3);">${t("patrimonio.goal.linkedSavings")}</div>
        <div style="font-size:14px; font-weight:600;">${escHtml(f.accountName || "—")}</div>`
          : `<div style="font-size:12px;color:var(--text-2);">${t("patrimonio.goal.autoSavingsNote")}</div>`}
      </div>` : ""}

      <div class="card" style="padding:0 16px; margin-bottom:18px;">
        <label style="height:56px; display:flex; align-items:center; justify-content:space-between; gap:12px; cursor:pointer;">
          <span style="font-size:15px; font-weight:600;">${t("patrimonio.goal.activeLabel")}</span>
          <span class="toggle">
            <input type="checkbox" id="goal-active" ${f.isActive ? "checked" : ""}>
            <span class="toggle-track"><span class="toggle-knob"></span></span>
          </span>
        </label>
      </div>

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      <button type="button" class="btn-primary" id="goal-save" style="margin-bottom:${editing ? "10px" : "0"};">
        ${editing ? t("common.saveChanges") : t("patrimonio.goal.create")}
      </button>
      ${editing ? `
      <button type="button" id="goal-delete"
        style="width:100%;background:transparent;color:var(--red);
          border:1px solid var(--red);border-radius:var(--radius-sm);padding:16px;font:600 16px var(--font-ui);cursor:pointer;">
        ${t("patrimonio.goal.delete")}
      </button>` : ""}
    `;

    if (prevChipsScroll != null) {
      const chipsEl = container.querySelector(".chips-scroll");
      if (chipsEl) chipsEl.scrollLeft = prevChipsScroll;
    }

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
      };
    });

    const rawInput = container.querySelector("#goal-raw");
    if (rawInput) rawInput.oninput = (e) => {
      f.raw = e.target.value;
      f.cents = parseCentsRaw(f.raw);
      errorMsg = "";
    };

    const monthsInput = container.querySelector("#goal-months");
    if (monthsInput) monthsInput.oninput = (e) => { f.months = e.target.value; errorMsg = ""; };

    const pctInput = container.querySelector("#goal-pct");
    if (pctInput) pctInput.oninput = (e) => { f.pct = e.target.value; errorMsg = ""; };

    const dateInput = container.querySelector("#goal-date");
    if (dateInput) dateInput.onchange = (e) => { f.targetDate = e.target.value; };

    container.querySelectorAll("[data-goal-cat]").forEach((b) => {
      b.onclick = () => { f.categoryId = b.dataset.goalCat; errorMsg = ""; render(); };
    });

    container.querySelector("#goal-active").onchange = (e) => { f.isActive = e.target.checked; };

    container.querySelector("#goal-save").onclick = async () => {
      const btn = container.querySelector("#goal-save");
      const msg = validationGoal();
      if (msg) {
        errorMsg = msg;
        render();
        const savedBtn = container.querySelector("#goal-save");
        savedBtn.classList.add("shake");
        setTimeout(() => savedBtn.classList.remove("shake"), 400);
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
      <header class="screen-header">
        <h1>${t("patrimonio.title")}</h1>
        <p>${t("patrimonio.subtitle")}</p>
      </header>

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      ${netWorthCardHtml(netWorthOfBalances(accounts), series, accounts)}
      ${cuentasCardHtml(accounts, accountLoans)}
      ${objetivosCardHtml(goals, byId)}
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
