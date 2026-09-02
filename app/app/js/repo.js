import { SQL, TABLES } from "./sql.js";
import { query, exec, execMany } from "./db.js";
import { nowIso, hoyISO, prevDayIso, fmtMoney, fmtDec1, appLocale } from "./format.js";
import { CONTRACT, insertSql } from "./contract.js";
import { periodMonth, ruleApplies, myAmountOfRule } from "./prevision.js";
import { resolveAccountId, sanitizeLoanMap, parseLoanMap } from "./account-defaults.js";
import { POOL, CURATED_ICONS, CATEGORY_ICONS, parseStyle, initCategoryStyle } from "./category-colors.js";
import { SEED_NAMES } from "./seeds.js";
import { t, monthShort } from "./i18n/index.js";
import { isValidPct } from "./share-pct.js";

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
    throw new Error(t("errors.repo.periodStartTooEarly"));
  const now = nowIso();
  const newId = bcUlid();
  const stmts = [];
  if (current) stmts.push({ sql: SQL.closePeriod, bind: [prevDayIso(startDate), now, current.id] });
  stmts.push({ sql: SQL.insertPeriod, bind: [newId, name, startDate, sharePct, now, now] });
  for (const b of budgets) {
    stmts.push({ sql: SQL.insertBudget, bind: [bcUlid(), newId, b.categoryId, b.amountCents, now, now] });
  }
  await execMany(stmts);
  return newId;
}

/** Reparto por defecto del periodo (Ajustes). Valida ANTES de tocar la BD (guard puro, testeable
 *  sin Worker — mismo patrón que periodStartTooEarly). Ojo al TDZ: aquí no hay `const t` local.
 *  Antes de aplicar el nuevo pct, congela (freezePeriodShareOverrides) en el MISMO execMany los
 *  compartidos con override NULL en el valor VIGENTE: el cambio afecta solo a los gastos nuevos. */
export async function updatePeriodSharePct(id, pct) {
  if (!isValidPct(pct)) throw new Error(t("errors.repo.sharePctInvalid"));
  const now = nowIso();
  await execMany([
    { sql: SQL.freezePeriodShareOverrides, bind: [id, now, id] },
    { sql: SQL.updatePeriodShare, bind: [pct, now, id] },
  ]);
}

