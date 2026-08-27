import { SQL, TABLES } from "./sql.js";
import { query, exec, execMany } from "./db.js";
import { nowIso, hoyISO, prevDayIso, fmtEUR } from "./format.js";
import { CONTRACT, insertSql } from "./contract.js";
import { periodMonth, ruleApplies, myAmountOfRule } from "./prevision.js";

export async function getOpenPeriod() { return (await query(SQL.getOpenPeriod))[0] ?? null; }

/** Cierra el periodo abierto (si existe: en el primer periodo no hay nada que cerrar) con
 *  end_date = día anterior a startDate, abre el nuevo y crea sus budgets — TODO en un único
 *  execMany: o quedan las tres cosas hechas, o ninguna (si algo falla a medias, closePeriod
 *  dejaría un periodo cerrado sin sucesor abierto, violando la invariante de que siempre hay
 *  como mucho un periodo open). budgets: [{categoryId, amountCents}]. La usa tanto el
 *  asistente de cierre normal como el onboarding (modo 'first', sin periodo previo). */
/** ¿startDate cae on/antes del start_date del periodo open que se va a cerrar? Si es así,
 *  end_date (día anterior a startDate) quedaría ANTES de start_date del periodo que se cierra —
 *  un rango invertido. PURA y sin DB (mismo patrón que sharedFieldsLocked/fillLast7Days: así se
 *  testea sin Worker) para que openNextPeriod pueda lanzar el error ANTES de construir el
 *  execMany. Sin periodo abierto (modo 'first') no hay nada que comparar: siempre false. */
export const periodStartTooEarly = (open, startDate) => !!open && startDate <= open.start_date;

export async function openNextPeriod({ name, startDate, sharePct, budgets = [] }) {
  const current = await getOpenPeriod();
  if (periodStartTooEarly(current, startDate))
    throw new Error("La fecha debe ser posterior al inicio del periodo actual");
  const t = nowIso();
  const newId = bcUlid();
  const stmts = [];
  if (current) stmts.push({ sql: SQL.closePeriod, bind: [prevDayIso(startDate), t, current.id] });
  stmts.push({ sql: SQL.insertPeriod, bind: [newId, name, startDate, sharePct, t, t] });
  for (const b of budgets) {
    stmts.push({ sql: SQL.insertBudget, bind: [bcUlid(), newId, b.categoryId, b.amountCents, t, t] });
  }
  await execMany(stmts);
  return newId;
}

export async function addTransaction({
  type, amountCents, date, categoryId, accountId, merchant, note, isShared,
  counterAccountId = "", sharePctOverride = null, refId = "", ruleId = "", externalId = "", status = "pending",
}) {
  const p = await getOpenPeriod();
  if (!p) throw new Error("No hay ningún periodo abierto");
  const t = nowIso();
  const insertStmt = {
    sql: SQL.insertTransaction,
    bind: [bcUlid(), date, p.id, type, amountCents, accountId, counterAccountId,
      categoryId ?? "", bcSanitizeCell(merchant ?? ""), bcSanitizeCell(note ?? ""),
      isShared ? 1 : 0, sharePctOverride, 0, refId, ruleId, externalId, status, t, t],
  };
  if (refId) {
    await execMany([insertStmt, { sql: "UPDATE transactions SET settled=1, updated_at=? WHERE id=?", bind: [t, refId] }]);
  } else {
    await exec(insertStmt.sql, insertStmt.bind);
  }
}

export const spentOfPeriod = async (pid) => (await query(SQL.spentOfPeriod, [pid]))[0].spent_cents;
export const incomeOfPeriod = async (pid) => (await query(SQL.incomeOfPeriod, [pid]))[0].income_cents;
export const listByDay = (pid) => query(SQL.listByDay, [pid]);
export const recentForRefund = (pid) => query(SQL.recentForRefund, [pid]);
export const listExpenseLeafCategories = () => query(SQL.listExpenseLeafCategories);
export const listIncomeCategories = () => query(SQL.listIncomeCategories);
export const listAccounts = () => query(SQL.listAccounts);
export const allCategoriesById = async () =>
  Object.fromEntries((await query(SQL.allCategories)).map((c) => [c.id, c]));

/** Config de la app como objeto {clave: valor}. Las semillas de schema.sql garantizan
 *  como mínimo schema_version, currency, created_with y locale. */
