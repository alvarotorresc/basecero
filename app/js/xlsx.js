import { CONTRACT, ENUMS, BOOL_COLS, NULLABLE_NUM, FKS, eurToCents, centsToEur, xlsxHeader, toIsoDate } from "./contract.js";
import { t } from "./i18n/index.js";

// dump: { tabla: [{col: valor SQLite}] } → workbook con una pestaña por tabla.
// Sin dashboards y sin columnas "_": el dump ya solo trae columnas del contrato.
export function rowsToWorkbook(X, dump) {
  const wb = X.utils.book_new();
  for (const table of Object.keys(CONTRACT)) {
    const cols = CONTRACT[table].cols;
    const bools = new Set(BOOL_COLS[table] ?? []);
    const aoa = [cols.map(xlsxHeader)];
    for (const row of dump[table] ?? []) {
      aoa.push(cols.map((c) => {
        const v = row[c];
        if (c.endsWith("_cents")) return v == null ? "" : centsToEur(v);
        if (bools.has(c)) return v === 1;
        return v ?? "";
      }));
    }
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), table);
  }
  return wb;
}

const DATE_COLS = new Set(["date", "start_date", "end_date", "target_date"]);

// Representaciones reconocidas de un booleano en una celda de xlsx — lo que hoy produce un
// export real (rowsToWorkbook escribe un boolean JS nativo) y lo que sobrevive un round-trip
// binario (X.write/X.read conservan el tipo de celda: boolean, number o string tal cual). Todo
// lo que NO esté en estos dos sets se deja SIN COERCIONAR (ver workbookToRows más abajo) para
// que validateImport lo rechace como fila inválida en vez de colar un 0 silencioso.
// "" cuenta como false: una hoja rellenada a mano (created_with: basecero-sheets-mvp) deja
// celdas booleanas en blanco por defecto — comportamiento YA existente hoy (el ternario previo
// caía a 0 para cualquier no-true), así que no es una coerción nueva, solo se preserva.
const BOOL_TRUE = new Set([true, "TRUE", 1, "1"]);
const BOOL_FALSE = new Set([false, "FALSE", 0, "0", ""]);

// Parseo real de calendario (no solo forma): rechaza "2026-13-40", "2026-02-30", etc. — un
// regex de forma por sí solo deja pasar meses/días fuera de rango.
function isValidIsoDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function workbookToRows(X, wb) {
  const data = {}, errors = [];
  for (const table of Object.keys(CONTRACT)) {
    const ws = wb.Sheets[table];
    if (!ws) { errors.push(t("errors.xlsx.missingSheet", { table })); continue; }
    const cols = CONTRACT[table].cols, bools = new Set(BOOL_COLS[table] ?? []);
    const byHeader = Object.fromEntries(cols.map((c) => [xlsxHeader(c), c]));
    const raw = X.utils.sheet_to_json(ws, { defval: "" });
    // Filas totalmente vacías fuera — pero solo cuentan las columnas DEL CONTRATO (byHeader).
    // La hoja del generador añade a la derecha de "meta" columnas sin cabecera de contrato con
    // las listas de los desplegables (enum_*), con más filas de valores que filas key/value
    // reales: si se mirara Object.values(r) entero, esas columnas "colaban" como fila no-vacía
    // y sobrevivían como {key:"",value:""} — dos PKs '' duplicadas que revientan el replaceAll
    // con "UNIQUE constraint failed: meta.key" al importar la hoja real del generador.
    data[table] = raw
      .filter((r) => Object.entries(r).some(([h, v]) => byHeader[h] && v !== ""))
      .map((r) => {
        const row = {};
        for (const [h, v] of Object.entries(r)) {
          const col = byHeader[h];
          if (!col) continue;                                   // "_account", desconocidas… se ignoran
          if (NULLABLE_NUM.has(col) && v === "") row[col] = null;
          else if (col.endsWith("_cents")) row[col] = v === "" ? null : eurToCents(v);
          else if (bools.has(col)) row[col] = BOOL_TRUE.has(v) ? 1 : BOOL_FALSE.has(v) ? 0 : v;
          else if (DATE_COLS.has(col)) row[col] = toIsoDate(v);
          else row[col] = v;
        }
        for (const c of cols) if (!(c in row)) row[c] = bools.has(c) ? 0 : NULLABLE_NUM.has(c) ? null : (c.endsWith("_cents") ? null : "");
        return row;
      });
  }
  return { data, errors };
}

