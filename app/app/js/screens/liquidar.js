import { pendingSettlements, listAccounts, allCategoriesById, settleAllShared, getMetaAll } from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtMoney, moneyPartsHtml, fmtDiaCorto } from "../format.js";
import { resolveAccountId } from "../account-defaults.js";
import { t } from "../i18n/index.js";
import { userMessage } from "../errors.js";
import { metaHtml, subHeaderHtml } from "../ui.js";
import { icon } from "../icons.js";
import { netOfSelected } from "../share-pct.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** Fila de gasto pendiente: casilla + `.dotico.sm` (36px) + nombre + sub (fecha · importe
 *  original · % de quien debe esa parte: el de la contraparte en las filas 'partner_owes', el
 *  MÍO en las 'i_owe') — réplica de Liquidar.dc.html:50-92 (fila de 60px, sin envoltorio de
 *  tarjeta propio: la lista completa comparte una única `.card` con `<hr class="divider">` entre
 *  filas, mismo criterio que gasto-por-categoria.js/patrimonio.js#cuentasCardHtml). La fila NO
 *  lleva botón propio de liquidar — el artboard solo tiene el botón de liquidación al pie (armado
 *  inline en render(), más abajo); lo que SÍ lleva es la casilla de selección (§4.8bis), que
 *  decide si la fila entra en el neto y en la liquidación de ese botón.
 *
 *  El % es DERIVADO de r.settle_cents/r.amount_cents (ambos vienen en la fila de
 *  pendingSettlements, sql.js) — no un campo nuevo. Se deriva aquí en vez de leer el pct del
 *  periodo abierto porque settle_cents ya viene calculado con el pct EFECTIVO del propio gasto
 *  (puede tener override o venir de un periodo cerrado), así que recalcularlo desde ese mismo par
 *  de importes es más fiel que cualquier otra fuente disponible. Como settle_cents es «lo que la
 *  contraparte me debe» en 'partner_owes' y «lo que le debo yo» en 'i_owe', el MISMO cociente da el
 *  pct de ella en un caso y el mío en el otro: por eso la clave del tercer segmento del sub se
 *  elige por dirección (liquidar.row.theirPct / .myPct).
 *  Sustituye al sub anterior (categoría · fecha): el nombre de categoría ya no se repite aquí
 *  porque el título ya lo usa como fallback (`r.merchant || catName`) y el artboard no lo lleva en
 *  el sub de ninguna fila.
 *
 *  `selected` es el `state.selected` (Set de ids) de renderLiquidar: decide si la casilla sale
 *  marcada. La fila entera sigue sin ser un botón — solo la casilla lo es — así que `wire()`
 *  cablea `[data-select]`, no la fila. */
function rowHtml(r, byId, selected) {
  const cat = byId[r.category_id];
  const catName = cat?.name ?? "";
  const color = colorForCategory(r.category_id, byId);
  const catIcon = iconForCategory(r.category_id, byId);
  const title = r.merchant || catName || t("common.type.expense");
  const pct = r.amount_cents ? Math.round((r.settle_cents / r.amount_cents) * 100) : 0;
  const pctKey = r.direction === "i_owe" ? "liquidar.row.myPct" : "liquidar.row.theirPct";
  const sub = metaHtml([
    t("common.dateValue", { date: fmtDiaCorto(r.date) }),
    t("common.amountValue", { amount: fmtMoney(r.amount_cents) }),
    t(pctKey, { pct }),
  ]);
  const checked = selected.has(r.id);
  return `
    <div class="tx-row" style="padding:12px 0;">
      <button type="button" class="check-box" role="checkbox" aria-checked="${checked}"
        aria-label="${escAttr(t("liquidar.select.aria", { merchant: title }))}"
        data-select="${escAttr(r.id)}">${icon("check", { size: 16, width: 2.6 })}</button>
      <div class="dotico sm" style="--cat:${color};">${catIcon}</div>
      <div class="tx-body">
        <div class="tx-title">${escHtml(title)}</div>
        ${sub}
      </div>
      <div class="num" style="font-size:14px;font-weight:700;flex-shrink:0;">${fmtMoney(r.settle_cents)}</div>
    </div>`;
}

/** Pantalla "Liquidar": dos secciones de gastos compartidos pendientes (de todos los periodos)
 *  —lo que me debe y lo que le debo— con el NETO de lo SELECCIONADO en el hero; un solo botón al
 *  pie liquida las filas marcadas, con selector de cuenta arriba y confirmación en dos toques.
 *  onBack vuelve a Inicio (que se re-renderiza entero, igual que renderRegistro/onDone en main.js).
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
 *  UN solo botón al pie («Cobrar…»/«Pagar…»/«Liquidar, queda a cero» según el signo del neto
 *  SELECCIONADO, o el aviso liquidar.select.none si no hay ninguna fila marcada) liquida las
 *  filas de `state.selected` (por defecto, todas — decisión 3) con la cuenta elegida —
 *  repo.settleAllShared hace el execMany atómico (o se liquidan todas las elegidas, o ninguna).
 *  Los botones por fila no existen (ver rowHtml): el artboard solo tiene el botón del pie, y con
 *  la operación en bloque disponible sobre un subconjunto elegible por casilla, un botón que
 *  liquidara una única fila sería un segundo camino que el artboard no contempla — más simple
 *  mantener solo el que el diseño pide. */
export async function renderLiquidar(container, onBack) {
  let rows, accountsAll, byId, meta;
  try {
    [rows, accountsAll, byId, meta] = await Promise.all([
      pendingSettlements(), listAccounts(), allCategoriesById(), getMetaAll(),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">${t("liquidar.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }
  const accounts = accountsAll.filter((a) => a.type !== "liability");
  const partnerName = (meta.partner_name || "").trim();

  const state = {
    rows,
    // Todas marcadas por defecto (decisión 3): «liquidar todo» sigue siendo el resultado si
    // nadie toca ninguna casilla — netOfSelected(rows, selected) con selected === todos los ids
    // da el mismo neto que la suma de siempre (spec §4, test de share-pct.test.mjs). Se
    // reinicializa igual tras cada recarga de pendingSettlements() (ver wire()).
    selected: new Set(rows.map((r) => r.id)),
    accountId: resolveAccountId(meta.default_account_id, accounts) ?? "",
    confirm: false,
    busy: false,
  };
  let errorMsg = "";

  function render() {
    // Neto de lo SELECCIONADO (share-pct.js#netOfSelected, Task 3.0), no de todo state.rows: es
    // el único cambio de comportamiento de la PR. Con todo marcado (el estado por defecto) da
    // exactamente la misma suma que antes: 'i_owe' resta, 'partner_owes' suma.
    const net = netOfSelected(state.rows, state.selected);
    const name = partnerName || t("movimientos.shared.fallbackName");
    const theyOwe = state.rows.filter((r) => r.direction === "partner_owes");
    const iOwe = state.rows.filter((r) => r.direction === "i_owe");
    const netClass = net > 0 ? " text-green" : net < 0 ? " text-red" : "";
    const netColor = net > 0 ? "var(--pos)" : net < 0 ? "var(--danger)" : "var(--ink-3)";
    const netLabel = net > 0
      ? t("common.settlement.theyOwe", { name: escHtml(name) })
      : net < 0
        ? t("common.settlement.youOwe", { name: escHtml(name) })
        : t("common.settlement.even");
    // Sin ninguna fila marcada no hay nada que liquidar: el botón se deshabilita con un aviso
    // propio en vez de dejar pulsar «Liquidar, queda a cero» (que es el label del neto 0 CON
    // filas seleccionadas, un caso distinto: cobros y pagos elegidos que se cancelan entre sí).
    const nothingSelected = state.selected.size === 0;
    const footerLabel = nothingSelected
      ? t("liquidar.select.none")
      : net > 0
        ? (state.confirm ? t("liquidar.footer.collectConfirm", { amount: fmtMoney(net) })
                         : t("liquidar.footer.collect", { amount: fmtMoney(net), name: escHtml(name) }))
        : net < 0
          ? (state.confirm ? t("liquidar.footer.payConfirm", { amount: fmtMoney(-net) })
                           : t("liquidar.footer.pay", { amount: fmtMoney(-net), name: escHtml(name) }))
          : (state.confirm ? t("liquidar.footer.evenConfirm") : t("liquidar.footer.even"));
    // Sin el padding:6px 16px que llevaba el .card: con el bloque a sangre, las filas quedan a
    // ras del margen de pantalla (22px), como en Liquidar.dc.html.
    const sectionHtml = (titleText, rows) => rows.length === 0 ? "" : `
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px;">
        <div class="section-title">${titleText}</div>
        <div class="card" style="display:flex;flex-direction:column;">
          ${rows.map((r) => rowHtml(r, byId, state.selected)).join('<hr class="divider">')}
        </div>
      </div>`;

    container.innerHTML = `
      ${subHeaderHtml({ id: "liq-back", title: partnerName ? t("liquidar.title.withPartner", { name: partnerName }) : t("common.settle") })}

      <div class="card" style="display:flex;flex-direction:column;gap:6px;margin-bottom:18px;">
        <div class="section-title">${t("liquidar.net.title")}</div>
        <div class="amount-hero lg${netClass}">${moneyPartsHtml(Math.abs(net))}</div>
        <div style="font: var(--t-section); color: ${netColor};">${netLabel}</div>
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
          <button type="button" class="btn-primary" id="liq-settle-all" ${state.busy || nothingSelected ? "disabled" : ""}>
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

    // Casilla de selección por fila (§4.8bis): cambiar la selección invalida la confirmación en
    // curso, igual que cambiar de cuenta — el importe que el segundo toque va a confirmar ya no
    // sería el que ve el usuario.
    container.querySelectorAll("[data-select]").forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.select;
        if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
        state.confirm = false;
        render();
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
          return;
        }
        if (state.busy) return;
        state.busy = true;
        settleBtn.disabled = true;
        try {
          await settleAllShared([...state.selected], state.accountId);
          state.rows = await pendingSettlements();
          // Recarga → todo vuelve a marcarse (decisión 3): son gastos pendientes nuevos, ninguno
          // heredado del Set anterior seguiría siendo válido de todas formas.
          state.selected = new Set(state.rows.map((r) => r.id));
          state.confirm = false;
          errorMsg = "";
        } catch (e) {
          errorMsg = t("liquidar.error.settle", { error: userMessage(e) });
          state.confirm = false;
          // La recarga va en su PROPIO try: si settleAllShared falló porque la base no responde,
          // pendingSettlements() falla igual, y sin este guard el manejador de errores lanzaría
          // desde dentro del catch — la promesa del onclick quedaría rechazada sin nadie que la
          // escuche y el error compuesto arriba no llegaría a servir de nada. Si no se puede
          // releer, las filas se quedan como estaban: el mensaje de arriba ya explica qué pasó.
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
