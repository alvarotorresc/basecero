import { dumpAllTables, replaceAll, exportAllJson, getOpenPeriod, getMetaAll, setMeta, setMetaMany, allCategoriesById } from "../repo.js";
import { rowsToWorkbook, workbookToRows, validateImport } from "../xlsx.js";
import { hoyISO, fmtDiaCorto, fmtMoney } from "../format.js";
import { renderPeriodoNuevo } from "./periodo-nuevo.js";
import { renderRecurrentes } from "./recurrentes.js";
import { renderCategorias } from "./categorias.js";
import { importCsv, importWithProfile } from "../n26.js";
import { buildProfile, applyProfile, detectDateFormat, detectDecimal, parseDateIso, parseAmountCents } from "../csv-generic.js";
import { encryptBackup, decryptBackup, isEncryptedBackup, WrongPassphraseError, MIN_PASSPHRASE } from "../backup-crypto.js";

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

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "MXN", "ARS", "COP", "PEN", "UYU", "BRL", "DOP"];
const LOCALES = [
  ["es-ES", "Español (España)"], ["es-MX", "Español (México)"], ["es-AR", "Español (Argentina)"],
  ["en-US", "English (US)"], ["en-GB", "English (UK)"], ["de-DE", "Deutsch"],
  ["fr-FR", "Français"], ["it-IT", "Italiano"], ["pt-BR", "Português (Brasil)"],
];

const currencyOptionsHtml = (cur) =>
  [...new Set([cur, ...CURRENCIES])]
    .map((c) => `<option value="${escAttr(c)}" ${c === cur ? "selected" : ""}>${escHtml(c)}</option>`).join("");
const localeOptionsHtml = (loc) => {
  const known = LOCALES.some(([v]) => v === loc) ? LOCALES : [[loc, loc], ...LOCALES];
  return known.map(([v, label]) => `<option value="${escAttr(v)}" ${v === loc ? "selected" : ""}>${escHtml(label)}</option>`).join("");
};

function download(blob, filename) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: filename });
  a.click(); URL.revokeObjectURL(a.href);
}

function downloadXlsx(dump, filename) {
  const wb = rowsToWorkbook(window.XLSX, dump);
  const arr = window.XLSX.write(wb, { type: "array", bookType: "xlsx" });
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

const DATE_FORMAT_LABELS = {
  iso: "año-mes-día", "dmy-slash": "día/mes/año", "dmy-dot": "día/mes/año", "dmy-dash": "día/mes/año",
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
  if (!fmt) return { ok: false, text: "No se reconoce el formato de fecha en esta columna." };
  const raw = firstNonEmpty(values);
  const iso = parseDateIso(raw, fmt);
  return { ok: true, text: `✓ ${raw} → ${iso} · formato ${DATE_FORMAT_LABELS[fmt]} detectado` };
}

function amountNoteOk(raw, cents, decimal) {
  const kind = cents < 0 ? "gasto" : "ingreso";
  const decLabel = decimal === "," ? "coma" : "punto";
  return { ok: true, text: `✓ ${raw} → ${kind} de ${fmtMoney(Math.abs(cents))} · decimal con ${decLabel} detectado` };
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
    if (raw === undefined) return { ok: false, text: "La muestra no tiene ningún importe en esta columna." };
    const cents = parseAmountCents(raw, decimal);
    if (cents === null) return { ok: false, text: "No se reconoce el formato de importe en esta columna." };
    return amountNoteOk(raw, cents, decimal);
  }

  const { debitValues, creditValues } = spec;
  if (debitValues.length === 0 && creditValues.length === 0) return null;
  const decimal = detectDecimal([...debitValues, ...creditValues]);
  const debitRaw = firstNonEmpty(debitValues);
  const isDebit = debitRaw !== undefined;
  const raw = isDebit ? debitRaw : firstNonEmpty(creditValues);
  if (raw === undefined) return { ok: false, text: "La muestra no tiene ningún importe de cargo o abono." };
  const parsed = parseAmountCents(raw, decimal);
  if (parsed === null) return { ok: false, text: "No se reconoce el formato de importe en esta columna." };
  return amountNoteOk(raw, isDebit ? -Math.abs(parsed) : Math.abs(parsed), decimal);
}

