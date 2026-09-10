import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNaturalExpense, RULES_BY_LANG } from "../../app/app/js/natural.js";

// today fijo: miércoles 2026-09-09 (spec §8.1/§11) — así ayer/anteayer/el-lunes se pueden afirmar
// con igualdad estricta, nunca con new Date() real.
const TODAY = "2026-09-09";

const CATS = [
  { id: "cat-restauracion", name: "Restauración" },
  { id: "cat-salud", name: "Salud" },
  { id: "cat-alimentacion", name: "Alimentación" },
];
const ACCOUNTS = [
  { id: "acc-n26", name: "N26" },
  { id: "acc-efectivo", name: "Efectivo" },
];

function parse(text, opts = {}) {
  return parseNaturalExpense(text, {
    categories: CATS, accounts: ACCOUNTS, merchants: {}, counterpartName: "Marta", today: TODAY, lang: "es",
    ...opts,
  });
}

// ------------------------------------------------------------------ R1/R3/R4: importes cerrados

test("R1: «12,50 en el bar» -> 1250, comercio bar", () => {
  const r = parse("12,50 en el bar");
  assert.equal(r.cents, 1250);
  assert.equal(r.merchant, "bar");
});

test("R1: «12.50 en el bar» (punto) -> 1250", () => {
  assert.equal(parse("12.50 en el bar").cents, 1250);
});

test("R3: «12 con 50 en el bar con Marta» -> 1250, comercio bar, compartido — protege el orden de resolución (importe antes que compartido)", () => {
  const r = parse("12 con 50 en el bar con Marta");
  assert.equal(r.cents, 1250);
  assert.equal(r.merchant, "bar");
  assert.equal(r.shared, true);
});

test("frase del artboard: «45,20 en el Bar La Plaza con Marta» -> comercio «Bar La Plaza», NO «Bar La Plaza con Marta»", () => {
  const r = parse("45,20 en el Bar La Plaza con Marta");
  assert.equal(r.cents, 4520);
  assert.equal(r.merchant, "Bar La Plaza");
  assert.equal(r.shared, true);
});

test("R3: «12 con 5» -> 1205 (los céntimos se leen literales, no es 12,50)", () => {
  assert.equal(parse("12 con 5").cents, 1205);
});

test("R3: «12 y 50» -> 1250 (y también separa céntimos)", () => {
  assert.equal(parse("12 y 50").cents, 1250);
});

test("R3: «doce con cincuenta» (importe y céntimos en palabras) -> 1250", () => {
  assert.equal(parse("doce con cincuenta").cents, 1250);
});

test("«doce cincuenta en el bar» (dos números sin con/y) -> 1200 y «cincuenta» se ignora — decisión fijada, no un olvido", () => {
  const r = parse("doce cincuenta en el bar");
  assert.equal(r.cents, 1200);
  assert.equal(r.merchant, "bar");
});

test("«cuarenta y cinco con veinte» -> 4520 (números en palabras con compuesto treinta+y+unidad)", () => {
  assert.equal(parse("cuarenta y cinco con veinte").cents, 4520);
});

test("R2: «12€ en el bar» -> 1200 (símbolo pegado, sin céntimos)", () => {
  assert.equal(parse("12€ en el bar").cents, 1200);
});

test("R2: «12 euros en el bar» -> 1200", () => {
  assert.equal(parse("12 euros en el bar").cents, 1200);
});

test("R4: «20 en el bar» (número suelto, sin decimal ni con/y) -> 2000", () => {
  assert.equal(parse("20 en el bar").cents, 2000);
});

// ------------------------------------------------------------------ guard: artículos "un"/"una"

test("GUARD: «un café en el bar» no se lee como importe 1,00 — «un» es artículo, no numeral", () => {
  // El comercio es lo que sigue a «en (el)?» (bar), no el objeto comprado (café): el parser no
  // extrae qué se compró, solo dónde. Lo que importa aquí es que "un" no cuele un importe de 1,00.
  const r = parse("un café en el bar");
  assert.equal(r.cents, null);
  assert.equal(r.merchant, "bar");
});

test("GUARD: «una cerveza en el bar» tampoco se lee como importe 1,00", () => {
  const r = parse("una cerveza en el bar");
  assert.equal(r.cents, null);
  assert.equal(r.merchant, "bar");
});

// ------------------------------------------------------------------ guard: % y fechas numéricas no son el importe

