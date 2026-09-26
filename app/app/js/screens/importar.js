// Importar extracto (S12, B-Importar): subvista de Ajustes con cabecera con atrás y progreso por
// pasos (Fichero, Columnas, Resultado). Se abre desde la fila «Importar del banco» de Ajustes en
// dos casos:
//  - importCsv() (router de n26.js) devuelve needsMapping, banco sin soporte dedicado: paso
//    «Columnas», el asistente de mapeo; al pulsar el primario guarda el perfil, importa y pasa a
//    «Resultado».
//  - importCsv() ya ha importado solo (N26 o perfil guardado): directamente en «Resultado».
// Se pinta en el contenedor de Ajustes; su «atrás» (y el «Listo» del resultado) es la entrada de
// historial que Ajustes apunta con pushBack antes de abrirlo.
// El paso de revisión del mockup (B-3/P3: lista editable antes de importar) es lógica nueva y no
// está: el tercer segmento se llama como el paso que existe de verdad.
import { setMeta } from "../repo.js";
import { fmtMoney } from "../format.js";
import { goBack } from "../back.js";
import { importWithProfile } from "../n26.js";
import { buildProfile, applyProfile, detectDateFormat, detectDecimal, parseDateIso, parseAmountCents, summarizeReasons } from "../csv-generic.js";
import { t } from "../i18n/index.js";
import { userMessage } from "../errors.js";
import { showToast } from "../toast.js";
import { subHeaderHtml, buttonHtml } from "../ui.js";
import { segmentedHtml, wireSegmented, stepsHtml } from "../controls.js";
import { filterChipHtml } from "../entity.js";
import { ledHtml } from "../instrument.js";
import { icon } from "../icons.js";
import { escHtml } from "../esc.js";

const MINUS = "−"; // «−» tipográfico, el mismo que usan las filas de movimiento (entity.js)

// Fila de chips de asignación de un bloque: chips neutros de filtro (entity.js), el elegido en
// --accent. `options`: [{value,label}] — value=null representa "sin columna" (solo Contraparte lo
// ofrece). Las cabeceras son texto del CSV del usuario: filterChipHtml escapa la etiqueta y
// attrs() los data-*, nunca se confía en su contenido.
function chipsRowHtml(field, options, selected, labelledBy) {
  return `<div class="imp-chips" role="group" aria-labelledby="${labelledBy}">${options.map(({ value, label }) => filterChipHtml({
    label,
    selected: value === selected,
    data: { assistField: field, assistValue: value === null ? "" : value, assistNone: value === null ? "1" : null },
  })).join("")}</div>`;
}

