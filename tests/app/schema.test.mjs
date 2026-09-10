import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { seedStatements, SEED_CATEGORIES } from "../../app/app/js/seeds.js";
import { SQL } from "../../app/app/js/sql.js";

const schema = readFileSync(new URL("../../app/app/js/schema.sql", import.meta.url), "utf8");
function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  for (const { sql, rows } of seedStatements("2026-08-24T18:00:00Z"))
    for (const r of rows) db.prepare(sql).run(...r);
  return db;
}

test("esquema aplica y las 9 tablas existen", () => {
  const db = freshDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
  for (const t of ["meta","accounts","categories","periods","transactions","recurring_rules","goals","budgets","tags"])
    assert.ok(tables.includes(t), t);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='schema_version'").get().value, "5");
});

// Foto del ticket (N5, Registro v2 §9.1): la columna es solo una pista de "esta fila tiene foto"
// (el fichero en OPFS es la fuente de verdad, ver attachments.js) — NOT NULL DEFAULT 0 para que un
// INSERT que no la nombre (import de un CSV, barrido, liquidación) no reviente.
test("transactions.has_attachment: existe en una BD nueva con su NOT NULL y su default 0", () => {
  const db = freshDb();
  const col = db.prepare("PRAGMA table_info(transactions)").all().find((c) => c.name === "has_attachment");
  assert.ok(col, "la columna existe en una BD nueva");
  assert.equal(col.notnull, 1);
  assert.equal(col.dflt_value, "0");
});

// D4 (etiquetas-design §5.1): budget_cents es NULLABLE — NULL significa «sin límite». Con
// NOT NULL, una hoja xlsx editada a mano con la celda del límite en blanco (el caso normal)
// reportaría `required` en vez de importar limpia (xlsx.js#validateImport).
test("tags.budget_cents: sin NOT NULL, así que NULL es un valor legítimo (D4)", () => {
  const db = freshDb();
  const col = db.prepare("PRAGMA table_info(tags)").all().find((c) => c.name === "budget_cents");
  assert.ok(col, "la columna existe");
  assert.equal(col.notnull, 0, "budget_cents NO es NOT NULL");
  db.prepare(`INSERT INTO tags (id,name,budget_cents,is_archived,created_at,updated_at,deleted)
    VALUES ('tag-1','Viaje Japón',NULL,0,'t','t',0)`).run();
  assert.equal(db.prepare("SELECT budget_cents FROM tags WHERE id='tag-1'").get().budget_cents, null);
});

// Suscripciones (v3): las dos columnas nuevas de recurring_rules llegan con su default en una BD
// nueva (schema.sql las declara, ver contrato §4.1), y las dos claves de meta llegan sembradas.
test("recurring_rules: is_subscription y cancelled_at existen en una BD nueva con su NOT NULL y su default", () => {
  const db = freshDb();
  const cols = db.prepare("PRAGMA table_info(recurring_rules)").all();
  const isSub = cols.find((c) => c.name === "is_subscription");
  const cancelledAt = cols.find((c) => c.name === "cancelled_at");
  assert.ok(isSub, "is_subscription existe");
  assert.equal(isSub.notnull, 1);
  assert.equal(isSub.dflt_value, "0");
  assert.ok(cancelledAt, "cancelled_at existe");
  assert.equal(cancelledAt.notnull, 1);
  assert.equal(cancelledAt.dflt_value, "''");
});

test("meta: subscription_ignored y renewal_snoozed llegan sembrados y un INSERT OR IGNORE posterior no pisa un valor ya escrito", () => {
  const db = freshDb();
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='subscription_ignored'").get().value, "[]");
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='renewal_snoozed'").get().value, "{}");

  db.prepare("UPDATE meta SET value='[\"netflix\"]' WHERE key='subscription_ignored'").run();
  db.prepare("UPDATE meta SET value='{\"rule-1\":\"2026-09-14\"}' WHERE key='renewal_snoozed'").run();
  db.exec(schema);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='subscription_ignored'").get().value, "[\"netflix\"]");
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='renewal_snoozed'").get().value, "{\"rule-1\":\"2026-09-14\"}");
});

test("semillas: 0 cuentas (las crea el usuario) y 41 categorías con integridad", () => {
  const db = freshDb();
  assert.equal(db.prepare("SELECT COUNT(*) c FROM accounts").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM categories").get().c, 41);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM categories WHERE parent_id<>'' AND parent_id NOT IN (SELECT id FROM categories)").get().c, 0);
});

test("CHECKs de enums y de importes positivos", () => {
  const db = freshDb();
  assert.throws(() => db.prepare(
    "INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,status,created_at,updated_at,deleted) VALUES ('x','2026-08-24','p','trampa',100,'acc-n26','pending','t','t',0)").run());
  assert.throws(() => db.prepare(
    "INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,status,created_at,updated_at,deleted) VALUES ('x','2026-08-24','p','expense',-5,'acc-n26','pending','t','t',0)").run());
});

