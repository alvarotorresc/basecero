import { dumpAllTables, replaceAll, exportAllJson, getOpenPeriod, getMetaAll, setMeta, setMetaMany, allCategoriesById, retranslateSeedNames, updatePeriodSharePct, listTags, listRules } from "../repo.js";
import { activeSubscriptions, monthlyTotalCents } from "../subscriptions.js";
import { PCT_STEP, normalizePct, stepPct } from "../share-pct.js";
import { quickRegisterEnabled } from "../registro-mode.js";
import { rowsToWorkbook, workbookToRows, validateImport } from "../xlsx.js";
import { hoyISO, fmtDiaCorto, fmtMoney } from "../format.js";
import { renderPeriodoNuevo } from "./periodo-nuevo.js";
import { renderRecurrentes } from "./recurrentes.js";
import { renderSuscripciones } from "./suscripciones.js";
import { renderCategorias } from "./categorias.js";
import { renderEtiquetas } from "./etiquetas.js";
import { renderInforme } from "./informe.js";
import { pushBack, goBack } from "../back.js";
import { importCsv, importWithProfile } from "../n26.js";
import { buildProfile, applyProfile, detectDateFormat, detectDecimal, parseDateIso, parseAmountCents, summarizeReasons } from "../csv-generic.js";
import { encryptBackup, decryptBackup, isEncryptedBackup, WrongPassphraseError, MIN_PASSPHRASE } from "../backup-crypto.js";
import { t, LANGS, activeLang } from "../i18n/index.js";
import { loadXlsx } from "../xlsx-loader.js";
import { userMessage } from "../errors.js";
import { showToast } from "../toast.js";
import { download } from "../download.js";
import { subHeaderHtml, metaHtml } from "../ui.js";
import { icon } from "../icons.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// Botón secundario del sistema (app.css .btn-secondary: píldora --card2, sin borde) — width:100%
// por instancia porque aquí sigue siendo un CTA de ancho completo (mismo criterio de tap-target
// que antes), no el auto-width de la fila de píldoras del artboard.
const BTN_FULL_WIDTH = "width:100%;";

// Input plano sin borde: tile --card2, mismo criterio que los tiles de
// fecha/nombre de periodo-nuevo.js.
const INPUT_STYLE = "background:var(--card2);color:var(--text);border:0;"
  + "border-radius:var(--radius-sm);padding:12px 14px;width:100%;font:500 15px var(--font-ui);outline:none;";

// Formulario público de fallos («¿No funciona?» en Acerca de). Se responde sin cuenta; la app no
// envía nada por su cuenta — solo abre el formulario en una pestaña nueva si el usuario lo pulsa.
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

async function downloadXlsx(dump, filename) {
  const XLSX = await loadXlsx();
  const wb = rowsToWorkbook(XLSX, dump);
  const arr = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  download(new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}

// ======================================================================
// Asistente de mapeo CSV genérico (Task 6, PR E): subvista de Ajustes que se abre cuando
// importCsv() (router de n26.js, Task 5) devuelve needsMapping — banco sin soporte dedicado.
// Spec visual de autoridad: docs/design/material-expresivo/ImportAsistente.dc.html (local,
// git-ignored, no se commitea).
// ======================================================================

// Pastilla de asignación de cabecera: NO reutiliza .chip/.chips de app.css (esas asumen un
// .chip-icon circular a la izquierda que este selector no lleva) — mismo criterio que el
// chipStyle() local de categorias.js (Task 6 PR D); no hay módulo de UI compartido entre
// pantallas para esta variante de pastilla de solo texto.
function assistChipStyle(active) {
  return `display:inline-flex;align-items:center;font-size:12px;font-weight:${active ? 700 : 600};
    background:${active ? "var(--text)" : "var(--card)"};color:${active ? "var(--bg)" : "var(--text-2)"};
    border:0;border-radius:999px;padding:8px 13px;white-space:nowrap;cursor:pointer;
    -webkit-tap-highlight-color:transparent;`;
}

// Fila de chips de asignación de un bloque. `options`: [{value,label}] — value=null representa
// "sin columna" (solo Contraparte lo ofrece). Las cabeceras son texto del CSV del usuario, así
// que value/label van SIEMPRE escapados (escAttr/escHtml), nunca confiar en su contenido.
function chipsRowHtml(field, options, selected) {
  return `<div style="display:flex;gap:7px;flex-wrap:wrap;">${options.map(({ value, label }) => {
    const active = value === selected;
    const valueAttr = value === null ? "" : escAttr(value);
    const noneAttr = value === null ? ` data-assist-none="1"` : "";
    return `<button type="button" data-assist-field="${field}" data-assist-value="${valueAttr}"${noneAttr}
      style="${assistChipStyle(active)}">${escHtml(label)}</button>`;
  }).join("")}</div>`;
}

// Nº de filas de datos del CSV completo (cabecera aparte, líneas en blanco fuera) — mismo
// criterio de troceo que nonEmptyLines de csv-generic.js (no exportada de allí: ese módulo es
// CERO-imports a propósito y esta cuenta es puramente de presentación de Ajustes).
function csvDataRowCount(text) {
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.trim() !== "");
  return Math.max(0, lines.length - 1);
}

function firstNonEmpty(values) {
  return (values || []).find((v) => v !== null && v !== undefined && String(v).trim() !== "");
}

// Mandatory ledger pattern (waves 1-2): se guarda la CLAVE del diccionario, no el texto — los
// tres formatos dmy-* comparten el mismo texto mostrado ("día/mes/año"), así que apuntan a la
// misma clave ajustes.assist.dateFormat.dmy.
const DATE_FORMAT_LABEL_KEY = {
  iso: "ajustes.assist.dateFormat.iso",
  "dmy-slash": "ajustes.assist.dateFormat.dmy",
  "dmy-dot": "ajustes.assist.dateFormat.dmy",
  "dmy-dash": "ajustes.assist.dateFormat.dmy",
};

/** Nota bajo el bloque Fecha: verde con la conversión de ejemplo si TODA la muestra parsea con
 *  algún formato ("12/09/2026 → 2026-09-12 · formato día/mes/año detectado", copy del artboard);
 *  roja con el motivo si la columna no reconoce ningún formato; null (sin nota) si aún no hay
 *  columna elegida. Recibe los valores YA extraídos de la muestra para esa columna, no el
 *  profile completo: buildProfile agrega fecha+concepto+contraparte+importe en un único {error},
 *  y esta nota tiene que poder mostrarse aunque otro bloque no esté resuelto todavía.
 *  OJO orden: detectDateFormat ANTES de leer el ejemplo — con muestra vacía devuelve null y
 *  firstNonEmpty también sería undefined, así que decidir primero evita un "undefined → …". */
