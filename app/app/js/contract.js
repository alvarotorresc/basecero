// Metadatos del contrato de datos (docs/specs/2026-08-24-basecero-hoja-calculo-design.md).
// Columnas en el orden exacto de app/js/schema.sql: insertSql y el motor xlsx dependen de ese orden.
export const CONTRACT = {
  meta: { cols: ["key","value"] },
  accounts: { cols: ["id","name","type","opening_balance_cents","display_order","is_archived","created_at","updated_at","deleted"] },
  categories: { cols: ["id","name","parent_id","flow","need_type","display_order","is_archived","created_at","updated_at","deleted"] },
  periods: { cols: ["id","name","start_date","end_date","status","my_share_pct","notes","created_at","updated_at","deleted"] },
  // has_attachment (Registro v2 §9.1) entre external_id y status: el FICHERO (OPFS, attachments.js)
  // es la fuente de verdad, esta columna es solo una pista de "esta fila tiene foto".
  transactions: { cols: ["id","date","period_id","type","amount_cents","account_id","counter_account_id","category_id","merchant","note","is_shared","share_pct_override","paid_by","settled","ref_id","rule_id","tag_id","external_id","has_attachment","status","created_at","updated_at","deleted"] },
  // is_subscription/cancelled_at (Suscripciones, N6) entre is_active y created_at — mismo criterio
  // de colocación semántica que paid_by en transactions. cancelled_at es una FECHA (YYYY-MM-DD),
  // NO un timestamp pese al sufijo _at: es el día de la baja, comparable con hoyISO() (ver xlsx.js
  // DATE_COLS, NO TIMESTAMP_COLS).
  recurring_rules: { cols: ["id","name","type","amount_cents","category_id","account_id","counter_account_id","frequency","due_day","due_month","is_shared","is_active","is_subscription","cancelled_at","created_at","updated_at","deleted"] },
  goals: { cols: ["id","name","type","target_amount_cents","target_months","target_pct","target_date","account_id","category_id","is_active","created_at","updated_at","deleted"] },
  budgets: { cols: ["id","period_id","category_id","amount_cents","created_at","updated_at","deleted"] },
  // Etiquetas de proyecto (N11, etiquetas-design §4/§5): la PRIMERA tabla opcional del contrato.
  //
  // optional:true → si la HOJA falta en el libro importado, la tabla se trata como VACÍA en vez de
  // rechazar el libro entero (xlsx.js#workbookToRows).
  //
  // CRITERIO, y no admite excepciones:
  //   Solo puede ser opcional una tabla AÑADIDA al contrato después de que ya hubiera hojas en
  //   circulación, y cuya ausencia signifique inequívocamente «no había ninguno de estos datos».
  //   Las OCHO tablas del núcleo (meta, accounts, categories, periods, transactions,
  //   recurring_rules, goals, budgets) NO pueden ser opcionales nunca: si falta `budgets` el libro
  //   está roto, y aceptarlo importaría en silencio una base de datos amputada. Marcar una tabla
  //   del núcleo como opcional convierte el guardián de integridad del import en un aceptador de
  //   basura, que es exactamente lo contrario de lo que hace validateImport.
  //
  // optional NO significa «esta hoja se valida menos»: una hoja PRESENTE se valida entera, con sus
  // PKs, sus FKs, sus booleanos y sus números, igual que cualquier otra.
  //
  // Sin flow, sin parent_id, sin color, sin icono (D3, D14): un nombre, un límite opcional y un
  // interruptor de archivado. `tags` va AL FINAL para que las ocho hojas existentes conserven su
  // posición exacta en cualquier libro abierto en LibreOffice.
  tags: { optional: true, cols: ["id","name","budget_cents","is_archived","created_at","updated_at","deleted"] },
};

export const ENUMS = {
  accounts: { type: ["checking","savings","liability"] },
  categories: { flow: ["expense","income"], need_type: ["need","want","savings",""] },
  periods: { status: ["open","closed"] },
  transactions: { type: ["expense","income","transfer","refund","adjustment"], status: ["pending","reconciled"], paid_by: ["me","partner"] },
  recurring_rules: { type: ["expense","income","transfer"], frequency: ["weekly","monthly","quarterly","yearly"] },
  goals: { type: ["emergency_fund","savings_target","spending_cap","savings_rate","provision"] },
};

export const BOOL_COLS = {
  accounts: ["is_archived","deleted"], categories: ["is_archived","deleted"],
  periods: ["deleted"], transactions: ["is_shared","settled","has_attachment","deleted"],
  recurring_rules: ["is_shared","is_active","is_subscription","deleted"], goals: ["is_active","deleted"],
  budgets: ["deleted"], meta: [], tags: ["is_archived","deleted"],
};

// budget_cents (tags): D4 — NULL = sin límite. Sin esta entrada, xlsx.js:330-332 reportaría
// `required` para la celda del límite en blanco, que es el caso NORMAL de una etiqueta sin tope.
export const NULLABLE_NUM = new Set(["share_pct_override","due_day","due_month","target_amount_cents","target_months","target_pct","budget_cents"]);

// Valor por defecto de una columna TEXT del contrato cuando la celda llega vacía o la hoja no trae
// su cabecera. paid_by es NOT NULL DEFAULT 'me' en la BD y su ENUM no admite "": una hoja v1 (sin
// la columna) o una hoja rellenada a mano con la celda en blanco describen exactamente el mundo
// "todo lo pagué yo", así que ese es el default — no un error de import.
export const TEXT_DEFAULTS = { transactions: { paid_by: "me" } };

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
//  - transactions.tag_id: archivar una etiqueta es is_archived, NUNCA tags.deleted=1 — la app no
//    produce este estado. El flag es una precaución de importación (una hoja editada a mano con
//    una etiqueta borrada no debe tirar abajo el import entero), no un camino que exista en uso
//    normal.
// Sin este flag, exportar y reimportar una BD real que ya esté en uno de estos estados (ambos
// alcanzables sin ningún import de por medio) se rechazaría — el import es un guarda de INTEGRIDAD
// ESTRUCTURAL del archivo, no debe bloquear datos que el propio repo ya permite crear.
export const FKS = [
  { table: "categories", col: "parent_id", ref: "categories", optional: true },
  { table: "transactions", col: "period_id", ref: "periods", optional: false },
  // account_id es obligatorio SALVO en un gasto compartido que pagó la contraparte: ahí no intervino
  // ninguna cuenta mía (el dinero no sale de mi banco hasta liquidar) y '' es lo que guarda el repo.
  // La invariante contraria (paid_by='partner' ⇒ account_id vacío) la valida validateImport aparte.
  { table: "transactions", col: "account_id", ref: "accounts", optional: false,
    optionalWhen: (row) => row.type === "expense" && row.is_shared === 1 && row.paid_by === "partner" },
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
  { table: "transactions", col: "tag_id", ref: "tags", optional: true, allowDeletedRef: true },
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
