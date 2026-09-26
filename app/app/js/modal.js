import { pushBack, goBack } from "./back.js";
import { escHtml } from "./esc.js";
import { buttonHtml } from "./ui.js";

/** Aviso de confirmación (DESIGN.md §9 «Aviso de confirmación», B-Borrar): un `<dialog>` nativo
 *  abierto con `showModal()`, no un `<div>` con trampa de foco a mano. Trampa de foco, Escape y
 *  fondo inerte los da el navegador; una trampa de foco escrita a mano para dos botones se rompe
 *  en silencio en cuanto alguien añade un tercero.
 *
 *  Dos piezas, como el resto del proyecto: modalHtml() es pura (devuelve un string, como
 *  skeletonHtml) y createModal(doc, {pushBack, goBack, win}) es una fábrica con dependencias
 *  inyectadas —mismo patrón que createToaster(doc)— para poder probarla en Node con un document
 *  (y una ventana) falsos.
 *
 *  Cuelga de <body>, no de #screen: mismo motivo que toast.js — las pantallas se repintan enteras
 *  con innerHTML y se lo llevarían por delante. */

// DESIGN.md §10 «Hoja y aviso»: sale en 180ms ease-in. El cierre REAL (dlg.close(), que dispara el
// único embudo de salida más abajo) espera a que termine la animación de salida de .is-leaving
// (components.css) para que se vea siempre, sea cual sea la puerta de salida (botón, Escape,
// clic en el velo o el atrás del sistema).
const EXIT_MS = 180;

/** Interior del <dialog>, envuelto en .modal-content: el <dialog> se queda con padding:0 (para que
 *  un clic en el velo, fuera de esa caja, llegue con target=dlg — createModal#onClickBackdrop) y
 *  el relleno real (24 16 16) vive en el envoltorio. Cancelar va PRIMERO en el DOM: primero en la
 *  tabulación, primero en la lectura y es quien recibe el foco inicial — la salida segura por
 *  defecto. `preview` es HTML de confianza que trae YA escapado quien llama (la vista previa de la
 *  fila, DESIGN.md §9): se inserta tal cual, como el `html` de otros helpers del proyecto que
 *  documentan lo mismo. `destructive` (por defecto true, D-1/C5): la confirmación es la ÚNICA
 *  excepción a «rojo solo en cifras» — relleno --neg, texto --on-neg (.btn-danger-confirm). Las
 *  pantallas sin migrar que llaman a showConfirm() con su forma antigua siguen recibiendo ese rojo
 *  relleno por defecto, sin tocarlas. */
export function modalHtml({ title, message, cancelText, confirmText, preview = "", destructive = true }) {
  return `<div class="modal-content">
    <h2 id="modal-title" class="modal-title">${escHtml(title)}</h2>
    ${preview ? `<div class="modal-preview">${preview}</div>` : ""}
    ${message ? `<p id="modal-text" class="modal-text">${escHtml(message)}</p>` : ""}
    <div class="modal-actions">
      ${buttonHtml({ kind: "secondary", id: "modal-cancel", label: cancelText })}
      ${buttonHtml({ kind: destructive ? "danger-confirm" : "secondary", id: "modal-confirm", label: confirmText })}
    </div>
  </div>`;
}

