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

/** Cuerpo compartido de todo import de movimientos (N26 o CSV genérico vía perfil, Task 5 PR E):
 *  dedupe por external_id, concilia pendientes manuales que casen en importe/sentido/±3 días,
 *  crea el resto sin categorizar. `rows` ya viene parseado — misma forma exacta que produce
 *  bcParseN26Csv y que produce applyProfile (csv-generic.js): {bookingDate, partnerName,
 *  paymentReference, amountCents}. Devuelve los contadores para el banner de Ajustes. Un único
 *  execMany al final (todo o nada). Extraído literal de importN26Csv (antes de Task 5 era todo
 *  el cuerpo de esa función) — CERO cambio de comportamiento, solo se movió el parseo del CSV
 *  (bcParseN26Csv) fuera, al llamador.
 *  M4 (review-seguridad-2026-08-29.md): una fila de 0,00 (verificación de tarjeta) o con importe
 *  no numérico (CSV corrupto) se salta ANTES de entrar al pipeline — se cuenta en `omitted` en
 *  vez de dejar que insertTransaction viole el CHECK amount_cents>0 y tire abajo el execMany
 *  entero (todo el resto de filas del import se perdía con un error SQL crudo). */
async function runImportPipeline(rows) {
  const period = await getOpenPeriod();
  if (!period) throw new UserError(t("errors.common.noOpenPeriod"));
  const accountId = await importAccountId();
  if (!accountId) throw new UserError(t("errors.n26.noAccount"));

  const existing = (await n26Existing(accountId)).map((t) => ({
    id: t.id,
    dateIso: t.date,
    type: t.type,
    amountCents: signedAmountCents(t.type, t.amount_cents),
    externalId: t.external_id,
    status: t.status,
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

  const res = { created: 0, reconciled: 0, skipped: 0, omitted: 0, categorized: 0 };
  const now = nowIso();
  const stmts = [];

  for (const r of rows) {
    if (r.amountCents === 0 || !Number.isFinite(r.amountCents)) { res.omitted++; continue; }
    r.externalId = await externalIdFor(r);
    const decision = bcDecideImportAction(r, existing);

    if (decision.action === "skip") {
      res.skipped++;
    } else if (decision.action === "reconcile") {
      const match = existing.find((t) => t.id === decision.matchId);
      stmts.push({ sql: SQL.reconcileTx, bind: [r.externalId, now, match.id] });
      match.externalId = r.externalId; // para que filas posteriores del MISMO CSV ya no casen con ella
      res.reconciled++;
    } else {
      const id = bcUlid();
      const type = r.amountCents < 0 ? "expense" : "income";
      // Solo categoría (§5.5): ni cuenta ni compartido — ver el comentario de categoryForImportedRow.
      const categoryId = categoryForImportedRow(r, memory, type === "expense" ? expenseCatIds : incomeCatIds);
      if (categoryId) res.categorized++;
      stmts.push({
        sql: SQL.insertTransaction,
        // tag_id='' SIEMPRE (el "" tras rule_id): el import nunca etiqueta — qué es de un proyecto
        // lo decide una persona, no un CSV bancario (etiquetas-design §6).
        bind: [id, r.bookingDate, period.id, type, Math.abs(r.amountCents), accountId, "",
          categoryId, bcSanitizeCell(r.partnerName), bcSanitizeCell(r.paymentReference),
          0, null, "me", 0, "", "", "", r.externalId, "reconciled", now, now],
      });
      existing.push({ id, dateIso: r.bookingDate, type, amountCents: r.amountCents,
        externalId: r.externalId, status: "reconciled" });
      res.created++;
    }
  }

  await execMany(stmts);
  return res;
}

/** Importa un CSV de N26. Conservada como export propio (no solo camino interno del router):
 *  la sigue llamando directamente Ajustes (Task 15, previa a esta PR) y es lo que reproduce el
 *  test de paridad de este fichero — cambiar su firma o retirarla habría obligado a tocar la UI
 *  fuera del alcance de esta tarea (Task 6). El router (importCsv) también la usa cuando detecta
 *  cabeceras N26. */
export async function importN26Csv(text) {
  return runImportPipeline(bcParseN26Csv(text));
}

/** Aplica un perfil de CSV genérico (csv-generic.js) y mete las filas válidas por el MISMO
 *  pipeline de dedupe/conciliación que N26. Las filas con error de applyProfile (fecha/importe
 *  inválidos) NO entran al pipeline: se cuentan aparte como `omitted` y no bloquean el resto.
 *  `res.omitted` ya trae su propio conteo (M4: filas de 0,00 o no numéricas descartadas DENTRO
 *  del pipeline) — se SUMA a errors.length, nunca se pisa. */
export async function importWithProfile(text, profile) {
  const { rows, errors } = applyProfile(text, profile, bcParseCsvLine);
  const res = await runImportPipeline(rows);
  return { ...res, omitted: res.omitted + errors.length };
}

/** Router de import (Task 5, PR E): detecta el formato del CSV y elige camino sin que la UI
 *  tenga que saber nada de N26 ni de perfiles. Orden de detección: (1) cabeceras N26 exactas →
 *  camino de siempre; (2) si no, perfil guardado en meta.csv_profile cuyas cabeceras casen
 *  exactamente → import genérico; (3) si no hay match, `needsMapping` con cabecera+muestra para
 *  que la UI (Task 6) abra el asistente — SIN tocar la base de datos más allá de la lectura de
 *  meta necesaria para decidir. */
export async function importCsv(text) {
  // Guard temprano (ruling de la review de Task 5): sin periodo abierto, CUALQUIER CSV — incluso
  // basura irreconocible que de otro modo caería en needsMapping — debe fallar con este mensaje
  // accionable ANTES de llegar al sniff, para que gane siempre sobre "cabecera no reconocida"
  // (runImportPipeline ya repetía esta misma comprobación, pero solo se alcanza en los caminos
  // N26/perfil; needsMapping no pasaba nunca por ahí).
  if (!(await getOpenPeriod())) throw new UserError(t("errors.common.noOpenPeriod"));
  const { headers, sample } = sniffCsv(text, bcParseCsvLine);
  if (isN26Headers(headers)) {
    const res = await importN26Csv(text);
    return { ...res, via: "n26" };
  }

  const meta = await getMetaAll();
  const profile = parseCsvProfile(meta.csv_profile);
  if (profile && profileMatches(profile, headers)) {
    const res = await importWithProfile(text, profile);
    return { ...res, via: "profile" };
  }

  return { needsMapping: { headers, sample } };
}