export async function getMetaAll() {
  const rows = await query(SQL.allMeta);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
export async function setMeta(key, value) {
  await exec(SQL.upsertMeta, [key, value]);
}

export const listPeriods = () => query(SQL.listPeriods);
export const listAllByDay = (pid) => query(SQL.listAllByDay, [pid]);
export const getTransaction = async (id) => (await query(SQL.getTransaction, [id]))[0] ?? null;
// Task 17 ronda 2 (finding A): ¿`id` tiene algún refund activo enlazado por ref_id? La usa
// tanto Movimientos (bloquear importe/compartido en la UI) como updateTransaction (rechazar
// el cambio server-side aunque alguien salte la UI).
export const hasActiveLinkedRefund = async (id) => (await query(SQL.hasActiveLinkedRefund, [id])).length > 0;

/** ¿Debe bloquearse un update por el guard de "gasto liquidado" (Task 17 ronda 2, finding A)?
 *  Pura y sin DB (mismo patrón que prevision.js: así se testea sin worker/sqlite de por
 *  medio). `f` son los campos YA RESUELTOS de updateTransaction (con los defaults de `cur`
 *  aplicados para lo que el caller no mandó) — comparar `f` contra `cur` es lo que hace que
 *  un save que NO toca importe/compartido/reparto (solo categoría/fecha/nota/comercio) no se
 *  bloquee aunque el gasto esté settled. El caller aún debe comprobar hasActiveLinkedRefund. */
export function sharedFieldsLocked(cur, f) {
  if (cur.type !== "expense" || !cur.settled) return false;
  return f.amountCents !== cur.amount_cents
    || !!f.isShared !== !!cur.is_shared
    || f.sharePctOverride !== cur.share_pct_override;
}
export const countUncategorized = async (pid) => (await query(SQL.countUncategorized, [pid]))[0].n;
export const pendingShared = () => query(SQL.pendingShared);
export const pendingSharedTotalCents = async () => (await query(SQL.pendingSharedTotal))[0].total_cents;
export const spentByRootCategory = (pid) => query(SQL.spentByRootCategory, [pid]);
export const budgetsOfPeriod = (pid) => query(SQL.budgetsOfPeriod, [pid]);

/** Completa los huecos de SQL.spentByDay (que solo trae los días CON movimiento) con 0, para
 *  los 7 días naturales que terminan en `todayIso` (inclusive). Pura — sin I/O — para que
 *  spentLast7Days (que sí hace la query) sea testable sin duplicar la lógica de relleno (ver
 *  tests/app/charts.test.mjs, que reproduce el mismo query+fill a mano). */
export function fillLast7Days(rows, todayIso) {
  const byDate = Object.fromEntries(rows.map((r) => [r.date, r.cents]));
  const end = new Date(todayIso + "T12:00:00");
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const iso = d.toLocaleDateString("sv-SE");
    days.push({ date: iso, cents: byDate[iso] ?? 0 });
  }
  return days;
}

/** Tarjeta "Flujo de gasto" de Inicio (Task 12): gasto por día de los últimos 7 días naturales
 *  (hoy incluido), con los días sin movimiento a 0.
 *  LIMITACIÓN CONOCIDA: la query está acotada a `pid` (mismo criterio que el resto de Inicio,
 *  literal del brief: "un rango date BETWEEN ? AND ? del periodo"), así que en los primeros días
 *  de un periodo recién abierto la ventana de 7 días "se corta" en la fecha de inicio — los días
 *  que caen en el periodo ANTERIOR muestran 0 aunque hubiera gasto real ese día. No se resuelve
 *  aquí (quitar el filtro de periodo rompería la consistencia con el resto de números de Inicio,
 *  todos periodo-scoped); documentado para quien la use en la UI. */
export async function spentLast7Days(pid) {
  const today = hoyISO();
  const start = new Date(today + "T12:00:00");
  start.setDate(start.getDate() - 6);
  const rows = await query(SQL.spentByDay, [pid, start.toLocaleDateString("sv-SE"), today]);
  return fillLast7Days(rows, today);
}

/** Liquida un gasto compartido pendiente: crea el refund de la parte de Sara (categoría/comercio
 *  del gasto original, hoy, cuenta de destino elegida) enlazado por refId. Reutiliza sara_amount_cents
 *  de pendingShared (ya calculado con el pct EFECTIVO del propio periodo del gasto, no el abierto)
 *  en vez de recalcular el pct aquí. El settled=1 del original lo pone addTransaction({refId}) solo. */
