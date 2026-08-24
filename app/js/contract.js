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
export const FKS = [
  { table: "categories", col: "parent_id", ref: "categories", optional: true },
  { table: "transactions", col: "period_id", ref: "periods", optional: false },
  { table: "transactions", col: "account_id", ref: "accounts", optional: false },
  { table: "transactions", col: "counter_account_id", ref: "accounts", optional: true },
  { table: "transactions", col: "category_id", ref: "categories", optional: true },
  { table: "transactions", col: "ref_id", ref: "transactions", optional: true },
  { table: "transactions", col: "rule_id", ref: "recurring_rules", optional: true },
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
