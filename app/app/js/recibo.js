/** Recibo de guardado: el ticket que aparece y se sella al guardar en Crear gasto (sistema B,
 *  mockups B-Recibo/BD-Recibo). Sustituye al toast SOLO en ese guardado; el toast sigue siendo el
 *  acuse de recibo de todo lo demás.
 *
 *  Por qué un <div> y no un <dialog>: un <dialog> modal atrapa el foco y deja inerte el fondo, que
 *  es lo contrario de lo que pide el diseño («cualquier toque lo corta: nunca bloquea a quien
 *  apunta tres gastos seguidos»), y un <dialog> no modal no tiene ::backdrop, que es el velo. Así
 *  que overlay colgado de <body>, como el toast, con role=status para el lector de pantalla.
 *
 *  Dos piezas, como modal.js: ticketHtml() es pura (devuelve un string y escapa) y
 *  createReceipt(doc, {holdMs}) es una fábrica con el document inyectado —mismo patrón que
 *  createToaster(doc)— para probarla en Node con un document falso y temporizadores simulados.
 *
 *  Cuelga de <body>, no de #screen: las pantallas se repintan enteras con innerHTML y se lo
 *  llevarían por delante (el recibo aparece justo DESPUÉS de que Registro haya cedido el sitio). */

import { escHtml } from "./esc.js";
import { icon } from "./icons.js";
import { badgeHtml } from "./entity.js";
import { displayHtml } from "./instrument.js";
import { famClass } from "./category-colors.js";

const ENTER_MS = 600;   // velo + entrada del ticket + sello; el CSS cabe dentro de este margen
const HOLD_MS = 900;    // tiempo quieto antes de irse solo
const HOLD_REDUCED_MS = 600;
const EXIT_MS = 260;    // el CSS de salida dura menos (180 ms, DESIGN §10); se desmonta al final

// Los dos zigzags del borde (B-Recibo): dientes de 5 sobre 310 de ancho. `fill="currentColor"`:
// el color del papel lo pone `.recibo-edge { color: var(--raised) }` en CSS, nunca el markup.
const teeth = (up) => {
  let d = up ? "M0 10 L0 5" : "M0 0 L0 5";
  for (let x = 5; x <= 310; x += 5) d += ` L${x} ${(x / 5) % 2 === 1 ? (up ? 0 : 10) : 5}`;
  return `${d} L310 ${up ? 10 : 0} Z`;
};
const edge = (up) => `<svg class="recibo-edge" viewBox="0 0 310 10" preserveAspectRatio="none" width="310" height="10" aria-hidden="true"><path d="${teeth(up)}" fill="currentColor"></path></svg>`;
const ZIGZAG_TOP = edge(true);
const ZIGZAG_BOTTOM = edge(false);

/** El ticket (B-Recibo): cabecera BaseCero + hora, Display con el total, el comercio con su tipo
 *  y el sello, la ficha de la categoría y las líneas etiqueta/valor (solo las que traen valor).
 *  Puro: string, escapa todo lo que entra. No incluye «Deshacer» (vive FUERA del papel) ni el
 *  velo — eso lo monta createReceipt().
 *  @param {object} o
 *  @param {string} o.dateTime          Hora (o fecha y hora) de la cabecera.
 *  @param {string} [o.title]           Comercio o concepto, 20/700.
 *  @param {string} [o.subtitle]        Tipo de movimiento, 13/500 dim.
 *  @param {object|null} [o.badge]      Ficha de 28 (entity.js#badgeHtml): {fam, income, icon, label}.
 *  @param {Array<{label:string, value:string, fam?:string|null}>} [o.lines]  `fam` pinta la
 *                                      muestra de 10 de una cuenta delante del valor.
 *                                      `num` pone el valor en la mono tabular (importes);
 *                                      `neg`, en --neg (C4: la cifra negativa que avisa).
 *  @param {Array<{label:string, value:string, num?:boolean}>} [o.periodLines]  Segundo grupo, tras otra
 *                                      perforación: «Quedan en septiembre», «Hoy puedes gastar».
 *  @param {{main:string, cents:string, suffix:string}} o.total  fmtMoneyParts.
 *  @param {string} o.stampDate
 *  @param {string|null} [o.stampFam]   Familia del sello (la de la categoría); sin ella, tinta.
 *  @param {{brand:string, stamp:string, total:string}} o.labels */
