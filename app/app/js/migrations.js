/** Migraciones de esquema de una BD que YA existe. schema.sql solo tiene CREATE TABLE IF NOT
 *  EXISTS: sobre una tabla ya creada es un no-op, así que una columna nueva nunca llegaría por esa
 *  vía a la BD OPFS de un usuario real (ver db-worker.js:20). Este módulo es la lista ORDENADA
 *  de migraciones; db-worker.js la aplica en cada arranque, justo después de db.exec(schema).
 *  PURO a propósito (mismo criterio que share-pct.js/prevision.js): recibe el estado real de la BD
 *  y devuelve los statements, sin ejecutarlos. */

/** Versión que deja este código en meta.schema_version. Subirla es parte de añadir una migración. */
export const SCHEMA_VERSION = "2";

/** Versiones de schema_version que una hoja importada puede traer y aceptamos (xlsx.js las valida
 *  contra esta lista, no contra un literal repetido). Incluye SCHEMA_VERSION y todas las versiones
 *  anteriores que workbookToRows sabe rellenar con TEXT_DEFAULTS (hoy solo "1" → paid_by='me'). */
export const ACCEPTED_SCHEMA_VERSIONS = ["1", "2"];

/** Lista ORDENADA. `needed(cols)` mira el ESTADO REAL de la tabla, nunca el número guardado en
 *  meta: importar una hoja v1 puede haber pisado meta.schema_version (ver repo.replaceAllStmts) —
 *  ya no desde el filtro de replaceAllStmts; se conserva por las BD dañadas por versiones
 *  anteriores —, y la verdad de si falta la columna la tiene PRAGMA table_info, no una fila de
 *  texto. Añadir la siguiente migración = una entrada más aquí + subir SCHEMA_VERSION. */
export const MIGRATIONS = [
  {
    version: "2",
    table: "transactions",
    needed: (cols) => !cols.includes("paid_by"),
    sql: [`ALTER TABLE transactions ADD COLUMN paid_by TEXT NOT NULL DEFAULT 'me' CHECK (paid_by IN ('me','partner'))`],
  },
];

/** Statements pendientes para una BD cuyas columnas por tabla son `colsByTable`
 *  ({transactions: ["id","date",…]}). Termina SIEMPRE con el upsert de meta.schema_version, falte
 *  o no alguna migración: así una BD cuya versión quedó pisada por un import se recoloca sola en el
 *  siguiente arranque, y llamar dos veces es idempotente (la segunda solo reescribe el mismo valor). */
export function pendingMigrations(colsByTable) {
  const stmts = [];
  for (const m of MIGRATIONS)
    if (m.needed(colsByTable[m.table] ?? [])) for (const sql of m.sql) stmts.push({ sql, bind: [] });
  stmts.push({
    sql: `INSERT INTO meta (key,value) VALUES ('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    bind: [SCHEMA_VERSION],
  });
  return stmts;
}