export async function addTransaction({
  type, amountCents, date, categoryId, accountId, merchant, note, isShared,
  counterAccountId = "", sharePctOverride = null, paidBy = "me", refId = "", ruleId = "", externalId = "", status = "pending",
}) {
  // Invariante de columna cruzada de paid_by (la misma que validateImport aplica a una hoja,
  // xlsx.js): solo un GASTO COMPARTIDO puede haberlo pagado la contraparte. Se comprueba ANTES de
  // tocar la BD. La cuenta se BLANQUEA en vez de rechazarse: la fila no movió ninguna cuenta mía,
  // así que un accountId heredado de un formulario a medio cambiar se ignora en silencio en vez de
  // romper el guardado — y nunca puede acabar sumando en accountBalance.
  if (paidBy === "partner") {
    if (type !== "expense" || !isShared) throw new Error(t("errors.repo.paidByNotShared"));
    accountId = "";
  }
  // Item 2 (final fix wave): el lado contrario del guard de arriba — un gasto que NO lo pagó la
  // contraparte SÍ necesita una cuenta mía, o no hay saldo del que descontarlo.
  if (type === "expense" && paidBy !== "partner" && !accountId) throw new Error(t("common.needAccount"));
  const p = await getOpenPeriod();
  if (!p) throw new Error(t("errors.common.noOpenPeriod"));
  const now = nowIso();
  const insertStmt = {
    sql: SQL.insertTransaction,
    bind: [bcUlid(), date, p.id, type, amountCents, accountId, counterAccountId,
      categoryId ?? "", bcSanitizeCell(merchant ?? ""), bcSanitizeCell(note ?? ""),
      isShared ? 1 : 0, sharePctOverride, paidBy, 0, refId, ruleId, externalId, status, now, now],
  };
  if (refId) {
    await execMany([insertStmt, { sql: "UPDATE transactions SET settled=1, updated_at=? WHERE id=?", bind: [now, refId] }]);
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
/** Guarda varias claves de meta EN EL MISMO execMany: o quedan todas escritas o ninguna (una
 *  tarjeta de Ajustes con varios campos —p.ej. moneda, locale y contraparte— no debe poder
 *  quedar a medio guardar si algo falla entre un setMeta y el siguiente). pairs: [[key, value]]. */
export async function setMetaMany(pairs) {
  await execMany(pairs.map(([key, value]) => ({ sql: SQL.upsertMeta, bind: [key, value] })));
}

/** PR C (contraparte), Task 5: ¿hay algún gasto o regla compartidos activos (sin importar
 *  meta.partner_name)? La usa Inicio para el banner de migración de una sola vez cuando una BD
 *  trae compartidos de antes de que la contraparte fuera configurable (partner_name vacío pero
 *  ya hay is_shared=1 en la BD). */
export async function hasSharedData() {
  const [tx, rules] = await Promise.all([query(SQL.hasSharedTx), query(SQL.hasSharedRule)]);
  return tx.length > 0 || rules.length > 0;
}

/** Cuenta destino del import CSV / cuenta por defecto de formularios, resueltas desde meta
 *  (vacío ⇒ primera checking activa; null ⇒ no hay cuentas). */
export async function importAccountId() {
  const [meta, accounts] = await Promise.all([getMetaAll(), listAccounts()]);
  return resolveAccountId(meta.import_account_id, accounts);
}
export async function defaultAccountId() {
  const [meta, accounts] = await Promise.all([getMetaAll(), listAccounts()]);
  return resolveAccountId(meta.default_account_id, accounts);
}

export const listPeriods = () => query(SQL.listPeriods);
export const listAllByDay = (pid) => query(SQL.listAllByDay, [pid]);
export const getTransaction = async (id) => (await query(SQL.getTransaction, [id]))[0] ?? null;
// ¿`id` tiene algún apunte de liquidación activo enlazado por ref_id (la devolución entrante o el
// ajuste saliente)? La usa tanto Movimientos (bloquear importe/compartido en la UI) como
// updateTransaction (rechazar el cambio server-side aunque alguien salte la UI).
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
    || f.sharePctOverride !== cur.share_pct_override
    // Cambiar quién pagó un gasto YA liquidado descuadra la deuda saldada igual que cambiar el
    // importe: el apunte de liquidación se quedó con la dirección y el importe de antes.
    || f.paidBy !== cur.paid_by;
}

/** M5 (Task 6, review de seguridad): el guard de arriba solo mira el LADO DEL GASTO. Si en vez
 *  de tocar el gasto se toca el REFUND enlazado (bajar su importe de 50€ a 5€), sharedFieldsLocked
 *  nunca se evalúa — cur.type sería 'refund', no 'expense' — y la deuda de 45€ desaparece de
 *  Liquidar en silencio mientras el gasto original sigue settled=1. Pura (mismo patrón que
 *  sharedFieldsLocked): `linked` es la fila YA CARGADA del gasto que apunta cur.ref_id (o null si
 *  no existe/está borrado — getTransaction filtra deleted=0, así que un refund que ya apunta a un
 *  gasto huérfano de ANTES de este fix queda fuera del guard a propósito, ver nota en el report). */
export function refundAmountLocked(cur, f, linked) {
  // Cubre los dos apuntes de liquidación: la devolución ENTRANTE (type='refund') y el ajuste
  // SALIENTE (type='adjustment' con ref_id, que solo crea settleAllSharedStmts). Bajar el importe
  // de cualquiera de los dos descuadraría una deuda ya saldada sin nada que lo delate.
  return (cur.type === "refund" || cur.type === "adjustment") && !!cur.ref_id
    && f.amountCents !== cur.amount_cents
    && !!linked?.settled;
}

/** M5 (Task 6): ¿debe bloquearse el borrado de `cur` porque es un gasto con al menos un refund
 *  ACTIVO enlazado por ref_id? Deliberadamente NO mira cur.settled — un import a mano puede dejar
 *  settled=1 sin ningún refund vivo (fila ya borrada a mano, o backup viejo), y bloquear por ese
 *  campo dejaría el gasto sin ninguna vía para borrarse nunca. Se ancla solo en `hasActiveRefund`
 *  (ya resuelto por el caller vía hasActiveLinkedRefund): así SIEMPRE hay una salida — borrar
 *  primero el refund (rama existente de softDeleteTransaction: unsettle + borra) deja el gasto
 *  como uno normal, no liquidado, borrable por la vía de siempre. */
export function expenseDeleteLocked(cur, hasActiveRefund) {
  return !!cur && cur.type === "expense" && !!hasActiveRefund;
}

export const countUncategorized = async (pid) => (await query(SQL.countUncategorized, [pid]))[0].n;
export const pendingSettlements = () => query(SQL.pendingSettlements);
export const pendingSettlementNetCents = async () => (await query(SQL.pendingSettlementNet))[0].net_cents;
export const spentByRootCategory = (pid) => query(SQL.spentByRootCategory, [pid]);

/** Desglose del gasto de una raíz por subcategoría (bloque desplegable de «Gasto por categoría»).
 *  Devuelve también la fila de la propia raíz (category_id === rootId): es el gasto anotado
 *  directamente en ella. Incluye las filas a 0; quien consume las descarta. */
export const spentByChildCategory = (periodId, rootId) => query(SQL.spentByChildCategory, [periodId, rootId, rootId]);
export const budgetsOfPeriod = (pid) => query(SQL.budgetsOfPeriod, [pid]);

/** Pone o cambia el límite de una categoría en un periodo (pantalla «Gasto por categoría»).
 *  Guard PURO antes de tocar la BD (mismo patrón que periodStartTooEarly/updatePeriodSharePct):
 *  un límite es SIEMPRE un entero de céntimos > 0 — «sin límite» se expresa borrando la fila con
 *  deleteBudget, nunca guardando un 0 (budgetStatus trata el 0 como "sin estado" y una fila a 0
 *  dejaría una categoría con límite fantasma). Si ya hay fila viva la actualiza; si no, inserta
 *  con el mismo generador de id que openNextPeriod. */
export async function upsertBudget(periodId, categoryId, amountCents) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error(t("errors.repo.budgetInvalid"));
  const now = nowIso();
  const existing = (await query(SQL.budgetOfCategory, [periodId, categoryId]))[0];
  if (existing) await exec(SQL.updateBudget, [amountCents, now, existing.id]);
  else await exec(SQL.insertBudget, [bcUlid(), periodId, categoryId, amountCents, now, now]);
}

/** Quita el límite de una categoría en un periodo: borrado lógico, idempotente (sin fila viva no
 *  hace nada). No lleva guard: quitar algo que no está es una operación válida. */
export const deleteBudget = (periodId, categoryId) => exec(SQL.softDeleteBudget, [nowIso(), periodId, categoryId]);

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

