import {
  addTransaction, getOpenPeriod, listExpenseLeafCategories, listIncomeCategories,
  listAccounts, allCategoriesById, recentForRefund, getMetaAll,
} from "../repo.js";
import { colorForCategory, iconForCategory, textColorForCategory } from "../category-colors.js";
import { fmtMoney, fmtMoneyParts, hoyISO, currencySymbol, parseCentsRaw, centsToRaw } from "../format.js";
import { foldPending } from "../expr.js";
import { resolveAccountId } from "../account-defaults.js";
import { t } from "../i18n/index.js";

// Layout de calculadora (Task 3, ver Registro.dc.html): 4 columnas, operadores en la última
// columna (÷ × −) más "+" al final de la fila de borrar — SIN tecla "=" (calculadora de cinta
// izquierda-a-derecha, ver expr.js). OPS es el contrato exacto de expr.js: los símbolos Unicode
// que renderiza el teclado son literalmente los que viajan en state.op y llegan a evalExpr/
// foldPending, sin capa de traducción intermedia (− U+2212, × U+00D7, ÷ U+00F7, no sus alias ASCII).
const KEYS = ["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "−", ",", "0", "back", "+"];
const OPS = new Set(["+", "−", "×", "÷"]);
const ICON_BACK = `<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 5.5H9.2L3.5 12l5.7 6.5H20a1 1 0 001-1v-11a1 1 0 00-1-1z"></path><path d="M12.5 9.5l5 5M17.5 9.5l-5 5"></path></svg>`;

// labelKey/SAVE_KEY en vez de texto resuelto: son consts de módulo, evaluadas al importar el
// fichero (antes de que boot() llame a initI18n con el idioma real) — si guardaran el string ya
// traducido, quedarían congeladas en español para siempre. Se resuelven con t() en cada render.
const TIPOS = [
  { id: "expense", labelKey: "common.type.expense" },
  { id: "income", labelKey: "common.type.income" },
  { id: "transfer", labelKey: "registro.type.transfer" },
  { id: "refund", labelKey: "common.type.refund" },
  { id: "adjustment", labelKey: "common.type.adjustment" },
];
const SAVE_KEY = {
  expense: "registro.save.expense", income: "registro.save.income", transfer: "registro.save.transfer",
  refund: "registro.save.refund", adjustment: "registro.save.adjustment",
};
const needsCategory = (tipo) => tipo === "expense" || tipo === "income" || tipo === "refund";

const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Compone el importe grande cuando hay un resultado CALCULADO que mostrar (state.op != null,
// Task 3) — mismo patrón .amount-hero que inicio.js/patrimonio.js/presupuesto.js/
// periodo-nuevo.js/liquidar.js: main + <small>céntimos</small> + sufijo (incluye el símbolo de
// moneda ya bien colocado por locale — prefijo o sufijo, ver fmtMoneyParts en format.js), sin
// reimplementar el locale a mano.
const moneyPartsHtml = (cents) => {
  const { main, cents: c, suffix } = fmtMoneyParts(cents);
  return `${escHtml(main)}<small>${escHtml(c)}</small>${escHtml(suffix)}`;
};

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
    container.innerHTML = `<div class="banner-aviso red">${t("registro.error.load", { error: escHtml(e.message) })}</div>`;
    return;
  }

  let refundCandidates = [];
  if (period) {
    try { refundCandidates = await recentForRefund(period.id); } catch { refundCandidates = []; }
  }

  const accounts = accountsAll.filter((a) => a.type !== "liability");
  const pct = period?.my_share_pct ?? 100;
  const partnerName = (meta.partner_name || "").trim();

  const state = {
    tipo: prefill?.type ?? "expense",
    raw: centsToRaw(prefill?.amountCents),
    cents: prefill?.amountCents ?? 0,
    // Máquina incremental del teclado con operadores (Task 3): acc = lo ya confirmado (céntimos
    // o null si aún no se ha plegado nada), op = operador pendiente. Invariante mantenida por
    // TODO el código de esta pantalla: acc===null ⟺ op===null (se ponen a null juntos siempre:
    // aquí, en pressOp al deshacer con "back", y en selectRefundRow/el prefill de arriba — un
    // prefill o un refund es un importe plano, no arrastra expresión).
    acc: null,
    op: null,
    categoryId: prefill?.categoryId ?? null,
    accountId: prefill?.accountId ?? resolveAccountId(meta.default_account_id, accounts) ?? "",
    counterAccountId: "",
    isShared: partnerName ? (prefill?.isShared ?? false) : false,
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

  // Pliega state.raw (el operando que se está tecleando) dentro de state.acc según state.op —
  // wrapper de foldPending (expr.js) con parseCentsRaw ya aplicado y `raw !== ""` como señal de
  // "hay algo tecleado" (foldPending distingue "" de "0": ver su cabecera en expr.js). Es la
  // MISMA regla para el recálculo en vivo tras cada tecla (setRaw) y para el pliegue al pulsar/
  // cambiar de operador (pressOp) — así state.cents nunca diverge de lo que guardará
  // addTransaction, ni siquiera a mitad de tecleo. Con op===null (acc también null por la
  // invariante de arriba) esto es exactamente parseCentsRaw(raw): paridad con el comportamiento
  // de hoy en el camino "solo dígitos, sin operador".
  function computeRunning(acc, op, raw) {
    return foldPending(acc, op, parseCentsRaw(raw), raw !== "");
  }

  function setRaw(next) {
    state.raw = next;
    state.cents = computeRunning(state.acc, state.op, state.raw);
    errorMsg = "";
    render();
  }

  // Pulsar un operador PLIEGA el operando pendiente en el acumulador y deja el operador nuevo a
  // la espera del siguiente operando. Casos límite (decisión deliberada, no accidental):
  //  - operador como PRIMERA tecla (acc=null, raw=""): computeRunning/foldPending trata el
  //    acumulador como 0 — "+5" empieza en 0+5, nunca en NaN ni en error.
  //  - operador dos veces seguidas sin teclear nada entre medias (raw=""): foldPending devuelve
  //    el acc SIN TOCAR — el operador previo simplemente se REEMPLAZA por el nuevo, sin plegar
  //    un operando fantasma de 0 (que con ‘×’/‘÷’ pondría el importe a 0 o lo dejaría intacto de
  //    forma inconsistente según el operador — el mismo peligro que señaló el handoff de Task 2
  //    para el guardado, aquí generalizado al tecleo en caliente).
  function pressOp(k) {
    state.acc = computeRunning(state.acc, state.op, state.raw);
    state.op = k;
    state.raw = "";
    state.cents = state.acc;
    errorMsg = "";
    render();
  }

  function pressKey(k) {
    if (OPS.has(k)) { pressOp(k); return; }
    if (k === "back") {
      if (state.raw === "" && state.op != null) {
        // Borrar justo tras pulsar un operador, sin haber tecleado nada del siguiente operando:
        // este teclado no tiene tecla C/AC (ver Registro.dc.html), así que sin este caso el
        // operador quedaría atascado sin más forma de deshacerlo que cerrar la pantalla. Se
        // deshace el operador pendiente y se recupera como operando editable el importe de
        // antes — centsToRaw/parseCentsRaw ya hacen ese viaje de ida y vuelta en toda la app
        // (mismo patrón que selectRefundRow y el prefill de arriba).
        state.raw = centsToRaw(state.acc);
        state.acc = null;
        state.op = null;
        state.cents = computeRunning(state.acc, state.op, state.raw);
        errorMsg = "";
        render();
        return;
      }
      setRaw(state.raw.slice(0, -1));
      return;
    }
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
      // Solo precarga categoría + importe de la parte de la contraparte; el refund de
      // liquidación en sí NO se marca compartido (mismo criterio que Task 7
      // settleShared: is_shared=0, ya es el 100% de lo que la contraparte debe).
      // Usa el pct EFECTIVO del gasto enlazado (su propio override, o el pct
      // de SU periodo), no el del periodo abierto: el gasto puede venir de un
      // periodo cerrado con reparto distinto o llevar su propio override.
      const rowPct = row.share_pct_override ?? row.period_pct ?? 100;
      const myPart = Math.round((row.amount_cents * rowPct) / 100);
      const partnerPart = row.amount_cents - myPart;
      state.raw = centsToRaw(partnerPart);
      state.cents = partnerPart;
      // Un refund es un importe plano, no arrastra expresión (Task 3) — reset AQUÍ, junto a la
      // asignación de raw/cents, no al principio de la función: solo entramos a esta rama
      // cuando is_shared de verdad TOCA el importe. Enlazar una fila NO compartida no debe
      // tirar una operación en curso (acc/op) que el usuario ya estuviera tecleando.
      state.acc = null;
      state.op = null;
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
    if (!state.accountId) return t("common.needAccount");
    if (state.tipo === "transfer") {
      if (state.cents <= 0) return t("common.enterAmount");
      if (!state.counterAccountId || state.counterAccountId === state.accountId)
        return t("common.pickTwoAccounts");
      return "";
    }
    if (state.tipo === "adjustment") return state.cents <= 0 ? t("common.enterAmount") : "";
    // expense / income / refund
    if (state.cents <= 0 && !state.categoryId) return t("common.enterAmountAndCategory");
    if (state.cents <= 0) return t("common.enterAmount");
    if (!state.categoryId) return t("common.pickCategory");
    return "";
  }

  function renderRefundPicker() {
    const linked = state.refId ? refundCandidates.find((r) => r.id === state.refId) : null;
    if (linked) {
      const label = linked.merchant || byId[linked.category_id]?.name || t("common.type.expense");
      return `
      <div class="card" style="padding:12px 14px; margin-bottom:18px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div style="min-width:0;">
          <div style="font-size:10px; color:var(--text-3);">${t("common.linkedTo")}</div>
          <div style="font-size:14px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${escHtml(label)} · ${fmtMoney(linked.amount_cents)}
          </div>
        </div>
        <button type="button" id="reg-refund-unlink" class="icon-btn" aria-label="${t("registro.refund.unlink")}">✕</button>
      </div>`;
    }
    return `
    <div style="margin-bottom:18px;">
      <button type="button" id="reg-refund-toggle" class="refund-toggle">${t("registro.refund.toggle", { arrow: state.refundPickerOpen ? "▲" : "▼" })}</button>
      ${state.refundPickerOpen ? `
      <div class="card refund-list" style="padding:4px 14px; margin-top:8px;">
        ${refundCandidates.length === 0
          ? `<div style="padding:14px 0; font-size:13px; color:var(--text-3);">${t("registro.refund.empty")}</div>`
          : refundCandidates.map((r) => `
            <button type="button" class="refund-row" data-refund-row="${escAttr(r.id)}">
              <span style="flex:1; min-width:0; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                ${escHtml(r.merchant || byId[r.category_id]?.name || t("common.type.expense"))}${r.is_shared ? t("registro.refund.sharedSuffix") : ""}
              </span>
              <span class="num">${fmtMoney(r.amount_cents)}</span>
            </button>`).join("")}
      </div>` : ""}
    </div>`;
  }

  function renderAccountsSection() {
    if (state.tipo === "transfer") {
      return `
      <div class="card" style="border-radius:16px; display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">${t("common.from")}</div>
        <div class="chips">
          ${accounts.map((a) => `<button type="button" class="chip${state.accountId === a.id ? " active" : ""}" data-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
        </div>
      </div>
      <div class="card" style="border-radius:16px; display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">${t("common.to")}</div>
        <div class="chips">
          ${accountsAll.filter((a) => a.id !== state.accountId).map((a) => `<button type="button" class="chip${state.counterAccountId === a.id ? " active" : ""}" data-counter-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
        </div>
      </div>`;
    }
    return `
    <div class="card" style="border-radius:16px; display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
      <div class="section-title">${state.tipo === "refund" ? t("common.destAccount") : t("common.account")}</div>
      <div class="chips">
        ${accounts.map((a) => `<button type="button" class="chip${state.accountId === a.id ? " active" : ""}" data-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
      </div>
    </div>`;
  }

  function render() {
    const cats = categoriesFor();
    const myCents = state.isShared ? Math.round((state.cents * pct) / 100) : state.cents;
    const partnerCents = state.isShared ? state.cents - myCents : 0;
    // Color del display/importe y del botón de guardar: se leen del state en CADA pintado, así
    // que basta con el render() que ya dispara el click de categoría — sin estado nuevo.
    const amountColor = state.categoryId ? textColorForCategory(state.categoryId, byId) : "var(--text)";
    const saveStyle = needsCategory(state.tipo) && state.categoryId
      ? `background:${colorForCategory(state.categoryId, byId)};color:#FFF4EC;`
      : "";

    // Signo del ajuste: puramente visual (el céntimo interno sigue positivo, el flip ocurre solo
    // al guardar, ver #reg-save más abajo) — se mantiene igual que antes de Task 3.
    const signPrefix = state.tipo === "adjustment" && state.adjustmentSign === "-" ? "−" : "";
    // Importe grande: con op===null (camino "solo dígitos", el caso CRÍTICO de paridad con hoy)
    // se sigue mostrando literalmente lo tecleado (state.raw), tal cual hacía la pantalla antes
    // de Task 3 — así ni el valor (state.cents) ni el eco visual cambian un bit en ese camino.
    // Con op!=null hay un resultado CALCULADO (no algo que el usuario tecleó tal cual), así que
    // se formatea con fmtMoneyParts (mismo patrón .amount-hero que inicio.js/patrimonio.js/
    // presupuesto.js/periodo-nuevo.js/liquidar.js) en vez de intentar "ecoar" un cálculo.
    const amountHtml = state.op != null
      ? `<span class="num amount-hero" style="font-size:52px; font-weight:700; letter-spacing:-0.01em; color:${amountColor};">${signPrefix}${moneyPartsHtml(state.cents)}</span>`
      : `<span class="num" style="font-size:52px; font-weight:700; letter-spacing:-0.01em; color:${amountColor};">${signPrefix}${escHtml(state.raw || "0")}</span>
         <span class="amount-currency" style="color:${amountColor};">${escHtml(currencySymbol())}</span>`;
    // Renglón de expresión bajo el importe (Registro.dc.html: "12 + 12,90 — el teclado suma
    // tickets"), solo cuando hay una operación en curso. state.raw se ecoa tal cual se está
    // tecleando (mismo criterio "ver lo que escribo" que tenía el importe grande antes de Task 3,
    // ahora reubicado aquí); state.acc se muestra vía centsToRaw (con acc===0 —operador como
    // primera tecla— centsToRaw da "" y se sustituye por "0" para no dejar la línea coja).
    const exprLine = state.op == null ? "" : `
      <div style="text-align:right; font-size:12px; color:var(--text-3); margin-top:2px;">
        ${escHtml(centsToRaw(state.acc) || "0")} ${escHtml(state.op)} ${escHtml(state.raw)} — ${escHtml(t("registro.keypad.helper"))}
      </div>`;

    const prevChipsScroll = container.querySelector(".chips-scroll")?.scrollLeft;

    container.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;">
        <h1 style="font-size:19px; font-weight:700; letter-spacing:-0.01em;">${t("registro.title")}</h1>
        <button type="button" class="icon-btn" id="reg-close" aria-label="${t("registro.close")}">✕</button>
      </div>

      <div class="segmented" style="margin-bottom:18px;border-radius:999px;">
        ${TIPOS.map((tp) => {
          const active = state.tipo === tp.id;
          const segStyle = active
            ? "border-radius:999px;background:var(--card2);color:var(--text);font-weight:700;"
            : "border-radius:999px;";
          return `<button type="button" data-tipo="${tp.id}" class="${active ? "active" : ""}" style="${segStyle}">${t(tp.labelKey)}</button>`;
        }).join("")}
      </div>

      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px;">
        <div class="section-title">${t("common.amount")}</div>
        <div class="amount-display" style="align-items:baseline; justify-content:flex-end;">
          ${state.tipo === "adjustment" ? `<button type="button" class="icon-btn" id="reg-sign" aria-label="${t("common.changeSign")}" style="font-size:18px; font-weight:700;">${state.adjustmentSign}</button>` : ""}
          ${amountHtml}
        </div>
        ${exprLine}
        <hr class="divider" style="margin-top:6px;">
      </div>

      ${cats.length ? `
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">${t("common.category")}</div>
        <div class="chips-scroll">
          ${cats.map((c) => {
            const color = colorForCategory(c.id, byId);
            const textColor = textColorForCategory(c.id, byId);
            const icon = iconForCategory(c.id, byId);
            const active = state.categoryId === c.id;
            const chipStyle = active
              ? `--cat:${color};background:color-mix(in srgb, ${color} 18%, transparent);color:${textColor};font-weight:700;`
              : `--cat:${color};`;
            return `<button type="button" class="chip-v${active ? " active" : ""}" data-cat="${c.id}" style="${chipStyle}">
              <span class="chip-icon">${icon}</span><span>${escHtml(c.name)}</span>
            </button>`;
          }).join("")}
        </div>
      </div>` : ""}

      ${renderAccountsSection()}

      ${state.tipo === "refund" ? renderRefundPicker() : ""}

      <div style="display:flex; gap:8px; margin-bottom:12px;">
        <label class="field field-stack" style="flex:1;">
          <span class="field-label">${t("common.merchant")}</span>
          <input type="text" id="reg-merchant" value="${escAttr(state.merchant)}" placeholder="${t("common.optional")}">
        </label>
        <label class="field field-stack" style="flex:1;">
          <span class="field-label">${t("common.date")}</span>
          <input type="date" id="reg-fecha" value="${state.fecha}">
        </label>
      </div>
      <label class="field field-stack" style="margin-bottom:18px;">
        <span class="field-label">${t("common.note")}</span>
        <input type="text" id="reg-note" value="${escAttr(state.note)}" placeholder="${t("common.optional")}">
      </label>

      ${needsCategory(state.tipo) && state.tipo !== "income" && partnerName ? `
      <div class="card" style="border-radius:16px; padding:0 16px; margin-bottom:18px;">
        <label style="height:56px; display:flex; align-items:center; justify-content:space-between; gap:12px; cursor:pointer;">
          <span style="font-size:15px; font-weight:600;">${t("common.sharedWith", { name: escHtml(partnerName) })}</span>
          <span class="toggle">
            <input type="checkbox" id="reg-shared" ${state.isShared ? "checked" : ""}>
            <span class="toggle-track"><span class="toggle-knob"></span></span>
          </span>
        </label>
        ${state.isShared ? `
        <div style="display:flex; gap:8px; padding:0 0 14px;">
          <div style="flex:1; background:var(--card2); border-radius:14px; padding:10px 11px;">
            <div style="font-size:10px; color:var(--text-3);">${t("common.myShare", { pct })}</div>
            <div class="num" style="font-size:15px; font-weight:600;">${fmtMoney(myCents)}</div>
          </div>
          <div style="flex:1; background:var(--card2); border-radius:14px; padding:10px 11px;">
            <div style="font-size:10px; color:var(--text-3);">${escHtml(partnerName)} · ${100 - pct}%</div>
            <div class="num" style="font-size:15px; font-weight:600; color:var(--text-2);">${fmtMoney(partnerCents)}</div>
          </div>
        </div>` : ""}
      </div>` : ""}

      <div class="keypad" style="margin-bottom:18px;">
        ${KEYS.map((k) => {
          if (k === "back") return `<button type="button" class="key key-back" data-key="back" aria-label="${t("registro.keypad.delete")}">${ICON_BACK}</button>`;
          // back/coma se quedan con su tratamiento de siempre (key-back/key-comma) aunque el
          // artboard agrupe visualmente "back" con los operadores (.op) — decisión explícita de
          // Task 3, no un descuido: solo +/−/×/÷ llevan la clase .op nueva.
          if (OPS.has(k)) return `<button type="button" class="key op" data-key="${k}">${k}</button>`;
          return `<button type="button" class="key${k === "," ? " key-comma" : ""}" data-key="${k}">${k}</button>`;
        }).join("")}
      </div>

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      <button type="button" class="btn-primary" id="reg-save" style="${saveStyle}">${t(SAVE_KEY[state.tipo])}</button>
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
      // Pliegue final MANDATORIO (handoff de Task 2): por invariante, state.cents ya está al día
      // en todo momento (setRaw/pressOp llaman a computeRunning tras cada tecla), pero se
      // recalcula explícito aquí también — a propósito, no por desconfianza en la invariante,
      // sino porque este es el punto exacto que el handoff marcó como el que NO puede plegar un
      // operando "" a través de un ‘×’/‘÷’ pendiente (evalExpr(acc,"×",0) daría 0, no acc). Con
      // raw==="" computeRunning ya hace exactamente eso: devuelve acc intacto.
      state.cents = computeRunning(state.acc, state.op, state.raw);
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
          // B4 ruling: el reparto ya no se OFRECE para ingresos (incomeOfPeriod sigue contando
          // al 100%, ver sql.js) — este guard evita que un isShared heredado (p.ej. prefill de
          // una regla recurrente marcada compartida, inicio.js) se cuele en el guardado aunque
          // el toggle esté oculto para tipo=income.
          isShared: withCategory && state.tipo !== "income" ? state.isShared : false,
          refId: state.tipo === "refund" ? state.refId : "",
          ruleId: state.ruleId,
        });
        onDone();
      } catch (e) {
        btn.disabled = false;
        errorMsg = t("common.saveFailed", { error: e.message });
        render();
      }
    };
  }

  render();
}
