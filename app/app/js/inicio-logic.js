/** Aritmética PURA de la nueva Inicio (spec docs/superpowers/specs/2026-09-10-inicio-v2-design.md
 *  §6.1): sin DOM, sin `repo`, sin `i18n` — mismo criterio que `prevision.js`/`category-spend.js`,
 *  así se testea en Node sin Worker de por medio. Solo importa `prevision.js` (puro → puro).
 *
 *  `huchaMessage` devuelve un DESCRIPTOR ({kind,key,params}), nunca una frase ya escrita: así el
 *  test no depende del idioma y es la pantalla quien decide la clave de `t()` (incluida la
 *  variante «hoy» de `periodEnd`, que se distingue por `params.n === 0`). */

import { dayIndexOfPeriod, expectedPeriodDays } from "./prevision.js";

/** Siguiente cuenta del ciclo (display_order de `accounts`), volviendo a la primera. `currentId`
 *  desconocido cae al principio del ciclo — es lo que pasa la primera vez que se toca el selector
 *  si `meta.default_account_id` apuntara a una cuenta ya borrada. */
export function nextAccountId(accounts, currentId) {
  if (!accounts || accounts.length === 0) return null;
  const idx = accounts.findIndex((a) => a.id === currentId);
  if (idx === -1) return accounts[0].id;
  return accounts[(idx + 1) % accounts.length].id;
}

/** Días que faltan del periodo (decisión 4 de la spec): expectedPeriodDays − dayIndexOfPeriod, es
 *  decir SIN contar hoy. Devuelve el valor CRUDO — puede ser 0 (último día) o negativo (periodo
 *  que se alarga más allá de su duración nominal): el max(1, …) que evita la división por cero
 *  vive DENTRO de dailyAllowanceCents, nunca aquí; la etiqueta «21 días» de la pantalla aplica su
 *  propio max(0, …) al pintar. */
export function daysLeftOfPeriod(startDateIso, todayIso) {
  return expectedPeriodDays(startDateIso) - dayIndexOfPeriod(startDateIso, todayIso);
}

/** «Te quedarán» (spec §2.1): disponible del periodo menos lo comprometido en recurrentes
 *  pendientes. Puede ser negativo — lo capa la pantalla, no el cálculo. */
export const remainingAfterRecurringCents = (availableCents, pendingRecurringCents) =>
  availableCents - pendingRecurringCents;

/** «Hoy puedes gastar» (N7, spec §5.2): remaining / max(1, daysLeft + 1), redondeado. El +1
 *  cuenta HOY: daysLeftOfPeriod da los días que faltan DESPUÉS de hoy, así que sin él el
 *  penúltimo día del periodo (daysLeft=1) repartía el margen entre un solo día y la pantalla
 *  decía «gasta todo» un día antes de tiempo. max(1, …) sigue sin ser defensivo por gusto: en el
 *  ÚLTIMO día (daysLeft=0) y en un periodo que se alarga (daysLeft negativo) el divisor cae
 *  igualmente a 1 — mismo resultado que antes en esos dos casos límite, el usuario ve que puede
 *  gastar TODO lo que queda, no una división por cero. Sin margen (remaining ≤ 0) el resultado
 *  sale negativo a propósito: la pantalla lo pinta en --neg con 0,00 €, esta función no lo capa. */
export function dailyAllowanceCents(availableCents, pendingRecurringCents, startDateIso, todayIso) {
  const remaining = remainingAfterRecurringCents(availableCents, pendingRecurringCents);
  const daysLeft = daysLeftOfPeriod(startDateIso, todayIso);
  return Math.round(remaining / Math.max(1, daysLeft + 1));
}

/** Plegado de movimientos (I4/I5): `rows` YA ordenadas DESC por fecha (contrato de `listByDay`,
 *  sql.js:72) y NUNCA se reordenan. Todos los de hoy; si son menos de `min`, se completa con los
 *  siguientes más recientes en el mismo orden de llegada — sin nada hoy, los `min` más recientes. */
export function foldedMovements(rows, todayIso, min = 3) {
  const nHoy = rows.filter((r) => r.date === todayIso).length;
  return rows.slice(0, Math.max(nHoy, min));
}

/** Agrupa filas YA ordenadas por date DESC en bloques por día, preservando el orden de llegada.
 *  Idéntica a la privada que tenía inicio.js, promovida aquí para poder testearla (spec §6.1) y
 *  para que Task 9 no tenga que reescribirla. */
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

