import { renderMovimientoDetalle } from "./screens/movimiento-detalle.js";
import { pushBack, goBack } from "./back.js";
import { showToast } from "./toast.js";
import { t } from "./i18n/index.js";
import { userMessage } from "./errors.js";

// Guardia de módulo contra el doble toque (revisión de código): sin esto, tocar una fila dos veces
// antes de que responda el primer renderMovimientoDetalle() apila dos entradas de "volver" para el mismo
// movimiento — la primera en cerrarse deja la segunda huérfana. Sin test posible en Node: este
// módulo importa screens/movimiento-detalle.js, que a su vez importa repo.js (Worker/sqlite), fuera del
// alcance de `node --test`.
let opening = false;

/** Abre el detalle de un movimiento desde una pantalla que NO es Movimientos (Inicio y Semana).
 *  El detalle vive en screens/movimiento-detalle.js: «Atrás», Guardar y Borrar llaman todos a
 *  goBack(), que deshace la ÚNICA entrada que apunta esta función y devuelve a la pantalla de
 *  origen — no a la lista de Movimientos. Ver la spec §7. Si falla la carga se avisa con un toast
 *  y se vuelve; si el movimiento ya no existe (borrado en otra pestaña), se vuelve sin más. */
export async function openTxDetail(container, txId, onBack) {
  if (opening) return;
  opening = true;
  let dispose = null;
  // La salida revoca la URL de la foto del ticket (dispose) antes de repintar el origen.
  pushBack(() => { dispose?.(); onBack(); });
  try {
    dispose = await renderMovimientoDetalle(container, txId);
    if (!dispose) goBack();
  } catch (e) {
    showToast(t("movimientos.error.openDetail", { error: userMessage(e) }));
    goBack();
  } finally {
    opening = false;
  }
}