/** Statements de UNA liquidación completa: por cada fila de pendingSettlements, el apunte que la
 *  salda + su UPDATE settled=1. Dos direcciones:
 *   - direction 'partner_owes' (lo pagué yo): devolución ENTRANTE por settle_cents en la cuenta
 *     elegida, categoría y comercio del gasto original, enlazada por ref_id — la de siempre,
 *     is_shared=0 porque ya ES el 100% de lo que ella debe.
 *   - direction 'i_owe' (lo pagó ella): apunte de SALIDA por -settle_cents en la cuenta elegida.
 *     type='adjustment' con importe negativo (el CHECK de schema.sql:34 lo permite solo para este
 *     tipo) porque NO es gasto: mi parte ya contó como gasto el día que ella pagó. Sin categoría
 *     (countUncategorized e isUncategorized excluyen adjustment) y con ref_id al gasto, que es lo
 *     que permite des-liquidarlo si se borra.
 *  El saldo de la cuenta se mueve por el NETO de las dos ramas aunque el banco enseñe un único
 *  Bizum: son N apuntes en la app frente a 1 línea bancaria (riesgo aceptado, ver la spec §12.4).
 *
 *  PURA a propósito (mismo criterio que replaceAllStmts): recibe `rows` YA resueltas, y
 *  periodId/date/now/partnerName ya calculados por el caller — así es testeable en Node sin Worker,
 *  y el test que comprueba el ORDEN EXACTO del bind de insertTransaction llama a esta función real.
 *
 *  bcUlid/bcSanitizeCell son globales (vendor/pure.js), igual que en addTransaction. */
export function settleAllSharedStmts(rows, accountId, periodId, date, now, partnerName) {
  const note = t("liquidar.note");
  const outMerchant = partnerName
    ? t("liquidar.outflow.merchant", { name: partnerName })
    : t("liquidar.outflow.merchantFallback");
  const stmts = [];
  for (const row of rows) {
    const isOut = row.direction === "i_owe";
    stmts.push({
      sql: SQL.insertTransaction,
      bind: [
        bcUlid(), date, periodId,
        isOut ? "adjustment" : "refund",
        isOut ? -row.settle_cents : row.settle_cents,
        accountId, "",
        isOut ? "" : row.category_id,
        bcSanitizeCell(isOut ? outMerchant : (row.merchant ?? "")),
        note,
        0, null, "me", 0,
        row.id, "", "", "pending", now, now,
      ],
    });
    stmts.push({ sql: "UPDATE transactions SET settled=1, updated_at=? WHERE id=?", bind: [now, row.id] });
  }
  return stmts;
}

/** Liquida UN gasto compartido pendiente, en cualquiera de las dos direcciones, reutilizando
 *  settleAllSharedStmts con una sola fila (un único camino para las dos operaciones). Exportada y
 *  con test, aunque hoy ninguna pantalla la use (Liquidar retiró el botón por fila). */
export async function settleShared(txId, accountId) {
  // Mismo ORDEN de guards que settleAllShared (periodo primero, fila después): así las dos
  // funciones lanzan el mismo error ante el mismo estado, y un id obsoleto sin periodo abierto no
  // reporta "gasto no encontrado" cuando el problema real es que no hay periodo.
  const [period, pending, meta] = await Promise.all([getOpenPeriod(), pendingSettlements(), getMetaAll()]);
  if (!period) throw new Error(t("errors.common.noOpenPeriod"));
  const row = pending.find((r) => r.id === txId);
  if (!row) throw new Error(t("errors.repo.settleNotFound"));
  await execMany(settleAllSharedStmts([row], accountId, period.id, hoyISO(), nowIso(), (meta.partner_name || "").trim()));
}

/** Liquida VARIOS gastos compartidos pendientes DE GOLPE (el botón de Liquidar): las dos
 *  direcciones a la vez — un refund ENTRANTE por cada fila partner_owes (lo pagué yo) y un
 *  adjustment SALIENTE por cada fila i_owe (lo pagó ella) — y el saldo de la cuenta elegida se
 *  mueve por el NETO de las dos. Un único getOpenPeriod() + una única pendingSettlements() (no una
 *  consulta por fila) + settleAllSharedStmts (arriba) + UN SOLO execMany — o quedan liquidados TODOS los
 *  `ids` pedidos, o ninguno (si algo falla a medias, la mitad de la deuda con la contraparte
 *  desaparecería mientras la otra mitad sigue pendiente, un estado que ninguna pantalla sabría
 *  explicar). `ids` vacío es un no-op silencioso (nada que liquidar, no es un error). Con neto 0 y
 *  filas en los dos lados se liquidan TODAS igualmente: entran los cobros y salen los pagos, se
 *  cancelan en el saldo, y ninguna fila se queda pendiente para siempre.
 *
 *  Guard de fila: si algún id de `ids` NO aparece en pendingSettlements() (ya liquidado por otra
 *  pestaña, borrado, o directamente no existe), se LANZA (no se liquida un subconjunto en
 *  silencio) — mismo mensaje que settleShared (errors.repo.settleNotFound), reutilizado porque es
 *  exactamente la misma condición. Se filtra `pending` por `idSet` en vez de mapear `ids` uno a
 *  uno para que un id DUPLICADO en `ids` no cree dos refunds sobre el mismo gasto (el filtro
 *  dedupea; el length-check contra idSet.size detecta tanto duplicados como ids inexistentes). */
export async function settleAllShared(ids, accountId) {
  if (!ids || ids.length === 0) return;
  const idSet = new Set(ids);
  const [period, pending, meta] = await Promise.all([getOpenPeriod(), pendingSettlements(), getMetaAll()]);
  if (!period) throw new Error(t("errors.common.noOpenPeriod"));
  const rows = pending.filter((r) => idSet.has(r.id));
  if (rows.length !== idSet.size) throw new Error(t("errors.repo.settleNotFound"));
  const now = nowIso();
  await execMany(settleAllSharedStmts(rows, accountId, period.id, hoyISO(), now, (meta.partner_name || "").trim()));
}

