import { pendingShared, listAccounts, allCategoriesById, settleShared, getMetaAll } from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtMoney, fmtDiaCorto } from "../format.js";
import { resolveAccountId } from "../account-defaults.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

const BTN_SETTLE = "height:34px;padding:0 12px;border-radius:10px;background:transparent;"
  + "color:var(--text-2);border:1px solid var(--border);font:600 12px var(--font-ui);cursor:pointer;"
  + "-webkit-tap-highlight-color:transparent;white-space:nowrap;";
const BTN_SETTLE_CONFIRM = "height:34px;padding:0 12px;border-radius:10px;background:var(--accent);"
  + "color:#fff;border:1px solid var(--accent);font:600 12px var(--font-ui);cursor:pointer;"
  + "-webkit-tap-highlight-color:transparent;white-space:nowrap;";

function rowHtml(r, byId, confirmId) {
  const cat = byId[r.category_id];
  const catName = cat?.name ?? "";
  const color = colorForCategory(r.category_id, byId);
  const icon = iconForCategory(r.category_id, byId);
  const title = r.merchant || catName || "Gasto";
  const confirming = confirmId === r.id;
  return `
    <div class="card" style="display:flex;align-items:center;gap:12px;padding:14px;">
      <div class="tx-icon" style="--cat:${color};">${icon}</div>
      <div class="tx-body">
        <div class="tx-title">${escHtml(title)}</div>
        <div class="tx-sub">${escHtml(catName)} · ${fmtDiaCorto(r.date)}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
        <div class="num" style="font-size:14px;font-weight:600;">${fmtMoney(r.sara_amount_cents)}</div>
        <button type="button" data-settle="${r.id}" style="${confirming ? BTN_SETTLE_CONFIRM : BTN_SETTLE}">
          ${confirming ? "Sí, liquidar" : "Liquidar"}
        </button>
      </div>
    </div>`;
}

/** Pantalla "Liquidar": lista de gastos compartidos pendientes (de todos los periodos) con
 *  selector de cuenta de destino arriba y confirmación en dos toques por fila. onBack vuelve
 *  a Inicio (que se re-renderiza entero, igual que renderRegistro/onDone en main.js). */
export async function renderLiquidar(container, onBack) {
  let rows, accountsAll, byId, meta;
  try {
    [rows, accountsAll, byId, meta] = await Promise.all([
      pendingShared(), listAccounts(), allCategoriesById(), getMetaAll(),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">No se pudo cargar Liquidar: ${escHtml(e.message)}</div>`;
    return;
  }
  const accounts = accountsAll.filter((a) => a.type !== "liability");

  const state = {
    rows,
    accountId: resolveAccountId(meta.default_account_id, accounts) ?? "",
    confirmId: null,
    busy: false,
  };
  let errorMsg = "";

  function render() {
    const total = state.rows.reduce((s, r) => s + r.sara_amount_cents, 0);

    container.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;">
        <button type="button" class="icon-btn" id="liq-back" aria-label="Volver">←</button>
        <h1 style="font-size:19px; font-weight:700; letter-spacing:-0.01em;">Liquidar con Sara</h1>
        <span style="width:36px;"></span>
      </div>

      ${accounts.length ? `
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">Cuenta destino</div>
        <div class="chips">
          ${accounts.map((a) => `<button type="button" class="chip${state.accountId === a.id ? " active" : ""}" data-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
        </div>
      </div>` : ""}

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      ${state.rows.length === 0
        ? `<div class="card" style="text-align:center;color:var(--text-3)"><p>No queda nada pendiente de liquidar.</p></div>`
        : `<div style="display:flex; flex-direction:column; gap:10px; margin-bottom:14px;">
            ${state.rows.map((r) => rowHtml(r, byId, state.confirmId)).join("")}
          </div>
          <div style="display:flex; align-items:baseline; justify-content:space-between; padding:0 4px;">
            <div class="section-title">Total pendiente</div>
            <div class="num text-red" style="font-size:15px; font-weight:600;">${fmtMoney(total)}</div>
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
          errorMsg = "No se pudo liquidar: " + e.message;
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
