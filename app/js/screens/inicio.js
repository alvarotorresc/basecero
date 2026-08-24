import { getOpenPeriod, spentOfPeriod, incomeOfPeriod, listByDay, allCategoriesById } from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtEUR, fmtDiaLargo, hoyISO } from "../format.js";

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

/** Pantalla Inicio: cabecera del periodo abierto (gastado, ingresos, ahorrado, tasa)
 *  y sus movimientos agrupados por día. */
export async function renderInicio(container) {
  let period, spent, income, rows, byId;
  try {
    period = await getOpenPeriod();
    if (!period) {
      container.innerHTML = `<div class="banner-aviso red">No hay ningún periodo abierto.</div>`;
      return;
    }
    [spent, income, rows, byId] = await Promise.all([
      spentOfPeriod(period.id),
      incomeOfPeriod(period.id),
      listByDay(period.id),
      allCategoriesById(),
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
      <div style="display:flex;flex-direction:column;gap:3px;">
        <div style="font-size:24px;font-weight:700;letter-spacing:-0.02em;">${escHtml(period.name)}</div>
        <div style="font-size:12px;color:var(--text-2);">Desde el ${fmtDiaLargo(period.start_date)}</div>
      </div>

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

    ${movimientosHtml}
  `;
}
