/** Aritmética de «gasto vs. límite» por categoría: helpers PUROS (sin DOM ni BD) que comparten la
 *  pantalla «Gasto por categoría» y la tarjeta de Inicio. Vivían dentro de la antigua pantalla
 *  Presupuesto; al salir de una pantalla se pueden testear en Node sin Worker. */

/** Estado de una categoría (o del total) frente a su límite. Umbrales: ok < 85 %,
 *  warn >= 85 % (incluye el 100 % justo), over > 100 %. Sin límite (0/null/undefined) -> null:
 *  quien llama decide qué hacer (p.ej. tratarla como "sin límite este periodo"). pct SIN capar
 *  (para el número grande); quien pinta la barra la capa a 0..100 al renderizar. */
export function budgetStatus(spent, limit) {
  if (!limit) return null;
  const pct = (spent / limit) * 100;
  const level = pct > 100 ? "over" : pct >= 85 ? "warn" : "ok";
  return { pct, level };
}

/** El mismo porcentaje, ya redondeado a entero, para los textos. 0 si no hay límite (nunca
 *  NaN/Infinity). SIN capar, igual que budgetStatus. */
export function pctOf(spent, limit) {
  if (!limit) return 0;
  return Math.round((spent / limit) * 100);
}

/** Ancho (0..100) de la barra de una categoría SIN límite: su gasto en proporción al de la raíz
 *  que más gastó, para que la lista se lea como una comparativa. Acotado por los dos lados: una
 *  raíz con más devoluciones que gasto da spent negativo, y `width:-12%` es CSS inválido (el
 *  navegador descarta la declaración y el relleno se pinta entero). */
export function relativeWidth(spent, maxSpent) {
  if (!(maxSpent > 0)) return 0;
  return Math.min(100, Math.max(0, (spent / maxSpent) * 100));
}

/** Totales de la tarjeta héroe: gastado, límite y cuántas categorías, contando SOLO las raíces con
 *  límite > 0. `> 0` y no `!= null` a propósito: una fila a 0 (solo alcanzable importando una hoja
 *  a mano) es "sin límite" para budgetStatus, así que tampoco puede sumar aquí. */
export function limitTotals(rows, budgetByCategory) {
  let spent = 0;
  let limit = 0;
  let count = 0;
  for (const r of rows) {
    const l = budgetByCategory[r.root_id] ?? 0;
    if (l > 0) {
      spent += r.spent_cents;
      limit += l;
      count += 1;
    }
  }
  return { spent, limit, count };
}

/** Orden de la lista «Por categoría»: lo más gastado arriba; a igual gasto (típicamente varias a
 *  cero) primero las que tienen límite, porque son las que el usuario vigila; y a igualdad de
 *  ambas cosas, alfabético. Devuelve un array NUEVO: el llamante conserva el orden del SQL. */
export function sortRootRows(rows, budgetByCategory) {
  const hasLimit = (r) => ((budgetByCategory[r.root_id] ?? 0) > 0 ? 1 : 0);
  return [...rows].sort((a, b) =>
    b.spent_cents - a.spent_cents
    || hasLimit(b) - hasLimit(a)
    || String(a.name).localeCompare(String(b.name)));
}

/** Mapa categoría → límite en céntimos a partir de las filas de SQL.budgetsOfPeriod. Gana la PRIMERA
 *  fila de cada categoría: la consulta ya llega ordenada por updated_at DESC, id DESC, así que la
 *  primera es la más reciente — el mismo límite que budgetOfCategory carga al editarlo.
 *  Object.fromEntries NO vale aquí: se queda con la ÚLTIMA, justo la contraria. Las filas duplicadas
 *  solo llegan de una hoja xlsx editada a mano (la app nunca crea dos vivas por categoría), pero sin
 *  un criterio único la pantalla enseñaría un límite y el editor otro. */
export function budgetMap(rows) {
  const out = {};
  for (const b of rows) {
    // Mismo guard que sanitizeLoanMap (account-defaults.js): out[k]= con k="__proto__" dispara el
    // setter especial de Object.prototype. Object.hasOwn y no `in`: `in` da true para toString,
    // constructor y demás heredadas, y descartaría en silencio una categoría llamada así.
    if (b.category_id === "__proto__") continue;
    if (!Object.hasOwn(out, b.category_id)) out[b.category_id] = b.amount_cents;
  }
  return out;
}

