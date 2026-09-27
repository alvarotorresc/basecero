import {
  goalDetail, balancesAt, getAccountStyle, listGoals, defaultAccountId,
  updateGoal, softDeleteGoal, transferToGoal,
} from "../repo.js";
import {
  contributionsByMonth, avgMonthlyContribution, projectCompletion, coverMonths, hasHucha,
  transferError,
} from "../objetivo-logic.js";
import { famClass } from "../category-colors.js";
import { familyForAccount, goalFamily } from "../account-colors.js";
import { fmtMoney, fmtDec1, currencySymbol, parseCentsRaw, appLocale, hoyISO } from "../format.js";
import { t, monthShort, monthLong } from "../i18n/index.js";
import { goBack } from "../back.js";
import { userMessage } from "../errors.js";
import { showConfirm } from "../modal.js";
import { showSheet } from "../sheet.js";
import { showToast } from "../toast.js";
import { subHeaderHtml, buttonHtml } from "../ui.js";
import { switchHtml, stepperHtml, fieldHtml } from "../controls.js";
import { settingRowHtml, sectionHeaderHtml, filterChipHtml } from "../entity.js";
import { displayHtml, dispInkHtml, bentoHtml, containerHtml, meterHtml } from "../instrument.js";
import { escHtml, escAttr } from "../esc.js";

// Detalle de objetivo (B-7, B-Objetivo de bak-agente2) con «Pasar dinero a la hucha» (B-4). Se
// abre desde la tarjeta del objetivo en Patrimonio, que apunta la entrada de «atrás» y le pasa
// `onEdit` (su formulario de siempre, ahora «Editar objetivo» dentro de este detalle). El color
// va por clase: la familia de la hucha entra como .fam-<k> y la sección «objetivo» de
// screens.css lee --ft/--fb/--fx. En línea solo va geometría (R-INLINE).

const MINUS = "−";
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const monthIdx = (key) => Number(key.slice(5, 7)) - 1;
const monthYear = (key) => Number(key.slice(0, 4));

/** savings_rate guarda puntos porcentuales en currentCents/targetCents: «%»; el resto, importe. */
const fmtGoalAmount = (goal, cents) => (goal.type === "savings_rate" ? `${fmtDec1(cents)} %` : fmtMoney(cents));

/** Cifra corta de las columnas de aportación («150», «−50»): euros sin decimales, como el mockup. */
function shortAmount(cents) {
  const n = new Intl.NumberFormat(appLocale(), { maximumFractionDigits: 0 }).format(Math.abs(cents) / 100);
  return cents < 0 ? `${MINUS}${n}` : n;
}

/** t() escapado con huecos de HTML de confianza: cada {var} de `html` entra como marca y se
 *  sustituye ya pintada, sin partir la frase traducida (mismo truco que patrimonio.js#tNums). */
function tHtml(key, html, vars = {}) {
  const names = Object.keys(html);
  const mark = (i) => `\u0001${i}\u0001`;
  let out = escHtml(t(key, { ...vars, ...Object.fromEntries(names.map((k, i) => [k, mark(i)])) }));
  names.forEach((k, i) => { out = out.replace(mark(i), html[k]); });
  return out;
}

/** Nombre del mes de la proyección: «Diciembre»; con el año si no es el de hoy («Enero 2027»). */
function monthName(key, todayIso) {
  const name = cap(monthLong(monthIdx(key)));
  return monthYear(key) === Number(todayIso.slice(0, 4)) ? name : `${name} ${monthYear(key)}`;
}

// ---- Display ----------------------------------------------------------------------------------

// Hasta 12 casillas de mes caben en el ancho; con más, el medidor corrido.
const MAX_SEGMENTS = 12;

/** Casillas de «meses a cubrir» (B-Objetivo): una por mes objetivo, llenas en ámbar hasta los
 *  meses que cubre lo ahorrado; el eje «1 mes / 2 meses / 3 meses» solo si cabe (≤ 4). */
