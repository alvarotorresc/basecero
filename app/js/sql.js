const MY_AMOUNT = `CAST(ROUND(t.amount_cents * (CASE WHEN t.is_shared=1
  THEN COALESCE(t.share_pct_override, p.my_share_pct, 100) ELSE 100 END) / 100.0) AS INTEGER)`;

export const SQL = {
  getOpenPeriod: `SELECT * FROM periods WHERE status='open' AND deleted=0 LIMIT 1`,
  insertPeriod: `INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES (?,?,?,'','open',?,'',?,?,0)`,
  insertTransaction: `INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,counter_account_id,
    category_id,merchant,note,is_shared,share_pct_override,settled,ref_id,rule_id,external_id,status,created_at,updated_at,deleted)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
  spentOfPeriod: `SELECT COALESCE(SUM(CASE
      WHEN t.type='expense' THEN ${MY_AMOUNT}
      WHEN t.type='refund' AND t.ref_id='' THEN -${MY_AMOUNT}
      ELSE 0 END),0) AS spent_cents
    FROM transactions t JOIN periods p ON p.id=t.period_id
    WHERE t.period_id=? AND t.deleted=0`,
  recentForRefund: `SELECT t.id, t.date, t.amount_cents, t.merchant, t.category_id, t.is_shared, t.settled,
      t.share_pct_override, p.my_share_pct AS period_pct
    FROM transactions t JOIN periods p ON p.id=t.period_id
    WHERE t.deleted=0 AND t.type='expense'
      AND (t.period_id=? OR (t.is_shared=1 AND t.settled=0))
    ORDER BY t.date DESC, t.created_at DESC LIMIT 15`,
  incomeOfPeriod: `SELECT COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount_cents ELSE 0 END),0) AS income_cents
    FROM transactions t WHERE t.period_id=? AND t.deleted=0`,
  listByDay: `SELECT t.id, t.date, t.type, t.amount_cents, t.category_id, t.merchant, t.note, t.is_shared,
      ${MY_AMOUNT} AS my_amount_cents
    FROM transactions t JOIN periods p ON p.id=t.period_id
    WHERE t.period_id=? AND t.deleted=0 AND t.type IN ('expense','income','refund')
    ORDER BY t.date DESC, t.created_at DESC`,
  listExpenseLeafCategories: `SELECT c.id, c.name FROM categories c
    WHERE c.flow='expense' AND c.deleted=0 AND c.is_archived=0
      AND NOT EXISTS (SELECT 1 FROM categories h WHERE h.parent_id=c.id AND h.deleted=0)
    ORDER BY c.display_order`,
  listIncomeCategories: `SELECT c.id, c.name FROM categories c
    WHERE c.flow='income' AND c.deleted=0 AND c.is_archived=0 ORDER BY c.display_order`,
  listAccounts: `SELECT id, name, type FROM accounts WHERE deleted=0 AND is_archived=0 ORDER BY display_order`,
  allCategories: `SELECT id, name, parent_id FROM categories WHERE deleted=0`,
  dumpTable: (t) => `SELECT * FROM ${t}`,   // solo para exportAllJson; t viene de la lista fija de tablas

  // my_share_pct se añade sobre el SELECT literal del brief: el detalle de Movimientos lo
  // necesita para mostrar el reparto real (mismo criterio que registro.js), no un 100% fijo.
  listPeriods: `SELECT id, name, start_date, end_date, status, my_share_pct FROM periods WHERE deleted=0 ORDER BY start_date DESC`,
  listAllByDay: `SELECT t.id, t.date, t.type, t.amount_cents, t.category_id, t.merchant, t.note, t.is_shared,
      t.account_id, t.counter_account_id, t.share_pct_override, t.ref_id, t.rule_id, t.status,
      ${MY_AMOUNT} AS my_amount_cents
    FROM transactions t JOIN periods p ON p.id=t.period_id
    WHERE t.period_id=? AND t.deleted=0
    ORDER BY t.date DESC, t.created_at DESC`,
  getTransaction: `SELECT * FROM transactions WHERE id=? AND deleted=0`,
  updateTransaction: `UPDATE transactions SET type=?, amount_cents=?, date=?, category_id=?, account_id=?,
    counter_account_id=?, merchant=?, note=?, is_shared=?, share_pct_override=?, ref_id=?, rule_id=?, status=?,
    updated_at=? WHERE id=?`,
  softDeleteTransaction: `UPDATE transactions SET deleted=1, updated_at=? WHERE id=?`,
  // Al borrar un refund enlazado (ref_id), revierte settled=1 del gasto original SOLO si no queda
  // ningún otro refund activo (no borrado, type='refund') apuntando a él — bind: [refId, refundIdBorrado, now, refId].
  unsettleIfNoActiveRefunds: `UPDATE transactions SET settled = CASE WHEN EXISTS(
      SELECT 1 FROM transactions r WHERE r.ref_id=? AND r.type='refund' AND r.deleted=0 AND r.id<>?
    ) THEN 1 ELSE 0 END, updated_at=? WHERE id=?`,
  countUncategorized: `SELECT COUNT(*) AS n FROM transactions
    WHERE period_id=? AND deleted=0 AND category_id='' AND type IN ('expense','income','refund')`,
  // Gastos compartidos sin liquidar de TODOS los periodos (no solo el abierto): el bloque "Con
  // Sara" y la pantalla Liquidar deben poder saldar algo pendiente de un periodo ya cerrado.
  // type='expense' es necesario: is_shared/settled también existen en income/refund (ver
  // registro.js needsCategory), y solo un gasto genera una deuda pendiente de que Sara devuelva.
  pendingShared: `SELECT t.id, t.date, t.amount_cents, t.merchant, t.category_id,
      t.amount_cents - ${MY_AMOUNT} AS sara_amount_cents
    FROM transactions t JOIN periods p ON p.id=t.period_id
    WHERE t.type='expense' AND t.is_shared=1 AND t.settled=0 AND t.deleted=0
    ORDER BY t.date ASC`,
  pendingSharedTotal: `SELECT COALESCE(SUM(t.amount_cents - ${MY_AMOUNT}),0) AS total_cents
    FROM transactions t JOIN periods p ON p.id=t.period_id
    WHERE t.type='expense' AND t.is_shared=1 AND t.settled=0 AND t.deleted=0`,
};
export const TABLES = ["meta","accounts","categories","periods","transactions","recurring_rules","goals","budgets"];
