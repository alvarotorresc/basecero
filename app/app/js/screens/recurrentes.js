import {
  listRules, listExpenseLeafCategories, listIncomeCategories, listAccounts, allCategoriesById,
  createRule, updateRule, softDeleteRule, cancelSubscription, getMetaAll,
  getOpenPeriod, previsionOfPeriod,
} from "../repo.js";
import { colorForCategory, iconForCategory } from "../category-colors.js";
import { fmtMoney, moneyPartsHtml, currencySymbol, parseCentsRaw, centsToRaw, hoyISO } from "../format.js";
import { annualCents, monthlyCommitmentCents, ruleStateKey } from "../subscriptions.js";
import { t, monthLong } from "../i18n/index.js";
import { pushBack, goBack } from "../back.js";
import { userMessage } from "../errors.js";
import { showConfirm } from "../modal.js";
import { showToast } from "../toast.js";
import { renderSuscripciones } from "./suscripciones.js";
import { subHeaderHtml, metaHtml } from "../ui.js";
import { icon } from "../icons.js";

const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

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
// que arrancó la app. ruleSubtitle() resuelve con t() en cada render, ya con el idioma real.
const FREQ_KEY = Object.fromEntries(FREQ_CHIPS.map((f) => [f.id, f.labelKey]));
const needsCategory = (tipo) => tipo === "expense" || tipo === "income";
const needsMonth = (freq) => freq === "quarterly" || freq === "yearly";

/** Pantalla "Recurrentes": lista de reglas (Task 11 la consume para generar movimientos de
 *  previsión) + formulario de alta/edición con borrado en dos toques (mismo patrón que
 *  movimientos.js openDetail/backToList). onBack vuelve a quien la haya abierto (Ajustes). */
