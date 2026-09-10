/** Decisiones de densidad de la pantalla Registro (SISTEMA.md §4, spec §4.2): qué se ve con el
 *  ajuste «Registro rápido» puesto y qué no. Módulo PURO — sin DOM ni BD, sin importar i18n — para
 *  que `node --test` lo ejerza de verdad sin Worker (mismo patrón que share-pct.js,
 *  movimientos-filter.js, category-spend.js). `registro.js` es el único consumidor. */

/** ¿Está activo el modo rápido? DEFAULT: SÍ. Ausente, vacío o cualquier cosa que no sea "0" ⇒
 *  activado. No es paranoia: repo.replaceAllStmts FUSIONA meta al importar (repo.js:987-998), así
 *  que importar una hoja exportada antes de que esta clave existiera deja la clave sin tocar… pero
 *  una BD restaurada desde cero sobre una hoja vieja arranca sin ella hasta el siguiente boot. */
export const quickRegisterEnabled = (raw) => String(raw ?? "") !== "0";

/** ¿Se pinta el bloque de "todo lo demás" (cuenta, fecha, comercio, nota, compartido, foto)?
 *  En modo completo, SIEMPRE. En modo rápido, solo si el usuario ha tocado «Más».
 *  `tipo` manda por encima de las dos cosas: transferencia y ajuste NO tienen modo rápido — sin
 *  las dos cuentas o sin el signo el formulario no se puede ni validar; devolución tampoco — el
 *  selector de enlace (registro.js#renderRefundPicker) vive en este mismo bloque plegable y sin
 *  él no hay forma de decir a qué gasto corresponde la devolución. */
export function detailsOpen({ quick, expanded, tipo }) {
  if (tipo === "transfer" || tipo === "adjustment" || tipo === "refund") return true;
  return !quick || !!expanded;
}

/** Resumen de una línea que sustituye al bloque plegado (Registro.dc.html: «Cuenta corriente» ·
 *  «hoy» · «sin nota ni foto»). Devuelve un ARRAY de trozos, no un string con separadores:
 *  SISTEMA.md §1 prohíbe el punto medio como separador; la vista los pinta con `gap`.
 *
 *  `tr` (la función de traducción) llega por parámetro: el módulo no importa i18n, así se testea
 *  sin diccionario (mismo criterio que category-spend.js).
 *
 *  Nota/foto comparten UNA sola pista, no dos: el diccionario (§10 de la spec) solo define
 *  `summaryPhoto` («con foto») y `summaryNoNote` («sin nota ni foto») — no hay una tercera para
 *  «con nota, sin foto». Con foto, gana «con foto» (es la señal más fuerte: en Parte A siempre
 *  false, la foto es de la PR B); sin foto pero con nota, no se añade nada — el hueco vacío es la
 *  forma de decir «hay algo aquí» sin inventar una clave nueva; sin nota ni foto, se dice
 *  explícitamente.
 *
 *  `tagName` (Etiquetas de proyecto, N11, Task 13): el nombre de la etiqueta puesta, justo
 *  después de la fecha — misma cercanía que en el bloque desplegado, donde el chip «Etiqueta»
 *  vive a la derecha del campo de fecha (RegistroCompleto.dc.html:132-136). Ausente o vacía, sin
 *  trozo nuevo: ya es opcional en el bloque desplegado, y el resumen plegado no debe insinuar que
 *  falta algo que nunca se pidió. */
export function foldedSummaryParts({ accountName, dateLabel, hasNote, hasPhoto, sharedLabel, tagName }, tr) {
  const parts = [];
  if (accountName) parts.push(accountName);
  if (dateLabel) parts.push(dateLabel);
  if (tagName) parts.push(tagName);
  if (hasPhoto) parts.push(tr("registro.more.summaryPhoto"));
  else if (!hasNote) parts.push(tr("registro.more.summaryNoNote"));
  if (sharedLabel) parts.push(sharedLabel);
  return parts;
}

/** Cuántas categorías se enseñan sin desplegar y cuántas quedan detrás de «Ver las N categorías».
 *  La seleccionada SIEMPRE entra, aunque esté fuera de las `limit` primeras: una pantalla que
 *  esconde justo lo que acabas de elegir es un error, no una densidad. */
export function visibleCategories(cats, selectedId, limit) {
  if (cats.length <= limit) return { shown: cats, hidden: 0 };
  const head = cats.slice(0, limit);
  if (selectedId && !head.some((c) => c.id === selectedId)) {
    const sel = cats.find((c) => c.id === selectedId);
    if (sel) head[limit - 1] = sel;
  }
  return { shown: head, hidden: cats.length - head.length };
}