export async function settleShared(txId, accountId) {
  const row = (await pendingShared()).find((r) => r.id === txId);
  if (!row) throw new Error("Gasto compartido no encontrado o ya liquidado");
  await addTransaction({
    type: "refund",
    amountCents: row.sara_amount_cents,
    date: hoyISO(),
    categoryId: row.category_id,
    accountId,
    merchant: row.merchant,
    note: "Liquidación",
    isShared: false,
    refId: txId,
  });
}

/** Actualiza los campos editables de un movimiento (mismas claves camelCase que addTransaction).
 *  Los campos ausentes conservan el valor actual (no se pisan con defaults): p.ej. si el formulario
 *  no expone `status`, la fila mantiene su status ('pending'/'reconciled') tal cual estaba. */
export async function updateTransaction(id, fields) {
  const cur = await getTransaction(id);
  if (!cur) throw new Error("Movimiento no encontrado");
  const f = {
    type: fields.type ?? cur.type,
    amountCents: fields.amountCents ?? cur.amount_cents,
    date: fields.date ?? cur.date,
    categoryId: fields.categoryId ?? cur.category_id,
    accountId: fields.accountId ?? cur.account_id,
    counterAccountId: fields.counterAccountId ?? cur.counter_account_id,
    merchant: fields.merchant ?? cur.merchant,
    note: fields.note ?? cur.note,
    isShared: fields.isShared ?? !!cur.is_shared,
    sharePctOverride: fields.sharePctOverride !== undefined ? fields.sharePctOverride : cur.share_pct_override,
    refId: fields.refId ?? cur.ref_id,
    ruleId: fields.ruleId ?? cur.rule_id,
    status: fields.status ?? cur.status,
  };
  // Task 17 ronda 2 (controller ruling, finding A): un gasto ya liquidado (settled=1) con un
  // refund activo enlazado no puede cambiar de importe/compartido/reparto — si no, el refund
  // se queda congelado con el importe viejo y la deuda con Sara se pierde en silencio. Guarda
  // server-side (no solo UI, que ya bloquea los campos): un save que NO toca esos campos
  // (solo categoría/fecha/nota/comercio) sigue funcionando con normalidad.
  if (sharedFieldsLocked(cur, f) && (await hasActiveLinkedRefund(id))) {
    throw new Error("Movimiento liquidado con Sara: borra su liquidación en Movimientos antes de cambiar el importe o el reparto.");
  }
  const t = nowIso();
  await exec(SQL.updateTransaction, [
    f.type, f.amountCents, f.date, f.categoryId ?? "", f.accountId, f.counterAccountId ?? "",
    bcSanitizeCell(f.merchant ?? ""), bcSanitizeCell(f.note ?? ""), f.isShared ? 1 : 0,
    f.sharePctOverride, f.refId ?? "", f.ruleId ?? "", f.status, t, id,
  ]);
}

/** Borra (soft) un movimiento. Si es un refund enlazado a un gasto (ref_id), revierte el
 *  settled=1 de ese gasto EN LA MISMA operación — salvo que quede algún otro refund activo
 *  apuntándole (p.ej. si alguna vez se permiten varios refunds parciales sobre el mismo gasto). */
export async function softDeleteTransaction(id) {
  const cur = await getTransaction(id);
  const t = nowIso();
  if (cur && cur.type === "refund" && cur.ref_id) {
    await execMany([
      { sql: SQL.softDeleteTransaction, bind: [t, id] },
      { sql: SQL.unsettleIfNoActiveRefunds, bind: [cur.ref_id, id, t, cur.ref_id] },
    ]);
  } else {
    await exec(SQL.softDeleteTransaction, [t, id]);
  }
}

export const listRules = () => query(SQL.listRules);
export const getRule = async (id) => (await query(SQL.getRule, [id]))[0] ?? null;

/** Crea una regla recurrente. fields camelCase (ver recurrentes.js): is_active por defecto
 *  activa (1) si no se indica, igual criterio que el DEFAULT 1 del schema. name pasa por
 *  bcSanitizeCell como merchant/note de addTransaction: es texto libre tecleado por el usuario
 *  que via exportAllJson acaba en una celda .xlsx (mismo riesgo de inyección de fórmula). */
