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
  // t.amount_cents - MY_AMOUNT > 0 excluye repartos 100/0 (pct o override): con sara_amount_cents=0
  // no hay nada que liquidar, y dejar la fila entrar rompería el CHECK amount_cents>0 del refund
  // en settleShared (ver fix report en task-7-report.md).
  pendingShared: `SELECT t.id, t.date, t.amount_cents, t.merchant, t.category_id,
      t.amount_cents - ${MY_AMOUNT} AS sara_amount_cents
    FROM transactions t JOIN periods p ON p.id=t.period_id
    WHERE t.type='expense' AND t.is_shared=1 AND t.settled=0 AND t.deleted=0
      AND t.amount_cents - ${MY_AMOUNT} > 0
    ORDER BY t.date ASC`,
  pendingSharedTotal: `SELECT COALESCE(SUM(t.amount_cents - ${MY_AMOUNT}),0) AS total_cents
    FROM transactions t JOIN periods p ON p.id=t.period_id
    WHERE t.type='expense' AND t.is_shared=1 AND t.settled=0 AND t.deleted=0
      AND t.amount_cents - ${MY_AMOUNT} > 0`,

  closePeriod: `UPDATE periods SET end_date=?, status='closed', updated_at=? WHERE id=?`,
  // Suma por categoría RAÍZ de gasto (parent_id='') el gasto de toda su subárbol (ella misma +
  // hijas directas): child.id=root.id cubre el gasto registrado directamente en la raíz, y
  // child.parent_id=root.id el de sus hijas. Resta refunds sueltos (ref_id='') prorrateados,
  // igual criterio que spentOfPeriod. La reutilizan Tasks 9 (Presupuesto) y 12 (gráficas).
  spentByRootCategory: `SELECT root.id AS root_id, root.name,
    COALESCE(SUM(CASE WHEN t.type='expense' THEN ${MY_AMOUNT}
                 WHEN t.type='refund' AND t.ref_id='' THEN -${MY_AMOUNT} ELSE 0 END),0) AS spent_cents
  FROM categories root
  LEFT JOIN categories child ON (child.id=root.id OR child.parent_id=root.id) AND child.deleted=0
  LEFT JOIN transactions t ON t.category_id=child.id AND t.period_id=? AND t.deleted=0
  LEFT JOIN periods p ON p.id=t.period_id
  WHERE root.parent_id='' AND root.flow='expense' AND root.deleted=0 AND root.is_archived=0
  GROUP BY root.id ORDER BY spent_cents DESC`,
  insertBudget: `INSERT INTO budgets (id,period_id,category_id,amount_cents,created_at,updated_at,deleted)
    VALUES (?,?,?,?,?,?,0)`,
  budgetsOfPeriod: `SELECT b.id, b.category_id, b.amount_cents FROM budgets b WHERE b.period_id=? AND b.deleted=0`,

  // Gasto por día en un rango (Task 12, tarjeta "Flujo de gasto" de Inicio). Mismo criterio que
  // spentOfPeriod (MY_AMOUNT de expenses, refunds sueltos restan prorrateados), agrupado por
  // fecha. Solo trae los días con movimiento — repo.spentLast7Days rellena los que faltan con 0
  // en JS (fillLast7Days). Bind: [periodId, startDateIso, endDateIso].
  spentByDay: `SELECT t.date AS date,
    COALESCE(SUM(CASE WHEN t.type='expense' THEN ${MY_AMOUNT}
                 WHEN t.type='refund' AND t.ref_id='' THEN -${MY_AMOUNT} ELSE 0 END),0) AS cents
  FROM transactions t JOIN periods p ON p.id=t.period_id
  WHERE t.period_id=? AND t.deleted=0 AND t.date BETWEEN ? AND ?
  GROUP BY t.date`,

  // Reglas recurrentes (Task 10). Activas primero, luego alfabético — mismo criterio que la
  // lista de Recurrentes (las inactivas se apilan al final con su badge gris).
  listRules: `SELECT * FROM recurring_rules WHERE deleted=0 ORDER BY is_active DESC, name`,
  getRule: `SELECT * FROM recurring_rules WHERE id=? AND deleted=0`,
  insertRule: `INSERT INTO recurring_rules (id,name,type,amount_cents,category_id,account_id,counter_account_id,
    frequency,due_day,due_month,is_shared,is_active,created_at,updated_at,deleted)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
  updateRule: `UPDATE recurring_rules SET name=?, type=?, amount_cents=?, category_id=?, account_id=?,
    counter_account_id=?, frequency=?, due_day=?, due_month=?, is_shared=?, is_active=?, updated_at=?
    WHERE id=?`,
  softDeleteRule: `UPDATE recurring_rules SET deleted=1, updated_at=? WHERE id=?`,

  // Previsión (Task 11). Una regla se da por pagada este periodo si hay una transacción
  // ligada por rule_id, O (fallback del dashboard, para movimientos metidos a mano sin
  // enlazar la regla) una con la MISMA categoría y el MISMO importe (sin prorratear).
  paidRuleIds: `SELECT DISTINCT rule_id FROM transactions WHERE period_id=? AND deleted=0 AND rule_id<>''`,
  paidByCatAmount: `SELECT DISTINCT category_id || '|' || amount_cents AS k FROM transactions WHERE period_id=? AND deleted=0`,
  // Saldo de una cuenta a una fecha dada: opening_balance_cents + movimientos hasta esa fecha
  // (inclusive). SQL VERBATIM del brief de Task 11 — la reutilizan Tasks 13/14, no tocar sin
  // revisar esas tareas. Bind: [atDateIso, accountId].
  accountBalance: `SELECT a.opening_balance_cents + COALESCE((SELECT SUM(CASE
      WHEN t.type IN ('expense','transfer') AND t.account_id=a.id THEN -t.amount_cents
      WHEN t.type='transfer' AND t.counter_account_id=a.id THEN t.amount_cents
      WHEN t.type IN ('income','refund') AND t.account_id=a.id THEN t.amount_cents
      WHEN t.type='adjustment' AND t.account_id=a.id THEN t.amount_cents
      ELSE 0 END) FROM transactions t
    WHERE t.deleted=0 AND (t.account_id=a.id OR t.counter_account_id=a.id) AND t.date<=?),0) AS balance_cents
  FROM accounts a WHERE a.id=?`,
};
export const TABLES = ["meta","accounts","categories","periods","transactions","recurring_rules","goals","budgets"];
