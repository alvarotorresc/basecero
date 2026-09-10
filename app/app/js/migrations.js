/** Migraciones de esquema de una BD que YA existe. schema.sql solo tiene CREATE TABLE IF NOT
 *  EXISTS: sobre una tabla ya creada es un no-op, así que una columna nueva nunca llegaría por esa
 *  vía a la BD OPFS de un usuario real (ver db-worker.js:20). Este módulo es la lista ORDENADA
 *  de migraciones; db-worker.js la aplica en cada arranque, justo después de db.exec(schema).
 *  PURO a propósito (mismo criterio que share-pct.js/prevision.js): recibe el estado real de la BD
 *  y devuelve los statements, sin ejecutarlos. */

/** Versión que deja este código en meta.schema_version. Subirla es parte de añadir una migración. */
export const SCHEMA_VERSION = "4";

/** Versiones de schema_version que una hoja importada puede traer y aceptamos (xlsx.js las valida
 *  contra esta lista, no contra un literal repetido). Incluye SCHEMA_VERSION y todas las versiones
 *  anteriores que workbookToRows sabe rellenar con TEXT_DEFAULTS (hoy solo "1" → paid_by='me'). */
export const ACCEPTED_SCHEMA_VERSIONS = ["1", "2", "3", "4"];

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
  {
    // Etiquetas de proyecto (N11, etiquetas-design §5.3): la tabla `tags` y transactions.tag_id
    // llegan JUNTAS, así que `needed` mira solo tag_id (el mismo criterio que la entrada de
    // arriba). El CREATE TABLE de aquí es SIEMPRE un no-op en un móvil real —db.exec(schema) ya
    // creó `tags` antes de que el runner llegue aquí (db-worker.js:20)— pero se escribe igual
    // porque el brief pide una migración autosuficiente: esta entrada describe ENTERA la
    // diferencia entre v3 y v4, sin depender de que quien la ejecute haya aplicado antes
    // schema.sql. Está escrito DOS VECES (aquí y en schema.sql); el test anti-deriva de
    // migraciones.test.mjs compara PRAGMA table_info(tags) de los dos caminos.
    version: "4",
    table: "transactions",
    needed: (cols) => !cols.includes("tag_id"),
    sql: [
      `CREATE TABLE IF NOT EXISTS tags (
         id TEXT PRIMARY KEY, name TEXT NOT NULL, budget_cents INTEGER,
         is_archived INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`,
      `ALTER TABLE transactions ADD COLUMN tag_id TEXT NOT NULL DEFAULT ''`,
    ],
  },
];

/** Statements pendientes para una BD cuyas columnas por tabla son `colsByTable`
 *  ({transactions: ["id","date",…]}). Termina SIEMPRE con el índice tx_tag y el upsert de
 *  meta.schema_version, falte o no alguna migración: así una BD cuya versión quedó pisada por un
 *  import se recoloca sola en el siguiente arranque, y llamar dos veces es idempotente (la segunda
 *  solo reescribe/reaplica los mismos valores). */
export function pendingMigrations(colsByTable) {
  const stmts = [];
  for (const m of MIGRATIONS)
    if (m.needed(colsByTable[m.table] ?? [])) for (const sql of m.sql) stmts.push({ sql, bind: [] });
  // tx_tag no puede vivir en schema.sql (comentario de schema.sql, junto a tx_ref): schema.sql
  // corre en CADA arranque ANTES que las migraciones (db-worker.js:20), así que un CREATE INDEX
  // sobre tag_id ahí reventaría "no such column" en el primer arranque de cualquier BD anterior a
  // esta PR. Aquí SIEMPRE es seguro: en una BD nueva tag_id ya existe (schema.sql la creó) y esto
  // es un no-op; en una BD migrada corre justo después del ALTER de la entrada v4, de arriba.
  stmts.push({ sql: `CREATE INDEX IF NOT EXISTS tx_tag ON transactions (tag_id)`, bind: [] });
  stmts.push({
    sql: `INSERT INTO meta (key,value) VALUES ('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    bind: [SCHEMA_VERSION],
  });
  return stmts;
}
