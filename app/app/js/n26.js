// Import de CSV de N26 (Task 15) + router genérico de import (PR E, Task 5). Puerto directo de
// apps_script/main.js:106-164 (retirado del repo en la PR E; ver historial de git)
// (processN26Csv) a la app: misma lógica de dedupe/conciliación, pero contra SQLite en vez de
// la hoja de cálculo. bcParseN26Csv / bcParseCsvLine / bcBuildExternalId / bcDecideImportAction /
// bcSanitizeCell / bcUlid son globales cargados por <script src="vendor/pure.js"> en index.html —
// NO se importan ni se toca ese fichero — la fuente única es app/vendor/pure.js (la copia que
// existía en apps_script/ se retiró del repo en la PR E).
import { SQL } from "./sql.js";
import { execMany } from "./db.js";
import { nowIso } from "./format.js";
import { getOpenPeriod, n26Existing, importAccountId, getMetaAll, loadMerchantMemory,
  listExpenseLeafCategories, listIncomeCategories } from "./repo.js";
import { sniffCsv, isN26Headers, applyProfile, parseCsvProfile, profileMatches } from "./csv-generic.js";
import { normalizeMerchant } from "./merchant-memory.js";
import { t } from "./i18n/index.js";
import { UserError } from "./errors.js";

/** Registro v2 §5.5: categoría con la que entra una fila NUEVA del import — la de la memoria del
 *  comercio si se conoce, o "" si no. PURA: no toca cuenta (ya es la del import,
 *  `importAccountId()`) ni compartido (marcar sola una fila importada como compartida cambiaría en
 *  silencio lo que la contraparte debe y lo que sale en «Liquidar»; eso lo decide una persona, no
 *  un heurístico). `memory` es el mapa de merchant-memory.js#merchantMemory.
 *
 *  `validCategoryIds` (opcional): merchantHistory mezcla expense/income/refund del mismo comercio
 *  — un banco puede repetir el mismo texto de comercio en un cargo y en un abono (p.ej. una
 *  compra y su devolución, o una nómina y un cargo con el mismo remitente). El TIPO de la fila
 *  importada lo decide el signo del importe (`amountCents < 0 ? "expense" : "income"`,
 *  runImportPipeline más abajo) y puede no coincidir con el tipo de la fila que ganó la memoria.
 *  Sin filtrar, se colaría un category_id de income en una fila expense (o viceversa) — igual que
 *  el mismo caso en registro.js#wire (merchant-memory.js#memoryPatch). Si se omite, no se filtra
 *  (uso desde los tests unitarios de esta función). */
export function categoryForImportedRow(row, memory, validCategoryIds) {
  const categoryId = memory?.[normalizeMerchant(row.partnerName)]?.categoryId || "";
  if (categoryId && validCategoryIds && !validCategoryIds.includes(categoryId)) return "";
  return categoryId;
}

/** SHA-256 hex vía Web Crypto (crypto.subtle), asíncrona — sustituye a gasSha256Hex (Apps
 *  Script usa Utilities.computeDigest, síncrona; el navegador no ofrece un SHA-256 síncrono). */
export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Adaptador de captura: bcBuildExternalId (pure.js) exige una función de hash SÍNCRONA, pero
 *  sha256Hex es async (crypto.subtle). Se llama dos veces: la 1ª con un hashFn falso que solo
 *  CAPTURA el payload construido por pure.js (sin usarlo), la 2ª ya con el hex resuelto — pure.js
 *  no se toca. */
export async function externalIdFor(row, hashFn = sha256Hex) {
  let payload;
  bcBuildExternalId(row.bookingDate, row.amountCents, row.partnerName, row.paymentReference,
    (p) => { payload = p; return "0".repeat(64); });
  const hex = await hashFn(payload);
  return bcBuildExternalId(row.bookingDate, row.amountCents, row.partnerName, row.paymentReference, () => hex);
}

