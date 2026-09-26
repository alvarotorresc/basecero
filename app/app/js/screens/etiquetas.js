import { tagTotals, tagSpendByCategory, allCategoriesById, createTag, updateTag, setTagArchived } from "../repo.js";
import { familyForCategory, famClass } from "../category-colors.js";
import { eurToCents } from "../contract.js";
import { fmtMoney, currencySymbol } from "../format.js";
import { t } from "../i18n/index.js";
import { pushBack, goBack } from "../back.js";
import { userMessage } from "../errors.js";
import { goToTab } from "../tabs.js";
import { subHeaderHtml, buttonHtml } from "../ui.js";
import { fieldHtml } from "../controls.js";
import { sectionHeaderHtml } from "../entity.js";
import { stackedBarHtml, emptyStateHtml } from "../instrument.js";
import { icon } from "../icons.js";

import { escHtml, escAttr } from "../esc.js";

/** Pantalla «Etiquetas de proyecto» (S10, B-Etiquetas / BD-Etiquetas): una línea de ayuda, las
 *  abiertas como tarjetas neutras (C10: --raised con borde, sin color propio) con su barra por la
 *  familia de la categoría de cada gasto y el nombre de cada tramo al lado (C12), y las archivadas
 *  como filas de borde discontinuo. Tocar una etiqueta abre su formulario (alta, renombrar, límite,
 *  archivar), y desde él se va a Movimientos filtrado (D12). Se entra desde Ajustes. */
