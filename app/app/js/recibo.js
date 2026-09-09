/** Recibo de guardado: el ticket de papel que se imprime y se sella al guardar en Registro
 *  (SISTEMA.md §4.13 + docs/design/final-v2/ReciboGuardado.dc.html). Sustituye al toast SOLO en ese
 *  guardado; el toast sigue siendo el acuse de recibo de todo lo demás.
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

const ENTER_MS = 600;   // velo 140 + impresión 420 + sello (arranca a 380, dura 220) = 600
const HOLD_MS = 900;    // §4.13 fase 4
const HOLD_REDUCED_MS = 600;
const EXIT_MS = 260;    // §4.13 fase 5

// & y < y > (mismo criterio que modal.js): un comercio o una nota con marcado no debe verse como
// una etiqueta a medias.
const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Los dos zigzags del borde, copiados de ReciboGuardado.dc.html:37,106 como constantes: mismo
// `d`, pero `fill="currentColor"` en vez del hex a fuego, así que el color lo pone
// `.recibo-ticket { color: var(--paper) }` en CSS, no el markup.
const ZIGZAG_TOP = `<svg viewBox="0 0 296 10" preserveAspectRatio="none" width="296" height="10" style="display:block;" aria-hidden="true"><path d="M0 10 L0 5 L6 0 L12 5 L18 0 L24 5 L30 0 L36 5 L42 0 L48 5 L54 0 L60 5 L66 0 L72 5 L78 0 L84 5 L90 0 L96 5 L102 0 L108 5 L114 0 L120 5 L126 0 L132 5 L138 0 L144 5 L150 0 L156 5 L162 0 L168 5 L174 0 L180 5 L186 0 L192 5 L198 0 L204 5 L210 0 L216 5 L222 0 L228 5 L234 0 L240 5 L246 0 L252 5 L258 0 L264 5 L270 0 L276 5 L282 0 L288 5 L294 0 L300 5 L296 10 Z" fill="currentColor"></path></svg>`;
const ZIGZAG_BOTTOM = `<svg viewBox="0 0 296 10" preserveAspectRatio="none" width="296" height="10" style="display:block;" aria-hidden="true"><path d="M0 0 L0 5 L6 10 L12 5 L18 10 L24 5 L30 10 L36 5 L42 10 L48 5 L54 10 L60 5 L66 10 L72 5 L78 10 L84 5 L90 10 L96 5 L102 10 L108 5 L114 10 L120 5 L126 10 L132 5 L138 10 L144 5 L150 10 L156 5 L162 10 L168 5 L174 10 L180 5 L186 10 L192 5 L198 10 L204 5 L210 10 L216 5 L222 10 L228 5 L234 10 L240 5 L246 10 L252 5 L258 10 L264 5 L270 10 L276 5 L282 10 L288 5 L294 10 L300 5 L296 0 Z" fill="currentColor"></path></svg>`;

/** El ticket: cabecera BaseCero + fecha/hora, líneas etiqueta/valor (solo las que traen valor),
 *  TOTAL en mono grande y el sello circular. Puro: string, escapa todo lo que entra. No incluye el
 *  botón «Deshacer» (vive FUERA del papel, ver SISTEMA.md §4.13) ni el velo — eso lo monta
 *  createReceipt(). */
export function ticketHtml({ dateTime, lines, total, stampDate, labels }) {
  const rows = (lines ?? []).filter((l) => l?.value).map((l) => `
        <div style="display:flex;align-items:baseline;gap:6px;">
          <span class="recibo-label" style="flex-shrink:0;">${escHtml(l.label)}</span>
          <span class="recibo-dots"></span>
          <span class="recibo-value" style="flex-shrink:0;">${escHtml(l.value)}</span>
        </div>`).join("");
  return `${ZIGZAG_TOP}
    <div class="recibo-body">
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;padding-top:6px;">
        <span style="font-size:15px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;">${escHtml(labels.brand)}</span>
        <span class="num" style="font-size:11px;font-weight:500;color:var(--paper-dim);">${escHtml(dateTime)}</span>
      </div>
      <div class="recibo-perf"></div>
      <div style="display:flex;flex-direction:column;gap:9px;">${rows}
      </div>
      <div class="recibo-perf"></div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
        <span style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;">${escHtml(labels.total)}</span>
        <div class="num" style="display:flex;align-items:baseline;gap:2px;">
          <span style="font-size:32px;font-weight:600;letter-spacing:-.02em;">${escHtml(total.main)}</span>
          <span style="font-size:18px;font-weight:600;color:var(--paper-dim);">${escHtml(total.cents)}</span>
          <span style="font-size:14px;font-weight:500;color:var(--paper-dim);margin-left:3px;">${escHtml(total.cur)}</span>
        </div>
      </div>
      <div style="display:flex;justify-content:center;padding:2px 0 8px;">
        <div class="recibo-stamp" style="width:104px;height:104px;border-radius:50%;border:3px solid currentColor;display:flex;align-items:center;justify-content:center;">
          <div style="width:88px;height:88px;border-radius:50%;border:1px solid currentColor;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;">
            <span style="font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;">${escHtml(labels.stamp)}</span>
            <span class="num" style="font-size:9px;font-weight:600;letter-spacing:.06em;">${escHtml(stampDate)}</span>
          </div>
        </div>
      </div>
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
        `<button type="button" class="recibo-undo">${escHtml(data?.labels?.undo ?? "")}</button>`;

      let undone = false;
      // Fase 5 (§4.13): el ticket sube y se desvanece, y solo AL TERMINAR esa salida se desmonta
      // de verdad — para que la animación de salida llegue a verse.
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

      doc.body.appendChild(el);
      node = el;

      const reduced = doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      const hold = holdMs ?? (reduced ? HOLD_REDUCED_MS : HOLD_MS);
      timers.push(setTimeout(() => leave(false), ENTER_MS + hold));
    },
  };
}

// En Node (tests) no hay document: el módulo se puede importar igual, solo que showReceipt no
// hace nada — mismo criterio que la instancia global de toast.js/modal.js.
const instance = typeof document !== "undefined" ? createReceipt(document) : null;
export const showReceipt = (data) => instance?.show(data);
