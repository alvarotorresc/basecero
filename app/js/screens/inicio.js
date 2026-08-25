import {
  getOpenPeriod, spentOfPeriod, incomeOfPeriod, listByDay, allCategoriesById,
  pendingShared, pendingSharedTotalCents, budgetsOfPeriod, previsionOfPeriod,
  spentByRootCategory, spentLast7Days,
} from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtEUR, fmtDiaLargo, fmtDiaCorto, fmtDiaIni, hoyISO } from "../format.js";
import { budgetStatus } from "./presupuesto.js";
import { barChartSvg, donutSvg } from "../charts.js";
import { renderLiquidar } from "./liquidar.js";
import { renderPeriodoNuevo } from "./periodo-nuevo.js";
import { renderPresupuesto } from "./presupuesto.js";
import { renderRecurrentes } from "./recurrentes.js";
import { renderRegistro } from "./registro.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const pctFmt = new Intl.NumberFormat("es-ES", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtNumEs = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const centsToStr = (cents) => fmtNumEs.format((cents ?? 0) / 100);

// Cuántas categorías raíz se listan individualmente en el donut antes de agrupar el resto en
// "Otras N" — mismo criterio visual que design/Resumen.dc.html:139-213 (6 + "Otras 3").
const DONUT_TOP_N = 6;
const DONUT_OTHERS_COLOR = "#5c646d";

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

function previsionRowHtml(item, byId) {
  const { rule, myCents, paid } = item;
  const color = rule.type === "transfer" ? "#5c646d" : colorForCategory(rule.category_id, byId);
  const icon = rule.type === "transfer" ? "⇄" : iconForCategory(rule.category_id, byId);
  const badge = paid
    ? `<span style="font-size:9px;font-weight:700;letter-spacing:0.04em;color:var(--green);background:#16291d;border-radius:6px;padding:3px 6px;flex-shrink:0;">✅ pagado</span>`
    : `<span style="font-size:9px;font-weight:700;letter-spacing:0.04em;color:var(--amber);background:#2f2712;border-radius:6px;padding:3px 6px;flex-shrink:0;">⏳ pendiente</span>`;
  const inner = `
      <div class="tx-icon" style="--cat:${color};">${icon}</div>
      <div class="tx-body">
        <div class="tx-title">${escHtml(rule.name)}</div>
      </div>
      <div class="num" style="font-size:14px;font-weight:600;flex-shrink:0;">${fmtEUR(myCents)}</div>
      ${badge}`;
  // Pagada: fila estática (nada que hacer). Pendiente: <button> real (no un <div> con onclick),
  // igual criterio que recurrentes.js ruleRowHtml — accesible por teclado/lector de pantalla.
  return paid
    ? `<div class="tx-row">${inner}</div>`
    : `<button type="button" class="tx-row" data-prevision-rule="${escAttr(rule.id)}"
        style="width:100%;text-align:left;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;">${inner}</button>`;
}

/** Bloque "Previsión": reglas recurrentes que aplican este mes (pagadas o pendientes), con
 *  el "comprometido restante" y el "disponible real" destacado. Se oculta entero si no hay
 *  ninguna regla aplicable este mes (aunque estén todas ya pagadas, el bloque se muestra). */
function previsionHtml(prevision, byId) {
  if (prevision.items.length === 0) return "";
  return `
    <div class="card" style="display:flex;flex-direction:column;gap:14px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div class="section-title">Previsión</div>
        <button type="button" id="prevision-gestionar" style="all:unset;cursor:pointer;
          font-size:12px;font-weight:600;color:var(--accent);white-space:nowrap;
          -webkit-tap-highlight-color:transparent;">Gestionar recurrentes →</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${prevision.items.map((it) => previsionRowHtml(it, byId)).join("")}
      </div>
      <hr class="divider">
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
          <div style="font-size:12px;color:var(--text-2);">Comprometido restante</div>
          <div class="num" style="font-size:14px;font-weight:600;">${fmtEUR(prevision.comprometidoCents)}</div>
        </div>
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
          <div style="font-size:13px;font-weight:700;">Disponible real</div>
          <div class="num ${prevision.disponibleCents >= 0 ? "text-green" : "text-red"}"
            style="font-size:20px;font-weight:700;letter-spacing:-0.02em;">${fmtEUR(prevision.disponibleCents)}</div>
        </div>
      </div>
    </div>`;
}

/** Tarjeta "Flujo de gasto": barChartSvg de los últimos 7 días naturales (hoy incluido y
 *  marcado como activo) — réplica de design/Resumen.dc.html:67-107. days7 viene de
 *  repo.spentLast7Days: 7 entradas {date, cents} ya rellenas con 0 en los días sin movimiento. */
