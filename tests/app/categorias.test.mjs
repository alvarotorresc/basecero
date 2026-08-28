import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { SQL } from "../../app/js/sql.js";
import { computeReorder } from "../../app/js/category-order.js";
import { POOL, CURATED_ICONS, CATEGORY_ICONS, parseStyle, initCategoryStyle } from "../../app/js/category-colors.js";
import { openDb, seedMinimal } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const pure = require("../../apps_script/pure.js");

const T = "2026-08-24T18:00:00Z";
const T2 = "2026-08-24T19:00:00Z";

// setCategoryStyle (reproducida) toca el singleton module-level de category-colors.js
// (initCategoryStyle) — reset entre tests, mismo patrón que category-colors.test.mjs.
beforeEach(() => {
  initCategoryStyle({});
});

// ---- computeReorder (pura, category-order.js) ------------------------------

test("computeReorder: mueve el elemento 0 a la posición 2", () => {
  assert.deepEqual(computeReorder(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
});

test("computeReorder: mueve el elemento 3 a la posición 1", () => {
  assert.deepEqual(computeReorder(["a", "b", "c", "d"], 3, 1), ["a", "d", "b", "c"]);
});

test("computeReorder: `to` fuera de rango clampa a los extremos válidos (incluido soltar al final)", () => {
  // to muy grande: clampa a length (tras quitar el elemento movido) -> el elemento queda ÚLTIMO,
  // no en la penúltima posición (bug a evitar: clampar contra arr.length-1 dejaría el final
  // inalcanzable, y "soltar al final" es el gesto de arrastre más común).
  assert.deepEqual(computeReorder(["a", "b", "c", "d"], 0, 99), ["b", "c", "d", "a"]);
  // to negativo: clampa a 0 -> el elemento queda PRIMERO.
  assert.deepEqual(computeReorder(["a", "b", "c", "d"], 3, -5), ["d", "a", "b", "c"]);
});

test("computeReorder: no muta el array recibido", () => {
  const ids = ["a", "b", "c"];
  computeReorder(ids, 0, 2);
  assert.deepEqual(ids, ["a", "b", "c"]);
});

// ---- SQL directas contra node:sqlite ----------------------------------------

test("SQL.insertCategory: crea una raíz con display_order = MAX+1 de SU grupo (flow+parent_id='')", () => {
  const db = openDb();
  seedMinimal(db); // cat-casa (expense, raíz, order 1)
  db.prepare(SQL.insertCategory).run("cat-ocio", "Ocio", "", "expense", "want", T, T, "expense", "");
  const row = db.prepare("SELECT * FROM categories WHERE id='cat-ocio'").get();
  assert.equal(row.display_order, 2, "MAX(1) de las raíces de gasto existentes + 1");
  assert.equal(row.parent_id, "");
  assert.equal(row.flow, "expense");
  assert.equal(row.need_type, "want");
  assert.equal(row.is_archived, 0);
  assert.equal(row.deleted, 0);
});

test("SQL.insertCategory: crea una hija con display_order = MAX+1 del grupo (flow, parent_id=root) — grupo independiente del de las raíces", () => {
  const db = openDb();
  seedMinimal(db); // cat-casa-alquiler (hija de cat-casa, order 1)
  db.prepare(SQL.insertCategory).run("cat-casa-comunidad", "Comunidad", "cat-casa", "expense", "need", T, T, "expense", "cat-casa");
  const row = db.prepare("SELECT * FROM categories WHERE id='cat-casa-comunidad'").get();
  assert.equal(row.display_order, 2, "MAX(1) de las hijas de cat-casa + 1 — NO del total de categorías");
  assert.equal(row.parent_id, "cat-casa");
});

test("SQL.insertCategory: en un grupo vacío (primera hija de una raíz sin hijas todavía), display_order empieza en 1", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(SQL.insertCategory).run("cat-nomina-extra", "Extra", "cat-nomina", "income", "", T, T, "income", "cat-nomina");
  const row = db.prepare("SELECT * FROM categories WHERE id='cat-nomina-extra'").get();
  assert.equal(row.display_order, 1);
});

test("SQL.updateCategory: cambia name/need_type/parent_id + updated_at, nunca created_at ni flow (no está en el SET)", () => {
  const db = openDb();
  seedMinimal(db);
  const before = db.prepare("SELECT * FROM categories WHERE id='cat-casa-alquiler'").get();

  db.prepare(SQL.updateCategory).run("Hipoteca", "want", "", T2, "cat-casa-alquiler");

  const after = db.prepare("SELECT * FROM categories WHERE id='cat-casa-alquiler'").get();
  assert.equal(after.name, "Hipoteca");
  assert.equal(after.need_type, "want");
  assert.equal(after.parent_id, "", "convertida en raíz");
  assert.equal(after.updated_at, T2);
  assert.equal(after.created_at, before.created_at);
  assert.equal(after.flow, "expense", "flow intacto: la sentencia ni siquiera tiene esa columna en el SET");
});

test("SQL.setCategoryArchived: marca is_archived + updated_at", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(SQL.setCategoryArchived).run(1, T2, "cat-casa");
  const row = db.prepare("SELECT is_archived, updated_at FROM categories WHERE id='cat-casa'").get();
  assert.equal(row.is_archived, 1);
  assert.equal(row.updated_at, T2);
});

