CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version','2'),('currency','EUR'),('created_with','basecero-pwa'),('locale','es-ES'),('import_account_id',''),('default_account_id',''),('partner_name',''),('category_style','{}'),('csv_profile',''),('lang',''),('account_loans','{}');

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

CREATE TABLE IF NOT EXISTS recurring_rules (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense','income','transfer')),
  amount_cents INTEGER NOT NULL,
  category_id TEXT NOT NULL DEFAULT '', account_id TEXT NOT NULL,
  counter_account_id TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','yearly')),
  due_day INTEGER, due_month INTEGER,
  is_shared INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
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
