import {
  listPeriods, listAllByDay, getTransaction, updateTransaction, softDeleteTransaction, countUncategorized,
  listExpenseLeafCategories, listIncomeCategories, listAccounts, allCategoriesById, hasActiveLinkedRefund,
  getMetaAll,
} from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtMoney, fmtDiaLargo, hoyISO, currencySymbol } from "../format.js";

const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const centsToRaw = (cents) => (cents ? (Math.abs(cents) / 100).toFixed(2).replace(".", ",") : "");
const needsCategory = (tipo) => tipo === "expense" || tipo === "income" || tipo === "refund";

const TIPO_LABEL = {
  expense: "Gasto", income: "Ingreso", transfer: "Transferencia", refund: "Devolución", adjustment: "Ajuste",
};

/** Agrupa las filas de listAllByDay (ya vienen ordenadas por date DESC) en bloques por día,
 *  preservando el orden de llegada (mismo patrón que inicio.js). */
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

// SVG del icono de transferencia — no existe ningún SVG de transferencia ya integrado en la app
// (recurrentes.js/inicio.js usan el emoji "⇄" como icono de sustitución); se copia tal cual del
// artboard de referencia (design/material-expresivo/Movimientos.dc.html:64-67), no se inventa.
// El color va en `style="stroke:..."` (no en el atributo de presentación `stroke="var(...)"`,
// que ningún otro SVG de la app usa con un custom property — ACCOUNT_ICON de patrimonio.js usa
// hex literal, ICON_BACK de registro.js usa currentColor) para no depender de que el motor de
// render resuelva var() dentro de un atributo de presentación SVG.
const ICON_TRANSFER = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="stroke:var(--text-2);" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10l-3 3 3 3M4 13h13M17 8l3-3-3-3M20 5H7"></path></svg>`;
// Icono "+" del dotico punteado de una fila sin categorizar (artboard Movimientos.dc.html:46-48).
const ICON_UNCAT = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" style="stroke:var(--text-2);" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>`;

function movRowHtml(r, byId, accById) {
  if (r.type === "transfer") {
    const from = accById[r.account_id]?.name ?? "?";
    const to = accById[r.counter_account_id]?.name ?? "?";
    return `
    <button type="button" class="tx-row" data-tx="${r.id}" style="width:100%;text-align:left;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;">
      <div class="dotico" style="--cat:var(--card2);">${ICON_TRANSFER}</div>
      <div class="tx-body">
        <div class="tx-title">${escHtml(from)} → ${escHtml(to)}</div>
        <div class="tx-sub">${escHtml(r.merchant || r.note || "Transferencia")}</div>
      </div>
      <div class="tx-amount num">${fmtMoney(r.amount_cents)}</div>
    </button>`;
  }
  if (r.type === "adjustment") {
    const isNeg = r.amount_cents < 0;
    return `
    <button type="button" class="tx-row" data-tx="${r.id}" style="width:100%;text-align:left;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;">
      <div class="dotico" style="--cat:var(--card2);">⚖️</div>
      <div class="tx-body">
        <div class="tx-title">Ajuste</div>
        <div class="tx-sub">${escHtml(r.merchant || r.note || "")}</div>
      </div>
      <div class="tx-amount num ${isNeg ? "negative" : "positive"}">${isNeg ? "-" : "+"}${fmtMoney(Math.abs(r.amount_cents))}</div>
    </button>`;
  }
  const cat = byId[r.category_id];
  const catName = cat?.name ?? "";
  const uncategorized = isUncategorized(r);
  const color = uncategorized ? "var(--card2)" : colorForCategory(r.category_id, byId);
  const icon = uncategorized ? ICON_UNCAT : iconForCategory(r.category_id, byId);
  const dashedStyle = uncategorized ? "border:1.5px dashed var(--rule);" : "";
  const title = r.merchant || catName || "Sin categorizar";
  const subBase = uncategorized ? "toca para categorizar" : (catName || "Sin categorizar");
  const shareSuffix = r.is_shared ? ` · tu parte ${fmtMoney(r.my_amount_cents)}` : "";
  const isExpense = r.type === "expense";
  const amountClass = isExpense ? "negative" : "positive";
  const sign = isExpense ? "-" : "+";
  return `
  <button type="button" class="tx-row" data-tx="${r.id}" style="width:100%;text-align:left;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;">
    <div class="dotico" style="--cat:${color};${dashedStyle}">${icon}</div>
    <div class="tx-body">
      <div class="tx-title">${escHtml(title)}</div>
      <div class="tx-sub" style="${uncategorized ? "color:var(--amber);" : ""}">${escHtml(subBase)}${escHtml(shareSuffix)}</div>
    </div>
    <div class="tx-amount num ${amountClass}">${sign}${fmtMoney(r.amount_cents)}</div>
  </button>`;
}