/** Actualiza los campos editables de un movimiento (mismas claves camelCase que addTransaction).
 *  Los campos ausentes conservan el valor actual (no se pisan con defaults): p.ej. si el formulario
 *  no expone `status`, la fila mantiene su status ('pending'/'reconciled') tal cual estaba. */
export async function updateTransaction(id, fields) {
  const cur = await getTransaction(id);
  if (!cur) throw new Error(t("errors.repo.txNotFound"));
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
    paidBy: fields.paidBy ?? cur.paid_by,
    refId: fields.refId ?? cur.ref_id,
    ruleId: fields.ruleId ?? cur.rule_id,
    status: fields.status ?? cur.status,
  };
  // Misma invariante de columna cruzada que en addTransaction (y que validateImport): solo un gasto
  // compartido puede haberlo pagado la contraparte, y esa fila nunca lleva cuenta.
  if (f.paidBy === "partner") {
    if (f.type !== "expense" || !f.isShared) throw new Error(t("errors.repo.paidByNotShared"));
    f.accountId = "";
  }
  // Item 2 (final fix wave): el lado contrario del guard de arriba — un gasto que NO lo pagó la
  // contraparte SÍ necesita una cuenta mía, o no hay saldo del que descontarlo.
  if (f.type === "expense" && f.paidBy !== "partner" && !f.accountId) throw new Error(t("common.needAccount"));
  // Task 17 ronda 2 (controller ruling, finding A): un gasto ya liquidado (settled=1) con un
  // refund activo enlazado no puede cambiar de importe/compartido/reparto — si no, el refund
  // se queda congelado con el importe viejo y la deuda con la contraparte se pierde en silencio. Guarda
  // server-side (no solo UI, que ya bloquea los campos): un save que NO toca esos campos
  // (solo categoría/fecha/nota/comercio) sigue funcionando con normalidad.
  if (sharedFieldsLocked(cur, f) && (await hasActiveLinkedRefund(id))) {
    throw new Error(t("errors.repo.txLockedSettled"));
  }
  // Task 6 (M5): lado del apunte de liquidación del mismo guard — ver refundAmountLocked.
  // cur.ref_id, si existe, apunta siempre a un gasto (nunca a otro apunte de liquidación), tanto en
  // un refund como en el adjustment de salida, así que reutilizar getTransaction aquí es correcto y
  // evita duplicar el SELECT.
  const linkedExpense = (cur.type === "refund" || cur.type === "adjustment") && cur.ref_id
    ? await getTransaction(cur.ref_id) : null;
  if (refundAmountLocked(cur, f, linkedExpense)) {
    throw new Error(t("errors.repo.refundLockedSettled"));
  }
  const now = nowIso();
  await exec(SQL.updateTransaction, [
    f.type, f.amountCents, f.date, f.categoryId ?? "", f.accountId, f.counterAccountId ?? "",
    bcSanitizeCell(f.merchant ?? ""), bcSanitizeCell(f.note ?? ""), f.isShared ? 1 : 0,
    f.sharePctOverride, f.paidBy, f.refId ?? "", f.ruleId ?? "", f.status, now, id,
  ]);
}

/** Borra (soft) un movimiento. Si es un apunte de liquidación enlazado a un gasto (la devolución
 *  entrante o el ajuste saliente, los dos con ref_id), revierte el settled=1 de ese gasto EN LA
 *  MISMA operación — salvo que quede algún otro apunte activo apuntándole (p.ej. si alguna vez se
 *  permiten varios refunds parciales sobre el mismo gasto).
 *
 *  Task 6 (M5): si en cambio se intenta borrar el GASTO original y tiene algún refund activo
 *  enlazado, se BLOQUEA (no se hace cascada) — ver expenseDeleteLocked. Elegido sobre des-liquidar
 *  y borrar el refund en cascada porque bloquear NUNCA deja al usuario sin salida: la rama de
 *  arriba (borrar el refund primero) ya des-liquida el gasto ella sola, así que borrar el refund y
 *  LUEGO el gasto es un camino de dos pasos que ya funciona hoy sin tocar nada más. Una cascada
 *  automática, en cambio, borraría en silencio una fila que representa dinero que ya se movió a
 *  una cuenta real (el refund cuenta en accountBalance) como efecto secundario de borrar OTRA
 *  fila — pérdida de datos silenciosa que el usuario no pidió. */
export async function softDeleteTransaction(id) {
  const cur = await getTransaction(id);
  // hasActiveLinkedRefund solo se consulta cuando cur.type==='expense': para el resto de tipos
  // expenseDeleteLocked ya descarta por type sin necesidad del SELECT extra.
  const hasActiveRefund = cur?.type === "expense" && (await hasActiveLinkedRefund(id));
  if (expenseDeleteLocked(cur, hasActiveRefund)) {
    throw new Error(t("errors.repo.expenseLockedHasRefund"));
  }
  const now = nowIso();
  if (cur && (cur.type === "refund" || cur.type === "adjustment") && cur.ref_id) {
    await execMany([
      { sql: SQL.softDeleteTransaction, bind: [now, id] },
      { sql: SQL.unsettleIfNoActiveRefunds, bind: [cur.ref_id, id, now, cur.ref_id] },
    ]);
  } else {
    await exec(SQL.softDeleteTransaction, [now, id]);
  }
}

export const listRules = () => query(SQL.listRules);
export const getRule = async (id) => (await query(SQL.getRule, [id]))[0] ?? null;

