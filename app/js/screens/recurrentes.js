import {
  listRules, listExpenseLeafCategories, listIncomeCategories, listAccounts, allCategoriesById,
  createRule, updateRule, softDeleteRule, getMetaAll,
} from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtMoney, currencySymbol, parseCentsRaw, centsToRaw } from "../format.js";

const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

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
// Nombre de mes para "próximo: {mes}" en el sub de reglas trimestrales/anuales (mismo patrón que
// FREQ_LABEL: lookup local de presentación, due_month ya es un dato real de la regla).
const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const needsCategory = (tipo) => tipo === "expense" || tipo === "income";
const needsMonth = (freq) => freq === "quarterly" || freq === "yearly";

/** Pantalla "Recurrentes": lista de reglas (Task 11 la consume para generar movimientos de
 *  previsión) + formulario de alta/edición con borrado en dos toques (mismo patrón que
 *  movimientos.js openDetail/backToList). onBack vuelve a quien la haya abierto (Ajustes). */
export async function renderRecurrentes(container, onBack) {
  let rules, expenseCats, incomeCats, accountsAll, byId, meta;
  try {
    [rules, expenseCats, incomeCats, accountsAll, byId, meta] = await Promise.all([
      listRules(), listExpenseLeafCategories(), listIncomeCategories(), listAccounts(), allCategoriesById(),
      getMetaAll(),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">No se pudo cargar Recurrentes: ${escHtml(e.message)}</div>`;
    return;
  }
  const accounts = accountsAll.filter((a) => a.type !== "liability");
  const partnerName = (meta.partner_name || "").trim();

  const state = { view: "list", rules, editId: null, form: null, deleteConfirm: false };
  let errorMsg = "";

  const categoriesFor = (tipo) => (tipo === "income" ? incomeCats : tipo === "expense" ? expenseCats : []);

  function ruleIconColor(r) {
    if (r.type === "transfer") return { color: "var(--text-2)", icon: "⇄" };
    return { color: colorForCategory(r.category_id, byId), icon: iconForCategory(r.category_id, byId) };
  }

  // Sub de cada fila: frecuencia + día SIEMPRE visibles (la lista queda plana, sin agrupar por
  // frecuencia como el artboard — ver informe de la tarea, brecha documentada), + "próximo: {mes}"
  // para trimestral/anual (due_month, dato real de la regla), cuentas origen→destino en
  // transferencias (accountsAll ya cargado) y "compartido"/"pausada" como banderas de datos reales
  // (is_shared/is_active) — SIN inventar el "compartido 40 %" del artboard: ese % no existe en la
  // regla (solo en el periodo abierto), así que se muestra el texto sin porcentaje.
  function ruleSubtitle(r) {
    const freqLabel = FREQ_LABEL[r.frequency] ?? r.frequency;
    // día SIEMPRE visible (antes se omitía en trimestral/anual a favor de "próximo: {mes}",
    // como el artboard — pero el artboard no lleva "día" porque agrupa por frecuencia; sin esa
    // agrupación aquí, omitirlo perdía info real que la regla sí tiene, contra el criterio de la
    // tarea 7: "no se quita info real sin que el brief lo pida").
    const parts = [freqLabel, `día ${r.due_day}`];
    if (needsMonth(r.frequency) && r.due_month) parts.push(`próximo: ${MONTH_NAMES[r.due_month - 1]}`);
    if (r.type === "transfer") {
      const from = accountsAll.find((a) => a.id === r.account_id)?.name;
      const to = accountsAll.find((a) => a.id === r.counter_account_id)?.name;
      if (from && to) parts.push(`${from} → ${to}`);
    } else if (r.is_shared) {
      parts.push("compartido");
    }
    if (!r.is_active) parts.push("pausada");
    return parts.join(" · ");
  }

  // Fila plana (sin card propia) dentro de la lista compartida — mismo patrón que
  // categoryRowHtml/cuentaRowHtml/rowHtml de presupuesto.js/patrimonio.js/liquidar.js (tarea 7):
  // una única .card con <hr class="divider"> entre filas. Toggle de la derecha: indicador visual
  // (NO interactivo — sin <input>, pointer-events:none) de is_active con los colores exactos del
  // brief; el toggle REAL (que sí cambia el dato) vive en el formulario, y toda la fila sigue
  // abriendo la edición al tocar en cualquier punto (mismo onclick que antes).
  function ruleRowHtml(r, withDivider) {
    const { color, icon } = ruleIconColor(r);
    const amountColor = r.type === "transfer" ? "color:var(--text-3);" : "";
    return `
    ${withDivider ? '<hr class="divider">' : ""}
    <button type="button" data-rule="${r.id}"
      style="width:100%;display:flex;align-items:center;gap:12px;padding:13px 0;background:none;border:0;
      text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;${!r.is_active ? "opacity:0.55;" : ""}">
      <div class="dotico" style="--cat:${color};">${icon}</div>
      <div class="tx-body">
        <div class="tx-title">${escHtml(r.name)}</div>
        <div class="tx-sub">${escHtml(ruleSubtitle(r))}</div>
      </div>
      <div class="num" style="font-size:14px;font-weight:700;flex-shrink:0;${amountColor}">${fmtMoney(r.amount_cents)}</div>
      <span class="toggle" style="pointer-events:none;cursor:default;" aria-hidden="true">
        <span class="toggle-track" style="background:${r.is_active ? "var(--green)" : "var(--card2)"};">
          <span class="toggle-knob" style="background:${r.is_active ? "var(--bg)" : "var(--text-2)"};${r.is_active ? "transform:translateX(20px);" : ""}"></span>
        </span>
      </span>
    </button>`;
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
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:18px;">
        <button type="button" class="icon-btn" id="rec-back" aria-label="Volver"
          style="width:44px;height:44px;border-radius:50%;background:var(--card);color:var(--text);font-size:18px;">←</button>
        <h1 style="flex:1; font-size:20px; font-weight:700; letter-spacing:-0.015em;">Recurrentes</h1>
        <button type="button" id="rec-new"
          style="height:44px;padding:0 18px;border-radius:999px;background:var(--text);color:var(--bg);border:0;
          font-size:13px;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent;">+ Nueva</button>
      </div>

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      ${state.rules.length === 0
        ? `<div class="card" style="text-align:center;color:var(--text-3)"><p>Todavía no hay ninguna regla recurrente.</p></div>`
        : `<div class="card" style="padding:4px 16px; display:flex; flex-direction:column;">
            ${state.rules.map((r, i) => ruleRowHtml(r, i > 0)).join("")}
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
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:18px;">
        <button type="button" class="icon-btn" id="rec-form-back" aria-label="Volver"
          style="width:44px;height:44px;border-radius:50%;background:var(--card);color:var(--text);font-size:18px;">←</button>
        <h1 style="flex:1; font-size:20px; font-weight:700; letter-spacing:-0.015em;">${state.editId ? "Editar regla" : "Nueva regla"}</h1>
        <span style="width:44px;"></span>
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
          <span class="amount-currency">${currencySymbol()}</span>
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

      ${withCategory && (f.isShared || partnerName) ? `
      <div class="card" style="padding:0 16px; margin-bottom:18px;">
        <label style="height:56px; display:flex; align-items:center; justify-content:space-between; gap:12px; cursor:pointer;">
          <span style="font-size:15px; font-weight:600;">Compartida con ${escHtml(partnerName) || "la contraparte"}</span>
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
      f.cents = parseCentsRaw(f.raw);
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
