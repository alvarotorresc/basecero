import {
  addTransaction, getOpenPeriod, listExpenseLeafCategories, listIncomeCategories,
  listAccounts, allCategoriesById,
} from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtEUR, hoyISO } from "../format.js";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "back"];
const ICON_BACK = `<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 5.5H9.2L3.5 12l5.7 6.5H20a1 1 0 001-1v-11a1 1 0 00-1-1z"></path><path d="M12.5 9.5l5 5M17.5 9.5l-5 5"></path></svg>`;

const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Monta la pantalla completa de registro rápido de un movimiento.
 *  onDone() se llama tanto al cerrar (✕) como tras guardar con éxito. */
export async function renderRegistro(container, onDone) {
  let period, expenseCats, incomeCats, accountsAll, byId;
  try {
    [period, expenseCats, incomeCats, accountsAll, byId] = await Promise.all([
      getOpenPeriod(),
      listExpenseLeafCategories(),
      listIncomeCategories(),
      listAccounts(),
      allCategoriesById(),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">No se pudo cargar la pantalla de registro: ${escHtml(e.message)}</div>`;
    return;
  }

  const accounts = accountsAll.filter((a) => a.type !== "liability");
  const pct = period?.my_share_pct ?? 100;

  const state = {
    tipo: "expense",
    raw: "",
    cents: 0,
    categoryId: null,
    accountId: "acc-n26",
    isShared: false,
    fecha: hoyISO(),
    merchant: "",
    note: "",
  };
  let errorMsg = "";

  const categoriesFor = () => (state.tipo === "expense" ? expenseCats : incomeCats);

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
        <button type="button" data-tipo="expense" class="${state.tipo === "expense" ? "active" : ""}">Gasto</button>
        <button type="button" data-tipo="income" class="${state.tipo === "income" ? "active" : ""}">Ingreso</button>
      </div>

      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px;">
        <div class="section-title">Importe</div>
        <div class="amount-display">
          <span class="num">${escHtml(state.raw || "0")}</span>
          <span class="amount-currency">€</span>
        </div>
        <hr class="divider" style="margin-top:6px;">
      </div>

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
      </div>

      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">Cuenta</div>
        <div class="chips">
          ${accounts.map((a) => `<button type="button" class="chip${state.accountId === a.id ? " active" : ""}" data-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
        </div>
      </div>

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
            <div class="num" style="font-size:15px; font-weight:600;">${fmtEUR(myCents)}</div>
          </div>
          <div style="flex:1; background:#1b1e21; border-radius:14px; padding:10px 11px;">
            <div style="font-size:10px; color:var(--text-3);">Sara · ${100 - pct}%</div>
            <div class="num" style="font-size:15px; font-weight:600; color:var(--text-2);">${fmtEUR(saraCents)}</div>
          </div>
        </div>` : ""}
      </div>

      <div class="keypad" style="margin-bottom:18px;">
        ${KEYS.map((k) => k === "back"
          ? `<button type="button" class="key key-back" data-key="back" aria-label="Borrar">${ICON_BACK}</button>`
          : `<button type="button" class="key${k === "," ? " key-comma" : ""}" data-key="${k}">${k}</button>`
        ).join("")}
      </div>

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      <button type="button" class="btn-primary" id="reg-save">${state.tipo === "expense" ? "Guardar gasto" : "Guardar ingreso"}</button>
    `;

    if (prevChipsScroll) container.querySelector(".chips-scroll").scrollLeft = prevChipsScroll;

    wire();
  }

  function wire() {
    container.querySelector("#reg-close").onclick = () => onDone();

    container.querySelectorAll("[data-tipo]").forEach((b) => {
      b.onclick = () => {
        state.tipo = b.dataset.tipo;
        state.categoryId = null;
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
        render();
      };
    });

    container.querySelector("#reg-merchant").oninput = (e) => { state.merchant = e.target.value; };
    container.querySelector("#reg-note").oninput = (e) => { state.note = e.target.value; };
    container.querySelector("#reg-fecha").onchange = (e) => { state.fecha = e.target.value || hoyISO(); };

    container.querySelector("#reg-shared").onchange = (e) => {
      state.isShared = e.target.checked;
      render();
    };

    container.querySelector("#reg-save").onclick = async () => {
      const btn = container.querySelector("#reg-save");
      if (state.cents <= 0 || !state.categoryId) {
        errorMsg = !state.categoryId && state.cents <= 0
          ? "Introduce un importe y elige una categoría."
          : state.cents <= 0
            ? "Introduce un importe."
            : "Elige una categoría.";
        render();
        const savedBtn = container.querySelector("#reg-save");
        savedBtn.classList.add("shake");
        setTimeout(() => savedBtn.classList.remove("shake"), 400);
        return;
      }
      btn.disabled = true;
      try {
        await addTransaction({
          type: state.tipo,
          amountCents: state.cents,
          date: state.fecha,
          categoryId: state.categoryId,
          accountId: state.accountId,
          merchant: state.merchant,
          note: state.note,
          isShared: state.isShared,
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
