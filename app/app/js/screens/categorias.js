import {
  listCategoriesAdmin, allCategoriesById, createCategory, updateCategory,
  archiveCategory, unarchiveCategory, setCategoryStyle, reorderCategories, computeReorder,
  getOpenPeriod, spentByRootCategory, budgetsOfPeriod,
} from "../repo.js";
import { colorForCategory, iconForCategory, POOL, CURATED_ICONS, hashIndex } from "../category-colors.js";
import { budgetMap } from "../category-spend.js";
import { fmtMoney } from "../format.js";
import { t } from "../i18n/index.js";
import { pushBack, goBack } from "../back.js";
import { userMessage } from "../errors.js";
import { showConfirm } from "../modal.js";
import { subHeaderHtml } from "../ui.js";
import { icon } from "../icons.js";

import { escHtml, escAttr } from "../esc.js";

// Slug determinista para la sugerencia de color en creación (Task 6, decisión cerrada — ver
// openForm): quita diacríticos y normaliza mayúsculas/espacios para que "Mascotas"/"mascotas "
// sugieran el mismo color. hashIndex ya es estable sobre la cadena resultante, no hace falta más.
// Descompone en NFD (la tilde queda como marca combinante separada de la letra) y filtra esas
// marcas por código de punto (0x0300..0x036F) por código, evitando una clase de regex con
// escapes \u que no compila sin el flag "u".
function slug(s) {
  let out = "";
  for (const ch of String(s ?? "").trim().toLowerCase().normalize("NFD")) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x0300 && cp <= 0x036f) continue;
    out += ch;
  }
  return out;
}

// need_type ('need'|'want'|'savings') → etiqueta de la línea "{tipo}, {necesidad}" de la vista
// previa de CategoriaForm (previewKindText, Task 6): solo se resuelve para flow='expense' — el
// segmento Necesario/Prescindible del formulario ni siquiera se muestra para flow='income'.
// Guarda la CLAVE del diccionario, no el texto resuelto: es un const de módulo, evaluado antes de
// initI18n(meta) — resolver aquí con t() congelaría el idioma en el que arrancó la app.
// previewKindText() resuelve con t() en cada render, ya con el idioma real (misma ledger ruling
// que FREQ_KEY en recurrentes.js).
const NEED_LABEL_KEY = { need: "categorias.needLabel.need", want: "categorias.needLabel.want", savings: "categorias.needLabel.savings" };

const subcatCount = (n) => t("categorias.subcatCount", { n });

/** Sub de una raíz: "N subcategorías" a secas — Categorias.dc.html no distingue
 *  necesario/prescindible en la lista, ese contraste vive solo en la vista previa de
 *  CategoriaForm (ver previewKindText). `childCount` cuenta TODAS las hijas del árbol construido
 *  en cliente (activas + archivadas) — a propósito NO es el campo `children` de
 *  listCategoriesAdmin (ese cuenta solo hijas ACTIVAS, para el guard de "máx 2 niveles" de
 *  updateCategory): el artboard muestra "6 subcategorías" con la archivada incluida en el 6, así
 *  que el conteo visible aquí debe incluir archivadas. */
function rootSubtitle(childCount) {
  return subcatCount(childCount);
}

// Pastilla base de "chip" del formulario (Dentro de): NO reutiliza .chip/.chips de app.css —
// esas asumen un .chip-icon circular a la izquierda que este selector no lleva (el artboard pone
// el emoji inline, sin círculo) — inline, mismo criterio que el resto de este archivo (Task 5).
function chipStyle(active) {
  return `display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:${active ? 600 : 500};
    background:${active ? "var(--accent)" : "var(--surface-2)"};color:${active ? "var(--accent-ink)" : "var(--ink-2)"};
    border:0;border-radius:999px;padding:9px 14px;white-space:nowrap;flex-shrink:0;cursor:pointer;
    -webkit-tap-highlight-color:transparent;`;
}

// Chip de alternancia binaria (Tipo, Necesario/Prescindible — CategoriaForm.dc.html): a
// diferencia de chipStyle() (chips de "Dentro de", con icono a la izquierda y fondo neutro en
// reposo), aquí la inactiva lleva filete y fondo transparente y no icono — el propio artboard las
// dibuja distintas (`height:44px;padding:0 18px`, sin la geometría de icono+texto de chipStyle).
function toggleChipStyle(active) {
  return `height:44px;padding:0 18px;border-radius:999px;font-size:14px;cursor:pointer;
    -webkit-tap-highlight-color:transparent;${active
      ? "border:0;background:var(--accent);color:var(--accent-ink);font-weight:600;"
      : "border:1px solid var(--hairline-strong);background:transparent;color:var(--ink-2);font-weight:500;"}`;
}

/** Pantalla "Categorías" (PR D): lista de administración (Task 5) + subvista de formulario de
 *  alta/edición con estilo (Task 6). Dos subvistas sobre el mismo container (mismo patrón que
 *  patrimonio.js: state.view decide qué pinta render(), backToList limpia y vuelve). onBack
 *  vuelve a quien haya abierto la pantalla (Ajustes). */
