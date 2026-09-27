// B-3 · paso de revisión del import: el pipeline de n26.js separado en un ENSAYO puro
// (planImportRows: decide create/reconcile/skip/omit y la categoría sugerida sin escribir nada) y
// la ESCRITURA (importStatements: convierte el ensayo + lo que el usuario quitó o recategorizó en
// sentencias). Aquí se ejercen las funciones REALES de n26.js contra node:sqlite — a diferencia de
// n26.test.mjs, que reproduce el pipeline a mano — con los mismos escenarios que ese fichero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { SQL } from "../../app/app/js/sql.js";
import { seedStatements } from "../../app/app/js/seeds.js";
import { planImportRows, importStatements, signedAmountCents, externalIdFor, categoryForImportedRow } from "../../app/app/js/n26.js";
import { applyProfile } from "../../app/app/js/csv-generic.js";
import { merchantMemory } from "../../app/app/js/merchant-memory.js";
import { reviewCounts, reviewDays, exitStepsAfterCommit } from "../../app/app/js/import-review.js";

const require = createRequire(import.meta.url);
const pure = require("../../app/app/vendor/pure.js");
// Globales que en el navegador carga <script src="vendor/pure.js"> (ver cabecera de n26.js).
globalThis.bcBuildExternalId = pure.bcBuildExternalId;
globalThis.bcDecideImportAction = pure.bcDecideImportAction;
globalThis.bcSanitizeCell = pure.bcSanitizeCell;

const T = "2026-08-24T18:00:00Z";
const NOW = "2026-08-24T19:00:00Z";
const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const hashFn = async (s) => sha256hex(s);

function db() {
  const d = new DatabaseSync(":memory:");
  d.exec(readFileSync(new URL("../../app/app/js/schema.sql", import.meta.url), "utf8"));
  for (const { sql, rows } of seedStatements(T)) for (const r of rows) d.prepare(sql).run(...r);
  d.prepare(`INSERT INTO accounts (id,name,type,opening_balance_cents,display_order,is_archived,created_at,updated_at,deleted)
             VALUES ('acc-n26','N26','checking',0,1,0,?,?,0)`).run(T, T);
  d.prepare(SQL.insertPeriod).run("p1", "Agosto 2026", "2026-07-27", 60, T, T);
  return d;
}

const CSV_HEADER = '"Booking Date","Value Date","Partner Name","Partner Iban","Type",'
  + '"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"';
function csvRow({ date = "2026-08-20", partner = "MERCADONA", iban = "", type = "Presentment",
  ref = "Compra tarjeta", account = "Cuenta principal", amount = "-45.20" } = {}) {
  return `"${date}","${date}","${partner}","${iban}","${type}","${ref}","${account}","${amount}","","",""`;
}
const CSV_2ROWS = [CSV_HEADER, csvRow(), csvRow({ date: "2026-08-21", partner: "MARTA G.",
  iban: "ES9121000000000000000000", type: "MoneyBeam", ref: "Bizum alquiler", amount: "360.00" })].join("\n");

/** Contexto del ensayo leído de la base de test con la MISMA SQL que usa repo.js. */
function ctxFrom(d) {
  return {
    existing: d.prepare(SQL.n26Existing).all("acc-n26").map((t) => ({
      id: t.id, dateIso: t.date, type: t.type, amountCents: signedAmountCents(t.type, t.amount_cents),
      externalId: t.external_id, status: t.status,
    })),
    memory: merchantMemory(d.prepare(SQL.merchantHistory).all(500)),
    expenseCatIds: d.prepare(SQL.listExpenseLeafCategories).all().map((c) => c.id),
    incomeCatIds: d.prepare(SQL.listIncomeCategories).all().map((c) => c.id),
  };
}

let seq = 0;
const newId = () => `tx${++seq}`;

/** Ensayo + escritura contra node:sqlite: lo mismo que runImportPipeline, en un único BEGIN/COMMIT. */
async function importRows(d, rows, choices = {}) {
  const plan = await planImportRows(rows, ctxFrom(d), { hashFn });
  const { stmts, res } = importStatements(plan, { periodId: "p1", accountId: "acc-n26", now: NOW, newId, ...choices });
  d.exec("BEGIN");
  try {
    for (const s of stmts) d.prepare(s.sql).run(...s.bind);
    d.exec("COMMIT");
  } catch (e) { d.exec("ROLLBACK"); throw e; }
  return res;
}

