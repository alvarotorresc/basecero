import { test } from "node:test";
import assert from "node:assert/strict";
import { SQL } from "../../app/js/sql.js";
import { netWorthOfBalances, shortMonthLabel, goalProgress } from "../../app/js/repo.js";
import { sanitizeLoanMap, parseLoanMap } from "../../app/js/account-defaults.js";
import { openDb, seedMinimal } from "./helpers.mjs";

const T = "2026-08-24T18:00:00Z";
const T2 = "2026-08-24T19:00:00Z";

/** Inserta una transacción usando la firma de SQL.insertTransaction (mismo helper que
 *  tests/app/prevision.test.mjs y tests/app/periodos.test.mjs). */
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

/** Reproduce, a mano, lo que hace repo.balancesAt(dateIso): una SQL.accountBalance por cuenta de
 *  SQL.listAllAccounts (no hay Worker en Node para llamar al repo.js async tal cual — mismo
 *  criterio que tests/app/prevision.test.mjs con SQL.accountBalance). */
function balancesAtReproduced(db, dateIso) {
  return db.prepare(SQL.listAllAccounts).all().map((a) => ({
    id: a.id, name: a.name, type: a.type,
    balance_cents: db.prepare(SQL.accountBalance).get(dateIso, a.id).balance_cents,
  }));
}

// ---- SQL.listAllAccounts / netWorthOfBalances / netWorthAt ----------------

test("SQL.listAllAccounts: las 3 cuentas semilla (incluye el pasivo), en orden de display_order", () => {
  const db = openDb();
  seedMinimal(db);
  const rows = db.prepare(SQL.listAllAccounts).all();
  assert.deepEqual(rows.map((a) => a.id), ["acc-n26", "acc-revolut", "acc-prestamo"]);
  assert.deepEqual(rows.map((a) => a.type), ["checking", "savings", "liability"]);
});

test("netWorthOfBalances (= netWorthAt): suma las cuentas semilla, el pasivo resta (opening negativo)", () => {
  const db = openDb();
  seedMinimal(db); // acc-n26 checking 100000, acc-revolut savings 50000, acc-prestamo liability -600000

  const balances = balancesAtReproduced(db, "2026-08-24");
  assert.equal(netWorthOfBalances(balances), 100000 + 50000 - 600000);

  // con un gasto en la corriente, el neto baja en la misma cantidad
  ins(db, { id: "e1", date: "2026-08-01", type: "expense", cents: 15000, account: "acc-n26" });
  const balances2 = balancesAtReproduced(db, "2026-08-24");
  assert.equal(netWorthOfBalances(balances2), 100000 - 15000 + 50000 - 600000);
});

test("netWorthOfBalances: sin cuentas, 0 (no revienta con un array vacío)", () => {
  assert.equal(netWorthOfBalances([]), 0);
});

// ---- shortMonthLabel / SQL.listClosedPeriods / netWorthSeries -------------

test("shortMonthLabel: abreviatura fija de 3 letras (no depende de Intl/ICU del entorno)", () => {
  assert.equal(shortMonthLabel("2026-08-24"), "ago");
  assert.equal(shortMonthLabel("2026-01-01"), "ene");
  assert.equal(shortMonthLabel("2026-09-15"), "sep");
  assert.equal(shortMonthLabel("2026-12-31"), "dic");
});

test("SQL.listClosedPeriods + netWorthSeries (reproducida): usa el end_date de los cerrados (no el start_date), ordenados, + el punto de hoy", () => {
  const db = openDb();
  seedMinimal(db); // per-1: open, start_date 2026-07-27
  db.prepare(`UPDATE periods SET status='closed', end_date='2026-06-30' WHERE id='per-1'`).run(); // start_date 2026-07-27 (seedMinimal), end_date "adelantado" a propósito: demuestra que la etiqueta sale del end_date, no del start_date
  db.prepare(`INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES ('per-2','Julio 2026','2026-08-01','2026-07-31','closed',60,'',?,?,0)`).run(T, T);
  db.prepare(`INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES ('per-3','Agosto 2026','2026-08-21','','open',60,'',?,?,0)`).run(T, T);

  const closed = db.prepare(SQL.listClosedPeriods).all();
  assert.deepEqual(closed.map((p) => p.id), ["per-1", "per-2"], "ORDER BY start_date, solo status='closed'");

  const points = closed.map((p) => ({
    label: shortMonthLabel(p.end_date),
    cents: netWorthOfBalances(balancesAtReproduced(db, p.end_date)),
  }));
  points.push({ label: shortMonthLabel("2026-08-24"), cents: netWorthOfBalances(balancesAtReproduced(db, "2026-08-24")) });

  assert.deepEqual(points.map((p) => p.label), ["jun", "jul", "ago"], "las etiquetas salen del end_date, no del start_date");
  assert.equal(points.length, 3, ">=2 puntos: la pantalla muestra la sparkline");
});

