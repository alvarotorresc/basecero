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
import {
  createCategory, updateCategory, setCategoryStyle, updatePeriodSharePct, addTransaction,
} from "../../app/app/js/repo.js";
import { t } from "../../app/app/js/i18n/index.js";

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

test("updatePeriodSharePct con un pct inválido rechaza con errors.repo.sharePctInvalid antes de tocar la BD", async () => {
  for (const pct of [120, -5, "60"]) {
    await assert.rejects(
      () => updatePeriodSharePct("per-1", pct),
      (e) => {
        assert.equal(e.message, t("errors.repo.sharePctInvalid"));
        return true;
      },
    );
  }
});

// El resto de las funciones afectadas (openNextPeriod, addTransaction, updateTransaction,
// updateRule, updateAccount, updateGoal — y softDeleteTransaction/createRule/createAccount/
// createGoal/archiveCategory/retranslateSeedNames/reorderCategories, que no colisionan con
// ningún t("...") pero comparten el patrón peligroso) dependen todas del Worker (query/exec/
// execMany de db.js) y no son alcanzables en Node sin mockearlo. Las cubre este guard de código
// fuente: ningún fichero que importe el `t` de i18n puede declarar un `const t`/`let t` local —
// es el invariante exacto que el bug violó, y cubre las ~13 funciones que ningún test de Node
// puede ejercer directamente.
// La invariante de columna cruzada de paid_by («solo un gasto compartido lo puede pagar la
// contraparte») vivía SOLO en validateImport (xlsx.js), es decir, solo para una hoja importada: el
// camino de escritura del repo la daba por buena. addTransaction la comprueba ANTES de tocar la BD
// (antes incluso de getOpenPeriod), así que es alcanzable en Node con código real, sin mocks del
// Worker — igual que createCategory/updateCategory de arriba.
test("addTransaction rechaza paid_by=partner en algo que no es un gasto compartido, antes de tocar la BD", async () => {
  for (const fields of [
    { type: "income", isShared: false, categoryId: "cat-nomina" },
    { type: "expense", isShared: false, categoryId: "cat-casa-alquiler" },
    { type: "refund", isShared: true, categoryId: "cat-casa-alquiler" },
  ]) {
    await assert.rejects(
      () => addTransaction({ ...fields, amountCents: 1000, date: "2026-08-20", accountId: "acc-n26",
        merchant: "", note: "", paidBy: "partner" }),
      (e) => {
        assert.ok(e instanceof Error);
        assert.notEqual(e.constructor.name, "ReferenceError", `no debe ser TDZ ReferenceError: ${e.message}`);
        assert.equal(e.message, t("errors.repo.paidByNotShared"));
        return true;
      },
    );
  }
});

// Item 2 (final fix wave): mismo criterio que el guard de arriba — un gasto que NO lo pagó la
// contraparte SÍ necesita una cuenta mía (si no, no hay saldo del que descontarlo). Se comprueba
// justo después del guard de paid_by=partner, también ANTES de tocar la BD, así que es alcanzable
// aquí igual que el test de arriba.
test("addTransaction rechaza un gasto sin cuenta cuando no lo pagó la contraparte, antes de tocar la BD", async () => {
  for (const accountId of ["", null, undefined]) {
    await assert.rejects(
      () => addTransaction({ type: "expense", isShared: false, categoryId: "cat-casa-alquiler",
        amountCents: 1000, date: "2026-08-20", accountId, merchant: "", note: "", paidBy: "me" }),
      (e) => {
        assert.ok(e instanceof Error);
        assert.notEqual(e.constructor.name, "ReferenceError", `no debe ser TDZ ReferenceError: ${e.message}`);
        assert.equal(e.message, t("common.needAccount"));
        return true;
      },
    );
  }
});

test("ningún fichero que importa el `t` de i18n declara un `const t`/`let t` local que lo tape", () => {
  const jsDir = fileURLToPath(new URL("../../app/app/js/", import.meta.url));
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