/** Firma |amount_cents| según el type (M4/A2, review-seguridad-2026-08-29.md), para construir el
 *  `existing` que consume bcDecideImportAction (que compara SIGNOS, no valores absolutos, para
 *  decidir expense-vs-income — ver quiereGasto en pure.js). expense Y transfer son SIEMPRE
 *  dinero saliente de la cuenta importada (n26.js:56 original solo firmaba expense; una
 *  transferencia quedaba con signo +, como si fuera un ingreso). Exportada para poder testear el
 *  signo de forma aislada — bcDecideImportAction ya excluye 'transfer' de la conciliación (fix de
 *  arriba en pure.js), así que este signo no cambia NINGÚN resultado de decide hoy; solo importa
 *  por coherencia si `existing` se lee en otro sitio en el futuro.
 *  NO válida para 'adjustment': esa fila puede almacenarse ya con signo negativo (comentario
 *  original más abajo) y el Math.abs() se lo comería — pero adjustment tampoco es nunca candidato
 *  de conciliación, así que queda fuera del alcance de esta función a propósito.
 *  Un adjustment conserva SIEMPRE su propio signo y bcDecideImportAction (pure.js) lo excluye de la
 *  conciliación aparte — no reutilizar signedAmountCents para adjustments sin revisar antes eso. */
export function signedAmountCents(type, amountCentsAbs) {
  return Math.abs(amountCentsAbs) * ((type === "expense" || type === "transfer") ? -1 : 1);
}

/** ENSAYO del import (B-3, paso de revisión): decide qué haría el pipeline con cada fila SIN
 *  escribir nada. Es el bucle de siempre de runImportPipeline (dedupe por external_id, concilia
 *  pendientes manuales que casen en importe/sentido/±3 días, crea el resto con la categoría de la
 *  memoria de comercios si la hay), separado de la escritura para que la pantalla pueda enseñarlo
 *  y dejar al usuario quitar filas o cambiar su categoría antes de importar.
 *  PURA salvo el hash (async, inyectable): no muta `rows` ni `ctx.existing` — trabaja sobre copias
 *  (el pipeline viejo sí escribía `r.externalId` en la fila y empujaba a `existing`).
 *  `rows`: forma de bcParseN26Csv/applyProfile ({bookingDate, partnerName, paymentReference,
 *  amountCents}). `ctx`: { existing (ya firmado con signedAmountCents), memory, expenseCatIds,
 *  incomeCatIds }.
 *  Devuelve { items, counts, expenseCatIds, incomeCatIds }: un item por fila, en su orden, con
 *  `index` (posición en `rows`, la clave con la que la UI dice qué quita o recategoriza), `row`
 *  (copia con su externalId), `action` (create | reconcile | skip | omit), `matchId` (reconcile),
 *  `externalId` ("" si omit), `type` (por el signo) y, para create, `categoryId` + `fromMemory`.
 *  M4 (review-seguridad-2026-08-29.md): una fila de 0,00 (verificación de tarjeta) o con importe no
 *  numérico (CSV corrupto) es `omit` ANTES de hashear — nunca llega a insertTransaction (violaría
 *  el CHECK amount_cents>0 y tiraría el execMany entero). */
export async function planImportRows(rows, ctx, { hashFn = sha256Hex } = {}) {
  const existing = ctx.existing.map((e) => ({ ...e }));
  const expenseCatIds = ctx.expenseCatIds || [];
  const incomeCatIds = ctx.incomeCatIds || [];
  const counts = { created: 0, reconciled: 0, skipped: 0, omitted: 0, categorized: 0 };
  const items = [];

  for (let index = 0; index < rows.length; index++) {
    const row = { ...rows[index] };
    const type = row.amountCents < 0 ? "expense" : "income";
    if (row.amountCents === 0 || !Number.isFinite(row.amountCents)) {
      counts.omitted++;
      items.push({ index, row, action: "omit", matchId: "", externalId: "", type, categoryId: "", fromMemory: false });
      continue;
    }
    row.externalId = await externalIdFor(row, hashFn);
    const decision = bcDecideImportAction(row, existing);
    const item = { index, row, action: decision.action, matchId: "", externalId: row.externalId, type, categoryId: "", fromMemory: false };

    if (decision.action === "skip") {
      counts.skipped++;
    } else if (decision.action === "reconcile") {
      const match = existing.find((t) => t.id === decision.matchId);
      item.matchId = match.id;
      match.externalId = row.externalId; // para que filas posteriores del MISMO CSV ya no casen con ella
      counts.reconciled++;
    } else {
      // Solo categoría (§5.5): ni cuenta ni compartido — ver el comentario de categoryForImportedRow.
      item.categoryId = categoryForImportedRow(row, ctx.memory, type === "expense" ? expenseCatIds : incomeCatIds);
      item.fromMemory = Boolean(item.categoryId);
      if (item.fromMemory) counts.categorized++;
      // id provisional: solo sirve para que una fila idéntica posterior del MISMO CSV salga skip
      // (mismo external_id); el id real lo pone importStatements.
      existing.push({ id: `plan-${index}`, dateIso: row.bookingDate, type, amountCents: row.amountCents,
        externalId: row.externalId, status: "reconciled" });
      counts.created++;
    }
    items.push(item);
  }
  return { items, counts, expenseCatIds, incomeCatIds };
}

