import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const X = require("../../app/app/vendor/xlsx/xlsx.full.min.js");

const T = "2026-08-01T00:00:00Z";
export function openDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../../app/app/js/schema.sql", import.meta.url), "utf8"));
  return db;
}
export function seedMinimal(db) {
  const ins = (sql, ...p) => db.prepare(sql).run(...p);
  ins(`INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
       VALUES ('per-1','Agosto 2026','2026-07-27','','open',60,'',?,?,0)`, T, T);
  ins(`INSERT INTO accounts (id,name,type,opening_balance_cents,display_order,is_archived,created_at,updated_at,deleted)
       VALUES ('acc-n26','N26','checking',100000,1,0,?,?,0)`, T, T);
  ins(`INSERT INTO accounts (id,name,type,opening_balance_cents,display_order,is_archived,created_at,updated_at,deleted)
       VALUES ('acc-revolut','Revolut','savings',50000,2,0,?,?,0)`, T, T);
  ins(`INSERT INTO accounts (id,name,type,opening_balance_cents,display_order,is_archived,created_at,updated_at,deleted)
       VALUES ('acc-prestamo','Préstamo coche','liability',-600000,4,0,?,?,0)`, T, T);
  ins(`INSERT INTO categories (id,name,parent_id,flow,need_type,display_order,is_archived,created_at,updated_at,deleted)
       VALUES ('cat-casa','Casa','','expense','need',1,0,?,?,0)`, T, T);
  ins(`INSERT INTO categories (id,name,parent_id,flow,need_type,display_order,is_archived,created_at,updated_at,deleted)
       VALUES ('cat-casa-alquiler','Alquiler/Hipoteca','cat-casa','expense','need',1,0,?,?,0)`, T, T);
  ins(`INSERT INTO categories (id,name,parent_id,flow,need_type,display_order,is_archived,created_at,updated_at,deleted)
       VALUES ('cat-nomina','Nómina','','income','',1,0,?,?,0)`, T, T);
}
export const dumpAll = (db) => {
  const out = {};
  for (const t of ["meta","accounts","categories","periods","transactions","recurring_rules","goals","budgets","tags"])
    out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return out;
};

/** DDL de `transactions` ANTERIOR a esta PR: idéntico al de app/app/js/schema.sql pero SIN la
 *  columna paid_by. Se escribe entero a mano —no recortando el texto de schema.sql con un
 *  .replace(), que se convierte en un no-op silencioso en cuanto alguien reindenta el fichero—
 *  porque es la única forma de tener en Node la BD "de un usuario real" (OPFS, creada con la
 *  versión anterior) que el runner de migrations.js tiene que migrar. */
export const OLD_TRANSACTIONS_DDL = `CREATE TABLE transactions (
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
  settled INTEGER NOT NULL DEFAULT 0,
  ref_id TEXT NOT NULL DEFAULT '', rule_id TEXT NOT NULL DEFAULT '',
  external_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reconciled')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`;

/** DDL de `recurring_rules` ANTERIOR a esta PR (Suscripciones): idéntico al de
 *  app/app/js/schema.sql pero SIN `is_subscription`/`cancelled_at`. Mismo motivo que
 *  OLD_TRANSACTIONS_DDL: escrito entero a mano, no recortado de schema.sql con un `.replace()`
 *  (que se vuelve un no-op silencioso en cuanto alguien reindenta el fichero) — es la única forma
 *  de tener en Node la BD "de antes de esta PR" que migrations.js tiene que migrar. */
export const V2_RULES_DDL = `CREATE TABLE recurring_rules (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense','income','transfer')),
  amount_cents INTEGER NOT NULL,
  category_id TEXT NOT NULL DEFAULT '', account_id TEXT NOT NULL,
  counter_account_id TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','yearly')),
  due_day INTEGER, due_month INTEGER,
  is_shared INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`;

/** DDL de `transactions` tal como lo deja `feat/informe-y-cierre` (v3): CON `paid_by` pero SIN
 *  `tag_id` — el estado real de una BD ya migrada a v2/v3 que todavía no ha visto esta PR. Mismo
 *  motivo que OLD_TRANSACTIONS_DDL: escrito entero a mano, no recortado de schema.sql con un
 *  `.replace()` (que se vuelve un no-op silencioso en cuanto alguien reindenta el fichero). */
export const V3_TRANSACTIONS_DDL = `CREATE TABLE transactions (
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
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`;

/** DDL de `transactions` tal como lo deja `feat/etiquetas-y-comparativa` (v4): CON `paid_by` y
 *  `tag_id` pero SIN `has_attachment` — el estado real de una BD ya migrada a v4 que todavía no
 *  ha visto esta PR (Registro v2, foto del ticket). Mismo motivo que los tres DDL de arriba:
 *  escrito entero a mano, no recortado de schema.sql con un `.replace()` (que se vuelve un no-op
 *  silencioso en cuanto alguien reindenta el fichero). */
export const V4_TRANSACTIONS_DDL = `CREATE TABLE transactions (
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
  tag_id TEXT NOT NULL DEFAULT '',
  external_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reconciled')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`;
