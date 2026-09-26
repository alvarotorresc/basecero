import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  defaultFamilyForAccount,
  familyForAccount,
  goalFamily,
  isDebt,
  parseAccountStyle,
  sanitizeAccountStyle,
} from "../../app/app/js/account-colors.js";
import { FAMILIES } from "../../app/app/js/category-colors.js";
import { SQL } from "../../app/app/js/sql.js";
import { openDb, seedMinimal } from "./helpers.mjs";

// ---- defaultFamilyForAccount: valores por defecto por tipo (C8) -----------------------------

test("defaultFamilyForAccount: checking -> tra, liability -> coc, savings sin objetivo -> ali", () => {
  assert.equal(defaultFamilyForAccount({ id: "acc-1", type: "checking" }, []), "tra");
  assert.equal(defaultFamilyForAccount({ id: "acc-2", type: "liability" }, []), "coc");
  assert.equal(defaultFamilyForAccount({ id: "acc-3", type: "savings" }, []), "ali");
  assert.equal(defaultFamilyForAccount({ id: "acc-3", type: "savings" }, undefined), "ali");
});

test("defaultFamilyForAccount: savings enlazada a un objetivo vivo -> imp (D-impl-2, la hucha)", () => {
  const goals = [{ id: "goal-1", account_id: "acc-hucha", deleted: 0 }];
  assert.equal(defaultFamilyForAccount({ id: "acc-hucha", type: "savings" }, goals), "imp");
});

test("defaultFamilyForAccount: is_active no importa — un objetivo pausado no le quita el imp a su hucha", () => {
  const goals = [{ id: "goal-1", account_id: "acc-hucha", is_active: 0, deleted: 0 }];
  assert.equal(defaultFamilyForAccount({ id: "acc-hucha", type: "savings" }, goals), "imp");
});

test("defaultFamilyForAccount: un objetivo borrado (deleted:1) no enlaza — cae a ali", () => {
  const goals = [{ id: "goal-1", account_id: "acc-hucha", deleted: 1 }];
  assert.equal(defaultFamilyForAccount({ id: "acc-hucha", type: "savings" }, goals), "ali");
});

test("defaultFamilyForAccount: account_id vacío no enlaza a ninguna cuenta (spending_cap/savings_rate)", () => {
  const goals = [{ id: "goal-1", account_id: "", deleted: 0 }];
  assert.equal(defaultFamilyForAccount({ id: "acc-hucha", type: "savings" }, goals), "ali");
  assert.equal(defaultFamilyForAccount({ id: "", type: "savings" }, goals), "ali");
});

test("defaultFamilyForAccount: solo savings mira el enlace — un checking enlazado a un objetivo sigue en tra", () => {
  const goals = [{ id: "goal-1", account_id: "acc-corriente", deleted: 0 }];
  assert.equal(defaultFamilyForAccount({ id: "acc-corriente", type: "checking" }, goals), "tra");
});

test("defaultFamilyForAccount: sin cuenta o tipo desconocido -> null, ninguna familia inventada", () => {
  assert.equal(defaultFamilyForAccount(null, []), null);
  assert.equal(defaultFamilyForAccount(undefined, []), null);
  assert.equal(defaultFamilyForAccount({ id: "acc-x", type: "invented" }, []), null);
});

// ---- familyForAccount: override de styleMap > por defecto -----------------------------------

test("familyForAccount: sin override, cae al valor por defecto de su tipo", () => {
  assert.equal(familyForAccount({ id: "acc-1", type: "checking" }, {}, []), "tra");
  assert.equal(familyForAccount({ id: "acc-1", type: "checking" }, undefined, []), "tra");
});

test("familyForAccount: un override válido manda sobre el valor por defecto", () => {
  const styleMap = { "acc-1": { fam: "oci" } };
  assert.equal(familyForAccount({ id: "acc-1", type: "checking" }, styleMap, []), "oci");
});

test("familyForAccount: un override de OTRA cuenta no le afecta", () => {
  const styleMap = { "acc-2": { fam: "oci" } };
  assert.equal(familyForAccount({ id: "acc-1", type: "checking" }, styleMap, []), "tra");
});

