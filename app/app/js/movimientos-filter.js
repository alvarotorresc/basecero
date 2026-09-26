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

/** Predicado puro del filtro de Movimientos. `filter` = { query, rootCatId, uncat, tagId }
 *  (movimientos.js): las condiciones se combinan con AND, cada una evaluada de forma
 *  independiente — esta función no asume que rootCatId y uncat sean mutuamente excluyentes (esa
 *  exclusión la garantiza la UI, que solo deja una chip de categoría activa a la vez). Con todas
 *  en su valor neutro (query:"", rootCatId:null, uncat:false, tagId ausente/null — la chip
 *  «Todas») hace match con cualquier fila.
 *  tagId (Etiquetas, N11): comparación ESTRICTA contra el id, nunca contra el nombre. Es la
 *  cuarta condición, el mismo AND independiente que las otras tres. */
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
  if (filter.tagId && row.tag_id !== filter.tagId) return false;
  return true;
}

/** Agrupa las filas de listAllByDay (ya vienen ordenadas por date DESC) en bloques por día,
 *  preservando el orden de llegada (mismo patrón que inicio.js). */
export function groupByDay(rows) {
  const groups = [];
  let current = null;
  for (const r of rows) {
    if (!current || current.date !== r.date) {
      current = { date: r.date, rows: [] };
      groups.push(current);
    }
    current.rows.push(r);
  }
  return groups;
}

/** Total de la cabecera de día de Movimientos (B-Movimientos): lo gastado ese día entre las filas
 *  VISIBLES (con el filtro puesto, lo gastado en lo filtrado). Mismo criterio que spentOfPeriod
 *  (sql.js), fila a fila: cada gasto suma MI parte (`my_amount_cents`) y cada devolución la resta,
 *  salvo que liquide un gasto compartido (su `ref_id` apunta a un gasto con is_shared: ahí lo que
 *  vuelve es la parte de la contraparte, y mi gasto ya contaba solo la mía). Ingresos,
 *  transferencias y ajustes no son gasto y no cuentan.
 *  `rowsById`: las filas del periodo por id, para mirar el gasto enlazado. Una devolución cuyo gasto
 *  no está en el periodo cargado se trata como no liquidación (resta), como el huérfano de SQL. */
export function daySpentCents(dayRows, rowsById = {}) {
  let total = 0;
  for (const r of dayRows) {
    const mine = Number(r.my_amount_cents ?? r.amount_cents) || 0;
    if (r.type === "expense") total += mine;
    else if (r.type === "refund") {
      const linked = r.ref_id ? rowsById[r.ref_id] : null;
      if (!(linked && linked.type === "expense" && linked.is_shared)) total -= mine;
    }
  }
  return total;
}
