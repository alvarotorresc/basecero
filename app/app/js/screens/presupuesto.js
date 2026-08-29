import { getOpenPeriod, spentByRootCategory, budgetsOfPeriod, allCategoriesById } from "../repo.js";
import { colorForCategory, iconForCategory, textColorForCategory } from "../category-colors.js";
import { fmtMoney, fmtMoneyParts, fmtDiaCorto, hoyISO } from "../format.js";
import { t } from "../i18n/index.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Compone un importe con los céntimos reducidos en <small> (patrón .amount-hero del design
// system, ver DesignSystem.dc.html / inicio.js#moneyPartsHtml): main + <small>céntimos</small> +
// sufijo, sin reimplementar el locale — fmtMoneyParts (format.js) ya hace el split posicional.
const moneyPartsHtml = (cents) => {
  const { main, cents: c, suffix } = fmtMoneyParts(cents);
  return `${escHtml(main)}<small>${escHtml(c)}</small>${escHtml(suffix)}`;
};

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

// Icono ⓘ del recuadro informativo (design/material-expresivo/Presupuesto.dc.html:102, círculo +
// línea/punto) — color en style="stroke:..." (no en el atributo de presentación stroke="var(...)"),
// mismo criterio que ICON_ARROW de patrimonio.js: var() en style está garantizado por CSS Values,
// no depende de que el motor resuelva custom properties dentro de un atributo SVG.
const ICON_INFO = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="stroke:var(--text-2);flex-shrink:0;" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16.5v.01"></path></svg>`;

// Espacio DURO (U+00A0) antes del %: en español el espacio previo al símbolo es lo correcto,
// pero con espacio normal el porcentaje se partía en dos líneas al estrecharse el contenedor
// («84» arriba, «%» debajo — visible en las capturas de la landing). Intl ya emite U+00A0 en
// fmtPct, así que esto solo alinea el formateo hecho a mano con el del resto de la app.
const fmtPctInt = (pct) => `${Math.round(pct)}\u00A0%`;

/** Une nombres para el recuadro "Sin límite este periodo": hasta `max` nombres tal cual,
 *  y si sobran se corta con "y N más" (sin "y" antes del último del grupo visible, igual
 *  que en design/Presupuesto.dc.html: "Coche, Salud, Suscripciones y 1 más"). */
function joinConMas(names, max = 3) {
  if (names.length <= max) return names.join(", ");
  return t("presupuesto.noLimit.andMore", { names: names.slice(0, max).join(", "), n: names.length - max });
}

/** Color del número grande y de la barra de una fila de categoría. En 'ok' van desacoplados —
 *  número en textColorForCategory (paleta clara, legible como texto) y barra en colorForCategory
 *  (paleta sólida, la misma que el dotico) — ver design/Presupuesto.dc.html: Alimentación tiene
 *  dotico/barra en #629D3B pero el número en #7FB554 (su TEXT_COLORS). En 'warn'/'over' AMBOS
 *  (número Y barra) pisan al color de categoría con el color de estado (ámbar/rojo) — Restauración
 *  (warn) y Transporte (over) del artboard muestran número Y barra en su color de estado, no en
 *  ningún tono de su propia categoría. */
function statusColors(level, rootColor, textColor) {
  if (level === "warn") return { num: "var(--amber)", bar: "var(--amber)" };
  if (level === "over") return { num: "var(--red)", bar: "var(--red)" };
  return { num: textColor, bar: rootColor };
}

/** Fila de categoría con límite: dotico + nombre + importe (spent / budget) + barra + subtexto de
 *  estado — réplica de design/Presupuesto.dc.html:44-98 (fila `.cat`, sin envoltorio de tarjeta
 *  propio: la lista completa comparte una única `.card` con `<hr class="divider">` entre filas,
 *  mismo criterio que patrimonio.js#cuentaRowHtml/cuentasCardHtml).
 *
 *  Formato del importe: el artboard usa "312,40 / 420 €" (símbolo solo en el límite); reproducirlo
 *  exigiría trocear la salida de fmtMoney (format.js:45-53 documenta por qué eso está descartado:
 *  rompe con monedas/locales donde el símbolo no va de sufijo). Se usa fmtMoney en ambos números
 *  ("312,40 € / 420,00 €") — mismo criterio que el resto de la app, sin fabricar un formato nuevo.
 *
 *  Subtexto de estado: SE CONSERVAN los 3 (ok/warn/over) tal cual estaban — "sus subtextos
 *  existentes re-estilados" del brief se lee como preservación, no recorte; el artboard no muestra
 *  ninguno en las filas 'ok' (Alimentación/Casa/Suscripciones/Salud), pero "Te quedan X" es
 *  información real que ya se calculaba, así que no se quita. Sí se quitan los iconos
 *  (ICON_CHECK/ICON_TRIANGLE de la versión anterior): el artboard no lleva icono en NINGÚN estado. */