export async function renderEtiquetas(container, onBack) {
  let rows = [];
  let byTag = new Map();
  let byId = {};
  let loadError = "";

  async function loadData() {
    loadError = "";
    try {
      let spend;
      [rows, spend, byId] = await Promise.all([tagTotals(), tagSpendByCategory(), allCategoriesById()]);
      byTag = new Map();
      for (const r of spend) {
        if (!byTag.has(r.tag_id)) byTag.set(r.tag_id, []);
        byTag.get(r.tag_id).push(r);
      }
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
    container.innerHTML = `<div class="et">
      ${subHeaderHtml({ id: "ef-back", title: editing ? t("etiquetas.form.titleEdit") : t("etiquetas.form.titleNew") })}
      <div class="et-form">
        ${fieldHtml({ id: "ef-name", label: t("etiquetas.form.nameLabel"), value: form.name, placeholder: t("etiquetas.form.namePlaceholder") })}
        ${fieldHtml({
          id: "ef-limit", label: t("etiquetas.form.limitLabel"), type: "number", value: form.limitRaw, inputmode: "decimal",
          placeholder: t("etiquetas.form.limitPlaceholder"), num: true, suffix: currencySymbol(), min: "0", step: "0.01",
        })}
        ${state.formError ? `<p class="et-error" role="alert">${icon("warn", { size: 18 })}<span>${escHtml(state.formError)}</span></p>` : ""}
        ${buttonHtml({ kind: "primary", id: "ef-save", label: t("etiquetas.form.save") })}
        ${editing ? `<div class="et-form-more">
          ${buttonHtml({ kind: "secondary", id: "ef-movements", label: t("etiquetas.row.seeMovements") })}
          ${buttonHtml(form.isArchived
            ? { kind: "tertiary", id: "ef-archive", label: t("etiquetas.form.unarchive") }
            : { kind: "tertiary-danger", id: "ef-archive", label: t("etiquetas.form.archive") })}
        </div>` : ""}
      </div>
    </div>`;
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
    container.querySelector("#ef-back").onclick = () => goBack();
    container.querySelector("#ef-save").onclick = () => save();

    // Si el guardado falla, renderForm() reconstruye el formulario desde `form`: sin estos
    // handlers, lo tecleado se perdería en cuanto apareciera el error.
    container.querySelector("#ef-name").oninput = (e) => {
      form.name = e.target.value;
      state.formError = "";
    };
    container.querySelector("#ef-limit").oninput = (e) => {
      form.limitRaw = e.target.value;
    };

    // Sin goBack(): goToTab("movimientos") cambia de pestaña con resetBack(), que descarta TODA la
    // pila (back.js#resetTo) — la única operación de historial permitida por tick.
    const movementsBtn = container.querySelector("#ef-movements");
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

  /** Nombre del tramo: «Raíz › Sub» (la ruta de la categoría del gasto) o la raíz sola. */
  function catPath(catId) {
    const c = catId ? byId[catId] : null;
    if (!c) return t("etiquetas.uncategorized");
    const parent = c.parent_id ? byId[c.parent_id] : null;
    return parent ? `${parent.name} › ${c.name}` : c.name;
  }

  /** Tramos de la barra de una etiqueta, de mayor a menor: la barra -b de la familia de la raíz de
   *  cada categoría; lo que no tiene familia (sin categoría) va en --idle, con su nombre (C11, C12). */
  function segmentsOf(row) {
    return (byTag.get(row.id) ?? [])
      .filter((r) => r.spent_cents > 0)
      .sort((a, b) => b.spent_cents - a.spent_cents)
      .map((r) => {
        const fam = familyForCategory(r.category_id, byId);
        return { fam, idle: !fam, value: r.spent_cents, name: catPath(r.category_id) };
      });
  }

  /** Tarjeta de etiqueta abierta (B-Etiquetas): neutra (C10), con el agujero de la etiqueta; nombre
   *  15/600 y «N movimientos, sin límite / de X» 12 dim; total mono 17/600 en tinta (C3, C7). La
   *  barra fina se mide contra el límite si lo hay (lo que queda, en la pista) y lleva al lado el
   *  nombre de cada tramo en el -x de su familia (C12); el color nunca va en la cifra (C7). */
  function cardHtml(row) {
    const hasLimit = row.budget_cents > 0;
    const movements = t("etiquetas.row.movements", { n: row.n });
    const sub = hasLimit
      ? t("etiquetas.row.ofLimit", { movements, limit: fmtMoney(row.budget_cents) })
      : t("etiquetas.row.noLimit", { movements });
    const segs = segmentsOf(row);
    const bar = segs.length ? stackedBarHtml(segs, { size: 8, legend: false, label: row.name, max: hasLimit ? row.budget_cents : 0 }) : "";
    const left = hasLimit ? row.budget_cents - row.spent_cents : 0;
    const legend = segs.map((s) => `<span class="et-key ${s.idle ? "is-idle" : famClass(s.fam)}"><span class="et-muestra" aria-hidden="true"></span>${escHtml(s.name)}</span>`).join("")
      + (hasLimit && left > 0 ? `<span class="et-key is-rest">${escHtml(t("etiquetas.row.left"))} <span class="num">${escHtml(fmtMoney(left))}</span></span>` : "")
      // Pasarse del límite: «quedan −X», con la cifra y su «−» en --neg (C4: el «−» que avisa).
      + (hasLimit && left < 0 ? `<span class="et-key is-rest">${escHtml(t("etiquetas.row.left"))} <span class="num is-over">−${escHtml(fmtMoney(-left))}</span></span>` : "");
    return `<button type="button" class="et-card" data-tag-open="${escAttr(row.id)}">
      <span class="et-hole" aria-hidden="true"></span>
      <span class="et-top">
        <span class="et-nm"><span class="et-name">${escHtml(row.name)}</span><span class="et-sub">${escHtml(sub)}</span></span>
        <span class="et-amt num">${escHtml(fmtMoney(row.spent_cents))}</span>
      </span>
      ${bar ? `<span class="et-bar" aria-hidden="true">${bar}</span>` : ""}
      ${legend ? `<span class="et-legend">${legend}</span>` : ""}
    </button>`;
  }

  /** Fila de etiqueta archivada (B-Etiquetas): 56, borde discontinuo, todo en dim. */
  function archivedRowHtml(row) {
    return `<button type="button" class="et-arch" data-tag-open="${escAttr(row.id)}" aria-label="${escAttr(t("etiquetas.archivedAria", { name: row.name, movements: t("etiquetas.row.movements", { n: row.n }), amount: fmtMoney(row.spent_cents) }))}">
      ${icon("archive", { size: 18 })}
      <span class="et-nm"><span class="et-name">${escHtml(row.name)}</span><span class="et-sub">${escHtml(t("etiquetas.row.movements", { n: row.n }))}</span></span>
      <span class="et-amt num">${escHtml(fmtMoney(row.spent_cents))}</span>
    </button>`;
  }

  function renderList() {
    const open = rows.filter((r) => !r.is_archived);
    const archived = rows.filter((r) => r.is_archived);
    let body;
    if (loadError) {
      body = `<p class="et-error" role="alert">${icon("warn", { size: 18 })}<span>${escHtml(loadError)}</span></p>`;
    } else if (rows.length === 0) {
      body = emptyStateHtml({ title: t("etiquetas.empty"), rows: 2 });
    } else {
      body = `${open.length ? `<section class="et-sec" aria-labelledby="et-open-h">
          ${sectionHeaderHtml({ title: t("etiquetas.open"), count: open.length, id: "et-open-h" })}
          ${open.map(cardHtml).join("")}
        </section>` : ""}
        ${archived.length ? `<section class="et-sec" aria-labelledby="et-arch-h">
          ${sectionHeaderHtml({ title: t("etiquetas.archived"), count: archived.length, id: "et-arch-h" })}
          ${archived.map(archivedRowHtml).join("")}
        </section>` : ""}`;
    }
    container.innerHTML = `<div class="et">
      ${subHeaderHtml({ id: "et-back", title: t("etiquetas.title") })}
      <p class="et-hint">${escHtml(t("etiquetas.hint"))}</p>
      ${body}
      ${loadError ? "" : buttonHtml({ kind: "primary", id: "et-add", label: t("etiquetas.new"), icon: "plus" })}
    </div>`;
    wireList();
  }

  function wireList() {
    container.querySelector("#et-back").onclick = () => onBack();
    const add = container.querySelector("#et-add");
    if (add) add.onclick = () => openForm(null);
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
