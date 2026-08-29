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
  for (const t of ["meta","accounts","categories","periods","transactions","recurring_rules","goals","budgets"])
    out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return out;
};
