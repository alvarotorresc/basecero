import { renderMovimientos } from "./screens/movimientos.js";
import { pushBack, goBack } from "./back.js";

/** Abre el detalle de un movimiento desde una pantalla que NO es Movimientos (Inicio y Semana).
 *  El detalle vive en movimientos.js y se reutiliza en modo «solo detalle»: ✕, Guardar y Borrar
 *  llaman todos a goBack(), que deshace la ÚNICA entrada que apunta esta función y devuelve a la
 *  pantalla de origen — no a la lista de Movimientos. Ver la spec §7. */
export function openTxDetail(container, txId, onBack) {
  pushBack(onBack);
  return renderMovimientos(container, { detailTxId: txId, onDetailClose: goBack });
}
