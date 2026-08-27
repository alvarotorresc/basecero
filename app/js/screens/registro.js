import {
  addTransaction, getOpenPeriod, listExpenseLeafCategories, listIncomeCategories,
  listAccounts, allCategoriesById, recentForRefund, getMetaAll,
} from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtMoney, hoyISO, currencySymbol } from "../format.js";
import { resolveAccountId } from "../account-defaults.js";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "back"];
const ICON_BACK = `<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 5.5H9.2L3.5 12l5.7 6.5H20a1 1 0 001-1v-11a1 1 0 00-1-1z"></path><path d="M12.5 9.5l5 5M17.5 9.5l-5 5"></path></svg>`;

const TIPOS = [
  { id: "expense", label: "Gasto" },
  { id: "income", label: "Ingreso" },
  { id: "transfer", label: "Transfer." },
  { id: "refund", label: "Devolución" },
  { id: "adjustment", label: "Ajuste" },
];
const SAVE_LABEL = {
  expense: "Guardar gasto", income: "Guardar ingreso", transfer: "Guardar transferencia",
  refund: "Guardar devolución", adjustment: "Guardar ajuste",
};
const needsCategory = (tipo) => tipo === "expense" || tipo === "income" || tipo === "refund";

const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const centsToRaw = (cents) => (cents ? (Math.abs(cents) / 100).toFixed(2).replace(".", ",") : "");

/** Monta la pantalla completa de registro rápido de un movimiento (5 tipos).
 *  onDone() se llama tanto al cerrar (✕) como tras guardar con éxito.
 *  prefill opcional (Task 11): {type, amountCents, categoryId, accountId, merchant, ruleId, isShared}. */
