// Detalle de objetivo (B-7) y «Pasar a la hucha» (B-4): lógica PURA, sin DOM ni BD (patrón
// semana-logic.js / informe-logic.js). repo.js#goalDetail trae las filas y la pantalla
// (screens/objetivo.js) pinta lo que sale de aquí.
//
// Los meses van como claves "YYYY-MM" y se suman con aritmética entera: nada de Date, así un
// cambio de hora o la zona del navegador no mueven un movimiento de mes.

/** "2026-09-27" → "2026-09". */
export const monthKey = (iso) => String(iso).slice(0, 7);

/** "2026-09" + 4 → "2027-01" (n puede ser negativo). */
export function addMonths(key, n) {
  const [y, m] = key.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  const yy = Math.floor(idx / 12);
  const mm = idx - yy * 12 + 1;
  return `${yy}-${String(mm).padStart(2, "0")}`;
}

/** Lo que un movimiento suma o resta a `accountId`: el mismo CASE que SQL.accountBalance, para
 *  que la suma de las aportaciones cuadre con el saldo de la hucha. */
export function accountFlowCents(tx, accountId) {
  const amt = Number(tx.amount_cents) || 0;
  if (tx.type === "transfer") {
    if (tx.account_id === accountId) return -amt;
    if (tx.counter_account_id === accountId) return amt;
    return 0;
  }
  if (tx.account_id !== accountId) return 0;
  if (tx.type === "expense") return -amt;
  if (tx.type === "income" || tx.type === "refund" || tx.type === "adjustment") return amt;
  return 0;
}

/** Neto por mes de la cuenta {"YYYY-MM": cents} hasta `todayIso` (incluido), y el primer mes con
 *  movimiento (o null). Lo posterior a hoy no cuenta: el saldo de Patrimonio es a hoy. */
export function flowsByMonth(txs, accountId, todayIso) {
  const byMonth = {};
  let firstKey = null;
  for (const tx of txs ?? []) {
    if (!tx || tx.date > todayIso) continue;
    const c = accountFlowCents(tx, accountId);
    if (!c) continue;
    const k = monthKey(tx.date);
    byMonth[k] = (byMonth[k] ?? 0) + c;
    if (firstKey === null || k < firstKey) firstKey = k;
  }
  return { byMonth, firstKey };
}

/** Aportaciones por mes (B-Objetivo, «Aportaciones»): los `months` meses hasta el actual (el
 *  último, `current:true`), lo anterior junto en `beforeCents` (saldo inicial incluido: «Antes de
 *  abril») y `totalCents`, que es el saldo de la hucha a hoy. Una aportación es el NETO del mes:
 *  si se sacó dinero, resta. */
export function contributionsByMonth({ txs, accountId, openingCents = 0, todayIso, months = 6 }) {
  const { byMonth, firstKey } = flowsByMonth(txs, accountId, todayIso);
  const cur = monthKey(todayIso);
  const keys = Array.from({ length: months }, (_, i) => addMonths(cur, i - (months - 1)));
  const first = keys[0];
  const beforeCents = (Number(openingCents) || 0)
    + Object.entries(byMonth).filter(([k]) => k < first).reduce((s, [, c]) => s + c, 0);
  const list = keys.map((key) => ({ key, cents: byMonth[key] ?? 0, current: key === cur }));
  const totalCents = beforeCents + list.reduce((s, m) => s + m.cents, 0);
  return { months: list, beforeCents, totalCents, byMonth, firstKey };
}

/** Media de aportación mensual para la proyección: los 3 últimos meses CERRADOS (el que está en
 *  curso aún puede recibir su aportación y hundiría la media). Una hucha más nueva que eso divide
 *  solo por los meses que lleva, desde el de su primer movimiento; si ese primer movimiento es de
 *  este mes, la media es lo de este mes. Un mes sin aportar cuenta como 0. Sin media positiva
 *  (nada aportado, o se sacó más de lo que se metió) → null: no hay proyección honesta. */
export function avgMonthlyContribution({ byMonth, firstKey, todayIso, n = 3 }) {
  if (!firstKey) return null;
  const cur = monthKey(todayIso);
  let keys = Array.from({ length: n }, (_, i) => addMonths(cur, i - n)).filter((k) => k >= firstKey);
  if (!keys.length) keys = [cur];
  const avg = Math.round(keys.reduce((s, k) => s + (byMonth[k] ?? 0), 0) / keys.length);
  return avg > 0 ? avg : null;
}

/** «Lo completas en <mes>»: cuántas aportaciones a la media faltan y en qué mes cae la última. Si
 *  este mes todavía no se ha aportado, la primera cuenta en este mes (el mockup: 4 aportaciones
 *  desde septiembre → diciembre); si ya se aportó, empieza el que viene.
 *  → {status:"done"} | {status:"none"} | {status:"projected", count, monthKey}. */
export function projectCompletion({ remainingCents, avgCents, todayIso, currentMonthCents = 0 }) {
  if (!(remainingCents > 0)) return { status: "done" };
  if (!(avgCents > 0)) return { status: "none" };
  const count = Math.ceil(remainingCents / avgCents);
  const start = currentMonthCents > 0 ? 1 : 0;
  return { status: "projected", count, monthKey: addMonths(monthKey(todayIso), start + count - 1) };
}

/** «Cubre N meses» = ahorrado / gasto medio mensual. Sin gasto medio (ningún periodo cerrado) →
 *  null; un saldo negativo no cubre meses negativos. */
export function coverMonths(savedCents, avgSpentCents) {
  if (!(avgSpentCents > 0)) return null;
  return Math.max(0, savedCents) / avgSpentCents;
}

/** Gasto medio de los `n` últimos periodos cerrados. `spents` va del más antiguo al más reciente
 *  (el orden de listClosedPeriods). Sin ninguno, 0. */
export function avgOfLastClosed(spents, n = 3) {
  const last = (spents ?? []).slice(-n);
  if (!last.length) return 0;
  return Math.round(last.reduce((s, c) => s + c, 0) / last.length);
}

/** Validación de «Pasar a la hucha»: la clave del error, o "" si vale. La usan la hoja (mensaje)
 *  y repo.transferToGoal (última línea, antes de escribir). */
export function transferError({ cents, fromId, toId }) {
  if (!(Number.isFinite(cents) && cents > 0)) return "amount";
  if (!toId) return "noHucha";
  if (!fromId) return "account";
  if (fromId === toId) return "sameAccount";
  return "";
}

// Mismos tipos que repo.js#HUCHA_GOAL_TYPES: los que tienen hucha propia.
const HUCHA_TYPES = new Set(["emergency_fund", "savings_target", "provision"]);

/** ¿El objetivo tiene hucha a la que pasar dinero? Techo de gasto y tasa de ahorro, no. */
export const hasHucha = (goal) => !!goal && HUCHA_TYPES.has(goal.type) && !!goal.account_id;

/** Argumentos de repo.addTransaction para «Pasar a la hucha» (B-4): una transferencia de HOY de
 *  la cuenta elegida a la hucha, sin categoría ni reparto; el comercio es el nombre del objetivo
 *  (como el barrido de fin de periodo) para que en Movimientos se lea a dónde fue. */
export function goalTransferTx({ cents, fromId, toId, goalName, note = "", todayIso }) {
  return {
    type: "transfer", amountCents: cents, date: todayIso, accountId: fromId, counterAccountId: toId,
    categoryId: "", merchant: goalName ?? "", note, isShared: false,
  };
}
