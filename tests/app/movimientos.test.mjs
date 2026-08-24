import { test } from "node:test";
import assert from "node:assert/strict";
import { SQL } from "../../app/js/sql.js";
import { openDb, seedMinimal } from "./helpers.mjs";

const T = "2026-08-24T18:00:00Z";
const T2 = "2026-08-24T19:00:00Z";

/** Inserta una transacción usando la firma NUEVA (19 posicionales) de SQL.insertTransaction. */
function ins(db, over = {}) {
  const v = {
    id: "t" + Math.floor(Math.random() * 1e9),
    date: "2026-08-20", period: "per-1", type: "expense", cents: 4520,
    account: "acc-n26", counterAccount: "", category: "cat-casa-alquiler",
    merchant: "", note: "", shared: 0, override: null, settled: 0,
    ref: "", rule: "", external: "", status: "pending",
    ...over,
  };
  db.prepare(SQL.insertTransaction).run(
    v.id, v.date, v.period, v.type, v.cents, v.account, v.counterAccount,
    v.category, v.merchant, v.note, v.shared, v.override, v.settled,
    v.ref, v.rule, v.external, v.status, T, T,
  );
  return v.id;
}

test("listPeriods: ordena por start_date desc y excluye borrados", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(`INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES ('per-closed','Julio 2026','2026-06-27','2026-07-27','closed',70,'',?,?,0)`).run(T, T);
  db.prepare(`INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES ('per-deleted','Borrado','2026-09-01','','open',60,'',?,?,1)`).run(T, T);
  const rows = db.prepare(SQL.listPeriods).all();
  assert.deepEqual(rows.map((r) => r.id), ["per-1", "per-closed"]);
});

test("listAllByDay: incluye los 5 tipos, orden desc, excluye borrados", () => {
  const db = openDb();
  seedMinimal(db);
  ins(db, { date: "2026-08-19", type: "expense", cents: 1000 });
  ins(db, { date: "2026-08-20", type: "income", cents: 2000, category: "cat-nomina" });
  ins(db, { date: "2026-08-20", type: "transfer", cents: 3000, account: "acc-n26", counterAccount: "acc-revolut", category: "" });
  ins(db, { date: "2026-08-21", type: "refund", cents: 500 });
  const borrado = ins(db, { date: "2026-08-22", type: "adjustment", cents: -400, category: "" });
  db.prepare("UPDATE transactions SET deleted=1 WHERE id=?").run(borrado);
  const rows = db.prepare(SQL.listAllByDay).all("per-1");
  assert.deepEqual(rows.map((r) => r.type), ["refund", "income", "transfer", "expense"]);
  assert.equal(rows.every((r) => r.id !== borrado), true);
});

test("getTransaction: devuelve la fila completa por id", () => {
  const db = openDb();
  seedMinimal(db);
  const id = ins(db, { merchant: "Mercadona", cents: 3200 });
  const row = db.prepare(SQL.getTransaction).get(id);
  assert.equal(row.merchant, "Mercadona");
  assert.equal(row.amount_cents, 3200);
});

test("updateTransaction: cambia los campos editables y updated_at, nunca created_at", () => {
  const db = openDb();
  seedMinimal(db);
  const id = ins(db, { merchant: "Original", cents: 1000, category: "cat-casa-alquiler" });
  const before = db.prepare("SELECT * FROM transactions WHERE id=?").get(id);

  db.prepare(SQL.updateTransaction).run(
    "expense", 2500, "2026-08-21", "cat-casa-alquiler", "acc-n26", "",
    "Actualizado", "nota nueva", 1, 50, "", "", "pending", T2, id,
  );

  const after = db.prepare("SELECT * FROM transactions WHERE id=?").get(id);
  assert.equal(after.merchant, "Actualizado");
  assert.equal(after.amount_cents, 2500);
  assert.equal(after.date, "2026-08-21");
  assert.equal(after.note, "nota nueva");
  assert.equal(after.is_shared, 1);
  assert.equal(after.share_pct_override, 50);
  assert.equal(after.updated_at, T2);
  assert.equal(after.created_at, before.created_at);
  assert.notEqual(after.updated_at, before.updated_at);
});

test("softDeleteTransaction: excluye la fila de listAllByDay y de spentOfPeriod", () => {
  const db = openDb();
  seedMinimal(db);
  const permanece = ins(db, { cents: 1000 });
  const borrar = ins(db, { cents: 5000 });

  db.prepare(SQL.softDeleteTransaction).run(T2, borrar);

  const row = db.prepare("SELECT deleted, updated_at FROM transactions WHERE id=?").get(borrar);
  assert.equal(row.deleted, 1);
  assert.equal(row.updated_at, T2);

  const rows = db.prepare(SQL.listAllByDay).all("per-1");
  assert.deepEqual(rows.map((r) => r.id), [permanece]);

  assert.equal(db.prepare(SQL.spentOfPeriod).get("per-1").spent_cents, 1000);
});

test("countUncategorized: cuenta solo expense/income/refund sin categoría y no borradas", () => {
  const db = openDb();
  seedMinimal(db);
  ins(db, { type: "expense", category: "" });                    // cuenta
  ins(db, { type: "income", category: "", cents: 100 });          // cuenta
  ins(db, { type: "refund", category: "" });                      // cuenta
  ins(db, { type: "expense", category: "cat-casa-alquiler" });    // NO cuenta: sí tiene categoría
  ins(db, { type: "transfer", category: "", account: "acc-n26", counterAccount: "acc-revolut" }); // NO cuenta: tipo excluido
  ins(db, { type: "adjustment", category: "" });                  // NO cuenta: tipo excluido
  const borrado = ins(db, { type: "expense", category: "" });
  db.prepare("UPDATE transactions SET deleted=1 WHERE id=?").run(borrado); // NO cuenta: borrada

  const n = db.prepare(SQL.countUncategorized).get("per-1").n;
  assert.equal(n, 3);
});