export async function createRule(fields) {
  const t = nowIso();
  await exec(SQL.insertRule, [
    bcUlid(), bcSanitizeCell(fields.name), fields.type, fields.amountCents,
    fields.categoryId ?? "", fields.accountId, fields.counterAccountId ?? "",
    fields.frequency, fields.dueDay ?? null, fields.dueMonth ?? null,
    fields.isShared ? 1 : 0, fields.isActive === false ? 0 : 1,
    t, t,
  ]);
}

/** Actualiza los campos editables de una regla (mismas claves camelCase que createRule).
 *  Los campos ausentes conservan el valor actual — mismo criterio que repo.updateTransaction. */
export async function updateRule(id, fields) {
  const cur = await getRule(id);
  if (!cur) throw new Error("Regla no encontrada");
  const f = {
    name: fields.name ?? cur.name,
    type: fields.type ?? cur.type,
    amountCents: fields.amountCents ?? cur.amount_cents,
    categoryId: fields.categoryId !== undefined ? fields.categoryId : cur.category_id,
    accountId: fields.accountId ?? cur.account_id,
    counterAccountId: fields.counterAccountId !== undefined ? fields.counterAccountId : cur.counter_account_id,
    frequency: fields.frequency ?? cur.frequency,
    dueDay: fields.dueDay !== undefined ? fields.dueDay : cur.due_day,
    dueMonth: fields.dueMonth !== undefined ? fields.dueMonth : cur.due_month,
    isShared: fields.isShared ?? !!cur.is_shared,
    isActive: fields.isActive ?? !!cur.is_active,
  };
  const t = nowIso();
  await exec(SQL.updateRule, [
    bcSanitizeCell(f.name), f.type, f.amountCents, f.categoryId ?? "", f.accountId, f.counterAccountId ?? "",
    f.frequency, f.dueDay, f.dueMonth, f.isShared ? 1 : 0, f.isActive ? 1 : 0, t, id,
  ]);
}

export const softDeleteRule = (id) => exec(SQL.softDeleteRule, [nowIso(), id]);

export const accountBalanceCents = async (accountId, atDateIso) =>
  (await query(SQL.accountBalance, [atDateIso, accountId]))[0].balance_cents;

/** Previsión del periodo (Task 11): reglas recurrentes que aplican este mes, con su estado
 *  pagado/pendiente (por rule_id o, si se registró a mano, por el fallback categoría+importe)
 *  y el "disponible real" — mismo criterio que la hoja "Previsión" (dashboards.py:103-134).
 *  comprometidoCents excluye type='income' (una regla de ingreso pendiente no "compromete"
 *  nada, solo lo hacen los gastos/transferencias sin pagar). saldoN26Cents es el saldo de
 *  'acc-n26' A HOY (no a la fecha del periodo: es el disponible AHORA). */
export async function previsionOfPeriod(period) {
  const month = periodMonth(period.start_date);
  const [rules, paidByRule, paidByCat, saldoN26Cents, pendienteSaraCents] = await Promise.all([
    listRules(),
    query(SQL.paidRuleIds, [period.id]),
    query(SQL.paidByCatAmount, [period.id]),
    accountBalanceCents("acc-n26", hoyISO()),
    pendingSharedTotalCents(),
  ]);
  const paidRuleIdSet = new Set(paidByRule.map((r) => r.rule_id));
  const paidCatAmountSet = new Set(paidByCat.map((r) => r.k));

  const items = rules
    .filter((rule) => ruleApplies(rule, month))
    .map((rule) => {
      const myCents = myAmountOfRule(rule, period.my_share_pct);
      const paid = paidRuleIdSet.has(rule.id) || paidCatAmountSet.has(`${rule.category_id}|${rule.amount_cents}`);
      return { rule, myCents, paid };
    });

  const comprometidoCents = items
    .filter((it) => !it.paid && it.rule.type !== "income")
    .reduce((sum, it) => sum + it.myCents, 0);

  return {
    items,
    comprometidoCents,
    saldoN26Cents,
    pendienteSaraCents,
    disponibleCents: saldoN26Cents - comprometidoCents + pendienteSaraCents,
  };
}

// ---- Patrimonio (Task 13) --------------------------------------------------

export const listAllAccounts = () => query(SQL.listAllAccounts);
export const listClosedPeriods = () => query(SQL.listClosedPeriods);
export const listGoals = () => query(SQL.listGoals);