test("SQL.updateCategoryOrder: cambia display_order + updated_at", () => {
  const db = openDb();
  seedMinimal(db);
  db.prepare(SQL.updateCategoryOrder).run(5, T2, "cat-casa");
  const row = db.prepare("SELECT display_order, updated_at FROM categories WHERE id='cat-casa'").get();
  assert.equal(row.display_order, 5);
  assert.equal(row.updated_at, T2);
});

test("SQL.childrenOf: solo hijas ACTIVAS (ni archivadas ni borradas), nunca hijas de otro padre", () => {
  const db = openDb();
  seedMinimal(db); // cat-casa-alquiler es hija activa de cat-casa
  db.prepare(SQL.insertCategory).run("cat-casa-comunidad", "Comunidad", "cat-casa", "expense", "need", T, T, "expense", "cat-casa");
  db.prepare(SQL.insertCategory).run("cat-casa-archivada", "Archivada", "cat-casa", "expense", "need", T, T, "expense", "cat-casa");
  db.prepare("UPDATE categories SET is_archived=1 WHERE id='cat-casa-archivada'").run();

  const kids = db.prepare(SQL.childrenOf).all("cat-casa");
  assert.deepEqual(kids.map((k) => k.id).sort(), ["cat-casa-alquiler", "cat-casa-comunidad"]);
});

test("SQL.hasActiveChildren: true solo con una hija ACTIVA (mismo patrón que hasActiveLinkedRefund)", () => {
  const db = openDb();
  seedMinimal(db);
  assert.equal(db.prepare(SQL.hasActiveChildren).get("cat-casa-alquiler"), undefined, "una hija no tiene hijas propias");
  assert.ok(db.prepare(SQL.hasActiveChildren).get("cat-casa"), "cat-casa tiene a cat-casa-alquiler activa");

  db.prepare("UPDATE categories SET is_archived=1 WHERE id='cat-casa-alquiler'").run();
  assert.equal(db.prepare(SQL.hasActiveChildren).get("cat-casa"), undefined, "la única hija está archivada: ya no cuenta como activa");
});

test("SQL.getCategory: trae la fila por id, undefined si no existe o está borrada", () => {
  const db = openDb();
  seedMinimal(db);
  assert.equal(db.prepare(SQL.getCategory).get("cat-casa").name, "Casa");
  assert.equal(db.prepare(SQL.getCategory).get("no-existe"), undefined);

  db.prepare("UPDATE categories SET deleted=1 WHERE id='cat-casa'").run();
  assert.equal(db.prepare(SQL.getCategory).get("cat-casa"), undefined);
});

