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
  // PR D (categorías editables), Task 4 fix round: el NOT EXISTS comprobaba h.deleted=0 pero NO
  // h.is_archived — una raíz con su única hija archivada (no borrada) seguía "teniendo hijas"
  // para esta query y desaparecía del selector junto a ella. Con AND h.is_archived=0, una hija
  // archivada deja de contar: la raíz vuelve a ser hoja efectiva y reaparece (ver
  // tests/app/categorias.test.mjs, test de regresión).
  // Item 5 (Important, review final): el ORDER BY ya no es solo c.display_order — ese es el
  // display_order DENTRO del grupo (raíces entre sí, hijas de una misma raíz entre sí), así que
  // tras reordenar hijas de una raíz, sus posiciones (1..n) podían intercalarse con las de OTRA
  // raíz que casualmente compartiera los mismos números, descolocando el selector de Registro. El
  // COALESCE ordena primero por el display_order de la RAÍZ de cada hoja (su propio display_order
  // si ya es raíz, como en listIncomeCategories), agrupando las hojas por la posición de su árbol;
  // c.parent_id de tiebreak dentro de esa raíz pone a la raíz ('' ordena antes que cualquier id)
  // justo antes de sus hijas en listIncomeCategories (que no filtra por hoja, incluye raíces e
  // hijas mezcladas); c.display_order final decide el orden dentro de ese mismo grupo.
  listExpenseLeafCategories: `SELECT c.id, c.name FROM categories c
    WHERE c.flow='expense' AND c.deleted=0 AND c.is_archived=0
      AND NOT EXISTS (SELECT 1 FROM categories h WHERE h.parent_id=c.id AND h.deleted=0 AND h.is_archived=0)
    ORDER BY COALESCE((SELECT p.display_order FROM categories p WHERE p.id=c.parent_id AND p.deleted=0), c.display_order), c.parent_id, c.display_order`,
  listIncomeCategories: `SELECT c.id, c.name FROM categories c
    WHERE c.flow='income' AND c.deleted=0 AND c.is_archived=0
    ORDER BY COALESCE((SELECT p.display_order FROM categories p WHERE p.id=c.parent_id AND p.deleted=0), c.display_order), c.parent_id, c.display_order`,
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
  // Task 17 ronda 2 (controller ruling, finding A): ¿tiene `txId` algún refund activo (no
  // borrado) que lo enlace por ref_id? Guarda tanto la UI (bloquea importe/compartido en
  // Movimientos) como updateTransaction (rechaza el cambio aunque alguien salte la UI).
  hasActiveLinkedRefund: `SELECT 1 FROM transactions r
    WHERE r.ref_id=? AND r.type='refund' AND r.deleted=0 LIMIT 1`,
  countUncategorized: `SELECT COUNT(*) AS n FROM transactions
    WHERE period_id=? AND deleted=0 AND category_id='' AND type IN ('expense','income','refund')`,
  // Gastos compartidos sin liquidar de TODOS los periodos (no solo el abierto): el bloque de
  // compartidos y la pantalla Liquidar deben poder saldar algo pendiente de un periodo ya cerrado.
  // type='expense' es necesario: is_shared/settled también existen en income/refund (ver
  // registro.js needsCategory), y solo un gasto genera una deuda pendiente de que la contraparte devuelva.
  // t.amount_cents - MY_AMOUNT > 0 excluye repartos 100/0 (pct o override): con partner_amount_cents=0
  // no hay nada que liquidar, y dejar la fila entrar rompería el CHECK amount_cents>0 del refund
  // que settleShared crea con ese partner_amount_cents como su amount_cents.
  pendingShared: `SELECT t.id, t.date, t.amount_cents, t.merchant, t.category_id,
      t.amount_cents - ${MY_AMOUNT} AS partner_amount_cents
    FROM transactions t JOIN periods p ON p.id=t.period_id
    WHERE t.type='expense' AND t.is_shared=1 AND t.settled=0 AND t.deleted=0
      AND t.amount_cents - ${MY_AMOUNT} > 0
    ORDER BY t.date ASC`,
  pendingSharedTotal: `SELECT COALESCE(SUM(t.amount_cents - ${MY_AMOUNT}),0) AS total_cents
    FROM transactions t JOIN periods p ON p.id=t.period_id
    WHERE t.type='expense' AND t.is_shared=1 AND t.settled=0 AND t.deleted=0
      AND t.amount_cents - ${MY_AMOUNT} > 0`,

  // PR C (contraparte), Task 5: ¿existe alguna transacción o regla con is_shared=1, de
  // cualquier tipo? Detecta el caso "BD con compartidos de antes de la contraparte configurable"
  // para el banner de migración de una sola vez de Inicio (repo.hasSharedData) — a diferencia de
  // pendingShared, aquí no importa el type ni si está settled: solo si alguna vez se marcó algo
  // como compartido.
  hasSharedTx: `SELECT 1 FROM transactions WHERE is_shared=1 AND deleted=0 LIMIT 1`,
  hasSharedRule: `SELECT 1 FROM recurring_rules WHERE is_shared=1 AND deleted=0 LIMIT 1`,

  closePeriod: `UPDATE periods SET end_date=?, status='closed', updated_at=? WHERE id=?`,
  // Cambia el reparto por defecto del periodo (Ajustes). Solo afecta a los gastos cuyo
  // share_pct_override sea NULL (los guardados por la UI actual llevan siempre override explícito).
  updatePeriodShare: `UPDATE periods SET my_share_pct=?, updated_at=? WHERE id=? AND deleted=0`,
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

  // Patrimonio (Task 13). listAllAccounts es a propósito el mismo shape que listAccounts (no
  // filtra type, incluye el pasivo): un nombre propio para el caso de uso de Patrimonio, que
  // SIEMPRE quiere las 3 cuentas (no solo las de "elige cuenta" de un formulario).
  listAllAccounts: `SELECT id, name, type FROM accounts WHERE deleted=0 AND is_archived=0 ORDER BY display_order`,
  listClosedPeriods: `SELECT * FROM periods WHERE status='closed' AND deleted=0 ORDER BY start_date`,
  listGoals: `SELECT * FROM goals WHERE is_active=1 AND deleted=0 ORDER BY created_at`,

  // Formularios de cuentas y objetivos (Task 14).
  // Selector de categoría de spending_cap: SOLO raíces de gasto (parent_id=''), nunca hijas —
  // ver handoff de goalProgress (repo.js): una hija ahí no hace match con spentByRootCategory
  // y se queda silenciosamente en 0%.
  listExpenseRootCategories: `SELECT id, name FROM categories c
    WHERE c.flow='expense' AND c.parent_id='' AND c.deleted=0 AND c.is_archived=0 ORDER BY c.display_order`,
  getAccount: `SELECT * FROM accounts WHERE id=? AND deleted=0`,
  // display_order = MAX actual + 1 en la MISMA sentencia (SELECT en vez de VALUES): así una
  // cuenta nueva (manual o hucha automática de un goal) siempre se coloca al final de la lista
  // sin que repo.js tenga que hacer una query aparte para calcularlo.
  insertAccount: `INSERT INTO accounts (id,name,type,opening_balance_cents,display_order,is_archived,created_at,updated_at,deleted)
    SELECT ?,?,?,?, COALESCE(MAX(display_order),0)+1, 0, ?,?,0 FROM accounts WHERE deleted=0`,
  updateAccount: `UPDATE accounts SET name=?, type=?, opening_balance_cents=?, updated_at=? WHERE id=?`,
  getGoal: `SELECT * FROM goals WHERE id=? AND deleted=0`,
  insertGoal: `INSERT INTO goals (id,name,type,target_amount_cents,target_months,target_pct,target_date,account_id,category_id,is_active,created_at,updated_at,deleted)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`,
  updateGoal: `UPDATE goals SET name=?, type=?, target_amount_cents=?, target_months=?, target_pct=?,
    target_date=?, account_id=?, category_id=?, is_active=?, updated_at=? WHERE id=?`,
  softDeleteGoal: `UPDATE goals SET deleted=1, updated_at=? WHERE id=?`,

  // Import CSV (Task 15, generalizada en PR B): trae las transacciones NO borradas de la
  // cuenta de import (meta.import_account_id resuelta por repo.importAccountId) para que
  // n26.js las re-firme en memoria (bcDecideImportAction espera amountCents CON signo,
  // aquí siempre viene positivo por el CHECK de la tabla) sin una query por fila del CSV.
  // reconcileTx SOLO toca external_id/status/updated_at — nunca amount/date/category/merchant,
  // así una fila manual conciliada conserva su categoría y comercio tal cual los metió el usuario.
  n26Existing: `SELECT id, date, type, amount_cents, external_id, status FROM transactions
    WHERE account_id=? AND deleted=0`,
  reconcileTx: `UPDATE transactions SET external_id=?, status='reconciled', updated_at=? WHERE id=?`,
  upsertMeta: `INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  allMeta: `SELECT key, value FROM meta`,

  // ---- Categorías editables (PR D, Task 4) -----------------------------------

  // Pantalla de administración: TODAS (incl. archivadas — el admin necesita poder reactivarlas),
  // con el conteo de hijas ACTIVAS de cada una (lo usa el guard "máx 2 niveles" de updateCategory:
  // una categoría con children>0 no puede convertirse en hija de otra). Orden por
  // (flow, parent_id, display_order) — no solo display_order a secas (literal del brief): así
  // cada raíz queda agrupada con sus propias hijas (parent_id='' ordena antes que cualquier id
  // no vacío), con display_order decidiendo el orden dentro de cada grupo — el mismo grupo que
  // usa insertCategory para calcular el +1.
  listCategoriesAdmin: `SELECT c.*,
      (SELECT COUNT(*) FROM categories h WHERE h.parent_id=c.id AND h.deleted=0 AND h.is_archived=0) AS children
    FROM categories c WHERE c.deleted=0 ORDER BY c.flow, c.parent_id, c.display_order`,
  // No estaba en la lista de "SQL nuevos" del brief, pero updateCategory la necesita para el
  // merge-on-current (mismo patrón que getAccount/getRule/getGoal) y para leer el flow real de
  // la categoría que se edita (el guard de padre compara contra ESE flow, nunca el que mande el
  // caller: flow es inmutable).
  getCategory: `SELECT * FROM categories WHERE id=? AND deleted=0`,
  // display_order = MAX del grupo (flow, parent_id) + 1 en la MISMA sentencia — mismo patrón que
  // insertAccount: un agregado SIN GROUP BY sobre el subconjunto ya filtrado por WHERE colapsa
  // siempre a una fila (incluso con 0 filas, COALESCE cubre el NULL de MAX de una tabla vacía).
  insertCategory: `INSERT INTO categories (id,name,parent_id,flow,need_type,display_order,is_archived,created_at,updated_at,deleted)
    SELECT ?,?,?,?,?, COALESCE(MAX(display_order),0)+1, 0, ?,?,0
    FROM categories WHERE flow=? AND parent_id=? AND deleted=0`,
  // flow NO está en el SET a propósito: es inmutable tras crear la categoría. repo.updateCategory
  // ya rechaza la clave antes de llegar aquí, pero la propia SQL es la última línea de defensa —
  // aunque alguien se saltara el guard del repo, no hay forma de tocar flow con esta sentencia.
  updateCategory: `UPDATE categories SET name=?, need_type=?, parent_id=?, updated_at=? WHERE id=?`,
  setCategoryArchived: `UPDATE categories SET is_archived=?, updated_at=? WHERE id=?`,
  updateCategoryOrder: `UPDATE categories SET display_order=?, updated_at=? WHERE id=?`,
  // Hijas ACTIVAS de una categoría: archiveCategory las recorre para archivarlas en cascada (una
  // SQL.setCategoryArchived por cada una, en el MISMO execMany que la de la propia raíz).
  childrenOf: `SELECT id FROM categories WHERE parent_id=? AND deleted=0 AND is_archived=0`,
  // ¿Tiene `id` alguna hija ACTIVA? Ya NO la usa el guard de updateCategory (ver hasChildren) —
  // se conserva porque el label de cascada de archivar SÍ es active-only a propósito (archiveCategory
  // solo archiva en cascada las hijas activas, ver childrenOf) y porque tests/app/categorias.test.mjs
  // la ejerce directamente. Mismo patrón que hasActiveLinkedRefund (SELECT 1 ... LIMIT 1, solo
  // interesa la existencia).
  hasActiveChildren: `SELECT 1 FROM categories WHERE parent_id=? AND deleted=0 AND is_archived=0 LIMIT 1`,
  // Item 3 (Important, review final): ¿tiene `id` alguna hija, ACTIVA o ARCHIVADA? Guard real de
  // "máx 2 niveles" de updateCategory: hasActiveChildren (arriba) dejaba demotar una raíz cuya
  // ÚNICA hija estaba archivada (activeChildren=0) — la hija archivada seguía apuntando, vía
  // parent_id, a una categoría que dejaba de ser raíz, dejando un árbol de 3 niveles (huérfana en
  // los hechos, aunque nunca se borra la fila). Sin filtro is_archived: cuenta cualquier hija.
  hasChildren: `SELECT 1 FROM categories WHERE parent_id=? AND deleted=0 LIMIT 1`,

  // i18n (PR i18n, Task 6; fix round 1 la hizo idempotente/basada en estado): retraduce el
  // nombre de UNA categoría semilla. `AND name = ?` es el guard — solo toca la fila si su nombre
  // actual es EXACTAMENTE ese. repo.retranslateSeedNames liga ese bind al nombre semilla del
  // OTRO idioma soportado (no al idioma "anterior"): así una fila ya en el idioma destino, o una
  // renombrada por el usuario ("Mi casa"), no matchean nada (0 filas, no-op). Bind:
  // [nombreNuevo, now, id, nombreSemillaDelOtroIdioma].
  retranslateCategory: `UPDATE categories SET name = ?, updated_at = ? WHERE id = ? AND name = ? AND deleted = 0`,
};
export const TABLES = ["meta","accounts","categories","periods","transactions","recurring_rules","goals","budgets"];
