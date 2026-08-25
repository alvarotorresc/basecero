import { balancesAt, netWorthOfBalances, netWorthSeries, goalsWithProgress } from "../repo.js";
import { fmtEUR, hoyISO } from "../format.js";
import { sparklineSvg } from "../charts.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const fmtPct1 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// ---- tarjeta "Patrimonio neto" --------------------------------------------

const ICON_ARROW = (up) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="${up ? "#4ade80" : "#f87171"}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    ${up ? '<path d="M12 19V5M12 5l-6 6M12 5l6 6"></path>' : '<path d="M12 5v14M12 19l-6-6M12 19l6-6"></path>'}
  </svg>`;

/** Sparkline + fila de etiquetas de mes debajo — sparklineSvg (Task 12) NO pinta las etiquetas
 *  (ver su comentario en charts.js), así que esta pantalla arma la fila propia, con el mes actual
 *  en negrita (réplica de design/Patrimonio.dc.html:50-58). Se oculta con <2 puntos: con 0
 *  periodos cerrados netWorthSeries solo trae el punto de hoy, y una línea de un único punto no
 *  cuenta ninguna evolución. */
function netWorthSparkHtml(series) {
  if (series.length < 2) return "";
  const svg = sparklineSvg(series.map((p) => p.cents), series.map((p) => p.label));
  const labelsHtml = series.map((p, i) => `
    <div style="font-size:10px;text-align:center;${i === series.length - 1 ? "font-weight:700;color:var(--text);" : "color:var(--text-3);"}">${escHtml(p.label)}</div>`).join("");
  return `
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${svg}
      <div style="display:grid;grid-template-columns:repeat(${series.length},minmax(0,1fr));gap:4px;">${labelsHtml}</div>
    </div>`;
}

/** Tarjeta "Patrimonio neto": importe (38px) + badge de variación ABSOLUTA vs el último periodo
 *  CERRADO + sparkline — réplica de design/Patrimonio.dc.html:32-59. La variación es el propio
 *  penúltimo vs último punto de `series` (el último es siempre "hoy"; el penúltimo, si existe, es
 *  el del último cerrado — mismos puntos que ya trae netWorthSeries, sin repetir la query). Sin
 *  ningún cerrado (series.length<2) no hay nada con qué comparar: se oculta el badge entero. */
function netWorthCardHtml(netWorthCents, series) {
  const n = series.length;
  const variation = n >= 2 ? series[n - 1].cents - series[n - 2].cents : null;
  const up = variation === null || variation >= 0;
  const badgeHtml = variation === null ? "" : `
    <div style="display:flex;align-items:center;gap:5px;background:${up ? "#14261d" : "#2a1c1c"};border-radius:10px;padding:6px 9px;flex-shrink:0;">
      ${ICON_ARROW(up)}
      <div style="font-size:11px;font-weight:700;color:${up ? "var(--green)" : "var(--red)"};">${fmtEUR(Math.abs(variation))}</div>
    </div>`;

  return `
    <div class="card" style="display:flex;flex-direction:column;gap:16px;margin-bottom:16px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div style="display:flex;flex-direction:column;gap:6px;">
          <div style="font-size:12px;font-weight:600;color:var(--text-2);">Patrimonio neto</div>
          <div class="num" style="font-size:38px;font-weight:600;line-height:1;letter-spacing:-0.02em;">${fmtEUR(netWorthCents)}</div>
        </div>
        ${badgeHtml}
      </div>
      ${netWorthSparkHtml(series)}
    </div>`;
}

// ---- tarjeta "Cuentas" -----------------------------------------------------

// Trazos de los iconos SVG de design/Patrimonio.dc.html:71-118 (uno por tipo de cuenta, no por
// cuenta concreta: aquí solo hay 3 tipos). El color entra como --cat en .list-row-icon (mismo
// mecanismo de tinte que .tx-icon con las categorías, ver app.css).
const ACCOUNT_ICON = {
  checking: { color: "#7aa2ff", paths: '<rect x="3" y="5.5" width="18" height="13" rx="3.5"></rect><path d="M3 10.5h18"></path>' },
  savings: { color: "#b08be8", paths: '<path d="M5 8.5h14a1.6 1.6 0 011.6 1.6v7.3A1.6 1.6 0 0119 19H5a1.6 1.6 0 01-1.6-1.6V6.6A1.6 1.6 0 015 5h10"></path><circle cx="16.5" cy="13.8" r="1.2"></circle>' },
  liability: { color: "#f87171", paths: '<path d="M4.2 16.2h15.6v-3.8l-1.7-4.1a1.6 1.6 0 00-1.5-1H7.4a1.6 1.6 0 00-1.5 1l-1.7 4.1z"></path><path d="M6 16.2v2.4h2.6v-2.4M15.4 16.2v2.4H18v-2.4"></path>' },
};

/** Subtítulo por tipo — "Cuenta corriente · por defecto" es el único texto literal que pide el
 *  brief (para N26); el resto ("Ahorro"/"Pasivo") queda deliberadamente genérico: no hay en el
 *  contrato ningún campo del que derivar "2 huchas con objetivo" o "cuota 189 €/mes" del mockup
 *  sin inventar datos, así que no se replican aquí. */
function accountSubtitle(type, isDefault) {
  if (type === "checking") return `Cuenta corriente${isDefault ? " · por defecto" : ""}`;
  if (type === "savings") return "Ahorro";
  return "Pasivo";
}

function cuentaRowHtml(a, isDefault) {
  const icon = ACCOUNT_ICON[a.type] ?? ACCOUNT_ICON.checking;
  const isLiability = a.type === "liability";
  return `
    <div class="list-row">
      <div class="list-row-icon" style="--cat:${icon.color};">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${icon.color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icon.paths}</svg>
      </div>
      <div class="list-row-body">
        <div class="list-row-title">${escHtml(a.name)}</div>
        <div class="list-row-sub">${accountSubtitle(a.type, isDefault)}</div>
      </div>
      <div class="num" style="font-size:15px;font-weight:600;${isLiability ? "color:var(--red);" : ""}">${fmtEUR(a.balance_cents)}</div>
    </div>`;
}

/** Tarjeta "Cuentas": una fila por cuenta activa (balancesAt ya excluye archivadas/borradas),
 *  separadas por <hr class="divider"> — réplica de design/Patrimonio.dc.html:61-121. "Nueva
 *  cuenta" y el tap en una fila son de la Task 14: de momento la lista es de solo lectura. */
function cuentasCardHtml(accounts) {
  const n = accounts.length;
  const header = `
    <div style="display:flex;align-items:baseline;justify-content:space-between;">
      <div style="font-size:15px;font-weight:700;">Cuentas</div>
      <div style="font-size:11px;color:var(--text-3);">${n} activa${n === 1 ? "" : "s"} · solo EUR</div>
    </div>`;

  if (n === 0) {
    return `
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
        ${header}
        <div class="card" style="text-align:center;color:var(--text-3);">Todavía no tienes ninguna cuenta.</div>
      </div>`;
  }

  const firstCheckingId = accounts.find((a) => a.type === "checking")?.id;
  const rowsHtml = accounts.map((a) => cuentaRowHtml(a, a.id === firstCheckingId)).join('<hr class="divider">');

  return `
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
      ${header}
      <div class="card" style="padding:6px 16px;display:flex;flex-direction:column;">
        ${rowsHtml}
      </div>
    </div>`;
}

// ---- tarjeta "Objetivos" ---------------------------------------------------

const LEVEL_COLOR = { ok: "var(--green)", warn: "var(--amber)", over: "var(--red)" };

/** savings_rate guarda puntos porcentuales en currentCents/targetCents (ver repo.goalProgress):
 *  se muestran como "%", el resto de tipos como € (fmtEUR). */
function fmtGoalAmount(goal, cents) {
  return goal.type === "savings_rate" ? `${fmtPct1.format(cents)} %` : fmtEUR(cents);
}

/** Fila de un goal: título + "actual / objetivo", barra de 8px, subtítulo contextual a la
 *  izquierda + % en negrita a la derecha — réplica de design/Patrimonio.dc.html:130-186. El color
 *  (verde/ámbar/rojo) sigue el `level` de repo.goalProgress: solo se colorea texto (número grande,
 *  subtítulo, %) cuando level≠'ok' — en 'ok' se queda en los tonos neutros del resto de la
 *  pantalla, la barra es la única que lleva siempre su color de estado. */
function goalRowHtml(g) {
  const { goal, currentCents, targetCents, pct, level, subtitle } = g;
  const barColor = LEVEL_COLOR[level];
  const stateColor = level === "ok" ? null : LEVEL_COLOR[level];
  const barPct = Math.min(100, Math.max(0, pct));

  return `
    <div style="display:flex;flex-direction:column;gap:9px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
        <div style="font-size:14px;font-weight:600;">${escHtml(goal.name)}</div>
        <div class="num" style="font-size:13px;font-weight:600;color:${stateColor ?? "var(--text)"};white-space:nowrap;">
          ${fmtGoalAmount(goal, currentCents)} <span style="color:var(--text-3);">/ ${fmtGoalAmount(goal, targetCents)}</span>
        </div>
      </div>
      <div style="height:8px;background:#1e2225;border-radius:999px;overflow:hidden;">
        <div style="width:${barPct}%;height:8px;background:${barColor};border-radius:999px;"></div>
      </div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
        <div style="font-size:11px;color:${stateColor ?? "var(--text-3)"};">${escHtml(subtitle)}</div>
        <div style="font-size:11px;font-weight:700;color:${stateColor ?? "var(--text-2)"};">${Math.round(pct)} %</div>
      </div>
    </div>`;
}

/** Tarjeta "Objetivos": una fila por goal activo — réplica de design/Patrimonio.dc.html:123-189.
 *  "Nuevo objetivo" y el tap en una fila son de la Task 14: de momento la lista es de solo
 *  lectura. */
function objetivosCardHtml(goals) {
  const n = goals.length;
  const header = `
    <div style="display:flex;align-items:baseline;justify-content:space-between;">
      <div style="font-size:15px;font-weight:700;">Objetivos</div>
      <div style="font-size:11px;color:var(--text-3);">${n} activo${n === 1 ? "" : "s"}</div>
    </div>`;

  if (n === 0) {
    return `
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${header}
        <div class="card" style="text-align:center;color:var(--text-3);">Todavía no tienes ningún objetivo activo.</div>
      </div>`;
  }

  return `
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${header}
      <div class="card" style="display:flex;flex-direction:column;gap:18px;">
        ${goals.map(goalRowHtml).join("")}
      </div>
    </div>`;
}

/** Pantalla "Patrimonio" (Task 13): cabecera + tarjeta de patrimonio neto (con su evolución) +
 *  tarjeta Cuentas + tarjeta Objetivos — réplica de design/Patrimonio.dc.html. Es pestaña de
 *  nivel superior (como Inicio/Ajustes): sin botón "volver", sin `onBack`. */
export async function renderPatrimonio(container) {
  let series, accounts, goals;
  try {
    const hoy = hoyISO();
    // netWorthCents SALE de `accounts` (netWorthOfBalances), no de una query aparte: así el
    // importe de 38px y la suma de las filas de Cuentas son el MISMO número por construcción, no
    // por coincidencia (balancesAt ya trae el balance de cada cuenta a día de hoy).
    [series, accounts, goals] = await Promise.all([netWorthSeries(), balancesAt(hoy), goalsWithProgress()]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">No se pudo cargar Patrimonio: ${escHtml(e.message)}</div>`;
    return;
  }

  container.innerHTML = `
    <header class="screen-header">
      <h1>Patrimonio</h1>
      <p>Calculado con todos tus movimientos · hoy</p>
    </header>

    ${netWorthCardHtml(netWorthOfBalances(accounts), series)}
    ${cuentasCardHtml(accounts)}
    ${objetivosCardHtml(goals)}
  `;
}