const n26Rows = (d) => d.prepare(`SELECT * FROM transactions WHERE account_id='acc-n26' AND deleted=0`).all();
const txCount = (d) => d.prepare(`SELECT COUNT(*) c FROM transactions`).get().c;

// ------------------------------------------------------------------ ensayo (sin escribir nada)

test("planImportRows: ensayo sobre base vacía -> 2 create, recuentos, y la base NO cambia", async () => {
  const d = db();
  const before = txCount(d);
  const rows = pure.bcParseN26Csv(CSV_2ROWS);
  const plan = await planImportRows(rows, ctxFrom(d), { hashFn });
  assert.deepEqual(plan.counts, { created: 2, reconciled: 0, skipped: 0, omitted: 0, categorized: 0 });
  assert.deepEqual(plan.items.map((i) => [i.index, i.action, i.type]), [[0, "create", "expense"], [1, "create", "income"]]);
  assert.match(plan.items[0].externalId, /^[0-9a-f]{16}$/);
  assert.equal(txCount(d), before);
});

test("planImportRows: no muta ni las filas ni el existing que recibe", async () => {
  const d = db();
  const rows = pure.bcParseN26Csv(CSV_2ROWS);
  const rowsCopy = structuredClone(rows);
  const ctx = ctxFrom(d);
  const existingCopy = structuredClone(ctx.existing);
  await planImportRows(rows, ctx, { hashFn });
  assert.deepEqual(rows, rowsCopy);
  assert.deepEqual(ctx.existing, existingCopy);
});

test("planImportRows: la categoría sugerida por la memoria de comercios viene marcada fromMemory", async () => {
  const d = db();
  d.prepare(SQL.insertTransaction).run(
    "hist1", "2026-07-01", "p1", "expense", 3000, "acc-n26", "",
    "cat-alimentacion-supermercado", "MERCADONA", "", 0, null, "me", 0, "", "", "", "hist-ext-1", 0, "reconciled", T, T);
  const plan = await planImportRows(pure.bcParseN26Csv(CSV_2ROWS), ctxFrom(d), { hashFn });
  assert.equal(plan.items[0].categoryId, "cat-alimentacion-supermercado");
  assert.equal(plan.items[0].fromMemory, true);
  assert.equal(plan.items[1].categoryId, "");
  assert.equal(plan.items[1].fromMemory, false);
  assert.equal(plan.counts.categorized, 1);
});

test("planImportRows: fila de 0,00 y fila no numérica -> action omit, sin externalId", async () => {
  const d = db();
  const text = [CSV_HEADER, csvRow(),
    csvRow({ date: "2026-08-20", partner: "N26", ref: "Comprobación", amount: "0.00" }),
    csvRow({ date: "2026-08-20", partner: "BANCO", ref: "Corrupto", amount: "no-es-un-importe" })].join("\n");
  const plan = await planImportRows(pure.bcParseN26Csv(text), ctxFrom(d), { hashFn });
  assert.deepEqual(plan.items.map((i) => i.action), ["create", "omit", "omit"]);
  assert.equal(plan.items[1].externalId, "");
  assert.deepEqual(plan.counts, { created: 1, reconciled: 0, skipped: 0, omitted: 2, categorized: 0 });
});

test("planImportRows: la misma fila dos veces en el MISMO CSV -> la 2.ª es skip (dedupe dentro del fichero)", async () => {
  const d = db();
  const text = [CSV_HEADER, csvRow(), csvRow()].join("\n");
  const plan = await planImportRows(pure.bcParseN26Csv(text), ctxFrom(d), { hashFn });
  assert.deepEqual(plan.items.map((i) => i.action), ["create", "skip"]);
});

test("planImportRows: pending manual <=3 días -> reconcile con su matchId", async () => {
  const d = db();
  d.prepare(SQL.insertTransaction).run(
    "manual1", "2026-08-19", "p1", "expense", 4520, "acc-n26", "",
    "cat-alimentacion-supermercado", "Compra en tienda", "", 0, null, "me", 0, "", "", "", "", 0, "pending", T, T);
  const plan = await planImportRows(pure.bcParseN26Csv(CSV_2ROWS), ctxFrom(d), { hashFn });
  assert.equal(plan.items[0].action, "reconcile");
  assert.equal(plan.items[0].matchId, "manual1");
  assert.deepEqual(plan.counts, { created: 1, reconciled: 1, skipped: 0, omitted: 0, categorized: 0 });
});

// ------------------------------------------------ paridad con el pipeline de siempre (n26.test)

