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

/** ISO (YYYY-MM-DD) del día `day` dentro del mes `monthIndex` (0-based) de `year`, recortado al
 *  último día real de ese mes — mismo criterio de recorte que expectedPeriodDays (prevision.js):
 *  día 31 en febrero da 28 (o 29 en bisiesto). T12:00:00 local (vía el constructor de 3 args) para
 *  no pisar un cambio de hora, mismo patrón que format.js#prevDayIso. */
function isoFromParts(year, monthIndex, day) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(day, lastDay), 12).toLocaleDateString("sv-SE");
}

/** Fecha ISO de la próxima renovación, o "" si no se puede saber.
 *  - monthly: el próximo due_day igual o posterior a hoy (hoy cuenta como "todavía por llegar"),
 *    con el día recortado al último del mes.
 *  - yearly: (due_month, due_day) de este año si no ha pasado, si no del que viene.
 *  - quarterly: se avanza de tres en tres meses desde due_month hasta alcanzar o superar hoy —
 *    el mismo ciclo que ruleApplies (prevision.js), para que el radar y Previsión nunca discrepen
 *    sobre en qué mes cae una trimestral.
 *  - weekly: "". El esquema no guarda ningún ancla semanal: due_day es día DEL MES (spec §3 D5).
 *  - due_day nulo, o quarterly/yearly sin due_month: "" — el mismo "no aplica" que ruleApplies
 *    (prevision.js) devuelve para esos datos incompletos, en vez de inventar una fecha. */
export function nextRenewal(rule, todayIso) {
  if (rule.frequency === "weekly") return "";
  if (rule.due_day == null || rule.due_day === "") return "";
  const day = Number(rule.due_day);
  const [todayYear, todayMonth] = todayIso.split("-").map(Number);

  if (rule.frequency === "monthly") {
    let year = todayYear, monthIndex = todayMonth - 1;
    let iso = isoFromParts(year, monthIndex, day);
    if (iso < todayIso) {
      monthIndex += 1;
      if (monthIndex > 11) { monthIndex = 0; year += 1; }
      iso = isoFromParts(year, monthIndex, day);
    }
    return iso;
  }

  if (rule.frequency === "yearly" || rule.frequency === "quarterly") {
    if (rule.due_month == null || rule.due_month === "") return "";
    const step = rule.frequency === "yearly" ? 12 : 3;
    let monthIndex = Number(rule.due_month) - 1;
    // Una trimestral no vive solo en due_month: repite cada 3 meses desde ahí, así que su ancla
    // real puede caer en un mes ANTERIOR a due_month dentro del ciclo de este año (p. ej.
    // due_month=12 con ciclo dic/mar/jun/sep — en abril lo que toca es junio, no diciembre).
    // Se realinea el mes de ancla al mismo resto módulo 3 que due_month pero lo más cercano a
    // hoy (puede quedar en negativo: isoFromParts lo normaliza vía el constructor de Date, que
    // toma prestado del año anterior) — así el "while" de abajo nunca tiene que dar más de una
    // vuelta completa de más. yearly no necesita este realineado: su step ya es 12, un único mes.
    if (rule.frequency === "quarterly") {
      const todayMonthIndex = todayMonth - 1;
      monthIndex = todayMonthIndex - (((todayMonthIndex - monthIndex) % step) + step) % step;
    }
    let year = todayYear;
    let iso = isoFromParts(year, monthIndex, day);
    while (iso < todayIso) {
      monthIndex += step;
      year += Math.floor(monthIndex / 12);
      monthIndex = monthIndex % 12;
      iso = isoFromParts(year, monthIndex, day);
    }
    return iso;
  }

  return "";
}

/** Días naturales de hoy a `dateIso` (0 = hoy). Aritmética de fechas a mediodía, como el resto del
 *  proyecto (format.js#prevDayIso, prevision.js#dayIndexOfPeriod), para no pisar un cambio de hora. */
export function daysUntil(dateIso, todayIso) {
  const ms = new Date(dateIso + "T12:00:00") - new Date(todayIso + "T12:00:00");
  return Math.round(ms / 86400000);
}

/** Meses COMPLETOS entre dos fechas ISO. Un mes está completo cuando ha llegado el día del mes de
 *  `fromIso`: del 12 de junio al 9 de septiembre van DOS meses completos, no tres — el 12 de
 *  septiembre aún no ha llegado. Recorte de fin de mes: si `toIso` es el último día de su mes,
 *  cuenta aunque su día sea menor (del 31 de enero al 28 de febrero va un mes completo, porque el
 *  "31 de febrero" no existe). Nunca negativo. */
export function wholeMonthsBetween(fromIso, toIso) {
  const from = new Date(fromIso + "T12:00:00");
  const to = new Date(toIso + "T12:00:00");
  if (to <= from) return 0;
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  const toIsLastDayOfMonth = new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate() === to.getDate();
  if (to.getDate() < from.getDate() && !toIsLastDayOfMonth) months -= 1;
  return Math.max(0, months);
}

/** Lo ahorrado desde la baja, en céntimos: la parte proporcional del coste ANUAL correspondiente a
 *  los meses completos transcurridos. Se calcula sobre el anual y con UN solo redondeo
 *  (round(annual * meses / 12)) en vez de multiplicar un mensual ya redondeado: así una anual de
 *  99,99 € no arrastra el error de su doceava parte mes a mes.
 *  Sin cancelled_at → 0. NO se persiste (spec §3 D2): se recalcula en cada render. */
export function savedSinceCancelCents(rule, todayIso) {
  if (!rule.cancelled_at) return 0;
  const months = wholeMonthsBetween(rule.cancelled_at, todayIso);
  return Math.round((annualCents(rule) * months) / 12);
}

