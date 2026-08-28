import { listCategoriesAdmin, allCategoriesById } from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

// need_type ('need'|'want'|'savings'|'') → etiqueta de lista, por presencia del valor y NO por
// flow: una raíz de ingreso con need_type (caso raro pero el schema lo permite) también lleva
// etiqueta; las de ingreso sembradas ('' need_type) simplemente no calzan ninguna clave y caen al
// "solo el conteo" que pide el brief.
const NEED_LABELS = { need: "necesario", want: "prescindible", savings: "ahorro" };

const subcatCount = (n) => `${n} subcategoría${n === 1 ? "" : "s"}`;

/** Sub de una raíz: "{necesario/prescindible/ahorro} · N subcategorías", o solo "N subcategorías"
 *  si la raíz no tiene need_type (las 3 raíces de ingreso sembradas). `childCount` cuenta TODAS
 *  las hijas del árbol construido en cliente (activas + archivadas) — a propósito NO es el campo
 *  `children` de listCategoriesAdmin (ese cuenta solo hijas ACTIVAS, para el guard de "máx 2
 *  niveles" de updateCategory): el artboard muestra "Casa · necesario · 6 subcategorías" con Gas
 *  archivada incluida en el 6, así que el conteo visible aquí debe incluir archivadas. */
function rootSubtitle(root, childCount) {
  const label = NEED_LABELS[root.need_type];
  return label ? `${label} · ${subcatCount(childCount)}` : subcatCount(childCount);
}

/** Pantalla "Categorías" (PR D, Task 5): lista de administración — raíces del flow activo,
 *  expandibles a sus hijas, sin editar nada todavía (el formulario de alta/edición es la Task 6:
 *  openForm de más abajo es un stub no-op, pero los ids/wiring de cada tap ya están listos para
 *  que esa tarea solo tenga que rellenar el cuerpo). onBack vuelve a quien la haya abierto
 *  (Ajustes, mismo patrón que renderRecurrentes). */
