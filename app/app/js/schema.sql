CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- quick_register (Registro v2 §4.1): "1" activa el modo «Registro rápido» — ES el default de
-- producto. El INSERT OR IGNORE inserta las filas que no chocan y salta las que ya existen, y
-- corre en CADA arranque (db-worker.js:20): una BD que ya existe recibe la clave en el siguiente
-- arranque, con valor "1", sin necesidad de migración.
-- subscription_ignored/renewal_snoozed (Suscripciones, N6): CONFIG-IN-META igual que
-- account_loans/category_style — sin migración de esquema, repo.js:697. subscription_ignored es
-- un array JSON de comercios normalizados ignorados; renewal_snoozed es un objeto {ruleId: fecha}.
INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version','4'),('currency','EUR'),('created_with','basecero-pwa'),('locale','es-ES'),('import_account_id',''),('default_account_id',''),('partner_name',''),('category_style','{}'),('csv_profile',''),('lang',''),('account_loans','{}'),('quick_register','1'),('subscription_ignored','[]'),('renewal_snoozed','{}');

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('checking','savings','liability')),
  opening_balance_cents INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  parent_id TEXT NOT NULL DEFAULT '',
  flow TEXT NOT NULL CHECK (flow IN ('expense','income')),
  need_type TEXT NOT NULL DEFAULT '' CHECK (need_type IN ('need','want','savings','')),
  display_order INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS periods (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('open','closed')),
  my_share_pct REAL NOT NULL DEFAULT 100,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_period ON periods (status) WHERE status='open' AND deleted=0;

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, date TEXT NOT NULL,
  period_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense','income','transfer','refund','adjustment')),
  amount_cents INTEGER NOT NULL CHECK (type='adjustment' OR amount_cents > 0),
  account_id TEXT NOT NULL,
  counter_account_id TEXT NOT NULL DEFAULT '',
  category_id TEXT NOT NULL DEFAULT '',
  merchant TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  is_shared INTEGER NOT NULL DEFAULT 0,
  share_pct_override REAL,
  paid_by TEXT NOT NULL DEFAULT 'me' CHECK (paid_by IN ('me','partner')),
  settled INTEGER NOT NULL DEFAULT 0,
  ref_id TEXT NOT NULL DEFAULT '', rule_id TEXT NOT NULL DEFAULT '',
  tag_id TEXT NOT NULL DEFAULT '',             -- '' = sin etiqueta (Etiquetas, N11)
  external_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reconciled')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS tx_period ON transactions (period_id, deleted);
CREATE INDEX IF NOT EXISTS tx_date ON transactions (date);
CREATE INDEX IF NOT EXISTS tx_category ON transactions (category_id);
-- ref_id enlaza el apunte de liquidación (refund entrante o adjustment saliente) con su gasto.
-- Lo consultan hasActiveLinkedSettlement, unsettleIfNoActiveSettlements, recentForRefund (el
-- subselect de refunded_cents) y REFUND_REDUCES_SPEND, que corre en CADA suma de gasto.
CREATE INDEX IF NOT EXISTS tx_ref ON transactions (ref_id);
-- tx_tag NO va aquí, a diferencia de tx_ref: ref_id existe desde la v1, así que un CREATE INDEX
-- sobre él en schema.sql siempre encuentra la columna. tag_id es NUEVA en esta misma PR, y
-- schema.sql corre en CADA arranque ANTES que las migraciones (db-worker.js:20): en una BD
-- anterior a esta PR, un CREATE INDEX aquí sobre tag_id reventaría "no such column" antes de que
-- el ALTER de migrations.js tuviera ocasión de correr. Vive como statement incondicional al final
-- de pendingMigrations (migrations.js), después de cualquier ALTER pendiente.

CREATE TABLE IF NOT EXISTS recurring_rules (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense','income','transfer')),
  amount_cents INTEGER NOT NULL,
  category_id TEXT NOT NULL DEFAULT '', account_id TEXT NOT NULL,
  counter_account_id TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','yearly')),
  due_day INTEGER, due_month INTEGER,
  is_shared INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
  -- Suscripciones (N6): is_subscription decide si la regla entra en el radar; cancelled_at es la
  -- FECHA (YYYY-MM-DD) de la baja, NO un timestamp pese al sufijo _at — comparable con hoyISO().
  -- Invariante de dominio: cancelled_at <> '' ⇒ is_active = 0 (repo.js#cancelSubscription/updateRule,
  -- xlsx.js#validateImport).
  is_subscription INTEGER NOT NULL DEFAULT 0, cancelled_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('emergency_fund','savings_target','spending_cap','savings_rate','provision')),
  target_amount_cents INTEGER, target_months INTEGER, target_pct REAL, target_date TEXT NOT NULL DEFAULT '',
  account_id TEXT NOT NULL DEFAULT '', category_id TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY, period_id TEXT NOT NULL, category_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);

-- Etiquetas de proyecto (N11): una dimensión transversal a las categorías («Viaje Japón», «Reforma
-- baño»). Sin flow, sin parent_id, sin color, sin icono — un nombre, un límite opcional y un
-- interruptor de archivado (D3, D14 en etiquetas-design.md). Hoja OPCIONAL en el contrato xlsx
-- (contract.js): la primera tabla nueva desde que el contrato existe.
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  budget_cents INTEGER,                        -- NULL = sin límite (D4 y NULLABLE_NUM en contract.js)
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
