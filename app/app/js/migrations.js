/** Migraciones de esquema de una BD que YA existe. schema.sql solo tiene CREATE TABLE IF NOT
 *  EXISTS: sobre una tabla ya creada es un no-op, así que una columna nueva nunca llegaría por esa
 *  vía a la BD OPFS de un usuario real (ver db-worker.js:20). Este módulo es la lista ORDENADA
 *  de migraciones; db-worker.js la aplica en cada arranque, justo después de db.exec(schema).
 *  PURO a propósito (mismo criterio que share-pct.js/prevision.js): recibe el estado real de la BD
 *  y devuelve los statements, sin ejecutarlos. */

/** Versión que deja este código en meta.schema_version. Subirla es parte de añadir una migración. */
export const SCHEMA_VERSION = "3";

/** Versiones de schema_version que una hoja importada puede traer y aceptamos (xlsx.js las valida
 *  contra esta lista, no contra un literal repetido). Incluye SCHEMA_VERSION y todas las versiones
 *  anteriores que workbookToRows sabe rellenar con TEXT_DEFAULTS (hoy solo "1" → paid_by='me'). */
export const ACCEPTED_SCHEMA_VERSIONS = ["1", "2", "3"];

/** Lista ORDENADA. `needed(cols)` mira el ESTADO REAL de la tabla, nunca el número guardado en
 *  meta: la verdad de si falta una columna la tiene PRAGMA table_info, no una fila de texto. El
 *  upsert de meta.schema_version se ejecuta en cada arranque. Una hoja v1 podía sobrescribir
 *  meta.schema_version en versiones anteriores al filtro de replaceAllStmts (ver
 *  repo.replaceAllStmts), así que ese mismo upsert también repara esas bases de datos. Añadir la
 *  siguiente migración = una entrada más aquí + subir SCHEMA_VERSION.
 *  NOTA de rama (spec §4.2): si `feat/registro-v2-extras` (has_attachment, v3) se mergea antes que
 *  esta PR, esta entrada pasa a v4 y se coloca DESPUÉS de la suya — cambio mecánico de un literal.
 *  El test de versiones ÚNICAS (migraciones.test.mjs) convierte una colisión de esa contingencia
 *  en rojo en vez de dejarla colarse en silencio. */
export const MIGRATIONS = [
  {
    version: "2",
    table: "transactions",
    needed: (cols) => !cols.includes("paid_by"),
    sql: [`ALTER TABLE transactions ADD COLUMN paid_by TEXT NOT NULL DEFAULT 'me' CHECK (paid_by IN ('me','partner'))`],
  },
  {
    // Suscripciones (N6): las dos columnas llegan JUNTAS o no llega ninguna — un solo `needed`
    // mirando is_subscription basta, porque las dos se añaden a la vez en el mismo array `sql`,
    // dentro del mismo BEGIN/COMMIT del runner (db-worker.js).
    version: "3",
    table: "recurring_rules",
    needed: (cols) => !cols.includes("is_subscription"),
    sql: [
      `ALTER TABLE recurring_rules ADD COLUMN is_subscription INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE recurring_rules ADD COLUMN cancelled_at TEXT NOT NULL DEFAULT ''`,
    ],
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