/** Saldo de todas las cuentas activas (no archivadas) a una fecha, en orden de display_order —
 *  tarjeta "Cuentas" de Patrimonio. Una accountBalanceCents por cuenta: SQL.accountBalance
 *  (Task 11) ya está pensada para una cuenta a la vez (subquery con account_id=? fijo), no hay
 *  una única query que las traiga todas juntas. */
export async function balancesAt(dateIso) {
  const accounts = await listAllAccounts();
  const balances = await Promise.all(accounts.map((a) => accountBalanceCents(a.id, dateIso)));
  return accounts.map((a, i) => ({ id: a.id, name: a.name, type: a.type, balance_cents: balances[i] }));
}

/** Suma de balances = patrimonio neto (el pasivo resta solo, por tener opening/movimientos en
 *  negativo — no hace falta tratarlo distinto). PURA a propósito: la alimenta directamente
 *  tests/app/patrimonio.test.mjs con balances calculados a mano vía SQL.accountBalance, mismo
 *  patrón que repo.fillLast7Days (no hay Worker disponible en Node para probar balancesAt tal
 *  cual). */
export const netWorthOfBalances = (balances) => balances.reduce((sum, b) => sum + b.balance_cents, 0);

export async function netWorthAt(dateIso) {
  return netWorthOfBalances(await balancesAt(dateIso));
}

// Abreviaturas de 3 letras en español para las etiquetas de la sparkline de Patrimonio — FIJAS
// (no Intl.DateTimeFormat) para que no dependan de la versión de ICU del entorno: comprobado que
// en Node 22 { month:"short" } da "sept" para septiembre (4 letras), no "sep".
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const shortMonthLabel = (iso) => MESES_CORTOS[new Date(iso + "T12:00:00").getMonth()];

/** Serie de patrimonio neto: un punto por periodo CERRADO (a su end_date, no su start_date) +
 *  el punto de HOY — tarjeta "Patrimonio neto" de Patrimonio. Con 0 periodos cerrados devuelve
 *  un único punto; quien pinta la sparkline decide ocultarla con <2 puntos (screens/patrimonio.js).
 *  Los netWorthAt de cada punto van en paralelo (Promise.all preserva el orden de llegada aunque
 *  resuelvan en otro orden): con muchos periodos cerrados, esperar uno a uno por el Worker sería
 *  lento sin necesidad — cada punto es independiente de los demás. */
export async function netWorthSeries() {
  const closed = await listClosedPeriods();
  const points = await Promise.all([
    ...closed.map(async (p) => ({ label: shortMonthLabel(p.end_date), cents: await netWorthAt(p.end_date) })),
    (async () => ({ label: shortMonthLabel(hoyISO()), cents: await netWorthAt(hoyISO()) }))(),
  ]);
  return points;
}

/** Gasto medio (spentOfPeriod) de los periodos CERRADOS — es el target del goal emergency_fund
 *  (target_months × este promedio). 0 si no hay ninguno cerrado todavía: goalProgress ya trata
 *  avgSpentCents=0 como "sin datos", pct 0 sin dividir por cero. */
export async function avgSpentOfClosedPeriods() {
  const closed = await listClosedPeriods();
  if (closed.length === 0) return 0;
  const spents = await Promise.all(closed.map((p) => spentOfPeriod(p.id)));
  return Math.round(spents.reduce((s, c) => s + c, 0) / spents.length);
}

const fmtDecimal1 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
// den<=0 -> 0 en vez de NaN/Infinity: mismo criterio que budgetStatus (presupuesto.js), pero sin
// importarla desde repo.js (capa de datos no depende de una pantalla) — 3 líneas, se duplica aquí.
const safeDiv = (num, den) => (den > 0 ? (num / den) * 100 : 0);

// "antes de mayo 2027" (mes en minúscula, mitad de frase) — a diferencia de
// format.js#nombrePorDefecto (que capitaliza para usarlo como NOMBRE de periodo), aquí no aplica.
const fmtMesAnio = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString("es-ES", { month: "long", year: "numeric" }).replace(" de ", " ");

