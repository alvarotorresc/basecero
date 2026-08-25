import { CONTRACT, ENUMS, BOOL_COLS, NULLABLE_NUM, FKS, eurToCents, centsToEur, xlsxHeader, toIsoDate } from "./contract.js";

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

export function workbookToRows(X, wb) {
  const data = {}, errors = [];
  for (const table of Object.keys(CONTRACT)) {
    const ws = wb.Sheets[table];
    if (!ws) { errors.push(`falta la pestaña «${table}»`); continue; }
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
          else if (bools.has(col)) row[col] = v === true || v === "TRUE" || v === 1 ? 1 : 0;
          else if (DATE_COLS.has(col)) row[col] = toIsoDate(v);
          else row[col] = v;
        }
        for (const c of cols) if (!(c in row)) row[c] = NULLABLE_NUM.has(c) ? null : (c.endsWith("_cents") ? null : "");
        return row;
      });
  }
  return { data, errors };
}

export function validateImport(data) {
  const errs = [];
  const meta = Object.fromEntries((data.meta ?? []).map((m) => [m.key, String(m.value)]));
  if (meta.schema_version !== "1") errs.push(`meta: schema_version debe ser 1 (es «${meta.schema_version}»)`);
  if (!["basecero-sheets-mvp", "basecero-pwa"].includes(meta.created_with))
    errs.push(`meta: created_with no reconocido («${meta.created_with}»)`);

  // PK vacía o duplicada dentro de la propia pestaña (meta usa "key", el resto "id"): sin este
  // check, una fila con PK vacía se cuela en el Set de ids de abajo indistinguible de "sin FK", y
  // una PK duplicada sobrescribe en silencio la fila anterior al hacer replaceAll — el bug real
  // que motivó este hallazgo era justo eso (dos {key:"",value:""}).
  for (const table of Object.keys(CONTRACT)) {
    const pkCol = table === "meta" ? "key" : "id";
    const seen = new Set();
    (data[table] ?? []).forEach((row, i) => {
      const pk = row[pkCol];
      if (pk === "" || pk == null) { errs.push(`pestaña «${table}» fila ${i + 2}: id vacío`); return; }
      if (seen.has(pk)) errs.push(`pestaña «${table}» fila ${i + 2}: id duplicado («${pk}»)`);
      else seen.add(pk);
    });
  }

  const ids = {};   // tabla → Set de ids (para FKs)
  for (const t of Object.keys(CONTRACT))
    ids[t] = new Set((data[t] ?? []).map((r) => r.id ?? r.key));

  for (const [table, spec] of Object.entries(ENUMS))
    (data[table] ?? []).forEach((row, i) => {
      for (const [col, allowed] of Object.entries(spec))
        if (!allowed.includes(String(row[col] ?? "")))
          errs.push(`pestaña «${table}» fila ${i + 2}: ${col} inválido («${row[col]}»)`);
    });

  for (const fk of FKS)
    (data[fk.table] ?? []).forEach((row, i) => {
      const v = row[fk.col];
      if (v === "" || v == null) { if (!fk.optional) errs.push(`pestaña «${fk.table}» fila ${i + 2}: ${fk.col} vacío`); return; }
      if (!ids[fk.ref].has(v)) errs.push(`pestaña «${fk.table}» fila ${i + 2}: ${fk.col} apunta a «${v}» que no existe en ${fk.ref}`);
    });

  const open = (data.periods ?? []).filter((p) => p.status === "open" && p.deleted !== 1);
  if (open.length > 1) errs.push(`periods: hay ${open.length} periodos open (máximo 1)`);

  (data.transactions ?? []).forEach((row, i) => {
    if (row.type !== "adjustment" && !(row.amount_cents > 0))
      errs.push(`pestaña «transactions» fila ${i + 2}: amount debe ser > 0`);
  });
  return errs;
}
