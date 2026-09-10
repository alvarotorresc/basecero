import { pushBack, goBack } from "./back.js";
import { escHtml } from "./esc.js";

/** Modal de confirmación reutilizable: un `<dialog>` nativo abierto con `showModal()`, no un `<div>`
 *  con trampa de foco a mano. Trampa de foco, Escape y fondo inerte los da el navegador; con
 *  cualquier contenido, incluido lo que la PR de reskin le añada más adelante — una trampa de foco
 *  escrita a mano para dos botones se rompe en silencio en cuanto alguien añade un tercero.
 *
 *  Dos piezas, como el resto del proyecto: modalHtml() es pura (devuelve un string, como
 *  skeletonHtml) y createModal(doc, {pushBack, goBack, win}) es una fábrica con dependencias
 *  inyectadas —mismo patrón que createToaster(doc)— para poder probarla en Node con un document
 *  (y una ventana) falsos.
 *
 *  Cuelga de <body>, no de #screen: mismo motivo que toast.js — las pantallas se repintan enteras
 *  con innerHTML y se lo llevarían por delante. */

/** Interior del <dialog>. Cancelar va PRIMERO en el DOM: primero en la tabulación, primero en la
 *  lectura y es quien recibe el foco inicial — la salida segura por defecto. */
export function modalHtml({ title, message, cancelText, confirmText }) {
  return `<h2 id="modal-title" class="modal-title">${escHtml(title)}</h2>
    ${message ? `<p id="modal-text" class="modal-text">${escHtml(message)}</p>` : ""}
    <div class="modal-actions">
      <button type="button" class="btn-secondary" id="modal-cancel">${escHtml(cancelText)}</button>
      <button type="button" class="modal-danger" id="modal-confirm">${escHtml(confirmText)}</button>
    </div>`;
}

export function createModal(doc, { pushBack, goBack, win }) {
  let current = null;
  return {
    confirm({ title, message, cancelText, confirmText, onConfirm }) {
      if (current) return null;                 // un solo modal a la vez
      const opener = doc.activeElement;
      const dlg = doc.createElement("dialog");
      current = dlg;
      dlg.className = "modal";
      dlg.setAttribute("role", "dialog");
      dlg.setAttribute("aria-modal", "true");
      dlg.setAttribute("aria-labelledby", "modal-title");
      if (message) dlg.setAttribute("aria-describedby", "modal-text");
      dlg.innerHTML = modalHtml({ title, message, cancelText, confirmText });

      let confirmed = false;
      let byBack = false;
      let pushed = false;
      // Salto de varias entradas de golpe (history.go(-n), o "atrás" del sistema mantenido): el
      // popstate de back.js solo ejecuta el callback de la entrada MÁS BAJA descartada (back.js:
      // dropped[0]). Si la del modal se descarta sin ser esa, el pushBack de más abajo nunca corre:
      // el <dialog> se quedaría abierto en el top layer —con todo lo demás inerte— y `current`
      // señalando a un modal muerto, así que showConfirm() no volvería a abrir nada nunca más.
      // Red de seguridad: cualquier popstate mientras el diálogo siga abierto lo cierra, lo haya
      // ejecutado o no el callback de pushBack de arriba.
      const onPopstate = () => {
        if (dlg.open) { byBack = true; dlg.close(); }
      };
      win.addEventListener("popstate", onPopstate);

      dlg.addEventListener("close", () => {     // ÚNICO embudo de salida
        win.removeEventListener("popstate", onPopstate);
        current = null;
        dlg.remove();
        // Si pushBack nunca llegó a apuntar una entrada (la lanzó, p. ej. el límite de Safari), no
        // hay nada que goBack() deba deshacer — llamarlo consumiría una entrada de la PANTALLA de
        // detrás en su lugar.
        if (!byBack && pushed) goBack();
        if (confirmed) onConfirm?.();
        else opener?.focus?.();
      });

      doc.body.appendChild(dlg);                // showModal() sobre un nodo suelto: InvalidStateError
      dlg.showModal();
      // {scroll:false}: abrir/cerrar el modal apunta una entrada de historial pero no es un cambio
      // de pantalla — la pantalla de detrás debe quedarse donde estaba (back.js: push/popstate).
      // {chrome:false}: por el mismo motivo, tampoco es un cambio de subpantalla — abrir o cerrar
      // el modal no debe encender ni apagar `body.subscreen` (tab bar/FAB y el padding de
      // `main#screen`), que se quede como estuviera la pantalla de detrás (back.js: syncChrome).
      // showModal() va ANTES que esto: si pushBack lanza, el diálogo ya está abierto y Cancelar
      // debe poder cerrarlo igual (arriba, con pushed=false, sin tocar goBack()).
      try { pushBack(() => { byBack = true; dlg.close(); }, { scroll: false, chrome: false }); pushed = true; } catch {}
      dlg.querySelector("#modal-cancel").onclick = () => dlg.close();
      dlg.querySelector("#modal-confirm").onclick = () => { confirmed = true; dlg.close(); };
      dlg.querySelector("#modal-cancel").focus();
      return dlg;
    },
  };
}

const instance = typeof document !== "undefined" ? createModal(document, { pushBack, goBack, win: window }) : null;
export const showConfirm = (opts) => instance?.confirm(opts);