function categoryRowHtml(row, budgetCents, byId) {
  const st = budgetStatus(row.spent_cents, budgetCents);
  const rootColor = colorForCategory(row.root_id, byId);
  const textColor = textColorForCategory(row.root_id, byId);
  const icon = iconForCategory(row.root_id, byId);
  const { num: numColor, bar: barColor } = statusColors(st.level, rootColor, textColor);
  const barPct = Math.min(100, Math.max(0, st.pct));
  const remaining = budgetCents - row.spent_cents;
  const over = st.level === "over";

  let statusLineHtml;
  if (over) {
    statusLineHtml = `<div style="font-size:11px;color:var(--red);">${t("presupuesto.category.over", { amount: fmtMoney(-remaining) })}</div>`;
  } else if (st.level === "warn") {
    statusLineHtml = `<div style="font-size:11px;color:var(--amber);">${t("presupuesto.category.warn", { amount: fmtMoney(remaining) })}</div>`;
  } else {
    statusLineHtml = `<div style="font-size:11px;color:var(--text-3);">${t("presupuesto.category.ok", { amount: fmtMoney(remaining) })}</div>`;
  }

  return `
    <div style="display:flex;flex-direction:column;gap:8px;padding:13px 0;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="dotico" style="--cat:${rootColor};">${icon}</div>
        <div style="flex:1;min-width:0;font-size:13.5px;font-weight:600;">${escHtml(row.name)}</div>
        <div class="num" style="font-size:14px;font-weight:700;color:${numColor};white-space:nowrap;flex-shrink:0;">
          ${fmtMoney(row.spent_cents)} <span style="font-size:11px;font-weight:500;color:var(--text-3);">/ ${fmtMoney(budgetCents)}</span>
        </div>
      </div>
      <div class="bar" style="--cat:${barColor};"><i style="width:${barPct}%;"></i></div>
      ${statusLineHtml}
    </div>`;
}

/** Recuadro "Sin límite este periodo": card informativa (radius-sm, ver DesignSystem.dc.html) +
 *  icono ⓘ del artboard (Presupuesto.dc.html:101-104) — mismo texto/datos de siempre (nombres +
 *  total gastado de las categorías sin límite con gasto real), solo cambia el contenedor (antes:
 *  caja de borde punteado + chevron; ahora: card-16 + ⓘ, igual criterio visual que el resto del
 *  sistema para notas informativas). */
function sinLimiteHtml(rows) {
  if (rows.length === 0) return "";
  const total = rows.reduce((s, r) => s + r.spent_cents, 0);
  const nombres = joinConMas(rows.map((r) => r.name));
  return `
    <div style="display:flex;align-items:center;gap:10px;background:var(--card);border-radius:var(--radius-sm);padding:12px 16px;">
      ${ICON_INFO}
      <div style="display:flex;flex-direction:column;gap:3px;flex-grow:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:var(--text-2);">${t("presupuesto.noLimit.title")}</div>
        <div style="font-size:11px;color:var(--text-3);">${t("presupuesto.noLimit.summary", { names: escHtml(nombres), amount: fmtMoney(total) })}</div>
      </div>
    </div>`;
}

/** Pantalla "Presupuesto": tarjeta total (spent/límite de las categorías raíz CON presupuesto
 *  de este periodo) + una tarjeta por categoría con límite + recuadro "Sin límite este periodo"
 *  para el resto. Periodos son manuales y sin fecha fin conocida mientras están abiertos (ver
 *  ajustes.js periodoCardHtml), así que la cabecera muestra "abierto el {fecha} · N días" en vez
 *  de "quedan N días" como en design/Presupuesto.dc.html (que asume fecha fin fija) — mismo motivo
 *  por el que la barra total NO lleva la leyenda "N % del periodo por delante" del artboard: no
 *  hay fecha fin de la que derivarla sin fabricarla. */