/** Días de antelación con los que el radar avisa de una renovación próxima. */
export const RENEWAL_SOON_DAYS = 7;

/** La renovación que toca avisar, o null si no hay ninguna. Elige, entre las suscripciones
 *  ACTIVAS, la que renueva ANTES dentro de los próximos RENEWAL_SOON_DAYS días (hoy incluido).
 *  Empate: el importe mayor primero (duele más), y luego el nombre, para que el resultado sea
 *  determinista. `snoozed` es {ruleId: dueIso}: silencia ESA renovación, no la suscripción — la
 *  del mes que viene tiene otra fecha y vuelve a avisar sola, sin que nadie reactive nada.
 *  Las semanales quedan fuera: nextRenewal ya devuelve "" para ellas (§3 D5).
 *  PURA y SIN TEXTOS: devuelve datos, nunca una frase — la compone quien pinta, con sus i18n. */
export function renewalNotice(rules, todayIso, snoozed = {}) {
  const candidates = [];
  for (const r of activeSubscriptions(rules)) {
    const dueIso = nextRenewal(r, todayIso);
    if (!dueIso) continue;
    const days = daysUntil(dueIso, todayIso);
    if (days < 0 || days > RENEWAL_SOON_DAYS) continue;
    if (snoozed?.[r.id] === dueIso) continue;
    candidates.push({ ruleId: r.id, name: r.name, amountCents: r.amount_cents, dueIso, days });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.days - b.days || b.amountCents - a.amountCents || a.name.localeCompare(b.name));
  return candidates[0];
}

/** Tope de entradas de las dos listas de meta (§5.3): son listas de descartes/silencios, no un
 *  archivo — un valor generoso pero acotado, para que un JSON corrupto o manipulado a mano no
 *  crezca sin límite. */
export const IGNORED_MAX = 200;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Comercios (clave NORMALIZADA) que el usuario mandó ignorar — parseo SEGURO de
 *  meta.subscription_ignored: JSON roto, no-array, o cualquier entrada que no sea un string se
 *  descarta en SILENCIO (última línea de defensa, mismo criterio que sanitizeLoanMap). Guard
 *  `__proto__` explícito por claridad, aunque un array nunca dispara el setter especial de
 *  Object.prototype al iterarlo (solo `obj[k]=` con objetos lo hace). Tope IGNORED_MAX, las
 *  primeras del array (repo.ignoreSubscriptionMerchant escribe siempre las MÁS RECIENTES al
 *  final, así que truncar por aquí solo importa si el JSON llegó ya corrupto o manipulado). */
export function parseIgnored(raw) {
  let arr;
  try { arr = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const v of arr) {
    if (typeof v !== "string" || v === "__proto__") continue;
    out.push(v);
    if (out.length >= IGNORED_MAX) break;
  }
  return out;
}

/** Coste MENSUAL normalizado de todas las reglas activas que no son ingreso — el segundo dato del
 *  héroe de Recurrentes («789,88 € al mes» en Recurrentes.dc.html:36). Deriva del anual con un
 *  solo redondeo, igual que monthlyCents/monthlyTotalCents, para que dos vistas del mismo
 *  conjunto no discrepen en un céntimo.
 *  Excluye type:"income" por el mismo criterio que repo.previsionOfPeriod#comprometidoCents: un
 *  ingreso previsto no es un compromiso mensual. SÍ incluye las transferencias: una aportación
 *  mensual a la hucha es dinero comprometido igual que el alquiler.
 *  Importe ÍNTEGRO, nunca prorrateado por my_share_pct (mismo criterio y mismo motivo que
 *  annualCents: prorratear ataría la cifra al ajuste de reparto del periodo abierto). */
export const monthlyCommitmentCents = (rules) =>
  Math.round((rules ?? [])
    .filter((r) => r.is_active && !r.cancelled_at && r.type !== "income")
    .reduce((s, r) => s + annualCents(r), 0) / 12);

/** Etiqueta de estado bajo el importe de una fila de Recurrentes (spec §5.1, decisión 7). `item`
 *  es el { rule, myCents, paid } que devuelve repo.previsionOfPeriod para esta regla, o
 *  undefined/null si la regla no aplica este mes (previsionOfPeriod la deja fuera de `items`).
 *  El TIPO manda: una transferencia no es "pagada" ni "pendiente" —es un movimiento entre cuentas
 *  propias— así que lleva SIEMPRE la misma etiqueta, tenga o no item este periodo. Un ingreso
 *  previsto nunca lleva etiqueta (va con el signo + en verde, sin más). Para el resto (gasto),
 *  la etiqueta depende de item.paid; sin item, la regla no aplica este mes y no lleva ninguna. */
export function ruleStateKey(rule, item) {
  if (rule.type === "transfer") return "transfer";
  if (rule.type === "income") return null;
  if (!item) return null;
  return item.paid ? "paid" : "pending";
}

/** Mapa saneado {ruleId: dueIso} de meta.renewal_snoozed. Mismo criterio de defensa en
 *  profundidad que parseIgnored: JSON roto, no-objeto, o una entrada cuyo valor no es una fecha
 *  ISO con forma válida se descarta en silencio. Guard `__proto__`: `out[k]=` SÍ dispara el
 *  setter especial de Object.prototype si `k` fuera esa cadena (a diferencia de parseIgnored, que
 *  solo empuja a un array), así que aquí el guard es imprescindible, no solo por claridad. */
export function parseSnoozed(raw) {
  let obj;
  try { obj = JSON.parse(raw); } catch { return {}; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out = {};
  let count = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (key === "__proto__") continue;
    if (typeof value !== "string" || !ISO_DATE_RE.test(value)) continue;
    if (count >= IGNORED_MAX) break;
    out[key] = value;
    count += 1;
  }
  return out;
}