/** Progreso de UN goal activo según su tipo (contrato §7.2) — función PURA: toda la información
 *  ya viene resuelta en `ctx` (repo.goalsWithProgress hace las queries UNA vez y arma ctx antes
 *  de llamar aquí por cada goal; ver tests/app/patrimonio.test.mjs, que la prueba tipo a tipo
 *  con ctx mínimos, sin tocar la base de datos). pct SIN capar (igual criterio que
 *  presupuesto.js#budgetStatus: el número grande muestra el % real: quien pinta la barra la capa
 *  a 100).
 *
 *  level ('ok'/'warn'/'over'): SOLO spending_cap llega a 'over' — es el único tipo con un techo
 *  real que no conviene cruzar (mismos umbrales que budgetStatus: ok<85, warn>=85, over>100).
 *  Las huchas de acumulación (emergency_fund, savings_target, provision) siempre van 'ok':
 *  llenarlas de más nunca es malo, no existe un "te has pasado" para una hucha. savings_rate no
 *  tiene techo tampoco, pero sí un objetivo que puede no alcanzarse aún este periodo: 'ok' si ya
 *  lo iguala o supera, 'warn' si no. */
export function goalProgress(goal, ctx) {
  const {
    balanceByAccount = {}, accountNameById = {}, avgSpentCents = 0,
    spentByCategory = {}, savingsRatePct = 0,
  } = ctx;

  if (goal.type === "emergency_fund") {
    const currentCents = balanceByAccount[goal.account_id] ?? 0;
    const targetCents = (goal.target_months ?? 0) * avgSpentCents;
    const pct = safeDiv(currentCents, targetCents);
    const accName = accountNameById[goal.account_id] ?? "";
    const subtitle = avgSpentCents > 0
      ? `Hucha en ${accName} · cubre ${fmtDecimal1.format(currentCents / avgSpentCents)} meses de gasto`
      : `Hucha en ${accName} · todavía sin periodos cerrados para calcular el gasto medio`;
    return { goal, currentCents, targetCents, pct, level: "ok", subtitle };
  }

  if (goal.type === "savings_target") {
    const currentCents = balanceByAccount[goal.account_id] ?? 0;
    const targetCents = goal.target_amount_cents ?? 0;
    const pct = safeDiv(currentCents, targetCents);
    const accName = accountNameById[goal.account_id] ?? "";
    const fecha = goal.target_date ? ` · antes de ${fmtMesAnio(goal.target_date)}` : "";
    return { goal, currentCents, targetCents, pct, level: "ok", subtitle: `Hucha en ${accName}${fecha}` };
  }

  if (goal.type === "provision") {
    const currentCents = balanceByAccount[goal.account_id] ?? 0;
    const targetCents = goal.target_amount_cents ?? 0;
    const pct = safeDiv(currentCents, targetCents);
    const monthlyCents = Math.round(targetCents / 12);
    return { goal, currentCents, targetCents, pct, level: "ok", subtitle: `Provisión · ${fmtEUR(monthlyCents)} al mes` };
  }

  if (goal.type === "spending_cap") {
    // spentByCategory viene de spentByRootCategory (root_id): si goal.category_id apunta a una
    // categoría HIJA en vez de a su raíz, no hay match -> 0/0 -> pct 0 -> 'ok' en silencio, sin
    // ningún aviso. Handoff para la Task 14: el formulario de "Nuevo objetivo" debe restringir el
    // selector de categoría de spending_cap a categorías RAÍZ de gasto (parent_id='').
    const currentCents = spentByCategory[goal.category_id] ?? 0;
    const targetCents = goal.target_amount_cents ?? 0;
    const pct = safeDiv(currentCents, targetCents);
    const level = pct > 100 ? "over" : pct >= 85 ? "warn" : "ok";
    const remaining = targetCents - currentCents;
    const subtitle = level === "over"
      ? `Superado por ${fmtEUR(-remaining)}`
      : `Te quedan ${fmtEUR(remaining)} para el cierre del periodo`;
    return { goal, currentCents, targetCents, pct, level, subtitle };
  }

  // savings_rate: currentCents/targetCents guardan PUNTOS PORCENTUALES, no céntimos (el nombre
  // del campo se mantiene igual para los 5 tipos — así lo pide la interfaz del brief de la Task 13).
  const currentCents = savingsRatePct;
  const targetCents = goal.target_pct ?? 0;
  const pct = safeDiv(currentCents, targetCents);
  const level = currentCents >= targetCents ? "ok" : "warn";
  return { goal, currentCents, targetCents, pct, level, subtitle: "Tasa de ahorro del periodo abierto" };
}

/** Progreso de todos los goals activos — tarjeta "Objetivos" de Patrimonio. Arma el ctx UNA vez
 *  (saldos de las cuentas con hucha usadas por algún goal, gasto medio de los cerrados, gasto por
 *  categoría raíz del periodo abierto, tasa de ahorro del periodo abierto) y llama a goalProgress
 *  por goal — evita repetir esas queries una vez por goal. Sin periodo abierto (caso raro: solo
 *  justo tras el primer arranque, antes del onboarding) spending_cap/savings_rate quedan a 0. */
