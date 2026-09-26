import { pendingSettlements, listAccounts, allCategoriesById, settleAllShared, getMetaAll, getAccountStyle, listGoals } from "../repo.js";
import { familyForAccount } from "../account-colors.js";
import { familyForCategory, iconForCategory } from "../category-colors.js";
import { fmtMoney, fmtDiaCorto } from "../format.js";
import { resolveAccountId } from "../account-defaults.js";
import { t } from "../i18n/index.js";
import { userMessage } from "../errors.js";
import { subHeaderHtml } from "../ui.js";
import { segmentedHtml, wireSegmented, checkboxHtml } from "../controls.js";
import { tileHtml } from "../entity.js";
import { displayHtml, dispInkHtml, emptyStateHtml } from "../instrument.js";
import { netOfSelected } from "../share-pct.js";
import { escHtml } from "../esc.js";

// Pantalla «Liquidar», sistema B (B-Liquidar / BD-Liquidar): Display l con el neto de lo
// seleccionado y su pie «A tu favor / En contra», Segmented «Entra en» con las cuentas, las filas
// pendientes con su casilla en tinta (F-05) en un solo contenedor, y el primario al pie. Todo el
// color y la forma viven en la sección «liquidar» de css/screens.css.

const MINUS = "−"; // «−» tipográfico, el mismo ancho que «+» en la mono tabular.

/** % de quien debe cada fila, DERIVADO de settle_cents/amount_cents (los dos vienen de
 *  pendingSettlements, sql.js): settle_cents ya se calculó con el % efectivo del propio gasto
 *  (override o periodo cerrado), así que el cociente es más fiel que cualquier otra fuente. En
 *  'partner_owes' es el % de la contraparte; en 'i_owe', el mío. `theirPct` lo lleva siempre al de
 *  la contraparte, para poder comparar filas de las dos direcciones. */
const rowPct = (r) => (r.amount_cents ? Math.round((r.settle_cents / r.amount_cents) * 100) : 0);
const theirPct = (r) => (r.direction === "i_owe" ? 100 - rowPct(r) : rowPct(r));

/** El reparto común de todas las filas (su % en todas), o null si varía: con uno común va en el
 *  subtítulo de la cabecera (B-Liquidar «Gastos a medias, 50 %»); si no, cada fila lleva el suyo. */
function commonTheirPct(rows) {
  if (!rows.length) return null;
  const first = theirPct(rows[0]);
  return rows.every((r) => theirPct(r) === first) ? first : null;
}

/** Fila pendiente (B-Liquidar): casilla de 44 (§9) · baldosa 40 de la familia de la categoría ·
 *  nombre 15/600 y línea 2 12/500 dim · lo que se liquida, mono 15/600 en tinta, con «−» si le
 *  debo yo. La fila no es un botón: solo lo es la casilla, que decide si entra en el neto. */
function rowHtml(r, { byId, selected, partner, common }) {
  const catName = byId[r.category_id]?.name ?? "";
  const title = r.merchant || catName || t("common.type.expense");
  const date = fmtDiaCorto(r.date);
  let line2 = r.direction === "i_owe"
    ? t("liquidar.row.paidBy", { date, name: partner, amount: fmtMoney(r.amount_cents) })
    : t("liquidar.row.of", { date, amount: fmtMoney(r.amount_cents) });
  if (common == null) {
    line2 += `, ${t(r.direction === "i_owe" ? "liquidar.row.myPct" : "liquidar.row.theirPct", { pct: rowPct(r) })}`;
  }
  const checked = selected.has(r.id);
  return `<div class="liq-row">
    ${checkboxHtml({ id: `liq-sel-${r.id}`, checked, label: t("liquidar.select.aria", { merchant: title }) })}
    ${tileHtml({ fam: familyForCategory(r.category_id, byId), icon: iconForCategory(r.category_id, byId) })}
    <span class="ent-body"><span class="ent-name">${escHtml(title)}</span><span class="ent-line2">${escHtml(line2)}</span></span>
    <span class="num liq-amount">${r.direction === "i_owe" ? MINUS : ""}${escHtml(fmtMoney(r.settle_cents))}</span>
  </div>`;
}