export function ticketHtml({ dateTime, title = "", subtitle = "", badge = null, lines, periodLines = [], total, stampDate, stampFam = null, labels }) {
  const linesHtml = (list) => (list ?? []).filter((l) => l?.value).map((l) => {
    const fc = famClass(l.fam);
    return `
        <div class="recibo-line">
          <span class="recibo-label">${escHtml(l.label)}</span>
          <span class="recibo-dots"></span>
          <span class="recibo-value${l.num ? " num" : ""}${l.neg ? " is-neg" : ""}">${fc ? `<span class="recibo-swatch ${fc}" aria-hidden="true"></span>` : ""}${escHtml(l.value)}</span>
        </div>`;
  }).join("");
  const group = (list) => {
    const html = linesHtml(list);
    return html ? `<div class="recibo-perf"></div>
      <div class="recibo-lines">${html}
      </div>` : "";
  };
  const totalText = `${total?.main ?? ""}${total?.cents ?? ""}${total?.suffix ?? ""}`;
  const stampCls = famClass(stampFam);
  return `${ZIGZAG_TOP}
    <div class="recibo-body">
      <div class="recibo-head">
        <span class="recibo-brand">${escHtml(labels.brand)}</span>
        <span class="num recibo-time">${escHtml(dateTime)}</span>
      </div>
      ${displayHtml({ label: labels.total, value: totalText, size: "l" })}
      <div class="recibo-id">
        <div class="recibo-id-text">
          ${title ? `<span class="recibo-title">${escHtml(title)}</span>` : ""}
          ${subtitle ? `<span class="recibo-sub">${escHtml(subtitle)}</span>` : ""}
        </div>
        <div class="recibo-stamp${stampCls ? ` ${stampCls}` : ""}">
          <div class="recibo-stamp-in">
            <span class="recibo-stamp-label">${escHtml(labels.stamp)}</span>
            <span class="num recibo-stamp-date">${escHtml(stampDate)}</span>
          </div>
        </div>
      </div>
      ${badge?.label ? `<div class="recibo-badge">${badgeHtml(badge)}</div>` : ""}
      ${group(lines)}
      ${group(periodLines)}
    </div>
    ${ZIGZAG_BOTTOM}`;
}

/** Fábrica con el document inyectado (mismo patrón que createToaster(doc)/createModal(doc, …)):
 *  probable en Node con un document falso y temporizadores simulados. `holdMs`, si se pasa, gana
 *  siempre — así el test no depende de matchMedia; si no se pasa, sale de
 *  `prefers-reduced-motion` (§4.13: es un temporizador, no una animación, así que no lo decide el
 *  CSS). */
export function createReceipt(doc, { holdMs } = {}) {
  let node = null;
  let timers = [];

  function clearTimers() {
    for (const id of timers) clearTimeout(id);
    timers = [];
  }

  // Un show() con otro ticket ya abierto lo cierra YA, sin animación: el usuario acaba de guardar
  // otra cosa, el ticket viejo ya no vale (un solo ticket a la vez).
  function unmountNow() {
    clearTimers();
    node?.remove();
    node = null;
  }

  return {
    show(data) {
      if (node) unmountNow();

      const el = doc.createElement("div");
      el.id = "recibo";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.innerHTML = `<div class="recibo-ticket">${ticketHtml(data)}</div>` +
        `<button type="button" class="btn-secondary recibo-undo">${icon("undo", { size: 18 })}<span>${escHtml(data?.labels?.undo ?? "")}</span></button>`;

      let undone = false;
      // Salida: el ticket se desvanece, y solo AL TERMINAR esa salida se desmonta de verdad —
      // para que la animación de salida llegue a verse.
      function leave(runUndo) {
        if (node !== el) return;      // ya se cerró (Deshacer + el temporizador tardío después)
        clearTimers();
        node = null;
        el.classList.add("is-leaving");
        timers.push(setTimeout(() => el.remove(), EXIT_MS));
        if (runUndo) data.onUndo?.();
      }

      // Cualquier toque en el velo lo corta y cierra SIN deshacer. El propio #recibo es el velo:
      // el ticket y «Deshacer» cortan la propagación, así que este onclick solo dispara cuando el
      // toque cae fuera de los dos.
      el.onclick = () => leave(false);
      el.querySelector(".recibo-ticket").onclick = (e) => e?.stopPropagation?.();
      el.querySelector(".recibo-undo").onclick = (e) => {
        e?.stopPropagation?.();
        if (undone) return;
        undone = true;
        leave(true);
      };

      function getHold() {
        const reduced = doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
        return holdMs ?? (reduced ? HOLD_REDUCED_MS : HOLD_MS);
      }

      // «Deshacer» solo se alcanza con Tab: quien haya llegado ahí no puede permitirse que el
      // recibo se cierre solo a mitad de decidir. focusin (llega también desde el hijo: el evento
      // burbujea) congela el cierre automático; si el foco se va y no queda ya un temporizador
      // corriendo, se reanuda por el resto de HOLD_MS — no ENTER_MS de nuevo, el ticket ya está
      // dentro. focusin/focusout no son propiedades on* estándar (Firefox no las expone como IDL),
      // así que van por addEventListener, a diferencia del resto de handlers de este fichero.
      el.addEventListener("focusin", () => clearTimers());
      el.addEventListener("focusout", () => {
        if (node === el && !timers.length) timers.push(setTimeout(() => leave(false), getHold()));
      });
      // Escape cierra sin deshacer, igual que un toque en el velo: es la vía de teclado para lo
      // mismo, así que no hace falta parar la propagación (a diferencia de onclick, no hay un hijo
      // que la corte primero).
      el.onkeydown = (e) => {
        if (e?.key === "Escape") leave(false);
      };

      doc.body.appendChild(el);
      node = el;

      timers.push(setTimeout(() => leave(false), ENTER_MS + getHold()));
    },
  };
}

// En Node (tests) no hay document: el módulo se puede importar igual, solo que showReceipt no
// hace nada — mismo criterio que la instancia global de toast.js/modal.js.
const instance = typeof document !== "undefined" ? createReceipt(document) : null;
export const showReceipt = (data) => instance?.show(data);
