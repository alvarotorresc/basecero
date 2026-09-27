// B-1 · Día de cobro (decisiones 2026-09-27): el periodo empieza el día de cobro (meta.pay_day;
// "0" o ausente = día 1 del mes). El cierre sigue siendo manual: esto solo PROPONE la fecha y el
// nombre del periodo nuevo y decide cuándo avisa Inicio. Lógica pura, sin db/repo ni DOM, y sin
// «hoy» propio: quien llama pasa todayIso (hoyISO()), así los tests fijan el calendario.
// Fechas como YYYY-MM-DD con aritmética entera de calendario local (nunca toISOString: en UTC+X
// daría el día anterior).

export const PAY_DAY_MIN = 1;
export const PAY_DAY_MAX = 31;

// Días mínimos entre el inicio del periodo abierto y el día de cobro que lo cierra. Un ajuste que
// no casa con la historia (periodos que empiezan el 28 sin ajuste, que vale día 1) no debe
// proponer —ni avisar de— un cierre a los pocos días de abrir: medio mes como mínimo.
export const MIN_PERIOD_DAYS = 15;

/** Día de cobro de meta (texto o número) → 1..31. "0", vacío, ausente o basura = 1 (día 1). */
export function normalizePayDay(raw) {
  if (raw == null || raw === "") return PAY_DAY_MIN;
  const n = Number(raw);
  return Number.isInteger(n) && n >= PAY_DAY_MIN && n <= PAY_DAY_MAX ? n : PAY_DAY_MIN;
}

/** Valor que se guarda en meta.pay_day: el día 1 vuelve a la semilla "0". */
export const payDayToMeta = (payDay) => (normalizePayDay(payDay) <= PAY_DAY_MIN ? "0" : String(normalizePayDay(payDay)));

/** Paso a paso de Ajustes y del onboarding: ±1 acotado a 1..31. */
export const stepPayDay = (payDay, delta) =>
  Math.min(PAY_DAY_MAX, Math.max(PAY_DAY_MIN, normalizePayDay(payDay) + delta));

const pad = (n) => String(n).padStart(2, "0");
const daysInMonth = (year, month0) => new Date(year, month0 + 1, 0).getDate();
const parts = (iso) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)) - 1, d: Number(iso.slice(8, 10)) });

/** Día de cobro de un mes concreto (month0: 0-11), recortado al último día si el mes es más corto
 *  (el 31 en febrero cae el 28, o el 29 en bisiesto). */
export function payDateIn(year, month0, payDay) {
  const y = year + Math.floor(month0 / 12);
  const m = ((month0 % 12) + 12) % 12;
  const d = Math.min(normalizePayDay(payDay), daysInMonth(y, m));
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

/** ¿`iso` es el día de cobro de su mes? */
export function isPayDate(payDay, iso) {
  const { y, m } = parts(iso);
  return payDateIn(y, m, payDay) === iso;
}

/** El último día de cobro que ya llegó (hoy incluido). */
export function lastPayDate(payDay, todayIso) {
  const { y, m } = parts(todayIso);
  const here = payDateIn(y, m, payDay);
  return here <= todayIso ? here : payDateIn(y, m - 1, payDay);
}

/** El primer día de cobro ESTRICTAMENTE posterior a `afterIso`. */
export function nextPayDateAfter(payDay, afterIso) {
  const { y, m } = parts(afterIso);
  const here = payDateIn(y, m, payDay);
  return here > afterIso ? here : payDateIn(y, m + 1, payDay);
}

function addDays(iso, n) {
  const { y, m, d } = parts(iso);
  const x = new Date(y, m, d + n);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

/** Fecha que Nuevo periodo propone para empezar. Sin ajuste (día 1: ausente, "0" o "1"), hoy —
 *  EXACTAMENTE como antes de B-1, sin guard ni retrocesos. Con día de cobro (≥ 2): sin periodo
 *  abierto (onboarding), el último día de cobro que ya llegó; al cerrar, ese mismo día si cae al
 *  menos MIN_PERIOD_DAYS después del inicio del abierto (así nunca choca con periodStartTooEarly),
 *  y si no —cierre adelantado, o un ajuste que no casa con la historia—, hoy. */
export function proposedPeriodStart({ payDay, todayIso, openStartIso = "" }) {
  if (normalizePayDay(payDay) <= PAY_DAY_MIN) return todayIso;
  const last = lastPayDate(payDay, todayIso);
  if (!openStartIso) return last;
  return last >= addDays(openStartIso, MIN_PERIOD_DAYS) ? last : todayIso;
}

const capitalizedMonth = (y, m, locale) => {
  const raw = new Date(y, m, 1, 12).toLocaleDateString(locale, { month: "long", year: "numeric" }).replace(" de ", " ");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
};

/** Nombre del mes de la fecha, sin umbral: lo mismo que nombrePorDefecto (format.js) para hoy. */
export function monthNameOf(iso, locale) {
  const { y, m } = parts(iso);
  return capitalizedMonth(y, m, locale);
}

/** Nombre del periodo que empieza en `startIso` con día de cobro: el mes que ocupa casi todo
 *  (desde el día 16, el siguiente: empezar el 28 de septiembre es «Octubre»). Mismo formato que
 *  nombrePorDefecto: «Octubre 2026», con el año al final para que periodTitle lo quite. */
export function periodNameFor(startIso, locale) {
  const { y, m, d } = parts(startIso);
  return capitalizedMonth(y, d > 15 ? m + 1 : m, locale);
}

/** Propuesta completa de Nuevo periodo: fecha, nombre y si sale del día de cobro. Sin ajuste, hoy y
 *  el mes de hoy (nombrePorDefecto de siempre); con día de cobro (≥ 2), la fecha de
 *  proposedPeriodStart y el nombre del mes mayoritario. */
export function periodProposal({ payDay, todayIso, openStartIso = "", locale }) {
  if (normalizePayDay(payDay) <= PAY_DAY_MIN) return { startIso: todayIso, name: monthNameOf(todayIso, locale), byPayDay: false };
  const startIso = proposedPeriodStart({ payDay, todayIso, openStartIso });
  return { startIso, name: periodNameFor(startIso, locale), byPayDay: true };
}

/** Aviso de Inicio: el día de cobro que ya llegó con el periodo abierto sin cerrar, o null. Solo
 *  con el ajuste puesto (día ≥ 2): con el día 1 de siempre, el aviso de fin de periodo ya lo dice.
 *  Cuenta el primer día de cobro a partir de MIN_PERIOD_DAYS tras el inicio del abierto. */
export function payDayDue({ payDay, openStartIso, todayIso }) {
  if (normalizePayDay(payDay) <= PAY_DAY_MIN || !openStartIso) return null;
  const due = nextPayDateAfter(payDay, addDays(openStartIso, MIN_PERIOD_DAYS - 1));
  return due <= todayIso ? due : null;
}

/** Cierre tardío (decisión 2026-09-27): con día de cobro (≥ 2), al abrir el periodo nuevo los
 *  apuntes del que se cierra con fecha desde el nuevo inicio pasan a él. Cuántos son, para la línea
 *  de Nuevo periodo antes de confirmar; `rows` son los VIVOS del periodo que se cierra
 *  (listAllByDay). Sin día de cobro, 0: no se mueve nada (repo.openNextPeriodStmts). */
export const movesLateRows = (payDay) => normalizePayDay(payDay) > PAY_DAY_MIN;
export function lateMoveCount({ payDay, rows, startIso }) {
  if (!movesLateRows(payDay) || !startIso) return 0;
  return (rows ?? []).filter((r) => r.date >= startIso).length;
}
