import { tagTotals, createTag, updateTag, setTagArchived } from "../repo.js";
import { pctOf, budgetStatus } from "../category-spend.js";
import { eurToCents } from "../contract.js";
import { fmtMoney } from "../format.js";
import { t } from "../i18n/index.js";
import { pushBack, goBack } from "../back.js";
import { userMessage } from "../errors.js";
import { goToTab } from "../tabs.js";
import { subHeaderHtml, metaHtml } from "../ui.js";
import { icon } from "../icons.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// Toda anchura de barra pasa por aquí, mismo criterio que gasto-por-categoria.js#clampPct: un
// límite quitado a mitad de sesión o una cifra inconsistente no debe producir CSS inválido.
const clampPct = (pct) => Math.min(100, Math.max(0, pct));

// Icono «etiqueta» del repertorio (icons.js#tag, SISTEMA.md §3). D14: una etiqueta no tiene color
// propio (en este sistema el color significa categoría), así que el icono va siempre neutro sobre
// el `.dotico` SIN fijar `--cat` (cae al gris por defecto de la clase) — nunca el color de una
// categoría.
const ICON_TAG = icon("tag", { size: 20, stroke: "var(--ink-2)" });

/** Pantalla «Etiquetas de proyecto» (N11): lista de administración + subvista de formulario de
 *  alta/edición/archivado, mismo patrón de dos vistas que categorias.js/recurrentes.js. Se entra
 *  desde Ajustes -> «Etiquetas de proyecto», y desde aquí se entra en Movimientos filtrado por
 *  la etiqueta (D12). Réplica de Etiquetas.dc.html. */
