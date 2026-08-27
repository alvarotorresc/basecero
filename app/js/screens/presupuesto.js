import { getOpenPeriod, spentByRootCategory, budgetsOfPeriod, allCategoriesById } from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtMoney, fmtDiaCorto, hoyISO } from "../format.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Estado de una categoría (o del total) frente a su límite. Umbrales: ok < 85 %,
 *  warn >= 85 % (incluye el 100 % justo), over > 100 %. Sin límite (0/null/undefined) -> null:
 *  quien llama decide qué hacer (p.ej. tratarla como "sin límite este periodo"). pct SIN capar
 *  (para el número grande); quien pinta la barra la capa a 100 al renderizar. */
export function budgetStatus(spent, limit) {
  if (!limit) return null;
  const pct = (spent / limit) * 100;
  const level = pct > 100 ? "over" : pct >= 85 ? "warn" : "ok";
  return { pct, level };
}

const ICON_CHECK = (color) =>
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5 10-11"></path></svg>`;
const ICON_TRIANGLE = (color) =>
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.5L21.2 19.5H2.8z"></path><path d="M12 10.2v4M12 17.2h.01"></path></svg>`;
const ICON_CHEVRON = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#656c74" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 5l7 7-7 7"></path></svg>`;

const fmtPct = (pct) => `${Math.round(pct)} %`;

/** Une nombres para el recuadro "Sin límite este periodo": hasta `max` nombres tal cual,
 *  y si sobran se corta con "y N más" (sin "y" antes del último del grupo visible, igual
 *  que en design/Presupuesto.dc.html: "Coche, Salud, Suscripciones y 1 más"). */
