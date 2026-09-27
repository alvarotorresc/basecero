// Filtro 100% cliente de la pantalla Movimientos (Task 4, PR backlog: buscador + chips por
// categoría). SIN imports de db/repo (mismo motivo que category-order.js/prevision.js): solo
// depende de category-colors.js, que tampoco importa nada — así node --test lo importa directo,
// sin worker ni sqlite de por medio, y matchesFilter queda testeada de verdad. format.js (solo
// parseCentsRaw, para los topes de importe de B-2) tampoco toca BD ni DOM.
import { rootOf } from "./category-colors.js";
import { parseCentsRaw } from "./format.js";

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
/*  B-2 (filtros múltiples, B-Movimientos-Filtros) añade campos opcionales, todos neutros si faltan,
 *  así que el filtro de siempre ({ query, rootCatId, uncat, tagId }) se evalúa igual que antes:
 *   - rootCatIds: [ids de raíz]. Con al menos una, la fila casa si su raíz es CUALQUIERA de ellas
 *     (O). En este camino `uncat` es una opción más de la misma sección «Categorías»: casa la
 *     fila sin categorizar O la de una raíz elegida. Vacío o ausente: sin restricción (y `uncat`,
 *     si viene, se evalúa como siempre).
 *   - accountId: la cuenta del movimiento o, en una transferencia, la de destino
 *     (counter_account_id): filtrar por la hucha enseña lo que entró en ella.
 *   - minCents / maxCents: topes INCLUSIVOS sobre rowAmountCents (la cifra que enseña la fila).
 *     null/undefined = sin tope; 0 sí es un tope.
 *   - sharedOnly: solo movimientos compartidos (is_shared).
 *  Todos los grupos se combinan en Y entre sí y con query/tagId. */
/** Filtro con el que se abre Movimientos: neutro, salvo lo que llegue de goToTab("movimientos",
 *  opts) — `tagId` desde Etiquetas (N11) o `accountId` desde el detalle de cuenta (B-6, «Ver
 *  todos»). Mismo shape que el state.filter de movimientos.js. */
export function initialFilter({ tagId = null, accountId = null } = {}) {
  return { query: "", rootCatIds: [], uncat: false, tagId: tagId || null, accountId: accountId || null, minCents: null, maxCents: null, sharedOnly: false };
}

export function matchesFilter(row, filter, byId) {
  if (!filter) return true;
  const query = String(filter.query ?? "").trim().toLowerCase();
  if (query) {
    const merchant = String(row.merchant ?? "").trim().toLowerCase();
    const note = String(row.note ?? "").trim().toLowerCase();
    if (!merchant.includes(query) && !note.includes(query)) return false;
  }
  if (filter.rootCatId && rootOf(row.category_id, byId) !== filter.rootCatId) return false;
  const roots = Array.isArray(filter.rootCatIds) ? filter.rootCatIds.filter(Boolean) : [];
  if (roots.length > 0) {
    const inRoots = row.category_id !== "" && row.category_id != null && roots.includes(rootOf(row.category_id, byId));
    if (!inRoots && !(filter.uncat && isUncategorized(row))) return false;
  } else if (filter.uncat && !isUncategorized(row)) return false;
  if (filter.tagId && row.tag_id !== filter.tagId) return false;
  if (filter.accountId && row.account_id !== filter.accountId && row.counter_account_id !== filter.accountId) return false;
  const hasMin = filter.minCents !== null && filter.minCents !== undefined;
  const hasMax = filter.maxCents !== null && filter.maxCents !== undefined;
  if (hasMin || hasMax) {
    const amt = rowAmountCents(row);
    if (hasMin && amt < filter.minCents) return false;
    if (hasMax && amt > filter.maxCents) return false;
  }
  if (filter.sharedOnly && !row.is_shared) return false;
  return true;
}

/** Importe con el que se compara el rango de B-2: la cifra que ENSEÑA la fila de Movimientos
 *  (movRowHtml) — en un compartido, mi parte; en el resto, el importe — en valor absoluto (un
 *  ajuste puede ser negativo). */
export function rowAmountCents(row) {
  const cents = row.is_shared ? (row.my_amount_cents ?? row.amount_cents) : row.amount_cents;
  return Math.abs(Number(cents) || 0);
}

/** Texto de «Desde»/«Hasta» → tope en céntimos. Vacío (o sin ninguna cifra) es «sin tope» = null,
 *  NUNCA 0: parseCentsRaw("") da 0, y un «Hasta» vacío escondería todas las filas. El signo no
 *  cuenta (los importes se comparan en valor absoluto). */
export function amountBoundCents(raw) {
  const s = String(raw ?? "").trim();
  if (!s || !/\d/.test(s)) return null;
  return Math.abs(parseCentsRaw(s));
}

/** ¿Hay algún filtro de la hoja puesto? (la búsqueda no cuenta: tiene su propio campo). */
export function isFilterActive(filter) {
  if (!filter) return false;
  return activeCategoryCount(filter) > 0 || !!filter.tagId || !!filter.accountId
    || (filter.minCents !== null && filter.minCents !== undefined)
    || (filter.maxCents !== null && filter.maxCents !== undefined)
    || !!filter.sharedOnly;
}

/** Cifra de «Categorías N» de la hoja: raíces elegidas más «sin categoría». */
export function activeCategoryCount(filter) {
  const roots = Array.isArray(filter?.rootCatIds) ? filter.rootCatIds.filter(Boolean).length : 0;
  return roots + (filter?.rootCatId ? 1 : 0) + (filter?.uncat ? 1 : 0);
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
