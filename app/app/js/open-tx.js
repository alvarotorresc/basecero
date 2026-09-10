import { renderMovimientos } from "./screens/movimientos.js";
import { pushBack, goBack } from "./back.js";

// Guardia de módulo contra el doble toque (revisión de código): sin esto, tocar una fila dos veces
// antes de que responda el primer renderMovimientos() apila dos entradas de "volver" para el mismo
// movimiento — la primera en cerrarse deja la segunda huérfana. Sin test posible en Node: este
// módulo importa screens/movimientos.js, que a su vez importa repo.js (Worker/sqlite), fuera del
// alcance de `node --test`.
let opening = false;

/** Abre el detalle de un movimiento desde una pantalla que NO es Movimientos (Inicio y Semana).
 *  El detalle vive en movimientos.js y se reutiliza en modo «solo detalle»: ✕, Guardar y Borrar
 *  llaman todos a goBack(), que deshace la ÚNICA entrada que apunta esta función y devuelve a la
 *  pantalla de origen — no a la lista de Movimientos. Ver la spec §7. */
export async function openTxDetail(container, txId, onBack) {
  if (opening) return;
  opening = true;
  pushBack(onBack);
  try {
    return await renderMovimientos(container, { detailTxId: txId, onDetailClose: goBack });
  } finally {
    opening = false;
  }
}