function joinConMas(names, max = 3) {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} y ${names.length - max} más`;
}

/** Color del número grande y de la barra: en 'ok' el propio color de la categoría (sin alarma),
 *  en 'warn'/'over' el color de estado (ámbar/rojo) pisa al de la categoría — ver design/Presupuesto.dc.html:
 *  Alimentación/Ocio (ok) muestran su color de categoría, Casa/Restauración (warn) y Transporte (over)
 *  muestran ámbar/rojo aunque su color de categoría sea otro. */
function statusColor(level, catColor) {
  if (level === "warn") return "var(--amber)";
  if (level === "over") return "var(--red)";
  return catColor;
}

function categoryCardHtml(row, budgetCents, byId) {
  const st = budgetStatus(row.spent_cents, budgetCents);
  const color = colorForCategory(row.root_id, byId);
  const icon = iconForCategory(row.root_id, byId);
  const numColor = statusColor(st.level, color);
  const barPct = Math.min(100, Math.max(0, st.pct));
  const remaining = budgetCents - row.spent_cents;
  const over = st.level === "over";
  const borderStyle = over ? "border-color:color-mix(in srgb, var(--red) 35%, var(--border));" : "";

  let statusLineHtml;
  if (over) {
    statusLineHtml = `
      <div style="display:flex;">
        <div style="display:flex;align-items:center;gap:7px;background:color-mix(in srgb, var(--red) 14%, var(--card));border-radius:10px;padding:7px 11px;">
          ${ICON_TRIANGLE("var(--red)")}
          <div style="font-size:12px;font-weight:600;color:var(--red);">Superado por ${fmtMoney(-remaining)}</div>
        </div>
      </div>`;
  } else if (st.level === "warn") {
    statusLineHtml = `
      <div style="display:flex;align-items:center;gap:7px;">
        ${ICON_TRIANGLE("var(--amber)")}
        <div style="font-size:12px;color:var(--amber);">Casi al límite · te quedan ${fmtMoney(remaining)}</div>
      </div>`;
  } else {
    statusLineHtml = `
      <div style="display:flex;align-items:center;gap:7px;">
        ${ICON_CHECK("var(--green)")}
        <div style="font-size:12px;color:var(--text-2);">Te quedan ${fmtMoney(remaining)}</div>
      </div>`;
  }

  return `
    <div class="card" style="display:flex;flex-direction:column;gap:13px;${borderStyle}">
      <div style="display:flex;align-items:center;gap:13px;">
        <div class="tx-icon" style="--cat:${color};width:44px;height:44px;border-radius:15px;font-size:21px;">${icon}</div>
        <div style="display:flex;flex-direction:column;gap:3px;flex-grow:1;min-width:0;">
          <div style="font-size:15px;font-weight:600;">${escHtml(row.name)}</div>
          <div class="num" style="font-size:12px;color:var(--text-3);">${fmtMoney(row.spent_cents)} de ${fmtMoney(budgetCents)}</div>
        </div>
        <div class="num" style="font-size:22px;font-weight:700;color:${numColor};flex-shrink:0;">${fmtPct(st.pct)}</div>
      </div>
      <div style="height:10px;background:#1e2225;border-radius:999px;overflow:hidden;">
        <div style="width:${barPct}%;height:10px;background:${numColor};border-radius:999px;"></div>
      </div>
      ${statusLineHtml}
    </div>`;
}

function sinLimiteHtml(rows) {
  if (rows.length === 0) return "";
  const total = rows.reduce((s, r) => s + r.spent_cents, 0);
  const nombres = joinConMas(rows.map((r) => r.name));
  return `
    <div style="display:flex;align-items:center;gap:10px;background:#131517;border:1px dashed #2a2f34;border-radius:18px;padding:14px 16px;">
      <div style="display:flex;flex-direction:column;gap:3px;flex-grow:1;">
        <div style="font-size:13px;font-weight:600;color:var(--text-2);">Sin límite este periodo</div>
        <div style="font-size:11px;color:var(--text-3);">${escHtml(nombres)} · ${fmtMoney(total)} gastados</div>
      </div>
      ${ICON_CHEVRON}
    </div>`;
}

/** Pantalla "Presupuesto": tarjeta total (spent/límite de las categorías raíz CON presupuesto
 *  de este periodo) + una tarjeta por categoría con límite + recuadro "Sin límite este periodo"
 *  para el resto. Periodos son manuales y sin fecha fin conocida mientras están abiertos (ver
 *  ajustes.js periodoCardHtml), así que la cabecera muestra "abierto el {fecha} · N días" en vez
 *  de "quedan N días" como en design/Presupuesto.dc.html (que asume fecha fin fija). */
export async function renderPresupuesto(container, onBack) {
  let period, rootRows, budgetRows, byId;
  try {
    period = await getOpenPeriod();
    if (!period) {
      container.innerHTML = `<div class="banner-aviso red">No hay ningún periodo abierto.</div>`;
      return;
    }
    [rootRows, budgetRows, byId] = await Promise.all([
      spentByRootCategory(period.id),
      budgetsOfPeriod(period.id),
      allCategoriesById(),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">No se pudo cargar Presupuesto: ${escHtml(e.message)}</div>`;
    return;
  }

  // > 0, no != null: budgetStatus() (y por tanto categoryCardHtml) trata un límite 0/null como
  // "sin estado", así que una fila con amount_cents=0 (p.ej. colada por un import xlsx a mano;
  // periodo-nuevo.js nunca escribe una así, filtra n>0 al guardar) NO debe acabar en conLimite:
  // reventaría categoryCardHtml al leer st.level de un budgetStatus() que devolvió null.
  const budgetByCategory = Object.fromEntries(budgetRows.map((b) => [b.category_id, b.amount_cents]));
  const conLimite = rootRows.filter((r) => (budgetByCategory[r.root_id] ?? 0) > 0);
  // Solo categorías CON gasto real: si no tiene límite y tampoco se ha tocado este periodo,
  // listarla en el recuadro no aporta nada (ver periodo-nuevo.js, mismo criterio para
  // "visible" por defecto al abrir el asistente) — evita que el recuadro se llene de las
  // categorías que simplemente no se han usado.
  const sinLimite = rootRows.filter((r) => (budgetByCategory[r.root_id] ?? 0) <= 0 && r.spent_cents > 0);

  const totalSpent = conLimite.reduce((s, r) => s + r.spent_cents, 0);
  const totalLimit = conLimite.reduce((s, r) => s + (budgetByCategory[r.root_id] ?? 0), 0);
  const totalSt = budgetStatus(totalSpent, totalLimit);
  const totalBarPct = totalSt ? Math.min(100, Math.max(0, totalSt.pct)) : 0;
  const totalRemaining = totalLimit - totalSpent;

  const dias = Math.floor((new Date(hoyISO() + "T12:00:00") - new Date(period.start_date + "T12:00:00")) / 86400000) + 1;
  const diasTxt = dias >= 1 ? ` · ${dias} día${dias === 1 ? "" : "s"}` : "";
  const n = conLimite.length;

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
      <button type="button" class="icon-btn" id="presu-back" aria-label="Volver">←</button>
      <div style="display:flex;flex-direction:column;gap:2px;">
        <div style="font-size:20px;font-weight:700;letter-spacing:-0.015em;">Presupuesto</div>
        <div style="font-size:11px;color:var(--text-3);">${escHtml(period.name)} · abierto el ${fmtDiaCorto(period.start_date)}${diasTxt}</div>
      </div>
    </div>

    ${n === 0 ? `
    <div class="card" style="text-align:center;color:var(--text-3);margin-bottom:16px;">
      <p>Este periodo no tiene ninguna categoría con límite.</p>
    </div>` : `
    <div class="card" style="display:flex;flex-direction:column;gap:14px;margin-bottom:16px;">
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;">
        <div style="display:flex;flex-direction:column;gap:6px;">
          <div style="font-size:12px;font-weight:600;color:var(--text-2);">Gastado de lo presupuestado</div>
          <div style="display:flex;align-items:baseline;gap:7px;">
            <div class="num" style="font-size:30px;font-weight:600;line-height:1;letter-spacing:-0.02em;">${fmtMoney(totalSpent)}</div>
            <div class="num" style="font-size:13px;color:var(--text-3);">de ${fmtMoney(totalLimit)}</div>
          </div>
        </div>
        <div class="num" style="font-size:24px;font-weight:700;line-height:1;color:var(--accent);">${fmtPct(totalSt.pct)}</div>
      </div>
      <div style="height:10px;background:#1e2225;border-radius:999px;overflow:hidden;">
        <div style="width:${totalBarPct}%;height:10px;background:var(--accent);border-radius:999px;"></div>
      </div>
      <div style="font-size:11px;color:var(--text-3);">
        ${totalRemaining >= 0
          ? `Te quedan <span style="color:var(--green);font-weight:700;">${fmtMoney(totalRemaining)}</span> en las ${n} categoría${n === 1 ? "" : "s"} con límite`
          : `Te has pasado <span style="color:var(--red);font-weight:700;">${fmtMoney(-totalRemaining)}</span> en las ${n} categoría${n === 1 ? "" : "s"} con límite`}
      </div>
    </div>

    <div style="display:flex;align-items:baseline;justify-content:space-between;padding-top:2px;margin-bottom:12px;">
      <div style="font-size:15px;font-weight:700;">Por categoría</div>
      <div style="font-size:11px;color:var(--text-3);">${n} con límite este periodo</div>
    </div>

    <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px;">
      ${conLimite.map((r) => categoryCardHtml(r, budgetByCategory[r.root_id], byId)).join("")}
    </div>`}

    ${sinLimiteHtml(sinLimite)}
  `;

  container.querySelector("#presu-back").onclick = () => onBack();
}
