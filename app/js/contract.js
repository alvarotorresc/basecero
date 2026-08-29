// Metadatos del contrato de datos (docs/specs/2026-08-24-basecero-hoja-calculo-design.md).
// Columnas en el orden exacto de app/js/schema.sql: insertSql y el motor xlsx dependen de ese orden.
export const CONTRACT = {
  meta: { cols: ["key","value"] },
  accounts: { cols: ["id","name","type","opening_balance_cents","display_order","is_archived","created_at","updated_at","deleted"] },
  categories: { cols: ["id","name","parent_id","flow","need_type","display_order","is_archived","created_at","updated_at","deleted"] },
  periods: { cols: ["id","name","start_date","end_date","status","my_share_pct","notes","created_at","updated_at","deleted"] },
  transactions: { cols: ["id","date","period_id","type","amount_cents","account_id","counter_account_id","category_id","merchant","note","is_shared","share_pct_override","settled","ref_id","rule_id","external_id","status","created_at","updated_at","deleted"] },
  recurring_rules: { cols: ["id","name","type","amount_cents","category_id","account_id","counter_account_id","frequency","due_day","due_month","is_shared","is_active","created_at","updated_at","deleted"] },
  goals: { cols: ["id","name","type","target_amount_cents","target_months","target_pct","target_date","account_id","category_id","is_active","created_at","updated_at","deleted"] },
  budgets: { cols: ["id","period_id","category_id","amount_cents","created_at","updated_at","deleted"] },
};

export const ENUMS = {
  accounts: { type: ["checking","savings","liability"] },
  categories: { flow: ["expense","income"], need_type: ["need","want","savings",""] },
  periods: { status: ["open","closed"] },
  transactions: { type: ["expense","income","transfer","refund","adjustment"], status: ["pending","reconciled"] },
  recurring_rules: { type: ["expense","income","transfer"], frequency: ["weekly","monthly","quarterly","yearly"] },
  goals: { type: ["emergency_fund","savings_target","spending_cap","savings_rate","provision"] },
};

export const BOOL_COLS = {
  accounts: ["is_archived","deleted"], categories: ["is_archived","deleted"],
  periods: ["deleted"], transactions: ["is_shared","settled","deleted"],
  recurring_rules: ["is_shared","is_active","deleted"], goals: ["is_active","deleted"],
  budgets: ["deleted"], meta: [],
};

export const NULLABLE_NUM = new Set(["share_pct_override","due_day","due_month","target_amount_cents","target_months","target_pct"]);

// optional=true → '' permitido (FK vacía). ref_id/rule_id/parent_id/counter_account_id son opcionales por contrato.
//
// allowDeletedRef=true → xlsx.js NO exige que esta FK, en una fila viva, apunte a un referente
// vivo. El repo permite (o permitió) estados alcanzables por USO NORMAL donde una fila viva queda
// apuntando a una borrada:
//  - transactions.ref_id: softDeleteTransaction (Task 6, PR de seguridad, hallazgo M5) ya BLOQUEA
//    el borrado de un gasto con refund activo enlazado, así que este estado no puede producirse de
//    nuevo — pero sigue siendo alcanzable en BACKUPS ANTERIORES a ese fix (exportados con el bug
//    aún presente) o en un archivo editado a mano. El fix no migra datos existentes (fuera de
//    alcance de Task 6), así que la excepción se mantiene: sin ella, reimportar uno de esos
//    backups reales y ya en producción se rechazaría de golpe.
//  - transactions.rule_id: softDeleteRule no hace cascada; las transacciones ya generadas por esa
//    regla (rule_id) siguen vivas y la regla puede borrarse después sin problema.
// Sin este flag, exportar y reimportar una BD real que ya esté en uno de estos estados (ambos
// alcanzables sin ningún import de por medio) se rechazaría — el import es un guarda de INTEGRIDAD
// ESTRUCTURAL del archivo, no debe bloquear datos que el propio repo ya permite crear.
export const FKS = [
  { table: "categories", col: "parent_id", ref: "categories", optional: true },
  { table: "transactions", col: "period_id", ref: "periods", optional: false },
  { table: "transactions", col: "account_id", ref: "accounts", optional: false },
  { table: "transactions", col: "counter_account_id", ref: "accounts", optional: true },
  { table: "transactions", col: "category_id", ref: "categories", optional: true },
  { table: "transactions", col: "ref_id", ref: "transactions", optional: true, allowDeletedRef: true },
  { table: "transactions", col: "rule_id", ref: "recurring_rules", optional: true, allowDeletedRef: true },
  { table: "recurring_rules", col: "category_id", ref: "categories", optional: true },
  { table: "recurring_rules", col: "account_id", ref: "accounts", optional: false },
  { table: "recurring_rules", col: "counter_account_id", ref: "accounts", optional: true },
  { table: "goals", col: "account_id", ref: "accounts", optional: true },
  { table: "goals", col: "category_id", ref: "categories", optional: true },
  { table: "budgets", col: "period_id", ref: "periods", optional: false },
  { table: "budgets", col: "category_id", ref: "categories", optional: false },
];

export const eurToCents = (v) => Math.round(Number(v) * 100);
export const centsToEur = (c) => Math.round(c) / 100;
export const xlsxHeader = (col) => col.replace(/_cents$/, "");

// Serial de Excel: días desde 1899-12-30 (25569 = 1970-01-01).
export function toIsoDate(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number") return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

export const insertSql = (table) =>
  `INSERT INTO ${table} (${CONTRACT[table].cols.join(",")}) VALUES (${CONTRACT[table].cols.map(() => "?").join(",")})`;