/** Frase de ahorro (I1): sin ingresos no hay tasa que contar (null — la pantalla no pinta nada).
 *  Ahorro ≥ 0 → {kind:"saves", ratio}; negativo (se gasta más de lo que entra) → {kind:"overspends"}
 *  sin ratio, porque «ahorras el −12 %» no es una frase que nadie deba leer. */
export function savingsSentence(incomeCents, spentCents) {
  if (!(incomeCents > 0)) return null;
  const saved = incomeCents - spentCents;
  if (saved >= 0) return { kind: "saves", ratio: saved / incomeCents };
  return { kind: "overspends" };
}

const isoOfDate = (d) => d.toLocaleDateString("sv-SE");

/** Racha (§3.17): días consecutivos con apunte terminando en HOY o en AYER — no haber apuntado
 *  TODAVÍA hoy no rompe la racha, solo la congela un día. `dates` puede venir en cualquier orden;
 *  se normaliza a Set. Camina con Date(iso + "T12:00:00") (mediodía local, como todo el repo) para
 *  esquivar el cambio de hora. */
export function streakDays(dates, todayIso) {
  const set = new Set(dates ?? []);
  let cursor = new Date(todayIso + "T12:00:00");
  if (!set.has(todayIso)) {
    const yesterday = new Date(cursor);
    yesterday.setDate(yesterday.getDate() - 1);
    const yIso = isoOfDate(yesterday);
    if (!set.has(yIso)) return 0;
    cursor = yesterday;
  }
  let count = 0;
  while (set.has(isoOfDate(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

/** Días desde el último apunte (para el «Llevas N días sin apuntar» de la hucha). `dates` DESC
 *  (contrato de recentTxDates): dates[0] es la fecha más reciente. Filtra aquí las fechas
 *  FUTURAS (> todayIso — un apunte mal tecleado, o el reloj del dispositivo adelantado): sin este
 *  filtro un apunte de mañana silenciaría la regla 3 aunque ayer no se hubiera apuntado nada.
 *  Comparación de strings ISO (YYYY-MM-DD), sin pasar por Date: mismo orden que el cronológico.
 *  Sin ninguna fecha pasada, null — el llamante decide si eso dispara la regla 3 o no (hoy no la
 *  dispara: ver huchaMessage). */
export function daysSinceLastEntry(dates, todayIso) {
  const past = (dates ?? []).filter((d) => d <= todayIso);
  if (past.length === 0) return null;
  const last = new Date(past[0] + "T12:00:00");
  const today = new Date(todayIso + "T12:00:00");
  return Math.round((today - last) / 86400000);
}

// Umbrales de la hucha (spec §8). LIMIT_PCT = 90, distinto del `warn` de category-spend.js (85 %):
// una frase con voz propia debe ser más selectiva que un color de barra.
export const HUCHA = { RENEWAL_DAYS: 7, LIMIT_PCT: 90, IDLE_DAYS: 3, PERIOD_END_DAYS: 3 };

const daysUntil = (iso, todayIso) =>
  Math.round((new Date(iso + "T12:00:00") - new Date(todayIso + "T12:00:00")) / 86400000);

/** La frase de la hucha (§8): cuatro reglas evaluadas EN ORDEN, gana la primera que dispara —y
 *  delante de todas, el día de cobro (B-1): `payDayDueIso` (pay-day.js#payDayDue) es el día de
 *  cobro que ya llegó con el periodo abierto sin cerrar. Mientras siga pendiente, el fin de periodo
 *  no sale ni tras «Ahora no» (sería el mismo aviso con otras palabras).
 *  `dismissed` (claves "kind:id") salta ese candidato concreto y sigue probando el resto — «Ahora
 *  no» en Spotify no debe esconder también el aviso de Ocio. Sin nada que decir, null: no existe
 *  el estado «hola, todo bien» (SISTEMA §4.15).
 *  ctx = { renewals:[{id,name,amountCents,dueDateIso}], categories:[{id,name,pct}],
 *          daysSinceLastEntry, daysLeftOfPeriod, todayIso, dismissed:Set<string>, payDayDueIso } */
export function huchaMessage(ctx) {
  const {
    renewals = [], categories = [], daysSinceLastEntry: sinceLast, daysLeftOfPeriod: daysLeft,
    todayIso, dismissed = new Set(), payDayDueIso = null,
  } = ctx;

  // Regla 0 — día de cobro (B-1): toca cerrar el periodo.
  if (payDayDueIso && !dismissed.has("payday")) {
    return { kind: "payday", key: "payday", params: { date: payDayDueIso } };
  }

  // Regla 1 — renovación: la más próxima dentro de RENEWAL_DAYS.
  const dueRenewals = renewals
    .filter((r) => daysUntil(r.dueDateIso, todayIso) <= HUCHA.RENEWAL_DAYS)
    .filter((r) => !dismissed.has(`renewal:${r.id}`))
    .sort((a, b) => a.dueDateIso.localeCompare(b.dueDateIso));
  if (dueRenewals.length > 0) {
    const r = dueRenewals[0];
    return { kind: "renewal", key: `renewal:${r.id}`, params: { name: r.name, date: r.dueDateIso, amount: r.amountCents } };
  }

  // Regla 2 — categoría al límite: la de pct más alto.
  const overLimit = categories
    .filter((c) => c.pct >= HUCHA.LIMIT_PCT)
    .filter((c) => !dismissed.has(`limit:${c.id}`))
    .sort((a, b) => b.pct - a.pct);
  if (overLimit.length > 0) {
    const c = overLimit[0];
    return { kind: "limit", key: `limit:${c.id}`, params: { name: c.name, pct: Math.round(c.pct) } };
  }

  // Regla 3 — sin registrar nada en IDLE_DAYS o más.
  if (sinceLast != null && sinceLast >= HUCHA.IDLE_DAYS && !dismissed.has("idle")) {
    return { kind: "idle", key: "idle", params: { n: sinceLast } };
  }

  // Regla 4 — cierre de periodo próximo (o ya pasado de largo: dispara igual, con n=0 → «hoy»).
  if (daysLeft <= HUCHA.PERIOD_END_DAYS && !payDayDueIso && !dismissed.has("periodEnd")) {
    return { kind: "periodEnd", key: "periodEnd", params: { n: Math.max(0, daysLeft) } };
  }

  return null;
}

/** Serie de la línea del Display de Inicio (sistema B, B-Home): lo que queda del presupuesto al
 *  empezar el periodo y al cerrar cada día hasta hoy. `dailyCents` es el gasto de cada día en
 *  orden (semana-logic.js#daysWithCategories → totalCents, con el mismo criterio que spentOfPeriod:
 *  un día con más devoluciones que gasto resta en negativo, es decir, sube). Devuelve
 *  dailyCents.length + 1 valores; el primero es `budgetCents`. Sin recortar: puede bajar de cero
 *  (lo recorta quien lo pinta, charts.js#periodChartSvg).
 *  Con `totalSpentCents` (spentOfPeriod), el ÚLTIMO punto —hoy— es budget − total: así cuadra con
 *  el «Quedan X» del Display aunque el periodo tenga apuntes fuera de los días pintados (con fecha
 *  futura o anterior al inicio); la diferencia cae entera en hoy. */
export function periodRemainingSeries(budgetCents, dailyCents, totalSpentCents = null) {
  const out = [budgetCents];
  let left = budgetCents;
  for (const c of dailyCents ?? []) {
    left -= Number.isFinite(c) ? c : 0;
    out.push(left);
  }
  if (Number.isFinite(totalSpentCents)) out[out.length - 1] = budgetCents - totalSpentCents;
  return out;
}

/** Barra apilada de «Gasto por categoría» en Inicio (sistema B, B-Home; C11/C12): las `top` raíces
 *  con más gasto (> 0) y todo lo demás sumado en `restCents` («Resto», en --idle). `rows` es
 *  spentByRootCategory (ya ordenado DESC); una raíz con más devoluciones que gasto (≤ 0) no entra
 *  ni en la barra ni en el total. `totalCents` = la suma de lo que se pinta. */
export function topCategoriesWithRest(rows, top = 5) {
  const positive = (rows ?? []).filter((r) => r.spent_cents > 0).sort((a, b) => b.spent_cents - a.spent_cents);
  const head = positive.slice(0, top);
  const restCents = positive.slice(top).reduce((s, r) => s + r.spent_cents, 0);
  const totalCents = head.reduce((s, r) => s + r.spent_cents, 0) + restCents;
  return { top: head, restCents, totalCents };
}
