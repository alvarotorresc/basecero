import { dumpAllTables, replaceAll, exportAllJson, getOpenPeriod, getMetaAll, setMeta, setMetaMany, retranslateSeedNames, updatePeriodSharePct, listExpenseRootCategories, allCategoriesById } from "../repo.js";
import { familyForCategory, famClass } from "../category-colors.js";
import { PCT_STEP, normalizePct, stepPct } from "../share-pct.js";
import { quickRegisterEnabled } from "../registro-mode.js";
import { normalizePayDay, payDayToMeta, stepPayDay } from "../pay-day.js";
import { rowsToWorkbook, workbookToRows, validateImport } from "../xlsx.js";
import { hoyISO, fmtDiaCorto } from "../format.js";
import { renderPeriodoNuevo } from "./periodo-nuevo.js";
import { renderRecurrentes } from "./recurrentes.js";
import { renderSuscripciones } from "./suscripciones.js";
import { renderCategorias } from "./categorias.js";
import { renderEtiquetas } from "./etiquetas.js";
import { renderInforme } from "./informe.js";
import { pushBack, goBack } from "../back.js";
import { previewCsv } from "../n26.js";
import { renderImportAssistant, newAssistantState, newReviewState } from "./importar.js";
import { encryptBackup, decryptBackup, isEncryptedBackup, WrongPassphraseError, MIN_PASSPHRASE } from "../backup-crypto.js";
import { t, LANGS, activeLang } from "../i18n/index.js";
import { loadXlsx } from "../xlsx-loader.js";
import { userMessage } from "../errors.js";
import { showToast } from "../toast.js";
import { attachments } from "../attachments.js";
import { packBundle, unpackRestore } from "../bundle.js";
import { download } from "../download.js";
import { rootHeaderHtml, buttonHtml } from "../ui.js";
import { segmentedHtml, wireSegmented, switchHtml, stepperHtml, fieldHtml } from "../controls.js";
import { settingRowHtml, sectionHeaderHtml, tileHtml } from "../entity.js";
import { applyTheme, readPref, writePref, getStorage, systemDarkQuery, THEME_PREFS } from "../theme.js";
import { icon } from "../icons.js";
import { escHtml, escAttr } from "../esc.js";

// Formulario público de fallos («¿No funciona?»). Se responde sin cuenta; la app no envía nada por
// su cuenta — solo abre el formulario en una pestaña nueva si el usuario lo pulsa.
const FEEDBACK_URL = "https://tally.so/r/PdJa6B";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "MXN", "ARS", "COP", "PEN", "UYU", "BRL", "DOP"];
const LOCALES = [
  ["es-ES", "Español (España)"], ["es-MX", "Español (México)"], ["es-AR", "Español (Argentina)"],
  ["en-US", "English (US)"], ["en-GB", "English (UK)"], ["de-DE", "Deutsch"],
  ["fr-FR", "Français"], ["it-IT", "Italiano"], ["pt-BR", "Português (Brasil)"],
];

export const currencyOptionsHtml = (cur) =>
  [...new Set([cur, ...CURRENCIES])]
    .map((c) => `<option value="${escAttr(c)}" ${c === cur ? "selected" : ""}>${escHtml(c)}</option>`).join("");
export const localeOptionsHtml = (loc) => {
  const known = LOCALES.some(([v]) => v === loc) ? LOCALES : [[loc, loc], ...LOCALES];
  return known.map(([v, label]) => `<option value="${escAttr(v)}" ${v === loc ? "selected" : ""}>${escHtml(label)}</option>`).join("");
};
const localeLabel = (loc) => (LOCALES.find(([v]) => v === loc) ?? [loc, loc])[1];
const langOptionsHtml = (lang) =>
  LANGS.map(([v, label]) => `<option value="${escAttr(v)}" ${v === lang ? "selected" : ""}>${escHtml(label)}</option>`).join("");