export function createModal(doc, { pushBack, goBack, win, wait = (ms, fn) => setTimeout(fn, ms) }) {
  let current = null;
  return {
    confirm({ title, message, cancelText, confirmText, preview, destructive, onConfirm }) {
      if (current) return null;                 // un solo aviso a la vez
      const opener = doc.activeElement;
      const dlg = doc.createElement("dialog");
      current = dlg;
      dlg.className = "modal";
      // alertdialog (DESIGN.md, B-Borrar): es un aviso que pide una decisión, no un diálogo
      // cualquiera — el lector de pantalla lo anuncia como tal.
      dlg.setAttribute("role", "alertdialog");
      dlg.setAttribute("aria-modal", "true");
      dlg.setAttribute("aria-labelledby", "modal-title");
      if (message) dlg.setAttribute("aria-describedby", "modal-text");
      dlg.innerHTML = modalHtml({ title, message, cancelText, confirmText, preview, destructive });

      let confirmed = false;
      let byBack = false;
      let pushed = false;
      let closing = false;   // ya se pidió el cierre: evita reentradas (doble Escape, velo + atrás)

      // requestClose(): ÚNICA puerta hacia el cierre real. Añade .is-leaving (dispara la animación
      // de salida, components.css) y solo cuando termina llama a dlg.close() de verdad, que es
      // quien dispara el evento "close" (el embudo de siempre: deshace el historial y decide
      // onConfirm/foco). Cancelar, confirmar, Escape, el clic en el velo y el atrás del sistema
      // pasan TODOS por aquí, así que la animación se ve siempre — y con movimiento reducido,
      // components.css la reduce a un fundido corto (K13).
      const requestClose = () => {
        if (closing) return;
        closing = true;
        dlg.classList.add("is-leaving");
        wait(EXIT_MS, () => dlg.close());
      };

      // Salto de varias entradas de golpe (history.go(-n), o "atrás" del sistema mantenido): el
      // popstate de back.js solo ejecuta el callback de la entrada MÁS BAJA descartada (back.js:
      // dropped[0]). Si la del aviso se descarta sin ser esa, el pushBack de más abajo nunca corre:
      // el <dialog> se quedaría abierto en el top layer —con todo lo demás inerte— y `current`
      // señalando a un aviso muerto, así que showConfirm() no volvería a abrir nada nunca más.
      // Red de seguridad: cualquier popstate mientras el diálogo siga abierto lo cierra, lo haya
      // ejecutado o no el callback de pushBack de arriba.
      const onPopstate = () => {
        if (dlg.open) { byBack = true; requestClose(); }
      };
      win.addEventListener("popstate", onPopstate);

      // Escape dispara "cancel" ANTES de cerrar por sí solo: lo interceptamos para que pase por
      // requestClose() y se vea la animación de salida — si lo dejamos correr, el navegador cierra
      // el <dialog> de golpe sin darle tiempo a .is-leaving.
      dlg.addEventListener("cancel", (e) => { e.preventDefault(); requestClose(); });

      // Clic en el velo (fuera de .modal-content, que es el único hijo y llena la caja del
      // <dialog>): mismo cierre no destructivo que Cancelar. target===dlg solo puede ser el velo
      // porque el <dialog> tiene padding:0 y ese hijo lo cubre entero (components.css).
      dlg.addEventListener("click", (e) => { if (e.target === dlg) requestClose(); });

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
      // {scroll:false}: abrir/cerrar el aviso apunta una entrada de historial pero no es un cambio
      // de pantalla — la pantalla de detrás debe quedarse donde estaba (back.js: push/popstate).
      // {chrome:false}: por el mismo motivo, tampoco es un cambio de subpantalla — abrir o cerrar
      // el aviso no debe encender ni apagar `body.subscreen` (tab bar/FAB y el padding de
      // `main#screen`), que se quede como estuviera la pantalla de detrás (back.js: syncChrome).
      // showModal() va ANTES que esto: si pushBack lanza, el diálogo ya está abierto y Cancelar
      // debe poder cerrarlo igual (arriba, con pushed=false, sin tocar goBack()).
      try { pushBack(() => { byBack = true; requestClose(); }, { scroll: false, chrome: false }); pushed = true; } catch {}
      dlg.querySelector("#modal-cancel").onclick = () => requestClose();
      dlg.querySelector("#modal-confirm").onclick = () => { confirmed = true; requestClose(); };
      dlg.querySelector("#modal-cancel").focus();
      return dlg;
    },
  };
}

const instance = typeof document !== "undefined" ? createModal(document, { pushBack, goBack, win: window }) : null;
export const showConfirm = (opts) => instance?.confirm(opts);
