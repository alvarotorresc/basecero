// Import de CSV de N26 (Task 15). Puerto directo de apps_script/main.js:106-164
// (processN26Csv) a la app: misma lógica de dedupe/conciliación, pero contra SQLite en vez de
// la hoja de cálculo. bcParseN26Csv / bcBuildExternalId / bcDecideImportAction / bcSanitizeCell /
// bcUlid son globales cargados por <script src="vendor/pure.js"> en index.html — NO se importan
// ni se toca ese fichero (copia verbatim de apps_script/pure.js).
import { SQL } from "./sql.js";
import { execMany } from "./db.js";
import { nowIso } from "./format.js";
import { getOpenPeriod, n26Existing } from "./repo.js";

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

/** Importa un CSV de N26: dedupe por external_id, concilia pendientes manuales que casen en
 *  importe/sentido/±3 días, crea el resto sin categorizar. Devuelve los contadores para el
 *  banner de Ajustes. Un único execMany al final (todo o nada). */
export async function importN26Csv(text) {
  const period = await getOpenPeriod();
  if (!period) throw new Error("No hay ningún periodo abierto");

  // Re-firma en memoria (puerto literal del brief: |amount_cents| × signo por type). El CHECK de
  // la tabla exige amount_cents>0 SOLO para type<>'adjustment' — acc-n26 podría en teoría tener
  // algún adjustment con signo negativo, de ahí el Math.abs explícito en vez de asumir positivo.
  const existing = (await n26Existing()).map((t) => ({
    id: t.id,
    dateIso: t.date,
    type: t.type,
    amountCents: Math.abs(t.amount_cents) * (t.type === "expense" ? -1 : 1),
    externalId: t.external_id,
    status: t.status,
  }));

  const rows = bcParseN26Csv(text);
  const res = { created: 0, reconciled: 0, skipped: 0 };
  const now = nowIso();
  const stmts = [];

  for (const r of rows) {
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
      stmts.push({
        sql: SQL.insertTransaction,
        bind: [id, r.bookingDate, period.id, type, Math.abs(r.amountCents), "acc-n26", "",
          "", bcSanitizeCell(r.partnerName), bcSanitizeCell(r.paymentReference),
          0, null, 0, "", "", r.externalId, "reconciled", now, now],
      });
      existing.push({ id, dateIso: r.bookingDate, type, amountCents: r.amountCents,
        externalId: r.externalId, status: "reconciled" });
      res.created++;
    }
  }

  await execMany(stmts);
  return res;
}
