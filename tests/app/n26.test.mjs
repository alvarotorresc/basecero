import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { SQL } from "../../app/app/js/sql.js";
import { seedStatements } from "../../app/app/js/seeds.js";
import { sha256Hex, externalIdFor, signedAmountCents } from "../../app/app/js/n26.js";
import { sniffCsv, isN26Headers, applyProfile, parseCsvProfile, profileMatches } from "../../app/app/js/csv-generic.js";

const require = createRequire(import.meta.url);
const pure = require("../../app/app/vendor/pure.js");

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
  d.exec(readFileSync(new URL("../../app/app/js/schema.sql", import.meta.url), "utf8"));
  for (const { sql, rows } of seedStatements(T)) for (const r of rows) d.prepare(sql).run(...r);
  d.prepare(`INSERT INTO accounts (id,name,type,opening_balance_cents,display_order,is_archived,created_at,updated_at,deleted)
             VALUES ('acc-n26','N26','checking',0,1,0,?,?,0)`).run(T, T);
  d.prepare(SQL.insertPeriod).run("p1", "Agosto 2026", "2026-07-27", 60, T, T);
  return d;
}

/** Misma base que db() pero SIN periodo abierto — para el test del guard temprano de importCsv. */
function dbNoPeriod() {
  const d = new DatabaseSync(":memory:");
  d.exec(readFileSync(new URL("../../app/app/js/schema.sql", import.meta.url), "utf8"));
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
 *  funciones puras que la implementación real: pure.bcDecideImportAction (app/vendor/pure.js), el
 *  signedAmountCents/externalIdFor REALES de n26.js (adaptador de captura incluido).
 *  M4 (Task 5, PR fix-security): las sentencias se acumulan y se ejecutan en un ÚNICO
 *  BEGIN/COMMIT/ROLLBACK al final — mismo patrón que db-worker.js execMany (app/js/db-worker.js) —
 *  en vez de un `.run()` inmediato por fila. Antes de este cambio el harness NO reproducía el
 *  bug real (una fila que violase el CHECK solo tiraba ESA fila, las anteriores ya habían
 *  quedado commiteadas); con el batching, una fila que lanza en medio del bucle revierte TODO el
 *  import, igual que en producción — condición necesaria para poder testear el fix de M4 (saltar
 *  la fila mala en vez de dejar que reviente el execMany). No cambia el resultado de NINGÚN test
 *  preexistente: ninguno provoca hoy un throw a mitad de bucle, y el estado final tras un import
 *  con éxito es idéntico (todo commiteado de una vez o fila a fila da el mismo resultado si nada
 *  falla). */
async function runPipeline(d, rows, hashFn = sha256hex) {
  const existing = d.prepare(SQL.n26Existing).all("acc-n26").map((t) => ({
    id: t.id, dateIso: t.date, type: t.type,
    amountCents: signedAmountCents(t.type, t.amount_cents),
    externalId: t.external_id, status: t.status,
  }));
  const res = { created: 0, reconciled: 0, skipped: 0, omitted: 0 };
  const stmts = [];
  for (const r of rows) {
    // M4: fila de 0,00 (verificación de tarjeta) o importe no numérico (CSV corrupto) — se
    // salta ANTES de decide/externalIdFor, se cuenta en omitted, no bloquea el resto.
    if (r.amountCents === 0 || !Number.isFinite(r.amountCents)) { res.omitted++; continue; }
    r.externalId = await externalIdFor(r, hashFn);
    const decision = pure.bcDecideImportAction(r, existing);
    if (decision.action === "skip") {
      res.skipped++;
    } else if (decision.action === "reconcile") {
      const match = existing.find((t) => t.id === decision.matchId);
      stmts.push({ sql: SQL.reconcileTx, bind: [r.externalId, NOW, match.id] });
      match.externalId = r.externalId;
      res.reconciled++;
    } else {
      const id = "tx" + Math.floor(Math.random() * 1e9);
      const type = r.amountCents < 0 ? "expense" : "income";
      stmts.push({ sql: SQL.insertTransaction, bind: [id, r.bookingDate, "p1", type, Math.abs(r.amountCents),
        "acc-n26", "", "", pure.bcSanitizeCell(r.partnerName), pure.bcSanitizeCell(r.paymentReference),
        0, null, 0, "", "", r.externalId, "reconciled", NOW, NOW] });
      existing.push({ id, dateIso: r.bookingDate, type, amountCents: r.amountCents,
        externalId: r.externalId, status: "reconciled" });
      res.created++;
    }
  }
  d.exec("BEGIN");
  try {
    for (const s of stmts) d.prepare(s.sql).run(...s.bind);
    d.exec("COMMIT");
  } catch (e) { d.exec("ROLLBACK"); throw e; }
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
    // M4: res.omitted (filas de 0,00/no numéricas descartadas DENTRO del pipeline) se SUMA a
    // errors.length (fecha/importe irreconocibles por applyProfile), nunca se pisa — mismo fix
    // que importWithProfile en n26.js.
    return { ...res, via: "profile", omitted: res.omitted + errors.length };
  }

  return { needsMapping: { headers, sample } };
}

const n26Rows = (d) => d.prepare(`SELECT * FROM transactions WHERE account_id='acc-n26' AND deleted=0`).all();
const txCount = (d) => d.prepare(`SELECT COUNT(*) c FROM transactions`).get().c;