// Nº de filas de datos del CSV completo (cabecera aparte, líneas en blanco fuera) — mismo
// criterio de troceo que nonEmptyLines de csv-generic.js (no exportada de allí: ese módulo es
// CERO-imports a propósito y esta cuenta es puramente de presentación).
export function csvDataRowCount(text) {
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

/** Nota bajo el bloque Fecha: de éxito con la conversión de ejemplo si TODA la muestra parsea con
 *  algún formato; de aviso con el motivo si la columna no reconoce ningún formato; null (sin nota)
 *  si aún no hay columna elegida. Recibe los valores YA extraídos de la muestra para esa columna,
 *  no el profile completo: buildProfile agrega fecha+concepto+contraparte+importe en un único
 *  {error}, y esta nota tiene que poder mostrarse aunque otro bloque no esté resuelto todavía.
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

/** Nota de una línea: éxito con el check en --pos; aviso con el icono de aviso y el texto neutro
 *  (C4/C5: el rojo es para cifras negativas y lo destructivo, no para un aviso). */
function noteHtml(note) {
  if (!note) return "";
  return `<p class="imp-note${note.ok ? " is-ok" : ""}">${icon(note.ok ? "check" : "warn", { size: 16 })}<span>${escHtml(note.text)}</span></p>`;
}

/** Estado inicial para un CSV que importCsv() no supo leer solo: paso «Columnas». */
export function newAssistantState(fileName, text, needsMapping) {
  return {
    step: "columns", fileName, text, headers: needsMapping.headers, sample: needsMapping.sample,
    totalRows: csvDataRowCount(text),
    date: null, concept: null, counterparty: null,
    amountKind: "single", amountCol: null, debitCol: null, creditCol: null,
    saveBusy: false, saveError: null,
    result: null, fromAssistant: false,
  };
}

/** Estado para un CSV que importCsv() ya importó solo (N26 o perfil guardado): paso «Resultado».
 *  `res` es lo que devuelve importCsv, con su `via`. */
export function newResultState(fileName, text, res) {
  return { step: "result", fileName, text, totalRows: csvDataRowCount(text), result: res, fromAssistant: false };
}

/** Pinta el importador en `container` y se repinta solo en cada toque. `a` es el estado de
 *  newAssistantState o newResultState; `partnerName` decide la frase de Bizum del resultado. */
export function renderImportAssistant(container, a, { partnerName = "" } = {}) {
  // Qué enfocar tras el repintado (K12): el chip o la opción que se acaba de pulsar, o el título
  // al llegar al resultado. Un repintado sustituye el DOM y, sin esto, el foco caería al body.
  let refocus = null;

  function fileCardHtml() {
    let led;
    if (a.step === "columns") led = ledHtml({ state: "idle", text: t("importar.led.unknown"), onDisplay: false });
    else if (a.result.via === "n26") led = ledHtml({ state: "ok", text: t("importar.led.n26"), onDisplay: false });
    else led = ledHtml({ state: "ok", text: t(a.fromAssistant ? "importar.led.saved" : "importar.led.profile"), onDisplay: false });
    return `<div class="imp-file">
      <span class="imp-file-tile" aria-hidden="true">${icon("file", { size: 20 })}</span>
      <div class="imp-file-body"><span class="imp-file-name">${escHtml(a.fileName)}</span>${led}</div>
      <span class="imp-file-rows num">${escHtml(t("ajustes.assist.rowCount", { n: a.totalRows }))}</span>
    </div>`;
  }

  /** Paso «Columnas» (el asistente de mapeo). Recalcula notas/preview/contador/CTA en cada render
   *  a partir de `a` — no hay estado derivado guardado aparte, así que un solo render() tras
   *  cualquier toque basta para que todo quede consistente. */
  function columnsHtml() {
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

    // Perfil completo: gate único del primario y fuente de la preview/contador — NUNCA de las
    // notas de fecha/importe de arriba, que tienen que poder mostrarse aunque otro bloque distinto
    // (concepto/contraparte) siga sin resolver.
    const profile = currentProfile();
    const profileValid = !profile.error;

    let previewHtml = "";
    let readableCount = 0;
    if (profileValid) {
      // Sobre el CSV COMPLETO (a.text), no solo la muestra de 5 filas: el contador "N de M" y la
      // cifra del primario tienen que coincidir con lo que de verdad se manda a importar (mismo
      // cálculo que hará importWithProfile; el dedupe puede saltar luego alguna ya importada).
      const { rows, errors } = applyProfile(a.text, profile, bcParseCsvLine);
      readableCount = rows.length;
      const total = rows.length + errors.length;
      const line1 = { ok: rows.length > 0, text: t("ajustes.assist.counterOk", { readable: rows.length, total }) };
      const line2 = errors.length > 0
        ? { ok: false, text: `${t("ajustes.assist.counterWarnLine", { n: errors.length })}: `
          + t("ajustes.assist.counterReasons", { reasons: summarizeReasons(errors).join(", ") }) }
        : null;

      previewHtml = `
      <section class="imp-block" aria-labelledby="imp-l-preview">
        <h2 class="imp-label" id="imp-l-preview">${escHtml(t("ajustes.assist.previewTitle"))}</h2>
        <div class="imp-preview">${rows.slice(0, 3).map((r) => {
          // merchant||note, mismo criterio que movimientos.js: la contraparte manda como etiqueta
          // reconocible; si no hay columna de contraparte asignada, cae al concepto.
          const label = r.partnerName || r.paymentReference || t("ajustes.assist.noConcept");
          const income = r.amountCents >= 0;
          return `<div class="imp-prev-row">
            <span class="imp-prev-body"><span class="imp-prev-name">${escHtml(label)}</span><span class="imp-prev-date num">${escHtml(r.bookingDate)}</span></span>
            <span class="imp-prev-amount num${income ? " is-pos" : ""}">${income ? "+" : MINUS}${escHtml(fmtMoney(Math.abs(r.amountCents)))}</span>
          </div>`;
        }).join("")}</div>
        ${noteHtml(line1)}${noteHtml(line2)}
      </section>`;
    }

    // 0 filas legibles no debe dejar guardar un perfil que no importaría nada. Si !profileValid
    // readableCount se queda en 0, así que el OR es correcto sin condición extra.
    const ctaDisabled = !profileValid || a.saveBusy || readableCount === 0;
    const ctaLabel = readableCount > 0 ? t("importar.cta", { n: readableCount }) : t("importar.ctaIdle");

    const amountKindSeg = segmentedHtml({
      id: "imp-kind", name: t("ajustes.assist.amountTitle"), labelledBy: "imp-l-amount", value: a.amountKind,
      options: [
        { value: "single", label: t("ajustes.assist.amountSingleBtn") },
        { value: "split", label: t("ajustes.assist.amountSplitBtn") },
      ],
    });

    return `
      <section class="imp-block" aria-labelledby="imp-l-date">
        <h2 class="imp-label" id="imp-l-date">${escHtml(t("ajustes.assist.dateTitle"))}</h2>
        ${chipsRowHtml("date", headerOptions, a.date, "imp-l-date")}
        ${noteHtml(dateNote)}
      </section>

      <section class="imp-block" aria-labelledby="imp-l-concept">
        <h2 class="imp-label" id="imp-l-concept">${escHtml(t("ajustes.assist.conceptTitle"))}</h2>
        ${chipsRowHtml("concept", headerOptions, a.concept, "imp-l-concept")}
      </section>

      <section class="imp-block" aria-labelledby="imp-l-cp">
        <h2 class="imp-label" id="imp-l-cp">${escHtml(t("ajustes.assist.counterpartyTitle"))} <span class="imp-optional">${escHtml(t("common.optional"))}</span></h2>
        ${chipsRowHtml("counterparty", [...headerOptions, { value: null, label: t("ajustes.assist.noColumn") }], a.counterparty, "imp-l-cp")}
      </section>

      <section class="imp-block" aria-labelledby="imp-l-amount">
        <h2 class="imp-label" id="imp-l-amount">${escHtml(t("ajustes.assist.amountTitle"))}</h2>
        ${amountKindSeg}
        ${a.amountKind === "single" ? chipsRowHtml("amountCol", headerOptions, a.amountCol, "imp-l-amount") : `
        <h3 class="imp-sublabel" id="imp-l-debit">${escHtml(t("ajustes.assist.debitTitle"))}</h3>
        ${chipsRowHtml("debitCol", headerOptions, a.debitCol, "imp-l-debit")}
        <h3 class="imp-sublabel" id="imp-l-credit">${escHtml(t("ajustes.assist.creditTitle"))}</h3>
        ${chipsRowHtml("creditCol", headerOptions, a.creditCol, "imp-l-credit")}`}
        ${noteHtml(amountNote)}
      </section>

      ${previewHtml}

      ${a.saveError ? `<div class="imp-msg" role="alert">${icon("warn", { size: 18 })}<p>${escHtml(a.saveError)}</p></div>` : ""}

      ${buttonHtml({ kind: "primary", id: "assist-save", label: ctaLabel, note: t("ajustes.assist.footNote"), disabled: ctaDisabled })}`;
  }

  function currentProfile() {
    return buildProfile({
      headers: a.headers, date: a.date, concept: a.concept, counterparty: a.counterparty,
      amountKind: a.amountKind, amountCol: a.amountCol, debitCol: a.debitCol, creditCol: a.creditCol,
      sample: a.sample,
    });
  }

  /** Paso «Resultado»: los contadores del import ya hecho. Sin lista (la revisión es B-3). */
  function resultHtml() {
    const r = a.result;
    const tile = (n, key, dim = false) => `<div class="imp-tile">
      <span class="imp-tile-value num${dim ? " is-dim" : ""}">${escHtml(String(n))}</span>
      <span class="imp-tile-label">${escHtml(t(key, { n }))}</span>
    </div>`;
    const uncategorized = Math.max(0, r.created - (r.categorized || 0));
    let note;
    if (r.created === 0) note = t("importar.nothingNew");
    else if (uncategorized > 0) note = t("importar.inbox", { n: uncategorized });
    else note = t("importar.allCategorized");
    // Solo con contraparte configurada Y via N26: un CSV genérico no distingue un Bizum de
    // cualquier otro abono (misma regla que el viejo banner de Ajustes).
    const bizum = partnerName && r.via === "n26";
    return `
      <section class="imp-tiles" aria-label="${escHtml(t("importar.summaryAria"))}">
        ${tile(r.created, "importar.tiles.created")}
        ${tile(r.reconciled, "importar.tiles.reconciled")}
        ${tile(r.skipped, "importar.tiles.skipped", true)}
      </section>
      ${r.omitted ? noteHtml({ ok: false, text: t("importar.omitted", { n: r.omitted }) }) : ""}
      ${bizum ? `<p class="imp-help">${escHtml(t("importar.bizumHint"))}</p>` : ""}
      ${buttonHtml({ kind: "primary", id: "imp-done", label: t("importar.done"), note })}`;
  }

  function render() {
    const stepNo = a.step === "columns" ? 2 : 3;
    container.innerHTML = `<div class="imp-screen">
      ${subHeaderHtml({ id: "assist-close", title: t("importar.title") })}
      ${stepsHtml({ total: 3, current: stepNo, ariaLabel: t("importar.steps.aria"), labels: [t("importar.steps.file"), t("importar.steps.columns"), t("importar.steps.result")] })}
      ${fileCardHtml()}
      ${a.step === "columns" ? columnsHtml() : resultHtml()}
    </div>`;
    wire();
    if (refocus) {
      const el = refocus(container);
      refocus = null;
      if (el) el.focus();
    }
  }

  function wire() {
    const back = container.querySelector("#assist-close");
    back.disabled = Boolean(a.saveBusy);
    back.onclick = () => goBack();

    if (a.step === "result") {
      container.querySelector("#imp-done").onclick = () => goBack();
      return;
    }

    // Delegación uniforme para las 6 filas de chips (fecha/concepto/contraparte/importe-única/
    // cargo/abono): el nombre del campo viaja en el propio data-attribute.
    container.querySelectorAll("[data-assist-field]").forEach((b) => {
      b.onclick = () => {
        const { assistField: field, assistValue: value, assistNone: none } = b.dataset;
        a[field] = none === "1" ? null : value;
        refocus = (root) => [...root.querySelectorAll("[data-assist-field]")]
          .find((x) => x.dataset.assistField === field && x.dataset.assistValue === value && x.dataset.assistNone === none);
        render();
      };
    });

    wireSegmented(container.querySelector("#imp-kind"), (kind) => {
      if (kind === a.amountKind) return;
      a.amountKind = kind;
      // Resetea la selección de importe al cambiar de modo: una columna elegida en "una columna
      // con signo" no tiene sentido como cargo o abono, y viceversa.
      a.amountCol = null; a.debitCol = null; a.creditCol = null;
      refocus = (root) => root.querySelector('#imp-kind [aria-checked="true"]');
      render();
    });

    container.querySelector("#assist-save").onclick = async () => {
      const profile = currentProfile();
      if (profile.error || a.saveBusy) return;
      a.saveBusy = true; a.saveError = null; render();
      try {
        await setMeta("csv_profile", JSON.stringify(profile));
        // El resultado cuenta el IMPORT; que el perfil quede guardado para la próxima vez —lo que
        // el usuario acaba de configurar, y que ya no vuelve a ver— lo dice este toast.
        showToast(t("toast.profileSaved"));
        const res = await importWithProfile(a.text, profile);
        a.saveBusy = false;
        a.step = "result"; a.result = { ...res, via: "profile" }; a.fromAssistant = true;
        refocus = (root) => {
          const h = root.querySelector(".sub-header-title");
          if (h) h.tabIndex = -1;
          return h;
        };
        render();
      } catch (err) {
        a.saveBusy = false;
        a.saveError = userMessage(err);
        render();
      }
    };
  }

  render();
}
