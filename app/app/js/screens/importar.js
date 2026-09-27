// Importar extracto (S12, B-Importar): subvista de Ajustes con cabecera con atrás y progreso por
// pasos (Fichero, Columnas, Revisar). Se abre desde la fila «Importar del banco» de Ajustes en
// dos casos:
//  - previewCsv() (router de n26.js) devuelve needsMapping, banco sin soporte dedicado: paso
//    «Columnas», el asistente de mapeo; al pulsar el primario guarda el perfil, hace el ENSAYO y
//    pasa a «Revisar» (con su propia entrada de «atrás», que vuelve a Columnas).
//  - previewCsv() ya reconoce el fichero (N26 o perfil guardado): directamente en «Revisar».
// «Revisar» (B-3): la lista de lo que se va a crear, sin escribir nada todavía. El usuario puede
// quitar filas (casilla) y cambiar la categoría de cada una (hoja con las baldosas de familia); las
// que el deduplicado concilia o salta aparecen aparte, marcadas, y no se crean. El primario llama a
// commitImport, que re-planea contra la base y escribe, y vuelve a Ajustes con un aviso.
// Se pinta en el contenedor de Ajustes; su «atrás» es la entrada de historial que Ajustes apunta
// con pushBack antes de abrirlo.
import { setMeta, allCategoriesById, listExpenseLeafCategories, listIncomeCategories } from "../repo.js";
import { fmtMoney } from "../format.js";
import { goBack, pushBack } from "../back.js";
import { previewWithProfile, commitImport } from "../n26.js";
import { reviewCounts, reviewDays, effectiveCategory, isIncluded } from "../import-review.js";
import { familyForCategory, iconForCategory, rootOf, famClass } from "../category-colors.js";
import { showSheet } from "../sheet.js";
import { buildProfile, applyProfile, detectDateFormat, detectDecimal, parseDateIso, parseAmountCents, summarizeReasons } from "../csv-generic.js";
import { t } from "../i18n/index.js";
import { userMessage } from "../errors.js";
import { showToast } from "../toast.js";
import { subHeaderHtml, buttonHtml } from "../ui.js";
import { segmentedHtml, wireSegmented, stepsHtml, checkboxHtml } from "../controls.js";
import { filterChipHtml, pickTileHtml, badgeHtml, dayHeaderHtml, sectionHeaderHtml } from "../entity.js";
import { ledHtml } from "../instrument.js";
import { icon } from "../icons.js";
import { escHtml, escAttr } from "../esc.js";

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
    fromAssistant: false,
  };
}

/** Categorías que necesita el paso «Revisar»: nombres/familias (byId) y las elegibles por tipo. */
async function loadReviewCats() {
  const [byId, expense, income] = await Promise.all([allCategoriesById(), listExpenseLeafCategories(), listIncomeCategories()]);
  return { byId, expense, income };
}

/** Pasa `a` al paso «Revisar» con el ensayo `preview` ({via, rows, parseErrors, plan} de
 *  n26.js#previewCsv/previewWithProfile). Nada se ha escrito todavía. */
async function enterReview(a, preview) {
  a.cats = await loadReviewCats();
  Object.assign(a, {
    step: "review", via: preview.via, rows: preview.rows, parseErrors: preview.parseErrors, plan: preview.plan,
    excluded: [], categories: {}, tab: "new", commitBusy: false, commitError: null,
  });
}

/** Estado para un CSV que previewCsv() ya reconoce (N26 o perfil guardado): paso «Revisar». */
export async function newReviewState(fileName, text, preview) {
  const a = { fileName, text, totalRows: csvDataRowCount(text), fromAssistant: false };
  await enterReview(a, preview);
  return a;
}

/** Pinta el importador en `container` y se repinta solo en cada toque. `a` es el estado de
 *  newAssistantState o newReviewState; `partnerName` decide la frase de Bizum de la revisión. */