export function validateImport(data) {
  const errs = [];
  const meta = Object.fromEntries((data.meta ?? []).map((m) => [m.key, String(m.value)]));
  if (meta.schema_version !== "1") errs.push(t("errors.xlsx.schemaVersion", { value: meta.schema_version }));
  if (!["basecero-sheets-mvp", "basecero-pwa"].includes(meta.created_with))
    errs.push(t("errors.xlsx.createdWith", { value: meta.created_with }));

  // PK vacía o duplicada dentro de la propia pestaña (meta usa "key", el resto "id"): sin este
  // check, una fila con PK vacía se cuela en el Set de ids de abajo indistinguible de "sin FK", y
  // una PK duplicada sobrescribe en silencio la fila anterior al hacer replaceAll — el bug real
  // que motivó este hallazgo era justo eso (dos {key:"",value:""}).
  //
  // Item 2 (Important, review final): charset cerrado del id/key — sin este check, un id/key con
  // comillas o "<" (payload de XSS) sobrevive el import y acaba, sin escapar, en algún atributo
  // HTML de una pantalla (categorias.js, movimientos, etc). [A-Za-z0-9_-]{1,64} cubre los 3 formatos
  // reales que usa la app: seeds kebab-case (cat-casa-alquiler), ULIDs Crockford (bcUlid, 26 chars
  // en 0-9A-Z) y claves de meta con underscore (category_style, import_account_id...).
  const ID_CHARS_RE = /^[A-Za-z0-9_-]{1,64}$/;
  for (const table of Object.keys(CONTRACT)) {
    const pkCol = table === "meta" ? "key" : "id";
    const seen = new Set();
    (data[table] ?? []).forEach((row, i) => {
      const pk = row[pkCol];
      if (pk === "" || pk == null) { errs.push(t("errors.xlsx.pkEmpty", { table, row: i + 2 })); return; }
      if (seen.has(pk)) errs.push(t("errors.xlsx.pkDuplicate", { table, row: i + 2, pk }));
      else seen.add(pk);
      if (!ID_CHARS_RE.test(String(pk))) errs.push(t("errors.xlsx.pkInvalidChars", { table, row: i + 2, pk }));
    });
  }

  const ids = {};       // tabla → Set de ids (para FKs, incluye soft-deleted)
  const liveIds = {};   // tabla → Set de ids de filas NO borradas (deleted !== 1)
  for (const tbl of Object.keys(CONTRACT)) {
    const rows = data[tbl] ?? [];
    ids[tbl] = new Set(rows.map((r) => r.id ?? r.key));
    liveIds[tbl] = new Set(rows.filter((r) => r.deleted !== 1).map((r) => r.id ?? r.key));
  }

  for (const [table, spec] of Object.entries(ENUMS))
    (data[table] ?? []).forEach((row, i) => {
      for (const [col, allowed] of Object.entries(spec))
        if (!allowed.includes(String(row[col] ?? "")))
          errs.push(t("errors.xlsx.enumInvalid", { table, row: i + 2, col, value: row[col] }));
    });

  // FKs: existencia (fkMissing, ya existía) + integridad viva (fkDeleted, nuevo) — una fila NO
  // borrada no puede referenciar, vía FK, una fila que SÍ está borrada. Una fila borrada puede
  // seguir apuntando a otra borrada sin problema (soft-delete en cascada de una exportación real).
  // FKS.allowDeletedRef exime a ref_id/rule_id de este check vivo→vivo (ver comentario en
  // contract.js): son estados que el repo YA permite crear en uso normal, pre-Task 6.
  for (const fk of FKS)
    (data[fk.table] ?? []).forEach((row, i) => {
      const v = row[fk.col];
      if (v === "" || v == null) { if (!fk.optional) errs.push(t("errors.xlsx.fkEmpty", { table: fk.table, row: i + 2, col: fk.col })); return; }
      if (!ids[fk.ref].has(v)) { errs.push(t("errors.xlsx.fkMissing", { table: fk.table, row: i + 2, col: fk.col, value: v, ref: fk.ref })); return; }
      if (!fk.allowDeletedRef && row.deleted !== 1 && !liveIds[fk.ref].has(v))
        errs.push(t("errors.xlsx.fkDeleted", { table: fk.table, row: i + 2, col: fk.col, value: v, ref: fk.ref }));
    });

  // Árbol de categorías: replica assertValidParent (repo.js) — sin padre, o padre RAÍZ del
  // MISMO flow. Con esto un ciclo o un árbol de más de 2 niveles es estructuralmente imposible:
  // si el padre referenciado no es raíz, es error, así que nunca puede haber un "nieto".
  const catById = Object.fromEntries((data.categories ?? []).map((r) => [r.id, r]));
  (data.categories ?? []).forEach((row, i) => {
    if (row.parent_id === "") return;
    if (row.parent_id === row.id) { errs.push(t("errors.xlsx.parentSelf", { row: i + 2 })); return; }
    const parent = catById[row.parent_id];
    if (!parent) return; // ya reportado arriba como fkMissing
    if (parent.parent_id !== "") errs.push(t("errors.xlsx.parentNotRoot", { row: i + 2 }));
    if (parent.flow !== row.flow) errs.push(t("errors.xlsx.parentFlow", { row: i + 2 }));
  });

  // Fechas: toda columna DATE_COLS con valor no vacío debe ser una fecha ISO real (forma +
  // calendario) — no solo dígitos con guiones ("2026-13-40" tiene la forma pero no es fecha).
  //
  // I1 (revisión final): transactions.date y periods.start_date son NOT NULL en schema.sql — un
  // blanco ahí NO es "sin valor que validar" (el continue de abajo), es una fila inválida: una
  // fecha vacía en NOT NULL revienta el insert, o peor, si SQLite la admite como TEXT '' cuela
  // silenciosa. periods.end_date se queda FUERA de este set a propósito: NOT NULL DEFAULT '' pero
  // legítimamente vacío en un periodo open — su invariante ya lo valida periodEndMismatch más abajo,
  // exigirlo aquí también rechazaría el caso normal (periodo abierto). goals.target_date es NOT
  // NULL DEFAULT '' y opcional por contrato (no todo goal tiene fecha objetivo) — tampoco entra.
  const REQUIRED_DATE_COLS = new Set(["date", "start_date"]);
  for (const table of Object.keys(CONTRACT)) {
    const dateCols = CONTRACT[table].cols.filter((c) => DATE_COLS.has(c));
    if (!dateCols.length) continue;
    (data[table] ?? []).forEach((row, i) => {
      for (const col of dateCols) {
        const v = row[col];
        if (v === "" || v == null) {
          if (REQUIRED_DATE_COLS.has(col)) errs.push(t("errors.xlsx.required", { table, row: i + 2, col }));
          continue;
        }
        if (!isValidIsoDate(String(v)))
          errs.push(t("errors.xlsx.dateFormat", { table, row: i + 2, col, value: v }));
      }
    });
  }

  const open = (data.periods ?? []).filter((p) => p.status === "open" && p.deleted !== 1);
  if (open.length > 1) errs.push(t("errors.xlsx.multipleOpen", { n: open.length }));

  // Invariante open/closed: end_date vacío ⟺ status open; en closed, start_date <= end_date.
  (data.periods ?? []).forEach((row, i) => {
    if (row.status === "open") {
      if (row.end_date !== "") errs.push(t("errors.xlsx.periodEndMismatch", { row: i + 2 }));
    } else if (row.status === "closed") {
      if (row.end_date === "") errs.push(t("errors.xlsx.periodEndMismatch", { row: i + 2 }));
      else if (row.start_date > row.end_date) errs.push(t("errors.xlsx.periodOrder", { row: i + 2 }));
    }
  });

  // Solo se evalúa >0 cuando amount_cents es un número real: si no es finito (import no
  // numérico, p.ej. "lunes" → NaN vía eurToCents), el check de abajo (numericInvalid en
  // *_cents) ya lo reporta — sin esta guarda, "!(NaN > 0)" es true y se duplica el error
  // diagnosticando "no positivo" en vez de "no es un número", que es engañoso.
  (data.transactions ?? []).forEach((row, i) => {
    if (row.type !== "adjustment" && Number.isFinite(row.amount_cents) && !(row.amount_cents > 0))
      errs.push(t("errors.xlsx.amountNotPositive", { row: i + 2 }));
  });

  // Columnas numéricas NO-*_cents del contrato: workbookToRows las deja pasar tal cual llegan
  // de la celda (ni coerción ni parseo), así que un "lunes" en my_share_pct sobrevive intacto
  // hasta aquí como string — sin este check, acaba en SQLite como TEXT (afinidad dinámica) y
  // produce "NaN €"/"NaN %" en cualquier pantalla que haga aritmética con la columna.
  // schema_version NO es una columna del contrato (vive como fila key/value en meta) y ya se
  // valida arriba con igualdad estricta — no se repite aquí.
  //
  // I1 (revisión final): un blanco aquí YA NO se salta sin más. NULLABLE_NUM (contract.js) es
  // exactamente el set de columnas SIN NOT NULL en schema.sql (share_pct_override, due_day,
  // due_month, target_amount_cents, target_months, target_pct) — para esas, blanco sigue siendo
  // un skip legítimo. Para el resto de esta tabla (display_order en accounts/categories,
  // my_share_pct en periods) la columna ES NOT NULL: un blanco ahí guardaba TEXT '' en una
  // columna INTEGER/REAL, coló por este check y produjo el hallazgo real (my_share_pct='' →
  // COALESCE no coalesce → reparto compartido se vuelve 0%/100% en silencio).
  const NUMERIC_COLS = {
    accounts: { display_order: { integer: true } },
    categories: { display_order: { integer: true } },
    periods: { my_share_pct: { min: 0, max: 100 } },                    // REAL, no entero
    transactions: { share_pct_override: { min: 0, max: 100 } },          // REAL, nullable
    recurring_rules: {
      due_day: { integer: true, min: 1, max: 31 },
      due_month: { integer: true, min: 1, max: 12 },
    },
    goals: { target_months: { integer: true }, target_pct: {} },         // target_pct REAL
  };
  for (const [table, spec] of Object.entries(NUMERIC_COLS))
    (data[table] ?? []).forEach((row, i) => {
      for (const [col, { integer, min, max }] of Object.entries(spec)) {
        const v = row[col];
        // trim(): a celda "solo espacio" (" ") no es === "" pero Number(" ") es 0 — un finito
        // válido que se colaría en rango sin este trim, dejando pasar exactamente la misma
        // corrupción silenciosa (TEXT no-numérico en columna REAL/INTEGER NOT NULL) que motivó
        // este check. Solo aplica a este bucle: las columnas *_cents ya llegan numéricas (o null)
        // desde workbookToRows vía eurToCents, y las de fecha pasan por toIsoDate/isValidIsoDate,
        // que rechazan " " como fecha inválida sin necesitar trim aquí.
        if (v == null || String(v).trim() === "") {
          if (!NULLABLE_NUM.has(col)) errs.push(t("errors.xlsx.required", { table, row: i + 2, col }));
          continue;
        }
        const n = Number(v);
        if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) {
          errs.push(t("errors.xlsx.numericInvalid", { table, row: i + 2, col, value: v }));
          continue;
        }
        if (min != null && (n < min || n > max))
          errs.push(t("errors.xlsx.numericRange", { table, row: i + 2, col, value: v, min, max }));
      }
    });

  // Columnas *_cents: workbookToRows YA las convirtió con eurToCents (Math.round(Number(v)*100))
  // antes de llegar aquí, así que un valor no numérico ya es NaN (siempre entero o NaN, nunca un
  // finito no entero: Math.round lo garantiza) — el único fallo posible es "no finito".
  //
  // I1 (revisión final): workbookToRows deja un blanco de CUALQUIER columna *_cents como null,
  // sea o no NULLABLE_NUM — la única *_cents nullable por contrato es goals.target_amount_cents
  // (sin NOT NULL en schema.sql); el resto (opening_balance_cents, transactions.amount_cents,
  // recurring_rules.amount_cents, budgets.amount_cents) SON NOT NULL: un blanco ahí antes pasaba
  // como null hasta el INSERT y reventaba con el error crudo de SQLite (o, peor, si la columna
  // tolerase null, corrompía en silencio). Se reporta con el mismo mensaje "required" que arriba.
  for (const table of Object.keys(CONTRACT)) {
    const centsCols = CONTRACT[table].cols.filter((c) => c.endsWith("_cents"));
    if (!centsCols.length) continue;
    (data[table] ?? []).forEach((row, i) => {
      for (const col of centsCols) {
        const v = row[col];
        if (v == null) {
          if (!NULLABLE_NUM.has(col)) errs.push(t("errors.xlsx.required", { table, row: i + 2, col }));
          continue;
        }
        if (!Number.isFinite(v)) errs.push(t("errors.xlsx.numericInvalid", { table, row: i + 2, col, value: v }));
      }
    });
  }

  // Booleanos: workbookToRows ya normalizó todo valor reconocido (BOOL_TRUE/BOOL_FALSE) a 1/0 y
  // dejó SIN TOCAR cualquier otra cosa ("yes", "maybe"…) para que aquí se rechace como error de
  // fila — la alternativa (coercionar en silencio a 0) es indistinguible de un false legítimo y
  // esconde el defecto en vez de bloquear el import.
  for (const table of Object.keys(CONTRACT)) {
    const bools = BOOL_COLS[table] ?? [];
    if (!bools.length) continue;
    (data[table] ?? []).forEach((row, i) => {
      for (const col of bools) {
        const v = row[col];
        if (v !== 0 && v !== 1) errs.push(t("errors.xlsx.booleanInvalid", { table, row: i + 2, col, value: v }));
      }
    });
  }

  return errs;
}
