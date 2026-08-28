import {
  getOpenPeriod, spentOfPeriod, incomeOfPeriod, listAllByDay, spentByRootCategory, openNextPeriod, getMetaAll,
} from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { eurToCents } from "../contract.js";
import { fmtMoney, fmtMoneyParts, fmtDiaCorto, hoyISO, prevDayIso, nombrePorDefecto, fmtPct, currencySymbol } from "../format.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const BTN_SECONDARY = "background:var(--card2);color:var(--text);border:0;"
  + "border-radius:999px;padding:16px;flex:1;font:600 16px var(--font-ui);cursor:pointer;";

// Compone un importe con los céntimos reducidos en <small> (patrón .amount-hero del design
// system, ver DesignSystem.dc.html / inicio.js#moneyPartsHtml): main + <small>céntimos</small> +
// sufijo, sin reimplementar el locale — fmtMoneyParts (format.js) ya hace el split posicional.
const moneyPartsHtml = (cents) => {
  const { main, cents: c, suffix } = fmtMoneyParts(cents);
  return `${escHtml(main)}<small>${escHtml(c)}</small>${escHtml(suffix)}`;
};

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
  let closingPeriod = null, closingSpent = 0, closingIncome = 0, closingCount = 0, rootRows = [], meta = {};
  try {
    if (mode === "next") {
      closingPeriod = await getOpenPeriod();
      if (!closingPeriod) {
        renderAsistenteError(container, mode, onDone, "No hay ningún periodo abierto que cerrar.");
        return;
      }
      const [spent, income, all, roots, metaAll] = await Promise.all([
        spentOfPeriod(closingPeriod.id),
        incomeOfPeriod(closingPeriod.id),
        listAllByDay(closingPeriod.id),
        spentByRootCategory(closingPeriod.id),
        getMetaAll(),
      ]);
      closingSpent = spent; closingIncome = income; closingCount = all.length; rootRows = roots; meta = metaAll;
    } else {
      [rootRows, meta] = await Promise.all([spentByRootCategory(""), getMetaAll()]);
    }
  } catch (e) {
    renderAsistenteError(container, mode, onDone, "No se pudo cargar el asistente: " + e.message);
    return;
  }
  const partnerName = (meta.partner_name || "").trim();

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
    // innerHTML (no textContent): #pn-presupuestado ahora lleva moneyPartsHtml (main + <small>
    // céntimos</small> + sufijo) — un textContent aquí borraría el <small> en el primer tecleo.
    if (presupEl) presupEl.innerHTML = moneyPartsHtml(presupuestado);
    if (mode === "next") {
      const pctBarra = closingIncome > 0 ? Math.min(100, Math.round((presupuestado / closingIncome) * 100)) : 0;
      const sinAsignar = closingIncome - presupuestado;
      const barEl = container.querySelector("#pn-bar");
      if (barEl) barEl.style.width = pctBarra + "%";
      const notaEl = container.querySelector("#pn-nota");
      if (notaEl) notaEl.innerHTML = notaSinAsignarHtml(sinAsignar);
    }
  }

  // Kicker versalitas verde (.day-label, misma fórmula que .section-title, --green del sistema):
  // en modo 'next' compone "Cierra {periodo real} · abre el siguiente" con el nombre YA cargado
  // (closingPeriod.name, el mismo dato que bloqueCierre usa debajo); en 'first' no hay periodo que
  // cerrar, así que no hay dato del que derivar la frase del artboard — "Primer periodo" es la
  // única etiqueta que no inventa nada. El sub "Paso único..." (copy real, ya existía en ambos
  // modos) se conserva tal cual en vez del texto nuevo del artboard para esa línea.
  function bloqueHeader() {
    const kicker = mode === "next" ? `Cierra ${escHtml(closingPeriod.name)} · abre el siguiente` : "Primer periodo";
    return `
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
      ${mode === "next" ? `<button type="button" class="icon-btn" id="pn-back" aria-label="Volver"
        style="width:44px;height:44px;border-radius:50%;background:var(--card);color:var(--text);font-size:18px;">←</button>` : ""}
      <div style="display:flex; flex-direction:column; gap:4px;">
        <div class="day-label" style="color:var(--green);">${kicker}</div>
        <div style="font-size:24px; font-weight:800; letter-spacing:-0.02em;">Nuevo periodo</div>
        <div style="font-size:11px; color:var(--text-3);">Paso único · se guarda al abrirlo</div>
      </div>
    </div>`;
  }

  function bloqueCierre() {
    if (mode !== "next") return "";
    const ahorrado = closingIncome - closingSpent;
    const tasa = closingIncome > 0 ? fmtPct(ahorrado / closingIncome) : "—";
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

  // Tres cards independientes (una por bloque: nombre, fecha, reparto), réplica de la estructura
  // de PeriodoNuevo.dc.html — antes era un único .card con <hr> entre secciones; el artboard las
  // separa. Nombre/fecha siguen siendo <input> reales (el input manda, no se convierten a texto),
  // solo re-vestidos como tile --card2 (antes hex #1b1e21 suelto).
  function bloqueNombre() {
    return `
    <div class="card" style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
      <div class="section-title">Nombre</div>
      <input type="text" id="pn-nombre" value="${escAttr(state.name)}"
        style="height:44px; padding:0 14px; background:var(--card2); border:0; border-radius:16px; color:var(--text);
        font:700 15px var(--font-ui); width:100%; outline:none;">
    </div>`;
  }

  // Tile calendario decorativo (sin onclick): el input type=date ya trae su propio selector nativo
  // en toda su superficie — añadirle un handler al tile duplicaría esa interacción sin aportar
  // nada nuevo, y sería la única pieza de "lógica" de esta tarjeta que no viene ya del navegador.
  function bloqueFecha() {
    return `
    <div class="card" style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
      <div class="section-title">Empieza el</div>
      <div style="display:flex; align-items:center; gap:10px;">
        <input type="date" id="pn-fecha" value="${state.startDate}"
          style="flex:1; height:44px; padding:0 14px; background:var(--card2); border:0; border-radius:14px;
          color:var(--text); font:600 14px var(--font-num); min-width:0;">
        <div style="width:44px; height:44px; border-radius:14px; background:var(--card2); flex-shrink:0;
          display:flex; align-items:center; justify-content:center;" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="stroke:var(--text);" stroke-width="1.6"
            stroke-linecap="round" stroke-linejoin="round">
            <rect x="3.5" y="5" width="17" height="16" rx="2.5"></rect><path d="M3.5 9.5h17M8 3v4M16 3v4"></path>
          </svg>
        </div>
      </div>
    </div>`;
  }

  // Steppers 44px/radius14 (antes ▲/▼ apiladas de 20×19 — .stepper-btn base se pisa por instancia,
  // mismo criterio que .ring 52px en patrimonio.js o el botón "+Nueva" 44px de recurrentes.js) +
  // el texto del % existente, sin cambios de dato/copy.
  function bloqueReparto() {
    if (!partnerName) return "";
    const restante = 100 - state.sharePct;
    return `
    <div class="card" style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
      <div class="section-title">Gastos compartidos</div>
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="flex:1; min-width:0;">
          <div style="font-size:14px; font-weight:600;">Pagas de lo compartido</div>
          <div style="font-size:11px; color:var(--text-3);">${escHtml(partnerName)} pagará el ${restante} % restante</div>
        </div>
        <button type="button" id="pn-pct-down" class="stepper-btn"
          style="width:44px; height:44px; border-radius:14px; background:var(--card2); color:var(--text); font-size:17px;"
          aria-label="Bajar porcentaje">−</button>
        <div class="num" style="font-size:20px; font-weight:700; width:56px; text-align:center; flex-shrink:0;">${state.sharePct} %</div>
        <button type="button" id="pn-pct-up" class="stepper-btn"
          style="width:44px; height:44px; border-radius:14px; background:var(--card2); color:var(--text); font-size:17px;"
          aria-label="Subir porcentaje">+</button>
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
          color:var(--text-3); pointer-events:none; display:${empty ? "none" : ""};">${currencySymbol()}</span>
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
          <div class="tx-icon" style="--cat:var(--text);">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5.5v13M5.5 12h13"></path></svg>
          </div>
          <span style="font-size:14px; font-weight:600; color:var(--text);">Añadir límite a otra categoría</span>
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

  // "Presupuestado" con céntimos small (fmtMoneyParts/moneyPartsHtml, patrón inicio.js/
  // patrimonio.js/presupuesto.js): es un importe COMPUESTO/derivado (suma de los budget-input,
  // no un campo editable en sí), así que sí se convierte al patrón .amount-hero — a diferencia de
  // los budget-input de bloqueLimites, que siguen siendo inputs reales sin tocar. Barra: mismo
  // patrón que presupuesto.js (tarea 7) — clase .bar con --cat:var(--text) en vez del
  // var(--accent) suelto de antes. CTA + error se sacan a bloqueCTA() (bloque final separado,
  // como en el artboard) — el id #pn-presupuestado/#pn-bar/#pn-nota los sigue actualizando
  // patchTotal() sin re-render completo (ver su comentario más abajo).
  function bloqueTotal() {
    const presupuestado = totalPresupuestadoCents();
    const ingresos = mode === "next" ? closingIncome : null;
    const pctBarra = ingresos > 0 ? Math.min(100, Math.round((presupuestado / ingresos) * 100)) : 0;
    const sinAsignar = ingresos != null ? ingresos - presupuestado : null;
    return `
    <div class="card" style="display:flex; flex-direction:column; gap:14px; margin-bottom:16px;">
      <div style="display:flex; align-items:flex-end; justify-content:space-between; gap:12px;">
        <div style="display:flex; flex-direction:column; gap:5px;">
          <div class="section-title">Presupuestado</div>
          <div class="amount-hero num" id="pn-presupuestado">${moneyPartsHtml(presupuestado)}</div>
        </div>
        ${ingresos != null ? `
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:5px;">
          <div style="font-size:11px; color:var(--text-3);">Ingresos previstos</div>
          <div class="num" style="font-size:15px; font-weight:600; color:var(--text-2);">${fmtMoney(ingresos)}</div>
        </div>` : ""}
      </div>
      ${ingresos != null ? `
      <div class="bar" style="--cat:var(--text);"><i id="pn-bar" style="width:${pctBarra}%;"></i></div>
      <div id="pn-nota" style="font-size:11px; color:var(--text-3); line-height:1.5;">${notaSinAsignarHtml(sinAsignar)}</div>` : ""}
    </div>`;
  }

  // CTA final, fuera de la card del total (como en el artboard): mismo id/label EXISTENTE
  // ("Abrir periodo"/"Abriendo…" — no el "Abrir Septiembre 2026" fijo del artboard, que fabricaría
  // un texto con el nombre siempre en mayúscula fija en vez del state.name real).
  function bloqueCTA() {
    return `
    ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}
    <button type="button" class="btn-primary" id="pn-submit" ${state.saving ? "disabled" : ""}>${state.saving ? "Abriendo…" : "Abrir periodo"}</button>`;
  }

  function render() {
    container.innerHTML = `
      ${bloqueHeader()}
      ${bloqueCierre()}
      ${bloqueNombre()}
      ${bloqueFecha()}
      ${bloqueReparto()}
      ${bloqueLimites()}
      ${bloqueTotal()}
      ${bloqueCTA()}
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

    const pctUp = container.querySelector("#pn-pct-up");
    if (pctUp) pctUp.onclick = () => { state.sharePct = Math.min(100, state.sharePct + 5); render(); };
    const pctDown = container.querySelector("#pn-pct-down");
    if (pctDown) pctDown.onclick = () => { state.sharePct = Math.max(0, state.sharePct - 5); render(); };

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
          sharePct: partnerName ? Math.min(100, Math.max(0, state.sharePct)) : 100,
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
