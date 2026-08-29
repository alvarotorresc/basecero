import { pendingShared, listAccounts, allCategoriesById, settleShared, getMetaAll } from "../repo.js";
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

// Botón "Liquidar"/"Sí, liquidar" por fila: píldora, invertida en el estado de confirmación —
// mismo criterio "tinta invertida" que .chip.active/.btn-primary del sistema (fondo var(--text),
// texto var(--bg)). El artboard (Liquidar.dc.html) solo muestra un botón "Liquidar {total}" al
// pie, pero settleShared(txId, accountId) liquida UN gasto a la vez (repo.js:164-182) — no existe
// ninguna operación en bloque que liquide los N pendientes de golpe, así que fabricar ese botón
// sería inventar lógica (bucle + estado de fallo parcial) que el brief prohíbe explícitamente.
// "el flujo two-tap confirm EXACTAMENTE igual: mismo id, mismos estados, solo estilos" ata el
// "botón liquidar píldora invertida" de esta tarea a estos dos botones por fila, no a uno nuevo:
// se re-visten sus 2 estados, mismo id/handler/texto que antes.
const BTN_SETTLE = "height:34px;padding:0 14px;border-radius:999px;background:var(--card2);"
  + "color:var(--text-2);border:0;font:600 12px var(--font-ui);cursor:pointer;"
  + "-webkit-tap-highlight-color:transparent;white-space:nowrap;";
const BTN_SETTLE_CONFIRM = "height:34px;padding:0 14px;border-radius:999px;background:var(--text);"
  + "color:var(--bg);border:0;font:700 12px var(--font-ui);cursor:pointer;"
  + "-webkit-tap-highlight-color:transparent;white-space:nowrap;";

/** Fila de gasto pendiente: .dotico + nombre + sub (fecha · importe original · % de la contraparte)
 *  — réplica de docs/design/material-expresivo/Liquidar.dc.html:38-57 (clase `.tx`, sin envoltorio de tarjeta propio: la
 *  lista completa comparte una única `.card` con `<hr class="divider">` entre filas, mismo criterio
 *  que presupuesto.js/patrimonio.js#cuentasCardHtml).
 *
 *  El % es DERIVADO de r.partner_amount_cents/r.amount_cents (ambos ya vienen en la fila de
 *  pendingShared, sql.js:73-78) — no un campo nuevo. Se deriva aquí en vez de leer el pct del
 *  periodo abierto porque repo.js:166 avisa explícitamente de que partner_amount_cents ya viene
 *  calculado con el pct EFECTIVO del propio gasto (puede tener override o venir de un periodo
 *  cerrado), así que recalcularlo desde ese mismo par de importes es más fiel que cualquier otra
 *  fuente disponible. Sustituye al sub anterior (categoría · fecha): el nombre de categoría ya no
 *  se repite aquí porque el título ya lo usa como fallback (`r.merchant || catName`) y el artboard
 *  no lo lleva en el sub de ninguna fila. */
function rowHtml(r, byId, confirmId) {
  const cat = byId[r.category_id];
  const catName = cat?.name ?? "";
  const color = colorForCategory(r.category_id, byId);
  const icon = iconForCategory(r.category_id, byId);
  const title = r.merchant || catName || t("common.type.expense");
  const pct = r.amount_cents ? Math.round((r.partner_amount_cents / r.amount_cents) * 100) : 0;
  const sub = t("liquidar.row.sub", { date: fmtDiaCorto(r.date), amount: fmtMoney(r.amount_cents), pct });
  const confirming = confirmId === r.id;
  return `
    <div class="tx-row" style="padding:10px 0;">
      <div class="dotico" style="--cat:${color};">${icon}</div>
      <div class="tx-body">
        <div class="tx-title">${escHtml(title)}</div>
        <div class="tx-sub">${escHtml(sub)}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
        <div class="num" style="font-size:14px;font-weight:700;">${fmtMoney(r.partner_amount_cents)}</div>
        <button type="button" data-settle="${r.id}" style="${confirming ? BTN_SETTLE_CONFIRM : BTN_SETTLE}">
          ${confirming ? t("liquidar.row.confirm") : t("common.settle")}
        </button>
      </div>
    </div>`;
}

