import { CONTRACT, BOOL_COLS, centsToEur, xlsxHeader } from "./contract.js";

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