test("SQL.listCategoriesAdmin: TODAS incl. archivadas, conteo de hijas ACTIVAS, agrupadas por (flow, parent_id, display_order)", () => {
  const db = openDb();
  seedMinimal(db); // cat-casa (expense root, 1 hija activa), cat-casa-alquiler (hija), cat-nomina (income root)
  db.prepare(SQL.insertCategory).run("cat-ocio", "Ocio", "", "expense", "want", T, T, "expense", "");
  db.prepare("UPDATE categories SET is_archived=1 WHERE id='cat-ocio'").run();
  db.prepare(SQL.insertCategory).run("cat-casa-comunidad", "Comunidad", "cat-casa", "expense", "need", T, T, "expense", "cat-casa");
  db.prepare("UPDATE categories SET is_archived=1 WHERE id='cat-casa-comunidad'").run(); // hija archivada: no cuenta en children

  const rows = db.prepare(SQL.listCategoriesAdmin).all();
  const ids = rows.map((r) => r.id);
  assert.ok(ids.includes("cat-ocio"), "las archivadas SÍ aparecen (el admin necesita poder reactivarlas)");

  const casa = rows.find((r) => r.id === "cat-casa");
  assert.equal(casa.children, 1, "solo cuenta cat-casa-alquiler (activa); cat-casa-comunidad está archivada");

  // orden: dentro de flow='expense', las raíces (parent_id='') van agrupadas antes que
  // cualquier grupo de hijas (parent_id no vacío ordena después alfabéticamente).
  const expenseRows = rows.filter((r) => r.flow === "expense");
  const firstChildIndex = expenseRows.findIndex((r) => r.parent_id !== "");
  const lastRootIndex = expenseRows.map((r) => r.parent_id === "").lastIndexOf(true);
  assert.ok(lastRootIndex < firstChildIndex, "todas las raíces de expense preceden a cualquier hija");

  // orden DENTRO del grupo de raíces de expense: display_order manda (cat-casa=1, cat-ocio=2).
  // Sin el `c.display_order` al final del ORDER BY, este assert seguiría pasando por casualidad
  // con solo 2 filas — por eso se verifica también tras invertir el display_order de las dos.
  const rootIds = () => db.prepare(SQL.listCategoriesAdmin).all()
    .filter((r) => r.flow === "expense" && r.parent_id === "").map((r) => r.id);
  assert.deepEqual(rootIds(), ["cat-casa", "cat-ocio"]);

  db.prepare(SQL.updateCategoryOrder).run(2, T2, "cat-casa");
  db.prepare(SQL.updateCategoryOrder).run(1, T2, "cat-ocio");
  assert.deepEqual(rootIds(), ["cat-ocio", "cat-casa"], "invertir display_order invierte el orden devuelto");
});

test("Regresión: archivar la ÚNICA hija de una raíz activa la saca a ELLA de listExpenseLeafCategories y la RAÍZ reaparece (vuelve a ser hoja efectiva)", () => {
  const db = openDb();
  seedMinimal(db); // cat-casa (raíz) con una única hija cat-casa-alquiler

  const before = db.prepare(SQL.listExpenseLeafCategories).all();
  assert.deepEqual(before.map((r) => r.id), ["cat-casa-alquiler"], "la hija es la hoja; la raíz no (tiene hijas)");

  db.prepare(SQL.setCategoryArchived).run(1, T2, "cat-casa-alquiler");

  const after = db.prepare(SQL.listExpenseLeafCategories).all();
  assert.deepEqual(after.map((r) => ({ id: r.id, name: r.name })), [{ id: "cat-casa", name: "Casa" }],
    "la hija desaparece por archivada; la raíz reaparece porque su única hija ya no cuenta como tal (NOT EXISTS filtra is_archived=0)");
});

test("Regresión: archivar una categoría income la saca de listIncomeCategories", () => {
  const db = openDb();
  seedMinimal(db);
  assert.deepEqual(db.prepare(SQL.listIncomeCategories).all().map((r) => r.id), ["cat-nomina"]);

  db.prepare(SQL.setCategoryArchived).run(1, T2, "cat-nomina");

  assert.deepEqual(db.prepare(SQL.listIncomeCategories).all(), []);
});

// ---- Lógica de repo reproducida contra la BD --------------------------------
// repo.js importa db.js, que usa el Worker del navegador — no hay Worker en Node. Igual que
// tests/app/patrimonio.test.mjs (updateAccountReproduced) y tests/app/compartidos.test.mjs
// (settleShared), estas funciones reproducen EXACTAMENTE la lógica de orquestación/guards de
// repo.js contra `db` directo, para poder testearla sin worker de por medio.

