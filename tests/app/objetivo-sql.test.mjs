// B-7: la consulta de movimientos de la hucha (SQL.goalAccountMovements) contra SQLite real, y que
// las aportaciones por mes de objetivo-logic.js cuadran con el saldo de SQL.accountBalance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { SQL } from "../../app/app/js/sql.js";
import { sweepTransferStmt } from "../../app/app/js/repo.js";
import { contributionsByMonth } from "../../app/app/js/objetivo-logic.js";
import { openDb, seedMinimal } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const pure = require("../../app/app/vendor/pure.js");
globalThis.bcUlid = pure.bcUlid;
globalThis.bcSanitizeCell = pure.bcSanitizeCell;

const NOW = "2026-09-27T10:00:00Z";
const transfer = (db, date, cents, from, to) => {
  const s = sweepTransferStmt({ periodId: "per-1", date, amountCents: cents, fromAccountId: from, toAccountId: to, goalName: "Vacaciones", now: NOW });
  db.prepare(s.sql).run(...s.bind);
};

test("goalAccountMovements: trae lo que entra y sale de la hucha, no lo ajeno ni lo borrado", () => {
  const db = openDb();
  seedMinimal(db);
  transfer(db, "2026-07-28", 15000, "acc-n26", "acc-revolut");
  transfer(db, "2026-08-28", 20000, "acc-n26", "acc-revolut");
  transfer(db, "2026-08-30", 5000, "acc-revolut", "acc-n26");
  transfer(db, "2026-08-31", 7000, "acc-n26", "acc-prestamo");   // ajena a la hucha
  transfer(db, "2026-09-02", 9999, "acc-n26", "acc-revolut");
  db.prepare("UPDATE transactions SET deleted=1 WHERE amount_cents=9999").run();

  const rows = db.prepare(SQL.goalAccountMovements).all("acc-revolut", "acc-revolut");
  assert.deepEqual(rows.map((r) => r.amount_cents), [15000, 20000, 5000]);

  const r = contributionsByMonth({ txs: rows, accountId: "acc-revolut", openingCents: 50000, todayIso: "2026-09-27" });
  assert.equal(r.months.find((m) => m.key === "2026-08").cents, 15000);
  assert.equal(r.totalCents, db.prepare(SQL.accountBalance).get("2026-09-27", "acc-revolut").balance_cents,
    "la suma de «antes» y los meses es el saldo de la hucha");
});
