import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { bcParseCsvLine } = require("../../app/vendor/pure.js");
import {
  sniffCsv, isN26Headers, detectDateFormat, detectDecimal, parseAmountCents,
  parseDateIso, buildProfile, applyProfile, parseCsvProfile, profileMatches,
} from "../../app/js/csv-generic.js";

// Cabeceras EXACTAS del CSV de N26 (tests/app/fixtures/n26_sample.csv línea 1).
const N26_HEADERS = ["Booking Date", "Value Date", "Partner Name", "Partner Iban", "Type",
  "Payment Reference", "Account Name", "Amount (EUR)", "Original Amount", "Original Currency", "Exchange Rate"];

// ---------------------------------------------------------------- sniffCsv

test("sniffCsv: cabeceras y muestra con comillas y comas internas", () => {
  const text = '"Fecha","Concepto, detalle","Importe"\n"2026-09-01","Compra, super","-45,20"\n"2026-09-02","Nómina","1800,00"\n';
  const { headers, sample } = sniffCsv(text, bcParseCsvLine);
  assert.deepEqual(headers, ["Fecha", "Concepto, detalle", "Importe"]);
  assert.deepEqual(sample, [
    ["2026-09-01", "Compra, super", "-45,20"],
    ["2026-09-02", "Nómina", "1800,00"],
  ]);
});

test("sniffCsv: hasta 5 filas de muestra, filas vacías fuera", () => {
  const dataRows = Array.from({ length: 7 }, (_, i) => `"2026-09-0${i + 1}","C${i}","-1,00"`);
  const text = ['"Fecha","Concepto","Importe"', dataRows[0], "", "   ", dataRows[1], dataRows[2],
    dataRows[3], dataRows[4], dataRows[5], dataRows[6]].join("\n");
  const { sample } = sniffCsv(text, bcParseCsvLine);
  assert.equal(sample.length, 5);
  assert.deepEqual(sample.map((r) => r[1]), ["C0", "C1", "C2", "C3", "C4"]);
});

// ------------------------------------------------------------ isN26Headers

test("isN26Headers: las 11 cabeceras exactas de N26 → true", () => {
  assert.equal(isN26Headers(N26_HEADERS), true);
});

test("isN26Headers: cabecera cambiada o longitud distinta → false", () => {
  const alterada = [...N26_HEADERS];
  alterada[2] = "Nombre";
  assert.equal(isN26Headers(alterada), false);
  assert.equal(isN26Headers(N26_HEADERS.slice(0, 10)), false);
});

// ------------------------------------------------------------- fechas

test("detectDateFormat: ISO, dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy", () => {
  assert.equal(detectDateFormat(["2026-09-12", "2026-01-05"]), "iso");
  assert.equal(detectDateFormat(["12/09/2026"]), "dmy-slash");
  assert.equal(detectDateFormat(["12.09.2026"]), "dmy-dot");
  assert.equal(detectDateFormat(["12-09-2026"]), "dmy-dash");
});

test("detectDateFormat: ambigüedad dd/mm — con desambiguador (día>12) y sin él, siempre día/mes (Decisión 3)", () => {
  assert.equal(detectDateFormat(["01/02/2026", "13/01/2026"]), "dmy-slash");
  assert.equal(detectDateFormat(["01/02/2026"]), "dmy-slash"); // sin desambiguador: se asume día/mes igualmente
});

test("detectDateFormat: muestra sin formato válido → null", () => {
  assert.equal(detectDateFormat(["no-es-una-fecha"]), null);
  assert.equal(detectDateFormat(["32/13/2026"]), null);
  assert.equal(detectDateFormat([]), null);
});

test("parseDateIso: convierte los 4 formatos a YYYY-MM-DD", () => {
  assert.equal(parseDateIso("2026-09-12", "iso"), "2026-09-12");
  assert.equal(parseDateIso("12/09/2026", "dmy-slash"), "2026-09-12");
  assert.equal(parseDateIso("12.09.2026", "dmy-dot"), "2026-09-12");
  assert.equal(parseDateIso("12-09-2026", "dmy-dash"), "2026-09-12");
  assert.equal(parseDateIso("2/9/2026", "dmy-slash"), "2026-09-02"); // día/mes de 1 dígito → 0-padded
});