test("netWorthSeries (reproducida): 0 periodos cerrados -> un único punto (hoy) -> la pantalla oculta la sparkline", () => {
  const db = openDb(); // sin seedMinimal: sin cuentas ni periodos
  const closed = db.prepare(SQL.listClosedPeriods).all();
  assert.equal(closed.length, 0);
  const points = [{ label: shortMonthLabel("2026-08-24"), cents: netWorthOfBalances(balancesAtReproduced(db, "2026-08-24")) }];
  assert.equal(points.length, 1, "<2 puntos: la pantalla no debe pintar la sparkline");
});

// ---- SQL.listGoals ----------------------------------------------------

test("SQL.listGoals: solo goals activos y no borrados", () => {
  const db = openDb();
  seedMinimal(db);
  const g = (id, over = {}) => {
    const v = {
      id, name: "G", type: "savings_target", amount: 100000, months: null, pct: null, date: "",
      account: "acc-revolut", category: "", active: 1, ...over,
    };
    db.prepare(`INSERT INTO goals (id,name,type,target_amount_cents,target_months,target_pct,target_date,account_id,category_id,is_active,created_at,updated_at,deleted)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(
      v.id, v.name, v.type, v.amount, v.months, v.pct, v.date, v.account, v.category, v.active, T, T,
    );
  };
  g("g1", { name: "Activo" });
  g("g2", { name: "Inactivo", active: 0 });
  db.prepare(`INSERT INTO goals (id,name,type,target_amount_cents,target_months,target_pct,target_date,account_id,category_id,is_active,created_at,updated_at,deleted)
    VALUES ('g3','Borrado','savings_target',100000,NULL,NULL,'','acc-revolut','',1,?,?,1)`).run(T, T);

  const rows = db.prepare(SQL.listGoals).all();
  assert.deepEqual(rows.map((r) => r.id), ["g1"]);
});

// ---- goalProgress (pura, un caso por tipo) ---------------------------------

test("goalProgress emergency_fund: con gasto medio 0 (sin periodos cerrados) da pct 0 sin dividir por cero", () => {
  const goal = { type: "emergency_fund", account_id: "acc-revolut", target_months: 3 };
  const g = goalProgress(goal, {
    balanceByAccount: { "acc-revolut": 50000 },
    accountNameById: { "acc-revolut": "Revolut" },
    avgSpentCents: 0,
  });
  assert.equal(g.currentCents, 50000);
  assert.equal(g.targetCents, 0);
  assert.equal(g.pct, 0);
  assert.equal(g.level, "ok");
  assert.ok(g.subtitle.includes("Revolut"));
});

test("goalProgress emergency_fund: saldo hucha ÷ (target_months × gasto medio)", () => {
  const goal = { type: "emergency_fund", account_id: "acc-revolut", target_months: 3 };
  const g = goalProgress(goal, {
    balanceByAccount: { "acc-revolut": 90000 },
    accountNameById: { "acc-revolut": "Revolut" },
    avgSpentCents: 60000,
  });
  assert.equal(g.targetCents, 180000, "3 meses × 60000");
  assert.equal(g.pct, 50);
  assert.equal(g.level, "ok");
  assert.match(g.subtitle, /1,5/, "90000 / 60000 = 1,5 meses de gasto cubiertos");
});

test("goalProgress savings_target: saldo ÷ objetivo, con la fecha en el subtítulo si se ha definido", () => {
  const goal = { type: "savings_target", account_id: "acc-revolut", target_amount_cents: 350000, target_date: "2027-05-15" };
  const g = goalProgress(goal, {
    balanceByAccount: { "acc-revolut": 118000 },
    accountNameById: { "acc-revolut": "Revolut" },
  });
  assert.equal(g.currentCents, 118000);
  assert.equal(g.targetCents, 350000);
  assert.ok(Math.abs(g.pct - (118000 / 350000) * 100) < 1e-9);
  assert.equal(g.level, "ok");
  assert.match(g.subtitle, /mayo 2027/);
});

test("goalProgress savings_target: sin target_date, el subtítulo no menciona fecha", () => {
  const goal = { type: "savings_target", account_id: "acc-revolut", target_amount_cents: 100000, target_date: "" };
  const g = goalProgress(goal, {
    balanceByAccount: { "acc-revolut": 50000 },
    accountNameById: { "acc-revolut": "Revolut" },
  });
  assert.ok(!g.subtitle.includes("antes de"));
});

test("goalProgress provision: saldo hucha ÷ objetivo anual", () => {
  const goal = { type: "provision", account_id: "acc-revolut", target_amount_cents: 36000 };
  const g = goalProgress(goal, {
    balanceByAccount: { "acc-revolut": 15000 },
    accountNameById: { "acc-revolut": "Revolut" },
  });
  assert.equal(g.currentCents, 15000);
  assert.equal(g.targetCents, 36000);
  assert.ok(Math.abs(g.pct - (15000 / 36000) * 100) < 1e-9);
  assert.equal(g.level, "ok");
  assert.match(g.subtitle, /30,00\s?€/, "36000 / 12 = 3000 céntimos al mes");
});

test("goalProgress spending_cap: gastado del periodo abierto en su categoría raíz ÷ techo — 100 marca 'over' (level rojo)", () => {
  const goal = { type: "spending_cap", category_id: "cat-restauracion", target_amount_cents: 20000 };

  const ok = goalProgress(goal, { spentByCategory: { "cat-restauracion": 10000 } }); // 50%
  assert.equal(ok.level, "ok");

  const warn = goalProgress(goal, { spentByCategory: { "cat-restauracion": 18000 } }); // 90%
  assert.equal(warn.level, "warn");

  const over = goalProgress(goal, { spentByCategory: { "cat-restauracion": 25000 } }); // 125%
  assert.equal(over.level, "over", "por encima de 100% marca 'over'");
  assert.ok(Math.abs(over.pct - 125) < 1e-9);
  assert.match(over.subtitle, /Superado/);
});

test("goalProgress savings_rate: tasa de ahorro del periodo abierto vs target_pct", () => {
  const goal = { type: "savings_rate", target_pct: 20 };

  const ok = goalProgress(goal, { savingsRatePct: 25 });
  assert.equal(ok.currentCents, 25);
  assert.equal(ok.targetCents, 20);
  assert.equal(ok.level, "ok", "iguala o supera el objetivo");

  const warn = goalProgress(goal, { savingsRatePct: 12 });
  assert.equal(warn.level, "warn", "todavía no llega al objetivo");
});

// ---- Integración: ctx de goalsWithProgress reproducido con SQL real -------

test("goalsWithProgress (reproducida): ctx armado desde SQL real (accountBalance + spentByRootCategory + spentOfPeriod/incomeOfPeriod) da el pct esperado", () => {
  const db = openDb();
  seedMinimal(db); // per-1 open, 60/40; acc-revolut opening 50000

  // un periodo cerrado con 40000 de gasto -> avgSpentOfClosedPeriods = 40000
  db.prepare(`INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES ('per-0','Julio 2026','2026-06-27','2026-07-26','closed',60,'',?,?,0)`).run(T, T);
  ins(db, { id: "gasto-cerrado", period: "per-0", date: "2026-07-01", cents: 40000, shared: 0 });

  // ingreso + gasto del periodo abierto -> savingsRatePct = (100000-30000)/100000 = 70
  ins(db, { id: "ingreso-abierto", period: "per-1", date: "2026-08-05", type: "income", category: "cat-nomina", cents: 100000 });
  ins(db, { id: "gasto-abierto", period: "per-1", date: "2026-08-10", category: "cat-casa-alquiler", cents: 30000, shared: 0 });

  const closed = db.prepare(SQL.listClosedPeriods).all();
  assert.equal(closed.length, 1);
  const avgSpentCents = closed.reduce((s, p) => s + db.prepare(SQL.spentOfPeriod).get(p.id).spent_cents, 0) / closed.length;
  assert.equal(avgSpentCents, 40000);

  const balanceByAccount = { "acc-revolut": db.prepare(SQL.accountBalance).get("2026-08-24", "acc-revolut").balance_cents };
  const spentRows = db.prepare(SQL.spentByRootCategory).all("per-1");
  const spentByCategory = Object.fromEntries(spentRows.map((r) => [r.root_id, r.spent_cents]));
  const spent = db.prepare(SQL.spentOfPeriod).get("per-1").spent_cents;
  const income = db.prepare(SQL.incomeOfPeriod).get("per-1").income_cents;
  const savingsRatePct = income > 0 ? ((income - spent) / income) * 100 : 0;
  assert.equal(spent, 30000);
  assert.equal(income, 100000);
  assert.equal(savingsRatePct, 70);

  const ctx = { balanceByAccount, accountNameById: { "acc-revolut": "Revolut" }, avgSpentCents, spentByCategory, savingsRatePct };

  const fondo = goalProgress({ type: "emergency_fund", account_id: "acc-revolut", target_months: 2 }, ctx);
  assert.equal(fondo.targetCents, 80000, "2 × 40000");
  assert.equal(fondo.currentCents, 50000, "opening de acc-revolut, sin movimientos propios");
  assert.ok(Math.abs(fondo.pct - (50000 / 80000) * 100) < 1e-9);

  const techo = goalProgress({ type: "spending_cap", category_id: "cat-casa", target_amount_cents: 50000 }, ctx);
  assert.equal(techo.currentCents, 30000, "cat-casa-alquiler agrega a la raíz cat-casa");
  assert.equal(techo.level, "ok");

  const tasa = goalProgress({ type: "savings_rate", target_pct: 50 }, ctx);
  assert.equal(tasa.currentCents, 70);
  assert.equal(tasa.level, "ok", "70% de ahorro supera el objetivo de 50%");
});

// ---- Formularios de cuentas y objetivos (Task 14) --------------------------

/** Reproduce EXACTAMENTE el op "execMany" del Worker (BEGIN/ejecuta/COMMIT, ROLLBACK si falla) —
 *  mismo helper que tests/app/periodos.test.mjs para repo.openNextPeriod: no hay Worker en Node
 *  para probar repo.createGoal (execMany) tal cual. */
function execManyRaw(db, stmts) {
  db.exec("BEGIN");
  try {
    for (const s of stmts) db.prepare(s.sql).run(...(s.bind ?? []));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

const HUCHA_GOAL_TYPES = new Set(["emergency_fund", "savings_target", "provision"]);

/** Reproduce EXACTAMENTE la secuencia de repo.createGoal: si el tipo lleva hucha propia y no se
 *  pasa accountId, crea la cuenta savings "Hucha · {name}" y el goal EN EL MISMO execMany —
 *  el id de la hucha se genera en JS (bcUlid en repo real) para poder referenciarlo en el goal.
 *  isActive respeta `fields.isActive` si se indica (por defecto 1) — antes del fix (ver
 *  task-14-report.md) se hardcodeaba a 1 sin mirar el campo, ignorando el toggle "Activo" del
 *  formulario al crear. */
function createGoalReproduced(db, fields, now = T) {
  const goalId = "goal-" + Math.floor(Math.random() * 1e9);
  const stmts = [];
  let accountId = fields.accountId || "";
  if (HUCHA_GOAL_TYPES.has(fields.type) && !accountId) {
    accountId = "acc-hucha-" + Math.floor(Math.random() * 1e9);
    stmts.push({ sql: SQL.insertAccount, bind: [accountId, `Hucha · ${fields.name}`, "savings", 0, now, now] });
  }
  const isActive = fields.isActive !== undefined ? (fields.isActive ? 1 : 0) : 1;
  stmts.push({
    sql: SQL.insertGoal,
    bind: [
      goalId, fields.name, fields.type,
      fields.targetAmountCents ?? null, fields.targetMonths ?? null, fields.targetPct ?? null,
      fields.targetDate ?? "", accountId, fields.categoryId ?? "", isActive, now, now,
    ],
  });
  execManyRaw(db, stmts);
  return goalId;
}

/** Reproduce repo.updateAccount: campos ausentes conservan el valor actual (mismo criterio que
 *  updateRule). Toda cuenta, incluida acc-n26, es renombrable. */
function updateAccountReproduced(db, id, fields, now = T2) {
  const cur = db.prepare(SQL.getAccount).get(id);
  const name = fields.name ?? cur.name;
  const type = fields.type ?? cur.type;
  const openingBalanceCents = fields.openingBalanceCents ?? cur.opening_balance_cents;
  db.prepare(SQL.updateAccount).run(name, type, openingBalanceCents, now, id);
}

test("SQL.insertAccount: crea la cuenta con display_order = MAX+1 y admite opening_balance negativo (pasivo)", () => {
  const db = openDb();
  seedMinimal(db); // 3 cuentas semilla, display_order 1/2/4
  db.prepare(SQL.insertAccount).run("acc-nueva", "Cuenta nueva", "checking", -12345, T, T);

  const row = db.prepare("SELECT * FROM accounts WHERE id='acc-nueva'").get();
  assert.equal(row.name, "Cuenta nueva");
  assert.equal(row.type, "checking");
  assert.equal(row.opening_balance_cents, -12345);
  assert.equal(row.display_order, 5, "MAX(display_order) de las 3 semilla (1,2,4) + 1");
  assert.equal(row.is_archived, 0);
  assert.equal(row.deleted, 0);
});

test("SQL.insertAccount: en una base sin ninguna cuenta todavía, display_order empieza en 1 (COALESCE cubre el MAX de una tabla vacía)", () => {
  const db = openDb(); // sin seedMinimal: 0 filas en accounts
  db.prepare(SQL.insertAccount).run("acc-primera", "Primera cuenta", "checking", 0, T, T);
  const row = db.prepare("SELECT * FROM accounts WHERE id='acc-primera'").get();
  assert.equal(row.display_order, 1);
});

test("SQL.updateAccount: cambia nombre/tipo/saldo inicial y updated_at, nunca created_at", () => {
  const db = openDb();
  seedMinimal(db);
  const before = db.prepare("SELECT * FROM accounts WHERE id='acc-revolut'").get();

  db.prepare(SQL.updateAccount).run("Revolut renombrada", "savings", 99999, T2, "acc-revolut");

  const after = db.prepare("SELECT * FROM accounts WHERE id='acc-revolut'").get();
  assert.equal(after.name, "Revolut renombrada");
  assert.equal(after.opening_balance_cents, 99999);
  assert.equal(after.updated_at, T2);
  assert.equal(after.created_at, before.created_at);
});

test("updateAccount (reproducido): acc-n26 se renombra como cualquier otra cuenta", () => {
  const db = openDb();
  seedMinimal(db); // acc-n26 checking 100000
  updateAccountReproduced(db, "acc-n26", { name: "Cuenta corriente", openingBalanceCents: 250000 });
  const row = db.prepare("SELECT * FROM accounts WHERE id='acc-n26'").get();
  assert.equal(row.name, "Cuenta corriente");
  assert.equal(row.opening_balance_cents, 250000);
});

test("CHECK de type inválido en accounts lanza (insertAccount)", () => {
  const db = openDb();
  seedMinimal(db);
  assert.throws(() => db.prepare(SQL.insertAccount).run("acc-x", "X", "wallet", 0, T, T), /CHECK constraint failed/);
});

test("SQL.insertGoal + SQL.getGoal: crea un goal con sus datos completos", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(SQL.insertGoal).run(
    "goal-1", "Fondo de emergencia", "emergency_fund", null, 3, null, "", "acc-revolut", "", 1, T, T,
  );
  const row = db.prepare(SQL.getGoal).get("goal-1");
  assert.equal(row.name, "Fondo de emergencia");
  assert.equal(row.type, "emergency_fund");
  assert.equal(row.target_months, 3);
  assert.equal(row.target_amount_cents, null);
  assert.equal(row.account_id, "acc-revolut");
  assert.equal(row.is_active, 1);
});

test("SQL.updateGoal: cambia los campos editables (incluido is_active, el toggle de desactivar) y updated_at, nunca created_at", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(SQL.insertGoal).run("goal-1", "Original", "savings_target", 100000, null, null, "", "acc-revolut", "", 1, T, T);
  const before = db.prepare(SQL.getGoal).get("goal-1");

  db.prepare(SQL.updateGoal).run(
    "Renombrado", "savings_target", 200000, null, null, "2027-01-01", "acc-revolut", "", 0, T2, "goal-1",
  );

  const after = db.prepare(SQL.getGoal).get("goal-1");
  assert.equal(after.name, "Renombrado");
  assert.equal(after.target_amount_cents, 200000);
  assert.equal(after.target_date, "2027-01-01");
  assert.equal(after.is_active, 0, "desactivado (toggle is_active)");
  assert.equal(after.updated_at, T2);
  assert.equal(after.created_at, before.created_at);
});

test("SQL.softDeleteGoal: marca deleted+updated_at y desaparece de listGoals", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(SQL.insertGoal).run("goal-1", "Permanece", "savings_target", 100000, null, null, "", "acc-revolut", "", 1, T, T);
  db.prepare(SQL.insertGoal).run("goal-2", "Borrar", "savings_target", 100000, null, null, "", "acc-revolut", "", 1, T, T);

  db.prepare(SQL.softDeleteGoal).run(T2, "goal-2");

  const row = db.prepare("SELECT deleted, updated_at FROM goals WHERE id='goal-2'").get();
  assert.equal(row.deleted, 1);
  assert.equal(row.updated_at, T2);
  const rows = db.prepare(SQL.listGoals).all();
  assert.deepEqual(rows.map((r) => r.id), ["goal-1"]);
});

test("SQL.listExpenseRootCategories: solo raíces de gasto (parent_id=''), nunca hijas ni de ingreso", () => {
  const db = openDb();
  seedMinimal(db); // cat-casa (raíz gasto), cat-casa-alquiler (hija), cat-nomina (raíz ingreso)
  const rows = db.prepare(SQL.listExpenseRootCategories).all();
  assert.deepEqual(rows.map((r) => r.id), ["cat-casa"]);
});

// ---- createGoal (reproducido): hucha automática atómica --------------------

test("createGoal savings_target sin accountId: crea UNA hucha savings vinculada, atómicamente", () => {
  const db = openDb();
  seedMinimal(db);
  const before = db.prepare("SELECT COUNT(*) c FROM accounts").get().c;

  const goalId = createGoalReproduced(db, { name: "Viaje a Japón", type: "savings_target", targetAmountCents: 300000 });

  const after = db.prepare("SELECT COUNT(*) c FROM accounts").get().c;
  assert.equal(after, before + 1, "exactamente una cuenta nueva");

  const goal = db.prepare(SQL.getGoal).get(goalId);
  assert.notEqual(goal.account_id, "", "el goal queda vinculado a una cuenta");
  const hucha = db.prepare("SELECT * FROM accounts WHERE id=?").get(goal.account_id);
  assert.equal(hucha.type, "savings");
  assert.equal(hucha.name, "Hucha · Viaje a Japón");
});

test("createGoal spending_cap: NO crea ninguna hucha (el tipo no lleva cuenta)", () => {
  const db = openDb();
  seedMinimal(db);
  const before = db.prepare("SELECT COUNT(*) c FROM accounts").get().c;

  const goalId = createGoalReproduced(db, {
    name: "Techo de Restauración", type: "spending_cap", targetAmountCents: 20000, categoryId: "cat-casa",
  });

  const after = db.prepare("SELECT COUNT(*) c FROM accounts").get().c;
  assert.equal(after, before, "spending_cap no crea ninguna cuenta");

  const goal = db.prepare(SQL.getGoal).get(goalId);
  assert.equal(goal.account_id, "", "spending_cap no lleva hucha");
  assert.equal(goal.category_id, "cat-casa");
});

test("createGoal: dos goals con hucha nunca comparten cuenta (cada create crea la suya)", () => {
  const db = openDb();
  seedMinimal(db);

  const g1 = createGoalReproduced(db, { name: "Fondo de emergencia", type: "emergency_fund", targetMonths: 3 });
  const g2 = createGoalReproduced(db, { name: "Provisión seguro coche", type: "provision", targetAmountCents: 36000 });

  const goal1 = db.prepare(SQL.getGoal).get(g1);
  const goal2 = db.prepare(SQL.getGoal).get(g2);
  assert.notEqual(goal1.account_id, "");
  assert.notEqual(goal2.account_id, "");
  assert.notEqual(goal1.account_id, goal2.account_id, "cada goal tiene su propia hucha, nunca comparten");
});

test("createGoal con isActive:false: el goal se crea YA desactivado (is_active=0), no se ignora el toggle 'Activo' del formulario", () => {
  const db = openDb();
  seedMinimal(db);

  const goalId = createGoalReproduced(db, {
    name: "Objetivo apagado", type: "spending_cap", targetAmountCents: 10000, categoryId: "cat-casa", isActive: false,
  });

  const goal = db.prepare("SELECT * FROM goals WHERE id=?").get(goalId);
  assert.equal(goal.is_active, 0, "isActive:false en create debe persistir como is_active=0, no quedar hardcodeado a 1");
  assert.deepEqual(db.prepare(SQL.listGoals).all().map((r) => r.id), [], "listGoals (is_active=1) no lo lista");
});

// ---- setAccountLoan / getAccountLoans (reproducido, Task 6) — CONFIG-IN-META en account_loans -

/** Reproduce repo.setAccountLoan: read-modify-write de meta.account_loans, sanea antes de
 *  escribir — mismo patrón que setCategoryStyleReproduced en categorias.test.mjs. */
function setAccountLoanReproduced(db, accountId, monthlyCents) {
  const metaRows = db.prepare(SQL.allMeta).all();
  const meta = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));
  const loanMap = parseLoanMap(meta.account_loans);
  if (monthlyCents > 0) loanMap[accountId] = { monthlyCents };
  else delete loanMap[accountId];
  const sanitized = sanitizeLoanMap(loanMap);
  db.prepare(SQL.upsertMeta).run("account_loans", JSON.stringify(sanitized));
  return sanitized;
}

test("setAccountLoan (reproducido): guarda monthlyCents para un pasivo", () => {
  const db = openDb();
  seedMinimal(db);
  const out = setAccountLoanReproduced(db, "acc-prestamo", 18900);
  assert.deepEqual(out, { "acc-prestamo": { monthlyCents: 18900 } });
  const row = db.prepare("SELECT value FROM meta WHERE key='account_loans'").get();
  assert.equal(row.value, JSON.stringify({ "acc-prestamo": { monthlyCents: 18900 } }));
});

test("setAccountLoan (reproducido): monthlyCents<=0 borra la entrada existente (vuelve a 'sin cuota')", () => {
  const db = openDb();
  seedMinimal(db);
  setAccountLoanReproduced(db, "acc-prestamo", 18900);
  assert.deepEqual(setAccountLoanReproduced(db, "acc-prestamo", 0), {});
});

test("setAccountLoan (reproducido): toca SOLO la cuenta indicada, conserva las demás entradas del mapa", () => {
  const db = openDb();
  seedMinimal(db);
  setAccountLoanReproduced(db, "acc-prestamo", 18900);
  const out = setAccountLoanReproduced(db, "acc-revolut", 5000);
  assert.deepEqual(out, { "acc-prestamo": { monthlyCents: 18900 }, "acc-revolut": { monthlyCents: 5000 } });
});

test("meta.account_loans arranca en '{}' (semilla schema.sql) — getAccountLoans (reproducido) da un mapa vacío", () => {
  const db = openDb();
  seedMinimal(db);
  const meta = Object.fromEntries(db.prepare(SQL.allMeta).all().map((r) => [r.key, r.value]));
  assert.equal(meta.account_loans, "{}");
  assert.deepEqual(parseLoanMap(meta.account_loans), {});
});

test("execMany: si el insert del goal falla tras crear su hucha, hace rollback completo (no queda ni la cuenta huérfana)", () => {
  const db = openDb();
  seedMinimal(db);
  const before = db.prepare("SELECT COUNT(*) c FROM accounts").get().c;

  const accountId = "acc-hucha-x";
  const stmts = [
    { sql: SQL.insertAccount, bind: [accountId, "Hucha · X", "savings", 0, T, T] },
    // type inválido: viola el CHECK de goals.type a propósito, DESPUÉS de crear la hucha
    { sql: SQL.insertGoal, bind: ["goal-x", "X", "bad_type", null, 3, null, "", accountId, "", 1, T, T] },
  ];

  assert.throws(() => execManyRaw(db, stmts), /CHECK constraint failed/);

  const after = db.prepare("SELECT COUNT(*) c FROM accounts").get().c;
  assert.equal(after, before, "rollback: la hucha creada en el mismo lote también desaparece");
  assert.equal(db.prepare("SELECT * FROM goals WHERE id='goal-x'").get(), undefined);
});