test("familyForAccount: un override corrupto (fam fuera de FAMILIES) se ignora, cae al por defecto", () => {
  const styleMap = { "acc-1": { fam: "<script>" } };
  assert.equal(familyForAccount({ id: "acc-1", type: "checking" }, styleMap, []), "tra");
});

test("familyForAccount: ids heredados de Object.prototype no resuelven a un override ajeno", () => {
  const styleMap = { "acc-real": { fam: "oci" } };
  for (const id of ["toString", "constructor", "__proto__"]) {
    assert.equal(familyForAccount({ id, type: "checking" }, styleMap, []), "tra", id);
  }
});

// ---- isDebt (C8: --stripe-debt) ---------------------------------------------------------------

test("isDebt: solo liability aplica el rayado de deuda", () => {
  assert.equal(isDebt({ type: "liability" }), true);
  assert.equal(isDebt({ type: "checking" }), false);
  assert.equal(isDebt({ type: "savings" }), false);
  assert.equal(isDebt(null), false);
  assert.equal(isDebt(undefined), false);
});

// ---- goalFamily: un objetivo toma la familia de SU cuenta (C8) -------------------------------

test("goalFamily: un objetivo sobre una hucha da la familia de su cuenta (imp, por defecto)", () => {
  const accountsById = { "acc-hucha": { id: "acc-hucha", type: "savings" } };
  const goal = { id: "goal-1", account_id: "acc-hucha" };
  assert.equal(goalFamily(goal, accountsById, {}), "imp");
});

test("goalFamily: respeta el override de esa cuenta", () => {
  const accountsById = { "acc-hucha": { id: "acc-hucha", type: "savings" } };
  const goal = { id: "goal-1", account_id: "acc-hucha" };
  assert.equal(goalFamily(goal, accountsById, { "acc-hucha": { fam: "sus" } }), "sus");
});

test("goalFamily: sin account_id (spending_cap/savings_rate) -> null, no un fallback de categoría", () => {
  assert.equal(goalFamily({ id: "goal-1", account_id: "" }, {}, {}), null);
  assert.equal(goalFamily({ id: "goal-1" }, {}, {}), null);
});

test("goalFamily: una cuenta que ya no existe (borrada) -> null", () => {
  assert.equal(goalFamily({ id: "goal-1", account_id: "acc-fantasma" }, {}, {}), null);
});

test("goalFamily: sin goal -> null", () => {
  assert.equal(goalFamily(null, {}, {}), null);
});

// ---- Saneo: __proto__ y lista cerrada de FAMILIES (mismas defensas que sanitizeStyleMap) -----

test("sanitizeAccountStyle: solo conserva fam dentro de FAMILIES, descarta el resto de la entrada", () => {
  assert.deepEqual(sanitizeAccountStyle({ "acc-1": { fam: "oci" } }), { "acc-1": { fam: "oci" } });
  assert.deepEqual(sanitizeAccountStyle({ "acc-1": { fam: "oci", icon: "casa", color: "#fff" } }), { "acc-1": { fam: "oci" } });
});

test("sanitizeAccountStyle: fam fuera de FAMILIES descarta la entrada entera (no hay icono que conservar)", () => {
  assert.deepEqual(sanitizeAccountStyle({ "acc-1": { fam: "nope" } }), {});
  assert.deepEqual(sanitizeAccountStyle({ "acc-1": { fam: "<script>" } }), {});
  assert.deepEqual(sanitizeAccountStyle({ "acc-1": {} }), {});
});

test("sanitizeAccountStyle: un array o valor no objeto se descarta entero -> {}", () => {
  assert.deepEqual(sanitizeAccountStyle([{ fam: "ali" }]), {});
  assert.deepEqual(sanitizeAccountStyle(null), {});
  assert.deepEqual(sanitizeAccountStyle("acc-1"), {});
  assert.deepEqual(sanitizeAccountStyle(undefined), {});
});

test("sanitizeAccountStyle: una entrada que no es objeto se descarta, las demás sobreviven", () => {
  assert.deepEqual(sanitizeAccountStyle({ "acc-1": "oci", "acc-2": { fam: "sal" } }), { "acc-2": { fam: "sal" } });
});