function flujoDeGastoHtml(days7) {
  const hoy = hoyISO();
  const total7 = days7.reduce((s, d) => s + d.cents, 0);
  const days = days7.map((d) => ({ label: fmtDiaIni(d.date), cents: d.cents, active: d.date === hoy }));
  return `
    <div class="card" style="display:flex;flex-direction:column;gap:16px;margin-bottom:16px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
        <div style="font-size:15px;font-weight:700;">Flujo de gasto</div>
        <div style="font-size:11px;color:var(--text-3);">Últimos 7 días · ${fmtEUR(total7)}</div>
      </div>
      ${barChartSvg(days)}
    </div>`;
}

/** Color de la barra de estado de una fila del donut: igual criterio que
 *  presupuesto.js#statusColor (ok -> color propio de la categoría, warn/over -> ámbar/rojo). No
 *  se reutiliza directamente porque presupuesto.js no la exporta (es de detalle interno de esa
 *  pantalla) — aquí además el texto NO se colorea en warn (solo la barra), a diferencia de
 *  Presupuesto: ver design/Resumen.dc.html:146 (Casa, warn, texto blanco) vs :189 (Transporte,
 *  over, texto rojo). */
function donutBarColor(level, catColor) {
  if (level === "warn") return "var(--amber)";
  if (level === "over") return "var(--red)";
  return catColor;
}

/** Una fila de la lista de categorías del donut: punto de color + nombre + "X € de Y €" con
 *  mini-barra (categorías CON límite este periodo) o "X € sin límite" sin barra (el resto y el
 *  grupo "Otras N") — réplica de design/Resumen.dc.html:140-213. */
function categoriaDonutRowHtml(name, color, spentCents, limitCents) {
  if (limitCents > 0) {
    const st = budgetStatus(spentCents, limitCents);
    const barColor = donutBarColor(st.level, color);
    const numColor = st.level === "over" ? "var(--red)" : "var(--text)";
    const barPct = Math.min(100, Math.max(0, st.pct));
    return `
      <div style="display:flex;flex-direction:column;gap:6px;">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="width:8px;height:8px;border-radius:3px;background:${color};"></div>
            <div style="font-size:13px;color:var(--text-2);">${escHtml(name)}</div>
          </div>
          <div class="num" style="font-size:13px;font-weight:600;color:${numColor};white-space:nowrap;">${fmtEUR(spentCents)} <span style="font-weight:500;color:var(--text-3);">de ${fmtEUR(limitCents)}</span></div>
        </div>
        <div style="height:5px;background:#1e2225;border-radius:999px;overflow:hidden;">
          <div style="width:${barPct}%;height:5px;background:${barColor};border-radius:999px;"></div>
        </div>
      </div>`;
  }
  return `
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:8px;height:8px;border-radius:3px;background:${color};"></div>
        <div style="font-size:13px;color:var(--text-2);">${escHtml(name)}</div>
      </div>
      <div class="num" style="font-size:13px;font-weight:600;white-space:nowrap;">${fmtEUR(spentCents)} <span style="font-weight:500;color:var(--text-3);">sin límite</span></div>
    </div>`;
}

/** Tarjeta "Gasto por categoría": donut + lista de categorías raíz con gasto, agrupando las que
 *  sobran más allá de DONUT_TOP_N en "Otras N" — réplica de design/Resumen.dc.html:109-215.
 *
 *  El centro del donut muestra la SUMA DE LAS RAÍCES (= suma de los arcos), NO spentOfPeriod():
 *  un movimiento sin categorizar (category_id='') no cae bajo ninguna raíz (spentByRootCategory
 *  no lo agrupa) y por tanto no aparece en el anillo — si el centro mostrara el total del
 *  periodo, podría ser mayor que la suma de los arcos dibujados, dando la falsa impresión de que
 *  "falta" un trozo. Mostrando la suma de lo categorizado, el número del centro SIEMPRE coincide
 *  con el 100% del anillo.
 *
 *  "Ver presupuesto →" es el ÚNICO punto de entrada a la pantalla Presupuesto: NO puede depender
 *  de que haya algo que dibujar en el donut. Si no hay gasto categorizado todavía (periodo
 *  recién abierto, todo sin categorizar, refunds que dejan las raíces a 0/negativo...) pero el
 *  periodo SÍ tiene presupuestos, se muestra una tarjeta reducida con solo la cabecera + el
 *  enlace, sin donut ni lista — mismo
 *  `id`/handler que la variante completa. Solo si tampoco hay presupuestos la tarjeta entera se
 *  oculta (nada que mostrar Y nada a lo que entrar, igual criterio que conSaraHtml/previsionHtml). */
