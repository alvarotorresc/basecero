import {
  listRules, allCategoriesById, getIgnoredMerchants, getSnoozedRenewals, subscriptionCharges,
  acceptSubscriptionCandidate, cancelSubscription, ignoreSubscriptionMerchant, snoozeRenewal,
} from "../repo.js";
import {
  annualTotalCents, monthlyTotalCents, annualCents, activeSubscriptions, inactiveSubscriptions,
  nextRenewal, daysUntil, savedSinceCancelCents, renewalNotice, RENEWAL_SOON_DAYS,
} from "../subscriptions.js";
import { detectSubscriptions } from "../subscription-detect.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtMoney, moneyPartsHtml, fmtDiaLargo, fmtDiaCorto, hoyISO } from "../format.js";
import { t } from "../i18n/index.js";
import { pushBack, goBack } from "../back.js";
import { userMessage } from "../errors.js";
import { showConfirm } from "../modal.js";
import { showToast } from "../toast.js";
import { skeletonHtml } from "../skeleton.js";
import { renderRecurrentes } from "./recurrentes.js";
import { subHeaderHtml } from "../ui.js";

import { escHtml, escAttr } from "../esc.js";

/** «renueva el X» (--warn + ", en N días" si faltan ≤7), "renueva cada semana" para las
 *  semanales (D5: sin ancla semanal, nunca aviso), o "sin fecha" para datos incompletos.
 *  Devuelve también `dueIso` (para ordenar) y `warn` (para el color de la fila). */