/** Pantalla "Liquidar": lista de gastos compartidos pendientes (de todos los periodos) con
 *  selector de cuenta de destino arriba y confirmación en dos toques por fila. onBack vuelve
 *  a Inicio (que se re-renderiza entero, igual que renderRegistro/onDone en main.js).
 *
 *  El selector de cuenta va ANTES de la lista (no al pie, como en el artboard): settleShared exige
 *  accountId en cada toque (ver wire() más abajo), así que el usuario necesita poder elegir cuenta
 *  antes de poder liquidar ninguna fila — el artboard es una foto fija sin ese flujo interactivo.
 *
 *  NO se replica la nota "Se crea una devolución enlazada..." de docs/design/material-expresivo/Liquidar.dc.html:68-71: es
 *  copy nuevo, no hay ningún texto equivalente ya en esta pantalla (grep `devoluci|refund|enlazad`
 *  sobre app/js/screens/*.js y repo.js: solo comentarios internos, ningún string de UI) — brecha
 *  documentada, no fabricada (regla explícita del brief). */
export async function renderLiquidar(container, onBack) {
  let rows, accountsAll, byId, meta;
  try {
    [rows, accountsAll, byId, meta] = await Promise.all([
      pendingShared(), listAccounts(), allCategoriesById(), getMetaAll(),
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
    confirmId: null,
    busy: false,
  };
  let errorMsg = "";

  function render() {
    const total = state.rows.reduce((s, r) => s + r.partner_amount_cents, 0);

    container.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;">
        <button type="button" class="icon-btn" id="liq-back" aria-label="${t("common.goBack")}" style="width:44px;height:44px;border-radius:50%;background:var(--card);color:var(--text);font-size:18px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"></path></svg></button>
        <h1 style="font-size:19px; font-weight:700; letter-spacing:-0.01em;">${partnerName ? t("liquidar.title.withPartner", { name: escHtml(partnerName) }) : t("common.settle")}</h1>
        <span style="width:44px;"></span>
      </div>

      <div class="card" style="display:flex;flex-direction:column;gap:4px;margin-bottom:18px;">
        <div class="section-title">${t("liquidar.total.title")}</div>
        <div class="amount-hero num text-red">${moneyPartsHtml(total)}</div>
      </div>

      ${accounts.length ? `
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">${t("common.destAccount")}</div>
        <div class="chips">
          ${accounts.map((a) => `<button type="button" class="chip${state.accountId === a.id ? " active" : ""}" style="padding:0 14px;" data-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
        </div>
      </div>` : ""}

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      ${state.rows.length === 0
        ? `<div class="card" style="text-align:center;color:var(--text-3)"><p>${t("liquidar.empty")}</p></div>`
        : `<div style="display:flex;flex-direction:column;gap:8px;">
            <div class="section-title">${t("liquidar.pending.title")}</div>
            <div class="card" style="padding:6px 16px;display:flex;flex-direction:column;">
              ${state.rows.map((r) => rowHtml(r, byId, state.confirmId)).join('<hr class="divider">')}
            </div>
          </div>`}
    `;
    wire();
  }

  function wire() {
    container.querySelector("#liq-back").onclick = () => onBack();

    container.querySelectorAll("[data-acc]").forEach((b) => {
      b.onclick = () => { state.accountId = b.dataset.acc; render(); };
    });

    container.querySelectorAll("[data-settle]").forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.settle;
        if (!state.accountId) {
          errorMsg = t("common.needAccount");
          state.confirmId = null;
          render();
          return;
        }
        if (state.confirmId !== id) {
          state.confirmId = id;
          errorMsg = "";
          render();
          return;
        }
        if (state.busy) return;
        state.busy = true;
        b.disabled = true;
        try {
          await settleShared(id, state.accountId);
          state.rows = await pendingShared();
          state.confirmId = null;
          errorMsg = "";
        } catch (e) {
          errorMsg = t("liquidar.error.settle", { error: e.message });
          state.confirmId = null;
        } finally {
          state.busy = false;
          render();
        }
      };
    });
  }

  render();
}