export async function renderCategorias(container, onBack) {
  let rows, byId;
  try {
    [rows, byId] = await Promise.all([listCategoriesAdmin(), allCategoriesById()]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">No se pudieron cargar las categorías: ${escHtml(e.message)}</div>`;
    return;
  }

  // Árbol en cliente por parent_id — NUNCA por adyacencia de filas: listCategoriesAdmin ordena
  // (flow, parent_id, display_order), así que TODAS las raíces salen primero y LUEGO todas las
  // hijas agrupadas por parent (ver handoff de la Task 4/ledger). El orden dentro de cada grupo
  // (raíces entre sí, hijas de una misma raíz entre sí) SÍ es el correcto de display_order —
  // basta con agrupar preservando el orden de iteración, sin reordenar nada aquí.
  const roots = [];
  const childrenByParent = new Map();
  for (const c of rows) {
    if (c.parent_id === "") roots.push(c);
    else {
      if (!childrenByParent.has(c.parent_id)) childrenByParent.set(c.parent_id, []);
      childrenByParent.get(c.parent_id).push(c);
    }
  }

  const state = { flow: "expense", expanded: new Set() };

  // Task 6: abre el formulario de alta/edición de categoría. opts:
  //  - { mode: "create", flow }              → "+ Nueva" del header
  //  - { mode: "create", flow, parentId }     → "+ Añadir subcategoría" de un grupo expandido
  //  - { mode: "edit", flow, category }       → tap en una fila (raíz o hija)
  // Los 4 call sites de abajo ya pasan estos datos: esta tarea solo deja el stub sin cuerpo.
  function openForm(_opts) {
    // no-op — Task 6 implementa el formulario.
  }

  const rootsOfFlow = (flow) => roots.filter((r) => r.flow === flow);
  const activeRootCount = (flow) => roots.filter((r) => r.flow === flow && !r.is_archived).length;

  // Color del dotico: si la categoría está archivada pierde su color propio (gris neutro
  // --card2, como el "Gas" archivado del artboard) — el icono (emoji) se mantiene igual.
  const dotColor = (cat) => (cat.is_archived ? "var(--card2)" : colorForCategory(cat.id, byId));

  function childRowHtml(child) {
    const color = dotColor(child);
    const icon = iconForCategory(child.id, byId);
    return `
    <button type="button" class="cat-row" data-cat="${child.id}"
      style="width:100%;display:flex;align-items:center;gap:12px;padding:9px 0;padding-left:44px;background:none;
      border:0;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;${child.is_archived ? "opacity:0.5;" : ""}">
      <div class="dotico" style="width:28px;height:28px;font-size:13px;--cat:${color};">${icon}</div>
      <div class="tx-body" style="flex:1;min-width:0;">
        <div class="tx-title">${escHtml(child.name)}</div>
      </div>
      ${child.is_archived ? `<span class="day-label" style="flex-shrink:0;">Archivada</span>` : ""}
    </button>`;
  }

  // Grupo de hijas de una raíz expandida: ÚNICO contenedor .card de toda la pantalla (el resto de
  // la lista va a fondo plano, como el artboard) — ese contraste de fondo es la señal visual de
  // "esto está anidado bajo la raíz de arriba". Envolver también las raíces en un .card la
  // borraría (el grupo dejaría de distinguirse de su entorno).
  function groupHtml(root) {
    const kids = childrenByParent.get(root.id) ?? [];
    return `
    <div class="card" style="border-radius:var(--radius-sm);padding:2px 12px 10px;margin-bottom:6px;">
      ${kids.map(childRowHtml).join("")}
      <button type="button" data-add-sub="${root.id}"
        style="height:36px;padding:0 14px;margin:6px 0 0 44px;border-radius:999px;background:var(--card2);
        color:var(--text);border:0;font-size:12px;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;">
        + Añadir subcategoría
      </button>
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
    <div style="display:flex;align-items:center;${root.is_archived ? "opacity:0.5;" : ""}
      ${suppressBorder ? "" : "border-bottom:1px solid var(--rule);"}">
      <button type="button" class="cat-row" data-cat="${root.id}"
        style="flex:1;min-width:0;display:flex;align-items:center;gap:12px;padding:13px 0;background:none;border:0;
        text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;">
        <div class="dotico" style="--cat:${color};">${icon}</div>
        <div class="tx-body" style="min-width:0;">
          <div class="tx-title">${escHtml(root.name)}</div>
          <div class="tx-sub">${sub}</div>
        </div>
      </button>
      ${root.is_archived ? `<span class="day-label" style="flex-shrink:0;">Archivada</span>` : ""}
      <button type="button" data-chevron="${root.id}"
        aria-label="${expanded ? "Colapsar subcategorías" : "Expandir subcategorías"}"
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

  function render() {
    const flowRoots = rootsOfFlow(state.flow);
    const expenseCount = activeRootCount("expense");
    const incomeCount = activeRootCount("income");
    const flowLabel = state.flow === "expense" ? "gasto" : "ingreso";

    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
        <button type="button" class="icon-btn" id="cat-back" aria-label="Volver"
          style="width:44px;height:44px;border-radius:50%;background:var(--card);color:var(--text);font-size:18px;">←</button>
        <h1 style="flex:1;font-size:20px;font-weight:700;letter-spacing:-0.015em;">Categorías</h1>
        <button type="button" id="cat-new"
          style="height:44px;padding:0 18px;border-radius:999px;background:var(--text);color:var(--bg);border:0;
          font-size:13px;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent;">+ Nueva</button>
      </div>

      <div class="segmented" style="margin-bottom:10px;border-radius:999px;">
        ${[["expense", `Gastos · ${expenseCount}`], ["income", `Ingresos · ${incomeCount}`]].map(([id, label]) => {
          const active = state.flow === id;
          const segStyle = active
            ? "border-radius:999px;background:var(--card2);color:var(--text);font-weight:700;"
            : "border-radius:999px;";
          return `<button type="button" data-flow="${id}" class="${active ? "active" : ""}" style="${segStyle}">${label}</button>`;
        }).join("")}
      </div>

      <div style="font-size:11.5px;color:var(--text-3);margin-bottom:8px;">
        Toca una categoría para editarla; el chevron abre sus subcategorías.
      </div>

      <div style="display:flex;flex-direction:column;">
        ${flowRoots.length === 0
          ? `<div class="card" style="text-align:center;color:var(--text-3);"><p>Todavía no hay categorías de ${flowLabel}.</p></div>`
          : flowRoots.map((r, i) => rootRowHtml(r, i === flowRoots.length - 1)).join("")}
      </div>

      <div class="card" style="border-radius:var(--radius-sm);padding:12px 16px;margin-top:16px;display:flex;align-items:center;gap:10px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.7"
          stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
          <circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16.5v.01"></path>
        </svg>
        <div style="font-size:11.5px;color:var(--text-3);">
          Archivar oculta la categoría de los selectores sin tocar tu historial: los periodos cerrados siguen sumando
          igual. Nada se borra si algo lo usa.
        </div>
      </div>
    `;
    wire();
  }

  function wire() {
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
  }

  render();
}