export async function renderRecurrentes(container, onBack, opts = {}) {
  let rules, expenseCats, incomeCats, accountsAll, byId, meta, period, prevision;
  try {
    [rules, expenseCats, incomeCats, accountsAll, byId, meta, period] = await Promise.all([
      listRules(), listExpenseLeafCategories(), listIncomeCategories(), listAccounts(), allCategoriesById(),
      getMetaAll(), getOpenPeriod(),
    ]);
    // previsionOfPeriod necesita `period` ya resuelto (start_date/end_date/my_share_pct): no puede
    // entrar en el Promise.all de arriba, que es justo lo que lo resuelve. Sin periodo abierto no
    // hay nada que prever: el héroe y las etiquetas de estado de la fila se ocultan (mismo
    // criterio que el resto de la app, spec §5.1 bloque 2).
    prevision = period ? await previsionOfPeriod(period) : null;
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso red">${t("recurrentes.error.load", { error: escHtml(userMessage(e)) })}</div>`;
    return;
  }
  const accounts = accountsAll.filter((a) => a.type !== "liability");
  const partnerName = (meta.partner_name || "").trim();

  const state = { view: "list", rules, editId: null, form: null };
  let errorMsg = "";

  // Recarga reglas + previsión juntas: cualquier alta/edición/borrado/toggle puede cambiar tanto
  // la lista como lo que el héroe da por pendiente este periodo (un cargo que pasa a activo, por
  // ejemplo). `period` no cambia en la vida de esta pantalla (no hay forma de cerrar el periodo
  // desde aquí), así que solo se vuelve a pedir la previsión, no el periodo.
  async function reloadRules() {
    state.rules = await listRules();
    if (period) prevision = await previsionOfPeriod(period);
  }

  const categoriesFor = (tipo) => (tipo === "income" ? incomeCats : tipo === "expense" ? expenseCats : []);

  // Insignia de la fila: emoji de su categoría (mismo patrón que el resto de la app) o, para una
  // transferencia, el SVG del repertorio (§1.8: sustituye el glifo de texto «⇄»). El fondo de una
  // transferencia es --surface-2 liso, NO el color-mix(--cat) de .dotico: no hay categoría que
  // teñir, y es el gris plano que pinta Recurrentes.dc.html:151 (misma pareja fondo/trazo que el
  // icono de transferencia de movimientos.js).
  function ruleIconHtml(r) {
    if (r.type === "transfer") {
      return `<div class="dotico" style="background:var(--surface-2);">${icon("transfer", { stroke: "var(--ink-2)" })}</div>`;
    }
    const color = colorForCategory(r.category_id, byId);
    return `<div class="dotico" style="--cat:${color};">${iconForCategory(r.category_id, byId)}</div>`;
  }

  // Sub de cada fila: frecuencia + día SIEMPRE visibles (la lista queda plana, sin agrupar por
  // frecuencia como el artboard — ver informe de la tarea, brecha documentada), + "próximo: {mes}"
  // para trimestral/anual (due_month, dato real de la regla) y cuentas origen→destino en
  // transferencias (accountsAll ya cargado). "compartido"/"suscripción" salen de aquí: pasan a ser
  // .state-pill en la línea del nombre (ruleRowHtml), no texto del subtítulo.
  function ruleSubtitleParts(r) {
    const freqKey = FREQ_KEY[r.frequency];
    const freqLabel = freqKey ? t(freqKey).toLowerCase() : r.frequency;
    // día SIEMPRE visible (antes se omitía en trimestral/anual a favor de "próximo: {mes}",
    // como el artboard — pero el artboard no lleva "día" porque agrupa por frecuencia; sin esa
    // agrupación aquí, omitirlo perdía info real que la regla sí tiene, contra el criterio de la
    // tarea 7: "no se quita info real sin que el brief lo pida").
    const parts = [freqLabel, t("recurrentes.subtitle.day", { n: r.due_day })];
    if (needsMonth(r.frequency) && r.due_month) {
      parts.push(t("recurrentes.subtitle.next", { month: monthLong(r.due_month - 1) }));
    }
    if (r.type === "transfer") {
      const from = accountsAll.find((a) => a.id === r.account_id)?.name;
      const to = accountsAll.find((a) => a.id === r.counter_account_id)?.name;
      if (from && to) parts.push(t("recurrentes.subtitle.transferRoute", { from, to }));
    }
    if (!r.is_active) parts.push(t("recurrentes.subtitle.paused"));
    return parts;
  }

  // Fila plana (sin card propia) dentro de la lista compartida — mismo patrón que
  // rootRowHtml/cuentaRowHtml/rowHtml de gasto-por-categoria.js/patrimonio.js/liquidar.js (tarea 7):
  // una única .card con <hr class="divider"> entre filas. El toggle (D7) es un <button role="switch">
  // HERMANO del botón que abre la edición, no un hijo suyo: dos <button> anidados es HTML inválido
  // y además duplicaría el toque (el de fuera abriría el formulario Y activaría el toggle). El
  // botón de abrir cubre icono+cuerpo+importe; el wrapper que los envuelve a los dos NO es un
  // <button> (evita el anidado), así que la opacidad de "pausada" va en el botón de abrir, no en
  // el wrapper — si no, el propio toggle (el único control que reactiva la regla) se atenuaría.
  function ruleRowHtml(r, withDivider, item) {
    const stateKey = ruleStateKey(r, item);
    const isIncome = r.type === "income";
    const amountCls = isIncome ? " rec-amount-pos" : r.type === "transfer" ? " rec-amount-muted" : "";
    const stateColor = stateKey === "pending" ? "var(--warn)" : "var(--ink-3)";
    return `
    ${withDivider ? '<hr class="divider">' : ""}
    <div style="display:flex;align-items:center;gap:12px;min-height:64px;">
      <button type="button" data-rule="${r.id}"
        style="flex:1;min-width:0;display:flex;align-items:center;gap:12px;padding:12px 0;background:none;border:0;
        text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;${!r.is_active ? "opacity:0.55;" : ""}">
        ${ruleIconHtml(r)}
        <div class="tx-body">
          <div class="tx-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span>${escHtml(r.name)}</span>
            ${r.is_shared ? `<span class="state-pill">${t("recurrentes.badge.shared")}</span>` : ""}
            ${r.is_subscription ? `<span class="state-pill">${t("recurrentes.badge.subscription")}</span>` : ""}
          </div>
          ${metaHtml(ruleSubtitleParts(r))}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;">
          <div class="num${amountCls}" style="font-size:16px;font-weight:500;">${isIncome ? "+" : ""}${moneyPartsHtml(r.amount_cents)}</div>
          ${stateKey ? `<span style="font-size:11px;font-weight:500;color:${stateColor};">${t(`recurrentes.state.${stateKey}`)}</span>` : ""}
        </div>
      </button>
      <button type="button" role="switch" aria-checked="${r.is_active ? "true" : "false"}"
        aria-label="${escAttr(t("recurrentes.toggle.aria", { name: r.name }))}"
        class="toggle rec-toggle" data-toggle="${r.id}" style="border:0;background:none;padding:0;flex-shrink:0;">
        <span class="toggle-track" style="${r.is_active ? "background:var(--accent);" : ""}">
          <span class="toggle-knob" style="${r.is_active ? "background:var(--accent-ink);transform:translateX(20px);" : ""}"></span>
        </span>
      </button>
    </div>`;
  }

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
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">${t("common.from")}</div>
        <div class="chips">
          ${accounts.map((a) => `<button type="button" class="chip${f.accountId === a.id ? " active" : ""}" data-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">${t("common.to")}</div>
        <div class="chips">
          ${accountsAll.filter((a) => a.id !== f.accountId).map((a) => `<button type="button" class="chip${f.counterAccountId === a.id ? " active" : ""}" data-counter-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
        </div>
      </div>`;
    }
    return `
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
      <div class="section-title">${t("common.account")}</div>
      <div class="chips">
        ${accounts.map((a) => `<button type="button" class="chip${f.accountId === a.id ? " active" : ""}" data-acc="${a.id}">${escHtml(a.name)}</button>`).join("")}
      </div>
    </div>`;
  }

  // Héroe "Pendiente este periodo" (spec §5.1 bloque 2): el mismo número que Inicio ya enseña en
  // "Queda por pagar" (repo.previsionOfPeriod#comprometidoCents), con el compromiso mensual del
  // conjunto de reglas como segunda línea (subscriptions.js#monthlyCommitmentCents). Sin periodo
  // abierto no hay nada que prever — ni héroe ni etiquetas de estado en las filas.
  function heroHtml() {
    if (!period) return "";
    return `
    <div style="display:flex;flex-direction:column;gap:7px;padding-bottom:22px;">
      <span style="font-size:13px;font-weight:500;color:var(--ink-3);">${t("recurrentes.hero.pending")}</span>
      <div class="amount-hero lg num">${moneyPartsHtml(prevision.comprometidoCents)}</div>
      <div style="display:flex;align-items:center;gap:10px;padding-top:4px;">
        <span class="num" style="font-size:14px;font-weight:600;">${escHtml(fmtMoney(monthlyCommitmentCents(state.rules)))}</span>
        <span style="font-size:14px;font-weight:500;color:var(--ink-2);">${t("recurrentes.hero.perMonth")}</span>
      </div>
    </div>`;
  }

  // Item de previsionOfPeriod para esta regla (myCents/paid), o undefined si no aplica este mes.
  const itemFor = (r) => prevision?.items.find((it) => it.rule.id === r.id);

  function renderList() {
    container.innerHTML = `
      ${subHeaderHtml({ id: "rec-back", title: t("recurrentes.title"), action: { id: "rec-new", icon: "plus", label: t("recurrentes.newRule") } })}

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      ${heroHtml()}

      <div class="section-title" style="margin-bottom:6px;">${t("recurrentes.section.all")}</div>

      <div class="card" style="display:flex; flex-direction:column;">
        ${state.rules.length === 0
          ? `<p style="text-align:center;color:var(--text-3);padding:16px 0;">${t("recurrentes.empty")}</p>`
          : state.rules.map((r, i) => ruleRowHtml(r, i > 0, itemFor(r))).join("")}
        <hr class="divider">
        <button type="button" id="rec-radar-link"
          style="width:100%;display:flex;align-items:center;gap:12px;padding:16px 0;min-height:56px;
          background:transparent;border:0;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          <span style="flex:1;font-size:14px;font-weight:600;color:var(--accent);">${t("recurrentes.radarLink")}</span>
          ${icon("chevronRight", { size: 18, stroke: "var(--accent)" })}
        </button>
      </div>

      <p style="font-size:12px;font-weight:500;color:var(--ink-3);line-height:1.5;padding-top:20px;">${t("recurrentes.footNote")}</p>
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
    // Toggle real (D7): hermano del botón que abre la edición, con su propio stopPropagation por
    // si algún día un ancestro común gana un listener de clic (defensivo, mismo criterio que pide
    // la spec). Tras guardar, se devuelve el foco al MISMO botón (por id de regla, no por índice:
    // reloadRules() puede reordenar la lista) — sin esto, cada toque pierde el foco al repintar.
    container.querySelectorAll("[data-toggle]").forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const ruleId = btn.dataset.toggle;
        const r = state.rules.find((x) => x.id === ruleId);
        if (!r) return;
        btn.disabled = true;
        try {
          await updateRule(r.id, { isActive: !r.is_active });
          await reloadRules();
          render();
          container.querySelector(`[data-toggle="${ruleId}"]`)?.focus();
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
    // curso: f.isSubscription/f.isActive cambian con cada toggle sin guardar, así que un usuario
    // que desmarca "es una suscripción" (o la desactiva) vería el botón desaparecer/aparecer antes
    // de pulsar "Guardar cambios" — y si lo pulsa, cancelSubscription() actuaría sobre una fila
    // cuyo estado real en BD puede no ser ni suscripción ni activa. Se mira state.rules (la última
    // lista recargada tras guardar), nunca el formulario vivo.
    const saved = state.rules.find((r) => r.id === state.editId);
    const canCancelSubscription = !!(saved?.is_subscription && saved?.is_active);

    const prevChipsScroll = container.querySelector(".chips-scroll")?.scrollLeft;

    container.innerHTML = `
      ${subHeaderHtml({ id: "rec-form-back", title: state.editId ? t("recurrentes.form.title.edit") : t("recurrentes.form.title.new") })}

      <label class="field field-stack" style="margin-bottom:18px;">
        <span class="field-label">${t("common.name")}</span>
        <input type="text" id="rec-name" value="${escAttr(f.name)}" placeholder="${t("common.egPlaceholder", { example: t("recurrentes.form.namePlaceholderExample") })}">
      </label>

      <div class="segmented" style="margin-bottom:18px;">
        ${TIPOS_RULE.map((tr) => `<button type="button" data-tipo="${tr.id}" class="${f.type === tr.id ? "active" : ""}">${t(tr.labelKey)}</button>`).join("")}
      </div>

      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px;">
        <div class="section-title">${t("common.amount")}</div>
        <div class="amount-display" style="align-items:center;">
          <input type="text" inputmode="decimal" id="rec-raw" value="${escAttr(f.raw)}" placeholder="0"
            style="border:0;background:none;color:var(--text);font:600 56px var(--font-num);letter-spacing:-0.02em;width:100%;outline:none;">
          <span class="amount-currency">${currencySymbol()}</span>
        </div>
        <hr class="divider" style="margin-top:6px;">
      </div>

      ${cats.length ? `
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">${t("common.category")}</div>
        <div class="chips-scroll">
          ${cats.map((c) => {
            const color = colorForCategory(c.id, byId);
            const icon = iconForCategory(c.id, byId);
            const active = f.categoryId === c.id;
            return `<button type="button" class="chip-v${active ? " active" : ""}" data-cat="${c.id}" style="--cat:${color};">
              <span class="chip-icon">${icon}</span><span>${escHtml(c.name)}</span>
            </button>`;
          }).join("")}
        </div>
      </div>` : ""}

      ${renderAccountsSection(f)}

      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="section-title">${t("recurrentes.form.frequency")}</div>
        <div class="chips">
          ${FREQ_CHIPS.map((fr) => `<button type="button" class="chip${f.frequency === fr.id ? " active" : ""}" data-freq="${fr.id}">${t(fr.labelKey)}</button>`).join("")}
        </div>
      </div>

      <div style="display:flex; gap:8px; margin-bottom:18px;">
        <label class="field field-stack" style="flex:1;">
          <span class="field-label">${t("recurrentes.form.dayLabel")}</span>
          <input type="number" min="1" max="31" id="rec-day" value="${escAttr(f.dueDay)}">
        </label>
        ${needsMonth(f.frequency) ? `
        <label class="field field-stack" style="flex:1;">
          <span class="field-label">${t("recurrentes.form.monthLabel")}</span>
          <input type="number" min="1" max="12" id="rec-month" value="${escAttr(f.dueMonth)}">
        </label>` : ""}
      </div>

      ${f.type === "expense" ? `
      <div style="display:flex; flex-direction:column; gap:10px; padding:16px; background:var(--accent-tint); border-left:2px solid var(--accent); margin-bottom:18px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <span style="font-size:15px; font-weight:600;">${t("recurrentes.form.subscriptionLabel")}</span>
          <span class="toggle">
            <input type="checkbox" id="rec-subscription" ${f.isSubscription ? "checked" : ""}>
            <span class="toggle-track"><span class="toggle-knob"></span></span>
          </span>
        </div>
        <span style="font-size:13px; line-height:1.45; color:var(--ink-2);">${t("recurrentes.form.subscriptionHint")}</span>
        ${f.isSubscription && f.cents > 0 ? `
        <div style="display:flex; align-items:baseline; gap:6px; padding-top:2px;">
          <span class="num" style="font:var(--t-figure-l); letter-spacing:-.01em;">${moneyPartsHtml(annualCents({ amount_cents: f.cents, frequency: f.frequency }))}</span>
          <span style="font-size:13px; font-weight:500; color:var(--ink-2);">${t("recurrentes.form.perYear")}</span>
        </div>` : ""}
      </div>` : ""}

      ${withCategory && f.type !== "income" && (f.isShared || partnerName) ? `
      <div class="card" style="padding:0 16px; margin-bottom:18px;">
        <label style="height:56px; display:flex; align-items:center; justify-content:space-between; gap:12px; cursor:pointer;">
          <span style="font-size:15px; font-weight:600;">${t("recurrentes.form.sharedWith", { name: escHtml(partnerName) || t("recurrentes.shared.fallbackName") })}</span>
          <span class="toggle">
            <input type="checkbox" id="rec-shared" ${f.isShared ? "checked" : ""}>
            <span class="toggle-track"><span class="toggle-knob"></span></span>
          </span>
        </label>
      </div>` : ""}

      <div class="card" style="padding:0 16px; margin-bottom:18px;">
        <label style="height:56px; display:flex; align-items:center; justify-content:space-between; gap:12px; cursor:pointer;">
          <span style="font-size:15px; font-weight:600;">${t("recurrentes.form.activeLabel")}</span>
          <span class="toggle">
            <input type="checkbox" id="rec-active" ${f.isActive ? "checked" : ""}>
            <span class="toggle-track"><span class="toggle-knob"></span></span>
          </span>
        </label>
      </div>

      ${errorMsg ? `<div class="banner-aviso red" style="margin-bottom:12px;">${escHtml(errorMsg)}</div>` : ""}

      <button type="button" class="btn-primary" id="rec-save" style="margin-bottom:${state.editId ? "10px" : "0"};">
        ${state.editId ? t("common.saveChanges") : t("recurrentes.form.create")}
      </button>
      ${state.editId && canCancelSubscription ? `
      <button type="button" id="rec-cancel-subscription"
        style="width:100%;background:var(--danger-tint);color:var(--danger);
          border:1px solid rgba(255,122,107,.4);border-radius:999px;padding:16px;font:600 15px var(--font-ui);
          cursor:pointer;margin-bottom:10px;">
        ${t("recurrentes.form.cancelSubscription")}
      </button>` : ""}
      ${state.editId ? `
      <button type="button" id="rec-delete"
        style="width:100%;background:transparent;color:var(--red);
          border:1px solid var(--red);border-radius:var(--radius-sm);padding:16px;font:600 16px var(--font-ui);cursor:pointer;">
        ${t("recurrentes.form.delete")}
      </button>` : ""}
    `;

    if (prevChipsScroll != null) {
      const chipsEl = container.querySelector(".chips-scroll");
      if (chipsEl) chipsEl.scrollLeft = prevChipsScroll;
    }

    wireForm();
  }

  function wireForm() {
    const f = state.form;
    container.querySelector("#rec-form-back").onclick = () => goBack();

    container.querySelectorAll("[data-tipo]").forEach((b) => {
      b.onclick = () => {
        f.type = b.dataset.tipo;
        f.categoryId = null;
        f.counterAccountId = "";
        errorMsg = "";
        render();
      };
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
    if (sharedToggle) sharedToggle.onchange = (e) => { f.isShared = e.target.checked; };

    container.querySelector("#rec-active").onchange = (e) => { f.isActive = e.target.checked; };

    // render() aquí (a diferencia de isShared/isActive): la visibilidad del coste anual depende
    // de f.isSubscription, así que hay que repintar para que aparezca o desaparezca.
    const subscriptionToggle = container.querySelector("#rec-subscription");
    if (subscriptionToggle) subscriptionToggle.onchange = (e) => { f.isSubscription = e.target.checked; render(); };

    container.querySelector("#rec-save").onclick = async () => {
      const btn = container.querySelector("#rec-save");
      const msg = validationError();
      if (msg) {
        errorMsg = msg;
        render();
        const savedBtn = container.querySelector("#rec-save");
        savedBtn.classList.add("shake");
        setTimeout(() => savedBtn.classList.remove("shake"), 400);
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
  // fila de Activas) y esa regla sigue entre las cargadas, el primer pintado va directo al
  // formulario en vez de a la lista — sin reimplementar un formulario de once campos aparte.
  const editRule = opts.editRuleId && rules.find((r) => r.id === opts.editRuleId);
  if (editRule) openEdit(editRule);
  else render();
}