/** Reproduce el op "execMany" del Worker (BEGIN/ejecuta/COMMIT, ROLLBACK si falla) — mismo
 *  helper que tests/app/patrimonio.test.mjs. */
function execManyRaw(db, stmts) {
  db.exec("BEGIN");
  try {
    for (const s of stmts) db.prepare(s.sql).run(...(s.bind ?? []));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

const getCategoryRow = (db, id) => db.prepare(SQL.getCategory).get(id);

/** Reproduce repo.assertValidParent (helper interno, sin export propio: se prueba a través de
 *  createCategoryReproduced/updateCategoryReproduced, igual que el repo real). */
function assertValidParentReproduced(db, parentId, flow) {
  const parent = getCategoryRow(db, parentId);
  if (!parent || parent.parent_id !== "" || parent.flow !== flow) {
    throw new Error("La categoría elegida como padre no es válida: debe ser una categoría principal del mismo tipo (gasto o ingreso)");
  }
}

/** Reproduce repo.createCategory. */
function createCategoryReproduced(db, { name, flow, needType, parentId }, now = T) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new Error("El nombre de la categoría no puede estar vacío");
  const pid = parentId || "";
  if (pid) assertValidParentReproduced(db, pid, flow);
  const id = "cat-" + Math.floor(Math.random() * 1e9);
  db.prepare(SQL.insertCategory).run(id, pure.bcSanitizeCell(trimmed), pid, flow, needType ?? "", now, now, flow, pid);
  return id;
}

/** Reproduce repo.updateCategory (merge-on-current + guards). */
function updateCategoryReproduced(db, id, fields, now = T2) {
  if (fields.flow !== undefined) {
    throw new Error("El tipo de la categoría (gasto o ingreso) no se puede cambiar una vez creada");
  }
  const cur = getCategoryRow(db, id);
  if (!cur) throw new Error("Categoría no encontrada");

  let name = cur.name;
  if (fields.name !== undefined) {
    const trimmed = String(fields.name).trim();
    if (!trimmed) throw new Error("El nombre de la categoría no puede estar vacío");
    name = pure.bcSanitizeCell(trimmed);
  }
  const needType = fields.needType !== undefined ? fields.needType : cur.need_type;
  const parentId = fields.parentId !== undefined ? fields.parentId : cur.parent_id;

  if (parentId) {
    assertValidParentReproduced(db, parentId, cur.flow);
    const activeChildren = db.prepare(SQL.hasActiveChildren).all(id);
    if (activeChildren.length > 0) {
      throw new Error("Esta categoría tiene subcategorías activas: solo se permiten dos niveles, no puede convertirse en subcategoría de otra");
    }
  }

  db.prepare(SQL.updateCategory).run(name, needType, parentId, now, id);
}

/** Reproduce repo.archiveCategory: cascada a hijas ACTIVAS en un único execMany. */
function archiveCategoryReproduced(db, id, now = T2) {
  const kids = db.prepare(SQL.childrenOf).all(id);
  const stmts = [
    { sql: SQL.setCategoryArchived, bind: [1, now, id] },
    ...kids.map((k) => ({ sql: SQL.setCategoryArchived, bind: [1, now, k.id] })),
  ];
  execManyRaw(db, stmts);
}

/** Reproduce repo.unarchiveCategory: NO cascada. */
function unarchiveCategoryReproduced(db, id, now = T2) {
  db.prepare(SQL.setCategoryArchived).run(0, now, id);
}

/** Reproduce repo.reorderCategories. */
function reorderCategoriesReproduced(db, orderedIds, now = T2) {
  execManyRaw(db, orderedIds.map((catId, i) => ({ sql: SQL.updateCategoryOrder, bind: [i + 1, now, catId] })));
}

/** Reproduce repo.setCategoryStyle: valida, read-modify-write de meta.category_style,
 *  reemplaza la entrada de rootId por completo, refresca initCategoryStyle. */
function setCategoryStyleReproduced(db, rootId, { color, icon } = {}) {
  if (color !== undefined && !POOL.includes(color)) throw new Error("Ese color no está disponible");
  const iconValid = icon === undefined || CURATED_ICONS.includes(icon) || Object.values(CATEGORY_ICONS).includes(icon);
  if (!iconValid) throw new Error("Ese icono no está disponible");

  // getMetaAll()/setMeta() reales, no un SELECT/UPDATE ad-hoc: SQL.allMeta + SQL.upsertMeta,
  // fieles al repo (aunque aquí solo haga falta la clave category_style).
  const metaRows = db.prepare(SQL.allMeta).all();
  const meta = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));
  const styleMap = parseStyle(meta.category_style);
  const entry = {};
  if (color) entry.color = color;
  if (icon) entry.icon = icon;
  if (Object.keys(entry).length === 0) delete styleMap[rootId];
  else styleMap[rootId] = entry;

  db.prepare(SQL.upsertMeta).run("category_style", JSON.stringify(styleMap));
  initCategoryStyle(styleMap);
  return styleMap;
}

