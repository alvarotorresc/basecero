import { pushBack, goBack } from "./back.js";

/** Modal de confirmación reutilizable: un `<dialog>` nativo abierto con `showModal()`, no un `<div>`
 *  con trampa de foco a mano. Trampa de foco, Escape y fondo inerte los da el navegador; con
 *  cualquier contenido, incluido lo que la PR de reskin le añada más adelante — una trampa de foco
 *  escrita a mano para dos botones se rompe en silencio en cuanto alguien añade un tercero.
 *
 *  Dos piezas, como el resto del proyecto: modalHtml() es pura (devuelve un string, como
 *  skeletonHtml) y createModal(doc, {pushBack, goBack}) es una fábrica con dependencias inyectadas
 *  —mismo patrón que createToaster(doc)— para poder probarla en Node con un document falso.
 *
 *  Cuelga de <body>, no de #screen: mismo motivo que toast.js — las pantallas se repintan enteras
 *  con innerHTML y se lo llevarían por delante. */

// & y < porque son los que pueden romper el HTML; > también, aunque no rompa nada al ir dentro de
// un atributo o texto: un nombre de comercio con "<b>" no debe verse como una etiqueta a medias.
const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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

export function createModal(doc, { pushBack, goBack }) {
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
      dlg.addEventListener("close", () => {     // ÚNICO embudo de salida
        current = null;
        dlg.remove();
        if (!byBack) goBack();                  // lo cerramos nosotros: falta deshacer la entrada
        if (confirmed) onConfirm?.();
        else opener?.focus?.();
      });

      doc.body.appendChild(dlg);                // showModal() sobre un nodo suelto: InvalidStateError
      dlg.showModal();
      pushBack(() => { byBack = true; dlg.close(); });
      dlg.querySelector("#modal-cancel").onclick = () => dlg.close();
      dlg.querySelector("#modal-confirm").onclick = () => { confirmed = true; dlg.close(); };
      dlg.querySelector("#modal-cancel").focus();
      return dlg;
    },
  };
}

const instance = typeof document !== "undefined" ? createModal(document, { pushBack, goBack }) : null;
export const showConfirm = (opts) => instance?.confirm(opts);
