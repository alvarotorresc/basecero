// B-3 · paso de revisión del import (screens/importar.js): cuentas y agrupado de la lista a partir
// del ENSAYO de n26.js#planImportRows y de lo que el usuario va decidiendo (filas quitadas y
// categorías cambiadas). PURO y sin imports: la pantalla lo recalcula en cada repintado.
//
// `choices` = { excluded: [index], categories: { [index]: categoryId } } — las mismas claves que
// consume n26.js#importStatements. "" en categories = «sin categorizar».

/** Categoría con la que entraría una fila nueva: la elegida a mano si la hay; si no, la sugerida. */
export function effectiveCategory(item, choices = {}) {
  const cats = choices.categories || {};
  return Object.prototype.hasOwnProperty.call(cats, item.index) ? cats[item.index] : item.categoryId;
}

/** ¿Sigue marcada la casilla de esta fila nueva? */
export function isIncluded(item, choices = {}) {
  return !(choices.excluded || []).map(Number).includes(item.index);
}

/** Recuentos del resumen y del primario:
 *  fresh          filas nuevas del fichero (las que se pueden quitar)
 *  selected       de ellas, las que siguen marcadas (lo que se va a crear)
 *  uncategorized  de las marcadas, las que entran sin categoría (irán a la bandeja)
 *  reconciled / skipped / omitted  lo que el ensayo concilia, salta por duplicada u omite. */
export function reviewCounts(plan, choices = {}) {
  const fresh = plan.items.filter((i) => i.action === "create");
  const selected = fresh.filter((i) => isIncluded(i, choices));
  return {
    fresh: fresh.length,
    selected: selected.length,
    uncategorized: selected.filter((i) => !effectiveCategory(i, choices)).length,
    reconciled: plan.counts.reconciled,
    skipped: plan.counts.skipped,
    omitted: plan.counts.omitted,
  };
}

/** Filas agrupadas por día (de la más reciente a la más antigua, y dentro del día en el orden del
 *  fichero) para la lista. `actions`: qué acciones entran; `onlyUncategorized`: solo las que hoy
 *  entrarían sin categoría (la pestaña «Sin categoría», con `categories` para mirar la efectiva).
 *  @returns {{date: string, items: object[]}[]} */
export function reviewDays(plan, { actions = ["create"], onlyUncategorized = false, categories = {} } = {}) {
  const byDate = new Map();
  for (const item of plan.items) {
    if (!actions.includes(item.action)) continue;
    if (onlyUncategorized && effectiveCategory(item, { categories })) continue;
    const date = item.row.bookingDate;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(item);
  }
  return [...byDate.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)).map((date) => ({ date, items: byDate.get(date) }));
}

/** Cuántas entradas de «atrás» deshacer tras escribir el import para volver a Ajustes, según dónde
 *  esté el usuario CUANDO TERMINA la escritura (puede haber hecho el gesto «atrás» mientras tanto):
 *   - importador desmontado (ya volvió a Ajustes u otra pantalla): 0, solo el aviso;
 *   - sigue en Revisar: 2 si llegó desde el asistente (Revisar→Columnas + Ajustes), 1 si no;
 *   - volvió a Columnas (asistente) durante la escritura: 1, la entrada de Ajustes.
 *  @returns {0|1|2} */
export function exitStepsAfterCommit({ mounted, step, fromAssistant }) {
  if (!mounted) return 0;
  if (step === "review") return fromAssistant ? 2 : 1;
  return 1;
}