function gastoPorCategoriaHtml(rootRows, byId, budgetByCategory, showVerPresupuesto) {
  const verPresupuestoBtn = showVerPresupuesto
    ? `<button type="button" id="inicio-ver-presupuesto" style="all:unset;cursor:pointer;
        font-size:12px;font-weight:600;color:var(--accent);white-space:nowrap;
        -webkit-tap-highlight-color:transparent;">Ver presupuesto →</button>`
    : "";
  const headerHtml = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
      <div style="display:flex;flex-direction:column;gap:3px;">
        <div style="font-size:15px;font-weight:700;">Gasto por categoría</div>
        <div style="font-size:11px;color:var(--text-3);">Solo tu parte de lo compartido</div>
      </div>
      ${verPresupuestoBtn}
    </div>`;

  const withSpend = rootRows.filter((r) => r.spent_cents > 0);
  if (withSpend.length === 0) {
    if (!showVerPresupuesto) return "";
    return `
      <div class="card" style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">
        ${headerHtml}
        <div style="font-size:12px;color:var(--text-3);">Aún no hay gasto categorizado este periodo.</div>
      </div>`;
  }

  const top = withSpend.slice(0, DONUT_TOP_N);
  const rest = withSpend.slice(DONUT_TOP_N);
  const restTotal = rest.reduce((s, r) => s + r.spent_cents, 0);
  const categorizedTotal = withSpend.reduce((s, r) => s + r.spent_cents, 0);

  const slices = top.map((r) => ({ color: colorForCategory(r.root_id, byId), cents: r.spent_cents }));
  if (rest.length > 0) slices.push({ color: DONUT_OTHERS_COLOR, cents: restTotal });

  const rowsHtml = top
    .map((r) => categoriaDonutRowHtml(r.name, colorForCategory(r.root_id, byId), r.spent_cents, budgetByCategory[r.root_id] ?? 0))
    .join("");
  const otrasRowHtml = rest.length > 0 ? categoriaDonutRowHtml(`Otras ${rest.length}`, DONUT_OTHERS_COLOR, restTotal, 0) : "";

  return `
    <div class="card" style="display:flex;flex-direction:column;gap:16px;margin-bottom:16px;">
      ${headerHtml}
      <div style="display:flex;justify-content:center;">
        ${donutSvg(slices, centsToStr(categorizedTotal), "EUR gastados")}
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        ${rowsHtml}${otrasRowHtml}
      </div>
    </div>`;
}

/** Pantalla Inicio: cabecera del periodo abierto (gastado, ingresos, ahorrado, tasa),
 *  tarjetas "Flujo de gasto" y "Gasto por categoría", bloque "Con Sara" (pendiente/liquidar),
 *  bloque "Previsión" (reglas recurrentes del mes) y sus movimientos agrupados por día. */
export async function renderInicio(container) {
  let period, spent, income, rows, byId, sharedRows, sharedTotal, budgets, prevision, rootRows, days7;
  try {
    period = await getOpenPeriod();
    if (!period) {
      container.innerHTML = `<div class="banner-aviso red">No hay ningún periodo abierto.</div>`;
      return;
    }
    [spent, income, rows, byId, sharedRows, sharedTotal, budgets, prevision, rootRows, days7] = await Promise.all([
      spentOfPeriod(period.id),
      incomeOfPeriod(period.id),
      listByDay(period.id),
      allCategoriesById(),
      pendingShared(),
      pendingSharedTotalCents(),
      budgetsOfPeriod(period.id),
      previsionOfPeriod(period),
      spentByRootCategory(period.id),
      spentLast7Days(period.id),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">No se pudo cargar Inicio: ${escHtml(e.message)}</div>`;
    return;
  }

  const budgetByCategory = Object.fromEntries(budgets.map((b) => [b.category_id, b.amount_cents]));

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

    ${flujoDeGastoHtml(days7)}

    ${gastoPorCategoriaHtml(rootRows, byId, budgetByCategory, budgets.length > 0)}

    ${conSaraHtml(period, sharedRows, sharedTotal)}

    ${previsionHtml(prevision, byId)}

    ${movimientosHtml}
  `;

  const liquidarBtn = container.querySelector("#con-sara-liquidar");
  if (liquidarBtn) liquidarBtn.onclick = () => renderLiquidar(container, () => renderInicio(container));

  const presuBtn = container.querySelector("#inicio-ver-presupuesto");
  if (presuBtn) presuBtn.onclick = () => renderPresupuesto(container, () => renderInicio(container));

  const gestionarBtn = container.querySelector("#prevision-gestionar");
  if (gestionarBtn) gestionarBtn.onclick = () => renderRecurrentes(container, () => renderInicio(container));

  container.querySelectorAll("[data-prevision-rule]").forEach((el) => {
    el.onclick = () => {
      const item = prevision.items.find((it) => it.rule.id === el.dataset.previsionRule);
      if (!item) return;
      const { rule } = item;
      renderRegistro(container, () => renderInicio(container), {
        type: rule.type,
        amountCents: rule.amount_cents,
        categoryId: rule.category_id,
        accountId: rule.account_id,
        merchant: rule.name,
        ruleId: rule.id,
        isShared: !!rule.is_shared,
      });
    };
  });

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
