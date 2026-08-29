import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAccountId, sanitizeLoanMap, parseLoanMap } from "../../app/app/js/account-defaults.js";

const ACCOUNTS = [
  { id: "acc-a", name: "Corriente", type: "checking" },
  { id: "acc-b", name: "Ahorro", type: "savings" },
];

test("preferida válida: se respeta tal cual", () => {
  assert.equal(resolveAccountId("acc-b", ACCOUNTS), "acc-b");
});
test("vacía: cae a la primera checking aunque no sea la primera de la lista", () => {
  const accs = [{ id: "acc-s", name: "Ahorro", type: "savings" },
                { id: "acc-c", name: "Corriente", type: "checking" }];
  assert.equal(resolveAccountId("", accs), "acc-c");
});
test("preferida inexistente (borrada/archivada): cae al automático", () => {
  assert.equal(resolveAccountId("acc-zombie", ACCOUNTS), "acc-a");
});
test("sin checking: primera cuenta activa", () => {
  assert.equal(resolveAccountId("", [{ id: "acc-b", name: "Ahorro", type: "savings" }]), "acc-b");
});
test("sin cuentas: null", () => {
  assert.equal(resolveAccountId("", []), null);
  assert.equal(resolveAccountId(undefined, []), null);
});
test("paridad Álvaro: con sus cuentas y la clave vacía resuelve a acc-n26", () => {
  const alvaro = [
    { id: "acc-n26", name: "N26", type: "checking" },
    { id: "acc-revolut", name: "Revolut", type: "savings" },
    { id: "acc-traderepublic", name: "Trade Republic", type: "savings" },
    { id: "acc-prestamo-coche", name: "Préstamo coche", type: "liability" },
  ];
  assert.equal(resolveAccountId("", alvaro), "acc-n26");
});

// ---- sanitizeLoanMap / parseLoanMap (Task 6, cuotas en pasivos, config-in-meta) -----------
// Mismo criterio de defensa en profundidad que sanitizeStyleMap/parseStyle (category-colors.js):
// meta.account_loans puede llegar de un import xlsx a mano o de una clave manipulada a pelo,
// así que un accountId o un monthlyCents corrupto no debe colar hasta accountSubtitle (donde
// Math.ceil(saldo/monthlyCents) lo convertiría en Infinity/NaN visible en la UI).

test("sanitizeLoanMap: objeto plano válido (id de cuenta -> monthlyCents entero positivo) se conserva intacto", () => {
  const input = { "acc-prestamo": { monthlyCents: 18900 } };
  assert.deepEqual(sanitizeLoanMap(input), input);
});

test("sanitizeLoanMap: no-objeto o array en el nivel superior se descarta entero -> {}", () => {
  assert.deepEqual(sanitizeLoanMap(null), {});
  assert.deepEqual(sanitizeLoanMap(undefined), {});
  assert.deepEqual(sanitizeLoanMap("x"), {});
  assert.deepEqual(sanitizeLoanMap(42), {});
  assert.deepEqual(sanitizeLoanMap([{ monthlyCents: 100 }]), {});
});

test("sanitizeLoanMap: accountId con caracteres fuera de [A-Za-z0-9_-] se descarta (payload tipo XSS)", () => {
  assert.deepEqual(sanitizeLoanMap({ 'acc" onfocus="a': { monthlyCents: 100 } }), {});
});

test("sanitizeLoanMap: monthlyCents ausente, no entero, cero o negativo se descarta la entrada", () => {
  assert.deepEqual(sanitizeLoanMap({ "acc-a": {} }), {});
  assert.deepEqual(sanitizeLoanMap({ "acc-a": { monthlyCents: 0 } }), {});
  assert.deepEqual(sanitizeLoanMap({ "acc-a": { monthlyCents: -500 } }), {});
  assert.deepEqual(sanitizeLoanMap({ "acc-a": { monthlyCents: 12.5 } }), {});
  assert.deepEqual(sanitizeLoanMap({ "acc-a": { monthlyCents: "18900" } }), {});
  assert.deepEqual(sanitizeLoanMap({ "acc-a": { monthlyCents: NaN } }), {});
});

test("sanitizeLoanMap: una entrada inválida no arrastra a las demás — solo se descarta ella", () => {
  const out = sanitizeLoanMap({ "acc-a": { monthlyCents: 5000 }, "acc-b": { monthlyCents: -1 } });
  assert.deepEqual(out, { "acc-a": { monthlyCents: 5000 } });
});

test("sanitizeLoanMap: la clave __proto__ del JSON se ignora sin contaminar Object.prototype ni pisar entradas vecinas", () => {
  const malicious = JSON.parse('{"__proto__":{"monthlyCents":100,"polluted":true},"acc-a":{"monthlyCents":5000}}');
  const out = sanitizeLoanMap(malicious);
  assert.equal(({}).polluted, undefined, "Object.prototype no debe contaminarse");
  assert.deepEqual(out, { "acc-a": { monthlyCents: 5000 } });
});

test("parseLoanMap: JSON.parse seguro — cualquier fallo (ausente/corrupto/no-objeto) vuelve a {}", () => {
  assert.deepEqual(parseLoanMap(undefined), {});
  assert.deepEqual(parseLoanMap(null), {});
  assert.deepEqual(parseLoanMap(""), {});
  assert.deepEqual(parseLoanMap("no es json"), {});
  assert.deepEqual(parseLoanMap("{}"), {});
  assert.deepEqual(parseLoanMap('{"acc-a":{"monthlyCents":18900}}'), { "acc-a": { monthlyCents: 18900 } });
});
