import {
  listCategoriesAdmin, allCategoriesById, createCategory, updateCategory,
  archiveCategory, unarchiveCategory, setCategoryStyle, reorderCategories, computeReorder,
} from "../repo.js";
import {
  familyForCategory, iconForCategory, FAMILIES, CAT_ICON_KEYS, hashIndex, famClass,
} from "../category-colors.js";
import { t } from "../i18n/index.js";
import { goBack } from "../back.js";
import { userMessage } from "../errors.js";
import { showConfirm } from "../modal.js";
import { showSheet } from "../sheet.js";
import { subHeaderHtml, buttonHtml } from "../ui.js";
import { segmentedHtml, wireSegmented, fieldHtml, neutralChipHtml } from "../controls.js";
import { tileHtml, filterChipHtml, familySwatchesHtml } from "../entity.js";
import { icon, catIcon } from "../icons.js";

import { escHtml, escAttr } from "../esc.js";

// Slug determinista para la sugerencia de familia en creación: quita diacríticos y normaliza
// mayúsculas/espacios para que "Mascotas"/"mascotas " sugieran la misma. hashIndex ya es estable
// sobre la cadena resultante. Descompone en NFD y filtra las marcas combinantes (0x0300..0x036F)
// por código de punto, sin una clase de regex con escapes \u que pida el flag "u".
function slug(s) {
  let out = "";
  for (const ch of String(s ?? "").trim().toLowerCase().normalize("NFD")) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x0300 && cp <= 0x036f) continue;
    out += ch;
  }
  return out;
}

const subcatCount = (n) => t("categorias.subcatCount", { n });

/** Los 24 iconos de CAT_ICONS con el actual/sugerido primero. Se calcula UNA VEZ al abrir la hoja:
 *  reordenar en cada pintado haría saltar la rejilla cada vez que se toca un icono distinto. */
function buildIconOrder(current) {
  const list = [...CAT_ICON_KEYS];
  const idx = list.indexOf(current);
  if (idx > 0) { list.splice(idx, 1); list.unshift(current); }
  else if (idx === -1 && current) list.unshift(current);
  return list;
}

/** Selector CSS con el que volver a encontrar, tras un repintado, el control que tenía el foco
 *  (K12: el foco no se pierde al elegir). null si no es uno de los controles de la hoja. */
function focusKey(el) {
  if (!el || !el.getAttribute) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  for (const attr of ["data-fam", "data-cf-icon", "data-cf-parent"]) {
    const v = el.getAttribute(attr);
    if (v !== null) return `[${attr}="${CSS.escape(v)}"]`;
  }
  const seg = el.closest?.(".ctl-segmented[id]");
  if (seg && el.dataset.value !== undefined) return `#${CSS.escape(seg.id)} [data-value="${CSS.escape(el.dataset.value)}"]`;
  return null;
}

/** Pantalla «Categorías» (S10, B-Categorias / BD-Categorias): Segmented Gasto · Ingreso con su
 *  número de categorías, un bloque por categoría en el tinte de su familia (C6) con baldosa sobre
 *  --chip, «+» para añadir subcategoría y asa de reordenar de 44; las subcategorías como chips
 *  neutros (F-43), la archivada con borde discontinuo en la barra de su familia. Crear y editar van
 *  en la hoja inferior (sheet.js, B-Categorias-Nueva). onBack vuelve a Ajustes. */
