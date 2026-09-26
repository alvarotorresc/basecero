import {
  listRules, listExpenseLeafCategories, listIncomeCategories, listAccounts, allCategoriesById,
  createRule, updateRule, softDeleteRule, cancelSubscription, getMetaAll,
  getOpenPeriod, previsionOfPeriod,
} from "../repo.js";
import { familyForCategory, iconForCategory } from "../category-colors.js";
import { fmtMoney, moneyPartsHtml, currencySymbol, parseCentsRaw, centsToRaw, hoyISO } from "../format.js";
import { annualCents, monthlyCommitmentCents, ruleStateKey, paidThisPeriodCents } from "../subscriptions.js";
import { t, monthLong } from "../i18n/index.js";
import { pushBack, goBack } from "../back.js";
import { userMessage } from "../errors.js";
import { showConfirm } from "../modal.js";
import { showToast } from "../toast.js";
import { renderSuscripciones } from "./suscripciones.js";
import { subHeaderHtml, buttonHtml } from "../ui.js";
import { segmentedHtml, wireSegmented, switchHtml, fieldHtml } from "../controls.js";
import { txRowHtml, pickTileHtml, filterChipHtml, settingRowHtml, sectionHeaderHtml } from "../entity.js";
import { displayHtml, dispInkHtml, meterHtml, emptyStateHtml, containerHtml } from "../instrument.js";

import { escHtml, escAttr } from "../esc.js";

const TIPOS_RULE = [
  { id: "expense", labelKey: "common.type.expense" },
  { id: "income", labelKey: "common.type.income" },
  { id: "transfer", labelKey: "recurrentes.type.transfer" },
];
const FREQ_CHIPS = [
  { id: "weekly", labelKey: "recurrentes.freq.weekly" },
  { id: "monthly", labelKey: "recurrentes.freq.monthly" },
  { id: "quarterly", labelKey: "recurrentes.freq.quarterly" },
  { id: "yearly", labelKey: "recurrentes.freq.yearly" },
];
// Guarda la CLAVE del diccionario, no el texto resuelto: FREQ_CHIPS/TIPOS_RULE son const de
// módulo, evaluadas antes de initI18n(meta) — resolver aquí con t() congelaría el idioma en el
// que arrancó la app. ruleSubtitleParts() resuelve con t() en cada render, ya con el idioma real.
const FREQ_KEY = Object.fromEntries(FREQ_CHIPS.map((f) => [f.id, f.labelKey]));
const needsCategory = (tipo) => tipo === "expense" || tipo === "income";
const needsMonth = (freq) => freq === "quarterly" || freq === "yearly";

/** Un <div class="ent-divider"> entre cada elemento (nunca antes del primero): mismo criterio que
 *  el <hr class="divider"> de la lista de «Neto», reescrito con la clase de componente (§9). */
function withDividers(items) {
  return items.map((html, i) => (i > 0 ? `<div class="ent-divider"></div>${html}` : html)).join("");
}

// Sub de cada fila: frecuencia + día siempre visibles (la lista queda plana, sin agrupar por
// frecuencia como el artboard), + "próximo: {mes}" para trimestral/anual (due_month, dato real de
// la regla), cuentas origen→destino en transferencias, y compartido/suscripción/pausada al final
// (F-11: se pliegan en esta única línea en vez de llevar cada uno su propia insignia de color).
function ruleSubtitleParts(r, accountsAll) {
  const freqKey = FREQ_KEY[r.frequency];
  const freqLabel = freqKey ? t(freqKey).toLowerCase() : r.frequency;
  const parts = [freqLabel, t("recurrentes.subtitle.day", { n: r.due_day })];
  if (needsMonth(r.frequency) && r.due_month) {
    parts.push(t("recurrentes.subtitle.next", { month: monthLong(r.due_month - 1) }));
  }
  if (r.type === "transfer") {
    const from = accountsAll.find((a) => a.id === r.account_id)?.name;
    const to = accountsAll.find((a) => a.id === r.counter_account_id)?.name;
    if (from && to) parts.push(t("recurrentes.subtitle.transferRoute", { from, to }));
  }
  if (r.is_shared) parts.push(t("recurrentes.subtitle.shared"));
  if (r.is_subscription) parts.push(t("recurrentes.badge.subscription"));
  if (!r.is_active) parts.push(t("recurrentes.subtitle.paused"));
  return parts.join(", ");
}