test("createCategory (reproducido): crea una raíz al final de su grupo", () => {
  const db = openDb();
  seedMinimal(db);
  const id = createCategoryReproduced(db, { name: "Ocio", flow: "expense", needType: "want", parentId: "" });
  const row = getCategoryRow(db, id);
  assert.equal(row.name, "Ocio");
  assert.equal(row.parent_id, "");
  assert.equal(row.display_order, 2);
});

test("createCategory (reproducido): crea una hija bajo un padre raíz del MISMO flow", () => {
  const db = openDb();
  seedMinimal(db);
  const id = createCategoryReproduced(db, { name: "Comunidad", flow: "expense", needType: "need", parentId: "cat-casa" });
  const row = getCategoryRow(db, id);
  assert.equal(row.parent_id, "cat-casa");
});

test("createCategory (reproducido): rechaza un parentId de flow distinto al de la categoría nueva", () => {
  const db = openDb();
  seedMinimal(db); // cat-nomina es income
  assert.throws(
    () => createCategoryReproduced(db, { name: "X", flow: "expense", needType: "need", parentId: "cat-nomina" }),
    /principal del mismo tipo/,
  );
});

test("createCategory (reproducido): rechaza un parentId que no existe o que no es una categoría principal", () => {
  const db = openDb();
  seedMinimal(db);
  assert.throws(() => createCategoryReproduced(db, { name: "X", flow: "expense", parentId: "no-existe" }), /principal del mismo tipo/);
  // cat-casa-alquiler ya es una hija (parent_id='cat-casa'): no puede ser padre de otra (máx 2 niveles)
  assert.throws(() => createCategoryReproduced(db, { name: "X", flow: "expense", parentId: "cat-casa-alquiler" }), /principal del mismo tipo/);
});

test("createCategory (reproducido): rechaza nombre vacío tras el recorte (trim)", () => {
  const db = openDb();
  seedMinimal(db);
  assert.throws(() => createCategoryReproduced(db, { name: "   ", flow: "expense" }), /nombre.*no puede estar vacío/);
  assert.throws(() => createCategoryReproduced(db, { name: "", flow: "expense" }), /nombre.*no puede estar vacío/);
});

test("updateCategory (reproducido): renombra con bcSanitizeCell aplicado y edita el needType", () => {
  const db = openDb();
  seedMinimal(db);
  updateCategoryReproduced(db, "cat-casa-alquiler", { name: "=HACK()", needType: "want" });
  const row = getCategoryRow(db, "cat-casa-alquiler");
  assert.equal(row.name, "'=HACK()", "bcSanitizeCell antepone ' a fórmulas peligrosas");
  assert.equal(row.need_type, "want");
});

test("updateCategory (reproducido): mueve una hija a otra raíz del MISMO flow (OK)", () => {
  const db = openDb();
  seedMinimal(db);
  const otraRaizId = createCategoryReproduced(db, { name: "Ocio", flow: "expense", needType: "want", parentId: "" });
  updateCategoryReproduced(db, "cat-casa-alquiler", { parentId: otraRaizId });
  assert.equal(getCategoryRow(db, "cat-casa-alquiler").parent_id, otraRaizId);
});

test("updateCategory (reproducido): rechaza mover una hija a una raíz de flow distinto", () => {
  const db = openDb();
  seedMinimal(db);
  assert.throws(
    () => updateCategoryReproduced(db, "cat-casa-alquiler", { parentId: "cat-nomina" }),
    /principal del mismo tipo/,
  );
});

