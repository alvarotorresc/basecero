// Filtro 100% cliente de la pantalla Movimientos (Task 4, PR backlog: buscador + chips por
// categoría). SIN imports de db/repo (mismo motivo que category-order.js/prevision.js): solo
// depende de category-colors.js, que tampoco importa nada — así node --test lo importa directo,
// sin worker ni sqlite de por medio, y matchesFilter queda testeada de verdad.
import { rootOf } from "./category-colors.js";

/** ¿Esta fila cuenta como "sin categorizar"? Mismos 3 tipos que SQL.countUncategorized y el resto
 *  de la pantalla (chip "Sin categoría · N", bandeja de hoy): expense/income/refund con
 *  category_id vacío. transfer/adjustment nunca llevan categoría — si entraran aquí, aparecerían
 *  mezcladas en "Sin categoría" sin que el usuario pueda categorizarlas nunca (no tienen chip de
 *  categoría en su formulario de detalle). */
export const isUncategorized = (r) =>
  r.category_id === "" && (r.type === "expense" || r.type === "income" || r.type === "refund");

/** Predicado puro del filtro de Movimientos. `filter` = { query, rootCatId, uncat } (movimientos.js
 *  Task 4): las tres condiciones se combinan con AND, cada una evaluada de forma independiente —
 *  esta función no asume que rootCatId y uncat sean mutuamente excluyentes (esa exclusión la
 *  garantiza la UI, que solo deja una chip de categoría activa a la vez). Con las tres en su valor
 *  neutro (query:"", rootCatId:null, uncat:false — la chip «Todos») hace match con cualquier fila. */
export function matchesFilter(row, filter, byId) {
  if (!filter) return true;
  const query = String(filter.query ?? "").trim().toLowerCase();
  if (query) {
    const merchant = String(row.merchant ?? "").trim().toLowerCase();
    const note = String(row.note ?? "").trim().toLowerCase();
    if (!merchant.includes(query) && !note.includes(query)) return false;
  }
  if (filter.rootCatId && rootOf(row.category_id, byId) !== filter.rootCatId) return false;
  if (filter.uncat && !isUncategorized(row)) return false;
  return true;
}
