import {
  listRules, listExpenseLeafCategories, listIncomeCategories, listAccounts, allCategoriesById,
  createRule, updateRule, softDeleteRule,
} from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtEUR } from "../format.js";

const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const centsToRaw = (cents) => (cents ? (Math.abs(cents) / 100).toFixed(2).replace(".", ",") : "");

const TIPOS_RULE = [
  { id: "expense", label: "Gasto" },
  { id: "income", label: "Ingreso" },
  { id: "transfer", label: "Transfer." },
];
const FREQ_CHIPS = [
  { id: "weekly", label: "Semanal" },
  { id: "monthly", label: "Mensual" },
  { id: "quarterly", label: "Trimestral" },
  { id: "yearly", label: "Anual" },
];
const FREQ_LABEL = Object.fromEntries(FREQ_CHIPS.map((f) => [f.id, f.label.toLowerCase()]));
const needsCategory = (tipo) => tipo === "expense" || tipo === "income";
const needsMonth = (freq) => freq === "quarterly" || freq === "yearly";

/** Pantalla "Recurrentes": lista de reglas (Task 11 la consume para generar movimientos de
 *  previsión) + formulario de alta/edición con borrado en dos toques (mismo patrón que
 *  movimientos.js openDetail/backToList). onBack vuelve a quien la haya abierto (Ajustes). */
