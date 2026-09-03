/** Toast de confirmación: un único nodo fijo sobre la tabbar que aparece 3 s y se va.
 *
 *  Para qué: varios guardados de la app escriben en la base y vuelven a pintar la misma pantalla,
 *  así que desde fuera no se distinguen de no haber hecho nada. Esto es el acuse de recibo.
 *
 *  UN SOLO nodo, creado la primera vez y reutilizado siempre (dos toasts a la vez se taparían), y
 *  colgado de <body>, no del contenedor de la pantalla: las pantallas se repintan enteras con
 *  innerHTML y se lo llevarían por delante.
 *
 *  createToaster(doc) recibe el document como parámetro —mismo patrón que createBackStack(win) en
 *  back.js— para poder probar la lógica en Node con un document falso. Abajo queda la instancia
 *  real y showToast(), que es lo que importan las pantallas. */

const HIDE_MS = 3000;

export function createToaster(doc) {
  let node = null;
  let timer = null;
  return {
    show(text) {
      if (!node) {
        node = doc.createElement("div");
        node.id = "toast";
        // role=status + aria-live=polite: se anuncia sin interrumpir y sin robar el foco.
        node.setAttribute("role", "status");
        node.setAttribute("aria-live", "polite");
        doc.body.appendChild(node);
      }
      node.textContent = text;
      node.classList.add("is-visible");
      // Reiniciar la cuenta atrás en cada show: si no, el timer del toast anterior escondería
      // este a mitad de camino.
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        node.classList.remove("is-visible");
        timer = null;
      }, HIDE_MS);
      return node;
    },
  };
}

// En Node (tests) no hay document: el módulo se puede importar igual, solo que showToast no hace
// nada — mismo criterio que la instancia global de back.js.
const instance = typeof document !== "undefined" ? createToaster(document) : null;
export const showToast = (text) => { instance?.show(text); };
