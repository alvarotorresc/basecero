import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { SQL } from "../../app/js/sql.js";
import { seedStatements } from "../../app/js/seeds.js";
import { sha256Hex, externalIdFor } from "../../app/js/n26.js";
import { sniffCsv, isN26Headers, applyProfile, parseCsvProfile, profileMatches } from "../../app/js/csv-generic.js";

const require = createRequire(import.meta.url);
const pure = require("../../app/vendor/pure.js");

// app/js/n26.js llama a bcBuildExternalId como GLOBAL (lo carga <script src="vendor/pure.js">
// en el navegador, sin import — ver cabecera de n26.js). Aquí se importa el mismo
// app/vendor/pure.js vía CommonJS (require, no globales); se expone la única función de pure.js
// que n26.js invoca de verdad (externalIdFor) para que funcione igual bajo Node.
globalThis.bcBuildExternalId = pure.bcBuildExternalId;

const T = "2026-08-24T18:00:00Z";
const NOW = "2026-08-24T19:00:00Z";
// hash síncrono determinista para los tests que no quieren depender de crypto.subtle (async) —
// mismo patrón que tests/app/pure.test.mjs.
const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");

function db() {
  const d = new DatabaseSync(":memory:");
  d.exec(readFileSync(new URL("../../app/js/schema.sql", import.meta.url), "utf8"));
  for (const { sql, rows } of seedStatements(T)) for (const r of rows) d.prepare(sql).run(...r);
  d.prepare(`INSERT INTO accounts (id,name,type,opening_balance_cents,display_order,is_archived,created_at,updated_at,deleted)
             VALUES ('acc-n26','N26','checking',0,1,0,?,?,0)`).run(T, T);
  d.prepare(SQL.insertPeriod).run("p1", "Agosto 2026", "2026-07-27", 60, T, T);
  return d;
}