test("paridad: import de 2 filas crea 2 reconciled sin categoría, signo/tipo/campos iguales que el pipeline", async () => {
  const d = db();
  const res = await importRows(d, pure.bcParseN26Csv(CSV_2ROWS));
  assert.deepEqual(res, { created: 2, reconciled: 0, skipped: 0, omitted: 0, categorized: 0 });
  const gasto = n26Rows(d).find((r) => r.merchant === "MERCADONA");
  assert.equal(gasto.type, "expense");
  assert.equal(gasto.amount_cents, 4520);
  assert.equal(gasto.category_id, "");
  assert.equal(gasto.status, "reconciled");
  assert.equal(gasto.note, "Compra tarjeta");
  assert.equal(gasto.period_id, "p1");
  assert.equal(gasto.tag_id, "");
  assert.equal(gasto.has_attachment, 0);
  assert.equal(gasto.created_at, NOW);
  assert.match(gasto.external_id, /^[0-9a-f]{16}$/);
  const ingreso = n26Rows(d).find((r) => r.merchant === "MARTA G.");
  assert.equal(ingreso.type, "income");
  assert.equal(ingreso.amount_cents, 36000);
});

test("paridad: re-import del mismo CSV -> 2 skipped, sin filas nuevas", async () => {
  const d = db();
  await importRows(d, pure.bcParseN26Csv(CSV_2ROWS));
  const res = await importRows(d, pure.bcParseN26Csv(CSV_2ROWS));
  assert.deepEqual(res, { created: 0, reconciled: 0, skipped: 2, omitted: 0, categorized: 0 });
  assert.equal(n26Rows(d).length, 2);
});

test("paridad: conciliar conserva categoría/comercio del pending y le pone external_id y updated_at", async () => {
  const d = db();
  d.prepare(SQL.insertTransaction).run(
    "manual1", "2026-08-19", "p1", "expense", 4520, "acc-n26", "",
    "cat-alimentacion-supermercado", "Compra en tienda", "", 0, null, "me", 0, "", "", "", "", 0, "pending", T, T);
  const res = await importRows(d, pure.bcParseN26Csv(CSV_2ROWS));
  assert.deepEqual(res, { created: 1, reconciled: 1, skipped: 0, omitted: 0, categorized: 0 });
  const manual = d.prepare(`SELECT * FROM transactions WHERE id='manual1'`).get();
  assert.equal(manual.status, "reconciled");
  assert.equal(manual.category_id, "cat-alimentacion-supermercado");
  assert.equal(manual.merchant, "Compra en tienda");
  assert.match(manual.external_id, /^[0-9a-f]{16}$/);
  assert.equal(manual.updated_at, NOW);
});

test("paridad A2: una transferencia pendiente no concilia ni el abono ajeno ni su propio cargo", async () => {
  const d = db();
  d.prepare(SQL.insertTransaction).run(
    "transfer1", "2026-08-19", "p1", "transfer", 50000, "acc-n26", "acc-ahorro",
    "", "", "Transferencia a ahorro", 0, null, "me", 0, "", "", "", "", 0, "pending", T, T);
  const text = [CSV_HEADER,
    csvRow({ date: "2026-08-20", partner: "EMPRESA SA", ref: "Nomina", amount: "500.00" }),
    csvRow({ date: "2026-08-21", partner: "N26", type: "MoneyBeam", ref: "Transferencia a ahorro", amount: "-500.00" })].join("\n");
  const res = await importRows(d, pure.bcParseN26Csv(text));
  assert.deepEqual(res, { created: 2, reconciled: 0, skipped: 0, omitted: 0, categorized: 0 });
  assert.equal(d.prepare(`SELECT status FROM transactions WHERE id='transfer1'`).get().status, "pending");
});

test("paridad M4: 0,00 y no numérico se omiten y el resto entra", async () => {
  const d = db();
  const text = [CSV_HEADER, csvRow(),
    csvRow({ date: "2026-08-20", partner: "N26", ref: "Comprobación", amount: "0.00" }),
    csvRow({ date: "2026-08-21", partner: "MARTA G.", type: "MoneyBeam", ref: "Bizum", amount: "360.00" })].join("\n");
  const res = await importRows(d, pure.bcParseN26Csv(text));
  assert.deepEqual(res, { created: 2, reconciled: 0, skipped: 0, omitted: 1, categorized: 0 });
  assert.equal(n26Rows(d).length, 2);
});