export async function goalsWithProgress() {
  const [goals, accounts, avgSpentCents, openPeriod] = await Promise.all([
    listGoals(), listAllAccounts(), avgSpentOfClosedPeriods(), getOpenPeriod(),
  ]);

  const accountIds = [...new Set(goals.map((g) => g.account_id).filter(Boolean))];
  const balances = await Promise.all(accountIds.map((id) => accountBalanceCents(id, hoyISO())));
  const balanceByAccount = Object.fromEntries(accountIds.map((id, i) => [id, balances[i]]));
  const accountNameById = Object.fromEntries(accounts.map((a) => [a.id, a.name]));

  let spentByCategory = {}, savingsRatePct = 0;
  if (openPeriod) {
    const [rootRows, spent, income] = await Promise.all([
      spentByRootCategory(openPeriod.id), spentOfPeriod(openPeriod.id), incomeOfPeriod(openPeriod.id),
    ]);
    spentByCategory = Object.fromEntries(rootRows.map((r) => [r.root_id, r.spent_cents]));
    savingsRatePct = income > 0 ? ((income - spent) / income) * 100 : 0;
  }

  const ctx = { balanceByAccount, accountNameById, avgSpentCents, spentByCategory, savingsRatePct };
  return goals.map((g) => goalProgress(g, ctx));
}

// ---- Formularios de cuentas y objetivos (Task 14) --------------------------

export const listExpenseRootCategories = () => query(SQL.listExpenseRootCategories);
export const getAccount = async (id) => (await query(SQL.getAccount, [id]))[0] ?? null;

/** Crea una cuenta. Devuelve el id nuevo (generado aquí, no lo asigna la BD): lo necesita
 *  createGoal para poder referenciar la hucha recién creada en el INSERT del goal, dentro del
 *  MISMO execMany. */
export async function createAccount({ name, type, openingBalanceCents }) {
  const id = bcUlid();
  const t = nowIso();
  await exec(SQL.insertAccount, [id, bcSanitizeCell(name), type, openingBalanceCents, t, t]);
  return id;
}

/** Actualiza una cuenta (mismas claves camelCase que createAccount). acc-n26 —la que usa el
 *  import de N26 para localizarla por id fijo— NO admite cambiar de nombre: el `name` recibido
 *  se ignora en silencio y se conserva "N26", pero opening_balance_cents SÍ es editable (saldo
 *  inicial real de la cuenta, no lo toca el import). Los demás campos ausentes conservan el
 *  valor actual — mismo criterio merge-on-current que repo.updateRule. */
export async function updateAccount(id, fields) {
  const cur = await getAccount(id);
  if (!cur) throw new Error("Cuenta no encontrada");
  const name = id === "acc-n26" ? cur.name : (fields.name ?? cur.name);
  const type = fields.type ?? cur.type;
  const openingBalanceCents = fields.openingBalanceCents ?? cur.opening_balance_cents;
  const t = nowIso();
  await exec(SQL.updateAccount, [bcSanitizeCell(name), type, openingBalanceCents, t, id]);
}

export const getGoal = async (id) => (await query(SQL.getGoal, [id]))[0] ?? null;

// Tipos de goal con hucha propia (contrato §7.2): si se crean sin accountId, cada uno se lleva
// su cuenta savings dedicada — dos goals nunca comparten hucha entre sí.
const HUCHA_GOAL_TYPES = new Set(["emergency_fund", "savings_target", "provision"]);

/** Crea un goal. fields camelCase: {name, type, targetAmountCents, targetMonths, targetPct,
 *  targetDate, accountId, categoryId, isActive}. Para los tipos con hucha propia (emergency_fund/
 *  savings_target/provision) sin accountId: crea la cuenta savings "Hucha · {name}" y el goal
 *  EN EL MISMO execMany (atómico: o quedan las dos filas o ninguna) — el id de la hucha se
 *  genera aquí para poder referenciarlo en el INSERT del goal sin depender de un autogenerado
 *  por SQLite. spending_cap/savings_rate no llevan hucha: accountId se queda a "". isActive
 *  respeta lo recibido (por defecto 1 si no se indica) — antes se hardcodeaba a 1, ignorando el
 *  toggle "Activo" del formulario si el usuario lo apagaba al crear (ver fix report). */
