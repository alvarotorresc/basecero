import {
  balancesAt, netWorthOfBalances, netWorthSeries, goalsWithProgress,
  getAccount, createAccount, updateAccount, listExpenseRootCategories, allCategoriesById,
  createGoal, updateGoal, softDeleteGoal,
} from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtEUR, hoyISO } from "../format.js";
import { sparklineSvg } from "../charts.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const centsToRaw = (cents) => (cents ? (Math.abs(cents) / 100).toFixed(2).replace(".", ",") : "");
const fmtPct1 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// ---- tarjeta "Patrimonio neto" --------------------------------------------

const ICON_ARROW = (up) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="${up ? "#4ade80" : "#f87171"}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    ${up ? '<path d="M12 19V5M12 5l-6 6M12 5l6 6"></path>' : '<path d="M12 5v14M12 19l-6-6M12 19l6-6"></path>'}
  </svg>`;

/** Sparkline + fila de etiquetas de mes debajo — sparklineSvg (Task 12) NO pinta las etiquetas
 *  (ver su comentario en charts.js), así que esta pantalla arma la fila propia, con el mes actual
 *  en negrita (réplica de design/Patrimonio.dc.html:50-58). Se oculta con <2 puntos: con 0
 *  periodos cerrados netWorthSeries solo trae el punto de hoy, y una línea de un único punto no
 *  cuenta ninguna evolución. */
function netWorthSparkHtml(series) {
  if (series.length < 2) return "";
  const svg = sparklineSvg(series.map((p) => p.cents), series.map((p) => p.label));
  const labelsHtml = series.map((p, i) => `
    <div style="font-size:10px;text-align:center;${i === series.length - 1 ? "font-weight:700;color:var(--text);" : "color:var(--text-3);"}">${escHtml(p.label)}</div>`).join("");
  return `
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${svg}
      <div style="display:grid;grid-template-columns:repeat(${series.length},minmax(0,1fr));gap:4px;">${labelsHtml}</div>
    </div>`;
}

/** Tarjeta "Patrimonio neto": importe (38px) + badge de variación ABSOLUTA vs el último periodo
 *  CERRADO + sparkline — réplica de design/Patrimonio.dc.html:32-59. La variación es el propio
 *  penúltimo vs último punto de `series` (el último es siempre "hoy"; el penúltimo, si existe, es
 *  el del último cerrado — mismos puntos que ya trae netWorthSeries, sin repetir la query). Sin
 *  ningún cerrado (series.length<2) no hay nada con qué comparar: se oculta el badge entero. */
function netWorthCardHtml(netWorthCents, series) {
  const n = series.length;
  const variation = n >= 2 ? series[n - 1].cents - series[n - 2].cents : null;
  const up = variation === null || variation >= 0;
  const badgeHtml = variation === null ? "" : `
    <div style="display:flex;align-items:center;gap:5px;background:${up ? "#14261d" : "#2a1c1c"};border-radius:10px;padding:6px 9px;flex-shrink:0;">
      ${ICON_ARROW(up)}
      <div style="font-size:11px;font-weight:700;color:${up ? "var(--green)" : "var(--red)"};">${fmtEUR(Math.abs(variation))}</div>
    </div>`;

  return `
    <div class="card" style="display:flex;flex-direction:column;gap:16px;margin-bottom:16px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div style="display:flex;flex-direction:column;gap:6px;">
          <div style="font-size:12px;font-weight:600;color:var(--text-2);">Patrimonio neto</div>
          <div class="num" style="font-size:38px;font-weight:600;line-height:1;letter-spacing:-0.02em;">${fmtEUR(netWorthCents)}</div>
        </div>
        ${badgeHtml}
      </div>
      ${netWorthSparkHtml(series)}
    </div>`;
}

// ---- tarjeta "Cuentas" -----------------------------------------------------

// Trazos de los iconos SVG de design/Patrimonio.dc.html:71-118 (uno por tipo de cuenta, no por
// cuenta concreta: aquí solo hay 3 tipos). El color entra como --cat en .list-row-icon (mismo
// mecanismo de tinte que .tx-icon con las categorías, ver app.css).
const ACCOUNT_ICON = {
  checking: { color: "#7aa2ff", paths: '<rect x="3" y="5.5" width="18" height="13" rx="3.5"></rect><path d="M3 10.5h18"></path>' },
  savings: { color: "#b08be8", paths: '<path d="M5 8.5h14a1.6 1.6 0 011.6 1.6v7.3A1.6 1.6 0 0119 19H5a1.6 1.6 0 01-1.6-1.6V6.6A1.6 1.6 0 015 5h10"></path><circle cx="16.5" cy="13.8" r="1.2"></circle>' },
  liability: { color: "#f87171", paths: '<path d="M4.2 16.2h15.6v-3.8l-1.7-4.1a1.6 1.6 0 00-1.5-1H7.4a1.6 1.6 0 00-1.5 1l-1.7 4.1z"></path><path d="M6 16.2v2.4h2.6v-2.4M15.4 16.2v2.4H18v-2.4"></path>' },
};

const ACCOUNT_TYPES = [
  { id: "checking", label: "Corriente" },
  { id: "savings", label: "Ahorro" },
  { id: "liability", label: "Pasivo" },
];

/** Subtítulo por tipo — "Cuenta corriente · por defecto" es el único texto literal que pide el
 *  brief (para N26); el resto ("Ahorro"/"Pasivo") queda deliberadamente genérico: no hay en el
 *  contrato ningún campo del que derivar "2 huchas con objetivo" o "cuota 189 €/mes" del mockup
 *  sin inventar datos, así que no se replican aquí. */
function accountSubtitle(type, isDefault) {
  if (type === "checking") return `Cuenta corriente${isDefault ? " · por defecto" : ""}`;
  if (type === "savings") return "Ahorro";
  return "Pasivo";
}

function cuentaRowHtml(a, isDefault) {
  const icon = ACCOUNT_ICON[a.type] ?? ACCOUNT_ICON.checking;
  const isLiability = a.type === "liability";
  return `
    <button type="button" class="list-row" data-acc="${a.id}"
      style="width:100%;text-align:left;background:none;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent;">
      <div class="list-row-icon" style="--cat:${icon.color};">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${icon.color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icon.paths}</svg>
      </div>
      <div class="list-row-body">
        <div class="list-row-title">${escHtml(a.name)}</div>
        <div class="list-row-sub">${accountSubtitle(a.type, isDefault)}</div>
      </div>
      <div class="num" style="font-size:15px;font-weight:600;${isLiability ? "color:var(--red);" : ""}">${fmtEUR(a.balance_cents)}</div>
    </button>`;
}

/** Tarjeta "Cuentas": una fila por cuenta activa (balancesAt ya excluye archivadas/borradas),
 *  separadas por <hr class="divider"> — réplica de design/Patrimonio.dc.html:61-121, + botón
 *  "Nueva cuenta" en la cabecera. Cada fila abre la subvista de edición (Task 14). */
function cuentasCardHtml(accounts) {
  const n = accounts.length;
  const header = `
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="font-size:15px;font-weight:700;">Cuentas</div>
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="font-size:11px;color:var(--text-3);">${n} activa${n === 1 ? "" : "s"} · solo EUR</div>
        <button type="button" class="icon-btn" id="btn-nueva-cuenta" aria-label="Nueva cuenta" style="width:28px;height:28px;border-radius:9px;font-size:16px;">+</button>
      </div>
    </div>`;

  if (n === 0) {
    return `
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
        ${header}
        <div class="card" style="text-align:center;color:var(--text-3);">Todavía no tienes ninguna cuenta.</div>
      </div>`;
  }

  const firstCheckingId = accounts.find((a) => a.type === "checking")?.id;
  const rowsHtml = accounts.map((a) => cuentaRowHtml(a, a.id === firstCheckingId)).join('<hr class="divider">');

  return `
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
      ${header}
      <div class="card" style="padding:6px 16px;display:flex;flex-direction:column;">
        ${rowsHtml}
      </div>
    </div>`;
}

// ---- tarjeta "Objetivos" ---------------------------------------------------

const LEVEL_COLOR = { ok: "var(--green)", warn: "var(--amber)", over: "var(--red)" };

const GOAL_TYPES = [
  { id: "emergency_fund", label: "Fondo de emergencia" },
  { id: "savings_target", label: "Ahorro con objetivo" },
  { id: "provision", label: "Provisión" },
  { id: "spending_cap", label: "Techo de gasto" },
  { id: "savings_rate", label: "Tasa de ahorro" },
];
const GOAL_TYPE_LABEL = Object.fromEntries(GOAL_TYPES.map((t) => [t.id, t.label]));

// Tipos con hucha propia (mismo criterio que repo.js#HUCHA_GOAL_TYPES): al crearlos sin cuenta
// se les crea una savings dedicada — la UI usa este set para saber cuándo mostrar la nota y el
// bloque de "hucha vinculada" al editar.
const HUCHA_GOAL_TYPES = new Set(["emergency_fund", "savings_target", "provision"]);

/** savings_rate guarda puntos porcentuales en currentCents/targetCents (ver repo.goalProgress):
 *  se muestran como "%", el resto de tipos como € (fmtEUR). */
function fmtGoalAmount(goal, cents) {
  return goal.type === "savings_rate" ? `${fmtPct1.format(cents)} %` : fmtEUR(cents);
}

/** Fila de un goal: título + "actual / objetivo", barra de 8px, subtítulo contextual a la
 *  izquierda + % en negrita a la derecha — réplica de design/Patrimonio.dc.html:130-186. El color
 *  (verde/ámbar/rojo) sigue el `level` de repo.goalProgress: solo se colorea texto (número grande,
 *  subtítulo, %) cuando level≠'ok' — en 'ok' se queda en los tonos neutros del resto de la
 *  pantalla, la barra es la única que lleva siempre su color de estado. La fila entera es un
 *  botón (Task 14): abre la subvista de edición. */
function goalRowHtml(g) {
  const { goal, currentCents, targetCents, pct, level, subtitle } = g;
  const barColor = LEVEL_COLOR[level];
  const stateColor = level === "ok" ? null : LEVEL_COLOR[level];
  const barPct = Math.min(100, Math.max(0, pct));

  return `
    <button type="button" data-goal="${goal.id}"
      style="width:100%;text-align:left;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;display:flex;flex-direction:column;gap:9px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
        <div style="font-size:14px;font-weight:600;">${escHtml(goal.name)}</div>
        <div class="num" style="font-size:13px;font-weight:600;color:${stateColor ?? "var(--text)"};white-space:nowrap;">
          ${fmtGoalAmount(goal, currentCents)} <span style="color:var(--text-3);">/ ${fmtGoalAmount(goal, targetCents)}</span>
        </div>
      </div>
      <div style="height:8px;background:#1e2225;border-radius:999px;overflow:hidden;">
        <div style="width:${barPct}%;height:8px;background:${barColor};border-radius:999px;"></div>
      </div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
        <div style="font-size:11px;color:${stateColor ?? "var(--text-3)"};">${escHtml(subtitle)}</div>
        <div style="font-size:11px;font-weight:700;color:${stateColor ?? "var(--text-2)"};">${Math.round(pct)} %</div>
      </div>
    </button>`;
}

/** Tarjeta "Objetivos": una fila por goal activo — réplica de design/Patrimonio.dc.html:123-189,
 *  + botón "Nuevo objetivo" en la cabecera. Cada fila abre la subvista de edición (Task 14). */
function objetivosCardHtml(goals) {
  const n = goals.length;
  const header = `
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="font-size:15px;font-weight:700;">Objetivos</div>
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="font-size:11px;color:var(--text-3);">${n} activo${n === 1 ? "" : "s"}</div>
        <button type="button" class="icon-btn" id="btn-nuevo-objetivo" aria-label="Nuevo objetivo" style="width:28px;height:28px;border-radius:9px;font-size:16px;">+</button>
      </div>
    </div>`;

  if (n === 0) {
    return `
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${header}
        <div class="card" style="text-align:center;color:var(--text-3);">Todavía no tienes ningún objetivo activo.</div>
      </div>`;
  }

  return `
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${header}
      <div class="card" style="display:flex;flex-direction:column;gap:18px;">
        ${goals.map(goalRowHtml).join("")}
      </div>
    </div>`;
}

/** Pantalla "Patrimonio" (Task 13 + formularios de Task 14): cabecera + tarjeta de patrimonio
 *  neto (con su evolución) + tarjeta Cuentas + tarjeta Objetivos, con subvistas de formulario
 *  para crear/editar cuentas y objetivos (mismo patrón detalle que movimientos.js/recurrentes.js:
 *  view interno 'main' | 'account-form' | 'goal-form', sin onBack — Patrimonio es pestaña de
 *  nivel superior, la subvista siempre vuelve a su propio 'main'). */
export async function renderPatrimonio(container) {
  let series, accounts, goals, expenseRootCats, byId;

  async function loadData() {
    [series, accounts, goals, expenseRootCats, byId] = await Promise.all([
      netWorthSeries(), balancesAt(hoyISO()), goalsWithProgress(), listExpenseRootCategories(), allCategoriesById(),
    ]);
  }

  try {
    await loadData();
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">No se pudo cargar Patrimonio: ${escHtml(e.message)}</div>`;
    return;
  }

  const accountNameById = () => Object.fromEntries(accounts.map((a) => [a.id, a.name]));

  const state = {
    view: "main",
    editingAccountId: null, accountForm: null,
    editingGoalId: null, goalForm: null,
    deleteConfirm: false,
  };
  let errorMsg = "";

  function backToMain() {
    state.view = "main";
    state.editingAccountId = null; state.accountForm = null;
    state.editingGoalId = null; state.goalForm = null;
    state.deleteConfirm = false;
    errorMsg = "";
    render();
  }

  // ---- subvista: formulario de cuenta --------------------------------------

  function openAccountNew() {
    state.editingAccountId = null;
    state.accountForm = { name: "", type: "checking", raw: "", cents: 0, sign: "+" };
    errorMsg = "";
    state.view = "account-form";
    render();
  }

  async function openAccountEdit(id) {
    let row;
    try {
      row = await getAccount(id);
    } catch (e) {
      errorMsg = "No se pudo abrir la cuenta: " + e.message;
      render();
      return;
    }
    if (!row) return;
    state.editingAccountId = id;
    state.accountForm = {
      name: row.name, type: row.type,
      raw: centsToRaw(row.opening_balance_cents),
      cents: Math.abs(row.opening_balance_cents),
      sign: row.opening_balance_cents < 0 ? "-" : "+",
    };
    errorMsg = "";
    state.view = "account-form";
    render();
  }

  function renderAccountForm() {
    const f = state.accountForm;
    const editing = !!state.editingAccountId;
    const isN26 = state.editingAccountId === "acc-n26";

    container.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;">
        <button type="button" class="icon-btn" id="acc-back" aria-label="Volver">←</button>
        <h1 style="font-size:19px; font-weight:700; letter-spacing:-0.01em;">${editing ? "Editar cuenta" : "Nueva cuenta"}</h1>
        <span style="width:36px;"></span>
      </div>

      ${isN26 ? `
      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px;">
        <span class="field-label">Nombre</span>
        <div style="padding:14px 16px;font-size:15px;font-weight:600;background:#1b1e21;border-radius:var(--radius-sm);">N26</div>
        <div style="font-size:11px;color:var(--text-3);">No renombrable: la usa el import de N26.</div>
      </div>` : `
      <label class="field field-stack" style="margin-bottom:18px;">
        <span class="field-label">Nombre</span>
        <input type="text" id="acc-name" value="${escAttr(f.name)}" placeholder="p. ej. Revolut">
      </label>`}

      <div class="segmented" style="margin-bottom:18px;">
        ${ACCOUNT_TYPES.map((t) => `<button type="button" data-acc-tipo="${t.id}" class="${f.type === t.id ? "active" : ""}">${t.label}</button>`).join("")}
      </div>

      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:8px;">
        <div class="section-title">Saldo inicial</div>
        <div class="amount-display" style="align-items:center;">
          <button type="button" class="icon-btn" id="acc-sign" aria-label="Cambiar signo" style="font-size:18px; font-weight:700;">${f.sign}</button>
          <input type="text" inputmode="decimal" id="acc-raw" value="${escAttr(f.raw)}" placeholder="0"
            style="border:0;background:none;color:var(--text);font:600 56px var(--font-num);letter-spacing:-0.02em;width:100%;outline:none;">
          <span class="amount-currency">€</span>
        </div>
        <hr class="divider" style="margin-top:6px;">
      </div>
      <div style="font-size:11px;color:var(--text-3);margin-bottom:18px;">
        ${f.type === "liability"
          ? "El saldo de un pasivo es lo que debes: normalmente negativo."
          : "El saldo con el que arrancó la cuenta, antes del primer movimiento registrado."}
      </div>

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      <button type="button" class="btn-primary" id="acc-save">${editing ? "Guardar cambios" : "Crear cuenta"}</button>
    `;

    wireAccountForm();
  }

  function wireAccountForm() {
    const f = state.accountForm;
    const isN26 = state.editingAccountId === "acc-n26";
    container.querySelector("#acc-back").onclick = () => backToMain();

    const nameInput = container.querySelector("#acc-name");
    if (nameInput) nameInput.oninput = (e) => { f.name = e.target.value; };

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
      f.cents = Math.round(parseFloat((f.raw || "0").replace(",", ".")) * 100) || 0;
      errorMsg = "";
    };

    container.querySelector("#acc-save").onclick = async () => {
      const btn = container.querySelector("#acc-save");
      if (!isN26 && !f.name.trim()) {
        errorMsg = "Ponle un nombre a la cuenta.";
        render();
        const savedBtn = container.querySelector("#acc-save");
        savedBtn.classList.add("shake");
        setTimeout(() => savedBtn.classList.remove("shake"), 400);
        return;
      }
      btn.disabled = true;
      try {
        const openingBalanceCents = f.sign === "-" ? -f.cents : f.cents;
        if (state.editingAccountId) {
          await updateAccount(state.editingAccountId, { name: f.name.trim(), type: f.type, openingBalanceCents });
        } else {
          await createAccount({ name: f.name.trim(), type: f.type, openingBalanceCents });
        }
        await loadData();
        backToMain();
      } catch (e) {
        btn.disabled = false;
        errorMsg = "No se pudo guardar: " + e.message;
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
    state.deleteConfirm = false;
    errorMsg = "";
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
    state.deleteConfirm = false;
    errorMsg = "";
    state.view = "goal-form";
    render();
  }

  function validationGoal() {
    const f = state.goalForm;
    if (!f.name.trim()) return "Ponle un nombre al objetivo.";
    if (f.type === "emergency_fund") {
      const m = parseInt(f.months, 10);
      if (!m || m < 1) return "Indica cuántos meses de gasto quieres cubrir.";
    } else if (f.type === "savings_target" || f.type === "provision") {
      if (f.cents <= 0) return "Introduce un importe objetivo.";
    } else if (f.type === "spending_cap") {
      if (f.cents <= 0) return "Introduce un importe objetivo.";
      if (!f.categoryId) return "Elige una categoría.";
    } else if (f.type === "savings_rate") {
      const p = parseFloat((f.pct || "0").replace(",", "."));
      if (!p || p <= 0) return "Introduce un objetivo de ahorro (%).";
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
        <span class="field-label">Meses de gasto a cubrir</span>
        <input type="number" min="1" id="goal-months" value="${escAttr(f.months)}" placeholder="p. ej. 3">
      </label>`;
    }
    if (f.type === "savings_rate") {
      return `
      <label class="field field-stack" style="margin-bottom:18px;">
        <span class="field-label">Objetivo de ahorro (%)</span>
        <input type="text" inputmode="decimal" id="goal-pct" value="${escAttr(f.pct)}" placeholder="p. ej. 20">
      </label>`;
    }
    // savings_target / provision / spending_cap: los 3 llevan un importe objetivo.
    const amountLabel = f.type === "provision" ? "Objetivo anual" : "Importe objetivo";
    const amountHtml = `
      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px;">
        <div class="section-title">${amountLabel}</div>
        <div class="amount-display" style="align-items:center;">
          <input type="text" inputmode="decimal" id="goal-raw" value="${escAttr(f.raw)}" placeholder="0"
            style="border:0;background:none;color:var(--text);font:600 56px var(--font-num);letter-spacing:-0.02em;width:100%;outline:none;">
          <span class="amount-currency">€</span>
        </div>
        <hr class="divider" style="margin-top:6px;">
      </div>`;

    if (f.type === "savings_target") {
      return `${amountHtml}
      <label class="field field-stack" style="margin-bottom:18px;">
        <span class="field-label">Fecha objetivo (opcional)</span>
        <input type="date" id="goal-date" value="${escAttr(f.targetDate)}">
      </label>`;
    }

    if (f.type === "spending_cap") {
      return `${amountHtml}
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">Categoría</div>
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
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;">
        <button type="button" class="icon-btn" id="goal-back" aria-label="Volver">←</button>
        <h1 style="font-size:19px; font-weight:700; letter-spacing:-0.01em;">${editing ? "Editar objetivo" : "Nuevo objetivo"}</h1>
        <span style="width:36px;"></span>
      </div>

      <label class="field field-stack" style="margin-bottom:18px;">
        <span class="field-label">Nombre</span>
        <input type="text" id="goal-name" value="${escAttr(f.name)}" placeholder="p. ej. ${escAttr(GOAL_TYPE_LABEL[f.type])}">
      </label>

      <div class="segmented" style="margin-bottom:18px;">
        ${GOAL_TYPES.map((t) => `<button type="button" data-goal-tipo="${t.id}" class="${f.type === t.id ? "active" : ""}">${t.label}</button>`).join("")}
      </div>

      ${renderGoalConditionalFields(f)}

      ${isHucha ? `
      <div class="card" style="padding:12px 14px; margin-bottom:18px;">
        ${editing ? `
        <div style="font-size:10px; color:var(--text-3);">Hucha vinculada</div>
        <div style="font-size:14px; font-weight:600;">${escHtml(f.accountName || "—")}</div>`
          : `<div style="font-size:12px;color:var(--text-2);">Se creará su hucha automáticamente</div>`}
      </div>` : ""}

      <div class="card" style="padding:0 16px; margin-bottom:18px;">
        <label style="height:56px; display:flex; align-items:center; justify-content:space-between; gap:12px; cursor:pointer;">
          <span style="font-size:15px; font-weight:600;">Activo</span>
          <span class="toggle">
            <input type="checkbox" id="goal-active" ${f.isActive ? "checked" : ""}>
            <span class="toggle-track"><span class="toggle-knob"></span></span>
          </span>
        </label>
      </div>

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      <button type="button" class="btn-primary" id="goal-save" style="margin-bottom:${editing ? "10px" : "0"};">
        ${editing ? "Guardar cambios" : "Crear objetivo"}
      </button>
      ${editing ? `
      <button type="button" id="goal-delete"
        style="width:100%;background:${state.deleteConfirm ? "var(--red)" : "transparent"};color:${state.deleteConfirm ? "#fff" : "var(--red)"};
          border:1px solid var(--red);border-radius:var(--radius-sm);padding:16px;font:600 16px var(--font-ui);cursor:pointer;">
        ${state.deleteConfirm ? "Sí, borrar" : "Borrar objetivo"}
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
    container.querySelector("#goal-back").onclick = () => backToMain();
    container.querySelector("#goal-name").oninput = (e) => { f.name = e.target.value; state.deleteConfirm = false; };

    container.querySelectorAll("[data-goal-tipo]").forEach((b) => {
      b.onclick = () => {
        f.type = b.dataset.goalTipo;
        errorMsg = "";
        state.deleteConfirm = false;
        render();
      };
    });

    const rawInput = container.querySelector("#goal-raw");
    if (rawInput) rawInput.oninput = (e) => {
      f.raw = e.target.value;
      f.cents = Math.round(parseFloat((f.raw || "0").replace(",", ".")) * 100) || 0;
      errorMsg = "";
      state.deleteConfirm = false;
    };

    const monthsInput = container.querySelector("#goal-months");
    if (monthsInput) monthsInput.oninput = (e) => { f.months = e.target.value; errorMsg = ""; state.deleteConfirm = false; };

    const pctInput = container.querySelector("#goal-pct");
    if (pctInput) pctInput.oninput = (e) => { f.pct = e.target.value; errorMsg = ""; state.deleteConfirm = false; };

    const dateInput = container.querySelector("#goal-date");
    if (dateInput) dateInput.onchange = (e) => { f.targetDate = e.target.value; state.deleteConfirm = false; };

    container.querySelectorAll("[data-goal-cat]").forEach((b) => {
      b.onclick = () => { f.categoryId = b.dataset.goalCat; errorMsg = ""; state.deleteConfirm = false; render(); };
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
        backToMain();
      } catch (e) {
        btn.disabled = false;
        errorMsg = "No se pudo guardar: " + e.message;
        render();
      }
    };

    const deleteBtn = container.querySelector("#goal-delete");
    if (deleteBtn) deleteBtn.onclick = async () => {
      if (!state.deleteConfirm) {
        state.deleteConfirm = true;
        render();
        return;
      }
      const btn = container.querySelector("#goal-delete");
      btn.disabled = true;
      try {
        await softDeleteGoal(state.editingGoalId);
        await loadData();
        backToMain();
      } catch (e) {
        btn.disabled = false;
        errorMsg = "No se pudo borrar: " + e.message;
        state.deleteConfirm = false;
        render();
      }
    };
  }

  // ---- vista principal ------------------------------------------------------

  function renderMain() {
    container.innerHTML = `
      <header class="screen-header">
        <h1>Patrimonio</h1>
        <p>Calculado con todos tus movimientos · hoy</p>
      </header>

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      ${netWorthCardHtml(netWorthOfBalances(accounts), series)}
      ${cuentasCardHtml(accounts)}
      ${objetivosCardHtml(goals)}
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
