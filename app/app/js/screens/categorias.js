import {
  listCategoriesAdmin, allCategoriesById, createCategory, updateCategory,
  archiveCategory, unarchiveCategory, setCategoryStyle, reorderCategories, computeReorder,
} from "../repo.js";
import { colorForCategory, iconForCategory, POOL, CURATED_ICONS, hashIndex } from "../category-colors.js";
import { t } from "../i18n/index.js";
import { pushBack, goBack } from "../back.js";
import { userMessage } from "../errors.js";
import { showConfirm } from "../modal.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");

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

// need_type ('need'|'want'|'savings'|'') → etiqueta de lista, por presencia del valor y NO por
// flow: una raíz de ingreso con need_type (caso raro pero el schema lo permite) también lleva
// etiqueta; las de ingreso sembradas ('' need_type) simplemente no calzan ninguna clave y caen al
// "solo el conteo" que pide el brief.
// Guarda la CLAVE del diccionario, no el texto resuelto: es un const de módulo, evaluado antes de
// initI18n(meta) — resolver aquí con t() congelaría el idioma en el que arrancó la app.
// rootSubtitle() resuelve con t() en cada render, ya con el idioma real (misma ledger ruling que
// FREQ_KEY en recurrentes.js).
const NEED_LABEL_KEY = { need: "categorias.needLabel.need", want: "categorias.needLabel.want", savings: "categorias.needLabel.savings" };

const subcatCount = (n) => t("categorias.subcatCount", { n });

/** Sub de una raíz: "{necesario/prescindible/ahorro} · N subcategorías", o solo "N subcategorías"
 *  si la raíz no tiene need_type (las 3 raíces de ingreso sembradas). `childCount` cuenta TODAS
 *  las hijas del árbol construido en cliente (activas + archivadas) — a propósito NO es el campo
 *  `children` de listCategoriesAdmin (ese cuenta solo hijas ACTIVAS, para el guard de "máx 2
 *  niveles" de updateCategory): el artboard muestra "Casa · necesario · 6 subcategorías" con Gas
 *  archivada incluida en el 6, así que el conteo visible aquí debe incluir archivadas. */
function rootSubtitle(root, childCount) {
  const key = NEED_LABEL_KEY[root.need_type];
  const label = key ? t(key) : null;
  return label ? `${label} · ${subcatCount(childCount)}` : subcatCount(childCount);
}

// Pastilla base de "chip" del formulario (Dentro de): NO reutiliza .chip/.chips de app.css —
// esas asumen un .chip-icon circular a la izquierda que este selector no lleva (el artboard pone
// el emoji inline, sin círculo) — inline, mismo criterio que el resto de este archivo (Task 5).
function chipStyle(active) {
  return `display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:${active ? 700 : 600};
    background:${active ? "var(--text)" : "var(--card2)"};color:${active ? "var(--bg)" : "var(--text-2)"};
    border:0;border-radius:999px;padding:9px 14px;white-space:nowrap;flex-shrink:0;cursor:pointer;
    -webkit-tap-highlight-color:transparent;`;
}

/** Pantalla "Categorías" (PR D): lista de administración (Task 5) + subvista de formulario de
 *  alta/edición con estilo (Task 6). Dos subvistas sobre el mismo container (mismo patrón que
 *  patrimonio.js: state.view decide qué pinta render(), backToList limpia y vuelve). onBack
 *  vuelve a quien haya abierto la pantalla (Ajustes). */