export async function createGoal(fields) {
  const t = nowIso();
  const goalId = bcUlid();
  const stmts = [];
  let accountId = fields.accountId || "";
  if (HUCHA_GOAL_TYPES.has(fields.type) && !accountId) {
    accountId = bcUlid();
    stmts.push({
      sql: SQL.insertAccount,
      bind: [accountId, bcSanitizeCell(`Hucha · ${fields.name}`), "savings", 0, t, t],
    });
  }
  const isActive = fields.isActive !== undefined ? (fields.isActive ? 1 : 0) : 1;
  stmts.push({
    sql: SQL.insertGoal,
    bind: [
      goalId, bcSanitizeCell(fields.name), fields.type,
      fields.targetAmountCents ?? null, fields.targetMonths ?? null, fields.targetPct ?? null,
      fields.targetDate ?? "", accountId, fields.categoryId ?? "", isActive, t, t,
    ],
  });
  await execMany(stmts);
  return goalId;
}

/** Actualiza un goal (mismas claves camelCase que createGoal, + isActive para el toggle de
 *  desactivar). Los campos ausentes conservan el valor actual — mismo criterio merge-on-current
 *  que updateRule. Los NULLABLE_NUM (target_amount_cents/target_months/target_pct) usan
 *  `!== undefined` en vez de `??`: así se puede guardar explícitamente `null` (p.ej. al cambiar
 *  de tipo a uno que no usa ese campo) sin que `?? cur.x` lo resucite con el valor anterior. No
 *  crea ninguna hucha nueva (a diferencia de createGoal): editar el tipo de un goal existente no
 *  está en el alcance de esta task. */
export async function updateGoal(id, fields) {
  const cur = await getGoal(id);
  if (!cur) throw new Error("Objetivo no encontrado");
  const f = {
    name: fields.name ?? cur.name,
    type: fields.type ?? cur.type,
    targetAmountCents: fields.targetAmountCents !== undefined ? fields.targetAmountCents : cur.target_amount_cents,
    targetMonths: fields.targetMonths !== undefined ? fields.targetMonths : cur.target_months,
    targetPct: fields.targetPct !== undefined ? fields.targetPct : cur.target_pct,
    targetDate: fields.targetDate ?? cur.target_date,
    accountId: fields.accountId ?? cur.account_id,
    categoryId: fields.categoryId !== undefined ? fields.categoryId : cur.category_id,
    isActive: fields.isActive ?? !!cur.is_active,
  };
  const t = nowIso();
  await exec(SQL.updateGoal, [
    bcSanitizeCell(f.name), f.type, f.targetAmountCents, f.targetMonths, f.targetPct,
    f.targetDate ?? "", f.accountId ?? "", f.categoryId ?? "", f.isActive ? 1 : 0, t, id,
  ]);
}

export const softDeleteGoal = (id) => exec(SQL.softDeleteGoal, [nowIso(), id]);

// ---- Import CSV N26 (Task 15) -----------------------------------------------

// Lo consume n26.js para re-firmar en memoria las transacciones existentes de acc-n26 antes de
// decidir cada fila del CSV (bcDecideImportAction) — un único query, no uno por fila.
export const n26Existing = () => query(SQL.n26Existing);

export async function dumpAllTables() {
  const out = {};
  for (const t of TABLES) out[t] = await query(SQL.dumpTable(t));
  return out;
}

export const exportAllJson = () => dumpAllTables();

/** Import de hoja completa. Todas las tablas se REEMPLAZAN salvo `meta`, que se FUSIONA
 *  (upsert de las claves que trae la hoja, conservando las que no vienen): una hoja exportada
 *  antes de que existiera una clave de config no debe borrarla en silencio. */
export function replaceAllStmts(data) {
  const tables = TABLES.filter((t) => t !== "meta");
  const stmts = [...tables].reverse().map((t) => ({ sql: `DELETE FROM ${t}` }));
  for (const row of data.meta) stmts.push({ sql: SQL.upsertMeta, bind: [row.key, row.value] });
  for (const t of tables)
    for (const row of data[t]) stmts.push({ sql: insertSql(t), bind: CONTRACT[t].cols.map((c) => row[c]) });
  return stmts;
}
export async function replaceAll(data) {
  await execMany(replaceAllStmts(data));
}
