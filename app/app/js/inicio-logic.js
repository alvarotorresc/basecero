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

/** «Hoy puedes gastar» (N7, spec §5.2): remaining / max(1, daysLeft), redondeado.
 *  max(1, daysLeft) NO es defensivo por gusto: el último día del periodo daysLeft vale 0, y el
 *  usuario debe ver que puede gastar TODO lo que queda, no un división por cero. Con un periodo
 *  que se alarga (daysLeft negativo) pasa lo mismo. Sin margen (remaining ≤ 0) el resultado sale
 *  negativo a propósito: la pantalla lo pinta en --danger con 0,00 €, esta función no lo capa. */
export function dailyAllowanceCents(availableCents, pendingRecurringCents, startDateIso, todayIso) {
  const remaining = remainingAfterRecurringCents(availableCents, pendingRecurringCents);
  const daysLeft = daysLeftOfPeriod(startDateIso, todayIso);
  return Math.round(remaining / Math.max(1, daysLeft));
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
 *  (contrato de recentTxDates): dates[0] es la fecha más reciente. Sin ninguna fecha, null —
 *  el llamante decide si eso dispara la regla 3 o no (hoy no la dispara: ver huchaMessage). */
export function daysSinceLastEntry(dates, todayIso) {
  if (!dates || dates.length === 0) return null;
  const last = new Date(dates[0] + "T12:00:00");
  const today = new Date(todayIso + "T12:00:00");
  return Math.round((today - last) / 86400000);
}

const daysInMonth = (year, month0) => new Date(year, month0 + 1, 0).getDate();
// due_day se acota al largo real del mes (31 en febrero → 28/29): new Date(y, m+1, 0).getDate().
const isoOfYmd = (year, month0, day) => {
  const d = Math.min(day, daysInMonth(year, month0));
  return `${year}-${String(month0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/** Próximo cobro de una recurrente, en ISO (para la renovación de la hucha). due_day vacío → null
 *  (regla sin día fijo no tiene «próximo cobro» que anunciar). `weekly` se trata IGUAL que
 *  `monthly` — RULING del controller ya vigente en prevision.js:5-8, no se vuelve a discutir aquí.
 *  `quarterly`: siguiente mes del ciclo de 3 desde `due_month` que caiga hoy o después. `yearly`:
 *  `due_month`/`due_day` de este año, o del que viene si ya pasó. HOY cuenta como «todavía no ha
 *  pasado» en los tres casos (comparación >=, no >). */
export function nextDueDateIso(rule, todayIso) {
  if (rule.due_day == null || rule.due_day === "") return null;
  const today = new Date(todayIso + "T12:00:00");
  const year = today.getFullYear();
  const month0 = today.getMonth();

  if (rule.frequency === "monthly" || rule.frequency === "weekly") {
    let candidate = isoOfYmd(year, month0, rule.due_day);
    if (candidate < todayIso) {
      const nextMonth0 = month0 + 1 > 11 ? 0 : month0 + 1;
      const nextYear = month0 + 1 > 11 ? year + 1 : year;
      candidate = isoOfYmd(nextYear, nextMonth0, rule.due_day);
    }
    return candidate;
  }

  if (rule.due_month == null || rule.due_month === "") return null;
  const dueMonth0 = rule.due_month - 1;

  if (rule.frequency === "yearly") {
    let candidate = isoOfYmd(year, dueMonth0, rule.due_day);
    if (candidate < todayIso) candidate = isoOfYmd(year + 1, dueMonth0, rule.due_day);
    return candidate;
  }

  if (rule.frequency === "quarterly") {
    for (let i = 0; i < 15; i++) {
      const m = month0 + i;
      const y = year + Math.floor(m / 12);
      const m0 = ((m % 12) + 12) % 12;
      if ((((m0 - dueMonth0) % 3) + 3) % 3 === 0) {
        const candidate = isoOfYmd(y, m0, rule.due_day);
        if (candidate >= todayIso) return candidate;
      }
    }
  }
  return null;
}

// Umbrales de la hucha (spec §8). LIMIT_PCT = 90, distinto del `warn` de category-spend.js (85 %):
// una frase con voz propia debe ser más selectiva que un color de barra.
export const HUCHA = { RENEWAL_DAYS: 7, LIMIT_PCT: 90, IDLE_DAYS: 3, PERIOD_END_DAYS: 3 };

const daysUntil = (iso, todayIso) =>
  Math.round((new Date(iso + "T12:00:00") - new Date(todayIso + "T12:00:00")) / 86400000);

/** La frase de la hucha (§8): cuatro reglas evaluadas EN ORDEN, gana la primera que dispara.
 *  `dismissed` (claves "kind:id") salta ese candidato concreto y sigue probando el resto — «Ahora
 *  no» en Spotify no debe esconder también el aviso de Ocio. Sin nada que decir, null: no existe
 *  el estado «hola, todo bien» (SISTEMA §4.15).
 *  ctx = { renewals:[{id,name,amountCents,dueDateIso}], categories:[{id,name,pct}],
 *          daysSinceLastEntry, daysLeftOfPeriod, todayIso, dismissed:Set<string> } */
export function huchaMessage(ctx) {
  const {
    renewals = [], categories = [], daysSinceLastEntry: sinceLast, daysLeftOfPeriod: daysLeft,
    todayIso, dismissed = new Set(),
  } = ctx;

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
  if (daysLeft <= HUCHA.PERIOD_END_DAYS && !dismissed.has("periodEnd")) {
    return { kind: "periodEnd", key: "periodEnd", params: { n: Math.max(0, daysLeft) } };
  }

  return null;
}