export async function renderPresupuesto(container, onBack) {
  let period, rootRows, budgetRows, byId;
  try {
    period = await getOpenPeriod();
    if (!period) {
      container.innerHTML = `<div class="banner-aviso red">${t("common.noOpenPeriod")}</div>`;
      return;
    }
    [rootRows, budgetRows, byId] = await Promise.all([
      spentByRootCategory(period.id),
      budgetsOfPeriod(period.id),
      allCategoriesById(),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">${t("presupuesto.error.load", { error: escHtml(e.message) })}</div>`;
    return;
  }

  // > 0, no != null: budgetStatus() (y por tanto categoryRowHtml) trata un límite 0/null como
  // "sin estado", así que una fila con amount_cents=0 (p.ej. colada por un import xlsx a mano;
  // periodo-nuevo.js nunca escribe una así, filtra n>0 al guardar) NO debe acabar en conLimite:
  // reventaría categoryRowHtml al leer st.level de un budgetStatus() que devolvió null.
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
  const diasTxt = dias >= 1 ? t("presupuesto.header.days", { n: dias }) : "";
  const n = conLimite.length;

  const remainingSpan = `<span style="color:var(--green);font-weight:700;">${fmtMoney(totalRemaining)}</span>`;
  const overSpan = `<span style="color:var(--red);font-weight:700;">${fmtMoney(-totalRemaining)}</span>`;

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
      <button type="button" class="icon-btn" id="presu-back" aria-label="${t("common.goBack")}" style="width:44px;height:44px;border-radius:50%;background:var(--card);color:var(--text);font-size:18px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"></path></svg></button>
      <div style="display:flex;flex-direction:column;gap:2px;">
        <div style="font-size:20px;font-weight:700;letter-spacing:-0.015em;">${t("presupuesto.title")}</div>
        <div style="font-size:11px;color:var(--text-3);">${t("presupuesto.header.openedOn", { period: escHtml(period.name), date: fmtDiaCorto(period.start_date), days: diasTxt })}</div>
      </div>
    </div>

    ${n === 0 ? `
    <div class="card" style="text-align:center;color:var(--text-3);margin-bottom:16px;">
      <p>${t("presupuesto.empty")}</p>
    </div>` : `
    <div class="card" style="display:flex;flex-direction:column;gap:14px;margin-bottom:16px;">
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;">
        <div style="display:flex;flex-direction:column;gap:6px;">
          <div class="section-title">${t("presupuesto.total.title")}</div>
          <div style="display:flex;align-items:baseline;gap:7px;">
            <div class="amount-hero num">${moneyPartsHtml(totalSpent)}</div>
            <div class="num" style="font-size:13px;color:var(--text-3);">${t("presupuesto.total.ofBudgeted", { amount: fmtMoney(totalLimit) })}</div>
          </div>
        </div>
        <div class="num" style="font-size:24px;font-weight:700;line-height:1;">${fmtPctInt(totalSt.pct)}</div>
      </div>
      <div class="bar" style="--cat:var(--text);height:10px;"><i style="width:${totalBarPct}%;"></i></div>
      <div style="font-size:11px;color:var(--text-3);">
        ${totalRemaining >= 0
          ? t("presupuesto.total.remaining", { n, amount: remainingSpan })
          : t("presupuesto.total.over", { n, amount: overSpan })}
      </div>
    </div>

    <div style="display:flex;align-items:baseline;justify-content:space-between;padding-top:2px;margin-bottom:12px;">
      <div style="font-size:15px;font-weight:700;">${t("presupuesto.byCategory.title")}</div>
      <div style="font-size:11px;color:var(--text-3);">${t("presupuesto.byCategory.countWithLimit", { n })}</div>
    </div>

    <div class="card" style="padding:6px 16px;display:flex;flex-direction:column;margin-bottom:16px;">
      ${conLimite.map((r) => categoryRowHtml(r, budgetByCategory[r.root_id], byId)).join('<hr class="divider">')}
    </div>`}

    ${sinLimiteHtml(sinLimite)}
  `;

  container.querySelector("#presu-back").onclick = () => onBack();
}
