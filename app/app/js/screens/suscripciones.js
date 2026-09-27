import {
  listRules, allCategoriesById, getIgnoredMerchants, getSnoozedRenewals, subscriptionCharges,
  acceptSubscriptionCandidate, cancelSubscription, ignoreSubscriptionMerchant, snoozeRenewal,
} from "../repo.js";
import {
  annualTotalCents, monthlyTotalCents, annualCents, activeSubscriptions, inactiveSubscriptions,
  nextRenewal, daysUntil, savedSinceCancelCents, renewalNotice, RENEWAL_SOON_DAYS,
} from "../subscriptions.js";
import { detectSubscriptions } from "../subscription-detect.js";
import { familyForCategory, iconForCategory, famClass } from "../category-colors.js";
import { fmtMoney, moneyPartsHtml, fmtDiaLargo, fmtDiaCorto, hoyISO } from "../format.js";
import { t } from "../i18n/index.js";
import { pushBack, goBack } from "../back.js";
import { userMessage } from "../errors.js";
import { showConfirm } from "../modal.js";
import { showToast } from "../toast.js";
import { skeletonHtml } from "../skeleton.js";
import { renderRecurrentes } from "./recurrentes.js";
import { subHeaderHtml, buttonHtml } from "../ui.js";
import { tileHtml, txRowHtml, sectionHeaderHtml } from "../entity.js";
import { displayHtml, dispInkHtml, containerHtml, emptyStateHtml } from "../instrument.js";
import { escHtml } from "../esc.js";

/** «Renueva en N días» (si faltan ≤7; «Renueva hoy» si es hoy), «Renueva el 2 oct» si falta más
 *  (B-Suscripciones), «Renueva cada semana» para las semanales (D5: sin ancla semanal, nunca
 *  aviso), o «Sin fecha» para datos incompletos. La línea va en el -x de la familia de la fila. */
function renewsInfo(rule, todayIso) {
  if (rule.frequency === "weekly") return t("suscripciones.row.renewsWeekly");
  const dueIso = nextRenewal(rule, todayIso);
  if (!dueIso) return t("suscripciones.row.noDate");
  const days = daysUntil(dueIso, todayIso);
  if (days <= 0) return t("suscripciones.row.renewsToday");
  if (days <= RENEWAL_SOON_DAYS) {
    // n (no "days"): dispara el plural {one, other} de t() — "en 1 día" en vez de "en 1 días".
    return t("suscripciones.row.renewsInDays", { n: days });
  }
  return t("suscripciones.row.renewsOn", { date: fmtDiaCorto(dueIso) });
}

/** Un <div class="ent-divider"> entre cada elemento (nunca antes del primero), para las listas de
 *  txRowHtml dentro de un box-list (§9): mismo criterio que recurrentes.js#withDividers. */
function withDividers(items) {
  return items.map((html, i) => (i > 0 ? `<div class="ent-divider"></div>${html}` : html)).join("");
}

/** Activas ordenadas por nextRenewal ascendente; las sin fecha (semanales, datos incompletos) al
 *  final, por nombre (spec §9.3). */
function sortActive(rules, todayIso) {
  return [...rules].sort((a, b) => {
    const da = nextRenewal(a, todayIso), db = nextRenewal(b, todayIso);
    if (da && db) return da === db ? a.name.localeCompare(b.name) : (da < db ? -1 : 1);
    if (da && !db) return -1;
    if (!da && db) return 1;
    return a.name.localeCompare(b.name);
  });
}

// ---- marcas de renovación (Display, B-Suscripciones) --------------------------------------------

const TIMELINE_DAYS = 30;
const TIMELINE_W = 318, TIMELINE_H = 42, TIMELINE_Y = 14, TIMELINE_LABEL_Y = 38;
// Ancho aproximado de un rótulo «15 sep» (mono 12): para no montar dos y para no salirse del borde.
const LABEL_W = 46;

/** Línea de renovaciones de los próximos 30 días dentro del Display (B-Suscripciones): la pista
 *  con una marca por semana, un punto por suscripción activa que renueva en la ventana y, debajo
 *  de cada punto, su fecha corta («2 oct»). La más próxima va grande con `.disp-today` y su fecha
 *  en ámbar (`.disp-amber`, dentro del Display); el resto, en --disp-dim. Si dos fechas se
 *  pisarían, la segunda no se rotula (el punto sí se pinta). Decorativa (aria-hidden): el detalle
 *  por nombre ya vive en cada fila de Activas (mismo criterio que charts.js#sparklineSvg).
 *  "" sin ninguna renovación en ventana. */