test("updateCategory (reproducido): convierte una hija en raíz (parentId: '')", () => {
  const db = openDb();
  seedMinimal(db);
  updateCategoryReproduced(db, "cat-casa-alquiler", { parentId: "" });
  assert.equal(getCategoryRow(db, "cat-casa-alquiler").parent_id, "");
});

test("updateCategory (reproducido): una raíz CON hijas activas no puede recibir parentId (máx 2 niveles)", () => {
  const db = openDb();
  seedMinimal(db); // cat-casa tiene a cat-casa-alquiler como hija activa
  const otraRaizId = createCategoryReproduced(db, { name: "Ocio", flow: "expense", needType: "want", parentId: "" });
  assert.throws(
    () => updateCategoryReproduced(db, "cat-casa", { parentId: otraRaizId }),
    /máx.*niveles|dos niveles/i,
  );
});

test("updateCategory (reproducido): una raíz SIN hijas activas SÍ puede recibir parentId", () => {
  const db = openDb();
  seedMinimal(db);
  const raizA = createCategoryReproduced(db, { name: "A", flow: "expense", needType: "want", parentId: "" });
  const raizB = createCategoryReproduced(db, { name: "B", flow: "expense", needType: "want", parentId: "" });
  updateCategoryReproduced(db, raizA, { parentId: raizB });
  assert.equal(getCategoryRow(db, raizA).parent_id, raizB);
});

test("updateCategory (reproducido): flow es inmutable — pasar la clave lanza, incluso con el mismo valor", () => {
  const db = openDb();
  seedMinimal(db);
  assert.throws(
    () => updateCategoryReproduced(db, "cat-casa", { flow: "expense" }),
    /tipo.*no se puede cambiar/,
  );
});

test("updateCategory (reproducido): rechaza nombre vacío tras el recorte", () => {
  const db = openDb();
  seedMinimal(db);
  assert.throws(() => updateCategoryReproduced(db, "cat-casa", { name: "   " }), /nombre.*no puede estar vacío/);
});

test("updateCategory (reproducido): lanza si la categoría no existe", () => {
  const db = openDb();
  seedMinimal(db);
  assert.throws(() => updateCategoryReproduced(db, "no-existe", { name: "X" }), /no encontrada/);
});

test("archiveCategory (reproducido): archivar una raíz archiva sus hijas ACTIVAS en cascada, en un único execMany", () => {
  const db = openDb();
  seedMinimal(db); // cat-casa-alquiler es hija activa de cat-casa
  const otraHijaId = createCategoryReproduced(db, { name: "Comunidad", flow: "expense", needType: "need", parentId: "cat-casa" });
  const hijaYaArchivadaId = createCategoryReproduced(db, { name: "Ya archivada", flow: "expense", needType: "need", parentId: "cat-casa" });
  db.prepare(SQL.setCategoryArchived).run(1, T, hijaYaArchivadaId); // esta ya estaba archivada ANTES de archivar la raíz

  archiveCategoryReproduced(db, "cat-casa");

  assert.equal(getCategoryRow(db, "cat-casa").is_archived, 1);
  assert.equal(getCategoryRow(db, "cat-casa-alquiler").is_archived, 1, "hija activa: archivada en cascada");
  assert.equal(getCategoryRow(db, otraHijaId).is_archived, 1, "hija activa: archivada en cascada");
  assert.equal(
    getCategoryRow(db, hijaYaArchivadaId).updated_at, T,
    "childrenOf (activas) la excluyó de la cascada: su updated_at sigue en T, no se tocó al archivar cat-casa (que usa T2)",
  );
});

test("archiveCategory (reproducido): una hija (sin hijas propias) archiva solo su propia fila", () => {
  const db = openDb();
  seedMinimal(db);
  archiveCategoryReproduced(db, "cat-casa-alquiler");
  assert.equal(getCategoryRow(db, "cat-casa-alquiler").is_archived, 1);
  assert.equal(getCategoryRow(db, "cat-casa").is_archived, 0, "la raíz no se ve afectada al archivar una hija");
});