/** Misma base que db() pero SIN periodo abierto — para el test del guard temprano de importCsv. */
function dbNoPeriod() {
  const d = new DatabaseSync(":memory:");
  d.exec(readFileSync(new URL("../../app/js/schema.sql", import.meta.url), "utf8"));
  for (const { sql, rows } of seedStatements(T)) for (const r of rows) d.prepare(sql).run(...r);
  d.prepare(`INSERT INTO accounts (id,name,type,opening_balance_cents,display_order,is_archived,created_at,updated_at,deleted)
             VALUES ('acc-n26','N26','checking',0,1,0,?,?,0)`).run(T, T);
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

/** Reproduce runImportPipeline (app/js/n26.js, extraída en Task 5 PR E del cuerpo de
 *  importN26Csv) contra node:sqlite: no hay Worker disponible en Node (db.js depende de él),
 *  así que — mismo patrón que el resto de tests/app/*.test.mjs (repo-sql, recurrentes...) — se
 *  compone la SQL a mano en vez de invocar repo.js/n26.js directamente. `rows` ya viene parseado
 *  (misma forma que produce pure.bcParseN26Csv o csv-generic.applyProfile). Usa las MISMAS
 *  funciones puras que la implementación real: pure.bcDecideImportAction (app/vendor/pure.js) y
 *  el externalIdFor REAL de n26.js (adaptador de captura incluido). */
async function runPipeline(d, rows, hashFn = sha256hex) {
  const existing = d.prepare(SQL.n26Existing).all("acc-n26").map((t) => ({
    id: t.id, dateIso: t.date, type: t.type,
    amountCents: Math.abs(t.amount_cents) * (t.type === "expense" ? -1 : 1),
    externalId: t.external_id, status: t.status,
  }));
  const res = { created: 0, reconciled: 0, skipped: 0 };
  for (const r of rows) {
    r.externalId = await externalIdFor(r, hashFn);
    const decision = pure.bcDecideImportAction(r, existing);
    if (decision.action === "skip") {
      res.skipped++;
    } else if (decision.action === "reconcile") {
      const match = existing.find((t) => t.id === decision.matchId);
      d.prepare(SQL.reconcileTx).run(r.externalId, NOW, match.id);
      match.externalId = r.externalId;
      res.reconciled++;
    } else {
      const id = "tx" + Math.floor(Math.random() * 1e9);
      const type = r.amountCents < 0 ? "expense" : "income";
      d.prepare(SQL.insertTransaction).run(id, r.bookingDate, "p1", type, Math.abs(r.amountCents),
        "acc-n26", "", "", pure.bcSanitizeCell(r.partnerName), pure.bcSanitizeCell(r.paymentReference),
        0, null, 0, "", "", r.externalId, "reconciled", NOW, NOW);
      existing.push({ id, dateIso: r.bookingDate, type, amountCents: r.amountCents,
        externalId: r.externalId, status: "reconciled" });
      res.created++;
    }
  }
  return res;
}

/** Reproduce el flujo de n26.importN26Csv: parsea con pure.bcParseN26Csv y entra al pipeline. */
async function runImport(d, text, hashFn = sha256hex) {
  return runPipeline(d, pure.bcParseN26Csv(text), hashFn);
}

const metaValue = (d, key) => d.prepare(`SELECT value FROM meta WHERE key=?`).get(key).value;
const setMetaValue = (d, key, value) => d.prepare(`UPDATE meta SET value=? WHERE key=?`).run(value, key);

/** Reproduce n26.importCsv (router de Task 5, PR E) contra node:sqlite, mismo patrón que
 *  runImport/runPipeline: sniff con pure.bcParseCsvLine, N26 → runImport; si no, perfil guardado
 *  en meta.csv_profile (leído a mano, sin repo.js) + profileMatches → applyProfile + runPipeline;
 *  si no hay match → needsMapping SIN tocar la base de datos (ni siquiera se llega a leer meta si
 *  ya hace falta la comprobación N26, pero tampoco se escribe nada en ningún camino). */
async function runImportRouter(d, text, hashFn = sha256hex) {
  // Guard temprano (ruling de la review de Task 5, replicado del importCsv real de n26.js): sin
  // periodo abierto, ni siquiera CSV basura irreconocible llega al sniff.
  if (!d.prepare(SQL.getOpenPeriod).get()) throw new Error("No hay ningún periodo abierto");
  const { headers, sample } = sniffCsv(text, pure.bcParseCsvLine);
  if (isN26Headers(headers)) {
    const res = await runImport(d, text, hashFn);
    return { ...res, via: "n26" };
  }

  const profile = parseCsvProfile(metaValue(d, "csv_profile"));
  if (profile && profileMatches(profile, headers)) {
    const { rows, errors } = applyProfile(text, profile, pure.bcParseCsvLine);
    const res = await runPipeline(d, rows, hashFn);
    return { ...res, via: "profile", omitted: errors.length };
  }

  return { needsMapping: { headers, sample } };
}

const n26Rows = (d) => d.prepare(`SELECT * FROM transactions WHERE account_id='acc-n26' AND deleted=0`).all();
const txCount = (d) => d.prepare(`SELECT COUNT(*) c FROM transactions`).get().c;

test("import CSV de 2 filas sobre base vacía: 2 creadas reconciled sin categoría, signo/tipo correctos", async () => {
  const d = db();
  const res = await runImport(d, CSV_2ROWS);
  assert.deepEqual(res, { created: 2, reconciled: 0, skipped: 0 });

  const rows = n26Rows(d);
  assert.equal(rows.length, 2);

  const gasto = rows.find((r) => r.merchant === "MERCADONA");
  assert.equal(gasto.type, "expense");
  assert.equal(gasto.amount_cents, 4520);
  assert.equal(gasto.category_id, "");
  assert.equal(gasto.status, "reconciled");
  assert.equal(gasto.note, "Compra tarjeta");
  assert.equal(gasto.period_id, "p1");
  assert.match(gasto.external_id, /^[0-9a-f]{16}$/);

  const ingreso = rows.find((r) => r.merchant === "MARTA G.");
  assert.equal(ingreso.type, "income");
  assert.equal(ingreso.amount_cents, 36000);
  assert.equal(ingreso.category_id, "");
  assert.equal(ingreso.status, "reconciled");
});

test("re-import del mismo CSV: 2 duplicadas (saltadas), sin filas nuevas", async () => {
  const d = db();
  await runImport(d, CSV_2ROWS);
  const res = await runImport(d, CSV_2ROWS);
  assert.deepEqual(res, { created: 0, reconciled: 0, skipped: 2 });
  assert.equal(n26Rows(d).length, 2);
});

test("fila que casa con un pending manual ≤3 días: reconciled, conserva categoría/comercio, gana external_id", async () => {
  const d = db();
  const T2 = "2026-08-19T10:00:00Z";
  d.prepare(SQL.insertTransaction).run(
    "manual1", "2026-08-19", "p1", "expense", 4520, "acc-n26", "",
    "cat-alimentacion-supermercado", "Compra en tienda", "", 0, null, 0, "", "", "", "pending", T2, T2);

  const res = await runImport(d, CSV_2ROWS);
  // Fila 1 (MERCADONA, -45.20, 2026-08-20) casa con manual1 (mismo importe, expense, 1 día de
  // diferencia); fila 2 (MARTA G., +360.00) no tiene con qué casar -> create.
  assert.deepEqual(res, { created: 1, reconciled: 1, skipped: 0 });
  assert.equal(n26Rows(d).length, 2);

  const manual = d.prepare(`SELECT * FROM transactions WHERE id='manual1'`).get();
  assert.equal(manual.status, "reconciled");
  assert.equal(manual.category_id, "cat-alimentacion-supermercado");
  assert.equal(manual.merchant, "Compra en tienda");
  assert.equal(manual.amount_cents, 4520);
  assert.equal(manual.date, "2026-08-19");
  assert.match(manual.external_id, /^[0-9a-f]{16}$/);
  assert.equal(manual.updated_at, NOW);
});

test("externalIdFor reproduce el payload de pure.js (mismo hashFn síncrono directo)", async () => {
  const row = { bookingDate: "2026-08-20", amountCents: -4520, partnerName: "MERCADONA", paymentReference: "Compra tarjeta" };
  const expected = pure.bcBuildExternalId(row.bookingDate, row.amountCents, row.partnerName, row.paymentReference, sha256hex);
  const actual = await externalIdFor(row, sha256hex);
  assert.equal(actual, expected);
  assert.match(actual, /^[0-9a-f]{16}$/);
});

test("sha256Hex: vector conocido sha256('abc')", async () => {
  const hex = await sha256Hex("abc");
  assert.ok(hex.startsWith("ba7816bf"));
});

test("parseN26Csv: cabecera no reconocida lanza error (propagado a importN26Csv)", () => {
  assert.throws(() => pure.bcParseN26Csv('"foo","bar"\n"1","2"'), /Cabecera CSV de N26 no reconocida/);
});

// -------------------------------------------------------------- router (importCsv, Task 5 PR E)

const PROFILE = {
  headers: ["Fecha", "Concepto", "Importe"],
  date: "Fecha",
  dateFormat: "iso",
  concept: "Concepto",
  counterparty: null,
  amount: { kind: "single", col: "Importe", decimal: "," },
};

function genericRow({ date = "2026-08-20", concept = "Compra super", amount = "-45,20" } = {}) {
  return `"${date}","${concept}","${amount}"`;
}

const GENERIC_HEADER = '"Fecha","Concepto","Importe"';
const GENERIC_2ROWS = [GENERIC_HEADER, genericRow(),
  genericRow({ date: "2026-08-21", concept: "Nomina", amount: "1500,00" })].join("\n");

test("importCsv (router): cabeceras N26 -> mismo resultado que importN26Csv, via:'n26'", async () => {
  const d = db();
  const res = await runImportRouter(d, CSV_2ROWS);
  assert.deepEqual(res, { created: 2, reconciled: 0, skipped: 0, via: "n26" });
  assert.equal(n26Rows(d).length, 2);
});

test("importCsv (router): cabeceras desconocidas sin perfil -> needsMapping con headers+sample, cero inserciones", async () => {
  const d = db();
  assert.equal(metaValue(d, "csv_profile"), ""); // valor por defecto de schema.sql: sin perfil guardado
  const res = await runImportRouter(d, GENERIC_2ROWS);
  assert.deepEqual(res, {
    needsMapping: {
      headers: ["Fecha", "Concepto", "Importe"],
      sample: [["2026-08-20", "Compra super", "-45,20"], ["2026-08-21", "Nomina", "1500,00"]],
    },
  });
  assert.equal(txCount(d), 0);
});

test("importCsv (router): perfil guardado que NO matchea las cabeceras -> needsMapping", async () => {
  const d = db();
  setMetaValue(d, "csv_profile", JSON.stringify({ ...PROFILE, headers: ["Otra", "Cosa"] }));
  const res = await runImportRouter(d, GENERIC_2ROWS);
  assert.ok(res.needsMapping);
  assert.deepEqual(res.needsMapping.headers, ["Fecha", "Concepto", "Importe"]);
  assert.equal(txCount(d), 0);
});

test("importCsv (router): perfil que matchea -> crea y concilia por el pipeline compartido", async () => {
  const d = db();
  setMetaValue(d, "csv_profile", JSON.stringify(PROFILE));
  const T2 = "2026-08-19T10:00:00Z";
  d.prepare(SQL.insertTransaction).run(
    "manual1", "2026-08-19", "p1", "expense", 4520, "acc-n26", "",
    "cat-alimentacion-supermercado", "Compra en tienda", "", 0, null, 0, "", "", "", "pending", T2, T2);

  const res = await runImportRouter(d, GENERIC_2ROWS);
  // Fila 1 (Compra super, -45,20, 2026-08-20) casa con manual1 (mismo importe, expense, 1 día de
  // diferencia); fila 2 (Nomina, +1500,00) no tiene con qué casar -> create.
  assert.deepEqual(res, { created: 1, reconciled: 1, skipped: 0, via: "profile", omitted: 0 });
  assert.equal(n26Rows(d).length, 2);

  const manual = d.prepare(`SELECT * FROM transactions WHERE id='manual1'`).get();
  assert.equal(manual.status, "reconciled");
  assert.equal(manual.category_id, "cat-alimentacion-supermercado"); // conciliación conserva categoría/comercio
  assert.match(manual.external_id, /^[0-9a-f]{16}$/);
});

test("importCsv (router): reimportar el MISMO texto -> dedupe por external_id, todo skipped", async () => {
  const d = db();
  setMetaValue(d, "csv_profile", JSON.stringify(PROFILE));
  const first = await runImportRouter(d, GENERIC_2ROWS);
  assert.deepEqual(first, { created: 2, reconciled: 0, skipped: 0, via: "profile", omitted: 0 });

  const second = await runImportRouter(d, GENERIC_2ROWS);
  assert.deepEqual(second, { created: 0, reconciled: 0, skipped: 2, via: "profile", omitted: 0 });
  assert.equal(n26Rows(d).length, 2);
});

test("importCsv (router): sin periodo abierto, ni un CSV basura llega al sniff — gana el mensaje de periodo", async () => {
  const d = dbNoPeriod();
  await assert.rejects(
    () => runImportRouter(d, "esto,no,es,csv,de,ningun,banco\n1,2,3,4,5,6,7"),
    /No hay ningún periodo abierto/,
  );
});

test("importCsv (router): filas con fecha/importe inválidos van a omitted, el resto se importa", async () => {
  const d = db();
  setMetaValue(d, "csv_profile", JSON.stringify(PROFILE));
  const text = [GENERIC_HEADER, genericRow(), genericRow({ date: "no-es-fecha", concept: "Fila mala" }),
    genericRow({ date: "2026-08-22", concept: "Importe malo", amount: "no-es-importe" }),
    genericRow({ date: "2026-08-21", concept: "Nomina", amount: "1500,00" })].join("\n");

  const res = await runImportRouter(d, text);
  assert.deepEqual(res, { created: 2, reconciled: 0, skipped: 0, via: "profile", omitted: 2 });
  assert.equal(n26Rows(d).length, 2);
});