const isUncategorized = (r) => r.category_id === "" && (r.type === "expense" || r.type === "income" || r.type === "refund");

/** Pantalla Movimientos: selector de periodo, bandeja de sin-categorizar y lista agrupada por día
 *  (los 5 tipos), con subvista de detalle para editar/borrar cada movimiento. */
export async function renderMovimientos(container) {
  let periods, expenseCats, incomeCats, accountsAll, byId, meta;
  try {
    [periods, expenseCats, incomeCats, accountsAll, byId, meta] = await Promise.all([
      listPeriods(), listExpenseLeafCategories(), listIncomeCategories(), listAccounts(), allCategoriesById(),
      getMetaAll(),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">No se pudo cargar Movimientos: ${escHtml(e.message)}</div>`;
    return;
  }
  if (periods.length === 0) {
    container.innerHTML = `<header class="screen-header"><h1 style="font-size:24px;font-weight:800;letter-spacing:-0.02em;">Movimientos</h1></header>
      <div class="banner-aviso red">No hay ningún periodo todavía.</div>`;
    return;
  }
  const accById = Object.fromEntries(accountsAll.map((a) => [a.id, a]));
  const partnerName = (meta.partner_name || "").trim();

  const state = {
    view: "list",
    periodId: periods.find((p) => p.status === "open")?.id ?? periods[0].id,
    rows: [],
    uncategorizedCount: 0,
    filterUncat: false,
    detailId: null,
    detail: null,
    deleteConfirm: false,
  };
  let errorMsg = "";

  async function loadPeriodData() {
    [state.rows, state.uncategorizedCount] = await Promise.all([
      listAllByDay(state.periodId), countUncategorized(state.periodId),
    ]);
    // sin esto, categorizar/borrar el último movimiento sin categorizar con el filtro activo
    // deja la lista vacía sin forma de volver: el chip desaparece (count=0) pero el filtro seguía activo.
    if (state.uncategorizedCount === 0) state.filterUncat = false;
  }

  function categoriesFor(tipo) {
    if (tipo === "income") return incomeCats;
    if (needsCategory(tipo)) return expenseCats;
    return [];
  }

  function updateDetail(patch) {
    Object.assign(state.detail, patch);
    state.deleteConfirm = false;
    render();
  }

  async function openDetail(id) {
    let row;
    try {
      row = await getTransaction(id);
    } catch (e) {
      errorMsg = "No se pudo abrir el movimiento: " + e.message;
      render();
      return;
    }
    if (!row) return;
    state.detailId = id;
    state.deleteConfirm = false;
    state.detail = {
      type: row.type,
      raw: centsToRaw(row.amount_cents),
      cents: Math.abs(row.amount_cents),
      sign: row.amount_cents < 0 ? "-" : "+",
      categoryId: row.category_id || null,
      accountId: row.account_id,
      counterAccountId: row.counter_account_id,
      isShared: !!row.is_shared,
      // Fija en apertura si el movimiento YA era compartido, distinto del isShared vivo que cambia
      // con el toggle: gatea la visibilidad del bloque compartido para que no desaparezca al desmarcar
      // sin contraparte configurada, dejando al usuario sin forma de volver a marcarlo antes de guardar.
      wasShared: !!row.is_shared,
      sharePctOverride: row.share_pct_override,
      fecha: row.date,
      merchant: row.merchant,
      note: row.note,
      refId: row.ref_id,
      ruleId: row.rule_id,
    };
    state.linkedRefund = null;
    if (row.type === "refund" && row.ref_id) {
      try { state.linkedRefund = await getTransaction(row.ref_id); } catch { state.linkedRefund = null; }
    }
    // Task 17 ronda 2 (controller ruling, finding A): un gasto ya liquidado con la contraparte (settled=1
    // Y con un refund activo enlazado) bloquea importe/compartido — editar el importe aquí sin
    // tocar el refund deja la deuda con la contraparte mal calculada y sin nada pendiente que lo delate.
    state.detail.settledLocked = row.type === "expense" && !!row.settled
      && (await hasActiveLinkedRefund(id).catch(() => false));
    state.view = "detail";
    errorMsg = "";
    render();
  }

  function backToList() {
    state.view = "list";
    state.detailId = null;
    state.detail = null;
    errorMsg = "";
    render();
  }

  function validationError() {
    const d = state.detail;
    if (d.type === "transfer") {
      if (d.cents <= 0) return "Introduce un importe.";
      if (!d.counterAccountId || d.counterAccountId === d.accountId) return "Elige dos cuentas distintas (origen y destino).";
      return "";
    }
    if (d.type === "adjustment") return d.cents <= 0 ? "Introduce un importe." : "";
    if (d.cents <= 0 && !d.categoryId) return "Introduce un importe y elige una categoría.";
    if (d.cents <= 0) return "Introduce un importe.";
    if (!d.categoryId) return "Elige una categoría.";
    return "";
  }

  function renderAccountsSection(d) {
    const accounts = accountsAll.filter((a) => a.type !== "liability");
    if (d.type === "transfer") {
      return `
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">Desde</div>
        <div class="chips">
          ${accounts.map((a) => `<button type="button" class="chip${d.accountId === a.id ? " active" : ""}" data-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">Hacia</div>
        <div class="chips">
          ${accountsAll.filter((a) => a.id !== d.accountId).map((a) => `<button type="button" class="chip${d.counterAccountId === a.id ? " active" : ""}" data-counter-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
        </div>
      </div>`;
    }
    return `
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
      <div class="section-title">${d.type === "refund" ? "Cuenta destino" : "Cuenta"}</div>
      <div class="chips">
        ${accounts.map((a) => `<button type="button" class="chip${d.accountId === a.id ? " active" : ""}" data-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
      </div>
    </div>`;
  }

  function renderDetail() {
    const d = state.detail;
    const period = periods.find((p) => p.id === state.periodId);
    const pct = period?.my_share_pct ?? 100;
    const cats = categoriesFor(d.type);
    const myCents = d.isShared ? Math.round((d.cents * pct) / 100) : d.cents;
    const partnerCents = d.isShared ? d.cents - myCents : 0;
    const locked = !!d.settledLocked;

    const prevChipsScroll = container.querySelector(".chips-scroll")?.scrollLeft;

    container.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;">
        <button type="button" class="icon-btn" id="mov-back" aria-label="Volver">←</button>
        <h1 style="font-size:19px; font-weight:700; letter-spacing:-0.01em;">${TIPO_LABEL[d.type]}</h1>
        <span style="width:36px;"></span>
      </div>

      ${locked ? `
      <div class="banner-aviso" style="margin-bottom:18px;">
        <p>Liquidado. Para editar el importe, borra antes su liquidación en Movimientos.</p>
      </div>` : ""}

      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px;">
        <div class="section-title">Importe</div>
        <div class="amount-display" style="align-items:center;">
          ${d.type === "adjustment" ? `<button type="button" class="icon-btn" id="mov-sign" aria-label="Cambiar signo" style="font-size:18px; font-weight:700;" ${locked ? "disabled" : ""}>${d.sign}</button>` : ""}
          <input type="text" inputmode="decimal" id="mov-raw" value="${escAttr(d.raw)}" placeholder="0" ${locked ? "disabled" : ""}
            style="border:0;background:none;color:var(--text);font:600 56px var(--font-num);letter-spacing:-0.02em;width:100%;outline:none;${locked ? "opacity:.5;" : ""}">
          <span class="amount-currency">${currencySymbol()}</span>
        </div>
        <hr class="divider" style="margin-top:6px;">
      </div>

      ${cats.length ? `
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">Categoría</div>
        <div class="chips-scroll">
          ${cats.map((c) => {
            const color = colorForCategory(c.id, byId);
            const icon = iconForCategory(c.id, byId);
            const active = d.categoryId === c.id;
            return `<button type="button" class="chip-v${active ? " active" : ""}" data-cat="${c.id}" style="--cat:${color};">
              <span class="chip-icon">${icon}</span><span>${escHtml(c.name)}</span>
            </button>`;
          }).join("")}
        </div>
      </div>` : ""}

      ${renderAccountsSection(d)}

      ${d.type === "refund" && state.linkedRefund ? `
      <div class="card" style="padding:12px 14px; margin-bottom:18px;">
        <div style="font-size:10px; color:var(--text-3);">Vinculado a</div>
        <div style="font-size:14px; font-weight:600;">
          ${escHtml(state.linkedRefund.merchant || byId[state.linkedRefund.category_id]?.name || "Gasto")} · ${fmtMoney(state.linkedRefund.amount_cents)}
        </div>
      </div>` : ""}

      <div style="display:flex; gap:8px; margin-bottom:12px;">
        <label class="field field-stack" style="flex:1;">
          <span class="field-label">Comercio</span>
          <input type="text" id="mov-merchant" value="${escAttr(d.merchant)}" placeholder="Opcional">
        </label>
        <label class="field field-stack" style="flex:1;">
          <span class="field-label">Fecha</span>
          <input type="date" id="mov-fecha" value="${d.fecha}">
        </label>
      </div>
      <label class="field field-stack" style="margin-bottom:18px;">
        <span class="field-label">Nota</span>
        <input type="text" id="mov-note" value="${escAttr(d.note)}" placeholder="Opcional">
      </label>

      ${needsCategory(d.type) && (d.wasShared || partnerName) ? `
      <div class="card" style="padding:0 16px; margin-bottom:18px;">
        <label style="height:56px; display:flex; align-items:center; justify-content:space-between; gap:12px; cursor:${locked ? "default" : "pointer"};${locked ? "opacity:.5;" : ""}">
          <span style="font-size:15px; font-weight:600;">Compartido con ${escHtml(partnerName) || "la contraparte"}</span>
          <span class="toggle">
            <input type="checkbox" id="mov-shared" ${d.isShared ? "checked" : ""} ${locked ? "disabled" : ""}>
            <span class="toggle-track"><span class="toggle-knob"></span></span>
          </span>
        </label>
        ${d.isShared ? `
        <div style="display:flex; gap:8px; padding:0 0 14px;">
          <div style="flex:1; background:var(--card2); border-radius:14px; padding:10px 11px;">
            <div style="font-size:10px; color:var(--text-3);">Tu parte · ${pct}%</div>
            <div class="num" id="mov-split-mine" style="font-size:15px; font-weight:600;">${fmtMoney(myCents)}</div>
          </div>
          <div style="flex:1; background:var(--card2); border-radius:14px; padding:10px 11px;">
            <div style="font-size:10px; color:var(--text-3);">${escHtml(partnerName) || "Contraparte"} · ${100 - pct}%</div>
            <div class="num" id="mov-split-partner" style="font-size:15px; font-weight:600; color:var(--text-2);">${fmtMoney(partnerCents)}</div>
          </div>
        </div>` : ""}
      </div>` : ""}

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      <button type="button" class="btn-primary" id="mov-save" style="margin-bottom:10px;">Guardar</button>
      <button type="button" id="mov-delete"
        style="width:100%;background:${state.deleteConfirm ? "var(--red)" : "transparent"};color:${state.deleteConfirm ? "#fff" : "var(--red)"};
          border:1px solid var(--red);border-radius:var(--radius-sm);padding:16px;font:600 16px var(--font-ui);cursor:pointer;">
        ${state.deleteConfirm ? "Sí, borrar" : "Borrar"}
      </button>
    `;

    if (prevChipsScroll != null) {
      const chipsEl = container.querySelector(".chips-scroll");
      if (chipsEl) chipsEl.scrollLeft = prevChipsScroll;
    }

    wireDetail();
  }

  function wireDetail() {
    const d = state.detail;
    container.querySelector("#mov-back").onclick = () => backToList();

    container.querySelectorAll("[data-cat]").forEach((b) => {
      b.onclick = () => updateDetail({ categoryId: b.dataset.cat });
    });
    container.querySelectorAll("[data-acc]").forEach((b) => {
      b.onclick = () => updateDetail({
        accountId: b.dataset.acc,
        counterAccountId: d.counterAccountId === b.dataset.acc ? "" : d.counterAccountId,
      });
    });
    container.querySelectorAll("[data-counter-acc]").forEach((b) => {
      b.onclick = () => updateDetail({ counterAccountId: b.dataset.counterAcc });
    });

    const signBtn = container.querySelector("#mov-sign");
    if (signBtn) signBtn.onclick = () => updateDetail({ sign: d.sign === "+" ? "-" : "+" });

    container.querySelector("#mov-raw").oninput = (e) => {
      d.raw = e.target.value;
      d.cents = Math.round(parseFloat((d.raw || "0").replace(",", ".")) * 100) || 0;
      errorMsg = "";
      state.deleteConfirm = false;
      // No se llama a render() aquí (perdería el foco/cursor del input mientras se escribe), pero
      // el preview "Tu parte / contraparte" de un gasto compartido se queda con el importe viejo si no se
      // actualiza a mano — parche puntual de los dos nodos en vez de un re-render completo.
      const mineEl = container.querySelector("#mov-split-mine");
      const partnerEl = container.querySelector("#mov-split-partner");
      if (d.isShared && mineEl && partnerEl) {
        const period = periods.find((p) => p.id === state.periodId);
        const pct = period?.my_share_pct ?? 100;
        const myCents = Math.round((d.cents * pct) / 100);
        mineEl.textContent = fmtMoney(myCents);
        partnerEl.textContent = fmtMoney(d.cents - myCents);
      }
    };
    container.querySelector("#mov-merchant").oninput = (e) => { d.merchant = e.target.value; state.deleteConfirm = false; };
    container.querySelector("#mov-note").oninput = (e) => { d.note = e.target.value; state.deleteConfirm = false; };
    container.querySelector("#mov-fecha").onchange = (e) => updateDetail({ fecha: e.target.value || hoyISO() });

    const sharedToggle = container.querySelector("#mov-shared");
    if (sharedToggle) sharedToggle.onchange = (e) => updateDetail({ isShared: e.target.checked });

    container.querySelector("#mov-save").onclick = async () => {
      const btn = container.querySelector("#mov-save");
      const msg = validationError();
      if (msg) {
        errorMsg = msg;
        render();
        const savedBtn = container.querySelector("#mov-save");
        savedBtn.classList.add("shake");
        setTimeout(() => savedBtn.classList.remove("shake"), 400);
        return;
      }
      btn.disabled = true;
      try {
        const withCategory = needsCategory(d.type);
        await updateTransaction(state.detailId, {
          type: d.type,
          amountCents: d.type === "adjustment" && d.sign === "-" ? -d.cents : d.cents,
          date: d.fecha,
          categoryId: withCategory ? d.categoryId : "",
          accountId: d.accountId,
          counterAccountId: d.type === "transfer" ? d.counterAccountId : "",
          merchant: d.merchant,
          note: d.note,
          isShared: withCategory ? d.isShared : false,
          sharePctOverride: d.sharePctOverride,
          refId: d.refId,
          ruleId: d.ruleId,
        });
        await loadPeriodData();
        backToList();
      } catch (e) {
        btn.disabled = false;
        errorMsg = "No se pudo guardar: " + e.message;
        render();
      }
    };

    container.querySelector("#mov-delete").onclick = async () => {
      if (!state.deleteConfirm) {
        state.deleteConfirm = true;
        render();
        return;
      }
      const btn = container.querySelector("#mov-delete");
      btn.disabled = true;
      try {
        await softDeleteTransaction(state.detailId);
        await loadPeriodData();
        backToList();
      } catch (e) {
        btn.disabled = false;
        errorMsg = "No se pudo borrar: " + e.message;
        state.deleteConfirm = false;
        render();
      }
    };
  }

  function renderList() {
    const hoy = hoyISO();
    const visible = state.filterUncat ? state.rows.filter(isUncategorized) : state.rows;

    const movimientosHtml = visible.length === 0
      ? `<div class="card" style="text-align:center;color:var(--text-3)">
          <p>${state.filterUncat ? "No hay movimientos sin categorizar." : "No hay movimientos en este periodo."}</p></div>`
      : `<div class="card" style="display:flex;flex-direction:column;gap:16px;">
          <div style="display:flex;flex-direction:column;gap:12px;">
            ${groupByDay(visible).map((g) => `
              <div class="day-label">${g.date === hoy ? "Hoy" : fmtDiaLargo(g.date)}</div>
              ${g.rows.map((r) => movRowHtml(r, byId, accById)).join("")}
            `).join("")}
          </div>
        </div>`;

    // Chip de filtro (artboard Movimientos.dc.html:35): activo = tinta invertida (.chip.active del
    // sistema); inactivo = borde discontinuo --rule, mismo criterio que la chip "Sin categoría · N"
    // del artboard (padding simétrico porque, a diferencia de .chip-icon, esta chip no lleva icono).
    const chipStyle = state.filterUncat
      ? "padding:0 14px;"
      : "padding:0 14px;background:transparent;border:1px dashed var(--rule);";

    container.innerHTML = `
      <header class="screen-header"><h1 style="font-size:24px;font-weight:800;letter-spacing:-0.02em;">Movimientos</h1></header>

      <label class="field field-stack" style="margin-bottom:14px;">
        <span class="field-label">Periodo</span>
        <select id="mov-period">
          ${periods.map((p) => `<option value="${p.id}" ${p.id === state.periodId ? "selected" : ""}>${escHtml(p.name)}</option>`).join("")}
        </select>
      </label>

      ${state.uncategorizedCount > 0 ? `
      <div style="margin-bottom:14px;">
        <button type="button" id="mov-chip-uncat" class="chip${state.filterUncat ? " active" : ""}" style="${chipStyle}">
          Sin categoría · ${state.uncategorizedCount}
        </button>
      </div>` : ""}

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      ${movimientosHtml}
    `;
    wireList();
  }

  function wireList() {
    container.querySelector("#mov-period").onchange = async (e) => {
      state.periodId = e.target.value;
      state.filterUncat = false;
      try {
        await loadPeriodData();
      } catch (err) {
        errorMsg = "No se pudo cargar el periodo: " + err.message;
      }
      render();
    };

    const chip = container.querySelector("#mov-chip-uncat");
    if (chip) chip.onclick = () => {
      state.filterUncat = !state.filterUncat;
      render();
    };

    container.querySelectorAll("[data-tx]").forEach((b) => {
      b.onclick = () => openDetail(b.dataset.tx);
    });
  }

  function render() {
    if (state.view === "detail") renderDetail();
    else renderList();
  }

  try {
    await loadPeriodData();
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">No se pudo cargar Movimientos: ${escHtml(e.message)}</div>`;
    return;
  }
  render();
}
