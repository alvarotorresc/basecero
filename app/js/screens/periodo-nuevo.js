import {
  getOpenPeriod, spentOfPeriod, incomeOfPeriod, listAllByDay, spentByRootCategory, openNextPeriod,
} from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { eurToCents } from "../contract.js";
import { fmtMoney, fmtDiaCorto, hoyISO, prevDayIso, nombrePorDefecto } from "../format.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const pctFmt = new Intl.NumberFormat("es-ES", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const BTN_SECONDARY = "background:transparent;color:var(--text);border:1px solid var(--border);"
  + "border-radius:var(--radius-sm);padding:16px;flex:1;font:600 16px var(--font-ui);cursor:pointer;";

/** Pantalla de error con recuperación: quien llama ya puso `body.onboarding` (chrome oculto,
 *  nav() bloqueado — ver main.js), así que un simple banner sin salida deja a quien lo use
 *  atrapado. "Reintentar" vuelve a montar la pantalla entera; "Volver" (solo en modo 'next',
 *  donde SÍ hay algo a lo que volver sin haber creado nada) llama a onDone() como cancelación. */
function renderAsistenteError(container, mode, onDone, message) {
  container.innerHTML = `
    <div class="banner-aviso red" style="margin-bottom:14px;">${escHtml(message)}</div>
    <div style="display:flex; gap:8px;">
      <button type="button" class="btn-primary" id="pn-error-retry" style="flex:1;">Reintentar</button>
      ${mode === "next" ? `<button type="button" id="pn-error-back" style="${BTN_SECONDARY}">Volver</button>` : ""}
    </div>`;
  container.querySelector("#pn-error-retry").onclick = () => renderPeriodoNuevo(container, { mode, onDone });
  const back = container.querySelector("#pn-error-back");
  if (back) back.onclick = () => onDone();
}

/** Pantalla única (sin tab bar, flecha atrás) para abrir un periodo nuevo: en modo 'next'
 *  cierra el periodo abierto (bloque "Cierras X" con su resumen) y en modo 'first' solo crea
 *  el primero (onboarding, sin nada que cerrar). Presupuestos por categoría RAÍZ de gasto:
 *  spentByRootCategory('' ) en modo 'first' no matchea ningún period_id → devuelve todas las
 *  raíces con spent_cents=0 (mismo LEFT JOIN, sin fila cerrada de la que tirar "mes pasado").
 *  onDone() se llama tanto al abrir con éxito como al cancelar con la flecha atrás (modo 'next'). */