test("sanitizeAccountStyle: la clave __proto__ se ignora sin contaminar Object.prototype", () => {
  const malicious = JSON.parse('{"__proto__":{"fam":"ali","polluted":true},"acc-1":{"fam":"oci"}}');
  const out = sanitizeAccountStyle(malicious);
  assert.deepEqual(out, { "acc-1": { fam: "oci" } });
  assert.equal(({}).polluted, undefined);
});

test("parseAccountStyle: try/catch seguro de JSON.parse", () => {
  assert.deepEqual(parseAccountStyle(undefined), {});
  assert.deepEqual(parseAccountStyle(null), {});
  assert.deepEqual(parseAccountStyle(""), {});
  assert.deepEqual(parseAccountStyle("no es json"), {});
  assert.deepEqual(parseAccountStyle("{}"), {});
  assert.deepEqual(parseAccountStyle('{"acc-1":{"fam":"ali"}}'), { "acc-1": { fam: "ali" } });
});

// ---- C13 en el propio módulo -------------------------------------------------------------------

test("C13: account-colors.js no lleva ningún hex con almohadilla ni rgba(, ni emoji", () => {
  const src = readFileSync(new URL("../../app/app/js/account-colors.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  assert.doesNotMatch(src, /\p{Extended_Pictographic}/u);
});

// ---- meta.account_style arranca en '{}' (semilla schema.sql) ---------------------------------

test("meta.account_style arranca en '{}' (semilla schema.sql), parseAccountStyle da un mapa vacío", () => {
  const db = openDb();
  seedMinimal(db);
  const row = db.prepare("SELECT value FROM meta WHERE key='account_style'").get();
  assert.equal(row.value, "{}");
  assert.deepEqual(parseAccountStyle(row.value), {});
});

// ---- repo.setAccountFamily / getAccountStyle (reproducido) -----------------------------------
// repo.js no se puede importar en Node (db.js abre un Worker de navegador): se reproduce su
// lógica exacta contra la BD real de helpers.mjs, mismo patrón que setAccountLoanReproduced en
// patrimonio.test.mjs. Documenta el contrato que repo.js#setAccountFamily/getAccountStyle deben
// cumplir letra por letra.

function setAccountFamilyReproduced(db, accountId, fam) {
  if (fam != null && !FAMILIES.includes(fam)) throw new Error("colorUnavailable");
  const metaRows = db.prepare(SQL.allMeta).all();
  const meta = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));
  const styleMap = parseAccountStyle(meta.account_style);
  if (fam) styleMap[accountId] = { fam };
  else delete styleMap[accountId];
  const sanitized = sanitizeAccountStyle(styleMap);
  db.prepare(SQL.upsertMeta).run("account_style", JSON.stringify(sanitized));
  return sanitized;
}
function getAccountStyleReproduced(db) {
  const meta = Object.fromEntries(db.prepare(SQL.allMeta).all().map((r) => [r.key, r.value]));
  return parseAccountStyle(meta.account_style);
}

test("setAccountFamily (reproducido): guarda la familia elegida para una cuenta", () => {
  const db = openDb();
  seedMinimal(db);
  const out = setAccountFamilyReproduced(db, "acc-revolut", "sus");
  assert.deepEqual(out, { "acc-revolut": { fam: "sus" } });
  const row = db.prepare("SELECT value FROM meta WHERE key='account_style'").get();
  assert.equal(row.value, JSON.stringify({ "acc-revolut": { fam: "sus" } }));
  assert.deepEqual(getAccountStyleReproduced(db), { "acc-revolut": { fam: "sus" } });
});

test("setAccountFamily (reproducido): fam ausente/null borra el override (vuelve al valor por defecto)", () => {
  const db = openDb();
  seedMinimal(db);
  setAccountFamilyReproduced(db, "acc-revolut", "sus");
  assert.deepEqual(setAccountFamilyReproduced(db, "acc-revolut", null), {});
  assert.deepEqual(setAccountFamilyReproduced(db, "acc-revolut", undefined), {});
});

test("setAccountFamily (reproducido): toca SOLO la cuenta indicada, conserva las demás entradas", () => {
  const db = openDb();
  seedMinimal(db);
  setAccountFamilyReproduced(db, "acc-revolut", "sus");
  const out = setAccountFamilyReproduced(db, "acc-n26", "oci");
  assert.deepEqual(out, { "acc-revolut": { fam: "sus" }, "acc-n26": { fam: "oci" } });
});

