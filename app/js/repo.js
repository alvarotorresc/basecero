import { SQL, TABLES } from "./sql.js";
import { query, exec, execMany } from "./db.js";
import { nowIso, hoyISO, prevDayIso } from "./format.js";
import { CONTRACT, insertSql } from "./contract.js";

export async function getOpenPeriod() { return (await query(SQL.getOpenPeriod))[0] ?? null; }

/** Cierra el periodo abierto (si existe: en el primer periodo no hay nada que cerrar) con
 *  end_date = día anterior a startDate, abre el nuevo y crea sus budgets — TODO en un único
 *  execMany (ver task-8-brief.md). budgets: [{categoryId, amountCents}]. La usa tanto el
 *  asistente de cierre normal como el onboarding (modo 'first', sin periodo previo). */
export async function openNextPeriod({ name, startDate, sharePct, budgets = [] }) {
  const current = await getOpenPeriod();
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

export const listPeriods = () => query(SQL.listPeriods);
export const listAllByDay = (pid) => query(SQL.listAllByDay, [pid]);
export const getTransaction = async (id) => (await query(SQL.getTransaction, [id]))[0] ?? null;
export const countUncategorized = async (pid) => (await query(SQL.countUncategorized, [pid]))[0].n;
export const pendingShared = () => query(SQL.pendingShared);
export const pendingSharedTotalCents = async () => (await query(SQL.pendingSharedTotal))[0].total_cents;
export const spentByRootCategory = (pid) => query(SQL.spentByRootCategory, [pid]);
export const budgetsOfPeriod = (pid) => query(SQL.budgetsOfPeriod, [pid]);

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

export async function dumpAllTables() {
  const out = {};
  for (const t of TABLES) out[t] = await query(SQL.dumpTable(t));
  return out;
}

export const exportAllJson = () => dumpAllTables();

export async function replaceAll(data) {
  const stmts = [...TABLES].reverse().map((t) => ({ sql: `DELETE FROM ${t}` }));
  for (const t of TABLES)
    for (const row of data[t]) stmts.push({ sql: insertSql(t), bind: CONTRACT[t].cols.map((c) => row[c]) });
  await execMany(stmts);
}
