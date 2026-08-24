import {
  getOpenPeriod, spentOfPeriod, incomeOfPeriod, listByDay, allCategoriesById,
  pendingShared, pendingSharedTotalCents,
} from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtEUR, fmtDiaLargo, fmtDiaCorto, hoyISO } from "../format.js";
import { renderLiquidar } from "./liquidar.js";
import { renderPeriodoNuevo } from "./periodo-nuevo.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const pctFmt = new Intl.NumberFormat("es-ES", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Agrupa las filas de listByDay (ya vienen ordenadas por date DESC) en bloques por día,
 *  preservando el orden de llegada. */
function groupByDay(rows) {
  const groups = [];
  let current = null;
  for (const r of rows) {
    if (!current || current.date !== r.date) {
      current = { date: r.date, rows: [] };
      groups.push(current);
    }
    current.rows.push(r);
  }
  return groups;
}

function txRowHtml(r, byId) {
  const cat = byId[r.category_id];
  const catName = cat?.name ?? "";
  const color = colorForCategory(r.category_id, byId);
  const icon = iconForCategory(r.category_id, byId);
  const title = r.merchant || catName;
  const sub = catName + (r.is_shared ? ` · tu parte ${fmtEUR(r.my_amount_cents)}` : "");
  const isExpense = r.type === "expense";
  const amountClass = isExpense ? "negative" : "positive";
  const sign = isExpense ? "-" : "+";

  return `
    <div class="tx-row">
      <div class="tx-icon" style="--cat:${color};">${icon}</div>
      <div class="tx-body">
        <div class="tx-title">${escHtml(title)}</div>
        <div class="tx-sub">${escHtml(sub)}</div>
      </div>
      <div class="tx-amount num ${amountClass}">${sign}${fmtEUR(r.amount_cents)}</div>
    </div>`;
}

/** Bloque "Con Sara": pendiente de que devuelva, de TODOS los periodos (pendingShared/-Total
 *  cubren cualquier gasto compartido sin liquidar, no solo el del periodo abierto). Se oculta
 *  entero si no hay nada pendiente. */
function conSaraHtml(period, sharedRows, sharedTotal) {
  if (sharedRows.length === 0 && sharedTotal === 0) return "";
  const miPct = period.my_share_pct;
  const n = sharedRows.length;
  const masAntiguo = sharedRows[0]?.date;
  return `
    <div class="card" style="display:flex;flex-direction:column;gap:14px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="font-size:15px;font-weight:700;">Con Sara</div>
        <div style="font-size:11px;font-weight:600;color:var(--text-2);background:#1b1e21;border-radius:8px;padding:5px 9px;">
          Este periodo: ${miPct} / ${100 - miPct}
        </div>
      </div>
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;">
        <div style="display:flex;flex-direction:column;gap:5px;">
          <div style="font-size:11px;color:var(--text-3);">Pendiente de que te devuelva</div>
          <div class="num text-red" style="font-size:30px;font-weight:600;letter-spacing:-0.02em;">${fmtEUR(sharedTotal)}</div>
        </div>
        <button type="button" id="con-sara-liquidar" style="height:40px;padding:0 14px;border-radius:14px;
          background:#1b1e21;color:var(--text-2);border:0;font-size:13px;font-weight:600;cursor:pointer;
          -webkit-tap-highlight-color:transparent;">Liquidar</button>
      </div>
      ${n > 0 ? `<div style="font-size:11px;color:var(--text-3);">
        ${n} gasto${n === 1 ? "" : "s"} sin liquidar · el más antiguo del ${fmtDiaCorto(masAntiguo)}
      </div>` : ""}
    </div>`;
}

/** Pantalla Inicio: cabecera del periodo abierto (gastado, ingresos, ahorrado, tasa),
 *  bloque "Con Sara" (pendiente/liquidar) y sus movimientos agrupados por día. */
export async function renderInicio(container) {
  let period, spent, income, rows, byId, sharedRows, sharedTotal;
  try {
    period = await getOpenPeriod();
    if (!period) {
      container.innerHTML = `<div class="banner-aviso red">No hay ningún periodo abierto.</div>`;
      return;
    }
    [spent, income, rows, byId, sharedRows, sharedTotal] = await Promise.all([
      spentOfPeriod(period.id),
      incomeOfPeriod(period.id),
      listByDay(period.id),
      allCategoriesById(),
      pendingShared(),
      pendingSharedTotalCents(),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">No se pudo cargar Inicio: ${escHtml(e.message)}</div>`;
    return;
  }

  const ahorrado = income - spent;
  const tasa = income > 0 ? pctFmt.format(ahorrado / income) : "—";
  const hoy = hoyISO();

  const movimientosHtml = rows.length === 0
    ? `<div class="card" style="text-align:center;color:var(--text-3)">
        <p>Registra tu primer gasto con el botón ＋</p></div>`
    : `<div class="card" style="display:flex;flex-direction:column;gap:16px;">
        <div class="section-title">Movimientos</div>
        <div style="display:flex;flex-direction:column;gap:12px;">
          ${groupByDay(rows).map((g) => `
            <div class="day-header">${g.date === hoy ? "Hoy" : fmtDiaLargo(g.date)}</div>
            ${g.rows.map((r) => txRowHtml(r, byId)).join("")}
          `).join("")}
        </div>
      </div>`;

  container.innerHTML = `
    <div class="card" style="display:flex;flex-direction:column;gap:16px;margin-bottom:16px;">
      <button type="button" id="inicio-periodo-header" style="all:unset;cursor:pointer;display:flex;flex-direction:column;gap:3px;-webkit-tap-highlight-color:transparent;">
        <div style="font-size:24px;font-weight:700;letter-spacing:-0.02em;">${escHtml(period.name)}</div>
        <div style="font-size:12px;color:var(--text-2);">Desde el ${fmtDiaLargo(period.start_date)}</div>
      </button>

      <div style="display:flex;flex-direction:column;gap:6px;">
        <div class="section-title">Gastado</div>
        <div class="num" style="font-size:38px;font-weight:600;letter-spacing:-0.02em;">${fmtEUR(spent)}</div>
      </div>

      <hr class="divider">

      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;">
        <div style="display:flex;flex-direction:column;gap:5px;">
          <div style="font-size:11px;color:var(--text-3);">Ingresos</div>
          <div class="num text-green" style="font-size:15px;font-weight:600;">${fmtEUR(income)}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;">
          <div style="font-size:11px;color:var(--text-3);">Ahorrado</div>
          <div class="num ${ahorrado >= 0 ? "text-green" : "text-red"}" style="font-size:15px;font-weight:600;">${fmtEUR(ahorrado)}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;">
          <div style="font-size:11px;color:var(--text-3);">Tasa</div>
          <div class="num" style="font-size:15px;font-weight:600;">${tasa}</div>
        </div>
      </div>
    </div>

    ${conSaraHtml(period, sharedRows, sharedTotal)}

    ${movimientosHtml}
  `;

  const liquidarBtn = container.querySelector("#con-sara-liquidar");
  if (liquidarBtn) liquidarBtn.onclick = () => renderLiquidar(container, () => renderInicio(container));

  container.querySelector("#inicio-periodo-header").onclick = () => {
    document.body.classList.add("onboarding");
    renderPeriodoNuevo(container, {
      mode: "next",
      onDone: () => {
        document.body.classList.remove("onboarding");
        renderInicio(container);
      },
    });
  };
}