test("paridad: la memoria de comercios categoriza la fila nueva; otro tipo no cuela su categoría", async () => {
  const d = db();
  d.prepare(SQL.insertTransaction).run(
    "hist-income", "2026-07-01", "p1", "income", 5000, "acc-n26", "",
    "cat-nomina", "MERCADONA", "", 0, null, "me", 0, "", "", "", "hist-ext-income", 0, "reconciled", T, T);
  const res = await importRows(d, pure.bcParseN26Csv(CSV_2ROWS));
  assert.equal(res.categorized, 0);
  assert.equal(n26Rows(d).find((r) => r.merchant === "MERCADONA" && r.id !== "hist-income").category_id, "");
});

test("paridad CSV genérico: applyProfile + ensayo + escritura concilia y crea como el router", async () => {
  const d = db();
  d.prepare(SQL.insertTransaction).run(
    "manual1", "2026-08-19", "p1", "expense", 4520, "acc-n26", "",
    "cat-alimentacion-supermercado", "Compra en tienda", "", 0, null, "me", 0, "", "", "", "", 0, "pending", T, T);
  const profile = { headers: ["Fecha", "Concepto", "Importe"], date: "Fecha", dateFormat: "iso", concept: "Concepto",
    counterparty: null, amount: { kind: "single", col: "Importe", decimal: "," } };
  const text = ['"Fecha","Concepto","Importe"', '"2026-08-20","Compra super","-45,20"', '"2026-08-21","Nomina","1500,00"'].join("\n");
  const { rows } = applyProfile(text, profile, pure.bcParseCsvLine);
  const res = await importRows(d, rows);
  assert.deepEqual(res, { created: 1, reconciled: 1, skipped: 0, omitted: 0, categorized: 0 });
});

// ----------------------------------------------- escritura con lo que decide el usuario (B-3)

test("importStatements: una fila quitada (excluded) no se crea y no cuenta; las demás sí", async () => {
  const d = db();
  const res = await importRows(d, pure.bcParseN26Csv(CSV_2ROWS), { excluded: [1] });
  assert.deepEqual(res, { created: 1, reconciled: 0, skipped: 0, omitted: 0, categorized: 0 });
  assert.deepEqual(n26Rows(d).map((r) => r.merchant), ["MERCADONA"]);
});

test("importStatements: quitar una fila de conciliación o duplicada no tiene efecto (no son elegibles)", async () => {
  const d = db();
  d.prepare(SQL.insertTransaction).run(
    "manual1", "2026-08-19", "p1", "expense", 4520, "acc-n26", "",
    "", "Compra en tienda", "", 0, null, "me", 0, "", "", "", "", 0, "pending", T, T);
  const res = await importRows(d, pure.bcParseN26Csv(CSV_2ROWS), { excluded: [0] });
  assert.equal(res.reconciled, 1);
  assert.equal(d.prepare(`SELECT status FROM transactions WHERE id='manual1'`).get().status, "reconciled");
});

test("importStatements: categoría cambiada por el usuario gana a la sugerida y cuenta como categorizada", async () => {
  const d = db();
  const res = await importRows(d, pure.bcParseN26Csv(CSV_2ROWS), {
    categories: { 0: "cat-alimentacion-supermercado", 1: "cat-nomina" },
  });
  assert.equal(res.categorized, 2);
  const rows = n26Rows(d);
  assert.equal(rows.find((r) => r.merchant === "MERCADONA").category_id, "cat-alimentacion-supermercado");
  assert.equal(rows.find((r) => r.merchant === "MARTA G.").category_id, "cat-nomina");
});

test("importStatements: \"\" deja la fila sin categorizar aunque la memoria sugiriera una", async () => {
  const d = db();
  d.prepare(SQL.insertTransaction).run(
    "hist1", "2026-07-01", "p1", "expense", 3000, "acc-n26", "",
    "cat-alimentacion-supermercado", "MERCADONA", "", 0, null, "me", 0, "", "", "", "hist-ext-1", 0, "reconciled", T, T);
  const res = await importRows(d, pure.bcParseN26Csv(CSV_2ROWS), { categories: { 0: "" } });
  assert.equal(res.categorized, 0);
  assert.equal(n26Rows(d).find((r) => r.merchant === "MERCADONA" && r.id !== "hist1").category_id, "");
});

test("importStatements: una categoría de OTRO tipo (o inexistente) se descarta y queda la sugerida", async () => {
  const d = db();
  const res = await importRows(d, pure.bcParseN26Csv(CSV_2ROWS), { categories: { 0: "cat-nomina", 1: "no-existe" } });
  assert.equal(res.categorized, 0);
  assert.ok(n26Rows(d).every((r) => r.category_id === ""));
});