/** Fila de regla (§9, B-Recurrentes): fila de movimiento (icono + nombre + importe) HERMANA de un
 *  interruptor — nunca anidada (D7: dos <button> uno dentro del otro es HTML inválido y duplicaría
 *  el toque). El botón que abre la edición cubre icono+cuerpo+importe; pausada se atenúa SOLO ahí
 *  (`.rec-row-paused .ent-row`), nunca en el interruptor: es el único control que la reactiva. */
function ruleRowHtml(r, item, byId, accountsAll) {
  const isTransfer = r.type === "transfer";
  const fam = isTransfer ? null : familyForCategory(r.category_id, byId);
  const iconKey = isTransfer ? "transfer" : iconForCategory(r.category_id, byId);
  const stateKey = ruleStateKey(r, item);
  const row = txRowHtml({
    fam, icon: iconKey,
    title: r.name,
    line2: ruleSubtitleParts(r, accountsAll),
    amountHtml: moneyPartsHtml(r.amount_cents),
    sign: r.type === "income" ? "income" : "none",
    amountNote: stateKey ? t("recurrentes.state." + stateKey) : "",
    data: { rule: r.id },
  });
  const toggle = switchHtml({
    id: `rec-toggle-${r.id}`,
    checked: !!r.is_active,
    label: t("recurrentes.toggle.aria", { name: r.name }),
  });
  return `<div class="rec-row${r.is_active ? "" : " rec-row-paused"}">${row}${toggle}</div>`;
}

function sectionHtml(titleKey, list, byId, accountsAll) {
  if (!list.length) return "";
  const rows = list.map(({ r, item }) => ruleRowHtml(r, item, byId, accountsAll));
  return `<div class="rec-section">`
    + `${sectionHeaderHtml({ title: t(titleKey) })}`
    + `${containerHtml({ kind: "list", body: withDividers(rows) })}`
    + `</div>`;
}

/** Héroe "Queda por pagar este periodo" (spec §5.1 bloque 2): LED en espera (ámbar, SOLO dentro
 *  del Display, §9 LED) mientras quede algo pendiente, "ok" cuando todo esté liquidado. El pie
 *  dice cuánto quedará después (repo.previsionOfPeriod#disponibleCents ya lo da: el saldo menos
 *  TODO lo comprometido, que es justo "tras pagarlo" cuando eso es lo único que falta). El
 *  medidor compara lo pendiente contra el total real de este periodo (pagado + pendiente, de los
 *  `items` que YA se cargaron) — no el promedio anual de monthlyCommitmentCents, que cuenta reglas
 *  que ni siquiera aplican este mes (ver subscriptions.js#paidThisPeriodCents). Sin periodo
 *  abierto no hay nada que prever (§5.1): el Display entero se oculta, como antes. */
function heroHtml(prevision, rules) {
  if (!prevision) return "";
  const pendingCount = prevision.items.filter((it) => !it.paid && it.rule.type !== "income").length;
  const paid = paidThisPeriodCents(prevision.items);
  const total = paid + prevision.comprometidoCents;
  const led = pendingCount > 0
    ? { state: "wait", text: t("recurrentes.hero.pendingCount", { n: pendingCount }) }
    : { state: "ok", text: t("recurrentes.hero.allSettled") };
  const meterSlot = total > 0
    ? meterHtml({
      value: prevision.comprometidoCents, max: total, onDisplay: true,
      label: t("recurrentes.hero.meterAria", { paid: fmtMoney(paid), total: fmtMoney(total) }),
    })
    : "";
  const footRow = `<div class="rec-hero-row">
    <span>${escHtml(t("recurrentes.hero.paidLabel"))} ${dispInkHtml(fmtMoney(paid))}</span>
    <span>${dispInkHtml(fmtMoney(monthlyCommitmentCents(rules)))} ${escHtml(t("recurrentes.hero.perMonth"))}</span>
  </div>`;
  return displayHtml({
    label: t("recurrentes.hero.pending"),
    value: fmtMoney(prevision.comprometidoCents),
    size: "l",
    led,
    footHtml: t("recurrentes.hero.remaining", { amount: dispInkHtml(fmtMoney(prevision.disponibleCents)) }),
    slot: meterSlot ? `<div class="rec-hero-slot">${meterSlot}${footRow}</div>` : footRow,
  });
}