/** Crea una regla recurrente. fields camelCase (ver recurrentes.js): is_active por defecto
 *  activa (1) si no se indica, igual criterio que el DEFAULT 1 del schema. name pasa por
 *  bcSanitizeCell como merchant/note de addTransaction: es texto libre tecleado por el usuario
 *  que via exportAllJson acaba en una celda .xlsx (mismo riesgo de inyección de fórmula). */
export async function createRule(fields) {
  const now = nowIso();
  await exec(SQL.insertRule, [
    bcUlid(), bcSanitizeCell(fields.name), fields.type, fields.amountCents,
    fields.categoryId ?? "", fields.accountId, fields.counterAccountId ?? "",
    fields.frequency, fields.dueDay ?? null, fields.dueMonth ?? null,
    fields.isShared ? 1 : 0, fields.isActive === false ? 0 : 1,
    now, now,
  ]);
}

/** Actualiza los campos editables de una regla (mismas claves camelCase que createRule).
 *  Los campos ausentes conservan el valor actual — mismo criterio que repo.updateTransaction. */
export async function updateRule(id, fields) {
  const cur = await getRule(id);
  if (!cur) throw new Error(t("errors.repo.ruleNotFound"));
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
  const now = nowIso();
  await exec(SQL.updateRule, [
    bcSanitizeCell(f.name), f.type, f.amountCents, f.categoryId ?? "", f.accountId, f.counterAccountId ?? "",
    f.frequency, f.dueDay, f.dueMonth, f.isShared ? 1 : 0, f.isActive ? 1 : 0, now, id,
  ]);
}

export const softDeleteRule = (id) => exec(SQL.softDeleteRule, [nowIso(), id]);

export const accountBalanceCents = async (accountId, atDateIso) =>
  (await query(SQL.accountBalance, [atDateIso, accountId]))[0].balance_cents;

/** Previsión del periodo (Task 11): reglas recurrentes que aplican este mes, con su estado
 *  pagado/pendiente (por rule_id o, si se registró a mano, por el fallback categoría+importe)
 *  y el "disponible real" — mismo criterio que la hoja "Previsión" (dashboards.py:103-134).
 *  comprometidoCents excluye type='income' (una regla de ingreso pendiente no "compromete"
 *  nada, solo lo hacen los gastos/transferencias sin pagar). saldoCuentaCents es el saldo de
 *  la cuenta por defecto A HOY (no a la fecha del periodo: es el disponible AHORA). */
