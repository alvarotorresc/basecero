/** Aritmética de «gasto vs. límite» por categoría: helpers PUROS (sin DOM ni BD) que comparten la
 *  pantalla «Gasto por categoría» y la tarjeta de Inicio. Vivían dentro de la antigua pantalla
 *  Presupuesto; al salir de una pantalla se pueden testear en Node sin Worker. */

/** Estado de una categoría (o del total) frente a su límite. Umbrales: ok < 85 %,
 *  warn >= 85 % (incluye el 100 % justo), over > 100 %. Sin límite (0/null/undefined) -> null:
 *  quien llama decide qué hacer (p.ej. tratarla como "sin límite este periodo"). pct SIN capar
 *  (para el número grande); quien pinta la barra la capa a 0..100 al renderizar. */
export function budgetStatus(spent, limit) {
  if (!limit) return null;
  const pct = (spent / limit) * 100;
  const level = pct > 100 ? "over" : pct >= 85 ? "warn" : "ok";
  return { pct, level };
}

/** El mismo porcentaje, ya redondeado a entero, para los textos. 0 si no hay límite (nunca
 *  NaN/Infinity). SIN capar, igual que budgetStatus. */
export function pctOf(spent, limit) {
  if (!limit) return 0;
  return Math.round((spent / limit) * 100);
}

/** Ancho (0..100) de la barra de una categoría SIN límite: su gasto en proporción al de la raíz
 *  que más gastó, para que la lista se lea como una comparativa. Acotado por los dos lados: una
 *  raíz con más devoluciones que gasto da spent negativo, y `width:-12%` es CSS inválido (el
 *  navegador descarta la declaración y el relleno se pinta entero). */
export function relativeWidth(spent, maxSpent) {
  if (!(maxSpent > 0)) return 0;
  return Math.min(100, Math.max(0, (spent / maxSpent) * 100));
}

/** Totales de la tarjeta héroe: gastado, límite y cuántas categorías, contando SOLO las raíces con
 *  límite > 0. `> 0` y no `!= null` a propósito: una fila a 0 (solo alcanzable importando una hoja
 *  a mano) es "sin límite" para budgetStatus, así que tampoco puede sumar aquí. */
export function limitTotals(rows, budgetByCategory) {
  let spent = 0;
  let limit = 0;
  let count = 0;
  for (const r of rows) {
    const l = budgetByCategory[r.root_id] ?? 0;
    if (l > 0) {
      spent += r.spent_cents;
      limit += l;
      count += 1;
    }
  }
  return { spent, limit, count };
}

/** Orden de la lista «Por categoría»: lo más gastado arriba; a igual gasto (típicamente varias a
 *  cero) primero las que tienen límite, porque son las que el usuario vigila; y a igualdad de
 *  ambas cosas, alfabético. Devuelve un array NUEVO: el llamante conserva el orden del SQL. */
export function sortRootRows(rows, budgetByCategory) {
  const hasLimit = (r) => ((budgetByCategory[r.root_id] ?? 0) > 0 ? 1 : 0);
  return [...rows].sort((a, b) =>
    b.spent_cents - a.spent_cents
    || hasLimit(b) - hasLimit(a)
    || String(a.name).localeCompare(String(b.name)));
}
