// Regresión: la PR i18n añadió `import { t } from "./i18n/index.js"` a repo.js (y a n26.js,
// xlsx.js, csv-generic.js, backup-crypto.js, db.js), pero repo.js ya tenía ~15 `const t =
// nowIso()` A NIVEL DE FUNCIÓN. Por la zona muerta temporal (TDZ), cualquier `t("errors...")`
// en una línea ANTERIOR a ese `const t` dentro de la MISMA función referencia el `t` local
// (no inicializado aún) en vez del `t` de i18n importado, y lanza
// `ReferenceError: Cannot access 't' before initialization` en vez del mensaje localizado.
//
// Este fichero es el ÚNICO test que importa repo.js real (y por tanto db.js): la mayoría de
// funciones de repo.js dependen del Worker (query/exec/execMany) y no son alcanzables en Node
// sin mockearlo — fuera de alcance aquí. Pero createCategory y updateCategory lanzan sus guards
// ANTES de tocar la BD, así que SÍ son alcanzables con código real, sin mocks: la prueba más
// limpia posible de este bug exacto (no una reproducción manual de la lógica, como hace
// categorias.test.mjs con createCategoryReproduced/updateCategoryReproduced — esas reimplementan
// el guard con un parámetro `now`, así que nunca tuvieron el shadowing y no habrían detectado
// este bug).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCategory, updateCategory, setCategoryStyle } from "../../app/js/repo.js";
import { t } from "../../app/js/i18n/index.js";

test("createCategory con nombre vacío: lanza el mensaje localizado, no ReferenceError (repo.js:618, TDZ de `const t = nowIso()` en línea posterior)", async () => {
  await assert.rejects(
    () => createCategory({ name: "", flow: "expense", needType: "need", parentId: "" }),
    (e) => {
      assert.ok(e instanceof Error);
      assert.notEqual(e.constructor.name, "ReferenceError", `no debe ser TDZ ReferenceError: ${e.message}`);
      assert.equal(e.message, t("errors.repo.categoryNameEmpty"));
      return true;
    },
  );
});

test("updateCategory con flow: lanza el mensaje localizado, no ReferenceError (repo.js:651, TDZ de `const t = nowIso()` en línea posterior)", async () => {
  await assert.rejects(
    () => updateCategory("cualquier-id", { flow: "expense" }),
    (e) => {
      assert.ok(e instanceof Error);
      assert.notEqual(e.constructor.name, "ReferenceError", `no debe ser TDZ ReferenceError: ${e.message}`);
      assert.equal(e.message, t("errors.repo.flowImmutable"));
      return true;
    },
  );
});

// Control positivo: setCategoryStyle (repo.js:751) también lanza su guard ANTES de tocar la BD,
// pero esa función NO tiene un `const t = nowIso()` local (no persiste timestamp por SQL directo
// en esa ruta) — nunca tuvo el bug. Si esto pasa mientras los dos de arriba fallan (antes del
// fix), confirma que el problema es el shadowing en createCategory/updateCategory, no que i18n
// no resuelva en Node.
test("setCategoryStyle con color inválido: ya devuelve el mensaje localizado hoy (sin `const t` local, control positivo)", async () => {
  await assert.rejects(
    () => setCategoryStyle("cualquier-id", { color: "#no-existe" }),
    (e) => {
      assert.equal(e.message, t("errors.repo.colorUnavailable"));
      return true;
    },
  );
});

// El resto de las funciones afectadas (openNextPeriod, addTransaction, updateTransaction,
// updateRule, updateAccount, updateGoal — y softDeleteTransaction/createRule/createAccount/
// createGoal/archiveCategory/retranslateSeedNames/reorderCategories, que no colisionan con
// ningún t("...") pero comparten el patrón peligroso) dependen todas del Worker (query/exec/
// execMany de db.js) y no son alcanzables en Node sin mockearlo. Las cubre este guard de código
// fuente: ningún fichero que importe el `t` de i18n puede declarar un `const t`/`let t` local —
// es el invariante exacto que el bug violó, y cubre las ~13 funciones que ningún test de Node
// puede ejercer directamente.
test("ningún fichero que importa el `t` de i18n declara un `const t`/`let t` local que lo tape", () => {
  const jsDir = fileURLToPath(new URL("../../app/js/", import.meta.url));
  const files = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}${entry.name}/`, `${prefix}${entry.name}/`);
      else if (entry.name.endsWith(".js")) files.push(`${prefix}${entry.name}`);
    }
  };
  walk(jsDir, "");

  const importsI18nT = (src) => /^\s*import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*["'][./]*i18n\/index\.js["']/m.test(src);
  // `const t = ...` / `let t = ...` como DECLARACIÓN, incluida la desestructuración
  // (`const [t, x] = …`, `const { t } = …`) — hasSharedData (repo.js:93) shadowed así con un
  // `const [t, r] = await Promise.all(...)`, sin `= nowIso()` de por medio. NO cuenta
  // `for (const t of x)` ni `(t) => …`: son variables de bucle/parámetros de callback sin
  // relación con este bug (n26.js los usa así, sin tocar el `t` de i18n dentro).
  const localTDecl = /^\s*(?:const|let)\s+(?:t\b\s*=|\[\s*t\b|\{\s*t\b)/m;

  const offenders = [];
  for (const rel of files) {
    const src = readFileSync(jsDir + rel, "utf8");
    if (importsI18nT(src) && localTDecl.test(src)) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});