test("importStatements: re-planear contra la base ya escrita convierte un segundo commit en todo skip", async () => {
  const d = db();
  const rows = pure.bcParseN26Csv(CSV_2ROWS);
  await importRows(d, rows);
  const res = await importRows(d, rows);
  assert.equal(res.created, 0);
  assert.equal(n26Rows(d).length, 2);
});

// ------------------------------------------------------- resumen del paso de revisión (UI pura)

const fakePlan = {
  items: [
    { index: 0, action: "create", type: "expense", categoryId: "c1", fromMemory: true, row: { bookingDate: "2026-08-21", amountCents: -100 } },
    { index: 1, action: "create", type: "expense", categoryId: "", fromMemory: false, row: { bookingDate: "2026-08-20", amountCents: -200 } },
    { index: 2, action: "reconcile", type: "expense", categoryId: "", row: { bookingDate: "2026-08-20", amountCents: -300 } },
    { index: 3, action: "skip", type: "income", categoryId: "", row: { bookingDate: "2026-08-19", amountCents: 400 } },
    { index: 4, action: "omit", type: "expense", categoryId: "", row: { bookingDate: "2026-08-19", amountCents: 0 } },
    { index: 5, action: "create", type: "income", categoryId: "", fromMemory: false, row: { bookingDate: "2026-08-21", amountCents: 500 } },
  ],
  counts: { created: 3, reconciled: 1, skipped: 1, omitted: 1, categorized: 1 },
};

test("reviewCounts: sin cambios del usuario, nuevas/sin categoría/conciliadas/duplicadas", () => {
  assert.deepEqual(reviewCounts(fakePlan, {}), {
    fresh: 3, selected: 3, uncategorized: 2, reconciled: 1, skipped: 1, omitted: 1,
  });
});

test("reviewCounts: quitar filas y cambiar categorías mueve los recuentos", () => {
  assert.deepEqual(reviewCounts(fakePlan, { excluded: [5], categories: { 1: "c2", 0: "" } }), {
    fresh: 3, selected: 2, uncategorized: 1, reconciled: 1, skipped: 1, omitted: 1,
  });
});

test("reviewDays: agrupa por fecha de más reciente a más antigua; filtra por acción y sin categoría", () => {
  const days = reviewDays(fakePlan, { actions: ["create"] });
  assert.deepEqual(days.map((g) => [g.date, g.items.map((i) => i.index)]), [["2026-08-21", [0, 5]], ["2026-08-20", [1]]]);
  const unc = reviewDays(fakePlan, { actions: ["create"], onlyUncategorized: true, categories: { 1: "c2" } });
  assert.deepEqual(unc.map((g) => [g.date, g.items.map((i) => i.index)]), [["2026-08-21", [5]]]);
  const known = reviewDays(fakePlan, { actions: ["reconcile", "skip"] });
  assert.deepEqual(known.map((g) => g.items.map((i) => i.index)), [[2], [3]]);
});

// ---------------------------------------- paridad fila a fila con el pipeline ANTERIOR a B-3

/** Copia congelada del bucle de runImportPipeline tal como era antes de B-3 (hasta ce20f82): el
 *  mismo dedupe/conciliación/categoría escrito de corrido, con escritura inmediata en la lista de
 *  sentencias. Solo existe para comparar: el ensayo + la escritura nuevos deben dejar la base
 *  EXACTAMENTE igual (salvo los ids generados). */
async function legacyPipeline(d, rows) {
  const ctx = ctxFrom(d);
  const existing = ctx.existing;
  const res = { created: 0, reconciled: 0, skipped: 0, omitted: 0, categorized: 0 };
  const stmts = [];
  let n = 0;
  for (const r of rows) {
    if (r.amountCents === 0 || !Number.isFinite(r.amountCents)) { res.omitted++; continue; }
    r.externalId = await externalIdFor(r, hashFn);
    const decision = pure.bcDecideImportAction(r, existing);
    if (decision.action === "skip") res.skipped++;
    else if (decision.action === "reconcile") {
      const match = existing.find((t) => t.id === decision.matchId);
      stmts.push({ sql: SQL.reconcileTx, bind: [r.externalId, NOW, match.id] });
      match.externalId = r.externalId;
      res.reconciled++;
    } else {
      const id = `legacy${++n}`;
      const type = r.amountCents < 0 ? "expense" : "income";
      const categoryId = categoryForImportedRow(r, ctx.memory, type === "expense" ? ctx.expenseCatIds : ctx.incomeCatIds);
      if (categoryId) res.categorized++;
      stmts.push({ sql: SQL.insertTransaction, bind: [id, r.bookingDate, "p1", type, Math.abs(r.amountCents), "acc-n26", "",
        categoryId, pure.bcSanitizeCell(r.partnerName), pure.bcSanitizeCell(r.paymentReference),
        0, null, "me", 0, "", "", "", r.externalId, 0, "reconciled", NOW, NOW] });
      existing.push({ id, dateIso: r.bookingDate, type, amountCents: r.amountCents, externalId: r.externalId, status: "reconciled" });
      res.created++;
    }
  }
  d.exec("BEGIN");
  for (const s of stmts) d.prepare(s.sql).run(...s.bind);
  d.exec("COMMIT");
  return res;
}

