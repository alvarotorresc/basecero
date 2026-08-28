// app/js/screens/onboarding.js
// Onboarding de primera ejecución (PR F): 4 pasos sobre #screen con el chrome oculto
// (body.onboarding lo pone el caller, app/js/onboarding.js). Referencia visual: artboards
// aprobados docs/design/material-expresivo/Onboarding{Bienvenida,Cuentas,Ajustes,Periodo}.
// Sin estado en borrador: cada cuenta se crea en BD al pulsar «Añadir» y las preferencias
// se guardan al salir del paso 3 — si se cierra la pestaña a mitad, el gate (0 periodos)
// reabre el onboarding con lo ya guardado.
import { fmtMoney, initFormat, hoyISO } from "../format.js";
import { getMetaAll, setMetaMany, balancesAt, createAccount, replaceAll } from "../repo.js";
import { POOL } from "../category-colors.js";
import { canLeaveAccounts, accountDraft } from "../onboarding-steps.js";
import { currencyOptionsHtml, localeOptionsHtml } from "./ajustes.js";
import { renderPeriodoNuevo } from "./periodo-nuevo.js";
import { isEncryptedBackup, decryptBackup, WrongPassphraseError } from "../backup-crypto.js";
import { workbookToRows, validateImport } from "../xlsx.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");

const TYPE_LABELS = { checking: "Corriente", savings: "Ahorro", liability: "Pasivo" };
// Preview del paso 3: un emoji por color del POOL (decorativo, mismos pares que el artboard).
const PREVIEW_ICONS = ["🛒", "🎉", "🧾", "📺", "💶", "🚗", "❤️‍🩹", "🍽️", "🚌", "🎁", "🏠", "👕"];
const BOX = `background:var(--card);border-radius:16px;padding:12px 16px;`;