export function renderImportAssistant(container, a, { partnerName = "" } = {}) {
  // Qué enfocar tras el repintado (K12): el chip o la opción que se acaba de pulsar, o el título
  // al llegar al resultado. Un repintado sustituye el DOM y, sin esto, el foco caería al body.
  let refocus = null;

  function fileCardHtml() {
    let led;
    if (a.step === "columns") led = ledHtml({ state: "idle", text: t("importar.led.unknown"), onDisplay: false });
    else if (a.via === "n26") led = ledHtml({ state: "ok", text: t("importar.led.n26"), onDisplay: false });
    else led = ledHtml({ state: "ok", text: t(a.fromAssistant ? "importar.led.saved" : "importar.led.profile"), onDisplay: false });
    return `<div class="imp-file">
      <span class="imp-file-tile" aria-hidden="true">${icon("file", { size: 20 })}</span>
      <div class="imp-file-body"><span class="imp-file-name">${escHtml(a.fileName)}</span>${led}</div>
      <span class="imp-file-rows num">${escHtml(t("ajustes.assist.rowCount", { n: a.totalRows }))}</span>
    </div>`;
  }

  const catName = (id) => {
    const c = a.cats.byId[id];
    if (!c) return "";
    const root = rootOf(id, a.cats.byId);
    return root && root !== id && a.cats.byId[root] ? `${a.cats.byId[root].name} › ${c.name}` : c.name;
  };

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

  /** Ficha de categoría de una fila nueva (B-Importar): la de su familia, la de ingreso (neutra,
   *  C9) o, sin categoría, la píldora punteada «Elegir categoría». Debajo a la derecha, de dónde
   *  sale: el comercio, el usuario o «comercio nuevo». */
  function rowCategoryHtml(item) {
    const cat = effectiveCategory(item, a);
    const chosen = Object.prototype.hasOwnProperty.call(a.categories, item.index);
    let chip;
    if (!cat) chip = `<span class="imp-rev-pick">${escHtml(t(chosen ? "importar.review.uncategorized" : "importar.review.pick"))}</span>`;
    else if (item.type === "income") chip = badgeHtml({ income: true, label: catName(cat) });
    else chip = badgeHtml({ fam: familyForCategory(cat, a.cats.byId), icon: iconForCategory(cat, a.cats.byId), label: catName(cat) });
    let src;
    if (chosen) src = t(cat ? "importar.review.byYou" : "importar.review.leftOut");
    else src = t(item.fromMemory ? "importar.review.byMerchant" : "importar.review.newMerchant");
    return `${chip}<span class="imp-rev-src">${escHtml(src)}</span>`;
  }

  const rowLabel = (item) => item.row.partnerName || item.row.paymentReference || t("ajustes.assist.noConcept");

  function amountHtml(item) {
    const income = item.row.amountCents >= 0;
    return `<span class="imp-rev-amount num${income ? " is-pos" : ""}">${income ? "+" : MINUS}${escHtml(fmtMoney(Math.abs(item.row.amountCents)))}</span>`;
  }

  function dayLabel(iso) {
    const d = new Date(iso + "T12:00:00");
    const short = `${t(`movimientos.weekdayShort.${d.getDay()}`)} ${d.getDate()}`;
    return short.charAt(0).toLocaleUpperCase() + short.slice(1);
  }

  /** Fila nueva: casilla (quitarla de la importación) + botón que abre la hoja de categoría. */
  function freshRowHtml(item) {
    const on = isIncluded(item, a);
    const name = rowLabel(item);
    return `<div class="imp-rev-row${on ? "" : " is-off"}" data-rev-row="${item.index}">
      ${checkboxHtml({ id: `imp-inc-${item.index}`, checked: on, label: t("importar.review.include", { name }) })}
      <button type="button" class="imp-rev-body" data-rev-cat="${item.index}" aria-label="${escAttr(t("importar.review.changeCat", { name }))}"${on ? "" : " disabled"}>
        <span class="imp-rev-l1"><span class="imp-rev-name">${escHtml(name)}</span>${amountHtml(item)}</span>
        <span class="imp-rev-l2">${rowCategoryHtml(item)}</span>
      </button>
    </div>`;
  }

  /** Fila que ya estaba (conciliada o duplicada): sin casilla ni categoría, con su marca. */
  function knownRowHtml(item) {
    const mark = t(item.action === "reconcile" ? "importar.review.markReconciled" : "importar.review.markSkipped");
    return `<div class="imp-rev-row is-known">
      <span class="imp-rev-body">
        <span class="imp-rev-l1"><span class="imp-rev-name">${escHtml(rowLabel(item))}</span>${amountHtml(item)}</span>
        <span class="imp-rev-l2"><span class="imp-rev-mark">${icon(item.action === "reconcile" ? "check" : "repeat", { size: 14 })}${escHtml(mark)}</span></span>
      </span>
    </div>`;
  }

  function listHtml(days, rowFn) {
    return `<div class="imp-rev-list">${days.map((g) => `${dayHeaderHtml({ label: dayLabel(g.date) })}
      ${g.items.map(rowFn).join('<div class="imp-rev-sep" aria-hidden="true"></div>')}`).join("")}</div>`;
  }

  /** Paso «Revisar» (B-3): recuentos, pestañas Nuevas / Sin categoría, la lista editable, lo que ya
   *  estaba y el primario con la cifra de lo que se va a crear. Todo sale de a.plan + las
   *  decisiones del usuario (a.excluded, a.categories): un render() tras cada toque basta. */
  function reviewHtml() {
    const c = reviewCounts(a.plan, a);
    const tile = (n, key, dim = false) => `<div class="imp-tile">
      <span class="imp-tile-value num${dim ? " is-dim" : ""}">${escHtml(String(n))}</span>
      <span class="imp-tile-label">${escHtml(t(key, { n }))}</span>
    </div>`;
    const bizum = partnerName && a.via === "n26";
    const uncatAll = reviewDays(a.plan, { actions: ["create"], onlyUncategorized: true, categories: a.categories })
      .reduce((n, g) => n + g.items.length, 0);
    if (a.tab === "uncat" && uncatAll === 0) a.tab = "new";
    const days = reviewDays(a.plan, { actions: ["create"], onlyUncategorized: a.tab === "uncat", categories: a.categories });
    const known = reviewDays(a.plan, { actions: ["reconcile", "skip"] });

    const tabs = c.fresh > 0 ? segmentedHtml({
      id: "imp-tab", name: t("importar.review.tabsAria"), value: a.tab,
      options: [
        { value: "new", label: t("importar.review.tabNew", { n: c.fresh }) },
        { value: "uncat", label: t("importar.review.tabUncat", { n: uncatAll }) },
      ],
    }) : "";

    let note;
    let label;
    let disabled = a.commitBusy;
    if (c.selected > 0) {
      label = t("importar.cta", { n: c.selected });
      note = c.uncategorized > 0 ? t("importar.inbox", { n: c.uncategorized }) : t("importar.allCategorized");
    } else if (c.reconciled > 0) {
      label = t("importar.review.ctaReconcile", { n: c.reconciled });
      note = c.fresh > 0 ? t("importar.review.noneSelected") : t("importar.nothingNew");
    } else {
      label = t("importar.done");
      note = c.fresh > 0 ? t("importar.review.noneSelected") : t("importar.nothingNew");
      disabled = false;
    }

    return `
      <section class="imp-tiles" aria-label="${escAttr(t("importar.summaryAria"))}">
        ${tile(c.fresh, "importar.tiles.created")}
        ${tile(c.reconciled, "importar.tiles.reconciled")}
        ${tile(c.skipped, "importar.tiles.skipped", true)}
      </section>
      ${c.omitted ? noteHtml({ ok: false, text: t("importar.omitted", { n: c.omitted }) }) : ""}
      ${bizum ? `<p class="imp-help">${escHtml(t("importar.bizumHint"))}</p>` : ""}
      ${tabs}
      ${days.length ? listHtml(days, freshRowHtml) : ""}
      ${known.length ? `<section class="imp-block" aria-labelledby="imp-l-known">
        ${sectionHeaderHtml({ title: t("importar.review.known"), count: c.reconciled + c.skipped, id: "imp-l-known", dim: true })}
        ${listHtml(known, knownRowHtml)}
      </section>` : ""}
      ${a.commitError ? `<div class="imp-msg" role="alert">${icon("warn", { size: 18 })}<p>${escHtml(a.commitError)}</p></div>` : ""}
      <div class="imp-foot">
        ${buttonHtml({ kind: "primary", id: "imp-commit", label, note, disabled })}
      </div>`;
  }

  /** Grupos por raíz para la hoja de categoría (mismo criterio que la rejilla de B-Gasto,
   *  registro.js#categoryGroups): una baldosa por raíz; `direct` si la raíz no tiene hijas. */
  function categoryGroups(cats) {
    const order = [];
    const byRoot = new Map();
    for (const cat of cats) {
      const root = rootOf(cat.id, a.cats.byId) || cat.id;
      if (!byRoot.has(root)) { byRoot.set(root, []); order.push(root); }
      byRoot.get(root).push(cat);
    }
    return order.map((root) => {
      const items = byRoot.get(root);
      return { root, name: a.cats.byId[root]?.name ?? items[0].name, items, direct: items.length === 1 && items[0].id === root };
    });
  }

  /** Cuerpo de la hoja de categoría. Gasto: las baldosas de familia de B-Gasto en filas de 3 y,
   *  bajo la fila de la desplegada, sus subcategorías como chips. Ingreso: chips neutros (C9, los
   *  ingresos no tienen familia). Arriba, «Sin categorizar» para dejarla en la bandeja. */
  function categorySheetBody(item, openRoot) {
    const cur = effectiveCategory(item, a);
    const none = `<div class="imp-sheet-chips">${filterChipHtml({ label: t("importar.review.uncategorized"), selected: !cur, check: true, data: { pickCat: "" } })}</div>`;
    if (item.type === "income") {
      return `${none}<div class="imp-sheet-chips">${a.cats.income.map((cat) => filterChipHtml({ label: cat.name, selected: cur === cat.id, check: true, data: { pickCat: cat.id } })).join("")}</div>`;
    }
    const groups = categoryGroups(a.cats.expense);
    const selRoot = cur ? rootOf(cur, a.cats.byId) : null;
    const rows = [];
    for (let i = 0; i < groups.length; i += 3) rows.push(groups.slice(i, i + 3));
    return `${none}<div class="imp-grid-wrap">${rows.map((row) => {
      const tiles = row.map((g) => pickTileHtml({
        fam: familyForCategory(g.root, a.cats.byId), icon: iconForCategory(g.root, a.cats.byId), label: g.name,
        selected: g.root === selRoot, expanded: g.direct ? null : g.root === openRoot,
        data: g.direct ? { pickCat: g.root } : { openRoot: g.root },
      })).join("");
      const openIdx = row.findIndex((g) => g.root === openRoot && !g.direct);
      let panel = "";
      if (openIdx >= 0) {
        const g = row[openIdx];
        const fc = famClass(familyForCategory(g.root, a.cats.byId));
        panel = `<div class="imp-subs ${fc || "imp-subs-neutral"}" style="--col:${openIdx}" role="group" aria-label="${escAttr(g.name)}">
          ${g.items.map((cat) => filterChipHtml({ label: cat.name, selected: cur === cat.id, check: true, data: { pickCat: cat.id } })).join("")}
        </div>`;
      }
      return `<div class="imp-grid">${tiles}</div>${panel}`;
    }).join("")}</div>`;
  }

  function openCategorySheet(item) {
    const cur = effectiveCategory(item, a);
    let openRoot = cur ? rootOf(cur, a.cats.byId) : null;
    const dlg = showSheet({ title: rowLabel(item), body: categorySheetBody(item, openRoot) });
    if (!dlg) return;
    let picked;
    const wireSheet = () => {
      dlg.querySelectorAll("[data-pick-cat]").forEach((b) => {
        b.onclick = () => { picked = b.dataset.pickCat; goBack(); };
      });
      dlg.querySelectorAll("[data-open-root]").forEach((b) => {
        b.onclick = () => {
          const root = b.dataset.openRoot;
          openRoot = openRoot === root ? null : root;
          dlg.querySelector(".sheet-body").innerHTML = categorySheetBody(item, openRoot);
          wireSheet();
          [...dlg.querySelectorAll("[data-open-root]")].find((x) => x.dataset.openRoot === root)?.focus();
        };
      });
    };
    wireSheet();
    dlg.addEventListener("close", () => {
      if (picked === undefined || !container.querySelector(".imp-screen")) return;
      if (picked === item.categoryId) delete a.categories[item.index];
      else a.categories[item.index] = picked;
      refocus = (root) => root.querySelector(`[data-rev-cat="${item.index}"]`);
      render();
    });
  }

  function render() {
    const stepNo = a.step === "columns" ? 2 : 3;
    // Un repintado sustituye el DOM: se conserva el scroll para que marcar una casilla o cambiar la
    // categoría de una fila de la mitad de una lista larga no devuelva al principio.
    const y = typeof window !== "undefined" ? window.scrollY : 0;
    container.innerHTML = `<div class="imp-screen">
      ${subHeaderHtml({ id: "assist-close", title: t("importar.title") })}
      ${stepsHtml({ total: 3, current: stepNo, ariaLabel: t("importar.steps.aria"), labels: [t("importar.steps.file"), t("importar.steps.columns"), t("importar.steps.review")] })}
      ${fileCardHtml()}
      ${a.step === "columns" ? columnsHtml() : reviewHtml()}
    </div>`;
    // Desde el asistente, «atrás» en Revisar vuelve a Columnas (B-Importar: «Volver a columnas»).
    if (a.step === "review" && a.fromAssistant) container.querySelector("#assist-close").setAttribute("aria-label", t("importar.backToColumns"));
    wire();
    if (typeof window !== "undefined" && window.scrollY !== y) window.scrollTo(0, y);
    if (refocus) {
      const el = refocus(container);
      refocus = null;
      if (el) el.focus();
    }
  }

  function wire() {
    const back = container.querySelector("#assist-close");
    back.disabled = Boolean(a.saveBusy || a.commitBusy);
    back.onclick = () => goBack();

    if (a.step === "review") {
      wireReview();
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
        const preview = await previewWithProfile(a.text, profile);
        await enterReview(a, preview);
        a.saveBusy = false;
        a.fromAssistant = true;
        // Entrada propia de «atrás»: el gesto del sistema (o la flecha) vuelve a Columnas con lo
        // que el usuario ya había elegido; nada se ha escrito todavía.
        pushBack(() => {
          if (!container.querySelector(".imp-screen")) return;
          a.step = "columns";
          render();
        });
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

  /** Salida tras escribir: a Ajustes. Desde el asistente hay DOS entradas de «atrás» (la de
   *  Ajustes y la de Revisar→Columnas); un salto de dos deja que back.js ejecute solo la de más
   *  abajo (la de Ajustes), sin pasar por Columnas. */
  function exitImporter() {
    if (a.fromAssistant) window.history.go(-2);
    else goBack();
  }

  function wireReview() {
    wireSegmented(container.querySelector("#imp-tab"), (tab) => {
      if (tab === a.tab) return;
      a.tab = tab;
      refocus = (root) => root.querySelector('#imp-tab [aria-checked="true"]');
      render();
    });

    container.querySelectorAll(".ctl-checkbox[id^='imp-inc-']").forEach((b) => {
      b.onclick = () => {
        const index = Number(b.id.slice("imp-inc-".length));
        a.excluded = a.excluded.includes(index) ? a.excluded.filter((i) => i !== index) : [...a.excluded, index];
        refocus = (root) => root.querySelector(`#imp-inc-${index}`);
        render();
      };
    });

    container.querySelectorAll("[data-rev-cat]").forEach((b) => {
      b.onclick = () => {
        const item = a.plan.items.find((i) => i.index === Number(b.dataset.revCat));
        if (item) openCategorySheet(item);
      };
    });

    container.querySelector("#imp-commit").onclick = async () => {
      if (a.commitBusy) return;
      const c = reviewCounts(a.plan, a);
      if (c.selected === 0 && c.reconciled === 0) { exitImporter(); return; }
      a.commitBusy = true; a.commitError = null; render();
      try {
        const res = await commitImport(a.rows, a.parseErrors, { excluded: a.excluded, categories: a.categories });
        showToast(res.created > 0 || res.reconciled === 0
          ? t("importar.doneToast", { n: res.created })
          : t("importar.doneReconciled", { n: res.reconciled }));
        exitImporter();
      } catch (err) {
        a.commitBusy = false;
        a.commitError = userMessage(err);
        render();
      }
    };
  }

  render();
}