export async function previsionOfPeriod(period) {
  const month = periodMonth(period.start_date, period.end_date);
  const mainAccountId = await defaultAccountId();
  const [rules, paidByRule, paidByCat, saldoCuentaCents, netPartnerCents] = await Promise.all([
    listRules(),
    query(SQL.paidRuleIds, [period.id]),
    query(SQL.paidByCatAmount, [period.id]),
    mainAccountId ? accountBalanceCents(mainAccountId, hoyISO()) : Promise.resolve(0),
    pendingSettlementNetCents(),
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
    saldoCuentaCents,
    netPartnerCents,
    // El neto puede ser negativo (le debo más de lo que me debe): entonces RESTA del disponible,
    // que es justo lo que faltaba — antes solo se sumaba lo que ella me debía.
    disponibleCents: saldoCuentaCents - comprometidoCents + netPartnerCents,
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

// Abreviatura de 3 letras para las etiquetas de la sparkline de Patrimonio, vía i18n — arrays
// FIJOS (no Intl.DateTimeFormat) para que no dependan de la versión de ICU del entorno:
// comprobado que en Node 22 { month:"short" } da "sept" para septiembre (4 letras), no "sep".
export const shortMonthLabel = (iso) => monthShort(new Date(iso + "T12:00:00").getMonth());

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

// den<=0 -> 0 en vez de NaN/Infinity: mismo criterio que budgetStatus (presupuesto.js), pero sin
// importarla desde repo.js (capa de datos no depende de una pantalla) — 3 líneas, se duplica aquí.
const safeDiv = (num, den) => (den > 0 ? (num / den) * 100 : 0);

// "antes de mayo 2027" (mes en minúscula, mitad de frase) — a diferencia de
// format.js#nombrePorDefecto (que capitaliza para usarlo como NOMBRE de periodo), aquí no aplica.
const fmtMesAnio = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString(appLocale(), { month: "long", year: "numeric" }).replace(" de ", " ");

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
      ? t("goals.emergencyFund.withAvg", { account: accName, months: fmtDec1(currentCents / avgSpentCents) })
      : t("goals.emergencyFund.noAvg", { account: accName });
    return { goal, currentCents, targetCents, pct, level: "ok", subtitle };
  }

  if (goal.type === "savings_target") {
    const currentCents = balanceByAccount[goal.account_id] ?? 0;
    const targetCents = goal.target_amount_cents ?? 0;
    const pct = safeDiv(currentCents, targetCents);
    const accName = accountNameById[goal.account_id] ?? "";
    const fecha = goal.target_date ? t("goals.savingsTarget.beforeDate", { date: fmtMesAnio(goal.target_date) }) : "";
    const subtitle = t("goals.savingsTarget.base", { account: accName }) + fecha;
    return { goal, currentCents, targetCents, pct, level: "ok", subtitle };
  }

  if (goal.type === "provision") {
    const currentCents = balanceByAccount[goal.account_id] ?? 0;
    const targetCents = goal.target_amount_cents ?? 0;
    const pct = safeDiv(currentCents, targetCents);
    const monthlyCents = Math.round(targetCents / 12);
    const subtitle = t("goals.provision.subtitle", { amount: fmtMoney(monthlyCents) });
    return { goal, currentCents, targetCents, pct, level: "ok", subtitle };
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
      ? t("goals.spendingCap.over", { amount: fmtMoney(-remaining) })
      : t("goals.spendingCap.remaining", { amount: fmtMoney(remaining) });
    return { goal, currentCents, targetCents, pct, level, subtitle };
  }

  // savings_rate: currentCents/targetCents guardan PUNTOS PORCENTUALES, no céntimos (el nombre
  // del campo se mantiene igual para los 5 tipos — así lo pide la interfaz del brief de la Task 13).
  const currentCents = savingsRatePct;
  const targetCents = goal.target_pct ?? 0;
  const pct = safeDiv(currentCents, targetCents);
  const level = currentCents >= targetCents ? "ok" : "warn";
  return { goal, currentCents, targetCents, pct, level, subtitle: t("goals.savingsRate.subtitle") };
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
  const now = nowIso();
  await exec(SQL.insertAccount, [id, bcSanitizeCell(name), type, openingBalanceCents, now, now]);
  return id;
}

/** Actualiza una cuenta (mismas claves camelCase que createAccount). Toda cuenta es renombrable,
 *  incluida la que usa el import de N26 (localiza la cuenta por `meta.import_account_id`, no por
 *  nombre). Los campos ausentes conservan el valor actual — mismo criterio merge-on-current que
 *  repo.updateRule. */
export async function updateAccount(id, fields) {
  const cur = await getAccount(id);
  if (!cur) throw new Error(t("errors.repo.accountNotFound"));
  const name = fields.name ?? cur.name;
  const type = fields.type ?? cur.type;
  const openingBalanceCents = fields.openingBalanceCents ?? cur.opening_balance_cents;
  const now = nowIso();
  await exec(SQL.updateAccount, [bcSanitizeCell(name), type, openingBalanceCents, now, id]);
}

/** Cuota mensual de un pasivo (Task 6, CONFIG-IN-META — mismo patrón que setCategoryStyle, sin
 *  migración de esquema ni cambio de contrato xlsx). Read-modify-write de meta.account_loans:
 *  lee el JSON completo, toca SOLO `accountId`, reescribe entero. `monthlyCents` no positivo (o
 *  ausente) BORRA la entrada — "sin cuota definida", mismo criterio "objeto vacío quita el
 *  override" que setCategoryStyle. sanitizeLoanMap se aplica ANTES de escribir: defensa en
 *  profundidad (un accountId corrupto no debería llegar aquí desde la UI, que solo ofrece ids
 *  reales, pero esta es la última línea).
 *  Cuentas borradas/archivadas: hoy no existe ningún flujo de borrado/archivado de CUENTAS en el
 *  repo (a diferencia de categorías, que sí tienen setCategoryArchived) — createAccount/
 *  updateAccount son las únicas operaciones. No hay, por tanto, ningún punto donde limpiar la
 *  entrada de account_loans al borrar/archivar una cuenta; se documenta aquí para cuando esa
 *  funcionalidad exista. */
export async function setAccountLoan(accountId, monthlyCents) {
  const meta = await getMetaAll();
  const loanMap = parseLoanMap(meta.account_loans);
  if (monthlyCents > 0) loanMap[accountId] = { monthlyCents };
  else delete loanMap[accountId];
  await setMeta("account_loans", JSON.stringify(sanitizeLoanMap(loanMap)));
}

/** Mapa saneado {accountId: {monthlyCents}} de meta.account_loans. A diferencia de
 *  category_style (singleton inicializado en el boot de main.js porque colorForCategory/
 *  iconForCategory se llaman desde varias pantallas), account_loans SOLO lo consume Patrimonio
 *  (accountSubtitle, "quedan N cuotas") — se carga en patrimonio.js#loadData vía esta función,
 *  sin necesidad de un estado global ni de tocar el boot. */
export async function getAccountLoans() {
  const meta = await getMetaAll();
  return parseLoanMap(meta.account_loans);
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
  const now = nowIso();
  const goalId = bcUlid();
  const stmts = [];
  let accountId = fields.accountId || "";
  if (HUCHA_GOAL_TYPES.has(fields.type) && !accountId) {
    accountId = bcUlid();
    stmts.push({
      sql: SQL.insertAccount,
      bind: [accountId, bcSanitizeCell(`Hucha · ${fields.name}`), "savings", 0, now, now],
    });
  }
  const isActive = fields.isActive !== undefined ? (fields.isActive ? 1 : 0) : 1;
  stmts.push({
    sql: SQL.insertGoal,
    bind: [
      goalId, bcSanitizeCell(fields.name), fields.type,
      fields.targetAmountCents ?? null, fields.targetMonths ?? null, fields.targetPct ?? null,
      fields.targetDate ?? "", accountId, fields.categoryId ?? "", isActive, now, now,
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
  if (!cur) throw new Error(t("errors.repo.goalNotFound"));
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
  const now = nowIso();
  await exec(SQL.updateGoal, [
    bcSanitizeCell(f.name), f.type, f.targetAmountCents, f.targetMonths, f.targetPct,
    f.targetDate ?? "", f.accountId ?? "", f.categoryId ?? "", f.isActive ? 1 : 0, now, id,
  ]);
}

export const softDeleteGoal = (id) => exec(SQL.softDeleteGoal, [nowIso(), id]);

// ---- Categorías editables (PR D, Task 4) ------------------------------------

export const listCategoriesAdmin = () => query(SQL.listCategoriesAdmin);
export const getCategory = async (id) => (await query(SQL.getCategory, [id]))[0] ?? null;

/** ¿Puede `parentId` ser el padre de una categoría de flow `flow`? Debe existir, ser una
 *  categoría PRINCIPAL (parent_id='' — el árbol admite como mucho 2 niveles) y del MISMO flow
 *  que la categoría que se está creando/moviendo (una de gasto no puede colgar de una de
 *  ingreso, ni al revés). Lanza si no se cumple — la comparten createCategory y updateCategory. */
async function assertValidParent(parentId, flow) {
  const parent = await getCategory(parentId);
  if (!parent || parent.parent_id !== "" || parent.flow !== flow) {
    throw new Error(t("errors.repo.invalidParent"));
  }
}

/** Crea una categoría. fields camelCase: {name, flow, needType, parentId}. Raíz (parentId
 *  ausente/vacío) o hija (parentId debe apuntar a una principal del MISMO flow — assertValidParent).
 *  El nombre se recorta (trim) antes de guardarlo — vacío tras el recorte es un error: a
 *  diferencia de cuentas/objetivos/reglas (donde el recorte lo hace la propia pantalla antes de
 *  llamar al repo), aquí el guard vive en el repo, última línea de defensa para una entidad nueva
 *  de este PR. */
export async function createCategory({ name, flow, needType, parentId }) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new Error(t("errors.repo.categoryNameEmpty"));
  const pid = parentId || "";
  if (pid) {
    await assertValidParent(pid, flow);
    // Item 4 (Important, review final): a propósito NO entra en assertValidParent (compartida con
    // updateCategory) — save() en categorias.js manda parentId SIEMPRE en edición, incluso al
    // renombrar una hija cuya raíz ya está archivada; si este check viviera ahí, ese rename (que
    // hoy funciona y debe seguir funcionando) empezaría a lanzar. Solo alta bajo un padre archivado
    // se bloquea aquí.
    const parent = await getCategory(pid);
    if (parent.is_archived) throw new Error(t("errors.repo.parentArchived"));
  }
  const id = bcUlid();
  const now = nowIso();
  await exec(SQL.insertCategory, [id, bcSanitizeCell(trimmed), pid, flow, needType ?? "", now, now, flow, pid]);
  return id;
}

/** Actualiza una categoría (name/needType/parentId — merge-on-current, mismo criterio que
 *  updateAccount/updateRule/updateGoal). `flow` es INMUTABLE: a diferencia del resto de campos
 *  (que si faltan conservan el valor actual), ni siquiera se acepta como clave — pasarla lanza,
 *  no se ignora en silencio. SQL.updateCategory tampoco la tocaría aunque se colara (última
 *  línea de defensa).
 *
 *  LIMITACIÓN CONOCIDA: al mover una hija a otro padre (o convertir hija en raíz, o raíz en
 *  hija) el display_order NO se recalcula para el grupo (flow, parent_id) de destino — conserva
 *  el número de su grupo anterior, que puede coincidir con el de alguna categoría ya presente en
 *  el grupo nuevo. No rompe nada (display_order no es UNIQUE) pero el orden dentro del grupo de
 *  destino queda indeterminado hasta el próximo reorderCategories. No se resuelve aquí: no lo
 *  pide el brief de esta task, y el guard de arrastrar (Task 7) deja cualquier grupo en 1..n en
 *  cuanto el usuario lo reordena. */
export async function updateCategory(id, fields) {
  if (fields.flow !== undefined) {
    throw new Error(t("errors.repo.flowImmutable"));
  }
  const cur = await getCategory(id);
  if (!cur) throw new Error(t("errors.repo.categoryNotFound"));

  let name = cur.name;
  if (fields.name !== undefined) {
    const trimmed = String(fields.name).trim();
    if (!trimmed) throw new Error(t("errors.repo.categoryNameEmpty"));
    name = bcSanitizeCell(trimmed);
  }
  const needType = fields.needType !== undefined ? fields.needType : cur.need_type;
  const parentId = fields.parentId !== undefined ? fields.parentId : cur.parent_id;

  if (parentId) {
    await assertValidParent(parentId, cur.flow);
    // Item 3 (review final): hasChildren, NO hasActiveChildren — incluso con solo hijas
    // ARCHIVADAS, demotarla dejaría un árbol de 3 niveles (la hija sigue apuntando, vía
    // parent_id, a una categoría que deja de ser raíz). El mensaje ya no dice "activas": el guard
    // es sobre CUALQUIER hija, se refleje o no como tal en la lista (que solo cuenta activas).
    const children = await query(SQL.hasChildren, [id]);
    if (children.length > 0) {
      throw new Error(t("errors.repo.categoryHasChildren"));
    }
  }

  const now = nowIso();
  await exec(SQL.updateCategory, [name, needType, parentId, now, id]);
}

/** Archiva una categoría. Si es una raíz con hijas ACTIVAS, las archiva en cascada EN EL MISMO
 *  execMany (o quedan todas archivadas, o ninguna) — reutiliza SQL.setCategoryArchived una vez
 *  por fila (la raíz + cada hija activa), mismo criterio que insertBudget dentro de
 *  openNextPeriod. Una hija (que nunca tiene hijas propias — máx 2 niveles) simplemente no
 *  encuentra ninguna en childrenOf y archiva solo su propia fila. */
export async function archiveCategory(id) {
  const kids = await query(SQL.childrenOf, [id]);
  const now = nowIso();
  const stmts = [
    { sql: SQL.setCategoryArchived, bind: [1, now, id] },
    ...kids.map((k) => ({ sql: SQL.setCategoryArchived, bind: [1, now, k.id] })),
  ];
  await execMany(stmts);
}

/** Desarchiva una categoría. A propósito NO desarchiva sus hijas (si se archivó en cascada, cada
 *  hija se reactiva a mano, una por una): evita reactivar en bloque subcategorías que el usuario
 *  quizá había archivado ella sola antes de archivar la raíz. */
export const unarchiveCategory = (id) => exec(SQL.setCategoryArchived, [0, nowIso(), id]);

/** i18n (PR i18n, Task 6, fix round 1): retraduce las categorías SEMILLA (SEED_NAMES, seeds.js)
 *  a `toLang`. IDEMPOTENTE y basada en el ESTADO de cada fila, no en si el idioma "cambió": cada
 *  UPDATE matchea una fila solo si su nombre actual es EXACTAMENTE el nombre semilla del OTRO
 *  idioma soportado (con solo es/en, "el otro" es inequívoco) —
 *   - una fila que YA está en `toLang` no matchea nada (llamar dos veces seguidas con el mismo
 *     toLang deja la BD intacta la segunda vez: sin efecto, sin tocar updated_at),
 *   - una fila renombrada por el usuario ("Mi casa") tampoco matchea ningún nombre semilla y
 *     queda intacta,
 *   - y da igual qué devolviera activeLang() ANTES de llamar: arregla el caso de una BD sembrada
 *     en es cuyo activeLang() ya resolvía a en (con el guard viejo basado en fromLang!==toLang,
 *     elegir "English" en Ajustes era ahí un no-op — la UI ya "creía" estar en inglés aunque las
 *     filas siguieran en español).
 *  Los 41 UPDATE (uno por id de SEED_NAMES) van en el MISMO execMany (o quedan todos aplicados, o
 *  ninguno). No-op si `toLang` no es un idioma soportado (evita escribir name=NULL — SEED_NAMES
 *  solo tiene claves es/en). */
export async function retranslateSeedNames(toLang) {
  const supported = ["es", "en"];
  if (!supported.includes(toLang)) return;
  const otherLang = toLang === "es" ? "en" : "es";
  const now = nowIso();
  const stmts = Object.entries(SEED_NAMES).map(([id, names]) => ({
    sql: SQL.retranslateCategory,
    bind: [names[toLang], now, id, names[otherLang]],
  }));
  await execMany(stmts);
}

/** Persiste el orden de un grupo (raíces de un flow, o hijas de una raíz) tras un arrastre: deja
 *  display_order en 1..n según la posición de cada id en `orderedIds`, en un único execMany (o
 *  se guarda el orden completo, o no se guarda nada). `orderedIds` ya viene calculado por
 *  computeReorder (pura, reexportada abajo) — esta función solo persiste. */
export async function reorderCategories(orderedIds) {
  const now = nowIso();
  await execMany(orderedIds.map((catId, i) => ({ sql: SQL.updateCategoryOrder, bind: [i + 1, now, catId] })));
}

// Pura, sin DB: vive en category-order.js (no en este archivo, que importa db.js → Worker del
// navegador, no importable en Node) para que sea testeable directamente. Se reexporta aquí para
// que las pantallas tengan un único punto de import para todo lo de categorías.
export { computeReorder } from "./category-order.js";

/** Color/icono de override de UNA categoría raíz (las hijas heredan el estilo de su raíz — ver
 *  category-colors.js#rootOf, no tiene sentido un estilo propio de hija). Read-modify-write de
 *  meta.category_style: lee el JSON completo, toca SOLO la clave `rootId`, reescribe entero.
 *  REEMPLAZA la entrada de `rootId` por completo (no fusiona con lo que hubiera antes de la
 *  llamada): la pantalla de edición siempre manda el estado final deseado (color+icono elegidos,
 *  o ninguno de los dos si el usuario quiere volver al color/icono por defecto) — así "si la
 *  entrada queda vacía, se elimina la clave" tiene sentido como la acción de "quitar el
 *  override". `color`/`icon` ausentes o `undefined` son válidos (sin override para ese campo);
 *  cualquier otro valor fuera de POOL / CURATED_ICONS+CATEGORY_ICONS lanza. */
export async function setCategoryStyle(rootId, { color, icon } = {}) {
  if (color !== undefined && !POOL.includes(color)) throw new Error(t("errors.repo.colorUnavailable"));
  const iconValid = icon === undefined || CURATED_ICONS.includes(icon) || Object.values(CATEGORY_ICONS).includes(icon);
  if (!iconValid) throw new Error(t("errors.repo.iconUnavailable"));

  const meta = await getMetaAll();
  const styleMap = parseStyle(meta.category_style);
  const entry = {};
  if (color) entry.color = color;
  if (icon) entry.icon = icon;
  if (Object.keys(entry).length === 0) delete styleMap[rootId];
  else styleMap[rootId] = entry;

  await setMeta("category_style", JSON.stringify(styleMap));
  initCategoryStyle(styleMap);
}

// ---- Import CSV N26 (Task 15) -----------------------------------------------

// Lo consume n26.js para re-firmar en memoria las transacciones existentes de la cuenta de
// import antes de decidir cada fila del CSV (bcDecideImportAction) — un único query, no uno
// por fila.
export const n26Existing = (accountId) => query(SQL.n26Existing, [accountId]);

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
  // schema_version NO se importa: es una propiedad de ESTA base de datos (la puso el runner de
  // migraciones al arrancar, ver migrations.js), no de la hoja. Sin este filtro, importar una hoja
  // v1 en una BD ya migrada dejaría meta.schema_version='1' con la columna paid_by presente, y el
  // siguiente export produciría una hoja que se declara v1 llevando ya una columna v2.
  for (const row of data.meta) if (row.key !== "schema_version") stmts.push({ sql: SQL.upsertMeta, bind: [row.key, row.value] });
  for (const t of tables)
    for (const row of data[t]) stmts.push({ sql: insertSql(t), bind: CONTRACT[t].cols.map((c) => row[c]) });
  return stmts;
}
export async function replaceAll(data) {
  await execMany(replaceAllStmts(data));
}
