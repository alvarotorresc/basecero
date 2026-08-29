import { test } from "node:test";
import assert from "node:assert/strict";
import { needsOnboarding, canLeaveAccounts, accountDraft } from "../../app/app/js/onboarding-steps.js";

test("needsOnboarding: solo con cero periodos", () => {
  assert.equal(needsOnboarding([]), true);
  assert.equal(needsOnboarding([{ id: "per-1", status: "closed" }]), false);
  assert.equal(needsOnboarding([{ id: "per-1", status: "open" }]), false);
});

test("canLeaveAccounts: exige al menos una cuenta", () => {
  assert.equal(canLeaveAccounts(0), false);
  assert.equal(canLeaveAccounts(1), true);
  assert.equal(canLeaveAccounts(3), true);
});

test("accountDraft: nombre obligatorio", () => {
  assert.deepEqual(accountDraft({ name: "  ", type: "checking", raw: "10" }), { error: "Ponle un nombre a la cuenta." });
});

test("accountDraft: parsea coma decimal y respeta el signo", () => {
  assert.deepEqual(accountDraft({ name: "Banco", type: "checking", raw: "1250,50" }),
    { name: "Banco", type: "checking", openingBalanceCents: 125050 });
  assert.deepEqual(accountDraft({ name: "Hucha", type: "savings", raw: "" }),
    { name: "Hucha", type: "savings", openingBalanceCents: 0 });
});

test("accountDraft: liability siempre en negativo", () => {
  assert.equal(accountDraft({ name: "Coche", type: "liability", raw: "300" }).openingBalanceCents, -30000);
  assert.equal(accountDraft({ name: "Coche", type: "liability", raw: "-300" }).openingBalanceCents, -30000);
});