async function downloadXlsx(dump, filename) {
  const XLSX = await loadXlsx();
  const wb = rowsToWorkbook(XLSX, dump);
  const arr = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  download(new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}

// ---------- piezas de la pantalla (B-Ajustes) ----------

// Familia de cada grupo, como en B-Ajustes: Periodo y reparto en Cielo, Preferencias en
// Suscripciones, Organizar en Alimentación y Tus datos en Casa.
const GROUP_FAM = { period: "tra", prefs: "sus", organize: "ali", data: "casa" };

/** Fila de ajuste de un grupo con la receta del original (aprobada el 2026-09-27): baldosa rellena
 *  del sólido de la familia del grupo con icono claro y el valor en su -x. */
const famRow = (fam) => (o) => settingRowHtml({ fam, tileFilled: true, valueInFam: true, ...o });

/** Grupo (B-Ajustes, con la excepción aprobada el 2026-09-27): encabezado en Unbounded 13 con el -x
 *  de su familia, como el original, y tarjeta NEUTRA --surface con borde (sin tinte). `rows` son
 *  trozos de HTML ya hechos; entre dos filas va el filete con sangría de baldosa. `after`, fuera de
 *  la tarjeta: la única línea de ayuda del grupo (K14) o los avisos de lo que acaba de pasar. */
function groupHtml({ id, title, fam, rows, after = "" }) {
  return `<section class="aj-group" aria-labelledby="${escAttr(id)}">
    ${sectionHeaderHtml({ title, level: "group", id, fam })}
    <div class="aj-card">${rows.filter(Boolean).join('<div class="aj-sep" aria-hidden="true"></div>')}</div>
    ${after}
  </section>`;
}

/** Fila de ajuste con un <select> nativo encima, invisible: el toque abre el selector del sistema
 *  y la fila se ve como las demás (etiqueta · valor · chevron). No es settingRowHtml porque un
 *  select no puede ir dentro de un botón; usa sus mismas clases. */
function selectRowHtml({ icon: key, fam, label, value, valueNum = false, id, optionsHtml, disabled = false }) {
  return `<div class="ent-set aj-select-row">
    ${tileHtml({ fam, icon: key, size: 30, filled: true })}
    <span class="ent-set-body"><span class="ent-set-label">${escHtml(label)}</span></span>
    <span class="ent-set-value${valueNum ? " num" : ""} ${famClass(fam)} is-fam-ink">${escHtml(value)}</span>
    <span class="ent-chev">${icon("chevronRight", { size: 16 })}</span>
    <select class="aj-select" id="${escAttr(id)}" aria-label="${escAttr(label)}"${disabled ? " disabled" : ""}>${optionsHtml}</select>
  </div>`;
}

/** Aviso en línea (resultado de un import, error de guardado). Neutro: el rojo es para cifras con
 *  signo y lo destructivo (C4, C5), no para un mensaje. `html` llega YA escapado. */
const msgHtml = (html, { error = false, id = "", hidden = false } = {}) =>
  `<div class="aj-msg${error ? " aj-msg-error" : ""}"${id ? ` id="${escAttr(id)}"` : ""} role="${error ? "alert" : "status"}"${hidden ? " hidden" : ""}>`
  + `${error ? icon("warn", { size: 18 }) : ""}<div class="aj-msg-body">${html}</div></div>`;

/** Pantalla de Ajustes (S4, B-Ajustes): grupos «Periodo y reparto», «Preferencias», «Organizar» y
 *  «Tus datos», y los enlaces de «¿No funciona?». Las filas que editan algo sin salir de Ajustes
 *  (contraparte, reparto, copia cifrada, hoja) despliegan su panel en su sitio: la hoja inferior
 *  llega con PR-09. El importador de extractos (asistente y resultado) vive en importar.js (S12). */
export async function renderAjustes(container) {
  let openPeriod = null;
  try { openPeriod = await getOpenPeriod(); } catch { openPeriod = null; }

  let metaCfg = { currency: "EUR", locale: "es-ES" };
  try { metaCfg = { ...metaCfg, ...(await getMetaAll()) }; } catch {}
  const partnerName = (metaCfg.partner_name || "").trim();

  // Solo para las muestras de color de la fila «Categorías»: si fallan, la fila va sin muestras.
  let rootCats = [], catsById = {};
  try { [rootCats, catsById] = await Promise.all([listExpenseRootCategories(), allCategoriesById()]); } catch { rootCats = []; }

  const state = {
    errors: null, pending: null, busy: false, n26Error: null,
    encImport: null, periodError: "", prefsError: "", payDayError: "",
    // Panel desplegado: "partner" | "share" | "payday" | "enc" | "sheet" | null. Vive en el estado, no en el
    // DOM: cada cambio de `busy` repinta, y el panel no debe plegarse a mitad de una exportación.
    open: null,
    view: "main", assistant: null, // subvista del importador (asistente o resultado), importar.js
  };

  async function processImportBuffer(buf) {
    // buf: ArrayBuffer|Uint8Array EN CLARO (ya descifrado si venía cifrado) — un .xlsx pelado, o
    // un paquete CFB con el .xlsx + fotos (Registro v2 §9.6). unpackRestore distingue los dos
    // SIN tirar de red ni de caso especial aquí: una copia antigua (isBundle a false) devuelve
    // los mismos bytes con attachments: [].
    const XLSX = await loadXlsx();
    const { xlsx, attachments: fotos } = unpackRestore(XLSX.CFB, buf);
    const wb = XLSX.read(xlsx, { type: "array" });
    const { data, errors: parseErrors } = workbookToRows(XLSX, wb);
    const errors = [...parseErrors, ...validateImport(data)];
    if (errors.length) {
      state.errors = errors; state.pending = null;
      return;
    }
    const currentDump = await dumpAllTables();
    state.errors = null;
    // dumpAllTables trae TODAS las filas (incluidas las soft-deleted, necesario para el
    // backup JSON completo) — el aviso de "movimientos actuales" antes de un reemplazo
    // destructivo debe contar solo las visibles, si no infla la cifra con lo ya borrado.
    const activeCount = currentDump.transactions.filter((tx) => !tx.deleted).length;
    // Foto del ticket: las fotos desempaquetadas se guardan JUNTO A los datos en el objeto de
    // confirmación — se descartan con él si el usuario cancela (#btn-import-cancel). Nada toca
    // OPFS antes de confirmar.
    state.pending = { data, attachments: fotos, currentDump, currentCount: activeCount };
  }

  // render() es el despachador de subvista (mismo patrón que categorias.js state.view):
  // renderMain() es Ajustes y el importador (asistente de mapeo y resultado) se pinta desde importar.js.
  function render() {
    if (state.view === "assistant") {
      renderImportAssistant(container, state.assistant, { partnerName });
      return;
    }
    renderMain();
  }

  // Vuelta del importador a Ajustes: es el callback que apunta la entrada de historial
  // (pushBack más abajo), así que el gesto «atrás» del sistema y el ✕ hacen lo mismo.
  function backToMain() {
    state.view = "main";
    state.assistant = null;
    render();
  }

  // ---------- Periodo y reparto ----------

  function periodGroupHtml() {
    const pct = openPeriod ? normalizePct(openPeriod.my_share_pct, 100) : 100;
    const partnerOpen = state.open === "partner";
    // Un error del reparto obliga a ver su panel: si no, el aviso quedaría plegado.
    const shareOpen = state.open === "share" || Boolean(state.periodError);
    const row = famRow(GROUP_FAM.period);
    const rows = [
      row({
        icon: "people", label: t("ajustes.prefs.partnerLabel"), id: "aj-partner",
        value: partnerName || t("ajustes.rows.partnerNone"),
        expanded: partnerOpen, controls: "aj-partner-panel",
      }) + (partnerOpen ? `
      <div class="aj-panel" id="aj-partner-panel">
        ${fieldHtml({ id: "cfg-partner", label: t("ajustes.rows.partnerField"), value: metaCfg.partner_name || "" })}
        <p class="aj-help">${t("ajustes.prefs.partnerNote")}</p>
        <div class="aj-actions">
          ${buttonHtml({ kind: "secondary", id: "btn-partner-save", label: t("common.save"), disabled: state.busy })}
          ${buttonHtml({ kind: "tertiary", id: "btn-partner-cancel", label: t("common.cancel"), disabled: state.busy })}
        </div>
      </div>` : ""),
    ];
    if (openPeriod && partnerName) {
      rows.push(row({
        icon: "split", label: t("ajustes.period.shareLabel"), id: "aj-share",
        value: `${pct} %`, valueNum: true, expanded: shareOpen, controls: "aj-share-panel",
      }) + (shareOpen ? `
      <div class="aj-panel aj-panel-row" id="aj-share-panel">
        <p class="aj-help">${t("ajustes.period.shareHint", { name: escHtml(partnerName), pct: 100 - pct })}</p>
        ${stepperHtml({
          value: `${pct} %`, decId: "aj-pct-down", incId: "aj-pct-up",
          decLabel: t("common.split.decreaseAria"), incLabel: t("common.split.increaseAria"),
        })}
      </div>
      ${state.periodError ? `<div class="aj-panel">${msgHtml(escHtml(state.periodError), { error: true })}</div>` : ""}` : ""));
    }
    // «El periodo empieza» (B-Ajustes, B-1): «Día 1» o «Día de cobro, N». Despliega su paso a paso,
    // que guarda al instante como el reparto. Con o sin periodo abierto: es una preferencia.
    const payDay = normalizePayDay(metaCfg.pay_day);
    const payOpen = state.open === "payday" || Boolean(state.payDayError);
    rows.push(row({
      icon: "calendar", label: t("payday.label"), id: "aj-payday",
      value: payDay > 1 ? t("payday.valuePayDay", { n: payDay }) : t("payday.valueDay1"),
      expanded: payOpen, controls: "aj-payday-panel",
    }) + (payOpen ? `
      <div class="aj-panel aj-panel-row" id="aj-payday-panel">
        <p class="aj-help">${escHtml(t("payday.help"))}</p>
        ${stepperHtml({
          value: String(payDay), decId: "aj-payday-down", incId: "aj-payday-up",
          decLabel: t("payday.decAria"), incLabel: t("payday.incAria"),
        })}
      </div>
      ${state.payDayError ? `<div class="aj-panel">${msgHtml(escHtml(state.payDayError), { error: true })}</div>` : ""}` : ""));
    if (openPeriod) {
      rows.push(row({
        icon: "chart", label: t("informe.entry.fromSettings"), id: "btn-informe",
        sub: t("ajustes.rows.informeSub", { name: openPeriod.name, date: fmtDiaCorto(openPeriod.start_date) }),
      }));
      rows.push(row({ icon: "periodNext", label: t("ajustes.period.closeBtn"), id: "btn-cerrar-periodo" }));
    }
    return groupHtml({ id: "aj-g-period", title: t("ajustes.groups.period"), fam: GROUP_FAM.period, rows });
  }

  // ---------- Preferencias ----------

  function prefsGroupHtml() {
    const lang = activeLang();
    const langLabel = (LANGS.find(([v]) => v === lang) ?? [lang, lang])[1];
    const fam = GROUP_FAM.prefs;
    const row = famRow(fam);
    const rows = [
      row({
        icon: "theme", label: t("theme.label"), id: "theme-row",
        controlHtml: segmentedHtml({
          id: "theme-seg", name: t("theme.label"), labelledBy: "theme-row-label",
          options: THEME_PREFS.map((p) => ({ value: p, label: t("theme." + p) })),
          value: readPref(getStorage(window)),
        }),
      }),
      row({
        icon: "bolt", label: t("ajustes.prefs.quickRegisterLabel"), id: "aj-quick",
        controlHtml: switchHtml({
          id: "pref-quick-register", checked: quickRegisterEnabled(metaCfg.quick_register),
          label: t("ajustes.prefs.quickRegisterLabel"),
        }),
      }),
      selectRowHtml({
        icon: "currency", fam, label: t("ajustes.prefs.currency"), value: metaCfg.currency, valueNum: true,
        id: "pref-currency", optionsHtml: currencyOptionsHtml(metaCfg.currency), disabled: state.busy,
      }),
      selectRowHtml({
        icon: "format", fam, label: t("ajustes.prefs.format"), value: localeLabel(metaCfg.locale),
        id: "pref-locale", optionsHtml: localeOptionsHtml(metaCfg.locale), disabled: state.busy,
      }),
      selectRowHtml({
        icon: "globe", fam, label: t("ajustes.prefs.language"), value: langLabel,
        id: "pref-lang", optionsHtml: langOptionsHtml(lang), disabled: state.busy,
      }),
    ];
    const after = state.prefsError ? msgHtml(escHtml(state.prefsError), { error: true }) : "";
    return groupHtml({ id: "aj-g-prefs", title: t("ajustes.groups.prefs"), fam, rows, after });
  }

  // ---------- Organizar ----------

  /** Muestras de «Categorías» (B-Ajustes): una barrita del sólido de cada familia de las primeras
   *  categorías raíz de gasto, sin repetir, hasta seis. Decorativas: el nombre lo lleva la fila. */
  function catSwatchesHtml() {
    const fams = [...new Set(rootCats.map((c) => familyForCategory(c.id, catsById)).filter(Boolean))].slice(0, 6);
    if (!fams.length) return "";
    return `<span class="aj-cat-swatches" aria-hidden="true">${fams.map((f) => `<span class="aj-cat-swatch ${famClass(f)}"></span>`).join("")}</span>`;
  }

  function organizeGroupHtml() {
    const fam = GROUP_FAM.organize;
    const row = famRow(fam);
    return groupHtml({
      id: "aj-g-organize", title: t("ajustes.groups.organize"), fam, rows: [
        row({ icon: "sus", label: t("ajustes.recurring.title"), id: "btn-recurrentes" }),
        row({ icon: "screen", label: t("ajustes.subscriptions.title"), id: "btn-suscripciones" }),
        row({ icon: "grid", label: t("ajustes.categories.title"), id: "btn-categorias", trailHtml: catSwatchesHtml() }),
        row({ icon: "tag", label: t("ajustes.tags.title"), id: "btn-etiquetas" }),
      ],
    });
  }

  // ---------- Tus datos ----------

  function encPanelHtml() {
    return `
      <div class="aj-panel" id="aj-enc-panel">
        <p class="aj-help">${t("ajustes.sheet.encWarn.pre")}<strong>${t("ajustes.sheet.encWarn.bold")}</strong>${t("ajustes.sheet.encWarn.post")}</p>
        ${fieldHtml({ id: "enc-pass-1", type: "password", label: t("ajustes.sheet.passPlaceholder", { min: MIN_PASSPHRASE }) })}
        ${fieldHtml({ id: "enc-pass-2", type: "password", label: t("ajustes.sheet.passRepeatPlaceholder") })}
        ${msgHtml("", { error: true, id: "enc-error", hidden: true })}
        <div class="aj-actions">
          ${buttonHtml({ kind: "primary", id: "btn-enc-confirm", label: t("ajustes.sheet.encConfirmBtn"), disabled: state.busy })}
          ${buttonHtml({ kind: "tertiary", id: "btn-enc-cancel", label: t("common.cancel"), disabled: state.busy })}
        </div>
      </div>`;
  }

  function sheetPanelHtml() {
    let body;
    if (state.encImport) {
      body = `
        <p class="aj-help">${t("ajustes.sheet.decIntro")}</p>
        ${fieldHtml({ id: "descifrar-pass", type: "password", label: t("ajustes.sheet.decPassPlaceholder") })}
        ${msgHtml("", { error: true, id: "descifrar-error", hidden: true })}
        <div class="aj-actions">
          ${buttonHtml({ kind: "primary", id: "btn-descifrar-confirm", label: t("ajustes.sheet.decConfirmBtn"), disabled: state.busy })}
          ${buttonHtml({ kind: "tertiary", id: "btn-descifrar-cancel", label: t("common.cancel"), disabled: state.busy })}
        </div>`;
    } else if (state.pending) {
      body = `
        ${msgHtml(escHtml(t("ajustes.sheet.replaceWarn", { n: state.pending.currentCount })))}
        <div class="aj-actions">
          ${buttonHtml({ kind: "danger-entry", id: "btn-import-confirm", label: t("ajustes.sheet.replaceBtn"), disabled: state.busy })}
          ${buttonHtml({ kind: "tertiary", id: "btn-import-cancel", label: t("common.cancel"), disabled: state.busy })}
        </div>`;
    } else {
      body = `
        <div class="aj-actions">
          ${buttonHtml({ kind: "secondary", id: "btn-xlsx-export", icon: "download", label: t("ajustes.sheet.exportBtn"), disabled: state.busy })}
          ${buttonHtml({ kind: "secondary", id: "btn-xlsx-import", label: t("ajustes.sheet.importBtn"), disabled: state.busy })}
        </div>
        <p class="aj-help">${t("ajustes.rows.sheetNote")}${attachments?.available() ? ` ${t("ajustes.sheet.attachmentsNote")}.` : ""}</p>`;
    }
    return `<div class="aj-panel" id="aj-sheet-panel">${body}</div>`;
  }

  function dataGroupHtml() {
    const encOpen = state.open === "enc";
    // Descifrar y confirmar un reemplazo viven en el panel de la hoja: lo abren a la fuerza.
    const sheetOpen = state.open === "sheet" || Boolean(state.encImport || state.pending);
    const errors = state.errors ? msgHtml(
      state.errors.slice(0, 10).map((e) => `<p>${escHtml(e)}</p>`).join("")
      + (state.errors.length > 10 ? `<p>${escHtml(t("ajustes.sheet.moreErrors", { n: state.errors.length - 10 }))}</p>` : ""),
      { error: true }) : "";
    const after = `
      <p class="aj-help">${t("ajustes.backup.body")}</p>
      ${errors}
      ${state.n26Error ? msgHtml(`<p>${escHtml(state.n26Error)}</p>`, { error: true }) : ""}
      <input type="file" id="xlsx-file-input" accept=".xlsx,.bce" hidden>
      <input type="file" id="n26-file-input" accept=".csv" hidden>`;
    const row = famRow(GROUP_FAM.data);
    return groupHtml({
      id: "aj-g-data", title: t("ajustes.groups.data"), fam: GROUP_FAM.data, after, rows: [
        row({ icon: "lock", label: t("ajustes.rows.enc"), id: "aj-enc", value: ".bce", valueNum: true,
          expanded: encOpen, controls: "aj-enc-panel", disabled: state.busy }) + (encOpen ? encPanelHtml() : ""),
        row({ icon: "table", label: t("ajustes.rows.sheet"), id: "aj-sheet", value: ".xlsx", valueNum: true,
          expanded: sheetOpen, controls: "aj-sheet-panel", disabled: state.busy }) + (sheetOpen ? sheetPanelHtml() : ""),
        row({ icon: "bank", label: t("ajustes.rows.bank"), id: "btn-n26-import", value: "CSV", valueNum: true, disabled: state.busy }),
        row({ icon: "download", label: t("ajustes.rows.json"), id: "btn-json-export", value: "JSON", valueNum: true }),
      ],
    });
  }

  // ---------- ¿No funciona? ----------

  function linksHtml() {
    const link = (href, label) => `<a class="aj-link" href="${escAttr(href)}" target="_blank" rel="noopener">${escHtml(label)}</a>`;
    return `<footer class="aj-foot">
      <nav class="aj-links" aria-label="${escAttr(t("ajustes.about.title"))}">
        ${link(FEEDBACK_URL, t("ajustes.about.feedback"))}
        ${link(activeLang() === "en" ? "/en/privacy.html" : "/privacidad.html", t("ajustes.about.privacy"))}
        ${link("https://github.com/alvarotorresc/basecero", t("ajustes.about.source"))}
        ${link("https://github.com/alvarotorresc/basecero/blob/main/LICENSE", t("ajustes.about.license"))}
      </nav>
      <p class="aj-help">${t("ajustes.about.feedbackNote")}</p>
    </footer>`;
  }

  function renderMain() {
    container.innerHTML = `
      ${rootHeaderHtml({ title: t("ajustes.title") })}
      <div class="aj-screen">
        ${periodGroupHtml()}
        ${prefsGroupHtml()}
        ${organizeGroupHtml()}
        ${dataGroupHtml()}
        ${linksHtml()}
      </div>
    `;
    wireMain();
  }

  /** Guarda las cuatro preferencias de siempre en UN execMany (vía setMetaMany): o quedan las
   *  cuatro claves o ninguna, así currency/locale/lang/partner_name nunca quedan a medias. Antes
   *  las guardaba el botón «Guardar preferencias»; ahora cada fila guarda al cambiar, con lo demás
   *  tal como está guardado. Recarga, como antes: formato, moneda e idioma tocan textos ya
   *  resueltos en toda la app. */
  async function savePrefs(changes) {
    const next = {
      currency: metaCfg.currency, locale: metaCfg.locale, lang: activeLang(),
      partner_name: metaCfg.partner_name || "", ...changes,
    };
    state.busy = true; render();
    try {
      // partner_name va sin bcSanitizeCell a propósito: SheetJS exporta la celda como string (sin
      // riesgo de fórmula) y sanitizar ensuciaría el nombre en toda la UI («+Ana» → «'+Ana»).
      await setMetaMany([["currency", next.currency], ["locale", next.locale], ["lang", next.lang], ["partner_name", next.partner_name]]);
      // SIEMPRE (fix round 1): retranslateSeedNames es idempotente y basada en el nombre real de
      // cada fila (ver repo.js), no en si `lang` "cambió" — barato (41 UPDATE condicionales) y
      // cubre el caso de una BD sembrada en un idioma cuyo activeLang() previo ya coincidía con
      // `lang` sin que las filas lo reflejaran.
      await retranslateSeedNames(next.lang);
      location.reload();
    } catch (err) {
      state.busy = false;
      state.prefsError = t("ajustes.prefs.saveFailed", { error: userMessage(err) });
      render();
    }
  }

  /** Despliega o pliega un panel; abrir uno pliega el que hubiera. */
  function toggle(key) {
    state.open = state.open === key ? null : key;
    render();
    container.querySelector(`[aria-controls="aj-${key}-panel"]`)?.focus();
  }

  function wireMain() {
    const on = (sel, fn) => { const el = container.querySelector(sel); if (el) el.onclick = fn; };

    // --- Periodo y reparto ---
    on("#aj-partner", () => toggle("partner"));
    on("#btn-partner-cancel", () => { state.open = null; render(); });
    on("#btn-partner-save", () => {
      // Leer el campo ANTES de render(): reconstruye el DOM desde metaCfg.
      const partner = container.querySelector("#cfg-partner").value.trim();
      savePrefs({ partner_name: partner });
    });
    on("#aj-share", () => { state.periodError = ""; toggle("share"); });

    // Día de cobro (B-1): optimista y al instante, como el reparto; si falla, vuelve al guardado.
    on("#aj-payday", () => { state.payDayError = ""; toggle("payday"); });
    const stepPay = async (delta) => {
      const cur = normalizePayDay(metaCfg.pay_day);
      const next = stepPayDay(cur, delta);
      if (next === cur) return;
      metaCfg = { ...metaCfg, pay_day: payDayToMeta(next) };
      try {
        await setMeta("pay_day", payDayToMeta(next));
        state.payDayError = "";
        showToast(t("toast.saved"));
      } catch (e) {
        metaCfg = { ...metaCfg, pay_day: payDayToMeta(cur) };
        state.payDayError = t("common.saveFailed", { error: userMessage(e) });
      }
      state.open = "payday";
      render();
      container.querySelector(delta < 0 ? "#aj-payday-down" : "#aj-payday-up")?.focus();
    };
    on("#aj-payday-down", () => stepPay(-1));
    on("#aj-payday-up", () => stepPay(1));

    on("#btn-informe", () => {
      // Sin body.onboarding (a diferencia de #btn-cerrar-periodo): esto NO es un asistente que
      // cierra nada, es una pantalla de consulta — el tabbar sigue disponible.
      pushBack(() => renderAjustes(container));
      renderInforme(container, goBack);
    });

    on("#btn-cerrar-periodo", () => {
      document.body.classList.add("onboarding");
      pushBack(() => {
        document.body.classList.remove("onboarding");
        renderAjustes(container);
      });
      renderPeriodoNuevo(container, { mode: "next", onDone: goBack });
    });

    const stepShare = async (delta) => {
      const cur = normalizePct(openPeriod.my_share_pct, 100);
      const next = stepPct(cur, delta);
      if (next === cur) return;
      // Optimista: el siguiente toque parte del valor pendiente (si no, dos toques rápidos leen el
      // mismo cur y se pierde uno); si el guardado falla se revierte.
      openPeriod = { ...openPeriod, my_share_pct: next };
      try {
        await updatePeriodSharePct(openPeriod.id, next);
        state.periodError = "";
        // El número ya se había pintado antes de guardar (es optimista): sin acuse de recibo no
        // hay forma de saber si el cambio llegó a la base o se quedó en la pantalla.
        showToast(t("toast.saved"));
      } catch (e) {
        openPeriod = { ...openPeriod, my_share_pct: cur };
        state.periodError = t("ajustes.period.shareSaveFailed", { error: userMessage(e) });
      }
      render();
      // El repintado se lleva el foco de la tecla: se devuelve a la misma, para seguir pulsando.
      container.querySelector(delta < 0 ? "#aj-pct-down" : "#aj-pct-up")?.focus();
    };
    on("#aj-pct-down", () => stepShare(-PCT_STEP));
    on("#aj-pct-up", () => stepShare(PCT_STEP));

    // --- Preferencias ---

    // Tema: se aplica AL INSTANTE y sin recargar ni repintar la pantalla (repintar se llevaría el
    // foco del radio). Va a localStorage, no a la BD: el script en línea del <head> lo tiene que
    // leer antes de que exista la BD.
    wireSegmented(container.querySelector("#theme-seg"), (pref) => {
      writePref(getStorage(window), pref);
      applyTheme(document, pref, systemDarkQuery(window));
    });

    // Un interruptor no es un formulario: guarda AL INSTANTE con setMeta (mismo criterio que el
    // compartido de Registro) y no recarga: no cambia nada visible fuera de Ajustes. Toda la fila
    // lo acciona, como en B-Ajustes; el propio interruptor sigue siendo el control accesible.
    const quick = container.querySelector("#pref-quick-register");
    quick.onclick = async () => {
      const checked = quick.getAttribute("aria-checked") !== "true";
      quick.setAttribute("aria-checked", String(checked));
      const value = checked ? "1" : "0";
      try {
        await setMeta("quick_register", value);
        metaCfg.quick_register = value;
        state.prefsError = "";
        showToast(t("toast.saved"));
      } catch (err) {
        state.prefsError = t("ajustes.prefs.saveFailed", { error: userMessage(err) });
        render(); // repinta desde metaCfg, que sigue con el valor guardado: el interruptor vuelve
      }
    };
    container.querySelector("#aj-quick").onclick = (e) => { if (!quick.contains(e.target)) quick.click(); };

    container.querySelector("#pref-currency").onchange = (e) => savePrefs({ currency: e.target.value });
    container.querySelector("#pref-locale").onchange = (e) => savePrefs({ locale: e.target.value });
    container.querySelector("#pref-lang").onchange = (e) => savePrefs({ lang: e.target.value });

    // --- Organizar ---
    const open = (sel, fn) => on(sel, () => { pushBack(() => renderAjustes(container)); fn(container, goBack); });
    open("#btn-recurrentes", renderRecurrentes);
    open("#btn-suscripciones", renderSuscripciones);
    open("#btn-categorias", renderCategorias);
    open("#btn-etiquetas", renderEtiquetas);

    // --- Tus datos ---
    on("#aj-enc", () => toggle("enc"));
    on("#btn-enc-cancel", () => { state.open = null; render(); });
    on("#btn-enc-confirm", async () => {
      const p1 = container.querySelector("#enc-pass-1").value;
      const p2 = container.querySelector("#enc-pass-2").value;
      const errBox = container.querySelector("#enc-error");
      const fail = (msg) => { errBox.querySelector(".aj-msg-body").textContent = msg; errBox.hidden = false; };
      if (p1.length < MIN_PASSPHRASE) return fail(t("ajustes.sheet.passTooShort", { min: MIN_PASSPHRASE }));
      if (p1 !== p2) return fail(t("ajustes.sheet.passMismatch"));
      state.busy = true; render();
      try {
        const XLSX = await loadXlsx();
        const dump = await dumpAllTables();
        const wb = rowsToWorkbook(XLSX, dump);
        const arr = XLSX.write(wb, { type: "array", bookType: "xlsx" });
        // Foto del ticket (N5, §9.6): SOLO se envuelve en un paquete CFB si hay al menos una
        // foto — sin fotos, el texto en claro sigue siendo el .xlsx pelado, byte a byte como
        // hoy, y una versión anterior de la app lo sigue leyendo.
        const photoIds = dump.transactions.filter((tx) => tx.has_attachment).map((tx) => tx.id);
        const photos = photoIds.length && attachments
          ? (await Promise.all(photoIds.map(async (id) => {
              const blob = await attachments.blob(id);
              // dumpAllTables trae también las filas BORRADAS (comentario más arriba): el borrado
              // lógico no limpia has_attachment y §9.5 SÍ borra el fichero, así que cualquiera que
              // haya borrado un movimiento con foto tiene filas cuyo blob(id) es null. Se
              // descartan aquí — meterlas sería pasarle null a cfb_add.
              return blob ? { name: `attachments/${id}.jpg`, data: new Uint8Array(await blob.arrayBuffer()) } : null;
            }))).filter(Boolean)
          : [];
        const plain = photos.length ? packBundle(XLSX.CFB, [{ name: "data.xlsx", data: arr }, ...photos]) : arr;
        const enc = await encryptBackup(plain, p1);
        download(new Blob([enc], { type: "application/octet-stream" }), `basecero-cifrado-${hoyISO()}.bce`);
        state.open = null;
      } catch (e) {
        state.errors = [t("ajustes.sheet.exportFailed", { error: userMessage(e) })];
      } finally {
        state.busy = false; render();
      }
    });

    on("#aj-sheet", () => {
      // Con un descifrado o un reemplazo a medias el panel no se pliega: se cancela desde dentro.
      if (state.encImport || state.pending) return;
      toggle("sheet");
    });

    on("#btn-xlsx-export", async () => {
      state.busy = true; render();
      try {
        await downloadXlsx(await dumpAllTables(), `basecero-${hoyISO()}.xlsx`);
      } catch (e) {
        state.errors = [t("ajustes.sheet.exportFailed", { error: userMessage(e) })];
      } finally {
        state.busy = false; render();
      }
    });

    on("#btn-xlsx-import", () => container.querySelector("#xlsx-file-input").click());

    container.querySelector("#xlsx-file-input").onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = ""; // permite re-seleccionar el MISMO fichero (p.ej. tras corregirlo y reintentar)
      if (!file) return;
      state.busy = true; render();
      try {
        const buf = await file.arrayBuffer();
        if (isEncryptedBackup(buf)) {
          state.errors = null; state.pending = null; state.encImport = { buf };
        } else {
          state.encImport = null;
          await processImportBuffer(buf);
        }
      } catch (err) {
        state.errors = [t("ajustes.sheet.readFailed", { error: userMessage(err) })]; state.pending = null;
      } finally {
        state.busy = false; render();
      }
    };

    on("#btn-descifrar-cancel", () => { state.encImport = null; render(); });

    on("#btn-descifrar-confirm", async () => {
      const pass = container.querySelector("#descifrar-pass").value;
      const showErr = (msg) => {
        const box = container.querySelector("#descifrar-error");
        box.querySelector(".aj-msg-body").textContent = msg;
        box.hidden = false;
      };
      if (!pass) return showErr(t("ajustes.sheet.decPassRequired"));
      state.busy = true; render();
      try {
        const plain = await decryptBackup(state.encImport.buf, pass);
        state.encImport = null;
        await processImportBuffer(plain);
      } catch (err) {
        if (err instanceof WrongPassphraseError) {
          // El formulario sigue abierto para reintentar; el error va inline, sin re-render
          // (un render() vaciaría el input).
          state.busy = false; render();
          showErr(t("ajustes.sheet.decWrongPass"));
          return;
        }
        // Error estructural (BackupFormatError) u otro: se cierra el formulario y va al banner normal.
        // Los errores de backup-crypto (contraseña incorrecta, fichero dañado, copia de una
        // versión más nueva) son UserError: userMessage los deja pasar tal cual.
        state.errors = [userMessage(err)]; state.encImport = null;
      } finally {
        if (state.busy) { state.busy = false; render(); }
      }
    });

    on("#btn-import-cancel", () => { state.pending = null; render(); });
    on("#btn-import-confirm", async () => {
      state.busy = true; render();
      try {
        await downloadXlsx(state.pending.currentDump, `basecero-backup-${hoyISO()}.xlsx`);
        await replaceAll(state.pending.data);
        // Foto del ticket (N5, §9.6): las fotos van DESPUÉS del reemplazo y SOLO si fue bien —
        // replaceAllStmts conserva los id que trae la hoja, así que attachments/<id>.jpg sigue
        // casando. sweep() usa los ids de la BD YA IMPORTADA (state.pending.data), nunca los de
        // currentDump (la copia de ANTES de importar) — si no, borraría los ficheros que
        // acaba de escribir. Todos los `await` van ANTES de location.reload(): en un móvil
        // lento, "en paralelo" a la recarga las perdería a medias.
        if (attachments) {
          for (const f of state.pending.attachments) await attachments.put(f.id, f.data);
          await attachments.sweep(state.pending.data.transactions.map((r) => r.id));
        }
        location.reload();
      } catch (err) {
        state.busy = false;
        state.errors = [t("ajustes.sheet.replaceFailed", { error: userMessage(err) })]; state.pending = null;
        render();
      }
    });

    on("#btn-n26-import", () => container.querySelector("#n26-file-input").click());

    container.querySelector("#n26-file-input").onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = ""; // permite re-seleccionar el MISMO fichero (p.ej. para probar el dedupe)
      if (!file) return;
      state.busy = true; state.n26Error = null; render();
      try {
        const text = await file.text();
        // Ensayo (B-3): nada se escribe hasta que el usuario revisa y pulsa «Importar» en importar.js.
        const res = await previewCsv(text);
        if (res.needsMapping) {
          // Banco sin soporte dedicado y sin perfil guardado que case: abre el asistente en vez
          // de tocar la base de datos. Nada se ha escrito todavía (previewCsv nunca
          // ejecuta ningún INSERT/UPDATE — ver n26.js).
          pushBack(backToMain);
          state.view = "assistant";
          state.assistant = newAssistantState(file.name, text, res.needsMapping);
        } else {
          // Reconocido solo (N26 o perfil guardado): el importador abre directamente en su paso
          // «Revisar», con el mismo «atrás» que el asistente.
          const review = await newReviewState(file.name, text, res);
          pushBack(backToMain);
          state.view = "assistant";
          state.assistant = review;
        }
      } catch (err) {
        state.n26Error = userMessage(err);
      } finally {
        state.busy = false; render();
      }
    };

    on("#btn-json-export", async () => {
      const data = await exportAllJson();
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
      download(blob, `basecero-backup-${hoyISO()}.json`);
    });
  }

  render();
}
