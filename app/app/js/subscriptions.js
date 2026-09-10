/** Coste, renovación y ahorro de suscripciones (N6, «el radar»). Módulo PURO — SIN un solo
 *  import, mismo criterio que prevision.js/share-pct.js — así se testea entero en Node sin
 *  Worker ni sqlite: recibe filas (recurring_rules) y fechas ISO, devuelve números y cadenas.
 *  Todo lo que decide una cifra de esta PR vive aquí; las pantallas solo llaman y pintan. */

/** Coste ANUAL de una regla, en céntimos. El anual es la cifra canónica del radar (el héroe) y de
 *  ella se derivan las demás: así el total mensual siempre es exactamente el anual entre doce, que
 *  es lo que el artboard enseña (599,76 → 49,98). Una frecuencia desconocida da 0 en vez de lanzar:
 *  es defensivo (contract.js ya solo admite las cuatro), no una validación real.
 *  Importe SIEMPRE ÍNTEGRO, nunca prorrateado (spec §3 D3): prorratear ataría el coste anual al
 *  my_share_pct del periodo abierto, y entonces cambiaría al tocar un ajuste sin relación con la
 *  suscripción. Una suscripción compartida cuenta por su importe entero — es lo que cuesta;
 *  quien la pague es otra pregunta, y la resuelve la etiqueta de estado «compartido» en pantalla. */
export const annualCents = (rule) =>
  rule.amount_cents * ({ weekly: 52, monthly: 12, quarterly: 4, yearly: 1 }[rule.frequency] ?? 0);

/** Coste MENSUAL derivado del anual (redondeo único). Nunca al revés (mensual × 12): así el
 *  redondeo de una anual o una trimestral no se propaga al héroe. */
export const monthlyCents = (rule) => Math.round(annualCents(rule) / 12);

/** Las que cuentan en el héroe y en «Activas»: marcadas como suscripción, activas y sin cancelar.
 *  `is_subscription=0` es lo ÚNICO que decide qué es una suscripción — no hay heurística por
 *  categoría ni por nombre. */
export const activeSubscriptions = (rules) =>
  (rules ?? []).filter((r) => r.is_subscription && r.is_active && !r.cancelled_at);

/** Las del tercer bloque de la pantalla: marcadas y NO activas. Con `cancelled_at` → «cancelada el
 *  X» + ahorro (savedSinceCancelCents); sin él → «pausada», sin ahorro — pausar no es cancelar: no
 *  hay fecha desde la que contar lo ahorrado. */
export const inactiveSubscriptions = (rules) => (rules ?? []).filter((r) => r.is_subscription && !r.is_active);

/** Total anual de TODAS las suscripciones activas — el número héroe de la pantalla. */
export const annualTotalCents = (rules) => activeSubscriptions(rules).reduce((s, r) => s + annualCents(r), 0);

/** Total mensual derivado del total anual (mismo criterio de un solo redondeo que monthlyCents). */
export const monthlyTotalCents = (rules) => Math.round(annualTotalCents(rules) / 12);