test("parseDateIso: inválida, vacía o de otro formato → null", () => {
  assert.equal(parseDateIso("32/13/2026", "dmy-slash"), null);
  assert.equal(parseDateIso("no-es-una-fecha", "iso"), null);
  assert.equal(parseDateIso("", "iso"), null);
  assert.equal(parseDateIso("12/09/2026", "iso"), null);
});

// ------------------------------------------------------------- importes

test("detectDecimal: coma o punto, con y sin separador de miles", () => {
  assert.equal(detectDecimal(["45,20", "12,50"]), ",");
  assert.equal(detectDecimal(["45.20", "12.50"]), ".");
  assert.equal(detectDecimal(["1.234,56"]), ","); // miles con punto → decimal coma
  assert.equal(detectDecimal(["1,234.56"]), "."); // miles con coma → decimal punto
});

test("parseAmountCents: signo (guion normal y U+2212), miles tolerados en ambos sentidos", () => {
  assert.equal(parseAmountCents("−45,20", ","), -4520); // U+2212
  assert.equal(parseAmountCents("1.234,56", ","), 123456); // miles con punto
  assert.equal(parseAmountCents("45.20", "."), 4520);
  assert.equal(parseAmountCents("-45.20", "."), -4520); // guion normal
  assert.equal(parseAmountCents("1,234.56", "."), 123456); // miles con coma
});

test("parseAmountCents: basura o vacío → null", () => {
  assert.equal(parseAmountCents("no-es-un-importe", ","), null);
  assert.equal(parseAmountCents("", ","), null);
  assert.equal(parseAmountCents(null, ","), null);
  assert.equal(parseAmountCents(undefined, ","), null);
});

// ------------------------------------------------------------- buildProfile

const HEADERS_SINGLE = ["Fecha", "Concepto", "Contraparte", "Importe"];
const SAMPLE_SINGLE = [
  ["12/09/2026", "Compra super", "MERCADONA", "-45,20"],
  ["13/09/2026", "Nómina", "EMPRESA SL", "1.800,00"],
];

test("buildProfile: feliz single — autodetecta dateFormat/decimal y fija headers", () => {
  const profile = buildProfile({
    headers: HEADERS_SINGLE, date: "Fecha", concept: "Concepto", counterparty: "Contraparte",
    amountKind: "single", amountCol: "Importe", sample: SAMPLE_SINGLE,
  });
  assert.deepEqual(profile, {
    headers: HEADERS_SINGLE, date: "Fecha", dateFormat: "dmy-slash", concept: "Concepto",
    counterparty: "Contraparte", amount: { kind: "single", col: "Importe", decimal: "," },
  });
});

const HEADERS_SPLIT = ["Fecha", "Concepto", "Cargo", "Abono"];
const SAMPLE_SPLIT = [
  ["12/09/2026", "Compra super", "45,20", ""],
  ["13/09/2026", "Nómina", "", "1.800,00"],
];

test("buildProfile: feliz split — sin contraparte (counterparty null)", () => {
  const profile = buildProfile({
    headers: HEADERS_SPLIT, date: "Fecha", concept: "Concepto", counterparty: null,
    amountKind: "split", debitCol: "Cargo", creditCol: "Abono", sample: SAMPLE_SPLIT,
  });
  assert.deepEqual(profile, {
    headers: HEADERS_SPLIT, date: "Fecha", dateFormat: "dmy-slash", concept: "Concepto",
    counterparty: null, amount: { kind: "split", debit: "Cargo", credit: "Abono", decimal: "," },
  });
});

test("buildProfile: cabecera elegida inexistente → error", () => {
  const result = buildProfile({
    headers: HEADERS_SINGLE, date: "Fecha", concept: "Concepto", counterparty: "Contraparte",
    amountKind: "single", amountCol: "NoExiste", sample: SAMPLE_SINGLE,
  });
  assert.ok(result.error);
  assert.equal(result.headers, undefined);
});