export async function renderPeriodoNuevo(container, { mode, onDone }) {
  let closingPeriod = null, closingSpent = 0, closingIncome = 0, closingCount = 0, rootRows = [];
  try {
    if (mode === "next") {
      closingPeriod = await getOpenPeriod();
      if (!closingPeriod) {
        renderAsistenteError(container, mode, onDone, "No hay ningún periodo abierto que cerrar.");
        return;
      }
      const [spent, income, all, roots] = await Promise.all([
        spentOfPeriod(closingPeriod.id),
        incomeOfPeriod(closingPeriod.id),
        listAllByDay(closingPeriod.id),
        spentByRootCategory(closingPeriod.id),
      ]);
      closingSpent = spent; closingIncome = income; closingCount = all.length; rootRows = roots;
    } else {
      rootRows = await spentByRootCategory("");
    }
  } catch (e) {
    renderAsistenteError(container, mode, onDone, "No se pudo cargar el asistente: " + e.message);
    return;
  }

  // byId "de mentira" solo con lo que colorForCategory/iconForCategory necesitan (rootOf sube
  // por parent_id hasta encontrar la raíz): como root_id YA es una raíz, basta con parent_id=''.
  const byId = Object.fromEntries(rootRows.map((r) => [r.root_id, { id: r.root_id, parent_id: "" }]));

  const state = {
    startDate: hoyISO(),
    name: nombrePorDefecto(),
    sharePct: mode === "next" ? closingPeriod.my_share_pct : 50,
    budgets: {}, // rootId -> string en euros tal cual lo escribe el usuario ("" = sin límite)
    visible: new Set(rootRows.filter((r) => r.spent_cents > 0).map((r) => r.root_id)),
    addOpen: false,
    saving: false,
  };
  let errorMsg = "";

  function totalPresupuestadoCents() {
    let sum = 0;
    for (const raw of Object.values(state.budgets)) {
      if (raw === "" || raw == null) continue;
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) sum += eurToCents(raw);
    }
    return sum;
  }

  function notaSinAsignarHtml(sinAsignar) {
    return sinAsignar >= 0
      ? `Quedan <span style="color:var(--green); font-weight:700;">${fmtMoney(sinAsignar)}</span> sin asignar: de ahí salen la cuota del coche, las provisiones y lo que ahorres.`
      : `Te pasas por <span style="color:var(--red); font-weight:700;">${fmtMoney(-sinAsignar)}</span> de los ingresos previstos.`;
  }

  /** Actualiza SOLO el total/barra/nota tras editar un importe, sin re-renderizar toda la
   *  pantalla: un render() completo en cada tecleo destruiría el input que tiene el foco (y
   *  cualquier otro que el usuario esté a punto de tocar), tragándose el toque siguiente. */
  function patchTotal() {
    const presupuestado = totalPresupuestadoCents();
    const presupEl = container.querySelector("#pn-presupuestado");
    if (presupEl) presupEl.textContent = fmtMoney(presupuestado);
    if (mode === "next") {
      const pctBarra = closingIncome > 0 ? Math.min(100, Math.round((presupuestado / closingIncome) * 100)) : 0;
      const sinAsignar = closingIncome - presupuestado;
      const barEl = container.querySelector("#pn-bar");
      if (barEl) barEl.style.width = pctBarra + "%";
      const notaEl = container.querySelector("#pn-nota");
      if (notaEl) notaEl.innerHTML = notaSinAsignarHtml(sinAsignar);
    }
  }

  function bloqueHeader() {
    return `
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
      ${mode === "next" ? `<button type="button" class="icon-btn" id="pn-back" aria-label="Volver">←</button>` : ""}
      <div style="display:flex; flex-direction:column; gap:2px;">
        <div style="font-size:17px; font-weight:700; letter-spacing:-0.01em;">Nuevo periodo</div>
        <div style="font-size:11px; color:var(--text-3);">Paso único · se guarda al abrirlo</div>
      </div>
    </div>`;
  }

  function bloqueCierre() {
    if (mode !== "next") return "";
    const ahorrado = closingIncome - closingSpent;
    const tasa = closingIncome > 0 ? pctFmt.format(ahorrado / closingIncome) : "—";
    const rangeEnd = prevDayIso(state.startDate || hoyISO());
    return `
    <div class="card" style="display:flex; flex-direction:column; gap:14px; margin-bottom:16px;">
      <div style="display:flex; flex-direction:column; gap:3px;">
        <div style="font-size:15px; font-weight:700;">Cierras ${escHtml(closingPeriod.name)}</div>
        <div style="font-size:11px; color:var(--text-3);">
          ${fmtDiaCorto(closingPeriod.start_date)} – ${fmtDiaCorto(rangeEnd)} · ${closingCount} movimiento${closingCount === 1 ? "" : "s"}
        </div>
      </div>
      <hr class="divider">
      <div style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px;">
        <div style="display:flex; flex-direction:column; gap:5px;">
          <div style="font-size:11px; color:var(--text-3);">Gastado</div>
          <div class="num" style="font-size:15px; font-weight:600;">${fmtMoney(closingSpent)}</div>
        </div>
        <div style="display:flex; flex-direction:column; gap:5px;">
          <div style="font-size:11px; color:var(--text-3);">Ahorrado</div>
          <div class="num ${ahorrado >= 0 ? "text-green" : "text-red"}" style="font-size:15px; font-weight:600;">${fmtMoney(ahorrado)}</div>
        </div>
        <div style="display:flex; flex-direction:column; gap:5px;">
          <div style="font-size:11px; color:var(--text-3);">Tasa de ahorro</div>
          <div class="num" style="font-size:15px; font-weight:600;">${tasa}</div>
        </div>
      </div>
    </div>`;
  }

  function bloqueCampos() {
    const restante = 100 - state.sharePct;
    return `
    <div class="card" style="padding:4px 16px; display:flex; flex-direction:column; margin-bottom:16px;">
      <label style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 0;">
        <span style="font-size:14px; font-weight:600;">Empieza el</span>
        <input type="date" id="pn-fecha" value="${state.startDate}"
          style="height:42px; padding:0 13px; background:#1b1e21; border:0; border-radius:14px; color:var(--text); font:600 14px var(--font-num);">
      </label>
      <hr class="divider">
      <label style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 0;">
        <span style="font-size:14px; font-weight:600;">Nombre</span>
        <input type="text" id="pn-nombre" value="${escAttr(state.name)}"
          style="height:42px; padding:0 13px; background:#1b1e21; border:0; border-radius:14px; color:var(--text);
          font:600 14px var(--font-ui); text-align:right; min-width:0;">
      </label>
      <hr class="divider">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 0;">
        <div style="display:flex; flex-direction:column; gap:3px;">
          <div style="font-size:14px; font-weight:600;">Pagas de lo compartido</div>
          <div style="font-size:11px; color:var(--text-3);">Sara pagará el ${restante} % restante</div>
        </div>
        <div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">
          <div class="num" style="font-size:15px; font-weight:600; min-width:44px; text-align:right;">${state.sharePct} %</div>
          <div style="display:flex; flex-direction:column;">
            <button type="button" id="pn-pct-up" class="stepper-btn" aria-label="Subir porcentaje">▲</button>
            <button type="button" id="pn-pct-down" class="stepper-btn" aria-label="Bajar porcentaje">▼</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  function budgetRowHtml(r, withDivider) {
    const color = colorForCategory(r.root_id, byId);
    const icon = iconForCategory(r.root_id, byId);
    const raw = state.budgets[r.root_id] ?? "";
    const empty = raw === "";
    return `
    ${withDivider ? '<hr class="divider">' : ""}
    <div style="display:flex; align-items:center; gap:12px; padding:13px 0;">
      <div class="tx-icon" style="--cat:${color};">${icon}</div>
      <div style="display:flex; flex-direction:column; gap:3px; flex-grow:1; min-width:0;">
        <div style="font-size:14px; font-weight:600;">${escHtml(r.name)}</div>
        ${mode === "next" ? `<div style="font-size:11px; color:var(--text-3);">Mes pasado: ${fmtMoney(r.spent_cents)}</div>` : ""}
      </div>
      <div style="position:relative; flex-shrink:0;">
        <input type="number" min="0" step="1" inputmode="decimal" placeholder="Sin límite"
          data-budget="${r.root_id}" value="${escAttr(raw)}" class="budget-input${empty ? " is-empty" : ""}">
        <span class="budget-eur" style="position:absolute; right:10px; top:50%; transform:translateY(-50%); font-size:12px;
          color:var(--text-3); pointer-events:none; display:${empty ? "none" : ""};">€</span>
      </div>
    </div>`;
  }

  function bloqueLimites() {
    const visibleRows = rootRows.filter((r) => state.visible.has(r.root_id));
    const hiddenRows = rootRows.filter((r) => !state.visible.has(r.root_id));
    if (rootRows.length === 0) {
      return `
      <div class="card" style="text-align:center; color:var(--text-3); margin-bottom:16px;">
        <p>No hay categorías de gasto configuradas.</p>
      </div>`;
    }
    return `
    <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:16px;">
      <div style="display:flex; flex-direction:column; gap:4px;">
        <div style="font-size:15px; font-weight:700;">¿Cuánto quieres gastar este periodo?</div>
        <div style="font-size:11px; color:var(--text-3); line-height:1.5;">
          Pon un límite solo donde te sirva. Si lo dejas vacío, esa categoría irá sin presupuesto.
        </div>
      </div>
      <div class="card" style="padding:4px 16px; display:flex; flex-direction:column;">
        ${visibleRows.map((r, i) => budgetRowHtml(r, i > 0)).join("")}
        ${hiddenRows.length ? `
        ${visibleRows.length ? '<hr class="divider">' : ""}
        <button type="button" id="pn-add-limite"
          style="display:flex; align-items:center; gap:12px; padding:14px 0; background:none; border:0; width:100%;
          text-align:left; cursor:pointer; -webkit-tap-highlight-color:transparent;">
          <div class="tx-icon" style="--cat:var(--accent);">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5.5v13M5.5 12h13"></path></svg>
          </div>
          <span style="font-size:14px; font-weight:600; color:var(--accent);">Añadir límite a otra categoría</span>
        </button>
        ${state.addOpen ? `
        <div style="display:flex; flex-direction:column; padding-bottom:10px;">
          ${hiddenRows.map((r) => `
          <button type="button" data-add-root="${r.root_id}"
            style="display:flex; align-items:center; gap:10px; padding:9px 0 9px 52px; background:none; border:0;
            width:100%; text-align:left; cursor:pointer; -webkit-tap-highlight-color:transparent;">
            <span style="font-size:16px; line-height:1;">${iconForCategory(r.root_id, byId)}</span>
            <span style="font-size:13px; color:var(--text-2);">${escHtml(r.name)}</span>
          </button>`).join("")}
        </div>` : ""}
        ` : ""}
      </div>
    </div>`;
  }

  function bloqueTotal() {
    const presupuestado = totalPresupuestadoCents();
    const ingresos = mode === "next" ? closingIncome : null;
    const pctBarra = ingresos > 0 ? Math.min(100, Math.round((presupuestado / ingresos) * 100)) : 0;
    const sinAsignar = ingresos != null ? ingresos - presupuestado : null;
    return `
    <div class="card" style="display:flex; flex-direction:column; gap:14px; margin-bottom:16px;">
      <div style="display:flex; align-items:flex-end; justify-content:space-between; gap:12px;">
        <div style="display:flex; flex-direction:column; gap:5px;">
          <div style="font-size:12px; font-weight:600; color:var(--text-2);">Presupuestado</div>
          <div class="num" id="pn-presupuestado" style="font-size:28px; font-weight:600; letter-spacing:-0.02em;">${fmtMoney(presupuestado)}</div>
        </div>
        ${ingresos != null ? `
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:5px;">
          <div style="font-size:11px; color:var(--text-3);">Ingresos previstos</div>
          <div class="num" style="font-size:15px; font-weight:600; color:var(--text-2);">${fmtMoney(ingresos)}</div>
        </div>` : ""}
      </div>
      ${ingresos != null ? `
      <div style="height:8px; background:#1e2225; border-radius:999px; overflow:hidden;">
        <div id="pn-bar" style="width:${pctBarra}%; height:8px; background:var(--accent); border-radius:999px;"></div>
      </div>
      <div id="pn-nota" style="font-size:11px; color:var(--text-3); line-height:1.5;">${notaSinAsignarHtml(sinAsignar)}</div>` : ""}
      ${errorMsg ? `<div class="banner-aviso red">${escHtml(errorMsg)}</div>` : ""}
      <button type="button" class="btn-primary" id="pn-submit" ${state.saving ? "disabled" : ""}>${state.saving ? "Abriendo…" : "Abrir periodo"}</button>
    </div>`;
  }

  function render() {
    container.innerHTML = `
      ${bloqueHeader()}
      ${bloqueCierre()}
      ${bloqueCampos()}
      ${bloqueLimites()}
      ${bloqueTotal()}
    `;
    wire();
  }

  function wire() {
    const back = container.querySelector("#pn-back");
    if (back) back.onclick = () => onDone();

    container.querySelector("#pn-fecha").onchange = (e) => {
      state.startDate = e.target.value || hoyISO();
      render();
    };
    container.querySelector("#pn-nombre").oninput = (e) => { state.name = e.target.value; };

    container.querySelector("#pn-pct-up").onclick = () => { state.sharePct = Math.min(100, state.sharePct + 5); render(); };
    container.querySelector("#pn-pct-down").onclick = () => { state.sharePct = Math.max(0, state.sharePct - 5); render(); };

    container.querySelectorAll("[data-budget]").forEach((el) => {
      // oninput (no render()) para no perder el foco a media escritura ni "tragarse" el
      // siguiente toque si el usuario salta a otra fila (ver patchTotal más arriba).
      el.oninput = (e) => {
        const raw = e.target.value;
        state.budgets[el.dataset.budget] = raw;
        const empty = raw === "";
        el.classList.toggle("is-empty", empty);
        const suffix = el.parentElement.querySelector(".budget-eur");
        if (suffix) suffix.style.display = empty ? "none" : "";
        patchTotal();
      };
    });

    const addBtn = container.querySelector("#pn-add-limite");
    if (addBtn) addBtn.onclick = () => { state.addOpen = !state.addOpen; render(); };

    container.querySelectorAll("[data-add-root]").forEach((b) => {
      b.onclick = () => {
        state.visible.add(b.dataset.addRoot);
        state.addOpen = false;
        render();
      };
    });

    container.querySelector("#pn-submit").onclick = async () => {
      if (state.saving) return;
      state.saving = true;
      errorMsg = "";
      render();
      try {
        const budgets = [];
        for (const [categoryId, raw] of Object.entries(state.budgets)) {
          if (raw === "" || raw == null) continue;
          const n = Number(raw);
          if (!Number.isFinite(n) || n <= 0) continue;
          budgets.push({ categoryId, amountCents: eurToCents(raw) });
        }
        await openNextPeriod({
          name: state.name.trim() || nombrePorDefecto(),
          startDate: state.startDate || hoyISO(),
          sharePct: Math.min(100, Math.max(0, state.sharePct)),
          budgets,
        });
        onDone();
      } catch (e) {
        state.saving = false;
        errorMsg = "No se pudo abrir el periodo: " + e.message;
        render();
      }
    };
  }

  render();
}
