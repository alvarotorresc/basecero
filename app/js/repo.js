import { SQL, TABLES } from "./sql.js";
import { query, exec, execMany } from "./db.js";
import { nowIso } from "./format.js";
import { CONTRACT, insertSql } from "./contract.js";

export async function getOpenPeriod() { return (await query(SQL.getOpenPeriod))[0] ?? null; }

export async function openFirstPeriod({ name, startDate, sharePct }) {
  const t = nowIso();
  await exec(SQL.insertPeriod, [bcUlid(), name, startDate, sharePct, t, t]);
}

export async function addTransaction({ type, amountCents, date, categoryId, accountId, merchant, note, isShared }) {
  const p = await getOpenPeriod();
  if (!p) throw new Error("No hay ningún periodo abierto");
  const t = nowIso();
  await exec(SQL.insertTransaction, [bcUlid(), date, p.id, type, amountCents, accountId,
    categoryId, bcSanitizeCell(merchant ?? ""), bcSanitizeCell(note ?? ""),
    isShared ? 1 : 0, null, t, t]);
}

export const spentOfPeriod = async (pid) => (await query(SQL.spentOfPeriod, [pid]))[0].spent_cents;
export const incomeOfPeriod = async (pid) => (await query(SQL.incomeOfPeriod, [pid]))[0].income_cents;
export const listByDay = (pid) => query(SQL.listByDay, [pid]);
export const listExpenseLeafCategories = () => query(SQL.listExpenseLeafCategories);
export const listIncomeCategories = () => query(SQL.listIncomeCategories);
export const listAccounts = () => query(SQL.listAccounts);
export const allCategoriesById = async () =>
  Object.fromEntries((await query(SQL.allCategories)).map((c) => [c.id, c]));

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
