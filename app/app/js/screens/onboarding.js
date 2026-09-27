// app/js/screens/onboarding.js
// Onboarding de primera ejecución (S13, sistema B): Bienvenida y cuatro pasos —Cuentas, Ajustes,
// Categorías (B-8) y Periodo— sobre #screen con el chrome oculto (body.onboarding lo pone el caller,
// app/js/onboarding.js). Referencia visual: design/exploracion/2026-09-26-tres-direcciones/
// B-Onb-{Bienvenida,Cuentas,Ajustes,Categorias}.dc.html y sus BD-*.
// Sin estado en borrador: cada cuenta se crea en BD al pulsar «Añadir cuenta», las preferencias
// (día de cobro incluido, B-1) se guardan al salir de Ajustes y las categorías desmarcadas se
// archivan al salir de Categorías — antes del Periodo, cuyos límites solo listan raíces activas. Si
// se cierra la pestaña a mitad, el gate (0 periodos) reabre el onboarding con lo ya guardado.
import { fmtMoney, initFormat, hoyISO, currencySymbol } from "../format.js";
import {
  getMetaAll, setMeta, setMetaMany, balancesAt, createAccount, deleteEmptyAccount, replaceAll, retranslateSeedNames,
  getAccountStyle, setAccountFamily, listCategoriesAdmin, archiveCategory, restoreCategoryTree,
} from "../repo.js";
import {
  canLeaveAccounts, accountDraft, ACCOUNT_KINDS, accountKindOf, stepProgress, ONB_STEP,
  onbCategoryRoots, canLeaveCategories, categoryArchiveDiff,
} from "../onboarding-steps.js";
import { normalizePayDay, payDayToMeta, stepPayDay } from "../pay-day.js";
import { familyForAccount } from "../account-colors.js";
import { currencyOptionsHtml, localeOptionsHtml } from "./ajustes.js";
import { renderPeriodoNuevo } from "./periodo-nuevo.js";
import { isEncryptedBackup, decryptBackup, WrongPassphraseError } from "../backup-crypto.js";
import { workbookToRows, validateImport } from "../xlsx.js";
import { t, LANGS, activeLang, initI18n } from "../i18n/index.js";
import { loadXlsx } from "../xlsx-loader.js";
import { userMessage } from "../errors.js";
import { icon } from "../icons.js";
import { subHeaderHtml, buttonHtml } from "../ui.js";
import { segmentedHtml, wireSegmented, stepperHtml, stepsHtml, fieldHtml } from "../controls.js";
import { tileHtml, pickTileHtml, sectionHeaderHtml } from "../entity.js";
import { displayHtml } from "../instrument.js";
import { famClass, familyForCategory } from "../category-colors.js";
import { PCT_STEP, stepPct } from "../share-pct.js";
import { applyTheme, readPref, writePref, getStorage, systemDarkQuery, THEME_PREFS } from "../theme.js";
import { showConfirm } from "../modal.js";
import { showToast } from "../toast.js";
import { attachments } from "../attachments.js";
import { unpackRestore } from "../bundle.js";
import { escHtml, escAttr } from "../esc.js";

// Las tres promesas de B-Onb-Bienvenida: icono de UI (icons.js) + clave de texto.
const PROMISES = [
  ["user", "onboarding.welcome.promise1"],
  ["offline", "onboarding.welcome.promise2"],
  ["phone", "onboarding.welcome.promise3"],
];

// Moneda (B-Onb-Ajustes): Segmented con las tres de siempre y «Otra», que despliega el <select>
// con la lista completa de ajustes.js (currencyOptionsHtml, única fuente de verdad).
const QUICK_CURRENCIES = ["EUR", "USD", "GBP"];
const OTHER_CURRENCY = "__other";

// Logo (D-impl-5): marca, no sistema. Sin un solo color en el marcado: el fondo y la tinta los
// pinta la sección «onboarding» de screens.css con el naranja de marca y su tinta, la única
// lectura de naranja fuera de primario y seleccionado que admite design-rules.test (§Desviaciones).
const LOGO_SVG = `<svg class="onb-logo" width="48" height="48" viewBox="0 0 512 512" aria-hidden="true">
  <rect class="onb-logo-bg" width="512" height="512" rx="112"></rect>
  <path class="onb-logo-line" d="M193.43 112.79A41 42 0 1 0 166 186A41 42 0 1 1 138.57 259.21" stroke-width="40" stroke-linecap="round"></path>
  <rect class="onb-logo-ink" x="149" y="78" width="34" height="216" rx="17"></rect>
  <path class="onb-logo-line" d="M373.43 112.79A41 42 0 1 0 346 186A41 42 0 1 1 318.57 259.21" stroke-width="40" stroke-linecap="round"></path>
  <rect class="onb-logo-ink" x="329" y="78" width="34" height="216" rx="17"></rect>
  <rect class="onb-logo-ink" x="138" y="349" width="236" height="50" rx="25"></rect>
</svg>`;

