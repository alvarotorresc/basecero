/** Gesto «atrás» del sistema ⇄ subpantallas. La app no tiene rutas: cada subpantalla que se abre
 *  apunta UNA entrada de historial con su callback de vuelta. El popstate (gesto del móvil, botón
 *  atrás del navegador) o goBack() (botón ✕/atrás de la propia pantalla) deshacen la última —
 *  así gesto y botón hacen exactamente lo mismo. Sin esto, en la PWA instalada (standalone) el
 *  gesto cerraba la app porque no había nada que deshacer.
 *  El state de cada entrada guarda su profundidad ({bc: n}) para que un salto de varias entradas
 *  (history.go(-n), o el usuario manteniendo «atrás») deje la pila coherente: se descartan todas
 *  las entradas por encima del destino y solo se ejecuta el callback de la MÁS BAJA descartada,
 *  que es la que pinta la pantalla que quedaba debajo. */
export function createBackStack(win) {
  const stack = [];
  win.history.replaceState({ bc: 0 }, "");
  win.addEventListener("popstate", (e) => {
    const target = typeof e.state?.bc === "number" ? e.state.bc : 0;
    if (target >= stack.length) return; // entrada ajena (p. ej. tras recargar): nada que deshacer
    const dropped = stack.splice(target);
    dropped[0].onBack();
  });
  return {
    /** Abre una subpantalla: apunta su callback de vuelta y una entrada de historial. */
    push(onBack) {
      stack.push({ onBack });
      win.history.pushState({ bc: stack.length }, "");
    },
    /** Cierra la subpantalla superior por el historial (no-op sin subpantallas abiertas). */
    back() {
      if (stack.length > 0) win.history.back();
    },
    /** Descarta todas las subpantallas abiertas sin ejecutar callbacks (cambio de pestaña). */
    clear() {
      const n = stack.length;
      if (n === 0) return;
      stack.length = 0;
      win.history.go(-n);
    },
    depth: () => stack.length,
  };
}

const global = typeof window !== "undefined" ? createBackStack(window) : null;
export const pushBack = (onBack) => global.push(onBack);
export const goBack = () => global.back();
export const clearBack = () => global.clear();
