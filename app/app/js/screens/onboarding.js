// app/js/screens/onboarding.js
// Onboarding de primera ejecución (PR F): 4 pasos sobre #screen con el chrome oculto
// (body.onboarding lo pone el caller, app/js/onboarding.js). Referencia visual: artboards
// aprobados docs/design/material-expresivo/Onboarding{Bienvenida,Cuentas,Ajustes,Periodo}.
// Sin estado en borrador: cada cuenta se crea en BD al pulsar «Añadir» y las preferencias
// se guardan al salir del paso 3 — si se cierra la pestaña a mitad, el gate (0 periodos)
// reabre el onboarding con lo ya guardado.
import { fmtMoney, initFormat, hoyISO } from "../format.js";
import { getMetaAll, setMeta, setMetaMany, balancesAt, createAccount, replaceAll, retranslateSeedNames } from "../repo.js";
import { POOL } from "../category-colors.js";
import { canLeaveAccounts, accountDraft } from "../onboarding-steps.js";
import { currencyOptionsHtml, localeOptionsHtml } from "./ajustes.js";
import { renderPeriodoNuevo } from "./periodo-nuevo.js";
import { isEncryptedBackup, decryptBackup, WrongPassphraseError } from "../backup-crypto.js";
import { workbookToRows, validateImport } from "../xlsx.js";
import { t, LANGS, activeLang, initI18n } from "../i18n/index.js";
import { loadXlsx } from "../xlsx-loader.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// Mandatory ledger pattern (waves 1-2, ver patrimonio.js ACCOUNT_TYPES/GOAL_TYPES): se guarda la
// CLAVE del diccionario, no el texto — se resuelve con t() en cada render.
const ACCOUNT_TYPES = [
  { id: "checking", labelKey: "onboarding.account.type.checking" },
  { id: "savings", labelKey: "onboarding.account.type.savings" },
  { id: "liability", labelKey: "onboarding.account.type.liability" },
];
const ACCOUNT_TYPE_LABEL_KEY = Object.fromEntries(ACCOUNT_TYPES.map((at) => [at.id, at.labelKey]));
// Preview del paso 3: un emoji por color del POOL (decorativo, mismos pares que el artboard).
const PREVIEW_ICONS = ["🛒", "🎉", "🧾", "📺", "💶", "🚗", "❤️‍🩹", "🍽️", "🚌", "🎁", "🏠", "👕"];
const BOX = `background:var(--card);border-radius:16px;padding:12px 16px;`;
// Feature cards del paso 1 (bienvenida): color + path SVG (decorativos) + claves de texto.
const WELCOME_FEATURES = [
  ["var(--green)", `<rect x="4" y="10" width="16" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 018 0v3"></path>`,
    "onboarding.welcome.feature1.title", "onboarding.welcome.feature1.subtitle"],
  ["#4F94E9", `<path d="M13 3H6.5A1.5 1.5 0 005 4.5v15A1.5 1.5 0 006.5 21h11a1.5 1.5 0 001.5-1.5V9z"></path><path d="M13 3v6h6"></path>`,
    "onboarding.welcome.feature2.title", "onboarding.welcome.feature2.subtitle"],
  ["var(--amber)", `<rect x="3.5" y="5" width="17" height="16" rx="2.5"></rect><path d="M3.5 9.5h17M8 3v4M16 3v4"></path>`,
    "onboarding.welcome.feature3.title", "onboarding.welcome.feature3.subtitle"],
];

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
      <button type="button" class="icon-btn" id="onb-back" aria-label="${escAttr(t("common.back"))}"
        style="width:52px;height:52px;border-radius:999px;background:var(--card);color:var(--text);font-size:18px;flex-shrink:0;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"></path></svg></button>
      <button type="button" class="btn-primary" id="${ctaId}" style="flex:1;">${ctaLabel}</button>
    </div>`;
  }

  function paso1Html() {
    return `
    <div style="margin-top:44px;display:flex;flex-direction:column;align-items:flex-start;gap:14px;">
      <svg width="64" height="64" viewBox="0 0 512 512" aria-hidden="true" style="display:block;flex-shrink:0;">
        <rect width="512" height="512" rx="112" fill="#4FD99A"></rect>
        <path d="M193.43 112.79A41 42 0 1 0 166 186A41 42 0 1 1 138.57 259.21" fill="none" stroke="#121214" stroke-width="40" stroke-linecap="round"></path>
        <rect x="149" y="78" width="34" height="216" rx="17" fill="#121214"></rect>
        <path d="M373.43 112.79A41 42 0 1 0 346 186A41 42 0 1 1 318.57 259.21" fill="none" stroke="#121214" stroke-width="40" stroke-linecap="round"></path>
        <rect x="329" y="78" width="34" height="216" rx="17" fill="#121214"></rect>
        <rect x="138" y="349" width="236" height="50" rx="25" fill="#121214"></rect>
      </svg>
      <div style="font-size:32px;font-weight:800;letter-spacing:-0.02em;line-height:1.12;">${t("onboarding.welcome.titleLine1")}<br>${t("onboarding.welcome.titleLine2")}</div>
      <div style="font-size:14px;color:var(--text-2);line-height:1.5;">${t("onboarding.welcome.subtitle")}</div>
    </div>
    <div style="margin-top:36px;display:flex;flex-direction:column;gap:20px;">
      ${WELCOME_FEATURES.map(([color, path, titleKey, subtitleKey]) => `
      <div style="display:flex;align-items:flex-start;gap:12px;">
        <div style="width:36px;height:36px;border-radius:12px;background:var(--card);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>
        </div>
        <div><div style="font-size:14px;font-weight:700;">${t(titleKey)}</div>
        <div style="font-size:12px;color:var(--text-2);line-height:1.45;">${t(subtitleKey)}</div></div>
      </div>`).join("")}
    </div>
    <div style="margin-top:auto;display:flex;flex-direction:column;gap:10px;padding-top:32px;">
      <button type="button" class="btn-primary" id="onb-start" style="width:100%;">${t("onboarding.welcome.startBtn")}</button>
      <div style="text-align:center;font-size:11.5px;color:var(--text-2);">${t("onboarding.welcome.importPrompt")}
        <button type="button" id="onb-import-link" style="background:none;border:0;padding:0;color:var(--text);font-weight:600;font-size:11.5px;cursor:pointer;font-family:inherit;">${t("onboarding.welcome.importLink")}</button>
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
          <div style="font-size:11px;color:var(--text-2);">${escHtml(ACCOUNT_TYPE_LABEL_KEY[a.type] ? t(ACCOUNT_TYPE_LABEL_KEY[a.type]) : a.type)}${a.id === firstCheckingId ? t("onboarding.account.importDefaultSuffix") : ""}</div>
        </div>
        <div class="num" style="font-size:13.5px;font-weight:700;">${escHtml(fmtMoney(a.balance_cents))}</div>
      </div>`).join("");
    return `
    <div style="margin-top:8px;">
      <div style="font-size:26px;font-weight:800;letter-spacing:-0.02em;">${t("onboarding.account.title")}</div>
      <div style="font-size:13px;color:var(--text-2);margin-top:6px;line-height:1.5;">${t("onboarding.account.subtitle")}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:14px;">${rows}</div>
    <div style="background:var(--card);border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:12px;margin-top:14px;">
      <div class="section-title">${state.accounts.length ? t("onboarding.account.addAnotherTitle") : t("onboarding.account.firstTitle")}</div>
      <input type="text" id="onb-acc-name" value="${escAttr(f.name)}" placeholder="${escAttr(t("onboarding.account.namePlaceholder"))}" autocomplete="off"
        style="border:0;border-radius:14px;background:var(--card2);padding:12px 14px;color:var(--text);font-family:inherit;font-size:14px;font-weight:600;outline:none;">
      <div class="segmented" style="border-radius:999px;">
        ${ACCOUNT_TYPES.map((at) => `
        <button type="button" data-onb-tipo="${at.id}" class="${f.type === at.id ? "active" : ""}"
          style="border-radius:999px;${f.type === at.id ? "background:var(--card2);color:var(--text);font-weight:700;" : ""}">${t(at.labelKey)}</button>`).join("")}
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="flex:1;">
          <div class="section-title" style="margin-bottom:4px;">${t("onboarding.account.balanceTitle")}</div>
          <input type="text" id="onb-acc-raw" inputmode="decimal" value="${escAttr(f.raw)}" placeholder="0,00" autocomplete="off"
            style="border:0;background:none;color:var(--text);font-family:inherit;font-size:22px;font-weight:700;outline:none;width:100%;font-variant-numeric:tabular-nums;">
        </div>
        <button type="button" id="onb-acc-add" class="btn-secondary" style="height:44px;padding:0 20px;border-radius:999px;flex-shrink:0;">${t("onboarding.account.addBtn")}</button>
      </div>
      ${f.type === "liability" ? `<div style="font-size:11px;color:var(--text-2);">${t("onboarding.account.liabilityNote")}</div>` : ""}
      ${state.errorMsg ? `<div style="font-size:11.5px;color:var(--red);">${escHtml(state.errorMsg)}</div>` : ""}
    </div>
    <div style="${BOX}display:flex;align-items:center;gap:10px;margin-top:14px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16.5v.01"></path></svg>
      <div style="font-size:11.5px;color:var(--text-2);">${t("onboarding.account.infoNote")}</div>
    </div>
    ${footHtml(t("onboarding.cta.next"), "onb-next-2")}`;
  }

  function paso3Html() {
    const p = state.prefs;
    return `
    <div style="margin-top:8px;">
      <div style="font-size:26px;font-weight:800;letter-spacing:-0.02em;">${t("onboarding.prefs.title")}</div>
      <div style="font-size:13px;color:var(--text-2);margin-top:6px;">${t("onboarding.prefs.subtitle")}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:13px;margin-top:14px;">
      <div style="background:var(--card);border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:10px;">
        <div class="section-title">${t("onboarding.prefs.language")}</div>
        <div class="segmented" style="border-radius:999px;">
          ${LANGS.map(([v, label]) => `
          <button type="button" data-onb-lang="${v}" class="${activeLang() === v ? "active" : ""}"
            style="border-radius:999px;${activeLang() === v ? "background:var(--card2);color:var(--text);font-weight:700;" : ""}">${escHtml(label)}</button>`).join("")}
        </div>
      </div>
      <div style="background:var(--card);border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:10px;">
        <div class="section-title">${t("onboarding.prefs.currencyTitle")}</div>
        <div style="display:flex;gap:8px;">
          <label class="field field-stack" style="flex:1;"><span>${t("onboarding.prefs.currencyLabel")}</span>
            <select id="onb-currency">${currencyOptionsHtml(p.currency)}</select></label>
          <label class="field field-stack" style="flex:1;"><span>${t("onboarding.prefs.formatLabel")}</span>
            <select id="onb-locale">${localeOptionsHtml(p.locale)}</select></label>
        </div>
      </div>
      <div style="background:var(--card);border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:10px;">
        <div class="section-title">${t("onboarding.prefs.partnerTitle")}</div>
        <input type="text" id="onb-partner" value="${escAttr(p.partner)}" autocomplete="off"
          placeholder="${escAttr(t("onboarding.prefs.partnerPlaceholder"))}"
          style="border:0;border-radius:14px;background:var(--card2);padding:12px 14px;color:var(--text);font-family:inherit;font-size:14px;font-weight:600;outline:none;">
        <div style="font-size:11px;color:var(--text-2);line-height:1.45;">${t("onboarding.prefs.partnerNote")}</div>
      </div>
      <div style="background:var(--card);border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:10px;">
        <div class="section-title">${t("onboarding.prefs.categoriesTitle")}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${POOL.map((color, i) => `<span style="display:grid;place-items:center;width:26px;height:26px;border-radius:50%;font-size:12px;background:${color};">${PREVIEW_ICONS[i]}</span>`).join("")}
        </div>
        <div style="font-size:11.5px;color:var(--text-2);line-height:1.45;">${t("onboarding.prefs.categoriesNote")}</div>
      </div>
      ${state.errorMsg ? `<div style="font-size:11.5px;color:var(--red);">${escHtml(state.errorMsg)}</div>` : ""}
    </div>
    ${footHtml(t("onboarding.cta.next"), "onb-next-3")}`;
  }

  function paso4Html() {
    return `
    <div style="margin-top:8px;">
      <div style="font-size:26px;font-weight:800;letter-spacing:-0.02em;line-height:1.15;">${t("onboarding.period.titleLine1")}<br>${t("onboarding.period.titleLine2")}</div>
      <div style="font-size:13px;color:var(--text-2);margin-top:8px;line-height:1.5;">${t("onboarding.period.bodyPre")}<b style="color:var(--text);">${t("onboarding.period.bodyBold")}</b>${t("onboarding.period.bodyPost")}</div>
    </div>
    <div style="background:var(--card);border-radius:22px;padding:16px;margin-top:14px;">
      <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:700;letter-spacing:0.09em;color:var(--text-2);padding:0 2px 8px;"><span>${t("onboarding.period.illustMonth1")}</span><span>${t("onboarding.period.illustMonth2")}</span></div>
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
        <span style="font-size:11.5px;color:var(--text-2);">${t("onboarding.period.legend")}</span>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:14px;">
      <div style="display:flex;align-items:flex-start;gap:12px;${BOX}">
        <span style="font-size:15px;flex-shrink:0;">✅</span>
        <div style="font-size:12px;color:var(--text-2);line-height:1.45;"><b style="color:var(--text);">${t("onboarding.period.point1Bold")}</b>${t("onboarding.period.point1After")}</div>
      </div>
      <div style="display:flex;align-items:flex-start;gap:12px;${BOX}">
        <span style="font-size:15px;flex-shrink:0;">📅</span>
        <div style="font-size:12px;color:var(--text-2);line-height:1.45;"><b style="color:var(--text);">${t("onboarding.period.point2Bold")}</b>${t("onboarding.period.point2After")}</div>
      </div>
    </div>
    <div style="margin-top:auto;display:flex;flex-direction:column;gap:10px;padding-top:24px;">
      <button type="button" class="btn-primary" id="onb-open-period" style="width:100%;">${t("onboarding.period.openBtn")}</button>
      <div style="text-align:center;font-size:11.5px;color:var(--text-2);">${t("onboarding.period.openHint")}</div>
      <button type="button" class="icon-btn" id="onb-back" aria-label="${escAttr(t("common.back"))}"
        style="width:44px;height:44px;border-radius:999px;background:var(--card);color:var(--text);font-size:16px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"></path></svg></button>
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
    q("#onb-back").onclick = () => { if (state.busy) return; state.step -= 1; state.errorMsg = ""; render(); };
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
        } catch (e) { state.errorMsg = t("onboarding.account.createFailed", { error: e.message }); }
        state.busy = false;
        render();
      };
      q("#onb-next-2").onclick = () => {
        if (!canLeaveAccounts(state.accounts.length)) { state.errorMsg = t("onboarding.account.needOne"); render(); return; }
        state.step = 2; state.errorMsg = ""; render();
      };
    }
    if (state.step === 2) {
      // Card «Idioma» (Task 4, Part B): en caliente — sin location.reload() (reiniciaría el
      // onboarding). initI18n()/documentElement.lang se re-evalúan y render() repinta todo el
      // paso ya traducido; state.prefs no se toca (currency/locale son un ajuste aparte).
      container.querySelectorAll("[data-onb-lang]").forEach((b) => (b.onclick = async () => {
        if (state.busy) return;
        state.busy = true;
        const v = b.dataset.onbLang;
        try {
          await setMeta("lang", v);
          // SIEMPRE (fix round 1): retranslateSeedNames es idempotente y basada en el nombre real
          // de cada fila (ver repo.js), no en si `v` "cambió" — mismo criterio que ajustes.js.
          await retranslateSeedNames(v);
          initI18n({ lang: v });
          document.documentElement.lang = v;
        } catch (e) { state.errorMsg = t("common.saveFailed", { error: e.message }); }
        state.busy = false;
        render();
      }));
      q("#onb-currency").onchange = (e) => { state.prefs.currency = e.target.value; };
      q("#onb-locale").onchange = (e) => { state.prefs.locale = e.target.value; };
      q("#onb-partner").oninput = (e) => { state.prefs.partner = e.target.value; state.errorMsg = ""; };
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
          // documentElement.lang refleja el IDIOMA de la UI (activeLang(), elegido en la card de
          // arriba), no el locale de formato de números/fechas — antes de la card de idioma este
          // valor se derivaba del locale porque era la única señal disponible; con el picker
          // dedicado, derivarlo de locale pisaría el idioma elegido (p.ej. lang=en + locale=es-ES).
          document.documentElement.lang = activeLang();
          state.step = 3;
        } catch (e) { state.errorMsg = t("common.saveFailed", { error: e.message }); }
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

  function renderImportView() {
    const imp = state.imp ?? (state.imp = { fileName: "", needsPass: false, pass: "", errors: [], pending: null, summary: "", busy: false });
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;min-height:calc(100vh - 48px);padding-top:8px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
          <button type="button" class="icon-btn" id="onb-imp-back" aria-label="${escAttr(t("common.goBack"))}"
            style="width:44px;height:44px;border-radius:50%;background:var(--card);color:var(--text);font-size:18px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"></path></svg></button>
          <div style="font-size:20px;font-weight:700;letter-spacing:-0.015em;">${t("onboarding.import.title")}</div>
        </div>
        <div style="font-size:13px;color:var(--text-2);line-height:1.5;margin-bottom:14px;">${t("onboarding.import.introPre")}<b style="color:var(--text);">.xlsx</b>${t("onboarding.import.introMid")}<b style="color:var(--text);">.bce</b>${t("onboarding.import.introPost")}</div>
        ${!imp.fileName ? `
        <label class="btn-primary" style="width:100%;text-align:center;cursor:pointer;">${t("onboarding.import.chooseFileBtn")}
          <input type="file" id="onb-imp-file" accept=".xlsx,.bce" style="display:none;">
        </label>` : `
        <div style="${BOX}display:flex;align-items:center;gap:12px;">
          <div style="flex:1;min-width:0;font-size:13.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(imp.fileName)}</div>
          <button type="button" id="onb-imp-clear" class="btn-secondary" style="height:36px;padding:0 14px;border-radius:999px;flex-shrink:0;">${t("onboarding.import.changeBtn")}</button>
        </div>`}
        ${imp.needsPass ? `
        <div style="background:var(--card);border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:10px;margin-top:14px;">
          <div class="section-title">${t("onboarding.import.encryptedTitle")}</div>
          <input type="password" id="onb-imp-pass" placeholder="${escAttr(t("onboarding.import.passPlaceholder"))}" autocomplete="off"
            style="border:0;border-radius:14px;background:var(--card2);padding:12px 14px;color:var(--text);font-family:inherit;font-size:14px;outline:none;">
          <button type="button" class="btn-primary" id="onb-imp-decrypt" style="width:100%;" ${imp.busy ? "disabled" : ""}>${imp.busy ? t("onboarding.import.decrypting") : t("onboarding.import.decryptBtn")}</button>
        </div>` : ""}
        ${imp.errors.length ? `
        <div class="banner-aviso red" style="display:block;margin-top:14px;"><p>${imp.errors.map(escHtml).join("<br>")}</p></div>` : ""}
        ${imp.pending ? `
        <div style="background:var(--card);border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:10px;margin-top:14px;">
          <div class="section-title">${t("onboarding.import.readyTitle")}</div>
          <div style="font-size:13px;color:var(--text-2);">${escHtml(imp.summary)}</div>
          <button type="button" class="btn-primary" id="onb-imp-go" style="width:100%;" ${imp.busy ? "disabled" : ""}>${imp.busy ? t("onboarding.import.loading") : t("onboarding.import.loadBtn")}</button>
        </div>` : ""}
      </div>`;
    wireImportView(imp);
  }

  function wireImportView(imp) {
    const q = (sel) => container.querySelector(sel);
    q("#onb-imp-back").onclick = () => { state.view = "steps"; state.imp = null; render(); };
    const file = q("#onb-imp-file");
    if (file) file.onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = ""; // permite re-seleccionar el MISMO fichero (p.ej. tras corregirlo y reintentar)
      if (!f) return;
      imp.fileName = f.name; imp.errors = []; imp.pending = null; imp.needsPass = false;
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        if (isEncryptedBackup(buf)) { imp.buffer = buf; imp.needsPass = true; render(); return; }
        await parseAndOffer(imp, buf);
      } catch (err) { imp.errors = [t("onboarding.import.readFailed", { error: err.message })]; render(); }
    };
    const clear = q("#onb-imp-clear");
    if (clear) clear.onclick = () => { state.imp = null; render(); };
    const dec = q("#onb-imp-decrypt");
    if (dec) dec.onclick = async () => {
      if (imp.busy) return;
      // Se lee el input ANTES de re-renderizar (el render de "busy" reconstruye el DOM).
      const pass = q("#onb-imp-pass").value;
      imp.busy = true; imp.errors = []; render();
      try {
        const plain = await decryptBackup(imp.buffer, pass);
        imp.busy = false; imp.needsPass = false;
        await parseAndOffer(imp, plain);
      } catch (e) {
        imp.busy = false;
        imp.errors = [e instanceof WrongPassphraseError ? t("onboarding.import.wrongPass") : t("onboarding.import.decryptFailed", { error: e.message })];
        render();
      }
    };
    const go = q("#onb-imp-go");
    if (go) go.onclick = async () => {
      if (imp.busy) return;
      imp.busy = true; render();
      try {
        // Sin backup previo (a diferencia de Ajustes): la BD todavía está virgen.
        await replaceAll(imp.pending);
        location.reload(); // boot() reevalúa el gate: con periodos en la copia, el onboarding no vuelve.
      } catch (e) { imp.busy = false; imp.errors = [t("onboarding.import.loadFailed", { error: e.message })]; imp.pending = null; render(); }
    };
  }

  async function parseAndOffer(imp, plainBuf) {
    try {
      const XLSX = await loadXlsx();
      const wb = XLSX.read(plainBuf, { type: "array" });
      const { data, errors: parseErrors } = workbookToRows(XLSX, wb);
      const errors = [...parseErrors, ...validateImport(data)];
      if (errors.length) { imp.errors = errors.slice(0, 5); render(); return; }
      imp.pending = data;
      imp.summary = [
        t("onboarding.import.summaryAccounts", { n: data.accounts.length }),
        t("onboarding.import.summaryPeriods", { n: data.periods.length }),
        t("onboarding.import.summaryMovements", { n: data.transactions.length }),
      ].join(" · ");
      render();
    } catch (e) { imp.errors = [t("onboarding.import.readFailed", { error: e.message })]; render(); }
  }
}