export async function renderCategorias(container, onBack) {
  let rows, byId, roots, childrenByParent;

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
  }

  try {
    await loadData();
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">${t("categorias.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }

  const state = {
    flow: "expense", expanded: new Set(),
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
  const activeRootCount = (flow) => roots.filter((r) => r.flow === flow && !r.is_archived).length;

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

  function archiveButtonLabel(form) {
    return form.isArchived ? t("categorias.archive.unarchive") : t("categorias.archive.archive");
  }

  function renderForm() {
    const form = state.form;
    const editing = form.mode === "edit";
    const isRoot = !form.parentId;
    const lockedParent = editing && form.childrenCount > 0;
    const preview = previewStyle(form);
    const parents = availableParents(form);

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div style="font-size:20px;font-weight:700;letter-spacing:-0.015em;">${t(form.titleKey)}</div>
        <button type="button" id="cf-close" aria-label="${t("categorias.form.closeAria")}"
          style="width:44px;height:44px;border-radius:50%;background:var(--card2);border:0;color:var(--text);
          display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M6 6l12 12M18 6L6 18"></path>
          </svg>
        </button>
      </div>

      <div style="display:flex;flex-direction:column;gap:16px;">

        <div style="background:var(--card2);border-radius:0;padding:12px 16px;display:flex;align-items:center;gap:12px;">
          <div id="cf-preview-dot" class="dotico" style="width:40px;height:40px;font-size:18px;flex-shrink:0;--cat:${preview.color};">${preview.icon}</div>
          <input type="text" id="cf-name" value="${escAttr(form.name)}" placeholder="${t("categorias.form.namePlaceholder")}"
            style="flex:1;min-width:0;border:0;background:none;outline:none;color:var(--text);
            font-size:16px;font-weight:700;font-family:inherit;">
        </div>

        <div>
          <div class="section-title" style="margin-bottom:8px;">${t("common.typeLabel")}</div>
          <div class="segmented" style="border-radius:999px;${editing ? "opacity:0.6;" : ""}">
            ${[["expense", t("common.type.expense")], ["income", t("common.type.income")]].map(([id, label]) => {
              const active = form.flow === id;
              const segStyle = active
                ? "border-radius:999px;background:var(--accent);color:var(--accent-ink);font-weight:600;"
                : "border-radius:999px;";
              return `<button type="button" data-cf-flow="${id}" class="${active ? "active" : ""}"
                style="${segStyle}${editing ? "pointer-events:none;cursor:default;" : ""}">${label}</button>`;
            }).join("")}
          </div>
          ${editing ? `<div style="font-size:11px;color:var(--text-3);margin-top:6px;">${t("categorias.form.typeLockedNote")}</div>` : ""}
        </div>

        ${form.flow === "expense" ? `
        <div>
          <div class="section-title" style="margin-bottom:8px;">${t("categorias.form.needSectionTitle")}</div>
          <div class="segmented" style="border-radius:999px;">
            ${[["need", t("categorias.needType.need")], ["want", t("categorias.needType.want")]].map(([id, label]) => {
              const active = form.needType === id;
              const segStyle = active
                ? "border-radius:999px;background:var(--accent);color:var(--accent-ink);font-weight:600;"
                : "border-radius:999px;";
              return `<button type="button" data-cf-need="${id}" class="${active ? "active" : ""}" style="${segStyle}">${label}</button>`;
            }).join("")}
          </div>
          <div style="font-size:11px;color:var(--text-3);margin-top:6px;">${t("categorias.form.needHint")}</div>
        </div>` : ""}

        <div>
          <div class="section-title" style="margin-bottom:8px;">${t("categorias.form.parentSectionTitle")}</div>
          ${lockedParent ? `
          <div style="${chipStyle(true)}width:fit-content;">${t("categorias.form.rootChip")}</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:6px;">${t("categorias.form.rootLockedNote")}</div>
          ` : `
          <div style="display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px;">
            <button type="button" data-cf-parent="" style="${chipStyle(!form.parentId)}">${t("categorias.form.newRootChip")}</button>
            ${parents.map((r) => {
              const icon = iconForCategory(r.id, byId);
              return `<button type="button" data-cf-parent="${escAttr(r.id)}" style="${chipStyle(form.parentId === r.id)}">${icon} ${escHtml(r.name)}</button>`;
            }).join("")}
          </div>
          <div style="font-size:11px;color:var(--text-3);margin-top:6px;">${t("categorias.form.inheritNote")}</div>
          `}
        </div>

        ${isRoot ? `
        <div>
          <div class="section-title" style="margin-bottom:8px;">${t("categorias.form.colorSectionTitle")}</div>
          <div style="display:grid;grid-template-columns:repeat(6, minmax(0, 1fr));gap:8px;">
            ${POOL.map((c) => {
              const active = form.color === c;
              return `<button type="button" data-cf-color="${c}" aria-label="${t("categorias.form.pickColorAria")}"
                style="width:100%;aspect-ratio:1;border:0;padding:0;border-radius:0;background:${c};cursor:pointer;
                -webkit-tap-highlight-color:transparent;${active ? "outline:2px solid var(--text);outline-offset:3px;" : ""}"></button>`;
            }).join("")}
          </div>
          <div style="font-size:11px;color:var(--text-3);margin-top:8px;">${t("categorias.form.colorHint")}</div>
        </div>

        <div>
          <div class="section-title" style="margin-bottom:8px;">${t("categorias.form.iconSectionTitle")}</div>
          <div style="display:grid;grid-template-columns:repeat(8, minmax(0, 1fr));gap:8px;">
            ${form.iconOrder.map((ic) => {
              const active = form.icon === ic;
              return `<button type="button" data-cf-icon="${escAttr(ic)}" aria-label="${t("categorias.form.pickIconAria")}"
                style="aspect-ratio:1;border:0;padding:0;border-radius:0;background:var(--card2);font-size:20px;cursor:pointer;
                display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;
                ${active ? "outline:2px solid var(--text);outline-offset:2px;" : ""}">${ic}</button>`;
            }).join("")}
          </div>
          <div style="font-size:11px;color:var(--text-3);margin-top:8px;">${t("categorias.form.iconHint")}</div>
        </div>
        ` : `
        <div>
          <div class="section-title" style="margin-bottom:8px;">${t("categorias.form.colorIconSectionTitle")}</div>
          <div style="font-size:11px;color:var(--text-3);">${t("categorias.form.inheritNote")}</div>
        </div>
        `}

        ${state.formError ? `<div class="banner-aviso red">${escHtml(state.formError)}</div>` : ""}

        <button type="button" class="btn-primary" id="cf-save" style="${isRoot ? `background:var(--accent);color:var(--accent-ink);` : ""}">
          ${editing ? t("common.saveChanges") : t("categorias.form.create")}
        </button>

        ${editing ? `
        <button type="button" id="cf-archive"
          style="border:0;cursor:pointer;font-size:13px;font-weight:600;text-align:center;
          background:none;color:var(--red);padding:4px 0 0;">
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
      state.flow = form.flow; // así la categoría recién creada/editada es visible sin cambiar de pestaña a mano
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

    container.querySelector("#cf-close").onclick = () => goBack();

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
    // Para que el preview SÍ sea vivo sin ese riesgo, cuando cambia el color sugerido (nombre sin
    // tocar un swatch, en una raíz) se parchea a mano SOLO el circulito y el outline del swatch —
    // dos nodos ya existentes, nunca innerHTML — así el input y cualquier otro control nunca se
    // desconectan a media pulsación.
    const nameInput = container.querySelector("#cf-name");
    nameInput.oninput = (e) => {
      form.name = e.target.value;
      state.formError = "";
      if (form.colorTouched || form.parentId) return; // hija: el circulito no depende del nombre
      const nextColor = POOL[hashIndex(slug(form.name))];
      if (nextColor === form.color) return;
      form.color = nextColor;
      const dot = container.querySelector("#cf-preview-dot");
      if (dot) dot.style.setProperty("--cat", form.color);
      container.querySelectorAll("[data-cf-color]").forEach((b) => {
        const active = b.dataset.cfColor === form.color;
        b.style.outline = active ? "2px solid var(--text)" : "";
        b.style.outlineOffset = active ? "3px" : "";
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
  // Task 5: subvista de lista (sin cambios de comportamiento — solo pasa a
  // colgar del dispatcher render()/state.view en vez de ser el único render)
  // ========================================================================

  // Fila de hija: envuelta en un div (data-child-row, para medir/mover en el drag — Task 7) que
  // NO es el botón que abre el formulario — el handle ≡ vive fuera de ese botón a propósito, así
  // un tap/drag sobre el handle nunca puede disparar su click (ver wireDragHandle más abajo).
  function childRowHtml(child) {
    const color = dotColor(child);
    const icon = iconForCategory(child.id, byId);
    return `
    <div data-child-row="${escAttr(child.id)}" style="display:flex;align-items:center;padding-left:44px;${child.is_archived ? "opacity:0.5;" : ""}">
      <span class="cat-drag" data-drag="${escAttr(child.id)}" aria-hidden="true"
        style="color:var(--text-3);font-size:14px;flex-shrink:0;opacity:0.6;letter-spacing:-1px;cursor:grab;
        touch-action:none;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;
        padding:10px 8px 10px 0;">≡</span>
      <button type="button" class="cat-row" data-cat="${escAttr(child.id)}"
        style="flex:1;min-width:0;display:flex;align-items:center;gap:12px;padding:9px 0;background:none;
        border:0;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;">
        <div class="dotico" style="width:28px;height:28px;font-size:13px;--cat:${color};">${icon}</div>
        <div class="tx-body" style="flex:1;min-width:0;">
          <div class="tx-title">${escHtml(child.name)}</div>
        </div>
        ${child.is_archived ? `<span class="day-label" style="flex-shrink:0;">${t("categorias.archivedLabel")}</span>` : ""}
      </button>
    </div>`;
  }

  // Grupo de hijas de una raíz expandida: ÚNICO contenedor .card de toda la pantalla (el resto de
  // la lista va a fondo plano, como el artboard) — ese contraste de fondo es la señal visual de
  // "esto está anidado bajo la raíz de arriba". Envolver también las raíces en un .card la
  // borraría (el grupo dejaría de distinguirse de su entorno).
  function groupHtml(root) {
    const kids = childrenByParent.get(root.id) ?? [];
    // Item 4 (review final): una raíz archivada no ofrece "+ Añadir subcategoría" — createCategory
    // ya lo rechazaría en el repo (padre archivado), esto evita el viaje de ida y vuelta con error.
    return `
    <div class="card" style="border-radius:var(--radius-sm);padding:2px 12px 10px;margin-bottom:6px;">
      ${kids.map(childRowHtml).join("")}
      ${root.is_archived ? "" : `
      <button type="button" data-add-sub="${root.id}"
        style="height:36px;padding:0 14px;margin:6px 0 0 44px;border-radius:999px;background:var(--card2);
        color:var(--text);border:0;font-size:12px;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;">
        ${t("categorias.addSubcategory")}
      </button>`}
    </div>`;
  }

  // Fila de raíz: DOS botones hermanos (no un botón dentro de otro — HTML inválido y el navegador
  // lo desarma) dentro de un div flex — uno cubre dotico+texto y abre el formulario de edición, el
  // otro es solo el chevron y expande/colapsa. Coincide con el hint de la pantalla: "Toca una
  // categoría para editarla; el chevron abre sus subcategorías."
  function rootRowHtml(root, isLast) {
    const kids = childrenByParent.get(root.id) ?? [];
    const expanded = state.expanded.has(root.id);
    const color = dotColor(root);
    const icon = iconForCategory(root.id, byId);
    const sub = rootSubtitle(root, kids.length);
    // El separador entre raíces se omite en la última Y en cualquiera que esté expandida (su
    // grupo de hijas, con fondo propio, ya la separa de la siguiente raíz) — mismo criterio que
    // el artboard, donde Casa (expandida) y Ocio (última visible) llevan border-bottom:0.
    const suppressBorder = isLast || expanded;
    return `
    <div data-root-row="${escAttr(root.id)}" style="display:flex;align-items:center;${root.is_archived ? "opacity:0.5;" : ""}
      ${suppressBorder ? "" : "border-bottom:1px solid var(--rule);"}">
      <span class="cat-drag" data-drag="${escAttr(root.id)}" aria-hidden="true"
        style="color:var(--text-3);font-size:14px;flex-shrink:0;opacity:0.6;letter-spacing:-1px;cursor:grab;
        touch-action:none;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;
        padding:14px 8px 14px 0;">≡</span>
      <button type="button" class="cat-row" data-cat="${escAttr(root.id)}"
        style="flex:1;min-width:0;display:flex;align-items:center;gap:12px;padding:13px 0;background:none;border:0;
        text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;">
        <div class="dotico" style="--cat:${color};">${icon}</div>
        <div class="tx-body" style="min-width:0;">
          <div class="tx-title">${escHtml(root.name)}</div>
          <div class="tx-sub">${sub}</div>
        </div>
      </button>
      ${root.is_archived ? `<span class="day-label" style="flex-shrink:0;">${t("categorias.archivedLabel")}</span>` : ""}
      <button type="button" data-chevron="${root.id}"
        aria-label="${expanded ? t("categorias.chevron.collapse") : t("categorias.chevron.expand")}"
        style="flex-shrink:0;width:44px;height:44px;display:flex;align-items:center;justify-content:center;
        background:none;border:0;cursor:pointer;color:var(--text-3);-webkit-tap-highlight-color:transparent;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${expanded ? 90 : 0}deg);">
          <path d="M9 5l7 7-7 7"></path>
        </svg>
      </button>
    </div>
    ${expanded ? groupHtml(root) : ""}`;
  }

  function renderList() {
    const flowRoots = rootsOfFlow(state.flow);
    const expenseCount = activeRootCount("expense");
    const incomeCount = activeRootCount("income");

    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
        <button type="button" class="icon-btn" id="cat-back" aria-label="${t("common.goBack")}"
          style="width:44px;height:44px;border-radius:50%;background:var(--card);color:var(--text);font-size:18px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"></path></svg></button>
        <h1 style="flex:1;font-size:20px;font-weight:700;letter-spacing:-0.015em;">${t("categorias.title")}</h1>
        <button type="button" id="cat-new"
          style="height:44px;padding:0 18px;border-radius:999px;background:var(--text);color:var(--bg);border:0;
          font-size:13px;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent;">${t("common.addNew")}</button>
      </div>

      <div class="segmented" style="margin-bottom:10px;border-radius:999px;">
        ${[["expense", t("categorias.flow.expenseCount", { n: expenseCount })], ["income", t("categorias.flow.incomeCount", { n: incomeCount })]].map(([id, label]) => {
          const active = state.flow === id;
          const segStyle = active
            ? "border-radius:999px;background:var(--accent);color:var(--accent-ink);font-weight:600;"
            : "border-radius:999px;";
          return `<button type="button" data-flow="${id}" class="${active ? "active" : ""}" style="${segStyle}">${label}</button>`;
        }).join("")}
      </div>

      <div style="font-size:11.5px;color:var(--text-3);margin-bottom:8px;">
        ${t("categorias.list.hint")}
      </div>

      <div style="display:flex;flex-direction:column;">
        ${flowRoots.length === 0
          ? `<div class="card" style="text-align:center;color:var(--text-3);"><p>${t(state.flow === "expense" ? "categorias.empty.expense" : "categorias.empty.income")}</p></div>`
          : flowRoots.map((r, i) => rootRowHtml(r, i === flowRoots.length - 1)).join("")}
      </div>

      <div class="card" style="border-radius:var(--radius-sm);padding:12px 16px;margin-top:16px;display:flex;align-items:center;gap:10px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.7"
          stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
          <circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16.5v.01"></path>
        </svg>
        <div style="font-size:11.5px;color:var(--text-3);">
          ${t("categorias.list.archiveInfo")}
        </div>
      </div>
    `;
    wireList();
  }

  // ========================================================================
  // Task 7: reorden por arrastre (handle ≡). Grupos de reorden: raíces del
  // flow activo entre sí (rootsOfFlow), o hijas de una misma raíz entre sí
  // (childrenByParent.get(parentId)) — jamás se cruza de grupo, porque los
  // rects que se miden y comparan durante el arrastre son SIEMPRE los del
  // propio grupo (nunca se consulta nada de otro grupo).
  //
  // Indicador de drop (outline en la fila objetivo) en vez de desplazar los
  // hermanos con transform: un grupo de raíces puede tener grupos de hijas
  // expandidos intercalados entre dos de sus filas (groupHtml es HERMANO de
  // la fila, no hijo — ver rootRowHtml), así que las filas de un mismo
  // grupo no son necesariamente contiguas en pantalla. Desplazar hermanos
  // asumiendo alturas/huecos uniformes se rompería en ese caso; el
  // indicador no tiene ese problema porque no reposiciona nada más que la
  // propia fila arrastrada (ghost vía transform).
  //
  // setPointerCapture en pointerdown (no tras el umbral): así todo el gesto
  // — incluido el primer movimiento que decide si hay drag — llega SIEMPRE
  // al handle, sin importar dónde ande el dedo/cursor. El umbral de 6px
  // solo gobierna cuándo se activa el feedback visual (ghost + indicador),
  // no si el evento llega: un tap simple en el handle no dispara nada (no
  // tiene onclick propio) y, al vivir fuera del botón .cat-row, tampoco
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
    container.querySelector("#cat-new").onclick = () => openForm({ mode: "create", flow: state.flow });

    container.querySelectorAll("[data-flow]").forEach((b) => {
      b.onclick = () => { state.flow = b.dataset.flow; render(); };
    });

    container.querySelectorAll("[data-chevron]").forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.chevron;
        if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
        render();
      };
    });

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
