import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAccountId } from "../../app/js/account-defaults.js";

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