/** Prefill de los límites de «Periodo nuevo» en modo 'next': mapa rootId → importe en EUROS como
 *  string, listo para el atributo `value` de un <input type="number" step="0.01">.
 *
 *  - Solo raíces que la pantalla PINTA (las de `rootRows`, que vienen de spentByRootCategory y ya
 *    dejan fuera archivadas y borradas): heredar el límite de una categoría que no sale en la
 *    lista lo sumaría al «Presupuestado» del pie sin ninguna fila donde verlo, editarlo o quitarlo.
 *  - Solo importes > 0: una fila a 0 (o negativa), solo alcanzable importando una hoja a mano, ya
 *    es «sin límite» para budgetStatus — heredarla como «0» sería heredar un límite imposible.
 *  - Duplicados: el criterio de budgetMap (gana la primera fila, que la consulta entrega por
 *    updated_at DESC), el mismo que usa el resto de la app.
 *  - String(cents / 100): euros exactos, con céntimos si los tiene (12345 → "123.45", 90000 →
 *    "900"). Punto decimal a propósito: es lo único que admite el value de un input numérico, y
 *    tanto Number() como eurToCents lo leen igual. */
export function inheritedBudgetsRaw(budgetRows, rootRows) {
  const byCategory = budgetMap(budgetRows ?? []);
  const out = {};
  for (const r of rootRows ?? []) {
    const cents = byCategory[r.root_id] ?? 0;
    if (cents > 0) out[r.root_id] = String(cents / 100);
  }
  return out;
}

/** Comparativa de gasto por raíz entre este periodo y el anterior (N3). PURA.
 *  Una fila por cada raíz del periodo ACTUAL, en el mismo orden en que llegan (el de
 *  SQL.spentByRootCategory); quien pinta reordena con sortRootRows si quiere.
 *  Extraída de informe-logic.js (Task 6, etiquetas-design §7.1 y §8.4 de informe-design): esta
 *  función es la extracción de lo que ya vivía dentro de buildReport, no una regla nueva —
 *    prevCents  = gasto de esa raíz el periodo anterior, 0 si la raíz no estaba
 *    deltaCents = spent - prev
 *    deltaPct   = prev > 0 ? ((spent - prev) / prev) * 100 : null   <- NUNCA se divide por cero
 *    direction  = "flat" si deltaCents === 0
 *                 "new"  si prev <= 0 (no había con qué comparar)
 *                 "up"   si se gastó más   -> se pinta en --danger
 *                 "down" si se gastó menos -> se pinta en --pos   (gastar menos es bueno, SISTEMA §4.19)
 *  Con prevRows vacío (no hay periodo anterior) todas salen "new" con deltaPct null, y la pantalla
 *  omite la comparativa entera. */
export function compareRoots(currentRows, prevRows) {
  const hasPrev = (prevRows ?? []).length > 0;
  const prevByRoot = Object.fromEntries((prevRows ?? []).map((r) => [r.root_id, r.spent_cents]));
  return (currentRows ?? []).map((r) => {
    let prevCents = null, deltaCents = null, deltaPct = null, direction = "new";
    if (hasPrev) {
      prevCents = prevByRoot[r.root_id] ?? 0;
      deltaCents = r.spent_cents - prevCents;
      if (prevCents > 0) {
        deltaPct = ((r.spent_cents - prevCents) / prevCents) * 100;
        direction = deltaCents === 0 ? "flat" : deltaCents > 0 ? "up" : "down";
      } else {
        // sin gasto previo: "new" si ahora sí se gastó algo, "flat" si sigue sin haber nada — en
        // ninguno de los dos casos hay un porcentaje que calcular sin dividir por cero.
        direction = r.spent_cents > 0 ? "new" : "flat";
      }
    }
    return { rootId: r.root_id, prevCents, deltaCents, deltaPct, direction };
  });
}

/** Mapa rootId → [céntimos por periodo, del MÁS ANTIGUO al MÁS RECIENTE], para la mini tendencia
 *  de tres periodos (SISTEMA §4.19). `history`: [{ period, rows }, …], del más antiguo al más
 *  reciente — mismo orden que espera repo.rootSpendHistory.
 *  Las raíces son las del ÚLTIMO elemento (el periodo actual): una raíz que ya no aparece no se
 *  pinta. Donde una raíz no está en un periodo se rellena 0, no un hueco: una categoría creada
 *  este mes NO gastó nada en julio, y eso es un cero, no un dato que falte.
 *  Guard `__proto__`, mismo motivo que budgetMap (arriba). */
export function spentSeriesByRoot(history) {
  const h = history ?? [];
  if (h.length === 0) return {};
  const lastRows = h[h.length - 1].rows ?? [];
  const out = {};
  for (const r of lastRows) {
    if (r.root_id === "__proto__") continue;
    out[r.root_id] = h.map((p) => (p.rows ?? []).find((x) => x.root_id === r.root_id)?.spent_cents ?? 0);
  }
  return out;
}