/** Banner de resultado tras CUALQUIER import (directo por el router o vía el asistente): el
 *  texto de siempre + «· N filas ilegibles omitidas» si applyProfile descartó alguna (omitted,
 *  solo puede venir en via:"profile") + la frase de Bizum SOLO con contraparte configurada Y
 *  via:"n26" — un CSV genérico no tiene forma de distinguir un Bizum de cualquier otro abono. */
function importResultText(res, partnerName) {
  let text = `Nuevas: ${res.created} · Conciliadas: ${res.reconciled} · Duplicadas (saltadas): ${res.skipped}`;
  if (res.omitted) {
    text += ` · ${res.omitted} fila${res.omitted === 1 ? "" : "s"} ilegible${res.omitted === 1 ? "" : "s"} omitida${res.omitted === 1 ? "" : "s"}`;
  }
  text += ". Revisa la bandeja «sin categorizar» en Movimientos.";
  if (partnerName && res.via === "n26") {
    text += ` Los Bizum de ${partnerName} se concilian solos si usas «Liquidar» en Inicio antes de importar.`;
  }
  return text;
}

function periodoCardHtml(period, partnerName) {
  if (!period) return "";
  // start_date puede quedar en el futuro (se puede abrir el periodo unos días antes de que
  // empiece): en ese caso no hay "días transcurridos" que mostrar, así que se omite ese tramo
  // en vez de enseñar un número negativo.
  const dias = Math.floor((new Date(hoyISO() + "T12:00:00") - new Date(period.start_date + "T12:00:00")) / 86400000) + 1;
  const diasTxt = dias >= 1 ? ` · ${dias} día${dias === 1 ? "" : "s"}` : "";
  return `
  <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:12px">
    <div class="section-title">Periodo</div>
    <div class="card" style="display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div style="display:flex;flex-direction:column;gap:3px">
          <div style="font-size:15px;font-weight:700">${escHtml(period.name)}</div>
          <div style="font-size:11px;color:var(--text-3)">
            Abierto el ${fmtDiaCorto(period.start_date)}${diasTxt} · reparto ${period.my_share_pct} / ${100 - period.my_share_pct}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;background:var(--card2);border-radius:10px;padding:6px 9px;flex-shrink:0">
          <div style="width:7px;height:7px;border-radius:4px;background:var(--green)"></div>
          <div style="font-size:11px;font-weight:600;color:var(--text-2)">Abierto</div>
        </div>
      </div>
      <button type="button" class="btn-secondary" id="btn-cerrar-periodo" style="width:100%">Cerrar periodo y abrir el siguiente</button>
      <div style="font-size:11px;color:var(--text-3);line-height:1.5">
        ${partnerName
          ? `Al cerrar fijarás la fecha final y elegirás el reparto con ${escHtml(partnerName)} del periodo nuevo. Ábrelo el día que entre la nómina.`
          : "Al cerrar fijarás la fecha final. Ábrelo el día que entre la nómina."}
      </div>
    </div>
  </div>`;
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
  const catSubtitle = categoryCount != null ? `${categoryCount} categorías · colores e iconos` : "colores e iconos";

  const state = {
    errors: null, pending: null, busy: false, n26Result: null, n26Error: null,
    encExport: false, encImport: null,
    view: "main", assistant: null, // Task 6: subvista de asistente de mapeo (needsMapping)
  };

  async function processImportBuffer(buf) {
    // buf: ArrayBuffer|Uint8Array con un .xlsx EN CLARO (ya descifrado si venía cifrado)
    const wb = window.XLSX.read(buf, { type: "array" });
    const { data, errors: parseErrors } = workbookToRows(window.XLSX, wb);
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
    const activeCount = currentDump.transactions.filter((t) => !t.deleted).length;
    state.pending = { data, currentDump, currentCount: activeCount };
  }

  // Task 6: render() es el despachador de subvista (mismo patrón que categorias.js state.view /
  // patrimonio.js) — renderMain() es el cuerpo de Ajustes de siempre (ni tocado ni reordenado,
  // solo renombrado), renderAssistant() es la subvista nueva del asistente de mapeo.
  function render() {
    if (state.view === "assistant") { renderAssistant(); return; }
    renderMain();
  }

  function renderMain() {
    container.innerHTML = `
      <header class="screen-header"><h1 style="font-size:24px;font-weight:800;letter-spacing:-0.02em;">Ajustes</h1></header>

      <div class="card" style="margin-bottom:12px">
        <p style="font-weight:600;margin-bottom:4px">Tu hoja de cálculo</p>
        <p style="color:var(--text-2);font-size:13px;margin-bottom:14px">
          Exporta todos tus datos a un .xlsx editable en LibreOffice/Sheets, o importa una hoja para sustituir
          los datos actuales. La copia cifrada (.bce) también se importa desde aquí.</p>
        <button type="button" class="btn-primary" id="btn-xlsx-export" ${state.busy ? "disabled" : ""}>Exportar hoja (.xlsx)</button>
        <button type="button" class="btn-secondary" id="btn-xlsx-import" style="${BTN_FULL_WIDTH}margin-top:10px" ${state.busy ? "disabled" : ""}>Importar hoja (.xlsx)</button>
        <input type="file" id="xlsx-file-input" accept=".xlsx,.bce" style="display:none">

        ${state.encExport ? `
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:10px">
          <p style="color:var(--text-2);font-size:13px">
            La copia cifrada (.bce) solo se abre desde BaseCero con esta contraseña.
            <strong>Si la olvidas, la copia es irrecuperable</strong> — no se guarda en ningún sitio.</p>
          <input type="password" id="enc-pass-1" style="${INPUT_STYLE}" placeholder="Contraseña (mín. ${MIN_PASSPHRASE} caracteres)">
          <input type="password" id="enc-pass-2" style="${INPUT_STYLE}" placeholder="Repite la contraseña">
          <div id="enc-error" class="banner-aviso red" style="display:none"></div>
          <div style="display:flex;gap:8px">
            <button type="button" class="btn-secondary" id="btn-enc-cancel" style="flex:1" ${state.busy ? "disabled" : ""}>Cancelar</button>
            <button type="button" class="btn-primary" id="btn-enc-confirm" style="flex:1" ${state.busy ? "disabled" : ""}>Exportar cifrada</button>
          </div>
        </div>` : `
        <button type="button" class="btn-secondary" id="btn-enc-export" style="${BTN_FULL_WIDTH}margin-top:10px" ${state.busy ? "disabled" : ""}>Exportar copia cifrada (.bce)</button>`}

        ${state.errors ? `
        <div class="banner-aviso red" style="margin-top:12px;max-height:200px;overflow-y:auto;display:block">
          ${state.errors.slice(0, 10).map((e) => `<p>${escHtml(e)}</p>`).join("")}
          ${state.errors.length > 10 ? `<p>y ${state.errors.length - 10} más</p>` : ""}
        </div>` : ""}

        ${state.encImport ? `
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
          <p style="color:var(--text-2);font-size:13px">Esta copia está cifrada. Escribe su contraseña para continuar.</p>
          <input type="password" id="dec-pass" style="${INPUT_STYLE}" placeholder="Contraseña de la copia">
          <div id="dec-error" class="banner-aviso red" style="display:none"></div>
          <div style="display:flex;gap:8px">
            <button type="button" class="btn-secondary" id="btn-dec-cancel" style="flex:1" ${state.busy ? "disabled" : ""}>Cancelar</button>
            <button type="button" class="btn-primary" id="btn-dec-confirm" style="flex:1" ${state.busy ? "disabled" : ""}>Descifrar</button>
          </div>
        </div>` : ""}

        ${state.pending ? `
        <div class="banner-aviso" style="margin-top:12px;display:block">
          <p>Esto reemplaza TODOS los datos de la app (${state.pending.currentCount} movimientos actuales).
          Se descargará una copia antes.</p>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button type="button" class="btn-secondary" id="btn-import-cancel" style="flex:1" ${state.busy ? "disabled" : ""}>Cancelar</button>
          <button type="button" class="btn-primary" id="btn-import-confirm" style="flex:1" ${state.busy ? "disabled" : ""}>Reemplazar</button>
        </div>` : ""}
      </div>

      ${periodoCardHtml(openPeriod, partnerName)}

      <div class="card" style="margin-bottom:12px">
        <button type="button" id="btn-recurrentes" class="list-row"
          style="width:100%;text-align:left;background:none;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          <div class="list-row-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 019-9 9 9 0 018 4.6M21 12a9 9 0 01-9 9 9 9 0 01-8-4.6"></path><path d="M20 3v5h-5M4 21v-5h5"></path>
            </svg>
          </div>
          <div class="list-row-body">
            <div class="list-row-title">Gastos e ingresos recurrentes</div>
          </div>
          <svg class="list-row-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"></path></svg>
        </button>
      </div>

      <div class="card" style="margin-bottom:12px">
        <button type="button" id="btn-categorias" class="list-row"
          style="width:100%;text-align:left;background:none;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          <div class="list-row-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"></circle><circle cx="5" cy="6" r="2"></circle><circle cx="19" cy="6" r="2"></circle><circle cx="5" cy="18" r="2"></circle><circle cx="19" cy="18" r="2"></circle>
            </svg>
          </div>
          <div class="list-row-body">
            <div class="list-row-title">Categorías</div>
            <div class="list-row-sub">${escHtml(catSubtitle)}</div>
          </div>
          <svg class="list-row-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"></path></svg>
        </button>
      </div>

      <div class="card" style="margin-bottom:12px">
        <p style="font-weight:600;margin-bottom:4px">Banco</p>
        <p style="color:var(--text-2);font-size:13px;margin-bottom:14px">
          Importa el extracto CSV de tu banco: crea los movimientos que faltan y concilia los que
          ya registraste a mano (mismo importe y sentido, ±3 días). Las duplicadas se saltan
          solas. Los CSV de N26 se reconocen solos; los de otros bancos te los pedimos configurar
          una vez.</p>
        <button type="button" class="btn-secondary" id="btn-n26-import" style="${BTN_FULL_WIDTH}" ${state.busy ? "disabled" : ""}>Importar CSV</button>
        <input type="file" id="n26-file-input" accept=".csv" style="display:none">

        ${state.n26Result ? `
        <div class="banner-aviso" style="margin-top:12px;display:block"><p>${escHtml(state.n26Result)}</p></div>` : ""}
        ${state.n26Error ? `
        <div class="banner-aviso red" style="margin-top:12px;display:block"><p>${escHtml(state.n26Error)}</p></div>` : ""}
      </div>

      <div class="card" style="margin-bottom:12px">
        <p style="font-weight:600;margin-bottom:4px">Moneda y formato</p>
        <p style="color:var(--text-2);font-size:13px;margin-bottom:14px">
          Divisa de los importes y formato de números y fechas. Se aplican al guardar (recarga la app).</p>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <div style="flex:1;background:var(--card2);border-radius:16px;padding:8px 12px;">
            <div class="section-title" style="margin-bottom:2px;">Moneda</div>
            <select id="pref-currency" style="background:none;border:0;color:var(--text);font:700 14px var(--font-ui);width:100%;padding:2px 0;outline:none;">${currencyOptionsHtml(metaCfg.currency)}</select>
          </div>
          <div style="flex:1;background:var(--card2);border-radius:16px;padding:8px 12px;">
            <div class="section-title" style="margin-bottom:2px;">Formato</div>
            <select id="pref-locale" style="background:none;border:0;color:var(--text);font:700 14px var(--font-ui);width:100%;padding:2px 0;outline:none;">${localeOptionsHtml(metaCfg.locale)}</select>
          </div>
        </div>
        <label class="field field-stack" style="margin-top:12px;">
          <span class="field-label">Compartes gastos con</span>
          <input type="text" id="cfg-partner" value="${escAttr(metaCfg.partner_name || "")}" placeholder="Nadie — déjalo vacío si llevas tus cuentas solo">
        </label>
        <div style="font-size:11px;color:var(--text-3);">Con nombre, aparecen el reparto y «Liquidar». Vacío, la app es solo tuya.</div>
        <button type="button" class="btn-secondary" id="btn-prefs-save" style="${BTN_FULL_WIDTH}margin-top:12px" ${state.busy ? "disabled" : ""}>Guardar preferencias</button>
      </div>

      <div class="card">
        <p style="font-weight:600;margin-bottom:4px">Copia de emergencia</p>
        <p style="color:var(--text-2);font-size:13px;margin-bottom:14px">
          🔒 Tus datos viven solo en este dispositivo. Sin cuentas, sin nube.</p>
        <button type="button" class="btn-secondary" id="btn-json-export" style="${BTN_FULL_WIDTH}">Exportar copia de seguridad (JSON)</button>
      </div>
    `;
    wireMain();
  }

  function wireMain() {
    container.querySelector("#btn-xlsx-export").onclick = async () => {
      state.busy = true; render();
      try {
        downloadXlsx(await dumpAllTables(), `basecero-${hoyISO()}.xlsx`);
      } catch (e) {
        state.errors = [`No se pudo exportar: ${e.message}`];
      } finally {
        state.busy = false; render();
      }
    };

    container.querySelector("#btn-xlsx-import").onclick = () => {
      container.querySelector("#xlsx-file-input").click();
    };

    container.querySelector("#btn-recurrentes").onclick = () => {
      renderRecurrentes(container, () => renderAjustes(container));
    };

    container.querySelector("#btn-categorias").onclick = () => {
      renderCategorias(container, () => renderAjustes(container));
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
        state.n26Error = err.message;
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
      if (p1.length < MIN_PASSPHRASE) return fail(`Mínimo ${MIN_PASSPHRASE} caracteres.`);
      if (p1 !== p2) return fail("Las contraseñas no coinciden.");
      state.busy = true; render();
      try {
        const wb = rowsToWorkbook(window.XLSX, await dumpAllTables());
        const arr = window.XLSX.write(wb, { type: "array", bookType: "xlsx" });
        const enc = await encryptBackup(arr, p1);
        download(new Blob([enc], { type: "application/octet-stream" }), `basecero-cifrado-${hoyISO()}.bce`);
        state.encExport = false;
      } catch (e) {
        state.errors = [`No se pudo exportar: ${e.message}`];
      } finally {
        state.busy = false; render();
      }
    };

    const cerrarBtn = container.querySelector("#btn-cerrar-periodo");
    if (cerrarBtn) cerrarBtn.onclick = () => {
      document.body.classList.add("onboarding");
      renderPeriodoNuevo(container, {
        mode: "next",
        onDone: () => {
          document.body.classList.remove("onboarding");
          renderAjustes(container);
        },
      });
    };

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
        state.errors = [`No se pudo leer el archivo: ${err.message}`]; state.pending = null;
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
        box.textContent = "Escribe la contraseña de la copia.";
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
          box.textContent = "Contraseña incorrecta o archivo dañado.";
          box.style.display = "block";
          return;
        }
        // Error estructural (BackupFormatError) u otro: se cierra el formulario y va al banner normal.
        state.errors = [err.message]; state.encImport = null;
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
          downloadXlsx(state.pending.currentDump, `basecero-backup-${hoyISO()}.xlsx`);
          await replaceAll(state.pending.data);
          location.reload();
        } catch (err) {
          state.busy = false;
          state.errors = [`No se pudo reemplazar: ${err.message}`]; state.pending = null;
          render();
        }
      };
    }

    container.querySelector("#btn-prefs-save").onclick = async () => {
      // Leer los inputs ANTES de render(): reconstruye el DOM desde metaCfg (el valor
      // guardado), así que leerlos después devolvería el valor antiguo, no el elegido.
      const currency = container.querySelector("#pref-currency").value;
      const locale = container.querySelector("#pref-locale").value;
      const partner = container.querySelector("#cfg-partner").value.trim();
      state.busy = true; render();
      try {
        // Los tres campos de la tarjeta en UN execMany (vía setMetaMany): o quedan las tres
        // claves guardadas o ninguna, así currency/locale/partner_name nunca quedan a medias.
        // partner_name va sin bcSanitizeCell a propósito: SheetJS exporta la celda como string (sin riesgo
        // de fórmula) y sanitizar ensuciaría el nombre en toda la UI («+Ana» → «'+Ana»).
        await setMetaMany([["currency", currency], ["locale", locale], ["partner_name", partner]]);
        location.reload();
      } catch (err) {
        state.busy = false;
        state.errors = [`No se pudieron guardar las preferencias: ${err.message}`];
        render();
      }
    };

    container.querySelector("#btn-json-export").onclick = async () => {
      const data = await exportAllJson();
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
      download(blob, `basecero-backup-${hoyISO()}.json`);
    };
  }

  // Fondo de las 3 cajas "de tarjeta suelta" del asistente (fichero / preview / nota del pie):
  // 16px/12-16, no la .card de app.css (22px/16 — pensada para las secciones de nivel de
  // pantalla) — mismo criterio que la caja de vista previa de nombre en categorias.js:renderForm.
  const ASSIST_BOX_STYLE = "background:var(--card);border-radius:16px;padding:12px 16px;";

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
    if (profileValid) {
      // Sobre el CSV COMPLETO (a.text), no solo la muestra de 5 filas: el contador "N de M" y el
      // nº de filas de la card de arriba tienen que coincidir con lo que de verdad se va a
      // importar al pulsar Guardar (mismo cálculo que hará importWithProfile).
      const { rows, errors } = applyProfile(a.text, profile, bcParseCsvLine);
      const total = rows.length + errors.length;
      const previewRows = rows.slice(0, 3);
      const counterOk = errors.length === 0;
      const counterText = counterOk
        ? `✓ ${rows.length} de ${total} filas se leen bien`
        : `⚠ ${rows.length} de ${total} filas se leen bien · fila ${errors[0].line}: ${errors[0].reason}`;

      previewHtml = `
      <div style="${ASSIST_BOX_STYLE}">
        <div class="section-title" style="margin-bottom:6px;">Así se leerán tus movimientos</div>
        ${previewRows.map((r, i) => {
          // merchant||note, mismo criterio que movimientos.js (líneas 53/65/76): la contraparte
          // manda como etiqueta reconocible; si no hay columna de contraparte asignada, cae al
          // concepto — ningún campo mapeado queda sin sitio donde mostrarse.
          const label = r.partnerName || r.paymentReference || "(sin concepto)";
          const income = r.amountCents >= 0;
          const rowStyle = `display:flex;align-items:center;gap:10px;padding:8px 0;`
            + (i < previewRows.length - 1 ? "border-bottom:1px solid var(--rule);" : "");
          return `
          <div style="${rowStyle}">
            <span style="color:var(--green);font-weight:700;flex-shrink:0;">✓</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(label)}</div>
              <div class="num" style="font-size:10.5px;color:var(--text-3);">${escHtml(r.bookingDate)}</div>
            </div>
            <div class="num" style="font-size:13px;font-weight:700;${income ? "color:var(--green);" : ""}">${escHtml(fmtMoney(r.amountCents))}</div>
          </div>`;
        }).join("")}
        <div class="num" style="font-size:11px;color:${counterOk ? "var(--green)" : "var(--amber)"};padding-top:8px;">${escHtml(counterText)}</div>
      </div>`;
    }

    const ctaDisabled = !profileValid || a.saveBusy;

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div style="font-size:20px;font-weight:700;letter-spacing:-0.015em;">Configura tu banco</div>
        <button type="button" id="assist-close" aria-label="Cerrar" ${a.saveBusy ? "disabled" : ""}
          style="width:44px;height:44px;border-radius:50%;background:var(--card2);border:0;color:var(--text);
          display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M6 6l12 12M18 6L6 18"></path>
          </svg>
        </button>
      </div>

      <div style="display:flex;flex-direction:column;gap:16px;">

        <div style="${ASSIST_BOX_STYLE}display:flex;align-items:center;gap:12px;">
          <div style="width:36px;height:36px;border-radius:12px;background:var(--card2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3H6.5A1.5 1.5 0 005 4.5v15A1.5 1.5 0 006.5 21h11a1.5 1.5 0 001.5-1.5V9z"></path><path d="M13 3v6h6M8.5 13h7M8.5 16.5h7"></path></svg>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(a.fileName)}</div>
            <div style="font-size:11.5px;color:var(--text-2);">${a.totalRows} fila${a.totalRows === 1 ? "" : "s"} · formato no reconocido — dinos qué es cada columna, solo esta vez</div>
          </div>
        </div>

        <div>
          <div class="section-title" style="margin-bottom:7px;">Fecha</div>
          ${chipsRowHtml("date", headerOptions, a.date)}
          ${dateNote ? `<div class="num" style="font-size:11px;color:${dateNote.ok ? "var(--green)" : "var(--red)"};margin-top:5px;">${escHtml(dateNote.text)}</div>` : ""}
        </div>

        <div>
          <div class="section-title" style="margin-bottom:7px;">Concepto</div>
          ${chipsRowHtml("concept", headerOptions, a.concept)}
        </div>

        <div>
          <div class="section-title" style="margin-bottom:7px;">Contraparte · opcional</div>
          ${chipsRowHtml("counterparty", [...headerOptions, { value: null, label: "— sin columna" }], a.counterparty)}
        </div>

        <div>
          <div class="section-title" style="margin-bottom:7px;">Importe</div>
          <div class="segmented" style="border-radius:999px;margin-bottom:8px;">
            <button type="button" data-assist-kind="single" class="${a.amountKind === "single" ? "active" : ""}"
              style="border-radius:999px;${a.amountKind === "single" ? "background:var(--card2);color:var(--text);font-weight:700;" : ""}">Una columna con signo</button>
            <button type="button" data-assist-kind="split" class="${a.amountKind === "split" ? "active" : ""}"
              style="border-radius:999px;${a.amountKind === "split" ? "background:var(--card2);color:var(--text);font-weight:700;" : ""}">Cargo y abono</button>
          </div>
          ${a.amountKind === "single" ? chipsRowHtml("amountCol", headerOptions, a.amountCol) : `
          <div class="section-title" style="margin:0 0 6px;">Cargo</div>
          ${chipsRowHtml("debitCol", headerOptions, a.debitCol)}
          <div class="section-title" style="margin:10px 0 6px;">Abono</div>
          ${chipsRowHtml("creditCol", headerOptions, a.creditCol)}`}
          ${amountNote ? `<div class="num" style="font-size:11px;color:${amountNote.ok ? "var(--green)" : "var(--red)"};margin-top:5px;">${escHtml(amountNote.text)}</div>` : ""}
        </div>

        ${previewHtml}

        ${a.saveError ? `<div class="banner-aviso red" style="display:block"><p>${escHtml(a.saveError)}</p></div>` : ""}

        <button type="button" class="btn-primary" id="assist-save" style="width:100%;${ctaDisabled ? "opacity:0.45;" : ""}" ${ctaDisabled ? "disabled" : ""}>Guardar perfil e importar</button>

        <div style="${ASSIST_BOX_STYLE}display:flex;align-items:center;gap:10px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16.5v.01"></path></svg>
          <div style="font-size:11.5px;color:var(--text-2);">El perfil se guarda en tu dispositivo: la próxima vez este banco se importa directo. Los CSV de N26 se reconocen solos, sin configurar nada.</div>
        </div>
      </div>
    `;
    wireAssistant(profile, profileValid);
  }

  function wireAssistant(profile, profileValid) {
    const a = state.assistant;

    container.querySelector("#assist-close").onclick = () => {
      state.view = "main";
      state.assistant = null;
      render();
    };

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
        const res = await importWithProfile(a.text, profile);
        state.view = "main";
        state.assistant = null;
        state.n26Result = importResultText({ ...res, via: "profile" }, partnerName);
        state.n26Error = null;
      } catch (err) {
        a.saveBusy = false;
        a.saveError = err.message;
      } finally {
        render();
      }
    };
  }

  render();
}