/** ESCRITURA del import (B-3): convierte un ensayo de planImportRows en las sentencias del
 *  execMany, aplicando lo que el usuario decidió en el paso de revisión. PURA.
 *  - `excluded`: índices de fila (item.index) que el usuario quitó. Solo afecta a filas `create`:
 *    conciliar o saltar una duplicada no es algo que se elija (se escriben/cuentan como siempre).
 *  - `categories`: { [index]: categoryId } elegida a mano; "" = sin categorizar. Se valida contra
 *    las categorías del TIPO de la fila (mismo criterio que categoryForImportedRow): una de otro
 *    tipo o inexistente se descarta y queda la sugerida.
 *  Devuelve { stmts, res } con `res` en la forma de siempre ({created, reconciled, skipped,
 *  omitted, categorized}), contando solo lo que de verdad se escribe. */
export function importStatements(plan, { periodId, accountId, now, newId = () => bcUlid(), excluded = [], categories = {} }) {
  const out = new Set((excluded || []).map(Number));
  const res = { created: 0, reconciled: 0, skipped: 0, omitted: 0, categorized: 0 };
  const stmts = [];
  for (const item of plan.items) {
    if (item.action === "omit") { res.omitted++; continue; }
    if (item.action === "skip") { res.skipped++; continue; }
    if (item.action === "reconcile") {
      stmts.push({ sql: SQL.reconcileTx, bind: [item.externalId, now, item.matchId] });
      res.reconciled++;
      continue;
    }
    if (out.has(item.index)) continue;
    const r = item.row;
    const valid = item.type === "expense" ? plan.expenseCatIds : plan.incomeCatIds;
    const chosen = Object.prototype.hasOwnProperty.call(categories, item.index) ? categories[item.index] : undefined;
    let categoryId = item.categoryId;
    if (chosen === "") categoryId = "";
    else if (typeof chosen === "string" && (valid || []).includes(chosen)) categoryId = chosen;
    if (categoryId) res.categorized++;
    stmts.push({
      sql: SQL.insertTransaction,
      // tag_id='' SIEMPRE (el "" tras rule_id): el import nunca etiqueta — qué es de un proyecto
      // lo decide una persona, no un CSV bancario (etiquetas-design §6).
      // has_attachment=0 SIEMPRE: un CSV bancario nunca trae una foto del ticket.
      bind: [newId(), r.bookingDate, periodId, item.type, Math.abs(r.amountCents), accountId, "",
        categoryId, bcSanitizeCell(r.partnerName), bcSanitizeCell(r.paymentReference),
        0, null, "me", 0, "", "", "", item.externalId, 0, "reconciled", now, now],
    });
    res.created++;
  }
  return { stmts, res };
}

/** Lee de la base lo que necesita el ensayo: periodo abierto, cuenta del import, movimientos ya
 *  existentes de esa cuenta (firmados), memoria de comercios y categorías válidas por tipo. */
async function loadImportContext() {
  const period = await getOpenPeriod();
  if (!period) throw new UserError(t("errors.common.noOpenPeriod"));
  const accountId = await importAccountId();
  if (!accountId) throw new UserError(t("errors.n26.noAccount"));

  const existing = (await n26Existing(accountId)).map((tx) => ({
    id: tx.id,
    dateIso: tx.date,
    type: tx.type,
    amountCents: signedAmountCents(tx.type, tx.amount_cents),
    externalId: tx.external_id,
    status: tx.status,
  }));
  // Cargada UNA vez antes del bucle (Registro v2 §5.5), no por fila: es la misma ventana de 500
  // movimientos que usa Registro, y no cambia mientras dure este import.
  const memory = await loadMerchantMemory();
  // Igual que categoriesFor() en registro.js: los ids válidos dependen del TIPO de cada fila, que
  // aquí varía fila a fila según el signo del importe — se cargan ambas listas una sola vez.
  const [expenseCatIds, incomeCatIds] = await Promise.all([
    listExpenseLeafCategories().then((cats) => cats.map((c) => c.id)),
    listIncomeCategories().then((cats) => cats.map((c) => c.id)),
  ]);
  return { period, accountId, existing, memory, expenseCatIds, incomeCatIds };
}