function dateNoteFor(values) {
  if (values.length === 0) return null;
  const fmt = detectDateFormat(values);
  if (!fmt) return { ok: false, text: t("ajustes.assist.date.unrecognized") };
  const raw = firstNonEmpty(values);
  const iso = parseDateIso(raw, fmt);
  return { ok: true, text: t("ajustes.assist.date.detected", { raw, iso, fmt: t(DATE_FORMAT_LABEL_KEY[fmt]) }) };
}

function amountNoteOk(raw, cents, decimal) {
  const kind = cents < 0 ? t("ajustes.assist.amount.kindExpense") : t("ajustes.assist.amount.kindIncome");
  const decLabel = decimal === "," ? t("ajustes.assist.amount.decimalComma") : t("ajustes.assist.amount.decimalDot");
  return { ok: true, text: t("ajustes.assist.amount.detected", { raw, kind, money: fmtMoney(Math.abs(cents)), dec: decLabel }) };
}

/** Nota bajo el bloque Importe: misma idea que dateNoteFor para importe+decimal.
 *  spec = {kind:"single", values} | {kind:"split", debitValues, creditValues}. En modo cargo/
 *  abono el signo NO se puede leer del propio valor (cargo/abono suelen venir SIN signo, p.ej.
 *  "78,90" en la columna de cargo): lo decide la COLUMNA de origen, igual que applyProfile
 *  (hasDebit ? -Math.abs(parsed) : Math.abs(parsed)) — de ahí el caso split aparte en vez de
 *  reusar sin más la lógica de signo-desde-el-valor de single. */
function amountNoteFor(spec) {
  if (spec.kind === "single") {
    const { values } = spec;
    if (values.length === 0) return null;
    const decimal = detectDecimal(values);
    const raw = firstNonEmpty(values);
    if (raw === undefined) return { ok: false, text: t("ajustes.assist.amount.noSampleSingle") };
    const cents = parseAmountCents(raw, decimal);
    if (cents === null) return { ok: false, text: t("ajustes.assist.amount.unrecognized") };
    return amountNoteOk(raw, cents, decimal);
  }

  const { debitValues, creditValues } = spec;
  if (debitValues.length === 0 && creditValues.length === 0) return null;
  const decimal = detectDecimal([...debitValues, ...creditValues]);
  const debitRaw = firstNonEmpty(debitValues);
  const isDebit = debitRaw !== undefined;
  const raw = isDebit ? debitRaw : firstNonEmpty(creditValues);
  if (raw === undefined) return { ok: false, text: t("ajustes.assist.amount.noSampleSplit") };
  const parsed = parseAmountCents(raw, decimal);
  if (parsed === null) return { ok: false, text: t("ajustes.assist.amount.unrecognized") };
  return amountNoteOk(raw, isDebit ? -Math.abs(parsed) : Math.abs(parsed), decimal);
}

/** Banner de resultado tras CUALQUIER import (directo por el router o vía el asistente): el
 *  texto de siempre + «· N filas ilegibles omitidas» si se descartó alguna fila — applyProfile
 *  (fecha/importe irreconocibles, solo via:"profile") o el propio pipeline (M4: fila de 0,00 o
 *  importe no numérico, cualquier via) + la frase de Bizum SOLO con contraparte configurada Y
 *  via:"n26" — un CSV genérico no tiene forma de distinguir un Bizum de cualquier otro abono. */
function importResultText(res, partnerName) {
  let text = t("ajustes.importResult.summary", { created: res.created, reconciled: res.reconciled, skipped: res.skipped });
  if (res.omitted) {
    text += t("ajustes.importResult.omitted", { n: res.omitted });
  }
  // Registro v2 §5.5: solo cuenta las filas CREADAS que la memoria de comercios pudo categorizar
  // (n26.js#runImportPipeline); una conciliación nunca toca la categoría de la fila existente.
  if (res.categorized) {
    text += t("ajustes.importResult.categorized", { n: res.categorized });
  }
  text += t("ajustes.importResult.tail");
  if (partnerName && res.via === "n26") {
    text += t("ajustes.importResult.bizumHint");
  }
  return text;
}