export async function renderEtiquetas(container, onBack) {
  let rows = [];
  let loadError = "";

  async function loadData() {
    loadError = "";
    try {
      rows = await tagTotals();
    } catch (e) {
      loadError = t("etiquetas.error.load", { error: userMessage(e) });
    }
  }

  const state = { view: "list", form: null, formError: "" };

  function render() {
    if (state.view === "form") renderForm();
    else renderList();
  }

  function backToList() {
    state.view = "list";
    state.form = null;
    state.formError = "";
    render();
  }

  // ========================================================================
  // Formulario: crear / renombrar / límite / archivar
  // ========================================================================

  function openForm(row) {
    state.formError = "";
    state.form = {
      mode: row ? "edit" : "create",
      id: row ? row.id : null,
      name: row ? row.name : "",
      limitRaw: row && row.budget_cents > 0 ? String(row.budget_cents / 100) : "",
      isArchived: row ? !!row.is_archived : false,
    };
    pushBack(backToList);
    state.view = "form";
    render();
  }

  function renderForm() {
    const form = state.form;
    const editing = form.mode === "edit";
    const empty = form.limitRaw === "";

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div style="font-size:20px;font-weight:700;letter-spacing:-0.015em;">${editing ? t("etiquetas.form.titleEdit") : t("etiquetas.form.titleNew")}</div>
        <button type="button" id="ef-close" aria-label="${t("categorias.form.closeAria")}"
          style="width:44px;height:44px;border-radius:50%;background:var(--card2);border:0;color:var(--text);
          display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M6 6l12 12M18 6L6 18"></path>
          </svg>
        </button>
      </div>

      <div style="display:flex;flex-direction:column;gap:16px;">
        <div>
          <div class="section-title" style="margin-bottom:8px;">${t("etiquetas.form.nameLabel")}</div>
          <div style="background:var(--card2);border-radius:0;padding:12px 16px;display:flex;align-items:center;gap:12px;">
            <div class="dotico" style="width:40px;height:40px;font-size:16px;flex-shrink:0;">${ICON_TAG}</div>
            <input type="text" id="ef-name" value="${escAttr(form.name)}" placeholder="${escAttr(t("etiquetas.form.namePlaceholder"))}"
              style="flex:1;min-width:0;border:0;background:none;outline:none;color:var(--text);
              font-size:16px;font-weight:700;font-family:inherit;">
          </div>
        </div>

        <div>
          <div class="section-title" style="margin-bottom:8px;">${t("etiquetas.form.limitLabel")}</div>
          <div style="position:relative;">
            <input type="number" min="0" step="0.01" inputmode="decimal" id="ef-limit"
              placeholder="${escAttr(t("etiquetas.form.limitPlaceholder"))}" value="${escAttr(form.limitRaw)}"
              class="budget-input${empty ? " is-empty" : ""}" style="width:100%;">
            <span class="budget-eur" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);
              font-size:12px;color:var(--text-3);pointer-events:none;display:${empty ? "none" : ""};">€</span>
          </div>
        </div>

        ${state.formError ? `<div class="banner-aviso red">${escHtml(state.formError)}</div>` : ""}

        <button type="button" class="btn-primary" id="ef-save">${t("etiquetas.form.save")}</button>

        ${editing ? `
        <button type="button" id="ef-movements"
          style="border:0;cursor:pointer;font-size:13px;font-weight:600;text-align:center;
          background:none;color:var(--text-2);padding:4px 0 0;">
          ${t("etiquetas.row.seeMovements")}
        </button>
        <button type="button" id="ef-archive"
          style="border:0;cursor:pointer;font-size:13px;font-weight:600;text-align:center;
          background:none;color:var(--red);padding:4px 0 0;">
          ${form.isArchived ? t("etiquetas.form.unarchive") : t("etiquetas.form.archive")}
        </button>` : ""}
      </div>
    `;
    wireForm();
  }

  async function save() {
    const form = state.form;
    const name = container.querySelector("#ef-name").value;
    const raw = container.querySelector("#ef-limit").value.trim();
    const budgetCents = raw === "" || Number(raw) === 0 ? null : eurToCents(raw);

    const btn = container.querySelector("#ef-save");
    btn.disabled = true;
    try {
      if (form.mode === "edit") {
        await updateTag(form.id, { name, budgetCents });
      } else {
        await createTag({ name, budgetCents });
      }
      await loadData();
      goBack();
    } catch (e) {
      btn.disabled = false;
      state.formError = t("etiquetas.error.save", { error: userMessage(e) });
      renderForm();
    }
  }

  function wireForm() {
    const form = state.form;
    container.querySelector("#ef-close").onclick = () => goBack();
    container.querySelector("#ef-save").onclick = () => save();

    // Igual que categorias.js#nameInput.oninput: si el guardado falla, renderForm() reconstruye
    // el formulario desde `form` — sin este handler, lo que el usuario tecleó se perdería en
    // cuanto apareciera el banner de error (el <input> vuelve a nacer con el valor viejo).
    const nameInput = container.querySelector("#ef-name");
    nameInput.oninput = (e) => {
      form.name = e.target.value;
      state.formError = "";
    };

    const limitInput = container.querySelector("#ef-limit");
    limitInput.oninput = (e) => {
      form.limitRaw = e.target.value;
      const empty = form.limitRaw === "";
      const eurSpan = container.querySelector(".budget-eur");
      if (eurSpan) eurSpan.style.display = empty ? "none" : "";
      limitInput.classList.toggle("is-empty", empty);
    };

    const movementsBtn = container.querySelector("#ef-movements");
    // Sin goBack(): goToTab("movimientos") ya cambia de pestaña con resetBack(), que descarta TODA
    // la pila (back.js#resetTo) — es la única operación de historial permitida por tick (ver la
    // cabecera de back.js). Un goBack() aquí antes sería una segunda operación en el mismo tick,
    // dejando el historial con una entrada de más y haciendo que «atrás» caiga en Inicio en vez de
    // en la lista de etiquetas.
    if (movementsBtn) movementsBtn.onclick = () => {
      goToTab("movimientos", { tagId: form.id });
    };

    const archiveBtn = container.querySelector("#ef-archive");
    if (archiveBtn) archiveBtn.onclick = async () => {
      archiveBtn.disabled = true;
      try {
        await setTagArchived(form.id, !form.isArchived);
        await loadData();
        goBack();
      } catch (e) {
        archiveBtn.disabled = false;
        state.formError = t("etiquetas.error.archive", { error: userMessage(e) });
        renderForm();
      }
    };
  }

  // ========================================================================
  // Lista
  // ========================================================================

  function statusWord(row) {
    if (row.is_archived) return t("etiquetas.row.archived");
    if (!(row.budget_cents > 0)) return t("etiquetas.row.noLimit");
    return t("etiquetas.row.open");
  }

  // Una fila = un control (§9.6): la fila entera es UN <button> que abre el formulario — desde
  // ahí se llega a Movimientos filtrado (#ef-movements, ya existe). Ya no hay un lápiz aparte ni
  // un chevron decorativo suelto: el chevron vive DENTRO del único botón, como en el artboard.
  function rowHtml(row) {
    const hasLimit = row.budget_cents > 0;
    let amountLine = "";
    if (hasLimit) {
      const pct = pctOf(row.spent_cents, row.budget_cents);
      const st = budgetStatus(row.spent_cents, row.budget_cents);
      amountLine = `
        <div style="padding-left:56px;display:flex;flex-direction:column;gap:5px;margin-top:2px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <span class="num" style="font-size:12.5px;color:var(--text-2);">${escHtml(t("etiquetas.row.ofLimit", { spent: fmtMoney(row.spent_cents), limit: fmtMoney(row.budget_cents) }))}</span>
            <span class="num" style="font-size:12.5px;font-weight:700;color:var(--text-2);">${pct} %</span>
          </div>
          <div class="bar" style="--cat:var(--ink-2);"><i style="width:${clampPct(st ? st.pct : 0)}%;"></i></div>
        </div>`;
    }
    return `
      <div style="display:flex;flex-direction:column;padding:11px 0;${row.is_archived ? "opacity:0.5;" : ""}">
        <button type="button" data-tag-open="${escAttr(row.id)}"
          style="width:100%;display:flex;align-items:center;gap:12px;background:none;border:0;padding:0;margin:0;
          color:inherit;font:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          <div class="dotico">${ICON_TAG}</div>
          <div class="tx-body" style="flex:1;min-width:0;">
            <div class="tx-title">${escHtml(row.name)}</div>
            ${metaHtml([t("etiquetas.row.movements", { n: row.n }), statusWord(row)])}
          </div>
          ${!hasLimit ? `<span class="num" style="font-size:14px;font-weight:700;white-space:nowrap;flex-shrink:0;">${escHtml(fmtMoney(row.spent_cents))}</span>` : ""}
          <span aria-hidden="true" style="flex-shrink:0;color:var(--ink-3);display:flex;">${icon("chevronRight", { size: 20 })}</span>
        </button>
        ${amountLine}
      </div>`;
  }

  function newTagRowHtml() {
    return `
      <button type="button" id="et-new-row"
        style="width:100%;display:flex;align-items:center;gap:10px;padding:11px 0;background:none;border:0;
        color:var(--accent);font:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;">
        ${icon("plus", { size: 20, stroke: "var(--accent)" })}
        <span style="font-size:14px;font-weight:600;">${t("etiquetas.new")}</span>
      </button>`;
  }

  function renderList() {
    container.innerHTML = `
      ${subHeaderHtml({ id: "et-back", title: t("etiquetas.title"), action: { id: "et-add", icon: "plus", label: t("etiquetas.new") } })}

      ${loadError ? `<div class="banner-aviso red">${escHtml(loadError)}</div>` : rows.length === 0 ? `
      <div class="card" style="text-align:center;color:var(--text-3);margin-bottom:14px;">
        <p>${t("etiquetas.intro")}</p>
      </div>` : `
      <div class="card" style="padding:2px 16px;display:flex;flex-direction:column;margin-bottom:14px;">
        ${rows.map(rowHtml).join('<hr class="divider">')}
      </div>`}

      ${!loadError ? `
      <div class="card" style="padding:2px 16px;margin-bottom:16px;">${newTagRowHtml()}</div>

      <div class="card" style="border-radius:var(--radius-sm);padding:12px 16px;display:flex;align-items:center;gap:10px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.7"
          stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
          <circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16.5v.01"></path>
        </svg>
        <div style="font-size:11.5px;color:var(--text-3);">${t("etiquetas.footerNote")}</div>
      </div>` : ""}
    `;
    wireList();
  }

  function wireList() {
    container.querySelector("#et-back").onclick = () => onBack();
    container.querySelector("#et-add").onclick = () => openForm(null);
    const newRow = container.querySelector("#et-new-row");
    if (newRow) newRow.onclick = () => openForm(null);

    // Una fila = un control (§9.6): la fila entera abre el formulario; desde ahí se llega a
    // Movimientos filtrado (#ef-movements, arriba). Ya no hay un botón de editar aparte.
    container.querySelectorAll("[data-tag-open]").forEach((b) => {
      b.onclick = () => {
        const row = rows.find((r) => r.id === b.dataset.tagOpen);
        if (row) openForm(row);
      };
    });
  }

  await loadData();
  render();
}
