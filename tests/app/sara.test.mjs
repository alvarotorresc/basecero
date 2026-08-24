import { test } from "node:test";
import assert from "node:assert/strict";
import { SQL } from "../../app/js/sql.js";
import { openDb, seedMinimal } from "./helpers.mjs";

const T = "2026-08-24T18:00:00Z";
const T2 = "2026-08-24T19:00:00Z";

/** Inserta una transacción usando la firma de SQL.insertTransaction (mismo helper que
 *  tests/app/movimientos.test.mjs). */
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

/** Reproduce EXACTAMENTE la secuencia que hace repo.settleShared (que a su vez delega en
 *  repo.addTransaction({refId})): busca la fila en pendingShared (misma fuente de verdad para
 *  el importe/categoría de Sara, sin duplicar el cálculo del pct), inserta el refund de
 *  liquidación en el periodo abierto y marca settled=1 en el gasto original — el mismo
 *  execMany([insertStmt, updateSettled]) de repo.addTransaction. */
function settleShared(db, origId, accountId, now, openPeriodId = "per-1") {
  const row = db.prepare(SQL.pendingShared).all().find((r) => r.id === origId);
  if (!row) throw new Error("Gasto compartido no encontrado o ya liquidado");
  const refundId = "refund-" + origId;
  db.prepare(SQL.insertTransaction).run(
    refundId, "2026-08-24", openPeriodId, "refund", row.sara_amount_cents, accountId, "",
    row.category_id, row.merchant, "Liquidación", 0, null, 0, origId, "", "", "pending", now, now,
  );
  db.prepare("UPDATE transactions SET settled=1, updated_at=? WHERE id=?").run(now, origId);
  return refundId;
}

test("pendingShared: calcula sara_amount_cents con el pct del PROPIO periodo de cada gasto y con override", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(`INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES ('per-2','Julio 2026','2026-06-27','2026-07-27','closed',50,'',?,?,0)`).run(T, T);

  // per-1 (60/40): sin override → sara = 4000
  const a = ins(db, { id: "a", date: "2026-08-10", period: "per-1", cents: 10000, shared: 1 });
  // per-2 (50/50, periodo YA CERRADO): sin override → sara = 5000, con SU pct propio, no el de per-1
  const b = ins(db, { id: "b", date: "2026-08-05", period: "per-2", cents: 10000, shared: 1 });
  // per-1 con override=90 → el override manda sobre el pct del periodo: sara = 1000
  const c = ins(db, { id: "c", date: "2026-08-15", period: "per-1", cents: 10000, shared: 1, override: 90 });

  // no deben aparecer:
  ins(db, { id: "settled", period: "per-1", cents: 5000, shared: 1, settled: 1 });          // ya liquidado
  ins(db, { id: "noshared", period: "per-1", cents: 5000, shared: 0 });                      // no compartido
  const borrado = ins(db, { id: "borrado", period: "per-1", cents: 5000, shared: 1 });
  db.prepare("UPDATE transactions SET deleted=1 WHERE id=?").run(borrado);                   // borrado
  ins(db, { id: "income", type: "income", period: "per-1", cents: 5000, shared: 1, category: "cat-nomina" }); // no es 'expense'

  const rows = db.prepare(SQL.pendingShared).all();

  assert.deepEqual(rows.map((r) => r.id), [b, a, c], "orden por date ASC");
  assert.equal(rows.find((r) => r.id === a).sara_amount_cents, 4000);
  assert.equal(rows.find((r) => r.id === b).sara_amount_cents, 5000);
  assert.equal(rows.find((r) => r.id === c).sara_amount_cents, 1000);

  const total = db.prepare(SQL.pendingSharedTotal).get().total_cents;
  assert.equal(total, 4000 + 5000 + 1000, "el income compartido NO debe sumar al total pendiente");
});

test("pendingShared: un reparto 100/0 (pct del periodo o override) da sara_amount_cents=0 y se excluye", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(`INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES ('per-100','Periodo 100/0','2026-05-27','2026-06-27','closed',100,'',?,?,0)`).run(T, T);

  // periodo con my_share_pct=100 (permitido en el onboarding): sara = 0 → no debe aparecer
  const soloYo = ins(db, { id: "solo-yo", period: "per-100", cents: 10000, shared: 1 });
  // per-1 (60/40) pero con override=100: el override manda, sara = 0 → tampoco debe aparecer
  const overrideCien = ins(db, { id: "override-cien", period: "per-1", cents: 10000, shared: 1, override: 100 });
  // control: un compartido normal SÍ debe aparecer
  const normal = ins(db, { id: "normal", period: "per-1", cents: 10000, shared: 1 });

  const rows = db.prepare(SQL.pendingShared).all();
  assert.deepEqual(rows.map((r) => r.id), [normal]);
  assert.equal(rows.find((r) => r.id === soloYo), undefined);
  assert.equal(rows.find((r) => r.id === overrideCien), undefined);

  const total = db.prepare(SQL.pendingSharedTotal).get().total_cents;
  assert.equal(total, 4000, "solo 'normal' (60/40 de 10000) debe sumar; los 100/0 no aportan nada");
});

test("settleShared: crea el refund con importe/categoría/comercio de la parte de Sara y el original queda settled", () => {
  const db = openDb();
  seedMinimal(db);
  const gastoId = ins(db, {
    id: "gasto-ikea", date: "2026-08-12", period: "per-1", cents: 8000, shared: 1,
    category: "cat-casa-alquiler", merchant: "IKEA",
  });

  const refundId = settleShared(db, gastoId, "acc-n26", T2);

  const refund = db.prepare("SELECT * FROM transactions WHERE id=?").get(refundId);
  assert.equal(refund.type, "refund");
  assert.equal(refund.amount_cents, 3200, "8000 - 60% = 3200 (parte de Sara)");
  assert.equal(refund.category_id, "cat-casa-alquiler");
  assert.equal(refund.merchant, "IKEA");
  assert.equal(refund.note, "Liquidación");
  assert.equal(refund.account_id, "acc-n26");
  assert.equal(refund.ref_id, gastoId);
  assert.equal(refund.is_shared, 0, "el refund de liquidación en sí no se marca compartido (ya es el 100% de Sara)");

  const gasto = db.prepare("SELECT settled FROM transactions WHERE id=?").get(gastoId);
  assert.equal(gasto.settled, 1);
});

test("pendingSharedTotal: baja a 0 tras liquidar el único gasto pendiente", () => {
  const db = openDb();
  seedMinimal(db);
  const id = ins(db, { id: "unico", date: "2026-08-12", period: "per-1", cents: 5000, shared: 1 });

  assert.equal(db.prepare(SQL.pendingSharedTotal).get().total_cents, 2000);

  settleShared(db, id, "acc-n26", T2);

  assert.equal(db.prepare(SQL.pendingSharedTotal).get().total_cents, 0);
  assert.deepEqual(db.prepare(SQL.pendingShared).all(), []);
});

test("el refund de liquidación NO altera spentOfPeriod: tiene ref_id, así que spentOfPeriod SQL lo excluye", () => {
  const db = openDb();
  seedMinimal(db);
  const id = ins(db, { id: "gasto-compartido", date: "2026-08-12", period: "per-1", cents: 10000, shared: 1 });

  const antes = db.prepare(SQL.spentOfPeriod).get("per-1").spent_cents;
  assert.equal(antes, 6000, "60% de 10000");

  settleShared(db, id, "acc-n26", T2);

  const despues = db.prepare(SQL.spentOfPeriod).get("per-1").spent_cents;
  assert.equal(despues, antes, "el refund de liquidación (ref_id != '') no debe restar ni sumar nada");
});