// Regla bajo la cifra del Display de Bienvenida: la aguja en el cero, marcas cada décima. Las
// clases disp-chart-* son las del gráfico del Display (components.css); la aguja es su línea.
const RULER_SVG = (() => {
  const ticks = Array.from({ length: 10 }, (_, i) => {
    const x = Math.round((318 / 10) * (i + 1));
    return `M${x},24v-${i === 4 || i === 9 ? 10 : 6}`;
  }).join("");
  return `<svg class="disp-chart-svg onb-ruler" viewBox="0 0 318 34" aria-hidden="true">
    <path class="disp-chart-base" d="M0,24 L318,24" stroke-width="1"></path>
    <path class="onb-ruler-tick" d="${ticks}" stroke-width="1.25"></path>
    <path class="disp-chart-line" d="M1.5,24v-18" stroke-width="3" stroke-linecap="round"></path>
    <circle class="disp-chart-line is-dot" cx="1.5" cy="6" r="4.5"></circle>
  </svg>`;
})();

export async function renderOnboarding(container, { onDone }) {
  const meta = await getMetaAll();
  const state = {
    step: ONB_STEP.welcome, // 0 bienvenida · 1 cuentas · 2 ajustes · 3 categorías · 4 periodo
    accounts: await balancesAt(hoyISO()),
    accountStyle: await getAccountStyle(),
    form: { name: "", type: "checking", raw: "" },
    prefs: {
      currency: meta.currency || "EUR",
      locale: meta.locale || "es-ES",
      partner: meta.partner_name || "",
      sharePct: 50,
      otherCurrency: !QUICK_CURRENCIES.includes(meta.currency || "EUR"),
      payDay: normalizePayDay(meta.pay_day),
    },
    // Paso Categorías (B-8): raíces de gasto tal como están en la BD y las marcadas en pantalla.
    cats: null,
    checked: new Set(),
    view: "steps", // "steps" | "import"
    imp: null,
    busy: false,
    errorMsg: "",
  };
  render();

  // ---------- piezas comunes ----------

  /** Barra superior de los pasos 1-4 (B-Onb-Cuentas): atrás, progreso por pasos y «1 de 4». El
   *  atrás vive aquí también en el paso Periodo: #onb-periodo lo reescribe renderPeriodoNuevo. */
  function topBarHtml() {
    const { current, total } = stepProgress(state.step);
    return `<div class="onb-top">
      <button type="button" class="icon-btn" id="onb-back" aria-label="${escAttr(t("common.back"))}">${icon("back")}</button>
      ${stepsHtml({ total, current, ariaLabel: t("onboarding.progress.aria", { n: current, total }) })}
      <span class="num onb-count" aria-hidden="true">${escHtml(t("onboarding.progress.count", { n: current, total }))}</span>
    </div>`;
  }

  function headHtml(titleKey, subtitleKey) {
    return `<header class="onb-head">
      <h1 class="onb-title">${escHtml(t(titleKey))}</h1>
      <span class="onb-sub">${escHtml(t(subtitleKey))}</span>
    </header>`;
  }

  const errorHtml = () => (state.errorMsg
    ? `<p class="onb-msg" role="alert">${icon("warn", { size: 18 })}<span>${escHtml(state.errorMsg)}</span></p>` : "");

  const footHtml = (id) => `<div class="onb-foot">${buttonHtml({ kind: "primary", id, label: t("onboarding.cta.next") })}</div>`;

  // ---------- Bienvenida ----------

  function welcomeHtml() {
    const hint = t("onboarding.welcome.importHint.pre") + `<span class="num">.xlsx</span>`
      + t("onboarding.welcome.importHint.mid") + `<span class="num">.bce</span>` + t("onboarding.welcome.importHint.post");
    return `
    <header class="onb-brand">
      <div class="onb-brand-row">${LOGO_SVG}<h1 class="onb-wordmark">${escHtml(t("onboarding.welcome.brand"))}</h1></div>
      <span class="onb-tagline">${escHtml(t("onboarding.welcome.tagline"))}</span>
    </header>
    ${displayHtml({
      label: t("onboarding.welcome.displayLabel"), value: fmtMoney(0), size: 56,
      led: { state: "ok", text: t("onboarding.welcome.ready") }, slot: RULER_SVG,
    })}
    <ul class="onb-card onb-promises">
      ${PROMISES.map(([key, textKey]) => `<li class="onb-promise">${tileHtml({ icon: key })}<span>${escHtml(t(textKey))}</span></li>`).join("")}
    </ul>
    <div class="onb-foot onb-foot-stack">
      ${buttonHtml({ kind: "primary", id: "onb-start", label: t("onboarding.welcome.startBtn") })}
      ${buttonHtml({ kind: "secondary", id: "onb-import-link", icon: "upload", label: t("onboarding.welcome.importBtn") })}
      <span class="onb-hint">${hint}</span>
    </div>`;
  }

  // ---------- Cuentas ----------

  function accountRowHtml(a, firstCheckingId) {
    // Sin objetivos a propósito: en el onboarding todavía no existe ninguno, y la Hucha que se crea
    // aquí lleva imp como override guardado (setAccountFamily en #onb-acc-add), no por un objetivo.
    const fam = familyForAccount(a, state.accountStyle, []);
    const kindId = accountKindOf(a, fam);
    const kind = ACCOUNT_KINDS.find((k) => k.id === kindId) ?? ACCOUNT_KINDS[0];
    const line = a.id === firstCheckingId ? t("onboarding.account.checkingDefault") : t(`onboarding.account.kind.${kind.id}`);
    return `<li class="onb-acc ${famClass(fam)}">
      ${tileHtml({ fam, icon: kind.icon, onTint: true })}
      <div class="onb-acc-body">
        <span class="onb-acc-name">${escHtml(a.name)}</span>
        <span class="onb-acc-line">${escHtml(line)}</span>
      </div>
      <span class="num onb-acc-amount${a.balance_cents < 0 ? " is-neg" : ""}">${escHtml(fmtMoney(a.balance_cents))}</span>
      <button type="button" class="icon-btn onb-acc-del" data-onb-del="${escAttr(a.id)}" aria-label="${escAttr(t("onboarding.account.deleteAria", { name: a.name }))}">${icon("trash", { size: 18 })}</button>
    </li>`;
  }

  function accountsHtml() {
    const f = state.form;
    const firstCheckingId = state.accounts.find((a) => a.type === "checking")?.id;
    const rows = state.accounts.length
      ? `<ul class="onb-accs">${state.accounts.map((a) => accountRowHtml(a, firstCheckingId)).join("")}</ul>` : "";
    return `
    ${headHtml("onboarding.account.title", "onboarding.account.subtitle")}
    ${rows}
    <section class="onb-card onb-form">
      ${sectionHeaderHtml({ title: state.accounts.length ? t("onboarding.account.addAnotherTitle") : t("onboarding.account.firstTitle") })}
      <div class="onb-kinds" role="group" aria-label="${escAttr(t("onboarding.account.kindGroup"))}">
        ${ACCOUNT_KINDS.map((k) => pickTileHtml({
          fam: k.fam, icon: k.icon, label: t(`onboarding.account.kind.${k.id}`), selected: f.type === k.id, data: { onbKind: k.id },
        })).join("")}
      </div>
      ${fieldHtml({ id: "onb-acc-name", label: t("common.name"), value: f.name, placeholder: t("onboarding.account.namePlaceholder") })}
      ${fieldHtml({ id: "onb-acc-raw", label: t("onboarding.account.balanceTitle"), value: f.raw, inputmode: "decimal", placeholder: "0,00", num: true, suffix: currencySymbol() })}
      <p class="onb-help" id="onb-liability-note"${f.type === "liability" ? "" : " hidden"}>${escHtml(t("onboarding.account.liabilityNote"))}</p>
      ${errorHtml()}
      ${buttonHtml({ kind: "secondary", id: "onb-acc-add", icon: "plus", label: t("onboarding.account.addBtn") })}
    </section>
    ${footHtml("onb-next-2")}`;
  }

  // ---------- Ajustes ----------

  function shareHtml() {
    const p = state.prefs;
    const mine = p.sharePct;
    return `<div class="onb-share" id="onb-share"${p.partner.trim() ? "" : " hidden"}>
      <div class="onb-share-head">
        <span class="onb-share-label">${escHtml(t("onboarding.prefs.shareLabel"))}</span>
        ${stepperHtml({
          id: "onb-share-stepper", value: `${mine} %`, decId: "onb-pct-down", incId: "onb-pct-up",
          decLabel: t("common.split.decreaseAria"), incLabel: t("common.split.increaseAria"),
        })}
      </div>
      <div class="onb-share-bar" aria-hidden="true">
        <span class="onb-share-mine" id="onb-share-mine" style="flex-basis:${mine}%"></span>
        <span class="onb-share-theirs" id="onb-share-theirs" style="flex-basis:${100 - mine}%"></span>
      </div>
      <div class="onb-share-legend">
        <span class="onb-share-you">${escHtml(t("onboarding.prefs.shareYou"))} <span class="num" id="onb-share-you-pct">${mine} %</span></span>
        <span class="onb-share-partner"><span id="onb-share-name">${escHtml(p.partner.trim())}</span> <span class="num" id="onb-share-partner-pct">${100 - mine} %</span></span>
      </div>
    </div>`;
  }

  function prefRowHtml(labelId, labelKey, controlHtml) {
    return `<div class="onb-row"><span class="onb-row-label" id="${labelId}">${escHtml(t(labelKey))}</span>${controlHtml}</div>`;
  }

  function prefsHtml() {
    const p = state.prefs;
    const curValue = p.otherCurrency ? OTHER_CURRENCY : p.currency;
    return `
    ${headHtml("onboarding.prefs.title", "onboarding.prefs.subtitle")}
    <section class="onb-sec">
      ${sectionHeaderHtml({ title: t("onboarding.prefs.sharedTitle"), level: "group", fam: "tra" })}
      <div class="onb-card onb-tinted onb-shared fam-tra">
        ${fieldHtml({ id: "onb-partner", label: t("onboarding.prefs.partnerLabel"), value: p.partner, placeholder: t("onboarding.prefs.partnerPlaceholder") })}
        ${shareHtml()}
      </div>
    </section>
    <section class="onb-sec">
      ${sectionHeaderHtml({ title: t("onboarding.prefs.prefsTitle"), level: "group", fam: "sus" })}
      <div class="onb-card onb-tinted onb-rows fam-sus">
        ${prefRowHtml("onb-cur-label", "onboarding.prefs.currencyLabel", segmentedHtml({
          id: "onb-cur-seg", name: t("onboarding.prefs.currencyLabel"), labelledBy: "onb-cur-label", value: curValue,
          options: [...QUICK_CURRENCIES.map((c) => ({ value: c, label: c })), { value: OTHER_CURRENCY, label: t("onboarding.prefs.currencyOther") }],
        }))}
        <div class="onb-row-extra" id="onb-cur-other"${p.otherCurrency ? "" : " hidden"}>
          <span class="ctl-field"><select class="onb-select" id="onb-currency" aria-label="${escAttr(t("onboarding.prefs.currencyOtherLabel"))}">${currencyOptionsHtml(p.currency)}</select></span>
        </div>
        <div class="onb-hr"></div>
        ${prefRowHtml("onb-lang-label", "onboarding.prefs.language", segmentedHtml({
          id: "onb-lang-seg", name: t("onboarding.prefs.language"), labelledBy: "onb-lang-label", value: activeLang(),
          options: LANGS.map(([v, label]) => ({ value: v, label })),
        }))}
        <div class="onb-hr"></div>
        ${prefRowHtml("onb-theme-label", "theme.label", segmentedHtml({
          id: "onb-theme-seg", name: t("theme.label"), labelledBy: "onb-theme-label", value: readPref(getStorage(window)),
          options: THEME_PREFS.map((v) => ({ value: v, label: t("theme." + v) })),
        }))}
        <div class="onb-hr"></div>
        ${prefRowHtml("onb-locale-label", "onboarding.prefs.formatLabel",
          `<span class="ctl-field onb-select-wrap"><select class="onb-select" id="onb-locale" aria-labelledby="onb-locale-label">${localeOptionsHtml(p.locale)}</select></span>`)}
        <div class="onb-hr"></div>
        <div class="onb-row onb-row-pay">
          <span class="onb-row-label onb-row-stack">
            <span id="onb-pay-label">${escHtml(t("payday.onbLabel"))}</span>
            <span class="onb-row-sub">${escHtml(t("payday.onbSub"))}</span>
          </span>
          ${stepperHtml({
            id: "onb-pay-stepper", value: String(p.payDay), decId: "onb-pay-down", incId: "onb-pay-up",
            decLabel: t("payday.decAria"), incLabel: t("payday.incAria"),
          })}
        </div>
      </div>
      ${errorHtml()}
    </section>
    ${footHtml("onb-next-3")}`;
  }

  // ---------- Categorías (B-8) ----------

  /** Tarjeta de una raíz (B-Onb-Categorias): barra del sólido de su familia, nombre y cuántas
   *  subcategorías, y la casilla en tinta. Toda la tarjeta es la casilla (role=checkbox). Marcada,
   *  con el tinte de la familia; desmarcada, neutra con el texto en dim. */
  function catCardHtml(c) {
    const on = state.checked.has(c.id);
    const fam = familyForCategory(c.id, { [c.id]: { id: c.id, parent_id: "" } });
    const sub = !on ? t("onboardingCategories.unchecked")
      : c.subCount ? t("onboardingCategories.subs", { n: c.subCount }) : t("onboardingCategories.noSubs");
    return `<button type="button" class="onb-cat ${famClass(fam)}" role="checkbox" aria-checked="${on ? "true" : "false"}" data-onb-cat="${escAttr(c.id)}">
      <span class="onb-cat-bar" aria-hidden="true"></span>
      <span class="onb-cat-body"><span class="onb-cat-name">${escHtml(c.name)}</span><span class="onb-cat-sub">${escHtml(sub)}</span></span>
      <span class="ctl-checkbox-box onb-cat-box" aria-hidden="true">${on ? icon("check", { size: 16, width: 2.6 }) : ""}</span>
    </button>`;
  }

  function categoriesHtml() {
    const cats = state.cats ?? [];
    const n = cats.filter((c) => state.checked.has(c.id)).length;
    const count = t("onboardingCategories.count", {
      n: `<span class="num onb-cats-n">${n}</span>`, total: `<span class="num">${cats.length}</span>`,
    });
    return `
    <header class="onb-head onb-head-row">
      <span class="onb-head-text">
        <h1 class="onb-title" id="onb-cats-title">${escHtml(t("onboardingCategories.title"))}</h1>
        <span class="onb-sub">${escHtml(t("onboardingCategories.subtitle"))}</span>
      </span>
      <span class="onb-cats-count" id="onb-cats-count">${count}</span>
    </header>
    <div class="onb-cats-strip" aria-hidden="true">${cats.map((c) => {
      const fam = familyForCategory(c.id, { [c.id]: { id: c.id, parent_id: "" } });
      return `<span class="onb-cats-seg ${famClass(fam)}${state.checked.has(c.id) ? "" : " is-off"}"></span>`;
    }).join("")}</div>
    <div class="onb-cats" role="group" aria-labelledby="onb-cats-title">${cats.map(catCardHtml).join("")}</div>
    <p class="onb-help">${escHtml(t("onboardingCategories.note"))}</p>
    ${errorHtml()}
    ${footHtml("onb-next-cats")}`;
  }

  async function loadCategories() {
    const roots = onbCategoryRoots(await listCategoriesAdmin());
    state.cats = roots;
    state.checked = new Set(roots.filter((r) => r.checked).map((r) => r.id));
  }

  // ---------- Periodo ----------

  // El formulario real de periodo, incrustado (S11, embed:true, sin su propia cabecera):
  // renderPeriodoNuevo rellena #onb-periodo en wire().
  function periodHtml() {
    return `
    ${headHtml("onboarding.period.title", "onboarding.period.subtitle")}
    <div id="onb-periodo" class="onb-periodo"></div>`;
  }

  // ---------- render ----------

  function render({ focus = "" } = {}) {
    if (state.view === "import") { renderImportView(); return; }
    const body = [welcomeHtml, accountsHtml, prefsHtml, categoriesHtml, periodHtml][state.step]();
    container.innerHTML = `<div class="onb-screen${state.step === 0 ? " onb-welcome" : ""}">
      ${state.step > 0 ? topBarHtml() : ""}
      ${body}
    </div>`;
    wire();
    if (focus) container.querySelector(focus)?.focus();
  }

  function wire() {
    const q = (sel) => container.querySelector(sel);
    if (state.step === ONB_STEP.welcome) {
      q("#onb-start").onclick = () => { state.step = ONB_STEP.accounts; render(); };
      q("#onb-import-link").onclick = () => { state.view = "import"; state.imp = null; render(); };
      return;
    }
    q("#onb-back").onclick = () => { if (state.busy) return; state.step -= 1; state.errorMsg = ""; render(); };
    if (state.step === ONB_STEP.accounts) wireAccounts(q);
    if (state.step === ONB_STEP.prefs) wirePrefs(q);
    if (state.step === ONB_STEP.categories) wireCategories(q);
    if (state.step === ONB_STEP.period) {
      // partner_name ya está persistido (paso Ajustes): renderPeriodoNuevo lo lee de meta al
      // montarse y pinta (o no) su bloque de reparto, que arranca en la parte elegida aquí.
      renderPeriodoNuevo(q("#onb-periodo"), {
        mode: "first", embed: true, onDone, onBack: () => render(), initialSharePct: state.prefs.sharePct,
      });
    }
  }

  function wireAccounts(q) {
    const f = state.form;
    q("#onb-acc-name").oninput = (e) => { f.name = e.target.value; };
    q("#onb-acc-raw").oninput = (e) => { f.raw = e.target.value; };
    // Elegir baldosa no repinta (repintar se llevaría el foco): se mueve aria-pressed a mano y se
    // enseña la nota de la deuda.
    const tiles = [...container.querySelectorAll("[data-onb-kind]")];
    for (const b of tiles) {
      b.onclick = () => {
        f.type = b.dataset.onbKind;
        for (const x of tiles) x.setAttribute("aria-pressed", String(x === b));
        q("#onb-liability-note").hidden = f.type !== "liability";
      };
    }
    // Borrar (D9): solo cuentas SIN movimientos — imposible en el onboarding, pero el guard vive
    // en deleteEmptyAccount (que además limpia su familia de meta.account_style).
    container.querySelectorAll("[data-onb-del]").forEach((b) => (b.onclick = () => {
      if (state.busy) return;
      const a = state.accounts.find((x) => x.id === b.dataset.onbDel);
      if (!a) return;
      showConfirm({
        title: t("onboarding.account.deleteTitle"),
        message: t("onboarding.account.deleteBody", { name: a.name, amount: fmtMoney(a.balance_cents) }),
        cancelText: t("common.cancel"),
        confirmText: t("common.delete"),
        destructive: true,
        onConfirm: async () => {
          state.busy = true;
          try {
            const deleted = await deleteEmptyAccount(a.id);
            if (deleted) {
              await reloadAccounts();
            } else {
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
      if (draft.error) { state.errorMsg = draft.error; render({ focus: "#onb-acc-name" }); return; }
      state.busy = true;
      try {
        const id = await createAccount(draft);
        // Hucha (D-impl-2): savings pintada de imp. Las demás se quedan con la familia por defecto
        // de su tipo, sin override.
        if (draft.fam) await setAccountFamily(id, draft.fam);
        await reloadAccounts();
        state.form = { name: "", type: "checking", raw: "" };
        state.errorMsg = "";
      } catch (e) { state.errorMsg = t("onboarding.account.createFailed", { error: userMessage(e) }); }
      state.busy = false;
      render({ focus: "#onb-acc-name" });
    };
    q("#onb-next-2").onclick = () => {
      if (!canLeaveAccounts(state.accounts.length)) { state.errorMsg = t("onboarding.account.needOne"); render(); return; }
      state.step = ONB_STEP.prefs; state.errorMsg = ""; render();
    };
  }

  async function reloadAccounts() {
    [state.accounts, state.accountStyle] = await Promise.all([balancesAt(hoyISO()), getAccountStyle()]);
  }

  /** Reparto: se repinta en su sitio (cifra, barra y leyenda) para no llevarse el foco. */
  function paintShare(q) {
    const mine = state.prefs.sharePct;
    q("#onb-share-stepper .ctl-stepper-value").textContent = `${mine} %`;
    q("#onb-share-mine").style.flexBasis = `${mine}%`;
    q("#onb-share-theirs").style.flexBasis = `${100 - mine}%`;
    q("#onb-share-you-pct").textContent = `${mine} %`;
    q("#onb-share-partner-pct").textContent = `${100 - mine} %`;
  }

  function wirePrefs(q) {
    const p = state.prefs;
    q("#onb-partner").oninput = (e) => {
      p.partner = e.target.value;
      state.errorMsg = "";
      // Sin nombre no hay reparto: el bloque se esconde, sin repintar (se perdería el foco).
      q("#onb-share").hidden = !p.partner.trim();
      q("#onb-share-name").textContent = p.partner.trim();
    };
    q("#onb-pct-down").onclick = () => { p.sharePct = stepPct(p.sharePct, -PCT_STEP); paintShare(q); };
    q("#onb-pct-up").onclick = () => { p.sharePct = stepPct(p.sharePct, PCT_STEP); paintShare(q); };
    // Día de cobro (B-1): se pinta en su sitio (sin repintar, para no llevarse el foco) y se guarda
    // con el resto al pulsar «Seguir».
    const paintPay = () => { q("#onb-pay-stepper .ctl-stepper-value").textContent = String(p.payDay); };
    q("#onb-pay-down").onclick = () => { p.payDay = stepPayDay(p.payDay, -1); paintPay(); };
    q("#onb-pay-up").onclick = () => { p.payDay = stepPayDay(p.payDay, 1); paintPay(); };

    wireSegmented(q("#onb-cur-seg"), (v) => {
      p.otherCurrency = v === OTHER_CURRENCY;
      q("#onb-cur-other").hidden = !p.otherCurrency;
      p.currency = p.otherCurrency ? q("#onb-currency").value : v;
    });
    q("#onb-currency").onchange = (e) => { p.currency = e.target.value; };
    q("#onb-locale").onchange = (e) => { p.locale = e.target.value; };

    // Idioma en caliente — sin location.reload() (reiniciaría el onboarding): initI18n() y
    // documentElement.lang se re-evalúan y render() repinta el paso ya traducido.
    wireSegmented(q("#onb-lang-seg"), async (v) => {
      if (state.busy) return;
      state.busy = true;
      try {
        await setMeta("lang", v);
        // retranslateSeedNames es idempotente (ver repo.js): mismo criterio que ajustes.js.
        await retranslateSeedNames(v);
        initI18n({ lang: v });
        document.documentElement.lang = v;
      } catch (e) { state.errorMsg = t("common.saveFailed", { error: userMessage(e) }); }
      state.busy = false;
      render({ focus: '#onb-lang-seg [aria-checked="true"]' });
    });

    // Tema (theme.js, igual que Ajustes): al instante, a localStorage, sin repintar.
    wireSegmented(q("#onb-theme-seg"), (pref) => {
      writePref(getStorage(window), pref);
      applyTheme(document, pref, systemDarkQuery(window));
    });

    q("#onb-next-3").onclick = async () => {
      if (state.busy) return;
      state.busy = true;
      const { currency, locale } = p;
      const partner = p.partner.trim();
      try {
        await setMetaMany([["currency", currency], ["locale", locale], ["partner_name", partner], ["pay_day", payDayToMeta(p.payDay)]]);
        p.partner = partner;
        // Sin location.reload() (reiniciaría el onboarding): formateadores en caliente, como boot().
        initFormat({ currency, locale });
        // documentElement.lang es el IDIOMA de la UI (activeLang()), no el locale de formato.
        document.documentElement.lang = activeLang();
        await loadCategories();
        state.step = ONB_STEP.categories;
        state.errorMsg = "";
      } catch (e) { state.errorMsg = t("common.saveFailed", { error: userMessage(e) }); }
      state.busy = false;
      render();
    };
  }

  /** Categorías (B-8): marcar y desmarcar solo cambia la pantalla (en su sitio, sin repintar: el
   *  foco se queda en la tarjeta). Al pulsar «Seguir» se escribe la diferencia con la BD: las
   *  desmarcadas se archivan (archiveCategory, con sus hijas en cascada) y las que se vuelven a
   *  marcar tras un «atrás» se recuperan con sus hijas (restoreCategoryTree). */
  function wireCategories(q) {
    const cards = [...container.querySelectorAll("[data-onb-cat]")];
    for (const b of cards) {
      b.onclick = () => {
        const id = b.dataset.onbCat;
        if (state.checked.has(id)) state.checked.delete(id); else state.checked.add(id);
        const c = state.cats.find((x) => x.id === id);
        b.outerHTML = catCardHtml(c);
        state.errorMsg = "";
        paintCategoriesChrome();
        wireCategories(q);
        container.querySelector(`[data-onb-cat="${CSS.escape(id)}"]`)?.focus();
      };
    }
    q("#onb-next-cats").onclick = async () => {
      if (state.busy) return;
      if (!canLeaveCategories(state.checked.size)) { state.errorMsg = t("onboardingCategories.needOne"); render(); return; }
      state.busy = true;
      try {
        const { archive, restore } = categoryArchiveDiff(state.cats, state.checked);
        for (const id of archive) await archiveCategory(id);
        for (const id of restore) await restoreCategoryTree(id);
        await loadCategories();
        state.step = ONB_STEP.period;
        state.errorMsg = "";
      } catch (e) { state.errorMsg = t("common.saveFailed", { error: userMessage(e) }); }
      state.busy = false;
      render();
    };
  }

  /** Recuento «10 de 12» y franja de colores del paso Categorías, sin repintar la rejilla. */
  function paintCategoriesChrome() {
    const n = state.cats.filter((c) => state.checked.has(c.id)).length;
    const countEl = container.querySelector("#onb-cats-count");
    if (countEl) countEl.innerHTML = t("onboardingCategories.count", {
      n: `<span class="num onb-cats-n">${n}</span>`, total: `<span class="num">${state.cats.length}</span>`,
    });
    const segs = container.querySelectorAll(".onb-cats-seg");
    state.cats.forEach((c, i) => segs[i]?.classList.toggle("is-off", !state.checked.has(c.id)));
    const msg = container.querySelector(".onb-msg");
    if (msg) msg.remove();
  }

  // ---------- Importar una hoja o copia ----------

  function renderImportView() {
    const imp = state.imp ?? (state.imp = { fileName: "", needsPass: false, pass: "", errors: [], pending: null, summary: "", busy: false });
    const intro = t("onboarding.import.introPre") + `<span class="num">.xlsx</span>`
      + t("onboarding.import.introMid") + `<span class="num">.bce</span>` + t("onboarding.import.introPost");
    container.innerHTML = `<div class="onb-screen">
      ${subHeaderHtml({ id: "onb-imp-back", title: t("onboarding.import.title") })}
      <p class="onb-lead">${intro}</p>
      <input type="file" id="onb-imp-file" accept=".xlsx,.bce" hidden>
      ${!imp.fileName
        ? buttonHtml({ kind: "primary", id: "onb-imp-choose", label: t("onboarding.import.chooseFileBtn") })
        : `<div class="onb-card onb-imp-file">
            ${tileHtml({ icon: "file" })}
            <span class="onb-imp-name">${escHtml(imp.fileName)}</span>
            ${buttonHtml({ kind: "secondary", size: "s", id: "onb-imp-clear", label: t("onboarding.import.changeBtn") })}
          </div>`}
      ${imp.needsPass ? `
      <section class="onb-card onb-imp-block">
        ${sectionHeaderHtml({ title: t("onboarding.import.encryptedTitle") })}
        ${fieldHtml({ id: "onb-imp-pass", type: "password", label: t("onboarding.import.passPlaceholder") })}
        ${buttonHtml({ kind: "primary", id: "onb-imp-decrypt", disabled: imp.busy, label: imp.busy ? t("onboarding.import.decrypting") : t("onboarding.import.decryptBtn") })}
      </section>` : ""}
      ${imp.errors.length ? `<div class="onb-msg" role="alert">${icon("warn", { size: 18 })}<span>${imp.errors.map(escHtml).join("<br>")}</span></div>` : ""}
      ${imp.pending ? `
      <section class="onb-card onb-imp-block">
        ${sectionHeaderHtml({ title: t("onboarding.import.readyTitle") })}
        <p class="onb-imp-summary">${escHtml(imp.summary)}</p>
        ${buttonHtml({ kind: "primary", id: "onb-imp-go", disabled: imp.busy, label: imp.busy ? t("onboarding.import.loading") : t("onboarding.import.loadBtn") })}
      </section>` : ""}
    </div>`;
    wireImportView(imp);
  }

  function wireImportView(imp) {
    const q = (sel) => container.querySelector(sel);
    q("#onb-imp-back").onclick = () => { state.view = "steps"; state.imp = null; render(); };
    const file = q("#onb-imp-file");
    const choose = q("#onb-imp-choose");
    if (choose) choose.onclick = () => file.click();
    file.onchange = async (e) => {
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
        // WrongPassphraseError tiene su copy propio; el resto pasa por userMessage.
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
        // Foto del ticket (N5, §9.6): mismo orden y motivo que ajustes.js#btn-import-confirm — las
        // fotos van DESPUÉS del reemplazo y SOLO si fue bien, con TODOS los await antes del reload.
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
      // unpackRestore distingue un paquete CFB (xlsx + fotos) de un .bce antiguo (xlsx pelado).
      const { xlsx, attachments: fotos } = unpackRestore(XLSX.CFB, plainBuf);
      const wb = XLSX.read(xlsx, { type: "array" });
      const { data, errors: parseErrors } = workbookToRows(XLSX, wb);
      const errors = [...parseErrors, ...validateImport(data)];
      if (errors.length) { imp.errors = errors.slice(0, 5); render(); return; }
      imp.pending = data;
      // Las fotos sobreviven a «cancelar»: nada toca OPFS hasta #onb-imp-go.
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