export async function renderOnboarding(container, { onDone }) {
  const meta = await getMetaAll();
  const state = {
    step: 0, // 0 bienvenida · 1 cuentas · 2 ajustes · 3 periodo
    accounts: await balancesAt(hoyISO()),
    form: { name: "", type: "checking", raw: "" },
    prefs: { currency: meta.currency || "EUR", locale: meta.locale || "es-ES", partner: meta.partner_name || "" },
    view: "steps", // "steps" | "import" (subvista de la Task 3)
    imp: null,
    busy: false,
    errorMsg: "",
  };
  render();

  function dotsHtml() {
    return `<div class="onb-dots" style="margin-bottom:20px;">${[0, 1, 2, 3]
      .map((i) => `<span class="onb-dot${i === state.step ? " on" : ""}"></span>`).join("")}</div>`;
  }

  function footHtml(ctaLabel, ctaId) {
    // ← + CTA. En el paso 0 no hay atrás (lo pinta paso1Html con su propio pie).
    return `
    <div style="display:flex;gap:10px;margin-top:24px;">
      <button type="button" class="icon-btn" id="onb-back" aria-label="Atrás"
        style="width:52px;height:52px;border-radius:999px;background:var(--card);color:var(--text);font-size:18px;flex-shrink:0;">←</button>
      <button type="button" class="btn-primary" id="${ctaId}" style="flex:1;">${ctaLabel}</button>
    </div>`;
  }

  function paso1Html() {
    return `
    <div style="margin-top:44px;display:flex;flex-direction:column;align-items:flex-start;gap:14px;">
      <div style="width:64px;height:64px;border-radius:20px;background:var(--card);display:flex;align-items:center;justify-content:center;">
        <div style="font-size:26px;font-weight:800;letter-spacing:-0.04em;">B0</div>
      </div>
      <div style="font-size:32px;font-weight:800;letter-spacing:-0.02em;line-height:1.12;">Tu dinero,<br>desde cero.</div>
      <div style="font-size:14px;color:var(--text-2);line-height:1.5;">BaseCero es tu cuaderno de gastos: vive en este dispositivo, sin cuentas, sin nube, sin nadie mirando.</div>
    </div>
    <div style="margin-top:36px;display:flex;flex-direction:column;gap:20px;">
      ${[
        ["var(--green)", `<rect x="4" y="10" width="16" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 018 0v3"></path>`,
          "Todo se queda aquí", "Sin servidor y sin registro. Funciona hasta sin conexión."],
        ["#4F94E9", `<path d="M13 3H6.5A1.5 1.5 0 005 4.5v15A1.5 1.5 0 006.5 21h11a1.5 1.5 0 001.5-1.5V9z"></path><path d="M13 3v6h6"></path>`,
          "Tu dato es una hoja de cálculo", "Exporta e importa tus datos cuando quieras: nunca están atrapados."],
        ["var(--amber)", `<rect x="3.5" y="5" width="17" height="16" rx="2.5"></rect><path d="M3.5 9.5h17M8 3v4M16 3v4"></path>`,
          "Tu mes empieza cuando cobras", "Los periodos van de nómina a nómina, no del 1 al 30."],
      ].map(([color, path, t, s]) => `
      <div style="display:flex;align-items:flex-start;gap:12px;">
        <div style="width:36px;height:36px;border-radius:12px;background:var(--card);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>
        </div>
        <div><div style="font-size:14px;font-weight:700;">${t}</div>
        <div style="font-size:12px;color:var(--text-2);line-height:1.45;">${s}</div></div>
      </div>`).join("")}
    </div>
    <div style="margin-top:auto;display:flex;flex-direction:column;gap:10px;padding-top:32px;">
      <button type="button" class="btn-primary" id="onb-start" style="width:100%;">Empezar · 2 minutos</button>
      <div style="text-align:center;font-size:11.5px;color:var(--text-2);">¿Vienes de otra copia?
        <button type="button" id="onb-import-link" style="background:none;border:0;padding:0;color:var(--text);font-weight:600;font-size:11.5px;cursor:pointer;font-family:inherit;">Importar una hoja o backup</button>
      </div>
    </div>`;
  }

  function paso2Html() {
    const f = state.form;
    const firstCheckingId = state.accounts.find((a) => a.type === "checking")?.id;
    const rows = state.accounts.map((a) => `
      <div style="${BOX}display:flex;align-items:center;gap:12px;">
        <div style="width:34px;height:34px;border-radius:50%;background:var(--card2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="1.8" stroke-linecap="round"><path d="M5 13l4 4L19 7"></path></svg>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(a.name)}</div>
          <div style="font-size:11px;color:var(--text-2);">${TYPE_LABELS[a.type] ?? a.type}${a.id === firstCheckingId ? " · será la cuenta de tus imports" : ""}</div>
        </div>
        <div class="num" style="font-size:13.5px;font-weight:700;">${escHtml(fmtMoney(a.balance_cents))}</div>
      </div>`).join("");
    return `
    <div style="margin-top:8px;">
      <div style="font-size:26px;font-weight:800;letter-spacing:-0.02em;">Tus cuentas</div>
      <div style="font-size:13px;color:var(--text-2);margin-top:6px;line-height:1.5;">Las de verdad: tu banco del día a día, tu hucha, tu préstamo. Con al menos una basta para empezar.</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:14px;">${rows}</div>
    <div style="background:var(--card);border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:12px;margin-top:14px;">
      <div class="section-title">${state.accounts.length ? "Añadir otra" : "Tu primera cuenta"}</div>
      <input type="text" id="onb-acc-name" value="${escAttr(f.name)}" placeholder="Nombre · p. ej. Hucha del banco" autocomplete="off"
        style="border:0;border-radius:14px;background:var(--card2);padding:12px 14px;color:var(--text);font-family:inherit;font-size:14px;font-weight:600;outline:none;">
      <div class="segmented" style="border-radius:999px;">
        ${Object.entries(TYPE_LABELS).map(([id, label]) => `
        <button type="button" data-onb-tipo="${id}" class="${f.type === id ? "active" : ""}"
          style="border-radius:999px;${f.type === id ? "background:var(--card2);color:var(--text);font-weight:700;" : ""}">${label}</button>`).join("")}
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="flex:1;">
          <div class="section-title" style="margin-bottom:4px;">Saldo de hoy</div>
          <input type="text" id="onb-acc-raw" inputmode="decimal" value="${escAttr(f.raw)}" placeholder="0,00" autocomplete="off"
            style="border:0;background:none;color:var(--text);font-family:inherit;font-size:22px;font-weight:700;outline:none;width:100%;font-variant-numeric:tabular-nums;">
        </div>
        <button type="button" id="onb-acc-add" class="btn-secondary" style="height:44px;padding:0 20px;border-radius:999px;flex-shrink:0;">Añadir</button>
      </div>
      ${f.type === "liability" ? `<div style="font-size:11px;color:var(--text-2);">El saldo de un pasivo es lo que debes: se guarda en negativo.</div>` : ""}
      ${state.errorMsg ? `<div style="font-size:11.5px;color:var(--red);">${escHtml(state.errorMsg)}</div>` : ""}
    </div>
    <div style="${BOX}display:flex;align-items:center;gap:10px;margin-top:14px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16.5v.01"></path></svg>
      <div style="font-size:11.5px;color:var(--text-2);">Aquí no se conecta ningún banco: tú apuntas o importas su CSV. Podrás añadir y renombrar cuentas cuando quieras en Patrimonio.</div>
    </div>
    ${footHtml("Seguir", "onb-next-2")}`;
  }

  function paso3Html() {
    const p = state.prefs;
    return `
    <div style="margin-top:8px;">
      <div style="font-size:26px;font-weight:800;letter-spacing:-0.02em;">A tu manera</div>
      <div style="font-size:13px;color:var(--text-2);margin-top:6px;">Tres cosas rápidas. Todas se cambian luego en Ajustes.</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:13px;margin-top:14px;">
      <div style="background:var(--card);border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:10px;">
        <div class="section-title">Moneda y formato</div>
        <div style="display:flex;gap:8px;">
          <label class="field field-stack" style="flex:1;"><span>Moneda</span>
            <select id="onb-currency">${currencyOptionsHtml(p.currency)}</select></label>
          <label class="field field-stack" style="flex:1;"><span>Formato</span>
            <select id="onb-locale">${localeOptionsHtml(p.locale)}</select></label>
        </div>
      </div>
      <div style="background:var(--card);border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:10px;">
        <div class="section-title">¿Compartes gastos con alguien?</div>
        <input type="text" id="onb-partner" value="${escAttr(p.partner)}" autocomplete="off"
          placeholder="Su nombre — o déjalo vacío si vas por libre"
          style="border:0;border-radius:14px;background:var(--card2);padding:12px 14px;color:var(--text);font-family:inherit;font-size:14px;font-weight:600;outline:none;">
        <div style="font-size:11px;color:var(--text-2);line-height:1.45;">Con nombre, cada gasto puede marcarse como compartido y la app lleva las cuentas de quién debe qué. Vacío = ni rastro de esa parte de la app.</div>
      </div>
      <div style="background:var(--card);border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:10px;">
        <div class="section-title">Tus categorías</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${POOL.map((color, i) => `<span style="display:grid;place-items:center;width:26px;height:26px;border-radius:50%;font-size:12px;background:${color};">${PREVIEW_ICONS[i]}</span>`).join("")}
        </div>
        <div style="font-size:11.5px;color:var(--text-2);line-height:1.45;">Empiezas con un pack de 41 (Casa, Alimentación, Transporte…). Crea, renombra, recolorea o archiva las que quieras en Ajustes → Categorías.</div>
      </div>
    </div>
    ${footHtml("Seguir", "onb-next-3")}`;
  }

  function paso4Html() {
    return `
    <div style="margin-top:8px;">
      <div style="font-size:26px;font-weight:800;letter-spacing:-0.02em;line-height:1.15;">Tu mes no empieza<br>el día 1</div>
      <div style="font-size:13px;color:var(--text-2);margin-top:8px;line-height:1.5;">Empieza el día que cobras. BaseCero organiza tu dinero en <b style="color:var(--text);">periodos</b>: abres uno cuando entra la nómina y lo cierras cuando llega la siguiente.</div>
    </div>
    <div style="background:var(--card);border-radius:22px;padding:16px;margin-top:14px;">
      <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:700;letter-spacing:0.09em;color:var(--text-2);padding:0 2px 8px;"><span>SEPTIEMBRE</span><span>OCTUBRE</span></div>
      <div style="display:flex;gap:4px;">
        ${["25", "26", "27g", "28s", "…s", "25s", "26s", "27g"].map((d) => {
          const g = d.endsWith("g"), s = d.endsWith("s");
          const label = g || s ? d.slice(0, -1) : d;
          return `<div style="flex:1;aspect-ratio:1;display:grid;place-items:center;font-size:10px;border-radius:8px;${
            g ? "background:#15AC7D;color:var(--bg);font-weight:800;" : s ? "background:color-mix(in srgb, #15AC7D 18%, var(--card));color:var(--text-2);" : "color:var(--text-2);"}">${label}</div>`;
        }).join("")}
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px;">
        <span style="width:9px;height:9px;border-radius:3px;background:#15AC7D;flex-shrink:0;"></span>
        <span style="font-size:11.5px;color:var(--text-2);">día de cobro = un periodo se cierra y nace el siguiente</span>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:14px;">
      <div style="display:flex;align-items:flex-start;gap:12px;${BOX}">
        <span style="font-size:15px;flex-shrink:0;">✅</span>
        <div style="font-size:12px;color:var(--text-2);line-height:1.45;"><b style="color:var(--text);">Ves lo que de verdad te queda</b> entre nómina y nómina — no un mes de calendario partido por la mitad.</div>
      </div>
      <div style="display:flex;align-items:flex-start;gap:12px;${BOX}">
        <span style="font-size:15px;flex-shrink:0;">📅</span>
        <div style="font-size:12px;color:var(--text-2);line-height:1.45;"><b style="color:var(--text);">¿Cobras el día 1?</b> Perfecto también: tu periodo irá del 1 al 31. La regla es tuya.</div>
      </div>
    </div>
    <div style="margin-top:auto;display:flex;flex-direction:column;gap:10px;padding-top:24px;">
      <button type="button" class="btn-primary" id="onb-open-period" style="width:100%;">Abrir mi primer periodo</button>
      <div style="text-align:center;font-size:11.5px;color:var(--text-2);">Te preguntamos el nombre, la fecha y el presupuesto — 30 segundos.</div>
      <button type="button" class="icon-btn" id="onb-back" aria-label="Atrás"
        style="width:44px;height:44px;border-radius:999px;background:var(--card);color:var(--text);font-size:16px;">←</button>
    </div>`;
  }

  function render() {
    if (state.view === "import") { renderImportView(); return; } // Task 3
    const cuerpo = [paso1Html, paso2Html, paso3Html, paso4Html][state.step]();
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;min-height:calc(100vh - 48px);padding-top:8px;">
        ${dotsHtml()}
        ${cuerpo}
      </div>`;
    wire();
  }

  function wire() {
    const q = (sel) => container.querySelector(sel);
    if (state.step === 0) {
      q("#onb-start").onclick = () => { state.step = 1; render(); };
      q("#onb-import-link").onclick = () => { state.view = "import"; state.imp = null; render(); };
      return;
    }
    q("#onb-back").onclick = () => { state.step -= 1; state.errorMsg = ""; render(); };
    if (state.step === 1) {
      const f = state.form;
      q("#onb-acc-name").oninput = (e) => { f.name = e.target.value; state.errorMsg = ""; };
      q("#onb-acc-raw").oninput = (e) => { f.raw = e.target.value; state.errorMsg = ""; };
      container.querySelectorAll("[data-onb-tipo]").forEach((b) => (b.onclick = () => {
        f.type = b.dataset.onbTipo; render();
      }));
      q("#onb-acc-add").onclick = async () => {
        if (state.busy) return;
        const draft = accountDraft(f);
        if (draft.error) { state.errorMsg = draft.error; render(); return; }
        state.busy = true;
        try {
          await createAccount(draft);
          state.accounts = await balancesAt(hoyISO());
          state.form = { name: "", type: "checking", raw: "" };
          state.errorMsg = "";
        } catch (e) { state.errorMsg = "No se pudo crear la cuenta: " + e.message; }
        state.busy = false;
        render();
      };
      q("#onb-next-2").onclick = () => {
        if (!canLeaveAccounts(state.accounts.length)) { state.errorMsg = "Crea al menos una cuenta para seguir."; render(); return; }
        state.step = 2; state.errorMsg = ""; render();
      };
    }
    if (state.step === 2) {
      q("#onb-next-3").onclick = async () => {
        if (state.busy) return;
        state.busy = true;
        // Se leen los inputs ANTES de re-renderizar (el render reconstruye el DOM).
        const currency = q("#onb-currency").value;
        const locale = q("#onb-locale").value;
        const partner = q("#onb-partner").value.trim();
        try {
          await setMetaMany([["currency", currency], ["locale", locale], ["partner_name", partner]]);
          state.prefs = { currency, locale, partner };
          // Sin location.reload() (reiniciaría el onboarding): se re-inicializan los
          // formateadores en caliente, igual que hace boot() al arrancar.
          initFormat({ currency, locale });
          document.documentElement.lang = locale.split("-")[0];
          state.step = 3;
        } catch (e) { state.errorMsg = "No se pudo guardar: " + e.message; }
        state.busy = false;
        render();
      };
    }
    if (state.step === 3) {
      q("#onb-open-period").onclick = () => {
        // partner_name ya está persistido (paso 3): renderPeriodoNuevo lo lee de meta
        // al montarse y pinta (o no) el bloque de reparto correctamente.
        renderPeriodoNuevo(container, { mode: "first", onDone, onBack: () => render() });
      };
    }
  }

  function renderImportView() { /* Task 3 */ }
}
