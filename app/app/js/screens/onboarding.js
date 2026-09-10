// app/js/screens/onboarding.js
// Onboarding de primera ejecución: 4 pasos sobre #screen con el chrome oculto (body.onboarding lo
// pone el caller, app/js/onboarding.js). Referencia visual: docs/design/final-v2/
// Onboarding{1,2,3,4}.dc.html (SISTEMA.md).
// Sin estado en borrador: cada cuenta se crea en BD al pulsar «Añadir» y las preferencias
// se guardan al salir del paso 3 — si se cierra la pestaña a mitad, el gate (0 periodos)
// reabre el onboarding con lo ya guardado.
import { fmtMoney, moneyPartsHtml, initFormat, hoyISO } from "../format.js";
import { getMetaAll, setMeta, setMetaMany, balancesAt, createAccount, deleteEmptyAccount, replaceAll, retranslateSeedNames } from "../repo.js";
import { canLeaveAccounts, accountDraft } from "../onboarding-steps.js";
import { currencyOptionsHtml, localeOptionsHtml } from "./ajustes.js";
import { renderPeriodoNuevo } from "./periodo-nuevo.js";
import { isEncryptedBackup, decryptBackup, WrongPassphraseError } from "../backup-crypto.js";
import { workbookToRows, validateImport } from "../xlsx.js";
import { t, LANGS, activeLang, initI18n } from "../i18n/index.js";
import { loadXlsx } from "../xlsx-loader.js";
import { userMessage } from "../errors.js";
import { icon } from "../icons.js";
import { subHeaderHtml } from "../ui.js";
import { showConfirm } from "../modal.js";
import { showToast } from "../toast.js";
import { attachments } from "../attachments.js";
import { unpackRestore } from "../bundle.js";

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
// BOX (spec §8 punto 2, "fuera las cajas"): DESVIACIÓN respecto al plan, que la da por muerta tras
// esta PR — ningún paso (1-4) la usa ya, pero renderImportView (la subvista de import) sigue
// envolviendo su fila de fichero elegido con este mismo patrón de caja, y esa subvista está fuera
// del alcance de "los tres primeros pasos" que pide el punto 2: ninguna task de P7 la rediseña.
// Se queda declarada mientras siga teniendo un consumidor real.
const BOX = `background:var(--card);border-radius:0;padding:12px 16px;`;
// Feature rows del paso 1 (bienvenida): icono monocromo del repertorio §3 + claves de texto.
// Onboarding1.dc.html:37-59 — lock / download ("hoja de cálculo, exportable e importable") /
// calendar, EN ESE ORDEN: no "repeat" (el plan lo cita mal; el path del artboard es
// ICON_PATHS.download verbatim, y encaja con el copy "exporta e importa tus datos").
const WELCOME_FEATURES = [
  ["lock", "onboarding.welcome.feature1.title", "onboarding.welcome.feature1.subtitle"],
  ["download", "onboarding.welcome.feature2.title", "onboarding.welcome.feature2.subtitle"],
  ["calendar", "onboarding.welcome.feature3.title", "onboarding.welcome.feature3.subtitle"],
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

  // Barras acumulativas (SISTEMA.md, Onboarding1-4.dc.html:19-24): lima las completadas Y la
  // actual (i <= state.step), no solo la actual — los cuatro artboards lo pintan así (p.ej.
  // Onboarding3 lleva TRES barras en lima, no una).
  function barsHtml() {
    return `<div class="onb-bars" style="margin-bottom:20px;">${[0, 1, 2, 3]
      .map((i) => `<span class="onb-bar${i <= state.step ? " on" : ""}"></span>`).join("")}</div>`;
  }

  function footHtml(ctaLabel, ctaId) {
    // ← + CTA. En el paso 0 no hay atrás (lo pinta paso1Html con su propio pie).
    return `
    <div style="display:flex;gap:10px;margin-top:24px;">
      <button type="button" class="icon-btn" id="onb-back" aria-label="${escAttr(t("common.back"))}"
        style="width:44px;height:44px;border-radius:999px;background:var(--card);color:var(--text);flex-shrink:0;">${icon("back")}</button>
      <button type="button" class="btn-primary" id="${ctaId}" style="flex:1;">${ctaLabel}</button>
    </div>`;
  }

  function paso1Html() {
    return `
    <div style="margin-top:28px;display:flex;flex-direction:column;align-items:flex-start;gap:18px;">
      <svg width="96" height="96" viewBox="0 0 512 512" aria-hidden="true" style="display:block;flex-shrink:0;">
        <rect width="512" height="512" rx="112" fill="#D4FF3F"></rect>
        <path d="M193.43 112.79A41 42 0 1 0 166 186A41 42 0 1 1 138.57 259.21" fill="none" stroke="#14180B" stroke-width="40" stroke-linecap="round"></path>
        <rect x="149" y="78" width="34" height="216" rx="17" fill="#14180B"></rect>
        <path d="M373.43 112.79A41 42 0 1 0 346 186A41 42 0 1 1 318.57 259.21" fill="none" stroke="#14180B" stroke-width="40" stroke-linecap="round"></path>
        <rect x="329" y="78" width="34" height="216" rx="17" fill="#14180B"></rect>
        <rect x="138" y="349" width="236" height="50" rx="25" fill="#14180B"></rect>
      </svg>
      <div style="max-width:250px;font-size:34px;font-weight:600;letter-spacing:-.015em;line-height:1.1;">${t("onboarding.welcome.title")}</div>
    </div>
    <div style="margin-top:30px;display:flex;flex-direction:column;gap:20px;">
      ${WELCOME_FEATURES.map(([iconName, titleKey, subtitleKey]) => `
      <div style="display:flex;align-items:flex-start;gap:14px;">
        <div style="width:36px;height:36px;border-radius:var(--r-circle);background:var(--surface-2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          ${icon(iconName)}
        </div>
        <div style="display:flex;flex-direction:column;gap:3px;min-width:0;">
          <span style="font-size:15px;font-weight:600;">${t(titleKey)}</span>
          <span style="font-size:13px;font-weight:500;color:var(--ink-3);line-height:1.4;">${t(subtitleKey)}</span>
        </div>
      </div>`).join("")}
    </div>
    <div style="margin-top:auto;display:flex;flex-direction:column;gap:12px;padding-top:32px;">
      <button type="button" class="btn-primary" id="onb-start" style="width:100%;">${t("onboarding.welcome.startBtn")}</button>
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;">
        <span style="font-size:12px;font-weight:500;color:var(--ink-3);">${t("onboarding.welcome.startHint")}</span>
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="font-size:12px;font-weight:500;color:var(--ink-3);">${t("onboarding.welcome.importPrompt")}</span>
          <button type="button" id="onb-import-link" style="background:none;border:0;padding:0;color:var(--ink);font-weight:600;font-size:12px;cursor:pointer;font-family:inherit;">${t("onboarding.welcome.importLink")}</button>
        </div>
      </div>
    </div>`;
  }

  function paso2Html() {
    const f = state.form;
    const firstCheckingId = state.accounts.find((a) => a.type === "checking")?.id;
    // Filas planas de 60px con filete (SISTEMA.md, Onboarding2.dc.html:29-46): sin caja ni check
    // verde de 34px (D14: fuera las cajas de los tres primeros pasos). La tercera línea (11/500)
    // solo la lleva la primera cuenta corriente — es la que absorbe los imports de CSV.
    const rows = state.accounts.map((a) => `
      <div style="display:flex;align-items:center;gap:12px;min-height:60px;padding:10px 0;border-bottom:1px solid var(--hairline);">
        <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;">
          <span style="font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(a.name)}</span>
          <span style="font-size:12px;font-weight:500;color:var(--ink-3);">${ACCOUNT_TYPE_LABEL_KEY[a.type] ? escHtml(t(ACCOUNT_TYPE_LABEL_KEY[a.type])) : escHtml(a.type)}</span>
          ${a.id === firstCheckingId ? `<span style="font-size:11px;font-weight:500;color:var(--ink-3);">${t("onboarding.account.importDefault")}</span>` : ""}
        </div>
        <div class="num" style="font-size:16px;font-weight:500;flex-shrink:0;">${moneyPartsHtml(a.balance_cents)}</div>
        <button type="button" class="icon-btn" data-onb-del="${escAttr(a.id)}" aria-label="${escAttr(t("onboarding.account.deleteAria", { name: a.name }))}">${icon("trash")}</button>
      </div>`).join("");
    return `
    <div style="margin-top:8px;">
      <div style="font: var(--t-title); letter-spacing:-.01em;">${t("onboarding.account.title")}</div>
      <div style="font-size:13px;color:var(--text-2);margin-top:6px;line-height:1.5;">${t("onboarding.account.subtitle")}</div>
    </div>
    <div style="margin-top:14px;">${rows}</div>
    <div style="display:flex;flex-direction:column;gap:14px;margin-top:30px;">
      <div class="section-title">${state.accounts.length ? t("onboarding.account.addAnotherTitle") : t("onboarding.account.firstTitle")}</div>
      <label class="field field-stack">
        <span class="field-label">${t("common.name")}</span>
        <input type="text" id="onb-acc-name" value="${escAttr(f.name)}" placeholder="${escAttr(t("onboarding.account.namePlaceholder"))}" autocomplete="off">
      </label>
      <div class="chips">
        ${ACCOUNT_TYPES.map((at) => `
        <button type="button" data-onb-tipo="${at.id}" class="chip${f.type === at.id ? " active" : ""}">${t(at.labelKey)}</button>`).join("")}
      </div>
      <label class="field field-stack">
        <span class="field-label">${t("onboarding.account.balanceTitle")}</span>
        <input type="text" id="onb-acc-raw" inputmode="decimal" value="${escAttr(f.raw)}" placeholder="0,00" autocomplete="off">
      </label>
      ${f.type === "liability" ? `<div style="font-size:11px;color:var(--ink-3);">${t("onboarding.account.liabilityNote")}</div>` : ""}
      ${state.errorMsg ? `<div style="font-size:11.5px;color:var(--danger);">${escHtml(state.errorMsg)}</div>` : ""}
      <button type="button" id="onb-acc-add" class="btn-secondary" style="width:100%;">${t("onboarding.account.addBtn")}</button>
    </div>
    <div style="margin-top:20px;">
      <div style="font-size:11.5px;color:var(--ink-3);line-height:1.45;">${t("onboarding.account.infoNote")}</div>
    </div>
    ${footHtml(t("onboarding.cta.next"), "onb-next-2")}`;
  }

  // Convierte las <option> de currencyOptionsHtml/localeOptionsHtml (ajustes.js, única fuente de
  // verdad de las listas de monedas/locales) en chips (SISTEMA.md §4.5bis, Onboarding3.dc.html):
  // NO se duplica CURRENCIES/LOCALES aquí (no son exports de ajustes.js, que P7 no edita), así que
  // se reaprovechan las funciones ya importadas y se relee su HTML. value/label ya llegan
  // escAttr/escHtml-escapados desde ajustes.js: se reinsertan tal cual, sin volver a escapar.
  function chipsFromOptions(optionsHtml, dataAttr) {
    return [...optionsHtml.matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)]
      .map(([, value, attrs, label]) =>
        `<button type="button" data-${dataAttr}="${value}" class="chip${attrs.includes("selected") ? " active" : ""}">${label}</button>`)
      .join("");
  }

  function paso3Html() {
    const p = state.prefs;
    return `
    <div style="margin-top:8px;">
      <div style="font: var(--t-title); letter-spacing:-.01em;">${t("onboarding.prefs.title")}</div>
      <div style="font-size:13px;color:var(--text-2);margin-top:6px;">${t("onboarding.prefs.subtitle")}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:30px;margin-top:26px;">
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="section-title">${t("onboarding.prefs.language")}</div>
        <div class="chips">
          ${LANGS.map(([v, label]) => `
          <button type="button" data-onb-lang="${v}" class="chip${activeLang() === v ? " active" : ""}">${escHtml(label)}</button>`).join("")}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="section-title">${t("onboarding.prefs.currencyLabel")}</div>
        <div class="chips">${chipsFromOptions(currencyOptionsHtml(p.currency), "onb-currency")}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="section-title">${t("onboarding.prefs.formatLabel")}</div>
        <div class="chips">${chipsFromOptions(localeOptionsHtml(p.locale), "onb-locale")}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="section-title">${t("onboarding.prefs.partnerTitle")}</div>
        <label class="field field-stack">
          <span class="field-label">${t("common.name")}</span>
          <input type="text" id="onb-partner" value="${escAttr(p.partner)}" autocomplete="off"
            placeholder="${escAttr(t("onboarding.prefs.partnerPlaceholder"))}">
        </label>
        <div style="font-size:12px;color:var(--ink-3);line-height:1.4;">${t("onboarding.prefs.partnerNote")}</div>
      </div>
      ${state.errorMsg ? `<div style="font-size:11.5px;color:var(--danger);">${escHtml(state.errorMsg)}</div>` : ""}
    </div>
    ${footHtml(t("onboarding.cta.next"), "onb-next-3")}`;
  }

  // Paso 4 (D5/D10/D11, spec §8 punto 6): el formulario real de periodo, embebido. Las barras +
  // título + subtítulo los pinta el paso; renderPeriodoNuevo(embed:true) rellena #onb-periodo SIN
  // su propia cabecera (bloqueHeader() suprimida por P0) — nombre, fecha, ingresos previstos
  // (efímero, D11), límites, total y el CTA #pn-submit son el contenido real, sin pantalla
  // ilustrativa ni salto de pantalla. El «atrás» del paso vive FUERA de #onb-periodo (ese <div> lo
  // reescribe entero renderPeriodoNuevo en cada uno de sus propios render()).
  function paso4Html() {
    return `
    <div style="margin-top:8px;">
      <div style="font: var(--t-title); letter-spacing:-.01em;">${t("onboarding.period.title")}</div>
      <div style="font-size:13px;color:var(--text-2);margin-top:6px;line-height:1.5;">${t("onboarding.period.subtitle")}</div>
    </div>
    <div id="onb-periodo" style="margin-top:14px;"></div>
    <div style="margin-top:24px;">
      <button type="button" class="icon-btn" id="onb-back" aria-label="${escAttr(t("common.back"))}">${icon("back")}</button>
    </div>`;
  }

  function render() {
    if (state.view === "import") { renderImportView(); return; } // Task 3
    const cuerpo = [paso1Html, paso2Html, paso3Html, paso4Html][state.step]();
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;min-height:calc(100vh - 48px);padding-top:8px;">
        ${barsHtml()}
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
      // Borrar (D9, spec §8 punto 4): solo cuentas SIN movimientos — imposible en el onboarding,
      // pero el guard vive en deleteEmptyAccount, no aquí. showConfirm ya es el patrón §4.12.
      container.querySelectorAll("[data-onb-del]").forEach((b) => (b.onclick = () => {
        if (state.busy) return;
        const a = state.accounts.find((x) => x.id === b.dataset.onbDel);
        if (!a) return;
        showConfirm({
          title: t("onboarding.account.deleteTitle"),
          message: t("onboarding.account.deleteBody", { name: a.name, amount: fmtMoney(a.balance_cents) }),
          cancelText: t("common.cancel"),
          confirmText: t("common.delete"),
          onConfirm: async () => {
            state.busy = true;
            try {
              const deleted = await deleteEmptyAccount(a.id);
              if (deleted) {
                state.accounts = await balancesAt(hoyISO());
              } else {
                // Guard defensivo (D9): la cuenta ya tiene movimientos. No debería poder pasar
                // desde el onboarding, pero deleteEmptyAccount no lanza — solo avisa.
                showToast(t("onboarding.account.deleteFailed", { error: t("onboarding.account.deleteHasMovements") }));
              }
            } catch (e) {
              showToast(t("onboarding.account.deleteFailed", { error: userMessage(e) }));
            }
            state.busy = false;
            render();
          },
        });
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
        } catch (e) { state.errorMsg = t("onboarding.account.createFailed", { error: userMessage(e) }); }
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
        } catch (e) { state.errorMsg = t("common.saveFailed", { error: userMessage(e) }); }
        state.busy = false;
        render();
      }));
      // Moneda/Formato: chips, no <select> (Task 7.5) — el valor se guarda en state.prefs al
      // vuelo, así que #onb-next-3 ya no necesita leerlo de ningún input.
      container.querySelectorAll("[data-onb-currency]").forEach((b) => (b.onclick = () => {
        state.prefs.currency = b.dataset.onbCurrency; render();
      }));
      container.querySelectorAll("[data-onb-locale]").forEach((b) => (b.onclick = () => {
        state.prefs.locale = b.dataset.onbLocale; render();
      }));
      q("#onb-partner").oninput = (e) => { state.prefs.partner = e.target.value; state.errorMsg = ""; };
      q("#onb-next-3").onclick = async () => {
        if (state.busy) return;
        state.busy = true;
        // El importe de moneda/formato ya vive en state.prefs (chips); el nombre de la
        // contraparte se lee del input ANTES de re-renderizar (el render reconstruye el DOM).
        const { currency, locale } = state.prefs;
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
        } catch (e) { state.errorMsg = t("common.saveFailed", { error: userMessage(e) }); }
        state.busy = false;
        render();
      };
    }
    if (state.step === 3) {
      // partner_name ya está persistido (paso 3): renderPeriodoNuevo lo lee de meta al montarse y
      // pinta (o no) el bloque de reparto correctamente. embed:true (D10, P0) suprime su propia
      // cabecera: el «atrás» de este paso (arriba, #onb-back) es el único que se ve.
      renderPeriodoNuevo(q("#onb-periodo"), { mode: "first", embed: true, onDone, onBack: () => render() });
    }
  }

  function renderImportView() {
    const imp = state.imp ?? (state.imp = { fileName: "", needsPass: false, pass: "", errors: [], pending: null, summary: "", busy: false });
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;min-height:calc(100vh - 48px);padding-top:8px;">
        ${subHeaderHtml({ id: "onb-imp-back", title: t("onboarding.import.title") })}
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
        <div style="background:var(--card);border-radius:0;padding:16px;display:flex;flex-direction:column;gap:10px;margin-top:14px;">
          <div class="section-title">${t("onboarding.import.encryptedTitle")}</div>
          <input type="password" id="onb-imp-pass" placeholder="${escAttr(t("onboarding.import.passPlaceholder"))}" autocomplete="off"
            style="border:0;border-radius:0;background:var(--card2);padding:12px 14px;color:var(--text);font-family:inherit;font-size:14px;outline:none;">
          <button type="button" class="btn-primary" id="onb-imp-decrypt" style="width:100%;" ${imp.busy ? "disabled" : ""}>${imp.busy ? t("onboarding.import.decrypting") : t("onboarding.import.decryptBtn")}</button>
        </div>` : ""}
        ${imp.errors.length ? `
        <div class="banner-aviso red" style="display:block;margin-top:14px;"><p>${imp.errors.map(escHtml).join("<br>")}</p></div>` : ""}
        ${imp.pending ? `
        <div style="background:var(--card);border-radius:0;padding:16px;display:flex;flex-direction:column;gap:10px;margin-top:14px;">
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
      imp.fileName = f.name; imp.errors = []; imp.pending = null; imp.pendingAttachments = null; imp.needsPass = false;
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        if (isEncryptedBackup(buf)) { imp.buffer = buf; imp.needsPass = true; render(); return; }
        await parseAndOffer(imp, buf);
      } catch (err) { imp.errors = [t("onboarding.import.readFailed", { error: userMessage(err) })]; render(); }
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
        // WrongPassphraseError sigue teniendo su copy propio (más corto y sin envolver). El resto
        // pasa por userMessage: los demás errores de backup-crypto son UserError y se leen tal
        // cual; un fallo de WebCrypto o de lectura cae al texto genérico.
        imp.errors = [e instanceof WrongPassphraseError ? t("onboarding.import.wrongPass") : t("onboarding.import.decryptFailed", { error: userMessage(e) })];
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
        // Foto del ticket (N5, §9.6): mismo orden y mismo motivo que ajustes.js#btn-import-confirm
        // — las fotos van DESPUÉS del reemplazo y SOLO si fue bien, con TODOS los await antes del
        // reload (en un móvil lento, "en paralelo" a la recarga las pierde a medias). sweep() usa
        // los ids de imp.pending (la BD YA IMPORTADA), nunca los de antes de importar.
        if (attachments) {
          for (const f of imp.pendingAttachments ?? []) await attachments.put(f.id, f.data);
          await attachments.sweep(imp.pending.transactions.map((r) => r.id));
        }
        location.reload(); // boot() reevalúa el gate: con periodos en la copia, el onboarding no vuelve.
      } catch (e) { imp.busy = false; imp.errors = [t("onboarding.import.loadFailed", { error: userMessage(e) })]; imp.pending = null; render(); }
    };
  }

  async function parseAndOffer(imp, plainBuf) {
    try {
      const XLSX = await loadXlsx();
      // unpackRestore distingue un paquete CFB (xlsx + fotos) de un .bce antiguo (xlsx pelado)
      // sin que este código tenga que saber cuál es cuál — ver bundle.js.
      const { xlsx, attachments: fotos } = unpackRestore(XLSX.CFB, plainBuf);
      const wb = XLSX.read(xlsx, { type: "array" });
      const { data, errors: parseErrors } = workbookToRows(XLSX, wb);
      const errors = [...parseErrors, ...validateImport(data)];
      if (errors.length) { imp.errors = errors.slice(0, 5); render(); return; }
      imp.pending = data;
      // Las fotos sobreviven a «cancelar» (#onb-imp-clear/#onb-imp-back descartan `imp` entero):
      // nada toca OPFS hasta #onb-imp-go.
      imp.pendingAttachments = fotos;
      imp.summary = [
        t("onboarding.import.summaryAccounts", { n: data.accounts.length }),
        t("onboarding.import.summaryPeriods", { n: data.periods.length }),
        t("onboarding.import.summaryMovements", { n: data.transactions.length }),
      ].join(", ");
      render();
    } catch (e) { imp.errors = [t("onboarding.import.readFailed", { error: userMessage(e) })]; render(); }
  }
}
