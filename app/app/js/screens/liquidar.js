import { pendingSettlements, listAccounts, allCategoriesById, settleAllShared, getMetaAll } from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtMoney, fmtMoneyParts, fmtDiaCorto } from "../format.js";
import { resolveAccountId } from "../account-defaults.js";
import { t } from "../i18n/index.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Compone un importe con los céntimos reducidos en <small> (patrón .amount-hero del design
// system, ver DesignSystem.dc.html / inicio.js#moneyPartsHtml): main + <small>céntimos</small> +
// sufijo, sin reimplementar el locale — fmtMoneyParts (format.js) ya hace el split posicional.
const moneyPartsHtml = (cents) => {
  const { main, cents: c, suffix } = fmtMoneyParts(cents);
  return `${escHtml(main)}<small>${escHtml(c)}</small>${escHtml(suffix)}`;
};

/** Fila de gasto pendiente: .dotico + nombre + sub (fecha · importe original · % de quien debe esa
 *  parte: el de la contraparte en las filas 'partner_owes', el MÍO en las 'i_owe')
 *  — réplica de docs/design/material-expresivo/Liquidar.dc.html:38-57 (clase `.tx`, sin envoltorio de tarjeta propio: la
 *  lista completa comparte una única `.card` con `<hr class="divider">` entre filas, mismo criterio
 *  que presupuesto.js/patrimonio.js#cuentasCardHtml). Task 5 (backlog, liquidar en bloque): la fila
 *  ya NO lleva botón propio — el artboard solo tiene el botón de liquidación al pie (armado
 *  inline en render(), más abajo), y con settleAllShared liquidando TODOS los pendientes visibles
 *  de una vez, un botón por fila liquidaría solo esa fila, un camino distinto al del artboard que
 *  ya no hace falta mantener.
 *
 *  El % es DERIVADO de r.settle_cents/r.amount_cents (ambos vienen en la fila de
 *  pendingSettlements, sql.js) — no un campo nuevo. Se deriva aquí en vez de leer el pct del
 *  periodo abierto porque settle_cents ya viene calculado con el pct EFECTIVO del propio gasto
 *  (puede tener override o venir de un periodo cerrado), así que recalcularlo desde ese mismo par
 *  de importes es más fiel que cualquier otra fuente disponible. Como settle_cents es «lo que la
 *  contraparte me debe» en 'partner_owes' y «lo que le debo yo» en 'i_owe', el MISMO cociente da el
 *  pct de ella en un caso y el mío en el otro: por eso el texto del sub se elige por dirección.
 *  Sustituye al sub anterior (categoría · fecha): el nombre de categoría ya no se repite aquí
 *  porque el título ya lo usa como fallback (`r.merchant || catName`) y el artboard no lo lleva en
 *  el sub de ninguna fila. */
function rowHtml(r, byId) {
  const cat = byId[r.category_id];
  const catName = cat?.name ?? "";
  const color = colorForCategory(r.category_id, byId);
  const icon = iconForCategory(r.category_id, byId);
  const title = r.merchant || catName || t("common.type.expense");
  const pct = r.amount_cents ? Math.round((r.settle_cents / r.amount_cents) * 100) : 0;
  // subTheirs = «su {pct} %» (lo pagué yo, ella me debe esa parte); subMine = «tu {pct} %»
  // (lo pagó ella, le debo mi parte). El importe original del ticket va en las dos.
  const sub = t(r.direction === "i_owe" ? "liquidar.row.subMine" : "liquidar.row.subTheirs",
    { date: fmtDiaCorto(r.date), amount: fmtMoney(r.amount_cents), pct });
  return `
    <div class="tx-row" style="padding:10px 0;">
      <div class="dotico" style="--cat:${color};">${icon}</div>
      <div class="tx-body">
        <div class="tx-title">${escHtml(title)}</div>
        <div class="tx-sub">${escHtml(sub)}</div>
      </div>
      <div class="num" style="font-size:14px;font-weight:700;flex-shrink:0;">${fmtMoney(r.settle_cents)}</div>
    </div>`;
}

/** Pantalla "Liquidar": dos secciones de gastos compartidos pendientes (de todos los periodos)
 *  —lo que me debe y lo que le debo— con el NETO en el hero; un solo botón liquida las dos
 *  direcciones a la vez, con selector de cuenta arriba y confirmación en dos toques. onBack vuelve
 *  a Inicio (que se re-renderiza entero, igual que renderRegistro/onDone en main.js).
 *
 *  El selector de cuenta va ANTES de la lista (no al pie, como en el artboard): settleAllShared
 *  exige accountId al liquidar (ver wire() más abajo), así que el usuario necesita poder elegirla
 *  antes de poder tocar el botón del pie — el artboard es una foto fija sin ese flujo
 *  interactivo.
 *
 *  NO se replica la nota "Se crea una devolución enlazada..." de docs/design/material-expresivo/Liquidar.dc.html:68-71: es
 *  copy nuevo, no hay ningún texto equivalente ya en esta pantalla (grep `devoluci|refund|enlazad`
 *  sobre app/js/screens/*.js y repo.js: solo comentarios internos, ningún string de UI) — brecha
 *  documentada, no fabricada (regla explícita del brief).
 *
 *  Task 5 (backlog, liquidar en bloque): UN solo botón al pie («Cobrar…»/«Pagar…»/«Liquidar ·
 *  queda a cero» según el signo del neto) liquida TODOS los pendientes actualmente listados
 *  (state.rows, ya filtrados/cargados arriba) con la cuenta seleccionada — repo.settleAllShared
 *  hace el execMany atómico (o se liquidan todos, o ninguno).
 *  Los botones por fila se retiran (ver rowHtml): el artboard solo tiene el botón del pie, y con la
 *  operación en bloque disponible, un botón que liquidara una única fila sería un segundo camino
 *  que el artboard no contempla — más simple mantener solo el que el diseño pide. */