function renewsInfo(rule, todayIso) {
  if (rule.frequency === "weekly") return { text: t("suscripciones.row.renewsWeekly"), dueIso: "", warn: false };
  const dueIso = nextRenewal(rule, todayIso);
  if (!dueIso) return { text: t("suscripciones.row.noDate"), dueIso: "", warn: false };
  const days = daysUntil(dueIso, todayIso);
  if (days <= RENEWAL_SOON_DAYS) {
    // n (no "days"): dispara el plural {one, other} de t() — "en 1 día" en vez de "en 1 días".
    return { text: t("suscripciones.row.renewsInDays", { date: fmtDiaLargo(dueIso), n: days }), dueIso, warn: true };
  }
  return { text: t("suscripciones.row.renewsOn", { date: fmtDiaLargo(dueIso) }), dueIso, warn: false };
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

// Insignia de la fila = la categoría de la REGLA, nunca un logo de marca (SISTEMA.md §2.2):
// reutiliza .dotico (recurrentes.js), el mismo círculo tintado al 16 % del resto de la app.
function badgeHtml(rule, byId) {
  // Se llama con dos formas distintas: una regla real (category_id, snake_case, como el resto
  // del esquema) y una candidata de subscription-detect.js (categoryId, camelCase — ver su
  // acceptSubscriptionCandidateStmts/detectSubscriptions). Sin el fallback, una candidata siempre
  // pintaba la insignia neutra de "sin categoría" aunque su cargo sí tuviera una detectada.
  const categoryId = rule.category_id ?? rule.categoryId;
  const color = colorForCategory(categoryId, byId);
  const icon = iconForCategory(categoryId, byId);
  return `<div class="dotico" style="--cat:${color};">${icon}</div>`;
}

function heroHtml(rules) {
  const annual = annualTotalCents(rules);
  const monthly = monthlyTotalCents(rules);
  const n = activeSubscriptions(rules).length;
  return `
  <div style="display:flex;flex-direction:column;gap:7px;margin-bottom:26px;">
    <span style="font-size:13px;font-weight:500;color:var(--ink-2);">${t("suscripciones.hero.label")}</span>
    <div class="num" style="display:flex;align-items:baseline;gap:2px;font:var(--t-hero);letter-spacing:-.02em;">${moneyPartsHtml(annual)}</div>
    <div style="display:flex;align-items:center;gap:10px;padding-top:4px;">
      <span class="num" style="font-size:14px;font-weight:600;">${escHtml(fmtMoney(monthly))}</span>
      <span style="font-size:14px;font-weight:500;color:var(--ink-2);">${t("suscripciones.hero.perMonth")}</span>
      <span style="width:1px;height:13px;background:var(--hairline-strong);flex-shrink:0;"></span>
      <span style="font-size:14px;font-weight:500;color:var(--ink-2);">${t("suscripciones.hero.activeCount", { n })}</span>
    </div>
  </div>`;
}

const HUCHA_SVG = `<svg viewBox="0 0 512 512" width="34" height="34" style="flex-shrink:0;border-radius:9px;" aria-hidden="true">
  <rect width="512" height="512" rx="112" fill="var(--accent)"></rect>
  <path d="M193.43 112.79A41 42 0 1 0 166 186A41 42 0 1 1 138.57 259.21" fill="none" stroke="var(--accent-ink)" stroke-width="40" stroke-linecap="round"></path>
  <rect x="149" y="78" width="34" height="216" rx="17" fill="var(--accent-ink)"></rect>
  <path d="M373.43 112.79A41 42 0 1 0 346 186A41 42 0 1 1 318.57 259.21" fill="none" stroke="var(--accent-ink)" stroke-width="40" stroke-linecap="round"></path>
  <rect x="329" y="78" width="34" height="216" rx="17" fill="var(--accent-ink)"></rect>
  <rect x="138" y="349" width="236" height="50" rx="25" fill="var(--accent-ink)"></rect>
</svg>`;

function noticeHtml(notice) {
  if (!notice) return "";
  return `
  <div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;background:var(--accent-tint);border-left:2px solid var(--accent);margin-bottom:26px;">
    ${HUCHA_SVG}
    <div style="display:flex;flex-direction:column;gap:10px;flex:1;min-width:0;">
      <span style="font-size:14px;line-height:1.45;">${t("suscripciones.notice.question", { name: escHtml(notice.name), when: escHtml(fmtDiaLargo(notice.dueIso)), amount: escHtml(fmtMoney(notice.amountCents)) })}</span>
      <div style="display:flex;align-items:center;gap:18px;">
        <button type="button" id="notice-keep" style="border:0;background:transparent;color:var(--accent);font-size:14px;font-weight:600;padding:12px 0;margin:-12px 0;cursor:pointer;">${t("suscripciones.notice.keep")}</button>
        <button type="button" id="notice-cancel" style="border:0;background:transparent;color:var(--danger);font-size:14px;font-weight:600;padding:12px 0;margin:-12px 0;cursor:pointer;">${t("suscripciones.notice.cancel")}</button>
      </div>
    </div>
  </div>`;
}

function sharedPillHtml() {
  return `<span style="display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;background:var(--surface-2);color:var(--ink-2);font-size:11px;font-weight:500;flex-shrink:0;">${t("recurrentes.subtitle.shared")}</span>`;
}

function activeRowHtml(rule, byId, todayIso) {
  const { text, warn } = renewsInfo(rule, todayIso);
  const annual = annualCents(rule);
  return `
  <button type="button" data-active-rule="${rule.id}" class="tx-row"
    style="width:100%;background:none;border-left:0;border-right:0;border-top:0;padding:10px 0;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;">
    ${badgeHtml(rule, byId)}
    <div class="tx-body">
      <div class="tx-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span>${escHtml(rule.name)}</span>
        ${rule.is_shared ? sharedPillHtml() : ""}
      </div>
      <div class="tx-sub wrap" style="${warn ? "color:var(--warn);font-weight:600;" : ""}">${text}</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;">
      <div class="tx-amount">${moneyPartsHtml(rule.amount_cents)}</div>
      <span class="num" style="font-size:11px;font-weight:500;color:var(--ink-2);">${escHtml(fmtMoney(annual))}${t("suscripciones.row.perYear")}</span>
    </div>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--ink-2)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M9.5 5 16 12l-6.5 7"/></svg>
  </button>`;
}

function candidateHtml(candidate, byId) {
  const dates = [...candidate.lastDates].reverse().map((d) => fmtDiaCorto(d)).join(", ");
  return `
  <div style="display:flex;flex-direction:column;gap:14px;padding:16px;background:var(--surface);margin-bottom:14px;">
    <div style="display:flex;align-items:center;gap:12px;">
      ${badgeHtml(candidate, byId)}
      <div class="tx-body">
        <div class="tx-title">${escHtml(candidate.merchant)}</div>
        <div class="tx-sub">${t("suscripciones.candidate.sameAmountOn", { dates: escHtml(dates) })}</div>
      </div>
      <div class="tx-amount">${moneyPartsHtml(candidate.amountCents)}</div>
    </div>
    <div style="display:flex;gap:10px;">
      <button type="button" data-add="${escAttr(candidate.merchantKey)}" style="flex:1;height:46px;border-radius:999px;border:0;background:var(--accent);color:var(--accent-ink);font-size:14px;font-weight:600;cursor:pointer;">${t("suscripciones.candidate.add")}</button>
      <button type="button" data-ignore="${escAttr(candidate.merchantKey)}" style="flex:1;height:46px;border-radius:999px;border:1px solid var(--hairline-strong);background:transparent;color:var(--ink);font-size:14px;font-weight:500;cursor:pointer;">${t("suscripciones.candidate.ignore")}</button>
    </div>
  </div>`;
}

function cancelledRowHtml(rule, todayIso) {
  const figure = rule.cancelled_at
    ? `<span class="num" style="font-size:15px;font-weight:600;color:var(--pos);">${escHtml(fmtMoney(savedSinceCancelCents(rule, todayIso)))}</span>
       <span style="font-size:11px;font-weight:500;color:var(--ink-2);">${t("suscripciones.cancelled.saved")}</span>`
    : `<span style="font-size:13px;font-weight:500;color:var(--ink-2);">${t("suscripciones.cancelled.paused")}</span>`;
  return `
  <div class="tx-row">
    <div class="tx-body">
      <div class="tx-title" style="color:var(--ink-2);">${escHtml(rule.name)}</div>
      ${rule.cancelled_at ? `<div class="tx-sub">${t("suscripciones.cancelled.on", { date: escHtml(fmtDiaLargo(rule.cancelled_at)) })}</div>` : ""}
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;">${figure}</div>
  </div>`;
}

/** Pantalla "Suscripciones" (N6, «el radar»): héroe anual → aviso → Activas → candidatas →
 *  Canceladas → pie. onBack vuelve a quien la haya abierto (Ajustes, Recurrentes o Inicio). */
export async function renderSuscripciones(container, onBack) {
  container.innerHTML = skeletonHtml([72, 120, 236, 200]);

  const today = hoyISO();
  const reload = () => renderSuscripciones(container, onBack);

  let rules, byId, ignored, snoozed, charges;
  try {
    [rules, byId, ignored, snoozed, charges] = await Promise.all([
      listRules(), allCategoriesById(), getIgnoredMerchants(), getSnoozedRenewals(), subscriptionCharges(today),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">${t("suscripciones.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }

  const actives = sortActive(activeSubscriptions(rules), today);
  const inactives = inactiveSubscriptions(rules);
  const candidates = detectSubscriptions(charges, rules, { todayIso: today, ignored });
  const notice = renewalNotice(rules, today, snoozed);
  // El bloque «Canceladas» (inactives) tiene su PROPIO if más abajo y se pinta igual dentro y
  // fuera de isEmpty — pero solo si el árbol `else` llega a evaluarse: sin esta condición, con
  // 0 activas y 0 candidatas pero ALGUNA cancelada, se entraba en la rama isEmpty (la tarjeta de
  // "todavía no hay ninguna suscripción") y las canceladas desaparecían de la pantalla.
  const isEmpty = actives.length === 0 && candidates.length === 0 && inactives.length === 0;

  container.innerHTML = `
    ${subHeaderHtml({ id: "susc-back", title: t("suscripciones.title") })}

    ${heroHtml(rules)}
    ${noticeHtml(notice)}

    ${isEmpty ? `
    <div class="card" style="text-align:center;padding:24px 16px;display:flex;flex-direction:column;gap:8px;">
      <span style="font-size:15px;font-weight:600;">${t("suscripciones.empty.title")}</span>
      <span style="font-size:13px;color:var(--ink-2);line-height:1.45;">${t("suscripciones.empty.body")}</span>
      <button type="button" id="susc-empty-recurrentes" class="link-btn" style="margin-top:6px;color:var(--accent);">${t("recurrentes.title")}</button>
    </div>` : `
    ${actives.length ? `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;">
      <span class="section-title">${t("suscripciones.section.active")}</span>
      <span style="font-size:12px;font-weight:500;color:var(--ink-2);">${t("suscripciones.section.activeHint")}</span>
    </div>
    <div style="display:flex;flex-direction:column;margin-bottom:26px;">
      ${actives.map((r) => activeRowHtml(r, byId, today)).join("")}
    </div>` : ""}

    ${candidates.length ? `
    <div class="section-title" style="margin-bottom:12px;">${t("suscripciones.section.candidates")}</div>
    <div style="margin-bottom:26px;">
      ${candidates.map((c) => candidateHtml(c, byId)).join("")}
    </div>` : ""}

    ${inactives.length ? `
    <div class="section-title" style="margin-bottom:6px;">${t("suscripciones.section.cancelled")}</div>
    <div style="display:flex;flex-direction:column;margin-bottom:26px;">
      ${inactives.map((r) => cancelledRowHtml(r, today)).join("")}
    </div>` : ""}
    `}

    <div style="padding-bottom:12px;">
      <span style="font-size:12px;font-weight:500;color:var(--ink-2);line-height:1.5;">${t("suscripciones.footer")}</span>
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
      container.insertAdjacentHTML("afterbegin", `<div class="banner-aviso red">${escHtml(userMessage(e))}</div>`);
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
          container.insertAdjacentHTML("afterbegin", `<div class="banner-aviso red">${escHtml(userMessage(e))}</div>`);
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
        container.insertAdjacentHTML("afterbegin", `<div class="banner-aviso red">${escHtml(userMessage(e))}</div>`);
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
        container.insertAdjacentHTML("afterbegin", `<div class="banner-aviso red">${escHtml(userMessage(e))}</div>`);
      }
    };
  });
}