export async function renderCategorias(container, onBack) {
  let rows, byId, roots, childrenByParent;

  // Árbol en cliente por parent_id — NUNCA por adyacencia de filas: listCategoriesAdmin ordena
  // (flow, parent_id, display_order), así que TODAS las raíces salen primero y LUEGO las hijas
  // agrupadas por padre. El orden dentro de cada grupo ya es el de display_order.
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
    container.innerHTML = `<div class="cat">
      ${subHeaderHtml({ id: "cat-back", title: t("categorias.title") })}
      <p class="cat-error" role="alert">${escHtml(t("categorias.error.load", { error: userMessage(e) }))}</p>
    </div>`;
    container.querySelector("#cat-back").onclick = () => onBack();
    return;
  }

  const state = { flow: "expense" };
  const rootsOfFlow = (flow) => roots.filter((r) => r.flow === flow);

  // ========================================================================
  // Lista
  // ========================================================================

  /** Chip de subcategoría (F-43): neutro, 14/500. La archivada, transparente con borde discontinuo
   *  en la barra de la familia del bloque (hereda --fb de la .fam-<k> del <section>) y el icono de
   *  archivo. data-kid es el gancho de la pulsación larga que reordena. */
  function kidChipHtml(kid) {
    const archived = !!kid.is_archived;
    return neutralChipHtml({
      label: kid.name,
      data: { cat: kid.id, kid: kid.id },
      ariaLabel: archived ? t("categorias.archivedChipAria", { name: kid.name }) : "",
      icon: archived ? "archive" : "",
      cls: archived ? "cat-kid is-archived" : "cat-kid",
    });
  }

  /** «6 subcategorías, 1 archivada» / «Sin subcategorías» / «Archivada». */
  function rootSubtitle(root, kids) {
    if (root.is_archived) return t("categorias.archivedLabel");
    if (kids.length === 0) return t("categorias.noSubcats");
    const archived = kids.filter((k) => k.is_archived).length;
    return archived > 0
      ? `${subcatCount(kids.length)}, ${t("categorias.archivedCount", { n: archived })}`
      : subcatCount(kids.length);
  }

  /** Bloque de categoría (B-Categorias): tinte de la familia (C6), sin borde; un ingreso no tiene
   *  familia (C9) y va en --well. El nombre (baldosa + nombre + línea 2) es UN botón que abre la
   *  hoja; «+» y el asa van fuera de él, así un arrastre nunca dispara el tap de editar. El asa es
   *  decorativa (aria-hidden) como antes: solo responde al puntero. */
  function blockHtml(root) {
    const kids = childrenByParent.get(root.id) ?? [];
    const fam = familyForCategory(root.id, byId);
    const archived = !!root.is_archived;
    const cls = ["cat-block", famClass(fam), !fam && "is-plain", archived && "is-archived"].filter(Boolean).join(" ");
    const nameId = `cat-n-${root.id}`;
    return `<section class="${cls}" data-root-row="${escAttr(root.id)}" aria-labelledby="${escAttr(nameId)}">
      <div class="cat-head">
        <button type="button" class="cat-name-btn" data-cat="${escAttr(root.id)}">
          ${tileHtml({ fam, icon: iconForCategory(root.id, byId), size: 32, onTint: true })}
          <span class="cat-nm">
            <span class="cat-name" id="${escAttr(nameId)}">${escHtml(root.name)}</span>
            <span class="cat-sub">${escHtml(rootSubtitle(root, kids))}</span>
          </span>
        </button>
        ${archived ? "" : `<button type="button" class="cat-ib" data-add-sub="${escAttr(root.id)}" aria-label="${escAttr(t("categorias.addSubAria", { name: root.name }))}">${icon("plus")}</button>`}
        <span class="cat-ib cat-grip" data-drag="${escAttr(root.id)}" aria-hidden="true">${icon("drag")}</span>
      </div>
      ${kids.length ? `<div class="cat-kids">${kids.map(kidChipHtml).join("")}</div>` : ""}
    </section>`;
  }

  function listBodyHtml() {
    const flowRoots = rootsOfFlow(state.flow);
    if (flowRoots.length === 0) {
      return `<p class="cat-empty">${escHtml(t(state.flow === "expense" ? "categorias.empty.expense" : "categorias.empty.income"))}</p>`;
    }
    return flowRoots.map(blockHtml).join("");
  }

  function renderList() {
    container.innerHTML = `<div class="cat">
      ${subHeaderHtml({ id: "cat-back", title: t("categorias.title"), action: { id: "cat-new", icon: "plus", label: t("categorias.form.title.new") } })}
      ${segmentedHtml({
        id: "cat-flow", name: t("categorias.flowLabel"), value: state.flow,
        options: [
          { value: "expense", label: t("common.type.expense"), count: rootsOfFlow("expense").length },
          { value: "income", label: t("common.type.income"), count: rootsOfFlow("income").length },
        ],
      })}
      <p class="cat-hint">${escHtml(t("categorias.list.hint"))}</p>
      <div class="cat-list" id="cat-list">${listBodyHtml()}</div>
    </div>`;
    container.querySelector("#cat-back").onclick = () => onBack();
    container.querySelector("#cat-new").onclick = () => openForm({ mode: "create", flow: state.flow });
    // Cambiar de tipo solo repinta los bloques: el Segmented se queda (y con él, el foco).
    wireSegmented(container.querySelector("#cat-flow"), (v) => {
      state.flow = v;
      renderListBody();
    });
    wireListBody();
  }

  function renderListBody() {
    const list = container.querySelector("#cat-list");
    if (!list) return;
    list.innerHTML = listBodyHtml();
    wireListBody();
  }

  function wireListBody() {
    const list = container.querySelector("#cat-list");
    list.querySelectorAll("[data-cat]").forEach((b) => {
      b.addEventListener("click", (e) => {
        // Un arrastre por pulsación larga acaba en un click sobre el mismo chip: no abre la hoja.
        if (b.dataset.dragged === "1") { e.preventDefault(); delete b.dataset.dragged; return; }
        const cat = rows.find((c) => c.id === b.dataset.cat);
        if (cat) openForm({ mode: "edit", flow: cat.flow, category: cat });
      });
    });
    list.querySelectorAll("[data-add-sub]").forEach((b) => {
      b.onclick = () => {
        const root = roots.find((r) => r.id === b.dataset.addSub);
        if (root) openForm({ mode: "create", flow: root.flow, parentId: root.id });
      };
    });
    list.querySelectorAll("[data-drag]").forEach((h) => wireRootDrag(h));
    list.querySelectorAll("[data-kid]").forEach((c) => wireKidDrag(c));
  }

  async function commitReorder(newOrder) {
    try {
      await reorderCategories(newOrder);
      await loadData();
    } catch {
      // Reorden no persistido (p. ej. fallo del worker): se repinta con los datos ya cargados,
      // que siguen siendo válidos — nunca se mutó `rows` a mano.
    }
    renderListBody();
  }

  // ========================================================================
  // Reordenar las categorías: asa de 44 (icon("drag")). El grupo son los bloques del tipo que se
  // ve, contiguos en la lista. setPointerCapture en pointerdown: todo el gesto llega al asa; el
  // umbral de 6 px solo decide cuándo se ve el arrastre. Indicador de destino con clase (borde
  // discontinuo) y el bloque arrastrado sube con var(--sh-alert); solo transform va en línea.
  // ========================================================================
  function wireRootDrag(handle) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.isPrimary === false || (e.button !== undefined && e.button !== 0)) return;
      const id = handle.dataset.drag;
      const groupIds = rootsOfFlow(state.flow).map((r) => r.id);
      const startIndex = groupIds.indexOf(id);
      if (startIndex === -1 || groupIds.length < 2) return;
      const rowEls = groupIds.map((gid) => container.querySelector(`[data-root-row="${CSS.escape(gid)}"]`));
      if (rowEls.some((el) => !el)) return;

      const draggedEl = rowEls[startIndex];
      const rects = rowEls.map((el) => el.getBoundingClientRect());
      const startY = e.clientY;
      const pointerId = e.pointerId;
      e.preventDefault();
      try { handle.setPointerCapture(pointerId); } catch { return; }

      let dragging = false;
      let targetIndex = startIndex;
      const setIndicator = (idx) => rowEls.forEach((el, i) => el.classList.toggle("is-drop-target", i === idx && i !== startIndex));

      function onMove(ev) {
        if (ev.pointerId !== pointerId) return;
        const dy = ev.clientY - startY;
        if (!dragging) {
          if (Math.abs(dy) < 6) return;
          dragging = true;
          draggedEl.classList.add("is-dragging");
        }
        draggedEl.style.transform = `translateY(${dy}px)`;
        // Destino por la posición del dedo, no por el centro del bloque: los bloques miden distinto
        // (con o sin subcategorías) y el centro de uno alto caería un bloque más allá.
        let idx = rects.length - 1;
        for (let i = 0; i < rects.length; i++) {
          if (ev.clientY < rects[i].bottom) { idx = i; break; }
        }
        if (idx !== targetIndex) { targetIndex = idx; setIndicator(targetIndex); }
      }

      function finish(commit) {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onCancel);
        try { handle.releasePointerCapture(pointerId); } catch { /* ya liberado */ }
        const wasDragging = dragging;
        draggedEl.style.transform = "";
        draggedEl.classList.remove("is-dragging");
        setIndicator(-1);
        if (!commit || !wasDragging || targetIndex === startIndex) return;
        commitReorder(computeReorder(groupIds, startIndex, targetIndex));
      }
      const onUp = (ev) => { if (ev.pointerId === pointerId) finish(true); };
      const onCancel = (ev) => { if (ev.pointerId === pointerId) finish(false); };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onCancel);
    });
  }

  // ========================================================================
  // Reordenar subcategorías: los chips no tienen asa (B-Categorias), así que se arrastran con una
  // pulsación larga (350 ms quieto). Si el dedo se mueve antes, es un scroll y no se toca nada;
  // si se levanta antes, es un tap (abre la hoja). Una vez en arrastre, un touchmove no pasivo
  // impide que el navegador desplace la página, y el destino es el chip hermano más cercano en 2D
  // (los chips van en varias filas). El click que sigue al arrastre se descarta (data-dragged).
  // ========================================================================
  const LONG_PRESS_MS = 350;
  function wireKidDrag(chip) {
    chip.addEventListener("contextmenu", (e) => { if (chip.dataset.pressing === "1") e.preventDefault(); });
    chip.addEventListener("pointerdown", (e) => {
      if (e.isPrimary === false || (e.button !== undefined && e.button !== 0)) return;
      const id = chip.dataset.kid;
      const kid = rows.find((c) => c.id === id);
      if (!kid) return;
      const groupIds = (childrenByParent.get(kid.parent_id) ?? []).map((c) => c.id);
      const startIndex = groupIds.indexOf(id);
      if (startIndex === -1 || groupIds.length < 2) return;

      const pointerId = e.pointerId;
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      let targetIndex = startIndex;
      let chipEls = [];
      let rects = [];
      chip.dataset.pressing = "1";

      const blockTouch = (te) => { if (dragging) te.preventDefault(); };
      document.addEventListener("touchmove", blockTouch, { passive: false });

      const timer = setTimeout(() => {
        chipEls = groupIds.map((gid) => container.querySelector(`[data-kid="${CSS.escape(gid)}"]`));
        if (chipEls.some((el) => !el)) { cleanup(); return; }
        rects = chipEls.map((el) => el.getBoundingClientRect());
        dragging = true;
        try { chip.setPointerCapture(pointerId); } catch { /* el gesto sigue llegando al chip */ }
        chip.classList.add("is-dragging");
      }, LONG_PRESS_MS);

      const setIndicator = (idx) => chipEls.forEach((el, i) => el.classList.toggle("is-drop-target", i === idx && i !== startIndex));

      function onMove(ev) {
        if (ev.pointerId !== pointerId) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragging) {
          if (Math.hypot(dx, dy) > 8) cleanup(); // se movió antes de tiempo: era un scroll
          return;
        }
        chip.style.transform = `translate(${dx}px, ${dy}px)`;
        let best = startIndex;
        let bestD = Infinity;
        rects.forEach((r, i) => {
          const d = Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2));
          if (d < bestD) { bestD = d; best = i; }
        });
        if (best !== targetIndex) { targetIndex = best; setIndicator(targetIndex); }
      }

      function cleanup() {
        clearTimeout(timer);
        document.removeEventListener("touchmove", blockTouch);
        chip.removeEventListener("pointermove", onMove);
        chip.removeEventListener("pointerup", onUp);
        chip.removeEventListener("pointercancel", onCancel);
        delete chip.dataset.pressing;
      }

      function finish(commit) {
        const wasDragging = dragging;
        cleanup();
        if (!wasDragging) return; // tap: el click normal abre la hoja
        try { chip.releasePointerCapture(pointerId); } catch { /* ya liberado */ }
        chip.dataset.dragged = "1";
        chip.style.transform = "";
        chip.classList.remove("is-dragging");
        setIndicator(-1);
        if (commit && targetIndex !== startIndex) commitReorder(computeReorder(groupIds, startIndex, targetIndex));
        // Si no llega un click (p. ej. soltado fuera), la marca no debe comerse el próximo tap.
        else setTimeout(() => { delete chip.dataset.dragged; }, 400);
      }
      const onUp = (ev) => { if (ev.pointerId === pointerId) finish(true); };
      const onCancel = (ev) => { if (ev.pointerId === pointerId) finish(false); };
      chip.addEventListener("pointermove", onMove);
      chip.addEventListener("pointerup", onUp);
      chip.addEventListener("pointercancel", onCancel);
    });
  }

  // ========================================================================
  // Hoja «Nueva / Editar categoría» (B-Categorias-Nueva): nombre en campo hundido con la baldosa
  // de vista previa, Segmented Categoría / Subcategoría de…, familia (12) e icono solo en una
  // categoría de gasto; una subcategoría hereda los de su categoría (§6) y un ingreso no tiene (C9).
  // ========================================================================

  let dlg = null;    // la hoja abierta (sheet.js la cuelga de <body>, no de container)
  let form = null;

  /** opts: { mode:"create", flow } | { mode:"create", flow, parentId } | { mode:"edit", flow, category } */
  function openForm({ mode, flow, category, parentId }) {
    if (dlg) return;
    // wasRoot: ¿ya era categoría (raíz) al abrir? Gobierna si la familia sigue al nombre mientras
    // se teclea y cómo se guarda el estilo (ver save()).
    const wasRoot = mode === "edit" && category.parent_id === "";
    const initialName = mode === "edit" ? category.name : "";
    // Familia: la resuelta si ya era raíz; si no, la sugerida por el nombre (misma ranura djb2).
    // Una categoría nueva estrena el icono de su familia y lo sigue mientras no se toque.
    const initialFam = (wasRoot ? familyForCategory(category.id, byId) : null) ?? FAMILIES[hashIndex(slug(initialName))];
    const initialIcon = wasRoot ? iconForCategory(category.id, byId) : initialFam;
    const startParent = mode === "edit" ? category.parent_id : (parentId || "");

    form = {
      mode,
      id: mode === "edit" ? category.id : null,
      flow: mode === "edit" ? category.flow : flow,
      name: initialName,
      // 'savings' (solo en algunas raíces de ingreso sembradas) no tiene hueco en Necesario /
      // Prescindible, que solo se muestra en gasto: cae a "need".
      needType: mode === "edit" ? (category.need_type === "want" ? "want" : "need") : "need",
      parentId: startParent,
      lastParentId: startParent,
      isArchived: mode === "edit" ? !!category.is_archived : false,
      // Hijas ACTIVAS (campo `children` de listCategoriesAdmin): solo el texto del aviso de cascada.
      activeChildrenCount: mode === "edit" ? (category.children || 0) : 0,
      // TOTAL de hijas (activas + archivadas): el guard de updateCategory (SQL.hasChildren) no
      // distingue archivadas, así que la hoja tampoco deja colgar de otra a una con hijas.
      childrenCount: mode === "edit" ? (childrenByParent.get(category.id) ?? []).length : 0,
      wasRoot,
      colorTouched: wasRoot,
      iconTouched: wasRoot,
      fam: initialFam,
      icon: initialIcon,
      initialFam,
      initialIcon,
      iconOrder: buildIconOrder(initialIcon),
      error: "",
    };
    const titleKey = mode === "edit" ? "categorias.form.title.edit" : (parentId ? "categorias.form.title.newChild" : "categorias.form.title.new");
    dlg = showSheet({
      title: t(titleKey),
      action: `<button type="button" class="icon-btn" id="cf-close" aria-label="${escAttr(t("categorias.form.closeAria"))}">${icon("close")}</button>`,
      body: formBodyHtml(),
    });
    if (!dlg) { form = null; return; }
    dlg.addEventListener("close", () => { dlg = null; form = null; });
    dlg.querySelector("#cf-close").onclick = () => goBack();
    wireForm();
  }

  // Raíces elegibles para «Dentro de»: ACTIVAS, del tipo del formulario, excluida ella misma.
  const availableParents = () => roots.filter((r) => r.flow === form.flow && !r.is_archived && r.id !== form.id);

  /** Baldosa de la vista previa: la familia/icono elegidos si es categoría de gasto; los heredados
   *  de la elegida en «Dentro de» si es subcategoría; neutra con el icono de ingreso si es ingreso. */
  function previewTileHtml() {
    if (form.flow !== "expense") return tileHtml({ fam: null, icon: "income", size: 32 });
    if (form.parentId) return tileHtml({ fam: familyForCategory(form.parentId, byId), icon: iconForCategory(form.parentId, byId), size: 32 });
    return tileHtml({ fam: form.fam, icon: form.icon, size: 32 });
  }

  /** Primera categoría de gasto (activa, que no sea la propia) que ya usa cada familia. */
  function famUsers() {
    const out = {};
    for (const r of roots) {
      if (r.flow !== "expense" || r.is_archived || r.id === form.id) continue;
      const f = familyForCategory(r.id, byId);
      if (f && !out[f]) out[f] = r.name;
    }
    return out;
  }

  /** Familia e icono (solo categoría de gasto). Se repinta sola al teclear el nombre mientras la
   *  familia siga la sugerencia: el input está fuera de este bloque y no pierde el foco. */
  function styleHtml() {
    if (form.parentId || form.flow !== "expense") return "";
    const users = famUsers();
    const famName = t(`families.${form.fam}`);
    const shared = users[form.fam];
    const note = shared ? t("categorias.form.famShared", { name: shared }) : t("categorias.form.famFree");
    return `<div class="cat-sec">
        <span class="cat-label" id="cf-fam-label">${escHtml(t("categorias.form.famLabel"))}</span>
        ${familySwatchesHtml({
          id: "cf-fam", label: t("categorias.form.famLabel"), value: form.fam,
          options: FAMILIES.map((k) => ({ fam: k, label: users[k] ? t("categorias.form.famUsedBy", { fam: t(`families.${k}`), name: users[k] }) : t(`families.${k}`) })),
        })}
        <p class="cat-note"><b class="cat-note-fam ${famClass(form.fam)}">${escHtml(famName)}</b>${escHtml(note)}</p>
      </div>
      <div class="cat-sec">
        <span class="cat-label">${escHtml(t("categorias.form.iconSectionTitle"))}</span>
        <div class="cat-icons" role="group" aria-label="${escAttr(t("categorias.form.iconSectionTitle"))}">
          ${form.iconOrder.map((key) => {
            const on = form.icon === key;
            return `<button type="button" class="cat-icon-pick${on ? ` ${famClass(form.fam)}` : ""}" aria-pressed="${on}" data-cf-icon="${escAttr(key)}" aria-label="${escAttr(t(`icons.cat.${key}`))}">${catIcon(key, { size: 22 })}</button>`;
          }).join("")}
        </div>
      </div>`;
  }

  function placeHtml() {
    const editing = form.mode === "edit";
    if (editing && form.childrenCount > 0) {
      return `<p class="cat-note">${escHtml(t("categorias.form.rootLockedNote"))}</p>`;
    }
    const parents = availableParents();
    if (parents.length === 0 && !form.parentId) return "";
    const place = form.parentId ? "child" : "root";
    return `${segmentedHtml({
        id: "cf-place", name: t("categorias.form.placeLabel"), value: place,
        options: [{ value: "root", label: t("categorias.form.place.root") }, { value: "child", label: t("categorias.form.place.child") }],
      })}
      ${form.parentId ? `<div class="cat-sec">
        <span class="cat-label" id="cf-parent-label">${escHtml(t("categorias.form.parentSectionTitle"))}</span>
        <div class="cat-parents" role="group" aria-labelledby="cf-parent-label">
          ${parents.map((r) => filterChipHtml({ fam: familyForCategory(r.id, byId), label: r.name, selected: form.parentId === r.id, data: { cfParent: r.id } })).join("")}
        </div>
        <p class="cat-note">${escHtml(t("categorias.form.inheritNote"))}</p>
      </div>` : ""}`;
  }

  function formBodyHtml() {
    const editing = form.mode === "edit";
    return `<div class="cat-form">
      ${fieldHtml({ id: "cf-name", label: t("common.name"), value: form.name, placeholder: t("categorias.form.namePlaceholder"), lead: previewTileHtml() })}
      ${placeHtml()}
      <div id="cf-style" class="cat-style">${styleHtml()}</div>
      ${form.flow === "expense" ? `<div class="cat-sec">
        <span class="cat-label" id="cf-need-label">${escHtml(t("categorias.form.needSectionTitle"))}</span>
        ${segmentedHtml({
          id: "cf-need", name: t("categorias.form.needSectionTitle"), labelledBy: "cf-need-label", value: form.needType,
          options: [{ value: "need", label: t("categorias.needType.need") }, { value: "want", label: t("categorias.needType.want") }],
        })}
      </div>` : ""}
      ${form.error ? `<p class="cat-error" role="alert">${icon("warn", { size: 18 })}<span>${escHtml(form.error)}</span></p>` : ""}
      ${buttonHtml({ kind: "primary", id: "cf-save", label: editing ? t("common.saveChanges") : t("categorias.form.create") })}
      ${editing ? buttonHtml(form.isArchived
        ? { kind: "secondary", id: "cf-archive", label: t("categorias.form.unarchiveBtn") }
        : { kind: "danger-entry", id: "cf-archive", label: t("categorias.form.archiveBtn") }) : ""}
    </div>`;
  }

  /** Repinta el cuerpo de la hoja y devuelve el foco al control que lo tenía. */
  function renderForm() {
    if (!dlg) return;
    const key = focusKey(document.activeElement);
    dlg.querySelector(".sheet-body").innerHTML = formBodyHtml();
    wireForm();
    if (key) dlg.querySelector(key)?.focus();
  }

  function repaintStyle() {
    const lead = dlg?.querySelector(".ctl-field-lead");
    if (lead) lead.innerHTML = previewTileHtml();
    const style = dlg?.querySelector("#cf-style");
    if (style) { style.innerHTML = styleHtml(); wireStyle(); }
  }

  function wireStyle() {
    dlg.querySelectorAll("[data-fam]").forEach((b) => {
      b.onclick = () => {
        form.fam = b.dataset.fam;
        form.colorTouched = true; // deja de seguir al nombre
        if (!form.iconTouched) form.icon = form.fam;
        renderForm();
      };
    });
    dlg.querySelectorAll("[data-cf-icon]").forEach((b) => {
      b.onclick = () => {
        form.icon = b.dataset.cfIcon;
        form.iconTouched = true;
        renderForm();
      };
    });
  }

  function wireForm() {
    // El nombre NO repinta la hoja en cada tecla (perdería el cursor) ni en blur (un repintado ahí
    // desconecta el botón que se está pulsando y el primer tap se pierde): solo parchea la baldosa
    // y, mientras la familia siga al nombre, el bloque de familia e icono, que no contiene el input.
    const nameInput = dlg.querySelector("#cf-name");
    nameInput.oninput = (e) => {
      form.name = e.target.value;
      if (form.error) { form.error = ""; dlg.querySelector(".cat-error")?.remove(); }
      if (form.colorTouched || form.parentId || form.flow !== "expense") return;
      const nextFam = FAMILIES[hashIndex(slug(form.name))];
      if (nextFam === form.fam) return;
      form.fam = nextFam;
      if (!form.iconTouched) form.icon = nextFam;
      repaintStyle();
    };
    nameInput.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } };

    const place = dlg.querySelector("#cf-place");
    if (place) wireSegmented(place, (v) => {
      if (v === "root") {
        if (form.parentId) form.lastParentId = form.parentId;
        form.parentId = "";
      } else {
        const parents = availableParents();
        form.parentId = parents.some((r) => r.id === form.lastParentId) ? form.lastParentId : (parents[0]?.id ?? "");
      }
      // En alta, el título sigue a lo que se va a crear (desde el «+» de un bloque se abre como
      // «Nueva subcategoría», pero se puede cambiar a categoría y al revés).
      if (form.mode === "create") dlg.querySelector("#sheet-title").textContent = t(form.parentId ? "categorias.form.title.newChild" : "categorias.form.title.new");
      renderForm();
    });

    dlg.querySelectorAll("[data-cf-parent]").forEach((b) => {
      b.onclick = () => {
        form.parentId = b.dataset.cfParent;
        form.lastParentId = form.parentId;
        renderForm();
      };
    });

    const need = dlg.querySelector("#cf-need");
    if (need) wireSegmented(need, (v) => { form.needType = v; });

    wireStyle();
    dlg.querySelector("#cf-save").onclick = () => save();
    const archiveBtn = dlg.querySelector("#cf-archive");
    if (archiveBtn) archiveBtn.onclick = () => onArchiveClick();
  }

  /** Tras guardar o archivar: la lista de debajo ya con los datos nuevos, y la hoja se cierra por
   *  su entrada de historial (goBack → el pushBack de sheet.js), nunca con dlg.close() a mano. */
  function doneAndClose() {
    renderList();
    goBack();
  }

  function showFormError(msg) {
    form.error = msg;
    renderForm();
  }

  async function save() {
    if (!form || form.saving) return;
    if (!form.name.trim()) {
      showFormError(t("categorias.validation.name"));
      dlg?.querySelector("#cf-name")?.focus();
      return;
    }
    form.saving = true;
    const btn = dlg.querySelector("#cf-save");
    btn.disabled = true;
    const f = form;
    const isRootFinal = !f.parentId;
    try {
      let id;
      if (f.mode === "edit") {
        id = f.id;
        // Payload EXPLÍCITO campo a campo: flow NO va nunca (updateCategory lanza si la clave está).
        const fields = { name: f.name, parentId: f.parentId };
        if (f.flow === "expense") fields.needType = f.needType;
        await updateCategory(id, fields);
      } else {
        id = await createCategory({
          name: f.name,
          flow: f.flow,
          needType: f.flow === "expense" ? f.needType : "",
          parentId: f.parentId,
        });
      }
      // setCategoryStyle: SOLO raíces de gasto, y siempre familia e icono JUNTOS (reemplaza la
      // entrada entera). Una raíz que ya lo era solo se escribe si cambió respecto a lo resuelto al
      // abrir; una recién creada o recién ascendida persiste lo elegido/sugerido.
      if (isRootFinal && f.flow === "expense") {
        if (!f.wasRoot || f.fam !== f.initialFam || f.icon !== f.initialIcon) {
          await setCategoryStyle(id, { fam: f.fam, icon: f.icon });
        }
      } else if (!isRootFinal && f.mode === "edit" && f.wasRoot) {
        // Raíz que pasa a ser hija de otra: limpia su estilo propio, que quedaría huérfano.
        await setCategoryStyle(id, {});
      }
      await loadData();
      doneAndClose();
    } catch (e) {
      f.saving = false;
      if (form === f) showFormError(userMessage(e));
    }
  }

  async function onArchiveClick() {
    const f = form;
    const btn = dlg.querySelector("#cf-archive");
    if (f.isArchived) {
      // Desarchivar no es destructivo: sin aviso.
      btn.disabled = true;
      try {
        await unarchiveCategory(f.id);
        await loadData();
        doneAndClose();
      } catch (e) {
        if (form === f) showFormError(userMessage(e));
      }
      return;
    }
    const n = f.activeChildrenCount;
    showConfirm({
      title: t("categorias.archive.title"),
      message: n > 0
        ? t("categorias.archive.messageWithCount", { name: f.name, count: subcatCount(n) })
        : t("categorias.archive.message", { name: f.name }),
      cancelText: t("common.cancel"),
      confirmText: t("categorias.archive.archive"),
      destructive: true,
      onConfirm: async () => {
        try {
          await archiveCategory(f.id);
          await loadData();
          if (form === f) doneAndClose();
          else renderList();
        } catch (e) {
          if (form === f) showFormError(userMessage(e));
        }
      },
    });
  }

  renderList();
}
