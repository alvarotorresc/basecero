import { pushBack, goBack } from "./back.js";
import { escHtml } from "./esc.js";

/** Hoja inferior (DESIGN.md §9 «Hoja inferior», B-Movimientos-Filtros / B-Categorias-Nueva): mismo
 *  patrón que modal.js — un `<dialog>` nativo abierto con `showModal()`, no un `<div>` con trampa
 *  de foco a mano. El navegador da trampa de foco, Escape y velo inerte; solo hay que reposicionar
 *  el `<dialog>` (anclado abajo en vez de centrado) y darle su propia animación de entrada/salida.
 *
 *  sheetHtml() es pura (devuelve un string) y createSheet(doc, {pushBack, goBack, win}) es una
 *  fábrica con dependencias inyectadas —mismo patrón que createModal(doc, …)— para poder probarla
 *  en Node con un document (y una ventana) falsos. `win` es OPCIONAL: sin él no hay red de
 *  seguridad para el salto de varias entradas de historial de golpe (ver más abajo), pero el resto
 *  de la hoja funciona igual.
 *
 *  El contenido (título, acción de cabecera y cuerpo) lo decide quien llama: esta PR solo pone el
 *  armazón — filtros, formulario de categoría nueva, etc. llegan con sus propias PRs de pantalla y
 *  usan goBack() para cerrarse, igual que cualquier subpantalla (back.js). */

// DESIGN.md §10 «Hoja y aviso»: sale en 180ms ease-in. Mismo motivo que EXIT_MS en modal.js: el
// cierre real (dlg.close()) espera a que termine la animación de .is-leaving (components.css).
const EXIT_MS = 180;

/** Interior del <dialog>, envuelto en .sheet-content: el <dialog> se queda con padding:0 (para que
 *  un clic en el velo, fuera de esa caja, llegue con target=dlg) y el relleno real (8 16 24) vive
 *  en el envoltorio. `action` y `body` son HTML de confianza que trae YA escapado quien llama (el
 *  formulario o los chips de filtro, por ejemplo): se insertan tal cual. `action` es la pieza
 *  opcional a la derecha del título (acción terciaria como «Quitar filtros», o un botón de cerrar
 *  de 44 — B-Categorias-Nueva); sin ella no queda hueco, el título ocupa el resto (mismo criterio
 *  que subHeaderHtml, ui.js). */
export function sheetHtml({ title, action = "", body }) {
  return `<div class="sheet-content">
    <span class="sheet-handle" aria-hidden="true"></span>
    <div class="sheet-header">
      <h2 id="sheet-title" class="sheet-title">${escHtml(title)}</h2>
      ${action}
    </div>
    <div class="sheet-body">${body}</div>
  </div>`;
}

export function createSheet(doc, { pushBack, goBack, win, wait = (ms, fn) => setTimeout(fn, ms) }) {
  let current = null;
  return {
    open({ title, action, body }) {
      if (current) return null;                 // una sola hoja a la vez
      const opener = doc.activeElement;
      const dlg = doc.createElement("dialog");
      current = dlg;
      dlg.className = "sheet";
      dlg.setAttribute("role", "dialog");
      dlg.setAttribute("aria-modal", "true");
      dlg.setAttribute("aria-labelledby", "sheet-title");
      dlg.innerHTML = sheetHtml({ title, action, body });

      let byBack = false;
      let pushed = false;
      let closing = false;   // ya se pidió el cierre: evita reentradas (doble Escape, velo + atrás)

      // requestClose(): ÚNICA puerta hacia el cierre real — mismo mecanismo que modal.js. Añade
      // .is-leaving (dispara la animación de salida, components.css) y solo cuando termina llama a
      // dlg.close() de verdad, que dispara el evento "close" (el embudo de siempre).
      const requestClose = () => {
        if (closing) return;
        closing = true;
        dlg.classList.add("is-leaving");
        wait(EXIT_MS, () => dlg.close());
      };

      // Red de seguridad del salto de varias entradas (ver modal.js, mismo motivo exacto): si
      // no hay `win` (dependencia opcional), no hay red — la hoja solo se cierra por su propio
      // pushBack, por Escape, por el velo o por goBack() de quien la abrió.
      const onPopstate = () => {
        if (dlg.open) { byBack = true; requestClose(); }
      };
      win?.addEventListener("popstate", onPopstate);

      // Escape dispara "cancel" ANTES de cerrar por sí solo: lo interceptamos para que pase por
      // requestClose() y se vea la animación de salida.
      dlg.addEventListener("cancel", (e) => { e.preventDefault(); requestClose(); });

      // Clic en el velo (fuera de .sheet-content, que es el único hijo y llena la caja del
      // <dialog>): mismo cierre que Escape. target===dlg solo puede ser el velo porque el
      // <dialog> tiene padding:0 y ese hijo lo cubre entero (components.css).
      dlg.addEventListener("click", (e) => { if (e.target === dlg) requestClose(); });

      dlg.addEventListener("close", () => {     // ÚNICO embudo de salida
        win?.removeEventListener("popstate", onPopstate);
        current = null;
        dlg.remove();
        // Si pushBack nunca llegó a apuntar una entrada (la lanzó, p. ej. el límite de Safari), no
        // hay nada que goBack() deba deshacer — llamarlo consumiría una entrada de la PANTALLA de
        // detrás en su lugar.
        if (!byBack && pushed) goBack();
        opener?.focus?.();
      });

      doc.body.appendChild(dlg);                // showModal() sobre un nodo suelto: InvalidStateError
      dlg.showModal();
      // {scroll:false, chrome:false}: mismo motivo que modal.js — abrir/cerrar la hoja apunta una
      // entrada de historial pero no es un cambio de pantalla ni de subpantalla (back.js).
      try { pushBack(() => { byBack = true; requestClose(); }, { scroll: false, chrome: false }); pushed = true; } catch {}
      return dlg;
    },
  };
}

// En Node (tests) no hay document/window: el módulo se puede importar igual, solo que showSheet no
// hace nada — mismo criterio que las instancias globales de modal.js y toast.js.
const instance = typeof document !== "undefined" ? createSheet(document, { pushBack, goBack, win: window }) : null;
export const showSheet = (opts) => instance?.open(opts);