export async function renderRecurrentes(container, onBack) {
  let rules, expenseCats, incomeCats, accountsAll, byId;
  try {
    [rules, expenseCats, incomeCats, accountsAll, byId] = await Promise.all([
      listRules(), listExpenseLeafCategories(), listIncomeCategories(), listAccounts(), allCategoriesById(),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">No se pudo cargar Recurrentes: ${escHtml(e.message)}</div>`;
    return;
  }
  const accounts = accountsAll.filter((a) => a.type !== "liability");

  const state = { view: "list", rules, editId: null, form: null, deleteConfirm: false };
  let errorMsg = "";

  const categoriesFor = (tipo) => (tipo === "income" ? incomeCats : tipo === "expense" ? expenseCats : []);

  function ruleIconColor(r) {
    if (r.type === "transfer") return { color: "#5c646d", icon: "⇄" };
    return { color: colorForCategory(r.category_id, byId), icon: iconForCategory(r.category_id, byId) };
  }

  function ruleRowHtml(r) {
    const { color, icon } = ruleIconColor(r);
    const freqLabel = FREQ_LABEL[r.frequency] ?? r.frequency;
    let subtitle = `${fmtEUR(r.amount_cents)} · ${freqLabel} · día ${r.due_day}`;
    if (r.due_month) subtitle += ` · mes ${r.due_month}`;
    return `
    <div class="card" style="padding:14px;">
      <button type="button" class="tx-row" data-rule="${r.id}"
        style="width:100%;text-align:left;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;">
        <div class="tx-icon" style="--cat:${color};">${icon}</div>
        <div class="tx-body">
          <div class="tx-title">${escHtml(r.name)}</div>
          <div class="tx-sub">${escHtml(subtitle)}</div>
        </div>
        ${!r.is_active ? `<span style="font-size:9px;font-weight:700;letter-spacing:0.04em;color:var(--text-3);background:#2a2f34;border-radius:6px;padding:3px 6px;flex-shrink:0;">Inactiva</span>` : ""}
      </button>
    </div>`;
  }

  function openNew() {
    state.editId = null;
    state.form = {
      name: "", type: "expense", raw: "", cents: 0, categoryId: null,
      accountId: accounts[0]?.id ?? "", counterAccountId: "",
      frequency: "monthly", dueDay: "1", dueMonth: "",
      isShared: false, isActive: true,
    };
    state.deleteConfirm = false;
    state.view = "form";
    errorMsg = "";
    render();
  }

  function openEdit(r) {
    state.editId = r.id;
    state.form = {
      name: r.name, type: r.type, raw: centsToRaw(r.amount_cents), cents: r.amount_cents,
      categoryId: r.category_id || null, accountId: r.account_id, counterAccountId: r.counter_account_id || "",
      frequency: r.frequency, dueDay: r.due_day != null ? String(r.due_day) : "",
      dueMonth: r.due_month != null ? String(r.due_month) : "",
      isShared: !!r.is_shared, isActive: !!r.is_active,
    };
    state.deleteConfirm = false;
    state.view = "form";
    errorMsg = "";
    render();
  }

  function backToList() {
    state.view = "list";
    state.editId = null;
    state.form = null;
    state.deleteConfirm = false;
    errorMsg = "";
    render();
  }

  function validationError() {
    const f = state.form;
    if (!f.name.trim()) return "Ponle un nombre a la regla.";
    if (f.cents <= 0) return "Introduce un importe.";
    if (needsCategory(f.type) && !f.categoryId) return "Elige una categoría.";
    if (f.type === "transfer" && (!f.counterAccountId || f.counterAccountId === f.accountId)) {
      return "Elige dos cuentas distintas (origen y destino).";
    }
    const day = parseInt(f.dueDay, 10);
    if (!day || day < 1 || day > 31) return "El día debe estar entre 1 y 31.";
    if (needsMonth(f.frequency)) {
      const month = parseInt(f.dueMonth, 10);
      if (!month || month < 1 || month > 12) return "El mes debe estar entre 1 y 12.";
    }
    return "";
  }

  function renderAccountsSection(f) {
    if (f.type === "transfer") {
      return `
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">Desde</div>
        <div class="chips">
          ${accounts.map((a) => `<button type="button" class="chip${f.accountId === a.id ? " active" : ""}" data-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">Hacia</div>
        <div class="chips">
          ${accountsAll.filter((a) => a.id !== f.accountId).map((a) => `<button type="button" class="chip${f.counterAccountId === a.id ? " active" : ""}" data-counter-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
        </div>
      </div>`;
    }
    return `
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
      <div class="section-title">Cuenta</div>
      <div class="chips">
        ${accounts.map((a) => `<button type="button" class="chip${f.accountId === a.id ? " active" : ""}" data-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
      </div>
    </div>`;
  }

  function renderList() {
    container.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;">
        <button type="button" class="icon-btn" id="rec-back" aria-label="Volver">←</button>
        <h1 style="font-size:19px; font-weight:700; letter-spacing:-0.01em;">Recurrentes</h1>
        <span style="width:36px;"></span>
      </div>

      <button type="button" class="btn-primary" id="rec-new" style="margin-bottom:16px;">Nueva regla</button>

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      ${state.rules.length === 0
        ? `<div class="card" style="text-align:center;color:var(--text-3)"><p>Todavía no hay ninguna regla recurrente.</p></div>`
        : `<div style="display:flex; flex-direction:column; gap:10px;">
            ${state.rules.map((r) => ruleRowHtml(r)).join("")}
          </div>`}
    `;
    wireList();
  }

  function wireList() {
    container.querySelector("#rec-back").onclick = () => onBack();
    container.querySelector("#rec-new").onclick = () => openNew();
    container.querySelectorAll("[data-rule]").forEach((b) => {
      b.onclick = () => {
        const r = state.rules.find((x) => x.id === b.dataset.rule);
        if (r) openEdit(r);
      };
    });
  }

  function renderForm() {
    const f = state.form;
    const cats = categoriesFor(f.type);
    const withCategory = needsCategory(f.type);

    const prevChipsScroll = container.querySelector(".chips-scroll")?.scrollLeft;

    container.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;">
        <button type="button" class="icon-btn" id="rec-form-back" aria-label="Volver">←</button>
        <h1 style="font-size:19px; font-weight:700; letter-spacing:-0.01em;">${state.editId ? "Editar regla" : "Nueva regla"}</h1>
        <span style="width:36px;"></span>
      </div>

      <label class="field field-stack" style="margin-bottom:18px;">
        <span class="field-label">Nombre</span>
        <input type="text" id="rec-name" value="${escAttr(f.name)}" placeholder="p. ej. Alquiler">
      </label>

      <div class="segmented" style="margin-bottom:18px;">
        ${TIPOS_RULE.map((t) => `<button type="button" data-tipo="${t.id}" class="${f.type === t.id ? "active" : ""}">${t.label}</button>`).join("")}
      </div>

      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px;">
        <div class="section-title">Importe</div>
        <div class="amount-display" style="align-items:center;">
          <input type="text" inputmode="decimal" id="rec-raw" value="${escAttr(f.raw)}" placeholder="0"
            style="border:0;background:none;color:var(--text);font:600 56px var(--font-num);letter-spacing:-0.02em;width:100%;outline:none;">
          <span class="amount-currency">€</span>
        </div>
        <hr class="divider" style="margin-top:6px;">
      </div>

      ${cats.length ? `
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">Categoría</div>
        <div class="chips-scroll">
          ${cats.map((c) => {
            const color = colorForCategory(c.id, byId);
            const icon = iconForCategory(c.id, byId);
            const active = f.categoryId === c.id;
            return `<button type="button" class="chip-v${active ? " active" : ""}" data-cat="${c.id}" style="--cat:${color};">
              <span class="chip-icon">${icon}</span><span>${escHtml(c.name)}</span>
            </button>`;
          }).join("")}
        </div>
      </div>` : ""}

      ${renderAccountsSection(f)}

      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">Frecuencia</div>
        <div class="chips">
          ${FREQ_CHIPS.map((fr) => `<button type="button" class="chip${f.frequency === fr.id ? " active" : ""}" data-freq="${fr.id}">${fr.label}</button>`).join("")}
        </div>
      </div>

      <div style="display:flex; gap:8px; margin-bottom:18px;">
        <label class="field field-stack" style="flex:1;">
          <span class="field-label">Día</span>
          <input type="number" min="1" max="31" id="rec-day" value="${escAttr(f.dueDay)}">
        </label>
        ${needsMonth(f.frequency) ? `
        <label class="field field-stack" style="flex:1;">
          <span class="field-label">Mes</span>
          <input type="number" min="1" max="12" id="rec-month" value="${escAttr(f.dueMonth)}">
        </label>` : ""}
      </div>

      ${withCategory ? `
      <div class="card" style="padding:0 16px; margin-bottom:18px;">
        <label style="height:56px; display:flex; align-items:center; justify-content:space-between; gap:12px; cursor:pointer;">
          <span style="font-size:15px; font-weight:600;">Compartida con Sara</span>
          <span class="toggle">
            <input type="checkbox" id="rec-shared" ${f.isShared ? "checked" : ""}>
            <span class="toggle-track"><span class="toggle-knob"></span></span>
          </span>
        </label>
      </div>` : ""}

      <div class="card" style="padding:0 16px; margin-bottom:18px;">
        <label style="height:56px; display:flex; align-items:center; justify-content:space-between; gap:12px; cursor:pointer;">
          <span style="font-size:15px; font-weight:600;">Activa</span>
          <span class="toggle">
            <input type="checkbox" id="rec-active" ${f.isActive ? "checked" : ""}>
            <span class="toggle-track"><span class="toggle-knob"></span></span>
          </span>
        </label>
      </div>

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      <button type="button" class="btn-primary" id="rec-save" style="margin-bottom:${state.editId ? "10px" : "0"};">
        ${state.editId ? "Guardar cambios" : "Crear regla"}
      </button>
      ${state.editId ? `
      <button type="button" id="rec-delete"
        style="width:100%;background:${state.deleteConfirm ? "var(--red)" : "transparent"};color:${state.deleteConfirm ? "#fff" : "var(--red)"};
          border:1px solid var(--red);border-radius:var(--radius-sm);padding:16px;font:600 16px var(--font-ui);cursor:pointer;">
        ${state.deleteConfirm ? "Sí, borrar" : "Borrar regla"}
      </button>` : ""}
    `;

    if (prevChipsScroll != null) {
      const chipsEl = container.querySelector(".chips-scroll");
      if (chipsEl) chipsEl.scrollLeft = prevChipsScroll;
    }

    wireForm();
  }

  function wireForm() {
    const f = state.form;
    container.querySelector("#rec-form-back").onclick = () => backToList();

    container.querySelectorAll("[data-tipo]").forEach((b) => {
      b.onclick = () => {
        f.type = b.dataset.tipo;
        f.categoryId = null;
        f.counterAccountId = "";
        errorMsg = "";
        state.deleteConfirm = false;
        render();
      };
    });

    container.querySelector("#rec-name").oninput = (e) => { f.name = e.target.value; state.deleteConfirm = false; };

    container.querySelector("#rec-raw").oninput = (e) => {
      f.raw = e.target.value;
      f.cents = Math.round(parseFloat((f.raw || "0").replace(",", ".")) * 100) || 0;
      errorMsg = "";
      state.deleteConfirm = false;
    };

    container.querySelectorAll("[data-cat]").forEach((b) => {
      b.onclick = () => { f.categoryId = b.dataset.cat; errorMsg = ""; state.deleteConfirm = false; render(); };
    });

    container.querySelectorAll("[data-acc]").forEach((b) => {
      b.onclick = () => {
        f.accountId = b.dataset.acc;
        if (f.counterAccountId === f.accountId) f.counterAccountId = "";
        state.deleteConfirm = false;
        render();
      };
    });

    container.querySelectorAll("[data-counter-acc]").forEach((b) => {
      b.onclick = () => { f.counterAccountId = b.dataset.counterAcc; state.deleteConfirm = false; render(); };
    });

    container.querySelectorAll("[data-freq]").forEach((b) => {
      b.onclick = () => { f.frequency = b.dataset.freq; errorMsg = ""; state.deleteConfirm = false; render(); };
    });

    container.querySelector("#rec-day").oninput = (e) => { f.dueDay = e.target.value; state.deleteConfirm = false; };
    const monthInput = container.querySelector("#rec-month");
    if (monthInput) monthInput.oninput = (e) => { f.dueMonth = e.target.value; state.deleteConfirm = false; };

    const sharedToggle = container.querySelector("#rec-shared");
    if (sharedToggle) sharedToggle.onchange = (e) => { f.isShared = e.target.checked; };

    container.querySelector("#rec-active").onchange = (e) => { f.isActive = e.target.checked; };

    container.querySelector("#rec-save").onclick = async () => {
      const btn = container.querySelector("#rec-save");
      const msg = validationError();
      if (msg) {
        errorMsg = msg;
        render();
        const savedBtn = container.querySelector("#rec-save");
        savedBtn.classList.add("shake");
        setTimeout(() => savedBtn.classList.remove("shake"), 400);
        return;
      }
      btn.disabled = true;
      try {
        const withCategory = needsCategory(f.type);
        const fields = {
          name: f.name.trim(),
          type: f.type,
          amountCents: f.cents,
          categoryId: withCategory ? f.categoryId : "",
          accountId: f.accountId,
          counterAccountId: f.type === "transfer" ? f.counterAccountId : "",
          frequency: f.frequency,
          dueDay: parseInt(f.dueDay, 10),
          dueMonth: needsMonth(f.frequency) ? parseInt(f.dueMonth, 10) : null,
          isShared: withCategory ? f.isShared : false,
          isActive: f.isActive,
        };
        if (state.editId) await updateRule(state.editId, fields);
        else await createRule(fields);
        state.rules = await listRules();
        backToList();
      } catch (e) {
        btn.disabled = false;
        errorMsg = "No se pudo guardar: " + e.message;
        render();
      }
    };

    const deleteBtn = container.querySelector("#rec-delete");
    if (deleteBtn) deleteBtn.onclick = async () => {
      if (!state.deleteConfirm) {
        state.deleteConfirm = true;
        render();
        return;
      }
      const btn = container.querySelector("#rec-delete");
      btn.disabled = true;
      try {
        await softDeleteRule(state.editId);
        state.rules = await listRules();
        backToList();
      } catch (e) {
        btn.disabled = false;
        errorMsg = "No se pudo borrar: " + e.message;
        state.deleteConfirm = false;
        render();
      }
    };
  }

  function render() {
    if (state.view === "form") renderForm();
    else renderList();
  }

  render();
}