test("buildProfile: muestra sin fecha válida → error", () => {
  const badSample = [["no-es-fecha", "Compra", "MERCADONA", "-45,20"]];
  const result = buildProfile({
    headers: HEADERS_SINGLE, date: "Fecha", concept: "Concepto", counterparty: "Contraparte",
    amountKind: "single", amountCol: "Importe", sample: badSample,
  });
  assert.ok(result.error);
});

test("buildProfile: counterparty vacío o ausente se normaliza a null", () => {
  const p1 = buildProfile({
    headers: HEADERS_SINGLE, date: "Fecha", concept: "Concepto", counterparty: "",
    amountKind: "single", amountCol: "Importe", sample: SAMPLE_SINGLE,
  });
  assert.equal(p1.counterparty, null);
  const p2 = buildProfile({
    headers: HEADERS_SINGLE, date: "Fecha", concept: "Concepto",
    amountKind: "single", amountCol: "Importe", sample: SAMPLE_SINGLE,
  });
  assert.equal(p2.counterparty, null);
});

test("buildProfile: cabecera vacía elegida como columna de fecha → error (si no, parseCsvProfile la rechazaría después en silencio)", () => {
  const headers = ["", "Concepto", "Importe"];
  const sample = [["12/09/2026", "Compra super", "-45,20"]];
  const result = buildProfile({
    headers, date: "", concept: "Concepto", counterparty: null,
    amountKind: "single", amountCol: "Importe", sample,
  });
  assert.ok(result.error);
  assert.equal(result.headers, undefined);
});

// ------------------------------------------------------------- applyProfile

test("applyProfile: single — filas buenas + una fila con fecha inválida a errors", () => {
  const profile = buildProfile({
    headers: HEADERS_SINGLE, date: "Fecha", concept: "Concepto", counterparty: "Contraparte",
    amountKind: "single", amountCol: "Importe", sample: SAMPLE_SINGLE,
  });
  const text = [
    '"Fecha","Concepto","Contraparte","Importe"',
    '"12/09/2026","Compra super","MERCADONA","-45,20"',
    '"13/09/2026","Nómina","EMPRESA SL","1.800,00"',
    '"32/13/2026","Fecha imposible","X","10,00"',
  ].join("\n");
  const { rows, errors } = applyProfile(text, profile, bcParseCsvLine);
  assert.deepEqual(rows, [
    { bookingDate: "2026-09-12", partnerName: "MERCADONA", paymentReference: "Compra super", amountCents: -4520 },
    { bookingDate: "2026-09-13", partnerName: "EMPRESA SL", paymentReference: "Nómina", amountCents: 180000 },
  ]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 4);
  assert.ok(errors[0].reason);
});

test("applyProfile: split — cargo (positivo o ya negativo) = gasto, abono = ingreso, ambos vacíos/con valor → errors", () => {
  const profile = buildProfile({
    headers: HEADERS_SPLIT, date: "Fecha", concept: "Concepto", counterparty: null,
    amountKind: "split", debitCol: "Cargo", creditCol: "Abono", sample: SAMPLE_SPLIT,
  });
  const text = [
    '"Fecha","Concepto","Cargo","Abono"',
    '"12/09/2026","Compra super","45,20",""',
    '"13/09/2026","Devolución cargo","−45,20",""',
    '"14/09/2026","Nómina","","1.800,00"',
    '"15/09/2026","Fila vacía","",""',
    '"16/09/2026","Fila doble","10,00","5,00"',
  ].join("\n");
  const { rows, errors } = applyProfile(text, profile, bcParseCsvLine);
  assert.deepEqual(rows, [
    { bookingDate: "2026-09-12", partnerName: "", paymentReference: "Compra super", amountCents: -4520 },
    { bookingDate: "2026-09-13", partnerName: "", paymentReference: "Devolución cargo", amountCents: -4520 },
    { bookingDate: "2026-09-14", partnerName: "", paymentReference: "Nómina", amountCents: 180000 },
  ]);
  assert.equal(errors.length, 2);
  assert.deepEqual(errors.map((e) => e.line), [5, 6]);
});

