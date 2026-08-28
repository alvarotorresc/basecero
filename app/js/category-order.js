/** Lógica pura de reordenar categorías (PR D, Task 4): SIN imports de db/repo — así los tests
 *  de node pueden importarlo directo, sin worker ni sqlite de por medio (mismo motivo que
 *  prevision.js). Vive en su propio módulo (y no en repo.js, que importa db.js → Worker, ni en
 *  category-colors.js, que es de estilo/color, no de orden) para que sea importable sin arrastrar
 *  nada más — repo.js la reexporta para que las pantallas tengan un único punto de import. */

/** Mueve el elemento en la posición `from` a la posición `to` dentro de `ids` (array de ids,
 *  YA restringido al grupo que se está reordenando: raíces del mismo flow, o hijas de la misma
 *  raíz — ver Task 7). Devuelve un array NUEVO (no muta `ids`). `from`/`to` fuera de rango
 *  quedan clampados a los límites válidos: `to` en concreto usa el límite del array YA SIN el
 *  elemento movido (`arr.length`, no `arr.length - 1`), para que "soltar al final" (el gesto de
 *  arrastre más común) también sea alcanzable — clampar a `length - 1` dejaría ese hueco
 *  inalcanzable, el elemento nunca llegaría a la última posición. */
export function computeReorder(ids, from, to) {
  const arr = [...ids];
  const clampedFrom = Math.max(0, Math.min(from, arr.length - 1));
  const [item] = arr.splice(clampedFrom, 1);
  const clampedTo = Math.max(0, Math.min(to, arr.length));
  arr.splice(clampedTo, 0, item);
  return arr;
}
