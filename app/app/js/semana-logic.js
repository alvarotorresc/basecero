/** Constructor PURO de la ventana semanal de la app (spec §6.2): sin DOM, sin `repo`, sin `i18n` —
 *  ni siquiera importa `prevision.js`. Es la ÚNICA fuente de «la semana»: las dos pantallas que
 *  pintan una barra apilada por día (Inicio compacta, Semana desplegada) comparten
 *  `daysWithCategories`, y `weekRange`/`fillDays` alimentan sus consultas.
 *
 *  La ventana son 7 días naturales que TERMINAN HOY, no la semana natural (decisión 9 de la spec):
 *  así se evita que «Esta semana» se quede casi vacía los lunes. `rangeLabelParts` devuelve
 *  números crudos (día, índice de mes 0-11), nunca texto: el nombre del mes lo resuelve la
 *  pantalla vía `i18n` (`monthLong`), este módulo no conoce idiomas. */

export const WEEK_DAYS = 7;

/** `n` fechas ISO ascendentes terminando en `todayIso` (inclusive), vía Date con mediodía local +
 *  toLocaleDateString("sv-SE"): cambiarlo aquí descuadraría el flujo de Inicio y la pantalla
 *  Semana entre sí, las dos ventanas de esta misma función. */
export function weekDates(todayIso, n = WEEK_DAYS) {
  const end = new Date(todayIso + "T12:00:00");
  const dates = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    dates.push(d.toLocaleDateString("sv-SE"));
  }
  return dates;
}

/** { start, end, dates } de la ventana — `start`/`end` son el bind de
 *  `repo.spentByDayAndRootCategory(periodId, start, end)`. */
export function weekRange(todayIso, n = WEEK_DAYS) {
  const dates = weekDates(todayIso, n);
  return { start: dates[0], end: dates[dates.length - 1], dates };
}

/** Completa los huecos de una consulta que solo trae los días CON movimiento
 *  ([{date,cents}], p.ej. SQL.spentByDay) con 0, para exactamente las fechas de `dates`. */
export function fillDays(rows, dates) {
  const byDate = Object.fromEntries(rows.map((r) => [r.date, r.cents]));
  return dates.map((date) => ({ date, cents: byDate[date] ?? 0 }));
}

/** rows: [{date, root_id, cents}] (SQL.spentByDayRootCategory) → un objeto por fecha de `dates`:
 *  { date, totalCents, segments:[{rootId,cents}], dominantRootId }.
 *  `totalCents` es la suma REAL de esa fecha (puede ser negativa: una devolución mayor que el
 *  gasto del día) — es el número que se pinta con decimales. `segments` SOLO lleva los `root_id`
 *  con cents > 0 (una barra no puede tener tramos negativos), en orden descendente: es lo que
 *  apila la espina y la barra del día. `dominantRootId` es el primer segmento (el de más gasto), o
 *  null si no hay ninguno positivo — el color del NODO de la espina, distinto del color de la
 *  barra entera. */
export function daysWithCategories(rows, dates) {
  const byDate = new Map(dates.map((d) => [d, []]));
  for (const r of rows) {
    if (!byDate.has(r.date)) continue;
    byDate.get(r.date).push(r);
  }
  return dates.map((date) => {
    const dayRows = byDate.get(date);
    const totalCents = dayRows.reduce((s, r) => s + r.cents, 0);
    const segments = dayRows
      .filter((r) => r.cents > 0)
      .sort((a, b) => b.cents - a.cents)
      .map((r) => ({ rootId: r.root_id, cents: r.cents }));
    return { date, totalCents, segments, dominantRootId: segments[0]?.rootId ?? null };
  });
}

/** Día de mayor gasto de la semana, para `relativeWidth(seg.cents, maxDayTotal)` — nunca negativo
 *  (una semana entera en negativo/cero no debe dejar ninguna barra con anchura). */
export const maxDayTotal = (days) => days.reduce((m, d) => Math.max(m, d.totalCents), 0);

/** { totalCents, avgCents } de la semana — avgCents = total / nº de días, redondeado. */
export function weekTotals(days) {
  const totalCents = days.reduce((s, d) => s + d.totalCents, 0);
  return { totalCents, avgCents: Math.round(totalCents / (days.length || 1)) };
}

/** [{rootId, cents}] para los chips «Dónde se ha ido esta semana»: NETO por raíz sumando todos los
 *  días de `rows`, orden descendente. Una raíz cuyo neto semanal queda a 0 o negativo (más
 *  devuelto que gastado en conjunto) no lleva chip — igual criterio que los `segments` de
 *  `daysWithCategories`. */
export function categoryTotals(rows) {
  const byRoot = new Map();
  for (const r of rows) byRoot.set(r.root_id, (byRoot.get(r.root_id) ?? 0) + r.cents);
  return [...byRoot.entries()]
    .filter(([, cents]) => cents > 0)
    .map(([rootId, cents]) => ({ rootId, cents }))
    .sort((a, b) => b.cents - a.cents);
}

/** Filtro puro sobre las filas de `listByDay`/`listAllByDay`: las de una fecha, en su mismo orden
 *  de llegada — es lo que lista un día desplegado de Semana. */
export const movementsOfDay = (rows, dateIso) => rows.filter((r) => r.date === dateIso);

/** Partes crudas del rótulo de rango («Del 3 al 9 de septiembre»): día y ÍNDICE de mes (0-11, el
 *  mismo que da Date#getMonth, listo para `monthLong`). La pantalla decide el texto con
 *  `semana.range.sameMonth`/`crossMonth`; este módulo no compone frases ni conoce idiomas. */
export function rangeLabelParts(startIso, endIso) {
  const start = new Date(startIso + "T12:00:00");
  const end = new Date(endIso + "T12:00:00");
  return {
    sameMonth: start.getMonth() === end.getMonth(),
    fromDay: start.getDate(),
    fromMonth: start.getMonth(),
    toDay: end.getDate(),
    toMonth: end.getMonth(),
  };
}