// ------------------------------------------------------------- parseCsvProfile

const VALID_PROFILE_SINGLE = {
  headers: HEADERS_SINGLE, date: "Fecha", dateFormat: "dmy-slash", concept: "Concepto",
  counterparty: "Contraparte", amount: { kind: "single", col: "Importe", decimal: "," },
};
const VALID_PROFILE_SPLIT = {
  headers: HEADERS_SPLIT, date: "Fecha", dateFormat: "iso", concept: "Concepto",
  counterparty: null, amount: { kind: "split", debit: "Cargo", credit: "Abono", decimal: "." },
};

test("parseCsvProfile: JSON válido (single y split con counterparty null) → profile", () => {
  assert.deepEqual(parseCsvProfile(JSON.stringify(VALID_PROFILE_SINGLE)), VALID_PROFILE_SINGLE);
  assert.deepEqual(parseCsvProfile(JSON.stringify(VALID_PROFILE_SPLIT)), VALID_PROFILE_SPLIT);
});

test("parseCsvProfile: JSON corrupto, forma incompleta o con claves extra → null", () => {
  assert.equal(parseCsvProfile("{esto no es json"), null);
  const { concept, ...sinConcept } = VALID_PROFILE_SINGLE;
  assert.equal(parseCsvProfile(JSON.stringify(sinConcept)), null);
  assert.equal(parseCsvProfile(JSON.stringify({ ...VALID_PROFILE_SINGLE, extra: "sobra" })), null);
});

test("parseCsvProfile: kind desconocido, dateFormat fuera del enum, counterparty vacío o no-objeto → null", () => {
  assert.equal(parseCsvProfile(JSON.stringify({ ...VALID_PROFILE_SINGLE,
    amount: { kind: "triple", col: "Importe", decimal: "," } })), null);
  assert.equal(parseCsvProfile(JSON.stringify({ ...VALID_PROFILE_SINGLE, dateFormat: "yyyy/mm/dd" })), null);
  assert.equal(parseCsvProfile(JSON.stringify({ ...VALID_PROFILE_SINGLE, counterparty: "" })), null);
  assert.equal(parseCsvProfile("[1,2,3]"), null);
  assert.equal(parseCsvProfile("42"), null);
  assert.equal(parseCsvProfile("null"), null);
});

test("parseCsvProfile: __proto__ como clave se rechaza y no contamina Object.prototype", () => {
  const raw = '{"headers":["A"],"date":"A","dateFormat":"iso","concept":"A","counterparty":null,' +
    '"amount":{"kind":"single","col":"A","decimal":","},"__proto__":{"polluted":true}}';
  assert.equal(parseCsvProfile(raw), null);
  assert.equal({}.polluted, undefined);
});

test("parseCsvProfile: date no está en headers (perfil por lo demás válido) → null", () => {
  assert.equal(parseCsvProfile(JSON.stringify({ ...VALID_PROFILE_SINGLE, date: "OtraFecha" })), null);
});

test("parseCsvProfile: amount.col === \"\" → null", () => {
  assert.equal(parseCsvProfile(JSON.stringify({ ...VALID_PROFILE_SINGLE,
    amount: { kind: "single", col: "", decimal: "," } })), null);
});

test("parseCsvProfile: amount.kind === \"split\" y debit no está en headers → null", () => {
  assert.equal(parseCsvProfile(JSON.stringify({ ...VALID_PROFILE_SPLIT,
    amount: { kind: "split", debit: "NoExiste", credit: "Abono", decimal: "." } })), null);
});

// ------------------------------------------------------------- profileMatches

test("profileMatches: igualdad exacta del array de cabeceras, orden incluido", () => {
  const profile = { headers: ["A", "B", "C"] };
  assert.equal(profileMatches(profile, ["A", "B", "C"]), true);
  assert.equal(profileMatches(profile, ["A", "C", "B"]), false);
  assert.equal(profileMatches(profile, ["A", "B"]), false);
  assert.equal(profileMatches(profile, ["A", "B", "C", "D"]), false);
});
