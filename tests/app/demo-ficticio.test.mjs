// El fixture de las capturas (tests/app/fixtures/demo-ficticio.xlsx) no se puede pudrir: tiene
// que pasar validateImport y seguir siendo lo que construye su script (fixtures/demo-ficticio.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { X } from "./helpers.mjs";
import { workbookToRows, validateImport } from "../../app/app/js/xlsx.js";
import { XLSX_PATH, buildDemoWorkbook } from "./fixtures/demo-ficticio.mjs";

const NOW = "2026-09-26T00:00:00.000Z";
const { data, errors } = workbookToRows(X, X.read(readFileSync(XLSX_PATH)), NOW);

test("demo-ficticio.xlsx: se lee sin errores y validateImport no se queja", () => {
  assert.deepEqual(errors, []);
  assert.deepEqual(validateImport(data), []);
});

test("demo-ficticio.xlsx: coincide con lo que construye su script (regenerar si no)", () => {
  const fresco = workbookToRows(X, buildDemoWorkbook(X), NOW).data;
  assert.deepEqual(data, fresco, "node tests/app/fixtures/demo-ficticio.mjs");
});

test("demo-ficticio.xlsx: trae lo que piden las capturas", () => {
  const vivos = (t) => data[t].filter((r) => r.deleted !== 1);
  const meta = Object.fromEntries(data.meta.map((m) => [m.key, String(m.value)]));
  assert.equal(meta.partner_name, "Marta");

  const periodos = vivos("periods");
  assert.equal(periodos.filter((p) => p.status === "open").length, 1);
  assert.equal(periodos.filter((p) => p.status === "closed").length, 2);

  assert.deepEqual(vivos("accounts").map((a) => a.type).sort(), ["checking", "liability", "savings", "savings"]);

  const txs = vivos("transactions");
  assert.ok(txs.length >= 35 && txs.length <= 45, `${txs.length} movimientos`);
  const cats = Object.fromEntries(data.categories.map((c) => [c.id, c]));
  const raiz = (id) => (cats[id].parent_id || id);
  const raicesGasto = data.categories.filter((c) => c.flow === "expense" && c.parent_id === "").map((c) => c.id);
  assert.equal(raicesGasto.length, 12);
  const cubiertas = new Set(txs.filter((x) => x.type === "expense").map((x) => raiz(x.category_id)));
  assert.deepEqual([...cubiertas].sort(), [...raicesGasto].sort(), "gastos en las 12 familias");

  assert.equal(txs.filter((x) => x.is_shared === 1).length, 1);
  assert.equal(vivos("recurring_rules").filter((r) => r.is_subscription === 1).length, 2);
  assert.equal(vivos("tags").length, 1);
  assert.ok(txs.some((x) => x.tag_id === vivos("tags")[0].id));
  const [goal] = vivos("goals");
  assert.equal(vivos("goals").length, 1);
  assert.equal(data.accounts.find((a) => a.id === goal.account_id).name, "Hucha");
});