/** Pantalla "Liquidar": los gastos compartidos pendientes (de todos los periodos) —lo que me
 *  debe y lo que le debo— con el NETO de lo SELECCIONADO en el Display; un solo primario al pie
 *  liquida las filas marcadas contra la cuenta elegida, con confirmación en dos toques.
 *  repo.settleAllShared hace el execMany atómico (o se liquidan todas las elegidas, o ninguna).
 *  onBack vuelve a Inicio (que se re-renderiza entero). */
export async function renderLiquidar(container, onBack) {
  let rows, accountsAll, byId, meta, accountStyle, goals;
  try {
    [rows, accountsAll, byId, meta, accountStyle, goals] = await Promise.all([
      pendingSettlements(), listAccounts(), allCategoriesById(), getMetaAll(), getAccountStyle(), listGoals(),
    ]);
  } catch (e) {
    container.innerHTML = `
      ${subHeaderHtml({ id: "liq-back", title: t("common.settle") })}
      <div class="liq"><div class="banner-aviso is-error">${escHtml(t("liquidar.error.load", { error: userMessage(e) }))}</div></div>`;
    container.querySelector("#liq-back").onclick = () => onBack();
    return;
  }
  const accounts = accountsAll.filter((a) => a.type !== "liability");
  const partnerName = (meta.partner_name || "").trim();

  const state = {
    rows,
    // Todas marcadas por defecto (decisión 3): «liquidar todo» sigue siendo el resultado si nadie
    // toca ninguna casilla. Se reinicializa igual tras cada recarga de pendingSettlements().
    selected: new Set(rows.map((r) => r.id)),
    accountId: resolveAccountId(meta.default_account_id, accounts) ?? "",
    confirm: false,
    busy: false,
  };
  let errorMsg = "";

  function render() {
    // Neto de lo SELECCIONADO (share-pct.js#netOfSelected): 'i_owe' resta, 'partner_owes' suma.
    const net = netOfSelected(state.rows, state.selected);
    const name = partnerName || t("movimientos.shared.fallbackName");
    const theyOwe = state.rows.filter((r) => r.direction === "partner_owes");
    const iOwe = state.rows.filter((r) => r.direction === "i_owe");
    const sumSel = (list) => list.filter((r) => state.selected.has(r.id)).reduce((s, r) => s + r.settle_cents, 0);
    const favor = sumSel(theyOwe);
    const against = sumSel(iOwe);
    const common = commonTheirPct(state.rows);
    const subtitle = common == null ? ""
      : common === 50 ? t("liquidar.sub.half", { pct: common }) : t("liquidar.sub.split", { pct: common });
    const title = partnerName ? t("liquidar.title.withPartner", { name: partnerName }) : t("common.settle");

    if (state.rows.length === 0) {
      container.innerHTML = `
        ${subHeaderHtml({ id: "liq-back", title })}
        <div class="liq">
          ${errorMsg ? `<div class="banner-aviso is-error">${escHtml(errorMsg)}</div>` : ""}
          ${emptyStateHtml({ title: t("liquidar.empty") })}
        </div>`;
      wire();
      return;
    }

    const netLabel = net > 0 ? t("common.settlement.theyOwe", { name })
      : net < 0 ? t("common.settlement.youOwe", { name })
      : t("common.settlement.even");
    const split = `<div class="liq-split">
      <span>${escHtml(t("liquidar.balance.favor"))} ${dispInkHtml(fmtMoney(favor))}</span>
      <span>${escHtml(t("liquidar.balance.against"))} ${dispInkHtml(fmtMoney(against))}</span>
    </div>`;

    // Sin ninguna fila marcada no hay nada que liquidar: el primario se deshabilita con su propio
    // texto (distinto de «Liquidar, queda a cero», que es el neto 0 CON filas elegidas).
    const nothingSelected = state.selected.size === 0;
    const amount = fmtMoney(Math.abs(net));
    const [label, withAmount] = nothingSelected ? [t("liquidar.select.none"), false]
      : net > 0 ? [t(state.confirm ? "liquidar.footer.collectConfirm" : "liquidar.footer.collect"), true]
      : net < 0 ? [t(state.confirm ? "liquidar.footer.payConfirm" : "liquidar.footer.pay"), true]
      : [t(state.confirm ? "liquidar.footer.evenConfirm" : "liquidar.footer.even"), false];

    const section = (key, list, total, negative) => (list.length === 0 ? "" : `
      <div class="liq-group">
        <h2 class="liq-group-title">${escHtml(t(key))}</h2>
        <span class="num liq-group-total">${negative && total > 0 ? MINUS : ""}${escHtml(fmtMoney(total))}</span>
      </div>
      ${list.map((r) => rowHtml(r, { byId, selected: state.selected, partner: name, common })).join('<div class="liq-sep"></div>')}`);

    container.innerHTML = `
      ${subHeaderHtml({ id: "liq-back", title, subtitle })}
      <div class="liq">
        ${displayHtml({ label: netLabel, value: fmtMoney(Math.abs(net)), slot: split })}

        ${accounts.length ? `
        <div class="liq-account">
          <span class="liq-account-label" id="liq-account-label">${escHtml(t(net < 0 ? "liquidar.account.out" : "liquidar.account.in"))}</span>
          ${segmentedHtml({
            id: "liq-accounts", name: t(net < 0 ? "liquidar.account.out" : "liquidar.account.in"), labelledBy: "liq-account-label",
            options: accounts.map((a) => ({ value: a.id, label: a.name, fam: familyForAccount(a, accountStyle, goals) })), value: state.accountId,
          })}
        </div>` : ""}

        ${errorMsg ? `<div class="banner-aviso is-error">${escHtml(errorMsg)}</div>` : ""}

        <section class="liq-list">
          ${section("liquidar.balance.favor", theyOwe, favor, false)}
          ${section("liquidar.balance.against", iOwe, against, true)}
        </section>

        <button type="button" class="btn-primary liq-primary" id="liq-settle-all"${state.busy || nothingSelected ? " disabled" : ""}>
          <span>${escHtml(label)}</span>${withAmount ? ` <span class="num">${escHtml(amount)}</span>` : ""}
        </button>
      </div>`;
    wire();
  }

  function wire() {
    container.querySelector("#liq-back").onclick = () => onBack();

    // Sin cuenta elegida (o si la elegida ya no existe), el Segmented marca la primera: se alinea
    // el estado con lo que se ve, como hacían los chips con resolveAccountId.
    const seg = container.querySelector("#liq-accounts");
    if (seg) {
      const shown = seg.querySelector('[aria-checked="true"]')?.dataset.value;
      if (shown && shown !== state.accountId) state.accountId = shown;
      wireSegmented(seg, (value) => {
        state.accountId = value;
        // Cambiar de cuenta invalida la confirmación en curso: el segundo toque confirmaría algo
        // distinto de lo que se ve.
        if (state.confirm) { state.confirm = false; render(); container.querySelector(`#liq-accounts [aria-checked="true"]`)?.focus(); }
      });
    }

    // Casilla por fila (§9): cambiar la selección invalida la confirmación en curso, igual que
    // cambiar de cuenta.
    container.querySelectorAll('.liq-row .ctl-checkbox').forEach((b) => {
      b.onclick = () => {
        const id = b.id.slice("liq-sel-".length);
        if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
        state.confirm = false;
        render();
        container.querySelector(`[id="liq-sel-${CSS.escape(id)}"]`)?.focus();
      };
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
          container.querySelector("#liq-settle-all")?.focus();
          return;
        }
        if (state.busy) return;
        state.busy = true;
        settleBtn.disabled = true;
        try {
          await settleAllShared([...state.selected], state.accountId);
          state.rows = await pendingSettlements();
          state.selected = new Set(state.rows.map((r) => r.id));
          state.confirm = false;
          errorMsg = "";
        } catch (e) {
          errorMsg = t("liquidar.error.settle", { error: userMessage(e) });
          state.confirm = false;
          // La recarga va en su PROPIO try: si settleAllShared falló porque la base no responde,
          // pendingSettlements() falla igual; sin este guard el catch lanzaría y el mensaje de
          // arriba no llegaría a verse. Si no se puede releer, las filas se quedan como estaban.
          try {
            state.rows = await pendingSettlements();
            state.selected = new Set(state.rows.map((r) => r.id));
          } catch { /* se conserva state.rows (y state.selected, a juego) */ }
        } finally {
          state.busy = false;
          render();
        }
      };
    }
  }

  render();
}
