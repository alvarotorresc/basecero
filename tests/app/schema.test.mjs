import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { seedStatements, SEED_ACCOUNTS, SEED_CATEGORIES } from "../../app/js/seeds.js";

const schema = readFileSync(new URL("../../app/js/schema.sql", import.meta.url), "utf8");
function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  for (const { sql, rows } of seedStatements("2026-08-24T18:00:00Z"))
    for (const r of rows) db.prepare(sql).run(...r);
  return db;
}

test("esquema aplica y las 8 tablas existen", () => {
  const db = freshDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
  for (const t of ["meta","accounts","categories","periods","transactions","recurring_rules","goals","budgets"])
    assert.ok(tables.includes(t), t);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='schema_version'").get().value, "1");
});

test("semillas: 4 cuentas y 41 categorías con integridad", () => {
  const db = freshDb();
  assert.equal(db.prepare("SELECT COUNT(*) c FROM accounts").get().c, 4);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM categories").get().c, 41);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM categories WHERE parent_id<>'' AND parent_id NOT IN (SELECT id FROM categories)").get().c, 0);
  assert.equal(db.prepare("SELECT name FROM accounts WHERE id='acc-n26'").get().name, "N26");
});

test("CHECKs de enums y de importes positivos", () => {
  const db = freshDb();
  assert.throws(() => db.prepare(
    "INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,status,created_at,updated_at,deleted) VALUES ('x','2026-08-24','p','trampa',100,'acc-n26','pending','t','t',0)").run());
  assert.throws(() => db.prepare(
    "INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,status,created_at,updated_at,deleted) VALUES ('x','2026-08-24','p','expense',-5,'acc-n26','pending','t','t',0)").run());
});

test("solo un periodo open", () => {
  const db = freshDb();
  const ins = db.prepare("INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,?,?,?,0)");
  ins.run("p1","Agosto","2026-08-01","","open",60,"","t","t");
  assert.throws(() => ins.run("p2","Sept","2026-09-01","","open",60,"","t","t"));
});

test("colores: hoja hereda de la raíz", async () => {
  const { colorForCategory } = await import("../../app/js/category-colors.js");
  const byId = Object.fromEntries(SEED_CATEGORIES.map((c) => [c[0], { id: c[0], parent_id: c[2] }]));
  assert.equal(colorForCategory("cat-casa-luz", byId), colorForCategory("cat-casa", byId));
  assert.match(colorForCategory("cat-casa", byId), /^#[0-9a-f]{6}$/i);
});