// Fila-enlace de Ajustes (spec §7.1 bloque 6): 60px, SIN insignia de icono (a diferencia de
// .list-row, que sí la lleva) — nombre + subtítulo opcional + icon("chevronRight"). `first`
// añade el filete superior que abre el grupo; cada fila pone su propio filete inferior, así que
// el grupo entero queda encajonado con un solo filete arriba y uno abajo (Ajustes.dc.html:98-140).
// `subtitleHtml` llega YA seguro (t() de una clave del diccionario, o ya escapado por el llamante):
// este helper no vuelve a escaparlo, igual que metaHtml exige de sus segmentos.
function linkRowHtml({ id, title, subtitleHtml = "", first = false, disabled = false }) {
  return `<button type="button" id="${id}" ${disabled ? "disabled" : ""}
    style="display:flex;align-items:center;gap:14px;padding:10px 0;min-height:60px;width:100%;text-align:left;
    background:none;border:0;${first ? "border-top:1px solid var(--hairline);" : ""}border-bottom:1px solid var(--hairline);
    cursor:pointer;-webkit-tap-highlight-color:transparent;">
    <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;">
      <span style="font-size:15px;font-weight:500;color:var(--ink);">${escHtml(title)}</span>
      ${subtitleHtml ? `<span style="font-size:12px;font-weight:500;color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${subtitleHtml}</span>` : ""}
    </div>
    ${icon("chevronRight", { stroke: "var(--ink-3)" })}
  </button>`;
}

function periodoCardHtml(period, partnerName, periodError) {
  if (!period) return "";
  // start_date puede quedar en el futuro (se puede abrir el periodo unos días antes de que
  // empiece): en ese caso no hay "días transcurridos" que mostrar, así que se omite ese tramo
  // en vez de enseñar un número negativo.
  const dias = Math.floor((new Date(hoyISO() + "T12:00:00") - new Date(period.start_date + "T12:00:00")) / 86400000) + 1;
  const diasTxt = dias >= 1 ? t("ajustes.period.days", { n: dias }) : "";
  const pct = normalizePct(period.my_share_pct, 100);
  // Sin "reparto {mine}/{theirs}" en la fila de metadatos (Ajustes.dc.html:35-39 solo pone
  // "Abierto el… / N días"): el reparto ya lo dice shareHint debajo, y en solo (sin partnerName)
  // ese bloque entero desaparece, así que repetirlo aquí no aportaba nada en ningún caso.
  const metaRow = metaHtml([t("ajustes.period.openedOn", { date: fmtDiaCorto(period.start_date) }), diasTxt]);
  return `
  <section style="margin-bottom:var(--gap-section)">
    <div class="section-title" style="padding-bottom:16px">${t("ajustes.period.title")}</div>
    <div style="display:flex;flex-direction:column;gap:18px;padding:18px 0;border-top:1px solid var(--hairline);border-bottom:1px solid var(--hairline)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <span style="font-size:16px;font-weight:600;color:var(--ink)">${escHtml(period.name)}</span>
        <span class="state-pill">${t("ajustes.period.openLabel")}</span>
      </div>
      ${metaRow}
      ${partnerName ? `
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="flex:1; min-width:0;">
          <div style="font-size:14px; font-weight:600;">${t("ajustes.period.shareLabel")}</div>
          <div style="font-size:12px; font-weight:500; color:var(--ink-3); line-height:1.35;">${t("ajustes.period.shareHint", { name: escHtml(partnerName), pct: 100 - pct })}</div>
        </div>
        <button type="button" id="aj-pct-down" class="stepper-btn lg" aria-label="${escAttr(t("common.split.decreaseAria"))}">${icon("minus")}</button>
        <div class="num" style="font-size:17px; font-weight:600; width:50px; text-align:center; flex-shrink:0;">${pct} %</div>
        <button type="button" id="aj-pct-up" class="stepper-btn lg" aria-label="${escAttr(t("common.split.increaseAria"))}">${icon("plus")}</button>
      </div>
      ${periodError ? `<div class="banner-aviso red">${escHtml(periodError)}</div>` : ""}` : ""}
      <button type="button" id="btn-informe" class="list-row"
        style="width:100%;text-align:left;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;">
        <div class="list-row-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19V10M12 19V5M20 19v-7"></path>
          </svg>
        </div>
        <div class="list-row-body">
          <div class="list-row-title">${t("informe.entry.fromSettings")}</div>
        </div>
        <svg class="list-row-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"></path></svg>
      </button>
      <button type="button" class="btn-secondary" id="btn-cerrar-periodo" style="width:100%">${t("ajustes.period.closeBtn")}</button>
      <div style="font-size:12px;color:var(--ink-3);line-height:1.5">
        ${partnerName
          ? t("ajustes.period.closeNoteWithPartner", { name: escHtml(partnerName) })
          : t("ajustes.period.closeNote")}
      </div>
    </div>
  </section>`;
}

/** Pantalla de Ajustes: export/import de la hoja .xlsx (motor de fase 2), cierre del periodo
 *  abierto (asistente unificado de Task 8), import de CSV vía el router genérico (n26.js,
 *  tarjeta "Banco") con su subvista de asistente de mapeo cuando el banco no se reconoce solo
 *  (Task 6, PR E — antes solo N26, Task 15), entradas-enlace a Recurrentes y Categorías (PR D,
 *  Task 5) y copia JSON de emergencia. */
export async function renderAjustes(container) {
  let openPeriod = null;
  try { openPeriod = await getOpenPeriod(); } catch { openPeriod = null; }

  let metaCfg = { currency: "EUR", locale: "es-ES" };
  try { metaCfg = { ...metaCfg, ...(await getMetaAll()) }; } catch {}
  const partnerName = (metaCfg.partner_name || "").trim();

  // N vivo de la fila "Categorías" — try/catch propio (mismo criterio que openPeriod/metaCfg de
  // arriba): un fallo aquí no debe dejar Ajustes en blanco, solo degradar el sub de esa fila sin
  // el conteo (categoryCount null → catSubtitle omite "N categorías").
  let categoryCount = null;
  try { categoryCount = Object.keys(await allCategoriesById()).length; } catch { categoryCount = null; }
  const catSubtitle = categoryCount != null
    ? t("ajustes.categories.subtitleWithCount", { n: categoryCount })
    : t("ajustes.categories.subtitleNoCount");

  // N de etiquetas ACTIVAS (listTags ya deja fuera archivadas y borradas) — mismo try/catch
  // aislado que categoryCount: un fallo aquí no debe dejar Ajustes en blanco.
  let tagCount = 0;
  try { tagCount = (await listTags()).length; } catch { tagCount = 0; }

  // Subtítulo vivo de la fila "Suscripciones" (Task 6.2, spec §7.1 bloque 6): activeSubscriptions
  // y monthlyTotalCents ya los expone subscriptions.js (P4) sobre las reglas que ya carga
  // Recurrentes/Suscripciones — mismo try/catch aislado que categoryCount/tagCount de arriba.
  let subsCount = 0, subsMonthlyCents = 0;
  try {
    const rules = await listRules();
    subsCount = activeSubscriptions(rules).length;
    subsMonthlyCents = monthlyTotalCents(rules);
  } catch { subsCount = 0; subsMonthlyCents = 0; }
  const subsSubtitle = t("ajustes.subscriptions.subtitleLive", {
    n: subsCount, amount: `<span class="num">${escHtml(fmtMoney(subsMonthlyCents))}</span>`,
  });

  const state = {
    errors: null, pending: null, busy: false, n26Result: null, n26Error: null,
    encExport: false, encImport: null, periodError: "",
    view: "main", assistant: null, // Task 6: subvista de asistente de mapeo (needsMapping)
  };

  async function processImportBuffer(buf) {
    // buf: ArrayBuffer|Uint8Array con un .xlsx EN CLARO (ya descifrado si venía cifrado)
    const XLSX = await loadXlsx();
    const wb = XLSX.read(buf, { type: "array" });
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
    state.pending = { data, currentDump, currentCount: activeCount };
  }

  // Task 6: render() es el despachador de subvista (mismo patrón que categorias.js state.view /
  // patrimonio.js) — renderMain() es el cuerpo de Ajustes de siempre (ni tocado ni reordenado,
  // solo renombrado), renderAssistant() es la subvista nueva del asistente de mapeo.
  function render() {
    if (state.view === "assistant") { renderAssistant(); return; }
    renderMain();
  }

  // Vuelta del asistente de mapeo a Ajustes: es el callback que apunta la entrada de historial
  // (pushBack más abajo), así que el gesto «atrás» del sistema y el ✕ hacen lo mismo.
  function backToMain() {
    state.view = "main";
    state.assistant = null;
    render();
  }

  function renderMain() {
    container.innerHTML = `
      <header class="screen-header"><h1>${t("ajustes.title")}</h1></header>

      <section style="margin-bottom:var(--gap-section)">
        <div class="section-title" style="margin-bottom:4px">${t("ajustes.sheet.title")}</div>
        <p style="color:var(--text-2);font-size:13px;margin-bottom:14px">
          ${t("ajustes.sheet.body")}</p>
        <button type="button" class="btn-secondary" id="btn-xlsx-export" style="${BTN_FULL_WIDTH}" ${state.busy ? "disabled" : ""}>${t("ajustes.sheet.exportBtn")}</button>
        <button type="button" class="btn-secondary" id="btn-xlsx-import" style="${BTN_FULL_WIDTH}margin-top:10px" ${state.busy ? "disabled" : ""}>${t("ajustes.sheet.importBtn")}</button>
        <input type="file" id="xlsx-file-input" accept=".xlsx,.bce" style="display:none">

        ${state.encExport ? `
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:10px">
          <p style="color:var(--text-2);font-size:13px">
            ${t("ajustes.sheet.encWarn.pre")}<strong>${t("ajustes.sheet.encWarn.bold")}</strong>${t("ajustes.sheet.encWarn.post")}</p>
          <input type="password" id="enc-pass-1" style="${INPUT_STYLE}" placeholder="${escAttr(t("ajustes.sheet.passPlaceholder", { min: MIN_PASSPHRASE }))}">
          <input type="password" id="enc-pass-2" style="${INPUT_STYLE}" placeholder="${escAttr(t("ajustes.sheet.passRepeatPlaceholder"))}">
          <div id="enc-error" class="banner-aviso red" style="display:none"></div>
          <div style="display:flex;gap:8px">
            <button type="button" class="btn-secondary" id="btn-enc-cancel" style="flex:1" ${state.busy ? "disabled" : ""}>${t("common.cancel")}</button>
            <button type="button" class="btn-primary" id="btn-enc-confirm" style="flex:1" ${state.busy ? "disabled" : ""}>${t("ajustes.sheet.encConfirmBtn")}</button>
          </div>
        </div>` : `
        <button type="button" class="btn-secondary" id="btn-enc-export" style="${BTN_FULL_WIDTH}margin-top:10px" ${state.busy ? "disabled" : ""}>${t("ajustes.sheet.encExportBtn")}</button>`}

        ${state.errors ? `
        <div class="banner-aviso red" style="margin-top:12px;max-height:200px;overflow-y:auto;display:block">
          ${state.errors.slice(0, 10).map((e) => `<p>${escHtml(e)}</p>`).join("")}
          ${state.errors.length > 10 ? `<p>${t("ajustes.sheet.moreErrors", { n: state.errors.length - 10 })}</p>` : ""}
        </div>` : ""}

        ${state.encImport ? `
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
          <p style="color:var(--text-2);font-size:13px">${t("ajustes.sheet.decIntro")}</p>
          <input type="password" id="dec-pass" style="${INPUT_STYLE}" placeholder="${escAttr(t("ajustes.sheet.decPassPlaceholder"))}">
          <div id="dec-error" class="banner-aviso red" style="display:none"></div>
          <div style="display:flex;gap:8px">
            <button type="button" class="btn-secondary" id="btn-dec-cancel" style="flex:1" ${state.busy ? "disabled" : ""}>${t("common.cancel")}</button>
            <button type="button" class="btn-primary" id="btn-dec-confirm" style="flex:1" ${state.busy ? "disabled" : ""}>${t("ajustes.sheet.decConfirmBtn")}</button>
          </div>
        </div>` : ""}

        ${state.pending ? `
        <div class="banner-aviso" style="margin-top:12px;display:block">
          <p>${t("ajustes.sheet.replaceWarn", { n: state.pending.currentCount })}</p>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button type="button" class="btn-secondary" id="btn-import-cancel" style="flex:1" ${state.busy ? "disabled" : ""}>${t("common.cancel")}</button>
          <button type="button" class="btn-primary" id="btn-import-confirm" style="flex:1" ${state.busy ? "disabled" : ""}>${t("ajustes.sheet.replaceBtn")}</button>
        </div>` : ""}
      </section>

      ${periodoCardHtml(openPeriod, partnerName, state.periodError)}

      <section style="margin-bottom:var(--gap-section)">
        ${linkRowHtml({ id: "btn-recurrentes", title: t("ajustes.recurring.title"), first: true })}
        ${linkRowHtml({ id: "btn-suscripciones", title: t("ajustes.subscriptions.title"), subtitleHtml: subsSubtitle })}
        ${linkRowHtml({ id: "btn-categorias", title: t("ajustes.categories.title"), subtitleHtml: escHtml(catSubtitle) })}
        ${linkRowHtml({ id: "btn-etiquetas", title: t("ajustes.tags.title"), subtitleHtml: escHtml(t("ajustes.tags.sub", { n: tagCount })) })}
        ${linkRowHtml({ id: "btn-n26-import", title: t("ajustes.bank.title"), subtitleHtml: escHtml(t("ajustes.bank.importBtn")), disabled: state.busy })}
        <input type="file" id="n26-file-input" accept=".csv" style="display:none">

        ${state.n26Result ? `
        <div class="banner-aviso" style="margin-top:12px;display:block"><p>${escHtml(state.n26Result)}</p></div>` : ""}
        ${state.n26Error ? `
        <div class="banner-aviso red" style="margin-top:12px;display:block"><p>${escHtml(state.n26Error)}</p></div>` : ""}
      </section>

      <section style="margin-bottom:var(--gap-section)">
        <div class="section-title" style="margin-bottom:4px">${t("ajustes.prefs.title")}</div>
        <p style="color:var(--text-2);font-size:13px;margin-bottom:14px">
          ${t("ajustes.prefs.body")}</p>
        <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:56px;cursor:pointer;margin-bottom:4px;">
          <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
            <span style="font-size:15px;font-weight:600;">${t("ajustes.prefs.quickRegisterLabel")}</span>
            <span style="font-size:12px;color:var(--text-3);">${t("ajustes.prefs.quickRegisterHint")}</span>
          </div>
          <span class="toggle">
            <input type="checkbox" id="pref-quick-register" ${quickRegisterEnabled(metaCfg.quick_register) ? "checked" : ""}>
            <span class="toggle-track"><span class="toggle-knob"></span></span>
          </span>
        </label>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <div style="flex:1;background:var(--card2);border-radius:0;padding:8px 12px;">
            <div class="section-title" style="margin-bottom:2px;">${t("ajustes.prefs.currency")}</div>
            <select id="pref-currency" style="background:none;border:0;color:var(--text);font:700 14px var(--font-ui);width:100%;padding:2px 0;outline:none;">${currencyOptionsHtml(metaCfg.currency)}</select>
          </div>
          <div style="flex:1;background:var(--card2);border-radius:0;padding:8px 12px;">
            <div class="section-title" style="margin-bottom:2px;">${t("ajustes.prefs.format")}</div>
            <select id="pref-locale" style="background:none;border:0;color:var(--text);font:700 14px var(--font-ui);width:100%;padding:2px 0;outline:none;">${localeOptionsHtml(metaCfg.locale)}</select>
          </div>
        </div>
        <label class="field field-stack" style="margin-top:12px;">
          <span class="field-label">${t("ajustes.prefs.language")}</span>
          <select id="pref-lang">${LANGS.map(([v, label]) => `<option value="${escAttr(v)}" ${v === activeLang() ? "selected" : ""}>${escHtml(label)}</option>`).join("")}</select>
        </label>
        <label class="field field-stack" style="margin-top:12px;">
          <span class="field-label">${t("ajustes.prefs.partnerLabel")}</span>
          <input type="text" id="cfg-partner" value="${escAttr(metaCfg.partner_name || "")}" placeholder="${escAttr(t("ajustes.prefs.partnerPlaceholder"))}">
        </label>
        <div style="font-size:11px;color:var(--text-3);">${t("ajustes.prefs.partnerNote")}</div>
        <button type="button" class="btn-secondary" id="btn-prefs-save" style="${BTN_FULL_WIDTH}margin-top:12px" ${state.busy ? "disabled" : ""}>${t("ajustes.prefs.saveBtn")}</button>
      </section>

      <section style="margin-bottom:var(--gap-section)">
        <div class="section-title" style="margin-bottom:14px">${t("ajustes.backup.title")}</div>
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:14px;">
          ${icon("lock", { size: 18, stroke: "var(--ink-3)" })}
          <p style="color:var(--text-2);font-size:13px;line-height:1.45;margin:0">
            ${t("ajustes.backup.body")}</p>
        </div>
        <button type="button" class="btn-secondary" id="btn-json-export" style="${BTN_FULL_WIDTH}">${t("ajustes.backup.exportBtn")}</button>
      </section>

      <section>
        <div class="section-title" style="margin-bottom:6px">${t("ajustes.about.title")}</div>
        <div style="display:flex;flex-direction:column;">
          <a href="${FEEDBACK_URL}" target="_blank" rel="noopener" style="display:flex;align-items:center;height:44px;font-size:14px;font-weight:500;color:var(--accent);text-decoration:none;border-bottom:1px solid var(--hairline);">${t("ajustes.about.feedback")}</a>
          <a href="${escAttr(activeLang() === "en" ? "/en/privacy.html" : "/privacidad.html")}" target="_blank" rel="noopener" style="display:flex;align-items:center;height:44px;font-size:14px;font-weight:500;color:var(--accent);text-decoration:none;border-bottom:1px solid var(--hairline);">${t("ajustes.about.privacy")}</a>
          <a href="https://github.com/alvarotorresc/basecero" target="_blank" rel="noopener" style="display:flex;align-items:center;height:44px;font-size:14px;font-weight:500;color:var(--accent);text-decoration:none;border-bottom:1px solid var(--hairline);">${t("ajustes.about.source")}</a>
          <a href="https://github.com/alvarotorresc/basecero/blob/main/LICENSE" target="_blank" rel="noopener" style="display:flex;align-items:center;height:44px;font-size:14px;font-weight:500;color:var(--accent);text-decoration:none;">${t("ajustes.about.license")}</a>
        </div>
        <p style="color:var(--text-2);font-size:12px;line-height:1.5;margin-top:12px">${t("ajustes.about.feedbackNote")}</p>
      </section>
    `;
    wireMain();
  }

  function wireMain() {
    container.querySelector("#btn-xlsx-export").onclick = async () => {
      state.busy = true; render();
      try {
        await downloadXlsx(await dumpAllTables(), `basecero-${hoyISO()}.xlsx`);
      } catch (e) {
        state.errors = [t("ajustes.sheet.exportFailed", { error: userMessage(e) })];
      } finally {
        state.busy = false; render();
      }
    };

    container.querySelector("#btn-xlsx-import").onclick = () => {
      container.querySelector("#xlsx-file-input").click();
    };

    container.querySelector("#btn-recurrentes").onclick = () => {
      pushBack(() => renderAjustes(container));
      renderRecurrentes(container, goBack);
    };

    container.querySelector("#btn-suscripciones").onclick = () => {
      pushBack(() => renderAjustes(container));
      renderSuscripciones(container, goBack);
    };

    container.querySelector("#btn-categorias").onclick = () => {
      pushBack(() => renderAjustes(container));
      renderCategorias(container, goBack);
    };

    container.querySelector("#btn-etiquetas").onclick = () => {
      pushBack(() => renderAjustes(container));
      renderEtiquetas(container, goBack);
    };

    container.querySelector("#btn-n26-import").onclick = () => {
      container.querySelector("#n26-file-input").click();
    };

    container.querySelector("#n26-file-input").onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = ""; // permite re-seleccionar el MISMO fichero (p.ej. para probar el dedupe)
      if (!file) return;
      state.busy = true; state.n26Result = null; state.n26Error = null; render();
      try {
        const text = await file.text();
        const res = await importCsv(text);
        if (res.needsMapping) {
          // Banco sin soporte dedicado y sin perfil guardado que case: abre el asistente en vez
          // de tocar la base de datos. Nada se ha escrito todavía (importCsv con needsMapping no
          // ejecuta ningún INSERT/UPDATE — ver n26.js).
          pushBack(backToMain);
          state.view = "assistant";
          state.assistant = {
            fileName: file.name, text, headers: res.needsMapping.headers, sample: res.needsMapping.sample,
            totalRows: csvDataRowCount(text),
            date: null, concept: null, counterparty: null,
            amountKind: "single", amountCol: null, debitCol: null, creditCol: null,
            saveBusy: false, saveError: null,
          };
        } else {
          // texto plano: se escapa una única vez al pintarlo (escHtml en el render de más abajo),
          // así que importResultText/partnerName van SIN escapar aquí para no escaparlos dos veces.
          state.n26Result = importResultText(res, partnerName);
        }
      } catch (err) {
        state.n26Error = userMessage(err);
      } finally {
        state.busy = false; render();
      }
    };

    const encBtn = container.querySelector("#btn-enc-export");
    if (encBtn) encBtn.onclick = () => { state.encExport = true; render(); };

    const encCancel = container.querySelector("#btn-enc-cancel");
    if (encCancel) encCancel.onclick = () => { state.encExport = false; render(); };

    const encConfirm = container.querySelector("#btn-enc-confirm");
    if (encConfirm) encConfirm.onclick = async () => {
      const p1 = container.querySelector("#enc-pass-1").value;
      const p2 = container.querySelector("#enc-pass-2").value;
      const errBox = container.querySelector("#enc-error");
      const fail = (msg) => { errBox.textContent = msg; errBox.style.display = "block"; };
      if (p1.length < MIN_PASSPHRASE) return fail(t("ajustes.sheet.passTooShort", { min: MIN_PASSPHRASE }));
      if (p1 !== p2) return fail(t("ajustes.sheet.passMismatch"));
      state.busy = true; render();
      try {
        const XLSX = await loadXlsx();
        const wb = rowsToWorkbook(XLSX, await dumpAllTables());
        const arr = XLSX.write(wb, { type: "array", bookType: "xlsx" });
        const enc = await encryptBackup(arr, p1);
        download(new Blob([enc], { type: "application/octet-stream" }), `basecero-cifrado-${hoyISO()}.bce`);
        state.encExport = false;
      } catch (e) {
        state.errors = [t("ajustes.sheet.exportFailed", { error: userMessage(e) })];
      } finally {
        state.busy = false; render();
      }
    };

    const informeBtn = container.querySelector("#btn-informe");
    if (informeBtn) informeBtn.onclick = () => {
      // Sin body.onboarding (a diferencia de #btn-cerrar-periodo): esto NO es un asistente que
      // cierra nada, es una pantalla de consulta — el tabbar sigue disponible.
      pushBack(() => renderAjustes(container));
      renderInforme(container, goBack);
    };

    const cerrarBtn = container.querySelector("#btn-cerrar-periodo");
    if (cerrarBtn) cerrarBtn.onclick = () => {
      document.body.classList.add("onboarding");
      pushBack(() => {
        document.body.classList.remove("onboarding");
        renderAjustes(container);
      });
      renderPeriodoNuevo(container, { mode: "next", onDone: goBack });
    };

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
    };
    const pctDown = container.querySelector("#aj-pct-down");
    if (pctDown) pctDown.onclick = () => stepShare(-PCT_STEP);
    const pctUp = container.querySelector("#aj-pct-up");
    if (pctUp) pctUp.onclick = () => stepShare(PCT_STEP);

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

    const decCancel = container.querySelector("#btn-dec-cancel");
    if (decCancel) decCancel.onclick = () => { state.encImport = null; render(); };

    const decConfirm = container.querySelector("#btn-dec-confirm");
    if (decConfirm) decConfirm.onclick = async () => {
      const pass = container.querySelector("#dec-pass").value;
      const errBox = container.querySelector("#dec-error");
      if (!pass) {
        const box = container.querySelector("#dec-error");
        box.textContent = t("ajustes.sheet.decPassRequired");
        box.style.display = "block";
        return;
      }
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
          const box = container.querySelector("#dec-error");
          box.textContent = t("ajustes.sheet.decWrongPass");
          box.style.display = "block";
          return;
        }
        // Error estructural (BackupFormatError) u otro: se cierra el formulario y va al banner normal.
        // Los errores de backup-crypto (contraseña incorrecta, fichero dañado, copia de una
        // versión más nueva) son UserError: userMessage los deja pasar tal cual.
        state.errors = [userMessage(err)]; state.encImport = null;
      } finally {
        if (state.busy) { state.busy = false; render(); }
      }
    };

    if (state.pending) {
      container.querySelector("#btn-import-cancel").onclick = () => {
        state.pending = null; render();
      };
      container.querySelector("#btn-import-confirm").onclick = async () => {
        state.busy = true; render();
        try {
          await downloadXlsx(state.pending.currentDump, `basecero-backup-${hoyISO()}.xlsx`);
          await replaceAll(state.pending.data);
          location.reload();
        } catch (err) {
          state.busy = false;
          state.errors = [t("ajustes.sheet.replaceFailed", { error: userMessage(err) })]; state.pending = null;
          render();
        }
      };
    }

    // Un interruptor no es un formulario: guarda AL INSTANTE con setMeta, sin esperar al botón
    // «Guardar preferencias» de la tarjeta (mismo criterio que el toggle de compartido de
    // Registro) — y no recarga la página: currency/locale/lang si tocan textos ya resueltos en la
    // pantalla, esto no cambia nada visible fuera de Ajustes.
    container.querySelector("#pref-quick-register").onchange = async (e) => {
      const value = e.target.checked ? "1" : "0";
      try {
        await setMeta("quick_register", value);
        metaCfg.quick_register = value;
        showToast(t("toast.saved"));
      } catch (err) {
        e.target.checked = !e.target.checked;
        state.errors = [t("ajustes.prefs.saveFailed", { error: userMessage(err) })];
        render();
      }
    };

    container.querySelector("#btn-prefs-save").onclick = async () => {
      // Leer los inputs ANTES de render(): reconstruye el DOM desde metaCfg (el valor
      // guardado), así que leerlos después devolvería el valor antiguo, no el elegido.
      const currency = container.querySelector("#pref-currency").value;
      const locale = container.querySelector("#pref-locale").value;
      const lang = container.querySelector("#pref-lang").value;
      const partner = container.querySelector("#cfg-partner").value.trim();
      state.busy = true; render();
      try {
        // Los cuatro campos de la tarjeta en UN execMany (vía setMetaMany): o quedan las cuatro
        // claves guardadas o ninguna, así currency/locale/lang/partner_name nunca quedan a medias.
        // partner_name va sin bcSanitizeCell a propósito: SheetJS exporta la celda como string (sin riesgo
        // de fórmula) y sanitizar ensuciaría el nombre en toda la UI («+Ana» → «'+Ana»).
        await setMetaMany([["currency", currency], ["locale", locale], ["lang", lang], ["partner_name", partner]]);
        // SIEMPRE (fix round 1): retranslateSeedNames es idempotente y basada en el nombre real de
        // cada fila (ver repo.js), no en si `lang` "cambió" — barato (41 UPDATE condicionales) y
        // cubre el caso de una BD sembrada en un idioma cuyo activeLang() previo ya coincidía con
        // `lang` sin que las filas lo reflejaran.
        await retranslateSeedNames(lang);
        location.reload();
      } catch (err) {
        state.busy = false;
        state.errors = [t("ajustes.prefs.saveFailed", { error: userMessage(err) })];
        render();
      }
    };

    container.querySelector("#btn-json-export").onclick = async () => {
      const data = await exportAllJson();
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
      download(blob, `basecero-backup-${hoyISO()}.json`);
    };
  }

  /** Nota de detección (fecha/importe), ya con el icono fuera del copy (spec §7.2 bloque 3, D14):
   *  la de éxito lleva icon("check") + metaHtml (un solo segmento — el helper no exige más de
   *  uno); la de error se queda como texto plano en --danger, sin icono (no hay «check» que
   *  poner delante de un fallo). */
  function detectionNoteHtml(note) {
    if (!note) return "";
    if (note.ok) {
      return `<div style="display:flex;align-items:flex-start;gap:6px;margin-top:5px;">`
        + icon("check", { size: 16, stroke: "var(--pos)" }) + metaHtml([note.text], { cls: "pos" }) + `</div>`;
    }
    return `<div style="font-size:11px;color:var(--red);margin-top:5px;">${escHtml(note.text)}</div>`;
  }

  /** Subvista "asistente de mapeo" (Task 6, PR E): se abre cuando importCsv() devuelve
   *  needsMapping. Recalcula notas/preview/contador/CTA en cada render a partir de
   *  state.assistant — no hay estado derivado guardado aparte, así que un solo render() tras
   *  cualquier click de chip basta para que todo quede consistente. */
  function renderAssistant() {
    const a = state.assistant;
    const colIdx = (h) => a.headers.indexOf(h);
    const headerOptions = a.headers.map((h) => ({ value: h, label: h }));

    const dateValues = a.date ? a.sample.map((r) => r[colIdx(a.date)]) : [];
    const dateNote = dateNoteFor(dateValues);

    const amountNote = a.amountKind === "single"
      ? amountNoteFor({ kind: "single", values: a.amountCol ? a.sample.map((r) => r[colIdx(a.amountCol)]) : [] })
      : (a.debitCol && a.creditCol
        ? amountNoteFor({
          kind: "split",
          debitValues: a.sample.map((r) => r[colIdx(a.debitCol)]),
          creditValues: a.sample.map((r) => r[colIdx(a.creditCol)]),
        })
        : null);

    // Perfil completo: gate único del CTA (brief: "deshabilitado hasta que buildProfile
    // devuelva perfil válido") y fuente de la preview/contador — NUNCA de los notas de
    // fecha/importe de arriba, que tienen que poder mostrarse aunque otro bloque distinto
    // (concepto/contraparte) siga sin resolver.
    const profile = buildProfile({
      headers: a.headers, date: a.date, concept: a.concept, counterparty: a.counterparty,
      amountKind: a.amountKind, amountCol: a.amountCol, debitCol: a.debitCol, creditCol: a.creditCol,
      sample: a.sample,
    });
    const profileValid = !profile.error;

    let previewHtml = "";
    let readableCount = 0;
    if (profileValid) {
      // Sobre el CSV COMPLETO (a.text), no solo la muestra de 5 filas: el contador "N de M" y el
      // nº de filas de la card de arriba tienen que coincidir con lo que de verdad se va a
      // importar al pulsar Guardar (mismo cálculo que hará importWithProfile).
      const { rows, errors } = applyProfile(a.text, profile, bcParseCsvLine);
      readableCount = rows.length;
      const total = rows.length + errors.length;
      const previewRows = rows.slice(0, 3);
      // La primera línea es --pos salvo el caso extremo de "nada legible" (rows.length === 0):
      // el CTA ya lo bloquea, pero el color lo remarca — decisión tomada al migrar, el artboard
      // solo dibuja el caso feliz. La segunda línea (--warn, con los motivos de summarizeReasons)
      // solo aparece cuando hay algún error (spec §7.2 bloque 5).
      const line1Color = rows.length > 0 ? "var(--green)" : "var(--red)";
      const line1 = t("ajustes.assist.counterOk", { readable: rows.length, total });
      const line2 = errors.length > 0
        ? `${t("ajustes.assist.counterWarnLine", { n: errors.length })}: `
          + t("ajustes.assist.counterReasons", { reasons: summarizeReasons(errors).join(", ") })
        : "";

      previewHtml = `
      <div style="display:flex;flex-direction:column;gap:2px;">
        <div class="section-title" style="margin-bottom:8px;">${t("ajustes.assist.previewTitle")}</div>
        ${previewRows.map((r) => {
          // merchant||note, mismo criterio que movimientos.js (líneas 53/65/76): la contraparte
          // manda como etiqueta reconocible; si no hay columna de contraparte asignada, cae al
          // concepto — ningún campo mapeado queda sin sitio donde mostrarse.
          const label = r.partnerName || r.paymentReference || t("ajustes.assist.noConcept");
          const income = r.amountCents >= 0;
          return `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--rule);">
            <div style="width:20px;height:20px;border-radius:var(--r-circle);background:var(--pos-tint);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              ${icon("check", { size: 14, stroke: "var(--pos)" })}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:14px;font-weight:500;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(label)}</div>
              <div class="num" style="font-size:11px;color:var(--ink-3);">${escHtml(r.bookingDate)}</div>
            </div>
            <div class="num" style="font-size:15px;font-weight:600;${income ? "color:var(--green);" : ""}">${escHtml(fmtMoney(r.amountCents))}</div>
          </div>`;
        }).join("")}
        <div style="display:flex;flex-direction:column;gap:4px;padding-top:10px;">
          <span style="font-size:12px;font-weight:600;color:${line1Color};">${escHtml(line1)}</span>
          ${line2 ? `<span style="font-size:12px;font-weight:500;color:var(--warn);line-height:1.5;">${escHtml(line2)}</span>` : ""}
        </div>
      </div>`;
    }

    // 0 filas legibles (rows.length === 0 con profile válido) no debe dejar guardar un perfil que
    // no importaría nada. Si !profileValid ni siquiera se ejecuta el bloque de arriba y
    // readableCount se queda en 0, así que el OR es correcto sin condición extra.
    const ctaDisabled = !profileValid || a.saveBusy || readableCount === 0;

    container.innerHTML = `
      ${subHeaderHtml({ id: "assist-close", title: t("ajustes.assist.title") })}

      <div style="display:flex;flex-direction:column;gap:26px;">

        <div style="display:flex;align-items:center;gap:12px;">
          <div style="width:44px;height:44px;border-radius:var(--r-0);background:var(--surface-2);border:1px solid var(--hairline-strong);box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            ${icon("file", { stroke: "var(--ink-2)" })}
          </div>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;">
            <span style="font-size:15px;font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(a.fileName)}</span>
            ${metaHtml([t("ajustes.assist.rowCount", { n: a.totalRows }), t("ajustes.assist.unknownFormat")])}
          </div>
        </div>

        <div>
          <span class="field-label" style="display:block;margin-bottom:7px;">${t("ajustes.assist.dateTitle")}</span>
          ${chipsRowHtml("date", headerOptions, a.date)}
          ${detectionNoteHtml(dateNote)}
        </div>

        <div>
          <span class="field-label" style="display:block;margin-bottom:7px;">${t("ajustes.assist.conceptTitle")}</span>
          ${chipsRowHtml("concept", headerOptions, a.concept)}
        </div>

        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">
            <span class="field-label">${t("ajustes.assist.counterpartyTitle")}</span>
            <span class="state-pill">${t("common.optional")}</span>
          </div>
          ${chipsRowHtml("counterparty", [...headerOptions, { value: null, label: t("ajustes.assist.noColumn") }], a.counterparty)}
        </div>

        <div>
          <span class="field-label" style="display:block;margin-bottom:7px;">${t("ajustes.assist.amountTitle")}</span>
          <div class="segmented" style="border-radius:999px;margin-bottom:8px;">
            <button type="button" data-assist-kind="single" class="${a.amountKind === "single" ? "active" : ""}"
              style="border-radius:999px;${a.amountKind === "single" ? "background:var(--accent);color:var(--accent-ink);font-weight:600;" : ""}">${t("ajustes.assist.amountSingleBtn")}</button>
            <button type="button" data-assist-kind="split" class="${a.amountKind === "split" ? "active" : ""}"
              style="border-radius:999px;${a.amountKind === "split" ? "background:var(--accent);color:var(--accent-ink);font-weight:600;" : ""}">${t("ajustes.assist.amountSplitBtn")}</button>
          </div>
          ${a.amountKind === "single" ? chipsRowHtml("amountCol", headerOptions, a.amountCol) : `
          <span class="field-label" style="display:block;margin:0 0 6px;">${t("ajustes.assist.debitTitle")}</span>
          ${chipsRowHtml("debitCol", headerOptions, a.debitCol)}
          <span class="field-label" style="display:block;margin:10px 0 6px;">${t("ajustes.assist.creditTitle")}</span>
          ${chipsRowHtml("creditCol", headerOptions, a.creditCol)}`}
          ${detectionNoteHtml(amountNote)}
        </div>

        ${previewHtml}

        ${a.saveError ? `<div class="banner-aviso red" style="display:block"><p>${escHtml(a.saveError)}</p></div>` : ""}

        <button type="button" class="btn-primary" id="assist-save" style="width:100%;${ctaDisabled ? "opacity:0.45;" : ""}" ${ctaDisabled ? "disabled" : ""}>${t("ajustes.assist.saveBtn")}</button>

        <p style="font-size:12px;color:var(--ink-3);line-height:1.5;margin:0;">${t("ajustes.assist.footNote")}</p>
      </div>
    `;
    wireAssistant(profile, profileValid);
  }

  function wireAssistant(profile, profileValid) {
    const a = state.assistant;

    container.querySelector("#assist-close").disabled = a.saveBusy;
    container.querySelector("#assist-close").onclick = () => goBack();

    // Delegación uniforme para las 6 filas de chips (fecha/concepto/contraparte/importe-única/
    // cargo/abono): el nombre del campo viaja en el propio data-attribute, así que un único
    // handler basta — nada de repetir el mismo cableado 6 veces.
    container.querySelectorAll("[data-assist-field]").forEach((b) => {
      b.onclick = () => {
        a[b.dataset.assistField] = b.dataset.assistNone === "1" ? null : b.dataset.assistValue;
        render();
      };
    });

    container.querySelectorAll("[data-assist-kind]").forEach((b) => {
      b.onclick = () => {
        a.amountKind = b.dataset.assistKind;
        // Resetea la selección de importe al cambiar de modo (brief): una columna elegida en
        // "una columna con signo" no tiene sentido como cargo o abono, y viceversa.
        a.amountCol = null; a.debitCol = null; a.creditCol = null;
        render();
      };
    });

    container.querySelector("#assist-save").onclick = async () => {
      if (!profileValid || a.saveBusy) return;
      a.saveBusy = true; a.saveError = null; render();
      try {
        await setMeta("csv_profile", JSON.stringify(profile));
        // El banner que sale al volver cuenta el IMPORT («N movimientos importados»); que el perfil
        // quede guardado para la próxima vez —lo que el usuario acaba de configurar, y que ya no
        // vuelve a ver— no lo dice nadie. Ese es este toast.
        showToast(t("toast.profileSaved"));
        const res = await importWithProfile(a.text, profile);
        // El resultado se deja en state ANTES de goBack(): backToMain corre luego en el popstate
        // y renderMain() ya lo encuentra puesto, así que el banner del import sigue apareciendo.
        state.n26Result = importResultText({ ...res, via: "profile" }, partnerName);
        state.n26Error = null;
        goBack();
      } catch (err) {
        a.saveBusy = false;
        a.saveError = userMessage(err);
        render();
      }
    };
  }

  render();
}
