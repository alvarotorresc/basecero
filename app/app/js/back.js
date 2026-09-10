import { createScrollTop } from "./viewport.js";

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
  // Cambiar de pantalla devuelve la vista al principio: esta pila ES el router de la app (ver la
  // cabecera), así que el reset vive aquí y no repartido por las 15 llamadas a push().
  const scrollTop = createScrollTop(win);
  // Recarga (o restauración de la pestaña) con subpantallas abiertas: el historial CONSERVA sus
  // entradas ({bc:1}, {bc:2}…) pero esta pila nace vacía, así que los primeros toques de «atrás»
  // caían en el guard del popstate y no hacían NADA — había que tocar atrás tantas veces como
  // profundidad hubiera para que la app reaccionara. Se lee la profundidad ANTES de pisar el state
  // y se rebobina el historial hasta la entrada base de la app.
  // Guard: entero > 0 y estrictamente menor que history.length — con bc >= length el salto se
  // saldría de la app (páginas anteriores de la sesión). Un `win` de test sin `history.length`
  // hace que la comparación sea false y no se rebobine: los tests que ejercen esto TIENEN que dar
  // un length, y hay uno que fija justo ese límite.
  const restored = win.history.state?.bc;
  win.history.replaceState({ bc: 0 }, "");
  win.addEventListener("popstate", (e) => {
    const target = typeof e.state?.bc === "number" ? e.state.bc : 0;
    // entrada ajena o corrupta (recarga, o un {bc} negativo/NaN): nada que deshacer.
    if (!Number.isInteger(target) || target < 0 || target >= stack.length) return;
    const dropped = stack.splice(target);
    // dropped[0] (la más baja descartada) es quien pinta la pantalla que queda debajo — es SU
    // scroll el que importa, no el de las entradas por encima que también se descartan (p. ej. el
    // modal de confirmación, que no es un cambio de pantalla). No lo simplifiques a un flag global:
    // el scroll no es una propiedad de la pila entera, es de la entrada que va a pintar.
    // `!== false` a propósito: las entradas de resetTo() no llevan `scroll` (undefined) y también
    // deben resetear, como cualquier cambio de pantalla.
    if (dropped[0].scroll !== false) scrollTop();  // antes del callback: lo que pinte ya se ve arriba
    dropped[0].onBack();
  });
  // Después de registrar el listener: el popstate que provoque este salto tiene que encontrarlo
  // puesto (la pila ya está vacía, así que será inocuo, pero el guard debe correr).
  if (Number.isInteger(restored) && restored > 0 && restored < win.history.length) win.history.go(-restored);
  return {
    /** Abre una subpantalla: apunta su callback de vuelta y una entrada de historial.
     *  pushState va ANTES del stack.push: si el navegador lo rechaza (p. ej. límite de
     *  Safari), la pila no debe registrar una entrada que el historial nunca tuvo.
     *  { scroll: false } es para quien empuja una entrada que NO es un cambio de pantalla (el
     *  modal de confirmación, ver modal.js): abrir o cerrar el modal no debe mover la pantalla de
     *  detrás. Por defecto true: las 15 pantallas que llaman a pushBack() siguen reseteando. */
    push(onBack, { scroll = true } = {}) {
      win.history.pushState({ bc: stack.length + 1 }, "");
      stack.push({ onBack, scroll });
      if (scroll) scrollTop();
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
    /** Deja la pila con EXACTAMENTE una entrada, cuyo callback de vuelta es `onBack`: es lo que
     *  hace falta al entrar en una pestaña principal que no es Inicio (Movimientos, Patrimonio,
     *  Ajustes) — desde ellas, «atrás» vuelve a Inicio en vez de cerrar la app.
     *
     *  Como mucho UNA operación de historial, nunca dos. La versión obvia (clear() y luego push())
     *  no vale: clear() hace history.go(-n), que el navegador ENCOLA, y un pushState síncrono
     *  detrás se aplica ANTES del salto, dejando una entrada de más. Aquí, si ya hay entradas, la
     *  de abajo se REUTILIZA (existe en el historial con su {bc:1}) cambiándole el callback, y
     *  solo se descartan las de encima. */
    resetTo(onBack) {
      const n = stack.length;
      if (n === 0) {
        win.history.pushState({ bc: 1 }, "");
        stack.push({ onBack });
        return;
      }
      stack.length = 1;
      stack[0].onBack = onBack;
      if (n > 1) win.history.go(-(n - 1));
    },
    /** Profundidad de la pila — solo para tests. */
    depth: () => stack.length,
  };
}

const instance = typeof window !== "undefined" ? createBackStack(window) : null;
export const pushBack = (onBack, opts) => instance.push(onBack, opts);
export const goBack = () => instance.back();
export const clearBack = () => instance.clear();
export const resetBack = (onBack) => instance.resetTo(onBack);
