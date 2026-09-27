import { normalizePct } from "./share-pct.js";

/** Prefijado de «Crear gasto» al duplicar un movimiento (B-5, S6/movimiento-detalle.js): tipo,
 *  importe, comercio, categoría, cuenta, cuenta destino, etiqueta, reparto/compartido y nota de la
 *  fila original — la fecha (hoy) y la foto (ninguna) las decide `registro.js` por su cuenta, así
 *  que no van aquí. NUNCA copia `ref_id`, `rule_id` ni `external_id`: son enlaces de la fila
 *  original (una devolución/ajuste de liquidación, o una regla recurrente) que no le pertenecen a
 *  una copia nueva — `addTransaction` incluso marca `settled=1` en la fila que apunta `ref_id`, así
 *  que copiarlo tocaría datos reales de otro movimiento.
 *
 *  `row` es la fila de `getTransaction` (repo.js, columnas snake_case). `defaultSharePct` es el %
 *  del periodo de la fila (`my_share_pct`), el mismo fallback que usa movimiento-detalle.js para
 *  pintar `state.detail.sharePct`: se aplica solo cuando la fila no lleva `share_pct_override`.
 *
 *  Categoría, cuenta, cuenta destino y etiqueta SE OMITEN (la clave no existe en el resultado) en
 *  vez de mandarse vacías o `null` cuando la fila no las lleva —una transferencia sin categoría, o
 *  un gasto que pagó la contraparte con `account_id` en blanco—: `registro.js` solo cae a su valor
 *  por defecto (cuenta automática, etc.) con la clave AUSENTE (`??` no distingue `null` de
 *  `undefined` para eso), y solo marca el campo como «tocado por el usuario» (`state.touched`,
 *  que blinda el valor frente a la memoria de comercios) cuando de verdad había una elección. */
export function buildDuplicatePrefill(row, defaultSharePct = 100) {
  const prefill = {
    type: row.type,
    amountCents: Math.abs(row.amount_cents),
    // Solo el ajuste tiene signo propio (registro.js#adjustmentSign); en el resto de tipos se
    // ignora, pero calcularlo siempre es más simple que ramificar por tipo.
    adjustmentSign: row.amount_cents < 0 ? "-" : "+",
    merchant: row.merchant || "",
    note: row.note || "",
    // Decisión, no vacío: is_shared/paid_by SIEMPRE van, aunque sea "no compartido", porque eso
    // también es lo que el usuario eligió en la fila original.
    isShared: !!row.is_shared,
    paidBy: row.paid_by === "partner" ? "partner" : "me",
    sharePct: normalizePct(row.share_pct_override ?? defaultSharePct, 100),
  };
  if (row.category_id) prefill.categoryId = row.category_id;
  if (row.account_id) prefill.accountId = row.account_id;
  if (row.counter_account_id) prefill.counterAccountId = row.counter_account_id;
  if (row.tag_id) prefill.tagId = row.tag_id;
  return prefill;
}
