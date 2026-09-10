/** Dos gestos del chrome que no pertenecen a ninguna pantalla: devolver la vista al principio en
 *  cada cambio de pantalla y dar el foco a un input recién pintado.
 *
 *  createScrollTop(win) recibe la ventana como parámetro —mismo patrón que createBackStack(win) en
 *  back.js y createToaster(doc) en toast.js— para poder probarlo en Node con una ventana falsa.
 *
 *  Por qué scrollTo(0,0) Y #screen.scrollTop: hoy el scroller REAL es el documento. `main#screen`
 *  declara `overflow-y:auto` (app.css:16-22) pero su altura es `auto`, así que la caja crece con el
 *  contenido y su overflow nunca llega a activarse: `screen.scrollTop` vale siempre 0 y ponerlo a 0
 *  no hace nada. Si el reskin le da altura fija y lo convierte en el scroller de verdad, la segunda
 *  línea ya lo cubre. Las dos son baratas y ninguna estorba a la otra.
 *  Los `?.` no son adorno: el `win` falso con el que se prueba back.js no tiene ni scrollTo ni
 *  document, y el módulo tiene que seguir siendo importable en Node. */
export function createScrollTop(win) {
  return () => {
    win.scrollTo?.(0, 0);
    const el = win.document?.getElementById?.("screen");
    if (el) el.scrollTop = 0;
  };
}

/** Foco en un input recién pintado; devuelve si llegó a enfocar algo (quien llama puede pasarle un
 *  querySelector que no encontró nada, p. ej. una pantalla en estado de error).
 *
 *  preventScroll: sin él el navegador desplaza por su cuenta hasta el elemento enfocado y pelearía
 *  con el createScrollTop de arriba.
 *
 *  Cursor al final en vez de al principio: cuando el importe viene prerrellenado (una recurrente
 *  pendiente desde Inicio, inicio.js:562-566), teclear debe continuar el número, no partirlo.
 *  setSelectionRange solo es legal en text/search/tel/url/password — #reg-raw es type="text"
 *  (registro.js:243); en un type="number" LANZA, de ahí el ?. */
export function focusInput(el) {
  if (!el || typeof el.focus !== "function") return false;
  el.focus({ preventScroll: true });
  const n = String(el.value ?? "").length;
  el.setSelectionRange?.(n, n);
  return true;
}

// En Node no hay window: el módulo se importa igual y esto no hace nada — mismo criterio que la
// instancia global de back.js (back.js:77) y de toast.js (toast.js:45).
export const scrollScreenTop = typeof window !== "undefined" ? createScrollTop(window) : () => {};