test("setAccountFamily (reproducido): una familia fuera de FAMILIES lanza", () => {
  const db = openDb();
  seedMinimal(db);
  assert.throws(() => setAccountFamilyReproduced(db, "acc-revolut", "<script>"));
});

test("getAccountStyle (reproducido): mapa vacío en una BD nueva (semilla '{}')", () => {
  const db = openDb();
  seedMinimal(db);
  assert.deepEqual(getAccountStyleReproduced(db), {});
});

// ---- deleteEmptyAccount (reproducido): limpia su entrada de account_style al borrar -----------

/** Reproduce repo.deleteEmptyAccount con la limpieza de meta.account_style añadida en esta PR:
 *  el SQL.deleteEmptyAccount YA garantiza que solo borra si la cuenta no tiene ninguna referencia
 *  (mismo WHERE atómico, ver onboarding.test.mjs); aquí se prueba que, SOLO si la fila desaparece,
 *  su entrada de account_style desaparece con ella. */
function deleteEmptyAccountReproduced(db, id) {
  db.prepare(SQL.deleteEmptyAccount).run(id, id, id, id, id, id);
  const stillThere = !!db.prepare("SELECT id FROM accounts WHERE id=?").get(id);
  if (!stillThere) setAccountFamilyReproduced(db, id, null);
  return !stillThere;
}

test("deleteEmptyAccount (reproducido): al borrar una cuenta vacía, limpia su entrada de account_style", () => {
  const db = openDb();
  seedMinimal(db);
  setAccountFamilyReproduced(db, "acc-revolut", "sus");
  const deleted = deleteEmptyAccountReproduced(db, "acc-revolut");
  assert.equal(deleted, true);
  assert.deepEqual(getAccountStyleReproduced(db), {}, "la entrada de la cuenta borrada desaparece");
});

test("deleteEmptyAccount (reproducido): una cuenta que NO se borra (referenciada) conserva su entrada", () => {
  const db = openDb();
  seedMinimal(db);
  const T = "2026-08-01T00:00:00Z";
  db.prepare(`INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,counter_account_id,category_id,merchant,note,is_shared,share_pct_override,paid_by,settled,ref_id,rule_id,tag_id,external_id,has_attachment,status,created_at,updated_at,deleted)
    VALUES ('tx-1','2026-08-01','per-1','expense',1000,'acc-revolut','','cat-casa','','',0,NULL,'me',0,'','','','',0,'pending',?,?,0)`).run(T, T);
  setAccountFamilyReproduced(db, "acc-revolut", "sus");
  const deleted = deleteEmptyAccountReproduced(db, "acc-revolut");
  assert.equal(deleted, false);
  assert.deepEqual(getAccountStyleReproduced(db), { "acc-revolut": { fam: "sus" } }, "sigue existiendo: su override se conserva");
});

// ---- La hucha conserva imp al pausar su objetivo (revisión final B) --------------------------
// listGoals filtra is_active=1: un objetivo pausado no llega a familyForAccount, así que la hucha
// solo conserva imp si createGoal le guarda la familia como override (misma vía que el onboarding).

test("hucha creada por createGoal: con su objetivo pausado (fuera de listGoals) sigue en imp", () => {
  const db = openDb();
  seedMinimal(db);
  const hucha = { id: "acc-hucha-nueva", type: "savings" };
  const style = setAccountFamilyReproduced(db, hucha.id, "imp");
  // Objetivo pausado: listGoals no lo devuelve, la lista de objetivos llega vacía.
  assert.equal(familyForAccount(hucha, style, []), "imp");
  // Sin el override, la misma cuenta caería al ali por defecto de savings (el defecto que se arregla).
  assert.equal(familyForAccount(hucha, {}, []), "ali");
});

test("repo.createGoal guarda imp como override de la hucha que crea", () => {
  const src = readFileSync(new URL("../../app/app/js/repo.js", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export async function createGoal"), src.indexOf("export async function updateGoal"));
  assert.match(body, /setAccountFamily\(accountId, "imp"\)/);
});