function renewalTimelineHtml(actives, todayIso) {
  const marks = actives
    .map((r) => {
      if (r.frequency === "weekly") return null;
      const dueIso = nextRenewal(r, todayIso);
      if (!dueIso) return null;
      const d = daysUntil(dueIso, todayIso);
      return d >= 0 && d <= TIMELINE_DAYS ? { d, dueIso } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.d - b.d);
  if (!marks.length) return "";
  const y = TIMELINE_Y;
  const x = (d) => Number((Math.min(TIMELINE_W - 1, Math.max(1, (d / TIMELINE_DAYS) * TIMELINE_W))).toFixed(1));
  const base = `<path class="disp-chart-base" d="M0,${y} L${TIMELINE_W},${y}" stroke-width="2" stroke-linecap="round"></path>`;
  // Una marca por semana; la de hoy, algo más alta.
  const ticks = [0, 7, 14, 21, 28].map((d) => (d === 0 ? `M${x(d)},${y - 5} L${x(d)},${y + 5}` : `M${x(d)},${y - 4} L${x(d)},${y + 4}`)).join(" ");
  const tickPath = `<path class="disp-chart-base" d="${ticks}" stroke-width="1.5" stroke-linecap="round"></path>`;
  // El punto grande (la próxima) se pinta el último, encima de los demás.
  const dots = [...marks.slice(1).map((m) => `<circle class="susc-mark" cx="${x(m.d)}" cy="${y}" r="5" stroke-width="3"></circle>`),
    `<circle class="disp-today" cx="${x(marks[0].d)}" cy="${y}" r="6" stroke-width="3"></circle>`].join("");
  let lastRight = -Infinity;
  const labels = marks.map((m, i) => {
    const cx = x(m.d);
    let left = cx - LABEL_W / 2;
    let anchor = "middle", tx = cx;
    // Cerca de un borde, el rótulo se alinea hacia dentro sin separarse más de 13 del punto.
    if (left < 0) { anchor = "start"; tx = Math.max(0, cx - 13); left = tx; } else if (cx + LABEL_W / 2 > TIMELINE_W) { anchor = "end"; tx = Math.min(TIMELINE_W, cx + 13); left = tx - LABEL_W; }
    if (left < lastRight + 4) return "";
    lastRight = left + LABEL_W;
    return `<text class="susc-tl-label${i === 0 ? " disp-amber" : ""}" x="${tx}" y="${TIMELINE_LABEL_Y}" text-anchor="${anchor}">${escHtml(fmtDiaCorto(m.dueIso))}</text>`;
  }).join("");
  return `<div class="disp-chart susc-timeline"><svg class="disp-chart-svg" width="${TIMELINE_W}" height="${TIMELINE_H}" `
    + `viewBox="0 0 ${TIMELINE_W} ${TIMELINE_H}" aria-hidden="true">${base}${tickPath}${dots}${labels}</svg></div>`;
}

function heroHtml(rules, actives, todayIso) {
  const annual = annualTotalCents(rules);
  const monthly = monthlyTotalCents(rules);
  return displayHtml({
    label: t("suscripciones.hero.label"),
    value: fmtMoney(annual),
    size: "l",
    led: { state: actives.length > 0 ? "ok" : "idle", text: t("suscripciones.hero.activeCount", { n: actives.length }) },
    footHtml: `${dispInkHtml(fmtMoney(monthly), { tone: "amber" })} ${escHtml(t("suscripciones.hero.perMonth"))}`,
    slot: renewalTimelineHtml(actives, todayIso),
  });
}

/** Tarjeta de aviso (F-1x): la única suscripción de la que toca preguntar esta semana, tintada con
 *  la familia de su categoría (C6: una sola entidad, tinte permitido), con la fecha corta y la
 *  cifra en el -x de la familia, como B-Suscripciones. «Lo sigo usando» / «Voy a cancelarlo» son
 *  un secundario de 44 cada uno — sin naranja (C1): nada se preselecciona. */
function noticeHtml(notice, rules, byId) {
  if (!notice) return "";
  const rule = rules.find((r) => r.id === notice.ruleId);
  const fam = rule ? familyForCategory(rule.category_id, byId) : null;
  const iconKey = rule ? iconForCategory(rule.category_id, byId) : "otr";
  return `
  <section class="susc-notice ${famClass(fam)}">
    <div class="susc-notice-head">
      ${tileHtml({ fam, icon: iconKey, onTint: true })}
      <div class="ent-body">
        <span class="ent-name">${t("suscripciones.notice.title", { name: escHtml(notice.name), when: escHtml(fmtDiaCorto(notice.dueIso)) })}</span>
        <span class="ent-line2 susc-notice-sub"><span class="num susc-notice-amount is-fam-ink">${escHtml(fmtMoney(notice.amountCents))}</span> ${escHtml(t("suscripciones.notice.question"))}</span>
      </div>
    </div>
    <div class="susc-notice-actions">
      ${buttonHtml({ kind: "secondary", size: "s", id: "notice-keep", label: t("suscripciones.notice.keep") })}
      ${buttonHtml({ kind: "secondary", size: "s", id: "notice-cancel", label: t("suscripciones.notice.cancel") })}
    </div>
  </section>`;
}

function activeRowHtml(rule, byId, todayIso) {
  const fam = familyForCategory(rule.category_id, byId);
  const iconKey = iconForCategory(rule.category_id, byId);
  const annual = annualCents(rule);
  return txRowHtml({
    fam, icon: iconKey,
    title: rule.name,
    line2: renewsInfo(rule, todayIso),
    amountHtml: moneyPartsHtml(rule.amount_cents),
    sign: "none",
    amountNote: fmtMoney(annual) + t("suscripciones.row.perYear"),
    data: { activeRule: rule.id },
  });
}

function candidateCardHtml(candidate, byId) {
  const fam = familyForCategory(candidate.categoryId, byId);
  const iconKey = iconForCategory(candidate.categoryId, byId);
  // Cada fecha va entera (espacio duro dentro de «2 sep»): la línea 2 parte entre fechas, no dentro.
  const dates = [...candidate.lastDates].reverse().map((d) => fmtDiaCorto(d).replace(/ /g, "\u00a0")).join(", ");
  return `
  <div class="susc-candidate">
    <div class="susc-candidate-head ${famClass(fam)}">
      ${tileHtml({ fam, icon: iconKey, onTint: true })}
      <span class="ent-body">
        <span class="ent-name">${escHtml(candidate.merchant)}</span>
        <span class="ent-line2">${t("suscripciones.candidate.sameAmountOn", { dates: escHtml(dates) })}</span>
      </span>
      <span class="num susc-candidate-amount">${moneyPartsHtml(candidate.amountCents)}</span>
    </div>
    <div class="susc-candidate-actions">
      ${buttonHtml({ kind: "secondary", size: "s", label: t("suscripciones.candidate.add"), data: { add: candidate.merchantKey } })}
      ${buttonHtml({ kind: "secondary", size: "s", label: t("suscripciones.candidate.ignore"), data: { ignore: candidate.merchantKey } })}
    </div>
  </div>`;
}

/** Fila de «Canceladas»: cancelada (con ahorro, en «+» --pos: un resultado positivo, C4) o
 *  pausada (sin fecha, sin ahorro). Clicable igual que las activas — abre su edición en
 *  Recurrentes (mismo `data-active-rule`, misma reactivación que ya ofrecía el toggle): así
 *  txRowHtml sigue siendo un botón con algo real que hacer, no uno muerto. Apagada con
 *  `.susc-row-inactive` (mismo criterio que la fila pausada de Recurrentes). */
function cancelledRowHtml(rule, todayIso) {
  const cancelled = !!rule.cancelled_at;
  return `<div class="susc-row-inactive">${txRowHtml({
    fam: null,
    icon: "otr",
    title: rule.name,
    line2: cancelled ? t("suscripciones.cancelled.on", { date: fmtDiaLargo(rule.cancelled_at) }) : "",
    amountHtml: cancelled ? moneyPartsHtml(savedSinceCancelCents(rule, todayIso)) : "",
    sign: cancelled ? "income" : "none",
    amountNote: cancelled ? t("suscripciones.cancelled.saved") : t("suscripciones.cancelled.paused"),
    data: { activeRule: rule.id },
  })}</div>`;
}

/** Pantalla "Suscripciones" (N6, «el radar»): Display → aviso → Activas → candidatas →
 *  Canceladas → estado vacío. onBack vuelve a quien la haya abierto (Ajustes, Recurrentes o Inicio).
 *  Omite (lógica nueva bloqueada, brief S9): nada — la tabla del brief no lista nada para esta
 *  pantalla. */
export async function renderSuscripciones(container, onBack) {
  container.innerHTML = skeletonHtml([140, 120, 236, 200]);

  const today = hoyISO();
  const reload = () => renderSuscripciones(container, onBack);

  let rules, byId, ignored, snoozed, charges;
  try {
    [rules, byId, ignored, snoozed, charges] = await Promise.all([
      listRules(), allCategoriesById(), getIgnoredMerchants(), getSnoozedRenewals(), subscriptionCharges(today),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso is-error">${t("suscripciones.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }

  const actives = sortActive(activeSubscriptions(rules), today);
  const inactives = inactiveSubscriptions(rules);
  const candidates = detectSubscriptions(charges, rules, { todayIso: today, ignored });
  const notice = renewalNotice(rules, today, snoozed);
  const isEmpty = actives.length === 0 && candidates.length === 0 && inactives.length === 0;

  container.innerHTML = `
    ${subHeaderHtml({ id: "susc-back", title: t("suscripciones.title") })}
    <div class="susc-body">
      ${heroHtml(rules, actives, today)}
      ${noticeHtml(notice, rules, byId)}

      ${isEmpty ? `
      <div class="susc-section">
        ${emptyStateHtml({ title: t("suscripciones.empty.title"), text: t("suscripciones.empty.body"), rows: 2 })}
        ${buttonHtml({ kind: "tertiary", id: "susc-empty-recurrentes", label: t("recurrentes.title") })}
      </div>
      ` : `
      ${actives.length ? `
      <div class="susc-section">
        <div class="susc-section-head ${famClass("sus")}">
          <h2 class="ttl susc-section-title">${escHtml(t("suscripciones.section.active"))}</h2>
          <span class="susc-section-hint">${escHtml(t("suscripciones.section.activeHint"))}</span>
        </div>
        <div class="susc-list">${containerHtml({ kind: "list", body: withDividers(actives.map((r) => activeRowHtml(r, byId, today))) })}</div>
      </div>
      ` : ""}

      ${candidates.length ? `
      <div class="susc-section">
        ${sectionHeaderHtml({ title: t("suscripciones.section.candidates") })}
        <div class="susc-candidates">${candidates.map((c) => candidateCardHtml(c, byId)).join("")}</div>
      </div>
      ` : ""}

      ${inactives.length ? `
      <div class="susc-section">
        ${sectionHeaderHtml({ title: t("suscripciones.section.cancelled") })}
        <div class="susc-list">${containerHtml({ kind: "list", body: withDividers(inactives.map((r) => cancelledRowHtml(r, today))) })}</div>
      </div>
      ` : ""}

      <p class="susc-foot-note">${escHtml(t("suscripciones.footNote"))}</p>
      `}
    </div>
  `;

  container.querySelector("#susc-back").onclick = () => onBack();

  const emptyLink = container.querySelector("#susc-empty-recurrentes");
  if (emptyLink) emptyLink.onclick = () => { pushBack(reload); renderRecurrentes(container, goBack); };

  container.querySelectorAll("[data-active-rule]").forEach((btn) => {
    btn.onclick = () => {
      pushBack(reload);
      renderRecurrentes(container, goBack, { editRuleId: btn.dataset.activeRule });
    };
  });

  const noticeKeepBtn = container.querySelector("#notice-keep");
  if (noticeKeepBtn) noticeKeepBtn.onclick = async () => {
    noticeKeepBtn.disabled = true;
    try {
      await snoozeRenewal(notice.ruleId, notice.dueIso, today);
      await reload();
    } catch (e) {
      noticeKeepBtn.disabled = false;
      container.insertAdjacentHTML("afterbegin", `<div class="banner-aviso is-error">${escHtml(userMessage(e))}</div>`);
    }
  };
  const noticeCancelBtn = container.querySelector("#notice-cancel");
  if (noticeCancelBtn) noticeCancelBtn.onclick = () => {
    const rule = rules.find((r) => r.id === notice.ruleId);
    showConfirm({
      title: t("suscripciones.cancel.title"),
      message: t("suscripciones.cancel.message", { name: rule?.name ?? notice.name }),
      cancelText: t("common.cancel"),
      confirmText: t("suscripciones.cancel.confirm"),
      onConfirm: async () => {
        try {
          await cancelSubscription(notice.ruleId, today);
          showToast(t("toast.subscriptionCancelled"));
          await reload();
        } catch (e) {
          container.insertAdjacentHTML("afterbegin", `<div class="banner-aviso is-error">${escHtml(userMessage(e))}</div>`);
        }
      },
    });
  };

  container.querySelectorAll("[data-add]").forEach((btn) => {
    btn.onclick = async () => {
      const candidate = candidates.find((c) => c.merchantKey === btn.dataset.add);
      btn.disabled = true;
      try {
        await acceptSubscriptionCandidate(candidate);
        showToast(t("toast.subscriptionAdded"));
        await reload();
      } catch (e) {
        btn.disabled = false;
        container.insertAdjacentHTML("afterbegin", `<div class="banner-aviso is-error">${escHtml(userMessage(e))}</div>`);
      }
    };
  });
  container.querySelectorAll("[data-ignore]").forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await ignoreSubscriptionMerchant(btn.dataset.ignore);
        showToast(t("toast.subscriptionIgnored"));
        await reload();
      } catch (e) {
        btn.disabled = false;
        container.insertAdjacentHTML("afterbegin", `<div class="banner-aviso is-error">${escHtml(userMessage(e))}</div>`);
      }
    };
  });
}