export async function renderCategorias(container, onBack) {
  let rows, byId, roots, childrenByParent;
  // Datos del periodo abierto para la vista previa de CategoriaForm (Task 6.2, bloque 8) — ver
  // loadData() y previewSpendText(). null/{} si no hay periodo abierto: la tercera línea de la
  // vista previa simplemente no se pinta.
  let period = null, budgetByCategory = {}, spentByRoot = {};

  // Árbol en cliente por parent_id — NUNCA por adyacencia de filas: listCategoriesAdmin ordena
  // (flow, parent_id, display_order), así que TODAS las raíces salen primero y LUEGO todas las
  // hijas agrupadas por parent (ver handoff de la Task 4/ledger). El orden dentro de cada grupo
  // (raíces entre sí, hijas de una misma raíz entre sí) SÍ es el correcto de display_order —
  // basta con agrupar preservando el orden de iteración, sin reordenar nada aquí.
  function buildTree() {
    roots = [];
    childrenByParent = new Map();
    for (const c of rows) {
      if (c.parent_id === "") roots.push(c);
      else {
        if (!childrenByParent.has(c.parent_id)) childrenByParent.set(c.parent_id, []);
        childrenByParent.get(c.parent_id).push(c);
      }
    }
  }

  async function loadData() {
    [rows, byId] = await Promise.all([listCategoriesAdmin(), allCategoriesById()]);
    buildTree();
    // Gasto/límite del periodo abierto para la vista previa (Task 6.2, bloque 8): SOLO para
    // raíces — `grep -rn "upsertBudget(" app/app/js` da un único call site en toda la app
    // (gasto-por-categoria.js), siempre con un rootId, así que una hoja nunca tiene límite propio
    // puesto desde la UI (ver previewSpendText). spentByRoot cubre el total del subárbol de cada
    // raíz (spentByRootCategory ya lo suma, hijas incluidas); budgetByCategory (budgetMap) cubre
    // el límite VIVO de cada categoría con uno puesto este periodo.
    period = await getOpenPeriod();
    if (period) {
      const [budgetRows, spentRows] = await Promise.all([budgetsOfPeriod(period.id), spentByRootCategory(period.id)]);
      budgetByCategory = budgetMap(budgetRows);
      spentByRoot = Object.fromEntries(spentRows.map((r) => [r.root_id, r.spent_cents]));
    } else {
      budgetByCategory = {};
      spentByRoot = {};
    }
  }

  try {
    await loadData();
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">${t("categorias.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }

  const state = {
    view: "list", form: null, formError: "",
  };

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

  const rootsOfFlow = (flow) => roots.filter((r) => r.flow === flow);

  // Color del dotico: si la categoría está archivada pierde su color propio (gris neutro
  // --card2, como el "Gas" archivado del artboard) — el icono (emoji) se mantiene igual.
  const dotColor = (cat) => (cat.is_archived ? "var(--card2)" : colorForCategory(cat.id, byId));

  // ========================================================================
  // Task 6: subvista de formulario (crear/editar categoría + estilo)
  // ========================================================================

  /** 8 curados + el actual/sugerido primero (brief: "el heredado/sugerido primero"). Se calcula
   *  UNA VEZ al abrir el formulario (no en cada render) — reordenar en cada pintado haría saltar
   *  el grid cada vez que el usuario toca un icono distinto, mala UX; la selección se refleja
   *  solo con el outline, el orden queda fijo durante toda la sesión de edición. */
  function buildIconOrder(current) {
    const list = [...CURATED_ICONS];
    const idx = list.indexOf(current);
    if (idx > 0) { list.splice(idx, 1); list.unshift(current); }
    else if (idx === -1 && current) list.unshift(current);
    return list;
  }

  /** opts: { mode:"create", flow } | { mode:"create", flow, parentId } | { mode:"edit", flow, category }
   *  — shape ya fijada por la Task 5 (4 call sites de wireList más abajo). */
  function openForm({ mode, flow, category, parentId }) {
    state.formError = "";

    // wasRoot: ¿esta categoría YA era una raíz al abrir el formulario? Gobierna tanto si el color
    // sigue al nombre mientras se teclea (colorTouched) como la lógica de guardado de estilo (ver
    // save(): "raíz que ya lo era" difiere de "recién creada/recién ascendida a raíz" — ver
    // decisión documentada en el informe de la task).
    const wasRoot = mode === "edit" && category.parent_id === "";
    const initialName = mode === "edit" ? category.name : "";
    const initialColor = wasRoot ? colorForCategory(category.id, byId) : POOL[hashIndex(slug(initialName))];
    const initialIcon = wasRoot ? iconForCategory(category.id, byId) : CURATED_ICONS[0];

    state.form = {
      mode,
      id: mode === "edit" ? category.id : null,
      flow: mode === "edit" ? category.flow : flow,
      name: initialName,
      // 'savings' (caso raro, solo en algunas raíces income sembradas) no tiene hueco en este
      // segmentado de 2 opciones (Necesario/Prescindible) — cae a "need" por defecto, igual que
      // el artboard (Necesario activo por defecto). No se pierde nada real: el segmentado ni
      // siquiera se muestra para flow=income.
      needType: mode === "edit" ? (category.need_type === "want" ? "want" : "need") : "need",
      parentId: mode === "edit" ? category.parent_id : (parentId || ""),
      isArchived: mode === "edit" ? !!category.is_archived : false,
      // Hijas ACTIVAS (campo `children` de listCategoriesAdmin, NO childrenByParent — ese cuenta
      // también archivadas): gobierna SOLO el texto del aviso de cascada al archivar.
      activeChildrenCount: mode === "edit" ? (category.children || 0) : 0,
      // Item 3 (review final): TOTAL de hijas (activas + archivadas), de childrenByParent — el
      // árbol en cliente ve ambas. Gobierna lockedParent (ver renderForm): el guard real de
      // repo.updateCategory (SQL.hasChildren) ya no distingue archivadas, así que la UI que lo
      // refleja tampoco puede quedarse solo con las activas o dejaría "Dentro de" desbloqueado
      // para un caso que el repo va a rechazar igualmente.
      childrenCount: mode === "edit" ? (childrenByParent.get(category.id) ?? []).length : 0,
      wasRoot,
      colorTouched: wasRoot,
      color: initialColor,
      icon: initialIcon,
      initialColor,
      initialIcon,
      iconOrder: buildIconOrder(initialIcon),
      titleKey: mode === "edit" ? "categorias.form.title.edit" : (parentId ? "categorias.form.title.newChild" : "categorias.form.title.new"),
    };
    pushBack(backToList);
    state.view = "form";
    render();
  }

  // Raíces elegibles para "Dentro de": ACTIVAS, del flow actual del formulario, excluida ella
  // misma (en edición no puede ser su propio padre).
  function availableParents(form) {
    return roots.filter((r) => r.flow === form.flow && !r.is_archived && r.id !== form.id);
  }

  // Círculo de la preview: si es raíz, el color/icono elegidos en el propio formulario; si es
  // hija, el HEREDADO de la raíz elegida en "Dentro de" (se recalcula en vivo al cambiar de chip).
  function previewStyle(form) {
    if (!form.parentId) return { color: form.color, icon: form.icon };
    const parent = byId[form.parentId];
    if (parent) return { color: colorForCategory(parent.id, byId), icon: iconForCategory(parent.id, byId) };
    return { color: "var(--text-2)", icon: "▫️" };
  }

  // Copy propio del botón (decisión 2: sigue archivando, con el patrón destructivo §4.7) —
  // categorias.archive.archive se queda solo para el título/confirmText del modal de
  // onArchiveClick: "Archivar categoría" coincide con esa clave, pero "Desarchivar categoría" es
  // "Desarchivar" a secas — de ahí las dos claves del namespace form, ninguna del namespace archive.
  function archiveButtonLabel(form) {
    return form.isArchived ? t("categorias.form.unarchiveBtn") : t("categorias.form.archiveBtn");
  }

  /** "{tipo}, {necesidad}" (CategoriaForm.dc.html: "Gasto, prescindible"), o solo "{tipo}" para
   *  ingreso — el segmento Necesario/Prescindible del formulario ni siquiera se muestra para
   *  flow='income' (ver renderForm), así que la vista previa tampoco inventa una necesidad que el
   *  usuario no ha elegido. */
  function previewKindText(form) {
    const typeLabel = t(form.flow === "income" ? "common.type.income" : "common.type.expense");
    if (form.flow !== "expense") return typeLabel;
    const needLabel = t(NEED_LABEL_KEY[form.needType] ?? NEED_LABEL_KEY.need);
    return t("categorias.form.previewKind", { type: typeLabel, need: needLabel });
  }

  /** "{gastado} de {límite} este periodo", o "" si la tercera línea no se pinta (spec §6.2,
   *  bloque 8: nunca se inventa un "sin límite" que el artboard no dibuja). No se pinta sin
   *  periodo abierto, en creación (sin id todavía guardado) o en una hija: `upsertBudget` no
   *  tiene NINGÚN call site que le pase algo que no sea el id de una raíz en toda la app (ver el
   *  comentario de loadData), así que una hija nunca tiene límite propio. Tampoco se pinta sin
   *  límite puesto este periodo (0/ausente = "sin límite", mismo criterio que
   *  category-spend.js#limitTotals). */
  function previewSpendText(form) {
    if (form.mode !== "edit" || form.parentId || !period) return "";
    const limitCents = budgetByCategory[form.id];
    if (!(limitCents > 0)) return "";
    const spentCents = spentByRoot[form.id] ?? 0;
    return t("categorias.form.previewSpend", { spent: fmtMoney(spentCents), limit: fmtMoney(limitCents) });
  }

  function renderForm() {
    const form = state.form;
    const editing = form.mode === "edit";
    const isRoot = !form.parentId;
    const lockedParent = editing && form.childrenCount > 0;
    const preview = previewStyle(form);
    const parents = availableParents(form);
    const spendLine = previewSpendText(form);

    container.innerHTML = `
      ${subHeaderHtml({ id: "cf-back", title: t(form.titleKey) })}

      <div style="display:flex;flex-direction:column;gap:16px;">

        <label class="field field-stack">
          <span class="field-label">${t("common.name")}</span>
          <input type="text" id="cf-name" value="${escAttr(form.name)}" placeholder="${t("categorias.form.namePlaceholder")}">
        </label>

        ${isRoot ? `
        <div>
          <div class="section-title" style="margin-bottom:8px;">${t("categorias.form.iconSectionTitle")}</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px;">
            ${form.iconOrder.map((catIcon) => {
              const active = form.icon === catIcon;
              return `<button type="button" data-cf-icon="${escAttr(catIcon)}" aria-label="${t("categorias.form.pickIconAria")}" aria-pressed="${active}"
                style="width:44px;height:44px;border-radius:var(--r-circle);box-sizing:border-box;
                border:2px solid ${active ? "var(--accent)" : "transparent"};background:var(--card2);font-size:19px;
                display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;
                -webkit-tap-highlight-color:transparent;">${catIcon}</button>`;
            }).join("")}
          </div>
          <div style="font-size:11px;color:var(--text-3);margin-top:8px;">${t("categorias.form.iconHint")}</div>
        </div>

        <div>
          <div class="section-title" style="margin-bottom:8px;">${t("categorias.form.colorSectionTitle")}</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px;">
            ${POOL.map((c) => {
              const active = form.color === c;
              return `<button type="button" data-cf-color="${c}" aria-label="${t("categorias.form.pickColorAria")}" aria-pressed="${active}"
                style="width:44px;height:44px;border-radius:var(--r-circle);border:0;padding:0;background:${c};
                display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent;">${
                  active ? icon("check", { size: 20, width: 2.25, stroke: "var(--accent-ink)" }) : ""
                }</button>`;
            }).join("")}
          </div>
          <div style="font-size:11px;color:var(--text-3);margin-top:8px;">${t("categorias.form.colorHint")}</div>
        </div>
        ` : `
        <div>
          <div class="section-title" style="margin-bottom:8px;">${t("categorias.form.colorIconSectionTitle")}</div>
          <div style="font-size:11px;color:var(--text-3);">${t("categorias.form.inheritNote")}</div>
        </div>
        `}

        <div>
          <div class="section-title" style="margin-bottom:8px;">${t("categorias.form.parentSectionTitle")}</div>
          ${lockedParent ? `
          <div style="${chipStyle(true)}width:fit-content;">${t("categorias.form.rootChip")}</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:6px;">${t("categorias.form.rootLockedNote")}</div>
          ` : `
          <div style="display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px;">
            <button type="button" data-cf-parent="" style="${chipStyle(!form.parentId)}">${t("categorias.form.newRootChip")}</button>
            ${parents.map((r) => {
              const parentIcon = iconForCategory(r.id, byId);
              return `<button type="button" data-cf-parent="${escAttr(r.id)}" style="${chipStyle(form.parentId === r.id)}">${parentIcon} ${escHtml(r.name)}</button>`;
            }).join("")}
          </div>
          <div style="font-size:11px;color:var(--text-3);margin-top:6px;">${t("categorias.form.inheritNote")}</div>
          `}
        </div>

        <div>
          <div class="section-title" style="margin-bottom:8px;">${t("common.typeLabel")}</div>
          <div style="display:flex;gap:8px;${editing ? "opacity:0.6;" : ""}">
            ${[["expense", t("common.type.expense")], ["income", t("common.type.income")]].map(([id, label]) => {
              const active = form.flow === id;
              return `<button type="button" data-cf-flow="${id}"
                style="${toggleChipStyle(active)}${editing ? "pointer-events:none;cursor:default;" : ""}">${label}</button>`;
            }).join("")}
          </div>
          ${editing ? `<div style="font-size:11px;color:var(--text-3);margin-top:6px;">${t("categorias.form.typeLockedNote")}</div>` : ""}
        </div>

        ${form.flow === "expense" ? `
        <div>
          <div class="section-title" style="margin-bottom:8px;">${t("categorias.form.needSectionTitle")}</div>
          <div style="display:flex;gap:8px;">
            ${[["need", t("categorias.needType.need")], ["want", t("categorias.needType.want")]].map(([id, label]) => {
              const active = form.needType === id;
              return `<button type="button" data-cf-need="${id}" style="${toggleChipStyle(active)}">${label}</button>`;
            }).join("")}
          </div>
          <div style="font-size:11px;color:var(--text-3);margin-top:6px;">${t("categorias.form.needHint")}</div>
        </div>` : ""}

        <div>
          <div class="section-title" style="margin-bottom:8px;">${t("categorias.form.previewTitle")}</div>
          <div style="display:flex;align-items:center;gap:14px;">
            <div id="cf-preview-dot" class="dotico lg" style="--cat:${preview.color};flex-shrink:0;">${preview.icon}</div>
            <div style="display:flex;flex-direction:column;gap:3px;min-width:0;">
              <span id="cf-preview-name" style="font-size:17px;font-weight:600;color:var(--text);">${escHtml(form.name)}</span>
              <span style="font-size:13px;font-weight:500;color:var(--text-3);">${previewKindText(form)}</span>
              ${spendLine ? `<span class="num" style="font-size:13px;font-weight:500;color:var(--text-3);">${spendLine}</span>` : ""}
            </div>
          </div>
        </div>

        ${state.formError ? `<div class="banner-aviso red">${escHtml(state.formError)}</div>` : ""}

        <button type="button" class="btn-primary" id="cf-save" style="${isRoot ? `background:var(--accent);color:var(--accent-ink);` : ""}">
          ${editing ? t("common.saveChanges") : t("categorias.form.create")}
        </button>

        ${editing ? `
        <button type="button" id="cf-archive" class="btn-danger">
          ${archiveButtonLabel(form)}
        </button>` : ""}

      </div>
    `;

    wireForm();
  }

  function validationError(form) {
    if (!form.name.trim()) return t("categorias.validation.name");
    return "";
  }

  async function save() {
    const form = state.form;
    const msg = validationError(form);
    if (msg) {
      state.formError = msg;
      renderForm();
      const btn = container.querySelector("#cf-save");
      btn.classList.add("shake");
      setTimeout(() => btn.classList.remove("shake"), 400);
      return;
    }

    const btn = container.querySelector("#cf-save");
    btn.disabled = true;
    const isRootFinal = !form.parentId;

    try {
      let id;
      if (form.mode === "edit") {
        id = form.id;
        // Payload EXPLÍCITO campo a campo — JAMÁS un spread del estado ni de `category`: flow no
        // se incluye NUNCA (updateCategory lanza si la clave está presente, aunque no cambie).
        const fields = { name: form.name, parentId: form.parentId };
        if (form.flow === "expense") fields.needType = form.needType;
        await updateCategory(id, fields);
      } else {
        id = await createCategory({
          name: form.name,
          flow: form.flow,
          needType: form.flow === "expense" ? form.needType : "",
          parentId: form.parentId,
        });
      }

      // setCategoryStyle: SOLO raíces, y siempre con color+icono JUNTOS cuando se llama (nunca un
      // campo suelto) — setCategoryStyle reemplaza la entrada ENTERA (repo.js lo documenta), así
      // que omitir un campo que sí tenía override lo borraría sin querer. Ver decisión completa
      // (por qué "resuelto por defecto" se compara contra el valor resuelto AL ABRIR el
      // formulario, no contra un "sin override" que no es reconstruible desde fuera de
      // category-colors.js) en el informe de esta task.
      if (isRootFinal) {
        if (form.wasRoot) {
          if (form.color !== form.initialColor || form.icon !== form.initialIcon) {
            await setCategoryStyle(id, { color: form.color, icon: form.icon });
          }
        } else {
          // Recién creada, o recién ascendida de hija a raíz durante esta edición: no había un
          // estilo propio previo que comparar — se persiste directamente lo elegido/sugerido.
          await setCategoryStyle(id, { color: form.color, icon: form.icon });
        }
      } else if (form.mode === "edit" && form.wasRoot) {
        // Raíz que pasa a ser hija de otra: limpia cualquier override propio que quedaría
        // huérfano (ya no es raíz, no vuelve a resolverse por su propio id).
        await setCategoryStyle(id, {});
      }

      await loadData();
      goBack();
    } catch (e) {
      btn.disabled = false;
      state.formError = userMessage(e);
      renderForm();
    }
  }

  async function onArchiveClick() {
    const form = state.form;

    if (form.isArchived) {
      // Desarchivar no es destructivo: sin modal.
      const btn = container.querySelector("#cf-archive");
      btn.disabled = true;
      try {
        await unarchiveCategory(form.id);
        await loadData();
        goBack();
      } catch (e) {
        btn.disabled = false;
        state.formError = userMessage(e);
        renderForm();
      }
      return;
    }

    const n = form.activeChildrenCount;
    showConfirm({
      title: t("categorias.archive.title"),
      message: n > 0
        ? t("categorias.archive.messageWithCount", { name: form.name, count: subcatCount(n) })
        : t("categorias.archive.message", { name: form.name }),
      cancelText: t("common.cancel"),
      confirmText: t("categorias.archive.archive"),
      onConfirm: async () => {
        const btn = container.querySelector("#cf-archive");
        if (btn) btn.disabled = true;
        try {
          await archiveCategory(form.id);
          await loadData();
          goBack();
        } catch (e) {
          if (btn) btn.disabled = false;
          state.formError = userMessage(e);
          renderForm();
        }
      },
    });
  }

  function wireForm() {
    const form = state.form;

    container.querySelector("#cf-back").onclick = () => goBack();

    // El nombre NO repinta en cada tecla (perdería el foco/cursor del input, como el resto de
    // pantallas de la app — ver acc-name/goal-name en patrimonio.js): el estado (y la sugerencia
    // de color, mientras no se haya tocado un swatch) se recalcula en cada tecla igualmente
    // ("recalculada al teclear" es sobre el ESTADO — lo que se GUARDA es siempre correcto — no
    // hace falta que el repintado visual del preview/swatch sea síncrono con cada pulsación).
    //
    // TAMPOCO renderForm() ni en blur: se probó (smoke Playwright) y un renderForm() ahí ROMPE
    // el primer tap en cualquier otro control si el usuario teclea el nombre y toca directamente
    // ese control (el flujo más común: escribir el nombre y tocar "Crear categoría"). El
    // mousedown del tap dispara el blur del input ANTES de que el click llegue a completarse;
    // blur reconstruye el DOM entero (innerHTML) y el botón original queda desconectado, así que
    // el click nunca llega — el primer tap se pierde en silencio y hace falta un segundo tap.
    //
    // Para que el preview SÍ sea vivo sin ese riesgo, el nombre y (cuando cambia el color
    // sugerido, en una raíz sin swatch tocado) el circulito y el check del swatch activo se
    // parchean a mano — nodos ya existentes, nunca innerHTML del formulario entero — así el input
    // y cualquier otro control nunca se desconectan a media pulsación.
    const nameInput = container.querySelector("#cf-name");
    nameInput.oninput = (e) => {
      form.name = e.target.value;
      state.formError = "";
      const previewName = container.querySelector("#cf-preview-name");
      if (previewName) previewName.textContent = form.name;
      if (form.colorTouched || form.parentId) return; // hija: el circulito no depende del nombre
      const nextColor = POOL[hashIndex(slug(form.name))];
      if (nextColor === form.color) return;
      form.color = nextColor;
      const dot = container.querySelector("#cf-preview-dot");
      if (dot) dot.style.setProperty("--cat", form.color);
      // Rejilla circular (Task 6.2): el activo se marca con el check DENTRO, no con un outline —
      // se repinta el innerHTML del botón que gana/pierde el check (dos nodos), nunca el DOM
      // entero.
      container.querySelectorAll("[data-cf-color]").forEach((b) => {
        const active = b.dataset.cfColor === form.color;
        b.setAttribute("aria-pressed", String(active));
        b.innerHTML = active ? icon("check", { size: 20, width: 2.25, stroke: "var(--accent-ink)" }) : "";
      });
      const saveBtn = container.querySelector("#cf-save");
      if (saveBtn) saveBtn.style.background = form.color;
    };

    container.querySelectorAll("[data-cf-flow]").forEach((b) => {
      if (form.mode === "edit") return; // flow inmutable en edición: sin handler, deshabilitado
      b.onclick = () => {
        form.flow = b.dataset.cfFlow;
        // Si la raíz elegida en "Dentro de" ya no pertenece al nuevo flow, vuelve a "Raíz nueva".
        if (form.parentId && !roots.some((r) => r.id === form.parentId && r.flow === form.flow)) form.parentId = "";
        state.formError = "";
        renderForm();
      };
    });

    container.querySelectorAll("[data-cf-need]").forEach((b) => {
      b.onclick = () => {
        form.needType = b.dataset.cfNeed;
        renderForm();
      };
    });

    container.querySelectorAll("[data-cf-parent]").forEach((b) => {
      b.onclick = () => {
        form.parentId = b.dataset.cfParent;
        renderForm();
      };
    });

    container.querySelectorAll("[data-cf-color]").forEach((b) => {
      b.onclick = () => {
        form.color = b.dataset.cfColor;
        form.colorTouched = true; // fija la elección: deja de seguir al nombre mientras se teclea
        renderForm();
      };
    });

    container.querySelectorAll("[data-cf-icon]").forEach((b) => {
      b.onclick = () => {
        form.icon = b.dataset.cfIcon;
        renderForm();
      };
    });

    container.querySelector("#cf-save").onclick = () => save();

    const archiveBtn = container.querySelector("#cf-archive");
    if (archiveBtn) archiveBtn.onclick = () => onArchiveClick();
  }

  // ========================================================================
  // Task 5: subvista de lista (lista única y plana — decisión 4: sin segmentado
  // Gasto/Ingreso, subcategorías SIEMPRE visibles, asa a la derecha en SVG)
  // ========================================================================

  // Fila de hija: envuelta en un div (data-child-row, para medir/mover en el drag — Task 7) que
  // NO es el botón que abre el formulario — el asa vive fuera de ese botón a propósito, así un
  // tap/drag sobre el asa nunca puede disparar su click (ver wireDragHandle más abajo). isLastRow
  // es el ÚNICO criterio del filete inferior: con las hijas siempre visibles ya no hay un grupo
  // "expandido" que separe visualmente a la siguiente raíz — cada fila (raíz o hija) lleva su
  // propio filete, salvo la última de TODA la lista (Categorias.dc.html: solo "Ingresos", el
  // último root, se queda sin él).
  function childRowHtml(child, isLastRow) {
    const color = dotColor(child);
    const ic = iconForCategory(child.id, byId);
    return `
    <div data-child-row="${escAttr(child.id)}" style="display:flex;align-items:center;min-height:56px;
      padding-left:58px;${child.is_archived ? "opacity:0.5;" : ""}${isLastRow ? "" : "border-bottom:1px solid var(--rule);"}">
      <button type="button" data-cat="${escAttr(child.id)}"
        style="flex:1;min-width:0;display:flex;align-items:center;gap:14px;padding:10px 0;background:none;
        border:0;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;">
        <div class="dotico sm" style="--cat:${color};">${ic}</div>
        <span class="tx-title" style="flex:1;min-width:0;">${escHtml(child.name)}</span>
        ${child.is_archived ? `<span class="day-label" style="flex-shrink:0;">${t("categorias.archivedLabel")}</span>` : ""}
      </button>
      <span data-drag="${escAttr(child.id)}" aria-hidden="true"
        style="color:var(--text-3);flex-shrink:0;opacity:0.6;cursor:grab;touch-action:none;
        -webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;
        display:flex;align-items:center;padding:10px 4px 10px 10px;">${icon("drag", { size: 18, stroke: "var(--ink-3)" })}</span>
    </div>`;
  }

  // Grupo de hijas de una raíz: SIEMPRE se pinta (decisión 4 — ya no depende de state.expanded).
  // Pierde el .card de antes: la indentación (58px) y el tamaño de insignia (.dotico.sm) ya
  // distinguen una hija de una raíz, no hace falta un fondo propio (Categorias.dc.html no lo
  // dibuja). El botón "+ Añadir subcategoría" se conserva al pie de cada grupo.
  function groupHtml(root, lastId) {
    const kids = childrenByParent.get(root.id) ?? [];
    // Item 4 (review final, heredado): una raíz archivada no ofrece "+ Añadir subcategoría" —
    // createCategory ya lo rechazaría en el repo (padre archivado), esto evita el viaje de ida y
    // vuelta con error.
    return `
      ${kids.map((child) => childRowHtml(child, child.id === lastId)).join("")}
      ${root.is_archived ? "" : `
      <button type="button" data-add-sub="${root.id}"
        style="height:36px;padding:0 14px;margin:6px 0 10px 58px;border-radius:999px;background:var(--card2);
        color:var(--text);border:0;font-size:12px;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;">
        ${t("categorias.addSubcategory")}
      </button>`}`;
  }

  // Fila de raíz: dotico 44px + nombre + "N subcategorías", con el asa a la derecha, fuera del
  // botón que abre el formulario (eso NO cambia — ver wireDragHandle). Sin chevron: las hijas de
  // groupHtml() se pintan siempre justo debajo, nunca condicionadas a un estado de expansión.
  function rootRowHtml(root, lastId) {
    const color = dotColor(root);
    const ic = iconForCategory(root.id, byId);
    const kids = childrenByParent.get(root.id) ?? [];
    const isLastRow = root.id === lastId;
    return `
    <div data-root-row="${escAttr(root.id)}" style="display:flex;align-items:center;min-height:64px;
      ${root.is_archived ? "opacity:0.5;" : ""}${isLastRow ? "" : "border-bottom:1px solid var(--rule);"}">
      <button type="button" data-cat="${escAttr(root.id)}"
        style="flex:1;min-width:0;display:flex;align-items:center;gap:14px;padding:12px 0;background:none;border:0;
        text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;">
        <div class="dotico" style="--cat:${color};">${ic}</div>
        <div class="tx-body" style="min-width:0;">
          <div class="tx-title">${escHtml(root.name)}</div>
          <div class="tx-sub">${rootSubtitle(kids.length)}</div>
        </div>
        ${root.is_archived ? `<span class="day-label" style="flex-shrink:0;">${t("categorias.archivedLabel")}</span>` : ""}
      </button>
      <span data-drag="${escAttr(root.id)}" aria-hidden="true"
        style="color:var(--text-3);flex-shrink:0;opacity:0.6;cursor:grab;touch-action:none;
        -webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;
        display:flex;align-items:center;padding:14px 4px 14px 10px;">${icon("drag", { size: 20, stroke: "var(--ink-3)" })}</span>
    </div>
    ${groupHtml(root, lastId)}`;
  }

  function renderList() {
    // Orden completo de la pantalla (decisión 4): raíces de gasto con sus hijas, luego raíces de
    // ingreso con las suyas — sobre este array se calcula qué fila es la ÚLTIMA de toda la lista
    // (la única sin filete inferior, ver rootRowHtml/childRowHtml).
    const flat = [];
    for (const flow of ["expense", "income"]) {
      for (const root of rootsOfFlow(flow)) {
        flat.push(root);
        for (const child of childrenByParent.get(root.id) ?? []) flat.push(child);
      }
    }
    const lastId = flat.length ? flat[flat.length - 1].id : null;

    const sectionHtml = (flow) => {
      const flowRoots = rootsOfFlow(flow);
      if (flowRoots.length === 0) {
        return `<div style="padding:14px 0;color:var(--text-3);font-size:13px;">
          ${t(flow === "expense" ? "categorias.empty.expense" : "categorias.empty.income")}</div>`;
      }
      return flowRoots.map((r) => rootRowHtml(r, lastId)).join("");
    };

    container.innerHTML = `
      ${subHeaderHtml({ id: "cat-back", title: t("categorias.title"), action: { id: "cat-new", icon: "plus", label: t("common.addNew") } })}

      <div style="font-size:13px;font-weight:500;color:var(--text-3);line-height:1.4;margin-bottom:8px;">
        ${t("categorias.list.hint")}
      </div>

      <div style="display:flex;flex-direction:column;">
        ${sectionHtml("expense")}
        ${sectionHtml("income")}
      </div>

      <div style="margin-top:16px;">
        <div style="font-size:11.5px;color:var(--text-3);">
          ${t("categorias.list.archiveInfo")}
        </div>
      </div>
    `;
    wireList();
  }

  // ========================================================================
  // Task 7: reorden por arrastre (asa icon("drag")). Grupos de reorden: raíces
  // del flow de la categoría arrastrada entre sí (rootsOfFlow), o hijas de una
  // misma raíz entre sí (childrenByParent.get(parentId)) — jamás se cruza de
  // grupo, porque los rects que se miden y comparan durante el arrastre son
  // SIEMPRE los del propio grupo (nunca se consulta nada de otro grupo).
  //
  // Indicador de drop (outline en la fila objetivo) en vez de desplazar los
  // hermanos con transform: con las hijas SIEMPRE visibles (decisión 4), un
  // grupo de raíces SIEMPRE tiene grupos de hijas intercalados entre dos de
  // sus filas (groupHtml es HERMANO de la fila, no hijo — ver rootRowHtml),
  // así que las filas de un mismo grupo NUNCA son contiguas en pantalla — ya
  // no es una precaución para un caso raro, es el camino normal. Desplazar
  // hermanos asumiendo alturas/huecos uniformes se rompería siempre; el
  // indicador no tiene ese problema porque no reposiciona nada más que la
  // propia fila arrastrada (ghost vía transform).
  //
  // setPointerCapture en pointerdown (no tras el umbral): así todo el gesto
  // — incluido el primer movimiento que decide si hay drag — llega SIEMPRE
  // al asa, sin importar dónde ande el dedo/cursor. El umbral de 6px
  // solo gobierna cuándo se activa el feedback visual (ghost + indicador),
  // no si el evento llega: un tap simple en el asa no dispara nada (no
  // tiene onclick propio) y, al vivir fuera del botón de la fila, tampoco
  // puede disparar accidentalmente su click — separar el target basta para
  // no interferir con el tap-para-editar, sin depender del umbral para eso.
  function wireDragHandle(handle) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.isPrimary === false || (e.button !== undefined && e.button !== 0)) return;

      const id = handle.dataset.drag;
      const cat = rows.find((c) => c.id === id);
      if (!cat) return;

      const isRoot = cat.parent_id === "";
      const groupIds = isRoot
        ? rootsOfFlow(cat.flow).map((r) => r.id)
        : (childrenByParent.get(cat.parent_id) ?? []).map((c) => c.id);
      const startIndex = groupIds.indexOf(id);
      if (startIndex === -1 || groupIds.length < 2) return; // nada que reordenar

      const rowEls = groupIds.map((gid) =>
        container.querySelector(isRoot ? `[data-root-row="${gid}"]` : `[data-child-row="${gid}"]`));
      if (rowEls.some((el) => !el)) return; // DOM/estado desincronizados: no arriesgar el drag

      const draggedEl = rowEls[startIndex];
      // Rects medidos UNA VEZ al iniciar (antes de tocar ningún estilo) — el indicador de drop
      // compara siempre contra este snapshot fijo, nunca remide en cada pointermove.
      const rects = rowEls.map((el) => el.getBoundingClientRect());
      const startY = e.clientY;
      const pointerId = e.pointerId;

      e.preventDefault();
      try { handle.setPointerCapture(pointerId); } catch { return; }

      let dragging = false;
      let targetIndex = startIndex;

      function setIndicator(idx) {
        rowEls.forEach((el, i) => {
          el.style.outline = (i === idx && i !== startIndex) ? "2px dashed var(--text-3)" : "";
        });
      }

      function clearStyles() {
        draggedEl.style.transform = "";
        draggedEl.style.position = "";
        draggedEl.style.zIndex = "";
        draggedEl.style.boxShadow = "";
        rowEls.forEach((el) => { el.style.outline = ""; });
      }

      function onMove(ev) {
        if (ev.pointerId !== pointerId) return;
        const dy = ev.clientY - startY;
        if (!dragging) {
          if (Math.abs(dy) < 6) return; // umbral: un tap con jitter mínimo no arranca el ghost
          dragging = true;
          draggedEl.style.position = "relative";
          draggedEl.style.zIndex = "5";
          draggedEl.style.boxShadow = "0 6px 16px rgba(0,0,0,0.28)";
        }
        draggedEl.style.transform = `translateY(${dy}px)`;

        const center = rects[startIndex].top + rects[startIndex].height / 2 + dy;
        let idx = rects.length - 1;
        for (let i = 0; i < rects.length; i++) {
          if (center < rects[i].bottom) { idx = i; break; }
        }
        if (idx !== targetIndex) {
          targetIndex = idx;
          setIndicator(targetIndex);
        }
      }

      async function commitReorder(newOrder) {
        try {
          await reorderCategories(newOrder);
          await loadData();
        } catch {
          // Reorden no persistido (p.ej. fallo del worker): se repinta con los datos ya cargados,
          // que siguen siendo válidos — no hay nada que deshacer, nunca se mutó `rows` a mano.
        }
        render();
      }

      function finish(commit) {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onCancel);
        try { handle.releasePointerCapture(pointerId); } catch { /* ya liberado por el navegador */ }

        const wasDragging = dragging;
        const finalTarget = targetIndex;
        clearStyles();

        if (!commit || !wasDragging || finalTarget === startIndex) {
          if (wasDragging) render(); // deja el DOM limpio si hubo ghost visual sin persistir nada
          return;
        }
        commitReorder(computeReorder(groupIds, startIndex, finalTarget));
      }

      function onUp(ev) { if (ev.pointerId === pointerId) finish(true); }
      function onCancel(ev) { if (ev.pointerId === pointerId) finish(false); }

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onCancel);
    });
  }

  function wireList() {
    container.querySelector("#cat-back").onclick = () => onBack();
    // Decisión 4: sin state.flow, "Nueva categoría" desde la cabecera crea siempre en gasto — el
    // propio formulario ya deja elegir el tipo con sus chips antes de guardar.
    container.querySelector("#cat-new").onclick = () => openForm({ mode: "create", flow: "expense" });

    container.querySelectorAll("[data-cat]").forEach((b) => {
      b.onclick = () => {
        const cat = rows.find((c) => c.id === b.dataset.cat);
        if (cat) openForm({ mode: "edit", flow: cat.flow, category: cat });
      };
    });

    container.querySelectorAll("[data-add-sub]").forEach((b) => {
      b.onclick = () => {
        const root = roots.find((r) => r.id === b.dataset.addSub);
        if (root) openForm({ mode: "create", flow: root.flow, parentId: root.id });
      };
    });

    container.querySelectorAll("[data-drag]").forEach((h) => wireDragHandle(h));
  }

  render();
}