function seedMixed(d) {
  // pending que concilia, historial que da categoría por memoria, transferencia pendiente (A2)
  d.prepare(SQL.insertTransaction).run("manual1", "2026-08-19", "p1", "expense", 4520, "acc-n26", "",
    "cat-alimentacion-supermercado", "Compra en tienda", "", 0, null, "me", 0, "", "", "", "", 0, "pending", T, T);
  d.prepare(SQL.insertTransaction).run("hist1", "2026-07-01", "p1", "expense", 3000, "acc-n26", "",
    "cat-restauracion-bares", "BAR LUNA", "", 0, null, "me", 0, "", "", "", "hist-ext-1", 0, "reconciled", T, T);
  d.prepare(SQL.insertTransaction).run("transfer1", "2026-08-19", "p1", "transfer", 50000, "acc-n26", "acc-ahorro",
    "", "", "Traspaso", 0, null, "me", 0, "", "", "", "", 0, "pending", T, T);
}
const MIXED = [CSV_HEADER, csvRow(),
  csvRow({ date: "2026-08-21", partner: "BAR LUNA", ref: "Cafe", amount: "-2.40" }),
  csvRow({ date: "2026-08-21", partner: "BAR LUNA", ref: "Cafe", amount: "-2.40" }),
  csvRow({ date: "2026-08-20", partner: "EMPRESA SA", ref: "Nomina", amount: "500.00" }),
  csvRow({ date: "2026-08-22", partner: "N26", ref: "Comprobación", amount: "0.00" }),
  csvRow({ date: "2026-08-22", partner: "=HYPERLINK(1)", ref: "+cmd", amount: "-9.99" })].join("\n");

const snapshot = (d) => d.prepare(`SELECT * FROM transactions ORDER BY date, merchant, amount_cents, id`).all()
  .map(({ id, ...rest }) => ({ ...rest, id: /^(legacy|tx)\d+$/.test(id) ? "<nuevo>" : id }));

test("paridad fila a fila: ensayo + escritura dejan la base igual que el pipeline anterior a B-3", async () => {
  const oldDb = db(); seedMixed(oldDb);
  const newDb = db(); seedMixed(newDb);
  const oldRes = await legacyPipeline(oldDb, pure.bcParseN26Csv(MIXED));
  const newRes = await importRows(newDb, pure.bcParseN26Csv(MIXED));
  assert.deepEqual(newRes, oldRes);
  assert.deepEqual(oldRes, { created: 3, reconciled: 1, skipped: 1, omitted: 1, categorized: 1 });
  assert.deepEqual(snapshot(newDb), snapshot(oldDb));
  // y un segundo import sobre cada base sigue coincidiendo (todo skip)
  assert.deepEqual(await importRows(newDb, pure.bcParseN26Csv(MIXED)), await legacyPipeline(oldDb, pure.bcParseN26Csv(MIXED)));
  assert.deepEqual(snapshot(newDb), snapshot(oldDb));
});

test("exitStepsAfterCommit: no navega si el importador ya no está; 2 desde el asistente, 1 si no", () => {
  assert.equal(exitStepsAfterCommit({ mounted: false, step: "review", fromAssistant: true }), 0);
  assert.equal(exitStepsAfterCommit({ mounted: false, step: "review", fromAssistant: false }), 0);
  assert.equal(exitStepsAfterCommit({ mounted: true, step: "review", fromAssistant: false }), 1);
  assert.equal(exitStepsAfterCommit({ mounted: true, step: "review", fromAssistant: true }), 2);
  assert.equal(exitStepsAfterCommit({ mounted: true, step: "columns", fromAssistant: true }), 1);
});