test("GUARD: el porcentaje del reparto no se lee como importe", () => {
  const r = parse("12,50 en el bar con Marta al 60 %");
  assert.equal(r.cents, 1250);
  assert.equal(r.shared, true);
  assert.equal(r.sharePct, 60);
});

test("GUARD: una fecha numérica dd/mm no se lee como importe", () => {
  const r = parse("12,50 en el bar el 3/9");
  assert.equal(r.cents, 1250);
  assert.equal(r.date, "2026-09-03");
});

test("GUARD: «el 3» (día del mes) no se lee como importe", () => {
  const r = parse("el 3 en el bar");
  assert.equal(r.cents, null);
  assert.equal(r.date, "2026-09-03");
  assert.equal(r.merchant, "bar");
});

// ------------------------------------------------------------------ compartido

test("compartido: «con Marta» con counterpartName vacío -> shared:false y «Marta» no acaba de comercio", () => {
  const r = parse("con Marta", { counterpartName: "" });
  assert.equal(r.shared, false);
  assert.equal(r.merchant, null);
});

test("compartido: «a medias» activa shared sin nombrar a nadie", () => {
  const r = parse("12 en el bar a medias");
  assert.equal(r.shared, true);
});

// ------------------------------------------------------------------ fecha (today fijo, miércoles 2026-09-09)

test("fecha: sin fecha en la frase -> today", () => {
  assert.equal(parse("12 en el bar").date, TODAY);
});

test("fecha: «ayer» -> 2026-09-08", () => {
  assert.equal(parse("12 en el bar ayer").date, "2026-09-08");
});

test("fecha: «anteayer» -> 2026-09-07", () => {
  assert.equal(parse("12 en el bar anteayer").date, "2026-09-07");
});

test("fecha: «el lunes» -> ocurrencia pasada más cercana, 2026-09-07", () => {
  assert.equal(parse("12 en el bar el lunes").date, "2026-09-07");
});

// ------------------------------------------------------------------ categoría

test("categoría: por nombre en la frase", () => {
  const r = parse("20 salud", { categories: CATS });
  assert.equal(r.categoryId, "cat-salud");
});

test("categoría: por memoria del comercio cuando la frase no la dice", () => {
  const merchants = { super: { display: "Super", categoryId: "cat-alimentacion", count: 1, lastUsedAt: TODAY } };
  const r = parse("12 en el super", { merchants });
  assert.equal(r.merchant, "Super");
  assert.equal(r.categoryId, "cat-alimentacion");
});

test("categoría: la de la frase GANA a la de la memoria", () => {
  const merchants = { super: { display: "Super", categoryId: "cat-alimentacion", count: 1, lastUsedAt: TODAY } };
  const r = parse("12 salud en el super", { merchants });
  assert.equal(r.categoryId, "cat-salud");
});

test("categoría: una que no está en `categories` no se devuelve por memoria", () => {
  const merchants = { super: { display: "Super", categoryId: "cat-nomina", count: 1, lastUsedAt: TODAY } };
  const r = parse("12 en el super", { merchants, categories: [{ id: "cat-alimentacion", name: "Alimentación" }] });
  assert.equal(r.categoryId, null);
});

// ------------------------------------------------------------------ cuenta

test("cuenta: por nombre literal casado con normalizeMerchant («n26» encuentra «N26»)", () => {
  const r = parse("12 n26");
  assert.equal(r.accountId, "acc-n26");
});

// ------------------------------------------------------------------ basura: nunca lanza

test("basura: «asdf» no lanza y devuelve todo a null salvo la fecha (today)", () => {
  const r = parse("asdf");
  assert.equal(r.cents, null);
  assert.equal(r.merchant, null);
  assert.equal(r.categoryId, null);
  assert.equal(r.accountId, null);
  assert.equal(r.shared, false);
  assert.equal(r.date, TODAY);
});

test("basura: cadena vacía no lanza", () => {
  const r = parse("");
  assert.equal(r.cents, null);
  assert.equal(r.date, TODAY);
});

test("basura: null no lanza", () => {
  assert.doesNotThrow(() => parse(null));
  const r = parse(null);
  assert.equal(r.cents, null);
  assert.equal(r.date, TODAY);
});

test("basura: undefined no lanza", () => {
  assert.doesNotThrow(() => parse(undefined));
  const r = parse(undefined);
  assert.equal(r.cents, null);
  assert.equal(r.date, TODAY);
});

// ------------------------------------------------------------------ RULES_BY_LANG

test("RULES_BY_LANG expone es (y no lanza si se añade en/otro idioma más tarde)", () => {
  assert.ok(RULES_BY_LANG.es);
});