export async function renderRegistro(container, onDone, prefill) {
  let period, expenseCats, incomeCats, accountsAll, byId, meta;
  try {
    [period, expenseCats, incomeCats, accountsAll, byId, meta] = await Promise.all([
      getOpenPeriod(),
      listExpenseLeafCategories(),
      listIncomeCategories(),
      listAccounts(),
      allCategoriesById(),
      getMetaAll(),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">No se pudo cargar la pantalla de registro: ${escHtml(e.message)}</div>`;
    return;
  }

  let refundCandidates = [];
  if (period) {
    try { refundCandidates = await recentForRefund(period.id); } catch { refundCandidates = []; }
  }

  const accounts = accountsAll.filter((a) => a.type !== "liability");
  const pct = period?.my_share_pct ?? 100;

  const state = {
    tipo: prefill?.type ?? "expense",
    raw: centsToRaw(prefill?.amountCents),
    cents: prefill?.amountCents ?? 0,
    categoryId: prefill?.categoryId ?? null,
    accountId: prefill?.accountId ?? resolveAccountId(meta.default_account_id, accounts) ?? "",
    counterAccountId: "",
    isShared: prefill?.isShared ?? false,
    fecha: hoyISO(),
    merchant: prefill?.merchant ?? "",
    note: "",
    refId: "",
    ruleId: prefill?.ruleId ?? "",
    adjustmentSign: "+",
    refundPickerOpen: false,
  };
  let errorMsg = "";

  const categoriesFor = () => {
    if (state.tipo === "income") return incomeCats;
    if (needsCategory(state.tipo)) return expenseCats;
    return [];
  };

  function setRaw(next) {
    state.raw = next;
    state.cents = Math.round(parseFloat((state.raw || "0").replace(",", ".")) * 100) || 0;
    errorMsg = "";
    render();
  }

  function pressKey(k) {
    if (k === "back") { setRaw(state.raw.slice(0, -1)); return; }
    if (k === ",") {
      if (state.raw.includes(",")) return;
      setRaw((state.raw || "0") + ",");
      return;
    }
    const [, dec] = state.raw.split(",");
    if (dec && dec.length >= 2) return; // coma: máx. 2 decimales
    // evita ceros a la izquierda sin sentido ("05") cuando aún no hay coma
    setRaw(state.raw === "0" ? k : state.raw + k);
  }

  function selectRefundRow(row) {
    state.refId = row.id;
    state.categoryId = row.category_id;
    if (row.is_shared) {
      // Solo precarga categoría + importe de la parte de Sara; el refund de
      // liquidación en sí NO se marca compartido (mismo criterio que Task 7
      // settleShared: is_shared=0, ya es el 100% de lo que Sara debe).
      // Usa el pct EFECTIVO del gasto enlazado (su propio override, o el pct
      // de SU periodo), no el del periodo abierto: el gasto puede venir de un
      // periodo cerrado con reparto distinto o llevar su propio override.
      const rowPct = row.share_pct_override ?? row.period_pct ?? 100;
      const myPart = Math.round((row.amount_cents * rowPct) / 100);
      const saraPart = row.amount_cents - myPart;
      state.raw = centsToRaw(saraPart);
      state.cents = saraPart;
    }
    state.refundPickerOpen = false;
    errorMsg = "";
    render();
  }

  function clearRefundLink() {
    state.refId = "";
    render();
  }

  function validationError() {
    if (state.tipo === "transfer") {
      if (state.cents <= 0) return "Introduce un importe.";
      if (!state.counterAccountId || state.counterAccountId === state.accountId)
        return "Elige dos cuentas distintas (origen y destino).";
      return "";
    }
    if (state.tipo === "adjustment") return state.cents <= 0 ? "Introduce un importe." : "";
    // expense / income / refund
    if (state.cents <= 0 && !state.categoryId) return "Introduce un importe y elige una categoría.";
    if (state.cents <= 0) return "Introduce un importe.";
    if (!state.categoryId) return "Elige una categoría.";
    return "";
  }

  function renderRefundPicker() {
    const linked = state.refId ? refundCandidates.find((r) => r.id === state.refId) : null;
    if (linked) {
      const label = linked.merchant || byId[linked.category_id]?.name || "Gasto";
      return `
      <div class="card" style="padding:12px 14px; margin-bottom:18px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div style="min-width:0;">
          <div style="font-size:10px; color:var(--text-3);">Vinculado a</div>
          <div style="font-size:14px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${escHtml(label)} · ${fmtMoney(linked.amount_cents)}
          </div>
        </div>
        <button type="button" id="reg-refund-unlink" class="icon-btn" aria-label="Quitar vínculo">✕</button>
      </div>`;
    }
    return `
    <div style="margin-bottom:18px;">
      <button type="button" id="reg-refund-toggle" class="refund-toggle">¿Devuelve un gasto? ${state.refundPickerOpen ? "▲" : "▼"}</button>
      ${state.refundPickerOpen ? `
      <div class="card refund-list" style="padding:4px 14px; margin-top:8px;">
        ${refundCandidates.length === 0
          ? `<div style="padding:14px 0; font-size:13px; color:var(--text-3);">No hay gastos recientes.</div>`
          : refundCandidates.map((r) => `
            <button type="button" class="refund-row" data-refund-row="${escAttr(r.id)}">
              <span style="flex:1; min-width:0; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                ${escHtml(r.merchant || byId[r.category_id]?.name || "Gasto")}${r.is_shared ? " · compartido" : ""}
              </span>
              <span class="num">${fmtMoney(r.amount_cents)}</span>
            </button>`).join("")}
      </div>` : ""}
    </div>`;
  }

  function renderAccountsSection() {
    if (state.tipo === "transfer") {
      return `
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">Desde</div>
        <div class="chips">
          ${accounts.map((a) => `<button type="button" class="chip${state.accountId === a.id ? " active" : ""}" data-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">Hacia</div>
        <div class="chips">
          ${accountsAll.filter((a) => a.id !== state.accountId).map((a) => `<button type="button" class="chip${state.counterAccountId === a.id ? " active" : ""}" data-counter-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
        </div>
      </div>`;
    }
    return `
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
      <div class="section-title">${state.tipo === "refund" ? "Cuenta destino" : "Cuenta"}</div>
      <div class="chips">
        ${accounts.map((a) => `<button type="button" class="chip${state.accountId === a.id ? " active" : ""}" data-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
      </div>
    </div>`;
  }

  function render() {
    const cats = categoriesFor();
    const myCents = state.isShared ? Math.round((state.cents * pct) / 100) : state.cents;
    const saraCents = state.isShared ? state.cents - myCents : 0;

    const prevChipsScroll = container.querySelector(".chips-scroll")?.scrollLeft;

    container.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;">
        <h1 style="font-size:19px; font-weight:700; letter-spacing:-0.01em;">Registrar</h1>
        <button type="button" class="icon-btn" id="reg-close" aria-label="Cerrar">✕</button>
      </div>

      <div class="segmented" style="margin-bottom:18px;">
        ${TIPOS.map((t) => `<button type="button" data-tipo="${t.id}" class="${state.tipo === t.id ? "active" : ""}">${t.label}</button>`).join("")}
      </div>

      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px;">
        <div class="section-title">Importe</div>
        <div class="amount-display" style="align-items:center;">
          ${state.tipo === "adjustment" ? `<button type="button" class="icon-btn" id="reg-sign" aria-label="Cambiar signo" style="font-size:18px; font-weight:700;">${state.adjustmentSign}</button>` : ""}
          <span class="num">${state.tipo === "adjustment" && state.adjustmentSign === "-" ? "−" : ""}${escHtml(state.raw || "0")}</span>
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
            const active = state.categoryId === c.id;
            return `<button type="button" class="chip-v${active ? " active" : ""}" data-cat="${c.id}" style="--cat:${color};">
              <span class="chip-icon">${icon}</span><span>${escHtml(c.name)}</span>
            </button>`;
          }).join("")}
        </div>
      </div>` : ""}

      ${renderAccountsSection()}

      ${state.tipo === "refund" ? renderRefundPicker() : ""}

      <div style="display:flex; gap:8px; margin-bottom:12px;">
        <label class="field field-stack" style="flex:1;">
          <span class="field-label">Comercio</span>
          <input type="text" id="reg-merchant" value="${escAttr(state.merchant)}" placeholder="Opcional">
        </label>
        <label class="field field-stack" style="flex:1;">
          <span class="field-label">Fecha</span>
          <input type="date" id="reg-fecha" value="${state.fecha}">
        </label>
      </div>
      <label class="field field-stack" style="margin-bottom:18px;">
        <span class="field-label">Nota</span>
        <input type="text" id="reg-note" value="${escAttr(state.note)}" placeholder="Opcional">
      </label>

      ${needsCategory(state.tipo) ? `
      <div class="card" style="padding:0 16px; margin-bottom:18px;">
        <label style="height:56px; display:flex; align-items:center; justify-content:space-between; gap:12px; cursor:pointer;">
          <span style="font-size:15px; font-weight:600;">Compartido con Sara</span>
          <span class="toggle">
            <input type="checkbox" id="reg-shared" ${state.isShared ? "checked" : ""}>
            <span class="toggle-track"><span class="toggle-knob"></span></span>
          </span>
        </label>
        ${state.isShared ? `
        <div style="display:flex; gap:8px; padding:0 0 14px;">
          <div style="flex:1; background:#1b1e21; border-radius:14px; padding:10px 11px;">
            <div style="font-size:10px; color:var(--text-3);">Tu parte · ${pct}%</div>
            <div class="num" style="font-size:15px; font-weight:600;">${fmtMoney(myCents)}</div>
          </div>
          <div style="flex:1; background:#1b1e21; border-radius:14px; padding:10px 11px;">
            <div style="font-size:10px; color:var(--text-3);">Sara · ${100 - pct}%</div>
            <div class="num" style="font-size:15px; font-weight:600; color:var(--text-2);">${fmtMoney(saraCents)}</div>
          </div>
        </div>` : ""}
      </div>` : ""}

      <div class="keypad" style="margin-bottom:18px;">
        ${KEYS.map((k) => k === "back"
          ? `<button type="button" class="key key-back" data-key="back" aria-label="Borrar">${ICON_BACK}</button>`
          : `<button type="button" class="key${k === "," ? " key-comma" : ""}" data-key="${k}">${k}</button>`
        ).join("")}
      </div>

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      <button type="button" class="btn-primary" id="reg-save">${SAVE_LABEL[state.tipo]}</button>
    `;

    if (prevChipsScroll != null) {
      const chipsEl = container.querySelector(".chips-scroll");
      if (chipsEl) chipsEl.scrollLeft = prevChipsScroll;
    }

    wire();
  }

  function wire() {
    container.querySelector("#reg-close").onclick = () => onDone();

    container.querySelectorAll("[data-tipo]").forEach((b) => {
      b.onclick = () => {
        state.tipo = b.dataset.tipo;
        state.categoryId = null;
        state.refId = "";
        state.refundPickerOpen = false;
        state.counterAccountId = "";
        errorMsg = "";
        render();
      };
    });

    container.querySelectorAll("[data-key]").forEach((b) => {
      b.onclick = () => pressKey(b.dataset.key);
    });

    container.querySelectorAll("[data-cat]").forEach((b) => {
      b.onclick = () => {
        state.categoryId = b.dataset.cat;
        errorMsg = "";
        render();
      };
    });

    container.querySelectorAll("[data-acc]").forEach((b) => {
      b.onclick = () => {
        state.accountId = b.dataset.acc;
        if (state.counterAccountId === state.accountId) state.counterAccountId = "";
        render();
      };
    });

    container.querySelectorAll("[data-counter-acc]").forEach((b) => {
      b.onclick = () => {
        state.counterAccountId = b.dataset.counterAcc;
        render();
      };
    });

    const signBtn = container.querySelector("#reg-sign");
    if (signBtn) signBtn.onclick = () => {
      state.adjustmentSign = state.adjustmentSign === "+" ? "-" : "+";
      render();
    };

    const refundToggle = container.querySelector("#reg-refund-toggle");
    if (refundToggle) refundToggle.onclick = () => {
      state.refundPickerOpen = !state.refundPickerOpen;
      render();
    };

    container.querySelectorAll("[data-refund-row]").forEach((b) => {
      b.onclick = () => {
        const row = refundCandidates.find((r) => r.id === b.dataset.refundRow);
        if (row) selectRefundRow(row);
      };
    });

    const unlinkBtn = container.querySelector("#reg-refund-unlink");
    if (unlinkBtn) unlinkBtn.onclick = () => clearRefundLink();

    container.querySelector("#reg-merchant").oninput = (e) => { state.merchant = e.target.value; };
    container.querySelector("#reg-note").oninput = (e) => { state.note = e.target.value; };
    container.querySelector("#reg-fecha").onchange = (e) => { state.fecha = e.target.value || hoyISO(); };

    const sharedToggle = container.querySelector("#reg-shared");
    if (sharedToggle) sharedToggle.onchange = (e) => {
      state.isShared = e.target.checked;
      render();
    };

    container.querySelector("#reg-save").onclick = async () => {
      const btn = container.querySelector("#reg-save");
      const msg = validationError();
      if (msg) {
        errorMsg = msg;
        render();
        const savedBtn = container.querySelector("#reg-save");
        savedBtn.classList.add("shake");
        setTimeout(() => savedBtn.classList.remove("shake"), 400);
        return;
      }
      btn.disabled = true;
      try {
        const withCategory = needsCategory(state.tipo);
        await addTransaction({
          type: state.tipo,
          amountCents: state.tipo === "adjustment" && state.adjustmentSign === "-" ? -state.cents : state.cents,
          date: state.fecha,
          categoryId: withCategory ? state.categoryId : "",
          accountId: state.accountId,
          counterAccountId: state.tipo === "transfer" ? state.counterAccountId : "",
          merchant: state.merchant,
          note: state.note,
          isShared: withCategory ? state.isShared : false,
          refId: state.tipo === "refund" ? state.refId : "",
          ruleId: state.ruleId,
        });
        onDone();
      } catch (e) {
        btn.disabled = false;
        errorMsg = "No se pudo guardar: " + e.message;
        render();
      }
    };
  }

  render();
}