test("transactions.paid_by: NOT NULL, default me y CHECK me/partner", () => {
  const db = freshDb();
  const col = db.prepare("PRAGMA table_info(transactions)").all().find((c) => c.name === "paid_by");
  assert.ok(col, "la columna existe en una BD nueva");
  assert.equal(col.notnull, 1);
  assert.equal(col.dflt_value, "'me'");

  db.prepare(`INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,status,created_at,updated_at,deleted)
    VALUES ('t-def','2026-08-24','p','expense',100,'acc-n26','pending','t','t',0)`).run();
  assert.equal(db.prepare("SELECT paid_by FROM transactions WHERE id='t-def'").get().paid_by, "me");

  db.prepare(`INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,paid_by,status,created_at,updated_at,deleted)
    VALUES ('t-partner','2026-08-24','p','expense',100,'acc-n26','partner','pending','t','t',0)`).run();
  assert.equal(db.prepare("SELECT paid_by FROM transactions WHERE id='t-partner'").get().paid_by, "partner");

  assert.throws(() => db.prepare(`INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,paid_by,status,created_at,updated_at,deleted)
    VALUES ('t-mala','2026-08-24','p','expense',100,'acc-n26','ambos','pending','t','t',0)`).run(), /CHECK constraint failed/);
});

test("solo un periodo open", () => {
  const db = freshDb();
  const ins = db.prepare("INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,?,?,?,0)");
  ins.run("p1","Agosto","2026-08-01","","open",60,"","t","t");
  assert.throws(() => ins.run("p2","Sept","2026-09-01","","open",60,"","t","t"));
});

test("colores: hoja hereda de la raíz", async () => {
  const { colorForCategory } = await import("../../app/app/js/category-colors.js");
  const byId = Object.fromEntries(SEED_CATEGORIES.map((c) => [c[0], { id: c[0], parent_id: c[2] }]));
  assert.equal(colorForCategory("cat-casa-luz", byId), colorForCategory("cat-casa", byId));
  assert.match(colorForCategory("cat-casa", byId), /^#[0-9a-f]{6}$/i);
});

test("meta: semillas incluyen locale es-ES y currency EUR", () => {
  const db = freshDb();
  const meta = Object.fromEntries(db.prepare(SQL.allMeta).all().map((r) => [r.key, r.value]));
  assert.equal(meta.locale, "es-ES");
  assert.equal(meta.currency, "EUR");
});

// Registro v2 §4.1: una BD nueva trae el modo «Registro rápido» activado por defecto. El
// INSERT OR IGNORE corre en cada arranque (db-worker.js:20), así que esto también alcanza a las
// BD que ya existen: en el siguiente arranque reciben la clave con valor "1" sin migración.
test("meta: semillas incluyen quick_register a \"1\" (Registro rápido activado por defecto)", () => {
  const db = freshDb();
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='quick_register'").get().value, "1");
});

test("meta: las claves de cuenta entran vacías con INSERT OR IGNORE", () => {
  const db = freshDb();
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='import_account_id'").get().value, "");
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='default_account_id'").get().value, "");
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='partner_name'").get().value, "");
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='category_style'").get().value, "{}");
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='csv_profile'").get().value, "");
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='lang'").get().value, "");
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='account_loans'").get().value, "{}");
  // re-ejecutar el esquema NO pisa un valor ya configurado
  db.prepare("UPDATE meta SET value='acc-x' WHERE key='import_account_id'").run();
  db.exec(schema);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='import_account_id'").get().value, "acc-x");
  db.prepare("UPDATE meta SET value='MARTA G.' WHERE key='partner_name'").run();
  db.exec(schema);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='partner_name'").get().value, "MARTA G.");
  db.prepare("UPDATE meta SET value='{\"cat-x\":{\"color\":\"#6BCB3E\"}}' WHERE key='category_style'").run();
  db.exec(schema);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='category_style'").get().value, "{\"cat-x\":{\"color\":\"#6BCB3E\"}}");
  db.prepare("UPDATE meta SET value='{\"headers\":[]}' WHERE key='csv_profile'").run();
  db.exec(schema);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='csv_profile'").get().value, "{\"headers\":[]}");
  db.prepare("UPDATE meta SET value='en' WHERE key='lang'").run();
  db.exec(schema);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='lang'").get().value, "en");
  db.prepare("UPDATE meta SET value='{\"acc-x\":{\"monthlyCents\":18900}}' WHERE key='account_loans'").run();
  db.exec(schema);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='account_loans'").get().value, "{\"acc-x\":{\"monthlyCents\":18900}}");
});

test("índice tx_ref sobre transactions(ref_id): existe en una BD nueva y re-aplicar el esquema no rompe una BD con datos", () => {
  const db = freshDb();
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='transactions' ORDER BY name")
    .all().map((r) => r.name);
  assert.ok(idx.includes("tx_ref"), `índices de transactions: ${idx.join(", ")}`);

  // db-worker.js#init ejecuta schema.sql EN CADA ARRANQUE, también sobre una base que ya existe:
  // el IF NOT EXISTS tiene que dejarla intacta, con sus filas y sin lanzar.
  db.prepare(`INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,ref_id,status,created_at,updated_at,deleted)
    VALUES ('t-idx','2026-08-24','p','refund',100,'acc-n26','t-gasto','pending','t','t',0)`).run();
  assert.doesNotThrow(() => db.exec(schema));
  assert.equal(db.prepare("SELECT COUNT(*) c FROM transactions").get().c, 1);
  assert.equal(db.prepare("SELECT ref_id FROM transactions WHERE id='t-idx'").get().ref_id, "t-gasto");
});
