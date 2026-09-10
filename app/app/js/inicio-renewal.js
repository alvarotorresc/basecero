/** Tarjeta de aviso de renovación en Inicio (N6, «el radar»), spec §8 — enganche MÍNIMO y AISLADO
 *  a propósito: `feat/inicio-v2` (en paralelo, sin mergear todavía) traerá su propio mecanismo de
 *  frases de la hucha con prioridades; cuando llegue, `renewalNotice` (subscriptions.js) se
 *  registra ahí como proveedor de prioridad máxima y este módulo desaparece. Hasta entonces vive
 *  solo, sin importar nada de `screens/inicio.js` ni de `screens/suscripciones.js` (cero import
 *  circular, cero acoplamiento), para que el rebase de esa rama debajo de esta sea de un fichero
 *  pequeño y no de un cambio disperso por inicio.js.
 *
 *  Contrato: `screens/inicio.js` (o mañana Inicio v2) llama a `computeRenewalNotice`, pinta
 *  `renewalNoticeHtml` donde el artboard la pone (Main.dc.html:64-80 — tras «Disponible del
 *  periodo», antes de «Movimientos») y, tras el innerHTML, llama a `wireRenewalNotice` pasando
 *  quién navega a Suscripciones (`onSee`) y qué hacer tras silenciar (`onSnoozed`, normalmente
 *  "repinta esta pantalla"). Este módulo no navega ni repinta por su cuenta: no sabe qué pantalla
 *  lo aloja. */
import { renewalNotice } from "./subscriptions.js";
import { snoozeRenewal } from "./repo.js";
import { fmtDiaLargo, fmtMoney } from "./format.js";
import { t } from "./i18n/index.js";
import { showToast } from "./toast.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Misma hucha de SISTEMA.md §4.15 que usa suscripciones.js — repetida aquí (no importada de esa
// pantalla) para no crear una dependencia cruzada solo por un SVG de 6 líneas.
const HUCHA_SVG = `<svg viewBox="0 0 512 512" width="34" height="34" style="flex-shrink:0;border-radius:9px;" aria-hidden="true">
  <rect width="512" height="512" rx="112" fill="var(--accent)"></rect>
  <path d="M193.43 112.79A41 42 0 1 0 166 186A41 42 0 1 1 138.57 259.21" fill="none" stroke="var(--accent-ink)" stroke-width="40" stroke-linecap="round"></path>
  <rect x="149" y="78" width="34" height="216" rx="17" fill="var(--accent-ink)"></rect>
  <path d="M373.43 112.79A41 42 0 1 0 346 186A41 42 0 1 1 318.57 259.21" fill="none" stroke="var(--accent-ink)" stroke-width="40" stroke-linecap="round"></path>
  <rect x="329" y="78" width="34" height="216" rx="17" fill="var(--accent-ink)"></rect>
  <rect x="138" y="349" width="236" height="50" rx="25" fill="var(--accent-ink)"></rect>
</svg>`;

/** La renovación que toca avisar en Inicio, o null. Wrapper de una línea sobre
 *  subscriptions.js#renewalNotice: el punto de enganche real (qué reglas, qué snoozed, qué hoy)
 *  queda en un solo sitio de este fichero, no repartido en inicio.js. */
export const computeRenewalNotice = (rules, todayIso, snoozed) => renewalNotice(rules, todayIso, snoozed);

/** HTML de la tarjeta, o "" si no hay ninguna renovación que avisar. PURA: recibe el `notice` ya
 *  calculado, no toca repo ni Date.now(). Dos acciones de texto como máximo, nunca un botón
 *  primario (SISTEMA.md §4.15): el primario de Inicio es otra cosa. */
export function renewalNoticeHtml(notice) {
  if (!notice) return "";
  return `
  <div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;background:var(--accent-tint);border-left:2px solid var(--accent);margin-bottom:16px;">
    ${HUCHA_SVG}
    <div style="display:flex;flex-direction:column;gap:10px;flex:1;min-width:0;">
      <span style="font-size:14px;line-height:1.45;">${t("inicio.renewal.phrase", { name: escHtml(notice.name), when: escHtml(fmtDiaLargo(notice.dueIso)), amount: escHtml(fmtMoney(notice.amountCents)) })}</span>
      <div style="display:flex;align-items:center;gap:18px;">
        <button type="button" id="inicio-renewal-see" style="border:0;background:transparent;color:var(--accent);font-size:14px;font-weight:600;padding:0;height:24px;cursor:pointer;">${t("inicio.renewal.see")}</button>
        <button type="button" id="inicio-renewal-not-now" style="border:0;background:transparent;color:var(--ink-2);font-size:14px;font-weight:500;padding:0;height:24px;cursor:pointer;">${t("inicio.renewal.notNow")}</button>
      </div>
    </div>
  </div>`;
}

/** Ata las dos acciones de la tarjeta ya pintada en `container` (no-op si `notice` es null, o si
 *  el llamador no incluyó renewalNoticeHtml en su innerHTML). «Ahora no» silencia ESA renovación
 *  (snoozeRenewal) y avisa con un toast; navegar a Suscripciones lo decide el llamador (`onSee`),
 *  igual que repintar tras silenciar (`onSnoozed`) — este módulo no importa ninguna pantalla. */
export function wireRenewalNotice(container, notice, todayIso, { onSee, onSnoozed }) {
  if (!notice) return;
  const seeBtn = container.querySelector("#inicio-renewal-see");
  if (seeBtn) seeBtn.onclick = onSee;

  const notNowBtn = container.querySelector("#inicio-renewal-not-now");
  if (notNowBtn) notNowBtn.onclick = async () => {
    notNowBtn.disabled = true;
    try {
      await snoozeRenewal(notice.ruleId, notice.dueIso, todayIso);
      showToast(t("toast.renewalSnoozed"));
      onSnoozed();
    } catch {
      // «Ahora no» es una acción de baja fricción, sin su propio banner de error: un fallo se
      // reintenta tocando otra vez sin bloquear el resto de la pantalla.
      notNowBtn.disabled = false;
    }
  };
}
