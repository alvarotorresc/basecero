/** Memoria de comercios (Registro v2 §5): elegir «Mercadona» rellena categoría, cuenta y reparto
 *  con lo de la última vez. Módulo PURO — sin DOM ni BD — que consume las filas de
 *  `repo.merchantHistory()` (sql.js#merchantHistory) y las pliega en un mapa. `registro.js` y
 *  `n26.js` son los consumidores.
 *
 *  AL VUELO, NO PERSISTIDA: no hay tabla `merchant_memory`. Una tabla nueva rompería el contrato
 *  xlsx para todas las hojas exportadas hasta hoy (§2 de la spec); además habría que mantenerla al
 *  día en addTransaction/updateTransaction/softDeleteTransaction/runImportPipeline/settleAllShared/
 *  replaceAll — seis puntos donde podría quedar mintiendo. Y no hace falta: es una BD personal, la
 *  consulta va acotada a MEMORY_WINDOW filas y el plegado en JS es de microsegundos. */

/** 500 movimientos con comercio son más de un año de uso diario; por debajo de eso, una compra de
 *  hace dos años no debería seguir dictando la categoría. Es una constante exportada para que, si
 *  algún día molesta, subirla sea una línea. */
export const MEMORY_WINDOW = 500;

/** trim → minúsculas → sin diacríticos → espacios colapsados, para que «Bar la plaza» y
 *  «BAR LA PLAZA  » casen como el mismo comercio. Es solo la CLAVE de casado: `display` (abajo)
 *  conserva la escritura original. */
export function normalizeMerchant(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");
}

/** Pliega filas YA ORDENADAS de más reciente a más antigua (repo.merchantHistory, ORDER BY date
 *  DESC, id DESC) en un mapa `comercio normalizado → entry`. Gana la PRIMERA aparición de cada
 *  comercio (= la última vez que se usó): es literalmente lo que promete la pista «recordado de la
 *  última vez». `count` cuenta TODAS las apariciones dentro de la ventana, para poder ordenar el
 *  autocompletado por uso y no solo por fecha. `display` es la escritura de la fila que ganó (la
 *  más reciente), no de una posterior.
 *
 *  Guard `__proto__`: mismo criterio que budgetMap (category-spend.js#budgetMap) — un comercio
 *  llamado literalmente «__proto__» dispararía el setter especial de Object.prototype al escribir
 *  en el mapa con `out[key] = …`. Se descarta la fila entera (no se cuenta ni como aparición): no
 *  hay ranura segura donde guardarla.
 *
 *  `out` nace con `Object.create(null)`, no `{}`: un comercio llamado «constructor» o «toString»
 *  no pisa esas claves, pero con `{}` seguirían siendo accesos válidos por herencia de
 *  Object.prototype — `mem["constructor"]` daría el constructor Function (siempre truthy) aunque
 *  jamás se hubiera guardado esa fila, y registro.js (`if (entry) …`) lo tomaría por una entrada de
 *  verdad. Sin prototipo, esas claves solo existen si de verdad se escribieron. */
export function merchantMemory(rows) {
  const out = Object.create(null);
  for (const r of rows ?? []) {
    const display = String(r.merchant ?? "").trim();
    if (!display) continue;
    const key = normalizeMerchant(display);
    if (key === "__proto__") continue;
    if (Object.hasOwn(out, key)) {
      out[key].count += 1;
      continue;
    }
    out[key] = {
      categoryId: r.category_id || "",
      accountId: r.account_id || "",
      isShared: !!r.is_shared,
      paidBy: r.paid_by || "me",
      sharePct: r.share_pct_override ?? null,
      lastUsedAt: r.date,
      count: 1,
      display,
    };
  }
  return out;
}

/** Qué campos rellena elegir `entry`, respetando lo que el usuario YA tocó a mano. `touched` es el
 *  Set de campos que el usuario cambió en esta sesión de formulario (`categoryId`, `accountId`,
 *  `isShared`, `paidBy`, `sharePct`): la memoria nunca pisa una decisión explícita. Devuelve un PARCHE nuevo, sin mutar
 *  `entry` ni el `touched` recibido — quien llama decide cómo aplicarlo (p.ej. `Object.assign`
 *  sobre `state`). Un campo ausente, vacío o `null` en `entry` no entra en el parche: no tiene
 *  sentido "recordar" un valor que nunca se guardó.
 *
 *  `validCategoryIds` (opcional): sql.js#merchantHistory lee expense+income+refund del mismo
 *  comercio, así que la categoría que ganó `merchantMemory()` puede pertenecer a un TIPO de
 *  movimiento distinto al que se está rellenando ahora (p.ej. un "Mercadona" usado una vez como
 *  ingreso). Sin filtrar, ese `categoryId` pasaría la validación de Registro (que solo mira
 *  truthiness) y se guardaría un id que no aparece marcado en la rejilla del tipo actual ni cuenta
 *  para los límites de su raíz real. Cuando se pasa la lista de ids válidos del tipo en curso
 *  (`categoriesFor().map(c => c.id)` en registro.js), `categoryId` se descarta del parche si no
 *  está en ella; el resto de campos (cuenta, compartido, reparto) es agnóstico al tipo y no se
 *  filtra. registro.js (único llamador de `memoryPatch`) SIEMPRE pasa esta lista — el mismo
 *  problema en n26.js se resuelve aparte, con el mismo criterio, en `categoryForImportedRow`
 *  (n26.js), que no pasa por esta función. El argumento solo se omite en los tests unitarios de
 *  abajo, para poder probar el resto del parche sin montar una lista de categorías. */
export function memoryPatch(entry, touched, validCategoryIds) {
  const patch = {};
  if (!entry) return patch;
  for (const field of ["categoryId", "accountId", "isShared", "paidBy", "sharePct"]) {
    if (touched?.has(field)) continue;
    const value = entry[field];
    if (value === undefined || value === null || value === "") continue;
    if (field === "categoryId" && validCategoryIds && !validCategoryIds.includes(value)) continue;
    patch[field] = value;
  }
  return patch;
}