test("unarchiveCategory (reproducido): desarchiva la raíz pero NO sus hijas (explícito, sin cascada)", () => {
  const db = openDb();
  seedMinimal(db);
  archiveCategoryReproduced(db, "cat-casa"); // cascada: casa + alquiler archivadas

  unarchiveCategoryReproduced(db, "cat-casa");

  assert.equal(getCategoryRow(db, "cat-casa").is_archived, 0, "la raíz vuelve a estar activa");
  assert.equal(getCategoryRow(db, "cat-casa-alquiler").is_archived, 1, "la hija SIGUE archivada: desarchivar no cascada");
});

test("reorderCategories (reproducido): persiste display_order 1..n según la posición en el array recibido", () => {
  const db = openDb();
  seedMinimal(db);
  const b = createCategoryReproduced(db, { name: "B", flow: "expense", needType: "want", parentId: "" });
  const c = createCategoryReproduced(db, { name: "C", flow: "expense", needType: "want", parentId: "" });
  // orden actual por display_order: cat-casa(1), b(2), c(3). Reordena a [c, cat-casa, b].
  const nuevoOrden = computeReorder(["cat-casa", b, c], 2, 0); // mueve c (índice 2) a la posición 0

  reorderCategoriesReproduced(db, nuevoOrden);

  assert.equal(getCategoryRow(db, c).display_order, 1);
  assert.equal(getCategoryRow(db, "cat-casa").display_order, 2);
  assert.equal(getCategoryRow(db, b).display_order, 3);
});

test("setCategoryStyle (reproducido): color en POOL + icono CURATED se guardan y refrescan initCategoryStyle", () => {
  const db = openDb();
  seedMinimal(db);
  const styleMap = setCategoryStyleReproduced(db, "cat-casa", { color: POOL[0], icon: CURATED_ICONS[0] });

  assert.deepEqual(styleMap["cat-casa"], { color: POOL[0], icon: CURATED_ICONS[0] });
  const raw = db.prepare("SELECT value FROM meta WHERE key='category_style'").get().value;
  assert.deepEqual(JSON.parse(raw), { "cat-casa": { color: POOL[0], icon: CURATED_ICONS[0] } });
});

test("setCategoryStyle (reproducido): un icono ya usado como seed (CATEGORY_ICONS) también es válido, no solo los CURATED", () => {
  const db = openDb();
  seedMinimal(db);
  const seedIcon = Object.values(CATEGORY_ICONS)[0];
  const styleMap = setCategoryStyleReproduced(db, "cat-casa", { icon: seedIcon });
  assert.equal(styleMap["cat-casa"].icon, seedIcon);
});

test("setCategoryStyle (reproducido): rechaza un color fuera del POOL", () => {
  const db = openDb();
  seedMinimal(db);
  assert.throws(() => setCategoryStyleReproduced(db, "cat-casa", { color: "#000000" }), /color/i);
});

test("setCategoryStyle (reproducido): rechaza un icono no permitido", () => {
  const db = openDb();
  seedMinimal(db);
  assert.throws(() => setCategoryStyleReproduced(db, "cat-casa", { icon: "🚫" }), /icono/i);
});

test("setCategoryStyle (reproducido): entrada vacía ({} sin color ni icono) elimina la clave del JSON", () => {
  const db = openDb();
  seedMinimal(db);
  setCategoryStyleReproduced(db, "cat-casa", { color: POOL[0], icon: CURATED_ICONS[0] });

  const styleMap = setCategoryStyleReproduced(db, "cat-casa", {});

  assert.equal(styleMap["cat-casa"], undefined);
  const raw = db.prepare("SELECT value FROM meta WHERE key='category_style'").get().value;
  assert.deepEqual(JSON.parse(raw), {});
});

test("setCategoryStyle (reproducido): reemplaza la entrada por completo (no fusiona con la anterior) — solo pasar icon deja el color anterior fuera", () => {
  const db = openDb();
  seedMinimal(db);
  setCategoryStyleReproduced(db, "cat-casa", { color: POOL[0], icon: CURATED_ICONS[0] });

  const styleMap = setCategoryStyleReproduced(db, "cat-casa", { icon: CURATED_ICONS[1] });

  assert.deepEqual(styleMap["cat-casa"], { icon: CURATED_ICONS[1] }, "color anterior NO se conserva: la llamada manda el estado final completo");
});