function coverSegmentsHtml(cover, targetMonths) {
  const n = Math.max(1, Math.round(targetMonths));
  const segs = Array.from({ length: n }, (_, i) => {
    const fill = Math.min(1, Math.max(0, cover - i));
    return `<span class="obj-seg">${fill > 0 ? `<span class="obj-seg-fill disp-amber-fill" style="width:${Number((fill * 100).toFixed(2))}%"></span>` : ""}</span>`;
  }).join("");
  const aria = t("objetivo.display.coverAria", { months: fmtDec1(cover), target: n });
  const axis = n <= 4
    ? `<div class="num obj-seg-axis" style="--n:${n}" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<span>${escHtml(t("objetivo.display.axisMonths", { n: i + 1 }))}</span>`).join("")}</div>`
    : "";
  return `<div class="obj-segs" style="--n:${n}" role="img" aria-label="${escAttr(aria)}">${segs}</div>${axis}`;
}

function displaySlotHtml(d) {
  const { goal, progress } = d;
  if (goal.type === "emergency_fund") {
    const cover = coverMonths(progress.currentCents, d.avgSpentCents);
    if (cover === null) return `<span class="obj-disp-line">${escHtml(t("objetivo.display.coverNoAvg"))}</span>`;
    const months = Number(goal.target_months) || 0;
    const line = tHtml("objetivo.display.cover", { months: dispInkHtml(fmtDec1(cover), { tone: "amber" }) }, { n: Math.abs(cover - 1) < 0.05 ? 1 : 2 });
    const bar = months >= 1 && months <= MAX_SEGMENTS
      ? coverSegmentsHtml(cover, months)
      : meterHtml({ value: progress.currentCents, max: progress.targetCents, onDisplay: true });
    return `${bar}<span class="obj-disp-line">${line}</span>`;
  }
  return meterHtml({ value: Math.max(0, progress.currentCents), max: progress.targetCents, onDisplay: true });
}

function displayBlockHtml(d) {
  const { goal, progress } = d;
  const label = goal.type === "spending_cap" ? t("objetivo.display.spent")
    : goal.type === "savings_rate" ? t("objetivo.display.rate") : t("objetivo.display.saved");
  const hasTarget = progress.targetCents > 0;
  return displayHtml({
    label,
    value: fmtGoalAmount(goal, progress.currentCents),
    size: 44,
    asideHtml: hasTarget ? dispInkHtml(`${Math.round(progress.pct)} %`, { tone: "amber" }) : "",
    footHtml: hasTarget ? tHtml("objetivo.display.ofTarget", { target: dispInkHtml(fmtGoalAmount(goal, progress.targetCents)) }) : "",
    slot: hasTarget || goal.type === "emergency_fund" ? displaySlotHtml(d) : "",
  });
}

// ---- Faltan / Lo completas en ------------------------------------------------------------------

function projectionHtml(d, fam, contrib) {
  const { progress } = d;
  if (!(progress.targetCents > 0)) return "";
  const remaining = progress.targetCents - progress.currentCents;
  const avg = avgMonthlyContribution({ byMonth: contrib.byMonth, firstKey: contrib.firstKey, todayIso: d.todayIso });
  const p = projectCompletion({ remainingCents: remaining, avgCents: avg, todayIso: d.todayIso, currentMonthCents: contrib.months.at(-1).cents });
  const left = bentoHtml({
    label: t("objetivo.remaining"),
    value: fmtMoney(Math.max(0, remaining)),
    foot: p.status === "projected" ? t("objetivo.moreContribs", { n: p.count }) : "",
    fam,
    cls: "obj-bento",
  });
  const right = p.status === "projected"
    ? bentoHtml({ label: t("objetivo.completesIn"), value: monthName(p.monthKey, d.todayIso), foot: t("objetivo.perMonth", { amount: fmtMoney(avg) }), cls: "obj-bento obj-when" })
    : p.status === "done"
      ? bentoHtml({ label: t("objetivo.completesIn"), value: t("objetivo.done"), foot: t("objetivo.doneFoot"), cls: "obj-bento obj-when" })
      : bentoHtml({ label: t("objetivo.completesIn"), value: t("objetivo.noDate"), foot: t("objetivo.noContribs"), cls: "obj-bento obj-when" });
  return { html: `<div class="obj-pair">${left}${right}</div>`, avg };
}

// ---- Aportaciones -------------------------------------------------------------------------------

const BAR_MAX = 64; // px de la columna más alta (B-Objetivo: 200 → 64)

function contributionsHtml(contrib, fam, avg) {
  const cur = contrib.months.at(-1);
  // El mes en curso sin aportar todavía: casilla discontinua a la altura de la media (lo previsto).
  const expected = cur.cents === 0 && avg ? avg : 0;
  const max = Math.max(0, expected, ...contrib.months.map((m) => m.cents));
  const h = (c) => (max > 0 && c > 0 ? Math.max(4, Math.round((c / max) * BAR_MAX)) : 0);
  const cols = contrib.months.map((m) => {
    const name = monthLong(monthIdx(m.key));
    if (m.current && expected) {
      return `<div class="obj-col" role="listitem" aria-label="${escAttr(t("objetivo.contributions.expected", { month: name, amount: fmtMoney(expected) }))}">`
        + `<span class="num obj-col-amt is-dim" aria-hidden="true">${escHtml(shortAmount(expected))}</span>`
        + `<span class="obj-col-bar is-expected" style="height:${h(expected)}px"></span></div>`;
    }
    return `<div class="obj-col" role="listitem" aria-label="${escAttr(`${name} ${m.cents < 0 ? MINUS : ""}${fmtMoney(Math.abs(m.cents))}`)}">`
      + `<span class="num obj-col-amt${m.cents ? "" : " is-dim"}" aria-hidden="true">${escHtml(shortAmount(m.cents))}</span>`
      + `${h(m.cents) ? `<span class="obj-col-bar" style="height:${h(m.cents)}px"></span>` : ""}</div>`;
  }).join("");
  const labels = contrib.months.map((m) => `<span${m.current ? ' class="is-cur"' : ""}>${escHtml(cap(monthShort(monthIdx(m.key))))}</span>`).join("");
  const first = contrib.months[0].key;
  const before = contrib.beforeCents !== 0
    ? `<div class="obj-before"><span class="obj-before-label">${escHtml(t("objetivo.contributions.before", { month: monthLong(monthIdx(first)) }))}</span>`
      + `<span class="num obj-before-fig">${escHtml(contrib.beforeCents < 0 ? `${MINUS}${fmtMoney(-contrib.beforeCents)}` : fmtMoney(contrib.beforeCents))}</span></div>`
    : "";
  const body = `<div class="obj-cols ${famClass(fam) || "no-fam"}" role="list" aria-label="${escAttr(t("objetivo.contributions.aria"))}">${cols}</div>
    <div class="obj-cols-labels" aria-hidden="true">${labels}</div>
    ${before}`;
  return containerHtml({ title: t("objetivo.contributions.title"), total: fmtMoney(contrib.totalCents), body });
}

// ---- Ajustes del objetivo -----------------------------------------------------------------------

const SEP = '<div class="obj-sep" aria-hidden="true"></div>';

function readValueHtml(text, fam) {
  const ink = famClass(fam) ? ` ${famClass(fam)} is-fam-ink` : "";
  return `<span class="ent-set-value${ink}">${escHtml(text)}</span>`;
}

function settingsHtml(d, fam, state) {
  const { goal, progress, account } = d;
  const rows = [];
  if (goal.type === "emergency_fund") {
    rows.push(`<div class="obj-tall">${settingRowHtml({ id: "obj-months-row", icon: "calendar", fam, tileFilled: true, label: t("patrimonio.goal.monthsLabel"),
      controlHtml: stepperHtml({ id: "obj-months", value: String(state.months), decId: "obj-months-dec", incId: "obj-months-inc", decLabel: t("patrimonio.goal.monthLess"), incLabel: t("patrimonio.goal.monthMore") }) })}</div>`);
  } else if (goal.type === "savings_rate") {
    rows.push(settingRowHtml({ icon: "chart", fam, tileFilled: true, label: t("patrimonio.goal.pctLabel"), controlHtml: readValueHtml(fmtGoalAmount(goal, progress.targetCents), fam) }));
  } else {
    const label = goal.type === "provision" ? t("patrimonio.goal.amountLabel.annual") : t("patrimonio.goal.amountLabel.default");
    rows.push(settingRowHtml({ icon: "currency", fam, tileFilled: true, label, controlHtml: readValueHtml(fmtMoney(progress.targetCents), fam) }));
  }
  if (account) {
    rows.push(settingRowHtml({ icon: "piggy", fam, tileFilled: true, label: t("patrimonio.goal.linkedSavings"), controlHtml: readValueHtml(account.name, fam) }));
  }
  rows.push(settingRowHtml({ id: "obj-active-row", icon: "check", fam, tileFilled: true, label: t("patrimonio.goal.activeLabel"),
    controlHtml: switchHtml({ id: "obj-active", checked: state.active, label: t("patrimonio.goal.activeLabel") }) }));
  rows.push(settingRowHtml({ id: "obj-edit", icon: "pencil", fam, tileFilled: true, label: t("objetivo.edit") }));
  return `<section class="obj-group">
      ${sectionHeaderHtml({ title: t("patrimonio.goal.settings"), level: "group", fam })}
      <div class="obj-block ${famClass(fam) || "no-fam"}">${rows.join(SEP)}</div>
    </section>`;
}

// ---- Pantalla -----------------------------------------------------------------------------------

/** Detalle de un objetivo. `onEdit(goal)` abre el formulario de Patrimonio (que vuelve aquí);
 *  «atrás» y borrar vuelven con goBack() a la entrada que apuntó Patrimonio. */
export async function renderObjetivo(container, { goalId, onEdit }) {
  let d, accounts, style, goals, defaultId;
  const state = { months: 3, active: true, error: "" };

  async function load() {
    [d, accounts, style, goals, defaultId] = await Promise.all([
      goalDetail(goalId), balancesAt(hoyISO()), getAccountStyle(), listGoals(), defaultAccountId(),
    ]);
    if (d) {
      state.months = d.goal.target_months != null ? Number(d.goal.target_months) : 3;
      state.active = !!d.goal.is_active;
    }
  }

  try {
    await load();
  } catch (e) {
    container.innerHTML = `${subHeaderHtml({ id: "obj-back", title: t("patrimonio.goals.title") })}<div class="banner-aviso is-error">${escHtml(t("objetivo.error.load", { error: userMessage(e) }))}</div>`;
    container.querySelector("#obj-back").onclick = () => goBack();
    return;
  }
  // Borrado (p. ej. desde el formulario de Editar): no queda nada que enseñar.
  if (!d) { goBack(); return; }

  const accountsById = () => Object.fromEntries(accounts.map((a) => [a.id, a]));
  const famOfAccount = (a) => familyForAccount(a, style, goals.some((g) => g.id === d.goal.id) ? goals : [...goals, d.goal]);

  function render() {
    const { goal } = d;
    const fam = goalFamily(goal, { ...accountsById(), ...(d.account ? { [d.account.id]: d.account } : {}) }, style);
    const withHucha = hasHucha(goal) && !!d.account;
    let middle = "";
    if (withHucha) {
      const contrib = contributionsByMonth({ txs: d.movements, accountId: d.account.id, openingCents: d.account.opening_balance_cents, todayIso: d.todayIso });
      const proj = projectionHtml(d, fam, contrib);
      middle = `${proj ? proj.html : ""}${contributionsHtml(contrib, fam, proj ? proj.avg : null)}`;
    }
    container.innerHTML = `
      ${subHeaderHtml({ id: "obj-back", title: goal.name })}
      <div class="obj">
        ${displayBlockHtml(d)}
        ${middle}
        ${settingsHtml(d, fam, state)}
        ${state.error ? `<div class="banner-aviso is-error">${escHtml(state.error)}</div>` : ""}
        <div class="obj-actions">
          ${withHucha ? buttonHtml({ kind: "primary", id: "obj-transfer", label: t("objetivo.transfer.action") }) : ""}
          ${buttonHtml({ kind: "tertiary-danger", id: "obj-delete", label: t("patrimonio.goal.delete"), icon: "trash" })}
        </div>
      </div>`;
    wire();
  }

  async function reload(focus) {
    try {
      await load();
    } catch (e) {
      state.error = t("objetivo.error.load", { error: userMessage(e) });
    }
    if (!d) { goBack(); return; }
    render();
    if (focus) container.querySelector(focus)?.focus();
  }

  // Los cambios de «Meses a cubrir» se guardan en cola (uno tras otro) y al final se repinta: el
  // objetivo, el porcentaje y las casillas dependen de los meses.
  let saving = Promise.resolve();
  let pendingFocus = "";
  function saveMonths(focus) {
    pendingFocus = focus;
    const months = state.months;
    saving = saving.then(async () => {
      if (months !== state.months) return; // ya hay otro cambio detrás: guarda ese
      try {
        await updateGoal(d.goal.id, { targetMonths: months });
        state.error = "";
      } catch (e) {
        state.error = t("common.saveFailed", { error: userMessage(e) });
      }
      await reload(pendingFocus);
    });
  }

  function wire() {
    container.querySelector("#obj-back").onclick = () => goBack();

    const monthsValue = container.querySelector("#obj-months .ctl-stepper-value");
    monthsValue?.setAttribute("aria-live", "polite");
    const step = (delta, focus) => {
      const next = Math.min(99, Math.max(1, state.months + delta));
      if (next === state.months) return;
      state.months = next;
      if (monthsValue) monthsValue.textContent = String(next);
      saveMonths(focus);
    };
    const dec = container.querySelector("#obj-months-dec");
    const inc = container.querySelector("#obj-months-inc");
    if (dec) dec.onclick = () => step(-1, "#obj-months-dec");
    if (inc) inc.onclick = () => step(1, "#obj-months-inc");

    const sw = container.querySelector("#obj-active");
    sw.onclick = async () => {
      const next = !state.active;
      sw.disabled = true;
      try {
        await updateGoal(d.goal.id, { isActive: next });
        state.active = next;
        sw.setAttribute("aria-checked", next ? "true" : "false");
      } catch (e) {
        state.error = t("common.saveFailed", { error: userMessage(e) });
        render();
        return;
      } finally {
        sw.disabled = false;
      }
    };

    container.querySelector("#obj-edit").onclick = () => onEdit(d.goal);

    const tr = container.querySelector("#obj-transfer");
    if (tr) tr.onclick = () => openTransfer();

    container.querySelector("#obj-delete").onclick = () => {
      showConfirm({
        title: t("patrimonio.goal.deleteTitle"),
        message: t("patrimonio.goal.deleteMessage", { name: d.goal.name }),
        cancelText: t("common.cancel"),
        confirmText: t("common.delete"),
        onConfirm: async () => {
          const btn = container.querySelector("#obj-delete");
          if (btn) btn.disabled = true;
          try {
            await softDeleteGoal(d.goal.id);
            goBack();
          } catch (e) {
            if (btn) btn.disabled = false;
            state.error = t("common.deleteFailed", { error: userMessage(e) });
            render();
          }
        },
      });
    };
  }

  // ---- B-4: hoja «Pasar a la hucha» -------------------------------------------------------------

  function openTransfer() {
    const hucha = d.account;
    // Sin la propia hucha ni los pasivos (una deuda no es de donde sale el ahorro).
    const sources = accounts.filter((a) => a.id !== hucha.id && a.type !== "liability");
    const draft = {
      raw: "",
      cents: 0,
      // Por defecto la corriente (defaultAccountId: la de meta.default_account_id o la primera
      // corriente); si no está en la lista, la primera que quede.
      fromId: sources.some((a) => a.id === defaultId) ? defaultId : (sources[0]?.id ?? ""),
      error: "",
    };
    let done = false;

    const chipsHtml = () => sources.map((a) => filterChipHtml({
      fam: famOfAccount(a), label: a.name, selected: draft.fromId === a.id, data: { trAcc: a.id },
    })).join("");
    const body = `
      ${fieldHtml({ id: "obj-tr-amount", label: t("objetivo.transfer.amount"), inputmode: "decimal", placeholder: "0", num: true, suffix: currencySymbol(), pill: true })}
      <section class="obj-tr-sec" aria-labelledby="obj-tr-from">
        <h3 class="obj-tr-label" id="obj-tr-from">${escHtml(t("objetivo.transfer.from"))}</h3>
        <div class="obj-tr-chips" role="group" aria-labelledby="obj-tr-from">${chipsHtml()}</div>
      </section>
      <p class="obj-tr-error" id="obj-tr-error" role="alert"></p>
      ${buttonHtml({ kind: "primary", id: "obj-tr-submit", label: t("objetivo.transfer.submit") })}`;

    const dlg = showSheet({ title: t("objetivo.transfer.title"), body });
    if (!dlg) return;
    dlg.classList.add("obj-tr");
    const input = dlg.querySelector("#obj-tr-amount");
    const errEl = dlg.querySelector("#obj-tr-error");
    const showError = (msg) => { errEl.textContent = msg; };

    input.oninput = () => {
      draft.raw = input.value;
      draft.cents = parseCentsRaw(draft.raw);
      showError("");
    };
    const wireChips = () => {
      dlg.querySelectorAll("[data-tr-acc]").forEach((b) => {
        b.onclick = () => {
          draft.fromId = b.dataset.trAcc;
          dlg.querySelector(".obj-tr-chips").innerHTML = chipsHtml();
          wireChips();
          showError("");
          dlg.querySelector(`[data-tr-acc="${draft.fromId}"]`)?.focus();
        };
      });
    };
    wireChips();

    const submit = dlg.querySelector("#obj-tr-submit");
    submit.onclick = async () => {
      const err = transferError({ cents: draft.cents, fromId: draft.fromId, toId: hucha.id });
      if (err) {
        showError(t(`objetivo.transfer.error.${err}`));
        if (err === "amount") input.focus();
        return;
      }
      submit.disabled = true;
      try {
        await transferToGoal({ goal: d.goal, fromAccountId: draft.fromId, amountCents: draft.cents });
        done = true;
        goBack();
      } catch (e) {
        submit.disabled = false;
        showError(t("objetivo.transfer.failed", { error: userMessage(e) }));
      }
    };
    // Tras el cierre (la página vuelve a ser interactiva): aviso y repintado con la aportación.
    dlg.addEventListener("close", () => {
      if (!done) return;
      showToast(t("objetivo.transfer.done", { amount: fmtMoney(draft.cents), name: d.goal.name }));
      reload("#obj-transfer");
    });
    setTimeout(() => input.focus(), 0);
  }

  render();
}