/** Cuerpo compartido de todo import de movimientos (N26 o CSV genérico vía perfil, Task 5 PR E):
 *  ensayo (planImportRows) + escritura (importStatements) en un único execMany al final (todo o
 *  nada). `choices` ({excluded, categories}) es lo que el usuario decidió en el paso de revisión;
 *  sin él, el comportamiento es el de siempre. El ensayo se REHACE aquí contra la base actual
 *  aunque la pantalla ya haya enseñado uno: no hay índice único sobre external_id, así que un
 *  doble toque o un ensayo viejo duplicaría filas; re-planeando, un segundo commit sale todo skip.
 *  Las decisiones del usuario viajan por índice de fila, estable porque las filas son las mismas. */
async function runImportPipeline(rows, choices = {}) {
  const ctx = await loadImportContext();
  const plan = await planImportRows(rows, ctx);
  const { stmts, res } = importStatements(plan, {
    periodId: ctx.period.id, accountId: ctx.accountId, now: nowIso(),
    excluded: choices.excluded, categories: choices.categories,
  });
  await execMany(stmts);
  return res;
}

/** Router PURO del import (Task 5 PR E; B-3): detecta el formato del CSV y devuelve sus filas
 *  parseadas sin tocar la base. Orden de detección: (1) cabeceras N26 exactas → bcParseN26Csv;
 *  (2) si no, el perfil guardado (`savedProfileRaw` = meta.csv_profile tal cual) si sus cabeceras
 *  casan exactamente → applyProfile; (3) si no, `needsMapping` con cabecera + muestra para el
 *  asistente. `parseErrors`: filas que applyProfile no pudo leer (fecha/importe), que no entran al
 *  pipeline y se suman a `omitted`. */
export function routeCsv(text, savedProfileRaw) {
  const { headers, sample } = sniffCsv(text, bcParseCsvLine);
  if (isN26Headers(headers)) return { via: "n26", rows: bcParseN26Csv(text), parseErrors: 0 };
  const profile = parseCsvProfile(savedProfileRaw);
  if (profile && profileMatches(profile, headers)) {
    const { rows, errors } = applyProfile(text, profile, bcParseCsvLine);
    return { via: "profile", rows, parseErrors: errors.length };
  }
  return { needsMapping: { headers, sample } };
}

async function previewRows(rows, parseErrors, via) {
  const ctx = await loadImportContext();
  const plan = await planImportRows(rows, ctx);
  plan.counts.omitted += parseErrors;
  return { via, rows, parseErrors, plan };
}

/** Ensayo de un CSV con el perfil indicado (el que acaba de configurar el asistente): nada se
 *  escribe. `plan.counts.omitted` ya suma las filas que applyProfile no pudo leer. */
export async function previewWithProfile(text, profile) {
  const { rows, errors } = applyProfile(text, profile, bcParseCsvLine);
  return previewRows(rows, errors.length, "profile");
}

/** Router del paso de revisión (B-3) SIN escribir nada: devuelve { via, rows, parseErrors, plan }
 *  para que la pantalla enseñe la lista, o { needsMapping } para abrir el asistente. La escritura
 *  la hace commitImport. */
export async function previewCsv(text) {
  // Guard temprano (ruling de la review de Task 5): sin periodo abierto, CUALQUIER CSV — incluso
  // basura irreconocible que de otro modo caería en needsMapping — falla con este mensaje
  // accionable ANTES de llegar al sniff.
  if (!(await getOpenPeriod())) throw new UserError(t("errors.common.noOpenPeriod"));
  const meta = await getMetaAll();
  const routed = routeCsv(text, meta.csv_profile);
  if (routed.needsMapping) return routed;
  return previewRows(routed.rows, routed.parseErrors, routed.via);
}

/** Escribe un import revisado: `rows`/`parseErrors` son los de previewCsv/previewWithProfile y
 *  `choices` = { excluded: [index], categories: {index: categoryId} }. Re-planea contra la base
 *  actual (ver runImportPipeline) y devuelve los contadores de lo escrito. */
export async function commitImport(rows, parseErrors = 0, choices = {}) {
  const res = await runImportPipeline(rows, choices);
  return { ...res, omitted: res.omitted + parseErrors };
}
