// Asistente de mapeo CSV genérico (Task 6, PR E): subvista de Ajustes que se abre cuando
// importCsv() (router de n26.js, Task 5) devuelve needsMapping — banco sin soporte dedicado.
// Vive aparte de ajustes.js desde S4 (rediseño B): Ajustes ya está migrado al sistema B y el
// asistente se rediseña en S12, así que este fichero sigue en PENDIENTES hasta entonces.
// Mismo comportamiento que antes: se pinta en el contenedor de Ajustes, su «atrás» es la entrada
// de historial que Ajustes apunta con pushBack antes de abrirlo, y el resultado del import vuelve
// a Ajustes por onImported(texto) — que pinta el banner y hace goBack().
import { setMeta } from "../repo.js";
import { fmtMoney } from "../format.js";
import { goBack } from "../back.js";
import { importWithProfile } from "../n26.js";
import { buildProfile, applyProfile, detectDateFormat, detectDecimal, parseDateIso, parseAmountCents, summarizeReasons } from "../csv-generic.js";
import { t } from "../i18n/index.js";
import { userMessage } from "../errors.js";
import { showToast } from "../toast.js";
import { subHeaderHtml, metaHtml } from "../ui.js";
import { icon } from "../icons.js";
import { escHtml, escAttr } from "../esc.js";

// Pastilla de asignación de cabecera: NO reutiliza .chip/.chips de app.css (esas asumen un
// .chip-icon circular a la izquierda que este selector no lleva) — mismo criterio que el
// chipStyle() local de categorias.js (Task 6 PR D); no hay módulo de UI compartido entre
// pantallas para esta variante de pastilla de solo texto.
function assistChipStyle(active) {
  return `display:inline-flex;align-items:center;font-size:13px;font-weight:${active ? 600 : 500};
    background:${active ? "var(--accent)" : "var(--surface-2)"};color:${active ? "var(--accent-ink)" : "var(--ink-2)"};
    border:0;border-radius:999px;padding:12px 14px;white-space:nowrap;cursor:pointer;
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
export function importResultText(res, partnerName) {
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

/** Estado inicial del asistente para un CSV que importCsv() no supo leer solo. */
export function newAssistantState(fileName, text, needsMapping) {
  return {
    fileName, text, headers: needsMapping.headers, sample: needsMapping.sample,
    totalRows: csvDataRowCount(text),
    date: null, concept: null, counterparty: null,
    amountKind: "single", amountCol: null, debitCol: null, creditCol: null,
    saveBusy: false, saveError: null,
  };
}

/** Pinta el asistente en `container` y se repinta solo en cada toque. `a` es el estado de
 *  newAssistantState; `onImported(texto)` recibe el resumen del import ya hecho. */
export function renderImportAssistant(container, a, { partnerName = "", onImported }) {
  const state = { assistant: a };
  const render = () => renderAssistant();

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
        // onImported deja el resultado en el estado de Ajustes ANTES de su goBack(): backToMain
        // corre luego en el popstate y renderMain() ya lo encuentra puesto.
        onImported(importResultText({ ...res, via: "profile" }, partnerName));
      } catch (err) {
        a.saveBusy = false;
        a.saveError = userMessage(err);
        render();
      }
    };
  }

  render();
}