export async function renderLiquidar(container, onBack) {
  let rows, accountsAll, byId, meta;
  try {
    [rows, accountsAll, byId, meta] = await Promise.all([
      pendingSettlements(), listAccounts(), allCategoriesById(), getMetaAll(),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">${t("liquidar.error.load", { error: escHtml(e.message) })}</div>`;
    return;
  }
  const accounts = accountsAll.filter((a) => a.type !== "liability");
  const partnerName = (meta.partner_name || "").trim();

  const state = {
    rows,
    accountId: resolveAccountId(meta.default_account_id, accounts) ?? "",
    confirm: false,
    busy: false,
  };
  let errorMsg = "";

  function render() {
    // Neto derivado de las filas visibles (no de una query aparte) para que el hero no pueda
    // desviarse de la lista: 'i_owe' resta, 'partner_owes' suma. SQL.pendingSettlementNet usa el
    // mismo WHERE, así que ambos coinciden siempre.
    const net = state.rows.reduce((s, r) => s + (r.direction === "i_owe" ? -r.settle_cents : r.settle_cents), 0);
    const name = partnerName || t("movimientos.shared.fallbackName");
    const theyOwe = state.rows.filter((r) => r.direction === "partner_owes");
    const iOwe = state.rows.filter((r) => r.direction === "i_owe");
    const netClass = net > 0 ? " text-green" : net < 0 ? " text-red" : "";
    const netLabel = net > 0
      ? t("common.settlement.theyOwe", { name: escHtml(name) })
      : net < 0
        ? t("common.settlement.youOwe", { name: escHtml(name) })
        : t("common.settlement.even");
    const footerLabel = net > 0
      ? (state.confirm ? t("liquidar.footer.collectConfirm", { amount: fmtMoney(net) })
                       : t("liquidar.footer.collect", { amount: fmtMoney(net), name: escHtml(name) }))
      : net < 0
        ? (state.confirm ? t("liquidar.footer.payConfirm", { amount: fmtMoney(-net) })
                         : t("liquidar.footer.pay", { amount: fmtMoney(-net), name: escHtml(name) }))
        : (state.confirm ? t("liquidar.footer.evenConfirm") : t("liquidar.footer.even"));
    const sectionHtml = (titleText, rows) => rows.length === 0 ? "" : `
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px;">
        <div class="section-title">${titleText}</div>
        <div class="card" style="padding:6px 16px;display:flex;flex-direction:column;">
          ${rows.map((r) => rowHtml(r, byId)).join('<hr class="divider">')}
        </div>
      </div>`;

    container.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;">
        <button type="button" class="icon-btn" id="liq-back" aria-label="${t("common.goBack")}" style="width:44px;height:44px;border-radius:50%;background:var(--card);color:var(--text);font-size:18px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"></path></svg></button>
        <h1 style="font-size:19px; font-weight:700; letter-spacing:-0.01em;">${partnerName ? t("liquidar.title.withPartner", { name: escHtml(partnerName) }) : t("common.settle")}</h1>
        <span style="width:44px;"></span>
      </div>

      <div class="card" style="display:flex;flex-direction:column;gap:4px;margin-bottom:18px;">
        <div class="section-title">${t("liquidar.net.title")}</div>
        <div class="amount-hero num${netClass}">${moneyPartsHtml(Math.abs(net))}</div>
        <div style="font-size:11px;color:var(--text-3);">${netLabel}</div>
      </div>

      ${accounts.length ? `
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">${t("liquidar.account.title")}</div>
        <div class="chips">
          ${accounts.map((a) => `<button type="button" class="chip${state.accountId === a.id ? " active" : ""}" style="padding:0 14px;" data-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
        </div>
      </div>` : ""}

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      ${state.rows.length === 0
        ? `<div class="card" style="text-align:center;color:var(--text-3)"><p>${t("liquidar.empty")}</p></div>`
        : `${sectionHtml(t("common.settlement.theyOwe", { name: escHtml(name) }), theyOwe)}
          ${sectionHtml(t("common.settlement.youOwe", { name: escHtml(name) }), iOwe)}
          <button type="button" class="btn-primary" id="liq-settle-all" ${state.busy ? "disabled" : ""}>
            ${footerLabel}
          </button>`}
    `;
    wire();
  }

  function wire() {
    container.querySelector("#liq-back").onclick = () => onBack();

    container.querySelectorAll("[data-acc]").forEach((b) => {
      b.onclick = () => { state.accountId = b.dataset.acc; state.confirm = false; render(); };
    });

    const settleBtn = container.querySelector("#liq-settle-all");
    if (settleBtn) {
      settleBtn.onclick = async () => {
        if (!state.accountId) {
          errorMsg = t("common.needAccount");
          state.confirm = false;
          render();
          return;
        }
        if (!state.confirm) {
          state.confirm = true;
          errorMsg = "";
          render();
          return;
        }
        if (state.busy) return;
        state.busy = true;
        settleBtn.disabled = true;
        try {
          await settleAllShared(state.rows.map((r) => r.id), state.accountId);
          state.rows = await pendingSettlements();
          state.confirm = false;
          errorMsg = "";
        } catch (e) {
          errorMsg = t("liquidar.error.settle", { error: e.message });
          state.confirm = false;
          state.rows = await pendingSettlements();
        } finally {
          state.busy = false;
          render();
        }
      };
    }
  }

  render();
}