test("import CSV de 2 filas sobre base vacía: 2 creadas reconciled sin categoría, signo/tipo correctos", async () => {
  const d = db();
  const res = await runImport(d, CSV_2ROWS);
  assert.deepEqual(res, { created: 2, reconciled: 0, skipped: 0, omitted: 0 });

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
  assert.deepEqual(res, { created: 0, reconciled: 0, skipped: 2, omitted: 0 });
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
  assert.deepEqual(res, { created: 1, reconciled: 1, skipped: 0, omitted: 0 });
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

test("A2: transferencia pendiente NO se traga un abono ajeno, y su propio cargo bancario tampoco reconcilia contra ella", async () => {
  const d = db();
  const T2 = "2026-08-19T10:00:00Z";
  // Transferencia manual pendiente de 500€ (dinero saliente de acc-n26 hacia otra cuenta).
  d.prepare(SQL.insertTransaction).run(
    "transfer1", "2026-08-19", "p1", "transfer", 50000, "acc-n26", "acc-ahorro",
    "", "", "Transferencia a ahorro", 0, null, 0, "", "", "", "pending", T2, T2);

  const text = [CSV_HEADER,
    // Fila 1: abono AJENO de 500€ (p.ej. nómina) a 1 día de la transferencia — hoy (bug A2-a)
    // reconcilia contra transfer1 y el ingreso se pierde en silencio.
    csvRow({ date: "2026-08-20", partner: "EMPRESA SA", ref: "Nomina", amount: "500.00" }),
    // Fila 2: el cargo bancario REAL de la transferencia (-500€) a 2 días — hoy (bug A2-b), como
    // transfer1 ya quedó marcada por la fila 1, esta fila no encuentra candidato y se crea como
    // gasto duplicado sin categoría (la cuenta queda debitada dos veces: transfer1 + este gasto).
    csvRow({ date: "2026-08-21", partner: "N26", type: "MoneyBeam", ref: "Transferencia a ahorro", amount: "-500.00" }),
  ].join("\n");

  const res = await runImport(d, text);
  // Con el fix: NINGUNA fila reconcilia contra transfer1 (excluida de candidatura por tipo) —
  // ambas se crean como filas nuevas independientes.
  assert.deepEqual(res, { created: 2, reconciled: 0, skipped: 0, omitted: 0 });

  const transfer = d.prepare(`SELECT * FROM transactions WHERE id='transfer1'`).get();
  assert.equal(transfer.status, "pending"); // intacta: ninguna fila del CSV la ha tocado
  assert.equal(transfer.external_id, "");

  const rows = n26Rows(d);
  assert.equal(rows.length, 3); // transfer1 (preexistente) + las 2 filas nuevas creadas por el import
  const ingreso = rows.find((r) => r.type === "income");
  assert.equal(ingreso.amount_cents, 50000);
  assert.equal(ingreso.merchant, "EMPRESA SA"); // el abono NO se pierde: se crea con su propio dato
  const gasto = rows.find((r) => r.type === "expense");
  assert.equal(gasto.amount_cents, 50000);
  // Residual aceptado (ver report/concerns): el cargo bancario de la transferencia (fila 2) se
  // crea como gasto NUEVO sin categoría — sigue sin auto-reconciliar contra transfer1, que
  // permanece pendiente para siempre vía este pipeline (excluir transfers de la conciliación es
  // el fix elegido por el hallazgo, no "casarlos con el signo correcto"). Requiere limpieza
  // manual del usuario (borrar/ajustar transfer1 o el gasto nuevo). Lo que el fix SÍ elimina es
  // la pérdida silenciosa de dinero (bug A2-a) y la contaminación cruzada de external_id — el
  // bug real que motivó el hallazgo.
});

test("signedAmountCents: transfer es dinero saliente (signo negativo), igual que expense; income mantiene signo positivo", () => {
  assert.equal(signedAmountCents("expense", 50000), -50000);
  assert.equal(signedAmountCents("transfer", 50000), -50000);
  assert.equal(signedAmountCents("income", 50000), 50000);
});

test("import CSV con una fila de 0,00 (verificación de tarjeta, M4): se omite y se cuenta en omitted, el resto se importa", async () => {
  const d = db();
  const text = [CSV_HEADER, csvRow(),
    csvRow({ date: "2026-08-20", partner: "N26", ref: "Comprobación de tarjeta", amount: "0.00" }),
    csvRow({ date: "2026-08-21", partner: "MARTA G.", iban: "ES9121000000000000000000",
      type: "MoneyBeam", ref: "Bizum alquiler", amount: "360.00" }),
  ].join("\n");
  const res = await runImport(d, text);
  assert.deepEqual(res, { created: 2, reconciled: 0, skipped: 0, omitted: 1 });
  assert.equal(n26Rows(d).length, 2); // las 2 filas válidas SÍ entran — antes revertía el import entero
});

test("import CSV con una fila de importe no numérico (M4, ruta N26): se omite y se cuenta en omitted, el resto se importa", async () => {
  const d = db();
  const text = [CSV_HEADER, csvRow(),
    csvRow({ date: "2026-08-20", partner: "BANCO", ref: "Importe corrupto", amount: "no-es-un-importe" }),
    csvRow({ date: "2026-08-21", partner: "MARTA G.", iban: "ES9121000000000000000000",
      type: "MoneyBeam", ref: "Bizum alquiler", amount: "360.00" }),
  ].join("\n");
  const res = await runImport(d, text);
  assert.deepEqual(res, { created: 2, reconciled: 0, skipped: 0, omitted: 1 });
  assert.equal(n26Rows(d).length, 2);
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
  assert.deepEqual(res, { created: 2, reconciled: 0, skipped: 0, omitted: 0, via: "n26" });
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