/** Campo de importe (§9 «Campo hundido», con sufijo de moneda: fieldHtml no lo cubre —
 *  inputmode/sufijo— así que se compone aquí con sus mismas clases, sin tocar controls.js. */
function amountFieldHtml(f) {
  return `<label class="ctl-field-wrap" for="rec-raw">
    <span class="ctl-field-label">${escHtml(t("common.amount"))}</span>
    <span class="ctl-field rec-amount-field">
      <input class="ctl-field-input num" id="rec-raw" type="text" inputmode="decimal" value="${escAttr(f.raw)}">
      <span class="rec-amount-suffix">${escHtml(currencySymbol())}</span>
    </span>
  </label>`;
}

/** Pantalla "Recurrentes": lista de reglas (Task 11 la consume para generar movimientos de
 *  previsión) + formulario de alta/edición con borrado en dos toques (mismo patrón que
 *  movimientos.js openDetail/backToList). onBack vuelve a quien la haya abierto (Ajustes).
 *  Omite (lógica nueva bloqueada, brief S9): nada — la tabla del brief no lista nada para esta
 *  pantalla. */
export async function renderRecurrentes(container, onBack, opts = {}) {
  let rules, expenseCats, incomeCats, accountsAll, byId, meta, period, prevision;
  try {
    [rules, expenseCats, incomeCats, accountsAll, byId, meta, period] = await Promise.all([
      listRules(), listExpenseLeafCategories(), listIncomeCategories(), listAccounts(), allCategoriesById(),
      getMetaAll(), getOpenPeriod(),
    ]);
    prevision = period ? await previsionOfPeriod(period) : null;
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">${t("recurrentes.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }
  const accounts = accountsAll.filter((a) => a.type !== "liability");
  const partnerName = (meta.partner_name || "").trim();

  const state = { view: "list", rules, editId: null, form: null };
  let errorMsg = "";

  async function reloadRules() {
    state.rules = await listRules();
    if (period) prevision = await previsionOfPeriod(period);
  }

  const categoriesFor = (tipo) => (tipo === "income" ? incomeCats : tipo === "expense" ? expenseCats : []);

  function openNew() {
    state.editId = null;
    state.form = {
      name: "", type: "expense", raw: "", cents: 0, categoryId: null,
      accountId: accounts[0]?.id ?? "", counterAccountId: "",
      frequency: "monthly", dueDay: "1", dueMonth: "",
      isShared: false, isActive: true, isSubscription: false,
    };
    pushBack(backToList);
    state.view = "form";
    errorMsg = "";
    render();
  }

  function openEdit(r) {
    state.editId = r.id;
    state.form = {
      name: r.name, type: r.type, raw: centsToRaw(r.amount_cents), cents: r.amount_cents,
      categoryId: r.category_id || null, accountId: r.account_id, counterAccountId: r.counter_account_id || "",
      frequency: r.frequency, dueDay: r.due_day != null ? String(r.due_day) : "",
      dueMonth: r.due_month != null ? String(r.due_month) : "",
      isShared: !!r.is_shared, isActive: !!r.is_active, isSubscription: !!r.is_subscription,
    };
    pushBack(backToList);
    state.view = "form";
    errorMsg = "";
    render();
  }

  function backToList() {
    state.view = "list";
    state.editId = null;
    state.form = null;
    errorMsg = "";
    render();
  }

  function validationError() {
    const f = state.form;
    if (!f.name.trim()) return t("recurrentes.validation.name");
    if (f.cents <= 0) return t("common.enterAmount");
    if (needsCategory(f.type) && !f.categoryId) return t("common.pickCategory");
    if (f.type === "transfer" && (!f.counterAccountId || f.counterAccountId === f.accountId)) {
      return t("common.pickTwoAccounts");
    }
    const day = parseInt(f.dueDay, 10);
    if (!day || day < 1 || day > 31) return t("recurrentes.validation.day");
    if (needsMonth(f.frequency)) {
      const month = parseInt(f.dueMonth, 10);
      if (!month || month < 1 || month > 12) return t("recurrentes.validation.month");
    }
    return "";
  }

  function renderAccountsSection(f) {
    if (f.type === "transfer") {
      return `
      <div class="rec-field-group">
        <div class="rec-field-label">${escHtml(t("common.from"))}</div>
        <div class="rec-chip-row">
          ${accounts.map((a) => filterChipHtml({ label: a.name, selected: f.accountId === a.id, data: { acc: a.id } })).join("")}
        </div>
      </div>
      <div class="rec-field-group">
        <div class="rec-field-label">${escHtml(t("common.to"))}</div>
        <div class="rec-chip-row">
          ${accountsAll.filter((a) => a.id !== f.accountId)
            .map((a) => filterChipHtml({ label: a.name, selected: f.counterAccountId === a.id, data: { counterAcc: a.id } })).join("")}
        </div>
      </div>`;
    }
    return `
    <div class="rec-field-group">
      <div class="rec-field-label">${escHtml(t("common.account"))}</div>
      <div class="rec-chip-row">
        ${accounts.map((a) => filterChipHtml({ label: a.name, selected: f.accountId === a.id, data: { acc: a.id } })).join("")}
      </div>
    </div>`;
  }

  const itemFor = (r) => prevision?.items.find((it) => it.rule.id === r.id);

  function renderList() {
    const pending = [], paid = [], other = [];
    for (const r of state.rules) {
      const item = itemFor(r);
      const key = ruleStateKey(r, item);
      if (key === "pending") pending.push({ r, item });
      else if (key === "paid") paid.push({ r, item });
      else other.push({ r, item });
    }
    // Sin nada pendiente ni pagado (sin periodo abierto, o ninguna regla aplica este mes): una
    // sola lista con todas, en vez de dos secciones vacías y un cajón de "otras" con todo dentro.
    const sections = (pending.length || paid.length)
      ? `${sectionHtml("recurrentes.section.pending", pending, byId, accountsAll)}`
        + `${sectionHtml("recurrentes.section.paidPeriod", paid, byId, accountsAll)}`
        + `${sectionHtml("recurrentes.section.other", other, byId, accountsAll)}`
      : sectionHtml("recurrentes.section.all", state.rules.map((r) => ({ r, item: itemFor(r) })), byId, accountsAll);

    const radarLink = `<div class="rec-radar-link">${settingRowHtml({
      icon: "sus", fam: "sus", label: t("recurrentes.radarLink"), id: "rec-radar-link",
    })}</div>`;

    container.innerHTML = `
      ${subHeaderHtml({ id: "rec-back", title: t("recurrentes.title"), action: { id: "rec-new", icon: "plus", label: t("recurrentes.newRule") } })}
      <div class="rec-body">
        ${errorMsg ? `<div class="banner-aviso red">${escHtml(errorMsg)}</div>` : ""}

        ${heroHtml(prevision, state.rules)}

        ${state.rules.length === 0
          ? emptyStateHtml({ title: t("recurrentes.empty"), rows: 2 })
          : `${sections}<p class="rec-foot-note">${escHtml(t("recurrentes.footNote"))}</p>`}

        ${radarLink}
      </div>
    `;
    wireList();
  }

  function wireList() {
    container.querySelector("#rec-back").onclick = () => onBack();
    container.querySelector("#rec-new").onclick = () => openNew();
    container.querySelectorAll("[data-rule]").forEach((b) => {
      b.onclick = () => {
        const r = state.rules.find((x) => x.id === b.dataset.rule);
        if (r) openEdit(r);
      };
    });
    // Toggle real (D7): hermano del botón que abre la edición. Actualiza el atributo en el sitio
    // (sin volver a pintar: CSS ya reacciona a [aria-checked], igual que antes reaccionaba a
    // :checked) y devuelve el foco al MISMO botón tras guardar — por id de regla, no por índice:
    // reloadRules() puede reordenar la lista.
    container.querySelectorAll("[id^='rec-toggle-']").forEach((btn) => {
      btn.onclick = async () => {
        const ruleId = btn.id.slice("rec-toggle-".length);
        const r = state.rules.find((x) => x.id === ruleId);
        if (!r) return;
        const next = btn.getAttribute("aria-checked") !== "true";
        btn.disabled = true;
        try {
          await updateRule(r.id, { isActive: next });
          await reloadRules();
          render();
          container.querySelector(`#rec-toggle-${ruleId}`)?.focus();
        } catch (err) {
          errorMsg = t("common.saveFailed", { error: userMessage(err) });
          render();
        }
      };
    });
    container.querySelector("#rec-radar-link").onclick = () => {
      pushBack(() => render());
      renderSuscripciones(container, goBack);
    };
  }

  function renderForm() {
    const f = state.form;
    const cats = categoriesFor(f.type);
    const withCategory = needsCategory(f.type);
    // «Cancelar la suscripción» solo tiene sentido sobre lo GUARDADO, no sobre el formulario en
    // curso: se mira state.rules (la última lista recargada tras guardar), nunca el formulario vivo.
    const saved = state.rules.find((r) => r.id === state.editId);
    const canCancelSubscription = !!(saved?.is_subscription && saved?.is_active);

    const categoryGrid = cats.length ? `
      <div class="rec-field-group">
        <div class="rec-field-label">${escHtml(t("common.category"))}</div>
        <div class="rec-cat-grid">
          ${cats.map((c) => {
            const fam = familyForCategory(c.id, byId);
            return pickTileHtml({ fam, icon: iconForCategory(c.id, byId), label: c.name, selected: f.categoryId === c.id, data: { cat: c.id } });
          }).join("")}
        </div>
      </div>` : "";

    const toggleRows = [];
    if (f.type === "expense") {
      toggleRows.push(settingRowHtml({
        label: t("recurrentes.form.subscriptionLabel"), sub: t("recurrentes.form.subscriptionHint"),
        controlHtml: switchHtml({ id: "rec-subscription", checked: f.isSubscription, label: t("recurrentes.form.subscriptionLabel") }),
        id: "rec-subscription",
      }));
    }
    if (withCategory && f.type !== "income" && (f.isShared || partnerName)) {
      toggleRows.push(settingRowHtml({
        label: t("recurrentes.form.sharedWith", { name: partnerName || t("recurrentes.shared.fallbackName") }),
        controlHtml: switchHtml({ id: "rec-shared", checked: f.isShared, label: t("recurrentes.form.sharedWith", { name: partnerName || t("recurrentes.shared.fallbackName") }) }),
        id: "rec-shared",
      }));
    }
    toggleRows.push(settingRowHtml({
      label: t("recurrentes.form.activeLabel"),
      controlHtml: switchHtml({ id: "rec-active", checked: f.isActive, label: t("recurrentes.form.activeLabel") }),
      id: "rec-active",
    }));

    const annualEstimate = f.isSubscription && f.cents > 0 ? `
      <p class="rec-sub-annual">
        <span class="num">${moneyPartsHtml(annualCents({ amount_cents: f.cents, frequency: f.frequency }))}</span>
        ${escHtml(t("recurrentes.form.perYear"))}
      </p>` : "";

    container.innerHTML = `
      ${subHeaderHtml({ id: "rec-form-back", title: state.editId ? t("recurrentes.form.title.edit") : t("recurrentes.form.title.new") })}
      <div class="rec-form-body">
        ${fieldHtml({ id: "rec-name", label: t("common.name"), value: f.name })}

        ${amountFieldHtml(f)}

        ${segmentedHtml({ id: "rec-type-seg", name: t("common.typeLabel"), options: TIPOS_RULE.map((tr) => ({ value: tr.id, label: t(tr.labelKey) })), value: f.type })}

        ${categoryGrid}

        ${renderAccountsSection(f)}

        <div class="rec-field-group">
          <div class="rec-field-label">${escHtml(t("recurrentes.form.frequency"))}</div>
          <div class="rec-chip-row">
            ${FREQ_CHIPS.map((fr) => filterChipHtml({ label: t(fr.labelKey), selected: f.frequency === fr.id, data: { freq: fr.id } })).join("")}
          </div>
        </div>

        <div class="rec-day-month">
          ${fieldHtml({ id: "rec-day", label: t("recurrentes.form.dayLabel"), type: "number", value: f.dueDay })}
          ${needsMonth(f.frequency) ? fieldHtml({ id: "rec-month", label: t("recurrentes.form.monthLabel"), type: "number", value: f.dueMonth }) : ""}
        </div>

        <div class="rec-toggles">
          ${containerHtml({ kind: "list", body: withDividers(toggleRows) })}
          ${annualEstimate}
        </div>

        ${errorMsg ? `<div class="banner-aviso red">${escHtml(errorMsg)}</div>` : ""}

        ${buttonHtml({ kind: "primary", id: "rec-save", label: state.editId ? t("common.saveChanges") : t("recurrentes.form.create") })}
        ${state.editId && canCancelSubscription ? buttonHtml({ kind: "danger-entry", id: "rec-cancel-subscription", label: t("recurrentes.form.cancelSubscription") }) : ""}
        ${state.editId ? buttonHtml({ kind: "danger-entry", id: "rec-delete", label: t("recurrentes.form.delete") }) : ""}
      </div>
    `;

    wireForm();
  }

  function wireForm() {
    const f = state.form;
    container.querySelector("#rec-form-back").onclick = () => goBack();

    wireSegmented(container.querySelector("#rec-type-seg"), (value) => {
      f.type = value;
      f.categoryId = null;
      f.counterAccountId = "";
      errorMsg = "";
      render();
    });

    container.querySelector("#rec-name").oninput = (e) => { f.name = e.target.value; };

    container.querySelector("#rec-raw").oninput = (e) => {
      f.raw = e.target.value;
      f.cents = parseCentsRaw(f.raw);
      errorMsg = "";
    };

    container.querySelectorAll("[data-cat]").forEach((b) => {
      b.onclick = () => { f.categoryId = b.dataset.cat; errorMsg = ""; render(); };
    });

    container.querySelectorAll("[data-acc]").forEach((b) => {
      b.onclick = () => {
        f.accountId = b.dataset.acc;
        if (f.counterAccountId === f.accountId) f.counterAccountId = "";
        render();
      };
    });

    container.querySelectorAll("[data-counter-acc]").forEach((b) => {
      b.onclick = () => { f.counterAccountId = b.dataset.counterAcc; render(); };
    });

    container.querySelectorAll("[data-freq]").forEach((b) => {
      b.onclick = () => { f.frequency = b.dataset.freq; errorMsg = ""; render(); };
    });

    container.querySelector("#rec-day").oninput = (e) => { f.dueDay = e.target.value; };
    const monthInput = container.querySelector("#rec-month");
    if (monthInput) monthInput.oninput = (e) => { f.dueMonth = e.target.value; };

    const sharedToggle = container.querySelector("#rec-shared");
    if (sharedToggle) sharedToggle.onclick = () => {
      f.isShared = sharedToggle.getAttribute("aria-checked") !== "true";
      sharedToggle.setAttribute("aria-checked", String(f.isShared));
    };

    const activeToggle = container.querySelector("#rec-active");
    activeToggle.onclick = () => {
      f.isActive = activeToggle.getAttribute("aria-checked") !== "true";
      activeToggle.setAttribute("aria-checked", String(f.isActive));
    };

    // render() aquí (a diferencia de isShared/isActive): la visibilidad del coste anual depende
    // de f.isSubscription, así que hay que repintar para que aparezca o desaparezca.
    const subscriptionToggle = container.querySelector("#rec-subscription");
    if (subscriptionToggle) subscriptionToggle.onclick = () => {
      f.isSubscription = subscriptionToggle.getAttribute("aria-checked") !== "true";
      render();
    };

    container.querySelector("#rec-save").onclick = async () => {
      const btn = container.querySelector("#rec-save");
      const msg = validationError();
      if (msg) {
        errorMsg = msg;
        render();
        return;
      }
      btn.disabled = true;
      try {
        const withCategory = needsCategory(f.type);
        const fields = {
          name: f.name.trim(),
          type: f.type,
          amountCents: f.cents,
          categoryId: withCategory ? f.categoryId : "",
          accountId: f.accountId,
          counterAccountId: f.type === "transfer" ? f.counterAccountId : "",
          frequency: f.frequency,
          dueDay: parseInt(f.dueDay, 10),
          dueMonth: needsMonth(f.frequency) ? parseInt(f.dueMonth, 10) : null,
          isShared: withCategory && f.type !== "income" ? f.isShared : false,
          isActive: f.isActive,
          isSubscription: f.type === "expense" ? f.isSubscription : false,
        };
        if (state.editId) await updateRule(state.editId, fields);
        else await createRule(fields);
        await reloadRules();
        goBack();
      } catch (e) {
        btn.disabled = false;
        errorMsg = t("common.saveFailed", { error: userMessage(e) });
        render();
      }
    };

    // Sin este botón, una suscripción solo se podría cancelar en los 7 días previos a su
    // renovación (única ventana en la que la tarjeta de aviso del radar ofrece «Voy a cancelarlo»).
    const cancelSubBtn = container.querySelector("#rec-cancel-subscription");
    if (cancelSubBtn) cancelSubBtn.onclick = () => {
      showConfirm({
        title: t("suscripciones.cancel.title"),
        message: t("suscripciones.cancel.message", { name: f.name }),
        cancelText: t("common.cancel"),
        confirmText: t("suscripciones.cancel.confirm"),
        onConfirm: async () => {
          const btn = container.querySelector("#rec-cancel-subscription");
          if (btn) btn.disabled = true;
          try {
            await cancelSubscription(state.editId, hoyISO());
            await reloadRules();
            showToast(t("toast.subscriptionCancelled"));
            goBack();
          } catch (e) {
            if (btn) btn.disabled = false;
            errorMsg = t("common.saveFailed", { error: userMessage(e) });
            render();
          }
        },
      });
    };

    const deleteBtn = container.querySelector("#rec-delete");
    if (deleteBtn) deleteBtn.onclick = () => {
      showConfirm({
        title: t("recurrentes.form.deleteTitle"),
        message: t("recurrentes.form.deleteMessage", { name: f.name }),
        cancelText: t("common.cancel"),
        confirmText: t("common.delete"),
        onConfirm: async () => {
          const btn = container.querySelector("#rec-delete");
          if (btn) btn.disabled = true;
          try {
            await softDeleteRule(state.editId);
            await reloadRules();
            goBack();
          } catch (e) {
            if (btn) btn.disabled = false;
            errorMsg = t("common.deleteFailed", { error: userMessage(e) });
            render();
          }
        },
      });
    };
  }

  function render() {
    if (state.view === "form") renderForm();
    else renderList();
  }

  // Radar → formulario (Task 10): si el llamador pide abrir una regla concreta (Suscripciones,
  // fila de Activas o Canceladas) y esa regla sigue entre las cargadas, el primer pintado va
  // directo al formulario en vez de a la lista.
  const editRule = opts.editRuleId && rules.find((r) => r.id === opts.editRuleId);
  if (editRule) openEdit(editRule);
  else render();
}
