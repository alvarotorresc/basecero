import {
  getAccount, listGoals, getAccountStyle, getAccountLoans, getOpenPeriod, allCategoriesById, listAccounts,
  getMetaAll, setMeta, updateAccount, setAccountLoan, accountBalanceSeries, accountTxOfPeriod, accountRecentTx,
} from "../repo.js";
import { accountFlows, debtProgress, signedForAccount, accountTypeChange, ACCOUNT_TYPES } from "../cuenta-logic.js";
import { familyForAccount } from "../account-colors.js";
import { resolveAccountId } from "../account-defaults.js";
import { familyForCategory, iconForCategory, famClass } from "../category-colors.js";
import { fmtMoney, moneyPartsHtml, hoyISO, prevDayIso } from "../format.js";
import { t } from "../i18n/index.js";
import { userMessage } from "../errors.js";
import { openTxDetail } from "../open-tx.js";
import { goToTab } from "../tabs.js";
import { sparklineSvg } from "../charts.js";
import { subHeaderHtml } from "../ui.js";
import { switchHtml, segmentedHtml, wireSegmented } from "../controls.js";
import { tileHtml, txRowHtml, settingRowHtml, sectionHeaderHtml } from "../entity.js";
import { displayHtml, stackedBarHtml, containerHtml, emptyStateHtml } from "../instrument.js";
import { escHtml, escAttr } from "../esc.js";

// Detalle de cuenta (B-6, B-Cuenta): se abre al tocar una cuenta en Patrimonio. Display con el saldo
// de hoy y su línea de los últimos 6 meses, «Entró» / «Salió» del periodo abierto con la barra de lo
// que salió, la deuda con su trama (pasivo o saldo negativo), los últimos movimientos y el grupo
// «Ajustes de la cuenta», cuyas filas abren el formulario de edición de Patrimonio (onEdit).
//
// No apunta historial: quien la abre hace pushBack (Patrimonio) y el volver de un movimiento
// (open-tx.js) repinta esta pantalla sobre la MISMA entrada. Color por clase (.fam-<k>) y la sección
// «cuenta» de screens.css; en línea solo geometría.

const MINUS = "−";
const DISPLAY_PX = 44;        // B-Cuenta: la cifra del Display a 44, como Patrimonio.
const SERIES_MONTHS = 6;      // Decisión B-6: saldo de 6 meses.
const RECENT_LIMIT = 5;

const signedMoney = (cents, { plus = false } = {}) =>
  (cents < 0 ? `${MINUS}${fmtMoney(Math.abs(cents))}` : `${plus ? "+" : ""}${fmtMoney(cents)}`);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const typeLabel = (type) => t(`patrimonio.accountType.${ACCOUNT_TYPES.includes(type) ? type : "checking"}`);

/** Icono de la cuenta, el mismo criterio que la tarjeta de Patrimonio. */
function accountIcon(type, linkedGoal) {
  if (type === "liability") return "debt";
  if (type === "savings") return linkedGoal ? "piggy" : "bank";
  return "card";
}

/** «Hoy», «Ayer» o «Sáb 12»: la cabecera de día de B-Cuenta (12/600 dim, sin total). */
function dayLabel(date, hoy) {
  if (date === hoy) return t("common.today");
  if (date === prevDayIso(hoy)) return t("movimientos.yesterday");
  const d = new Date(date + "T12:00:00");
  return cap(`${t(`movimientos.weekdayShort.${d.getDay()}`)} ${d.getDate()}`);
}

/** Pantalla «Cuenta». Devuelve true si pintó; false si la cuenta ya no existe (borrada o
 *  archivada en otra pestaña): quien la abrió decide volver. Un error de carga deja un aviso.
 *  @param {HTMLElement} container
 *  @param {string} accountId
 *  @param {object} o
 *  @param {() => void} o.onBack   Botón atrás (el gesto del sistema lo resuelve la pila de back.js).
 *  @param {() => void} o.onEdit   Abre el formulario de la cuenta (Patrimonio). */
export async function renderCuenta(container, accountId, { onBack, onEdit }) {
  let acc, goals, style, loans, period, byId, series, flows, recent, accounts, meta;

  async function load() {
    acc = await getAccount(accountId);
    if (!acc || acc.deleted || acc.is_archived) return false;
    [goals, style, loans, period, byId, series, recent, accounts, meta] = await Promise.all([
      listGoals(), getAccountStyle(), getAccountLoans(), getOpenPeriod(), allCategoriesById(),
      accountBalanceSeries(accountId, SERIES_MONTHS), accountRecentTx(accountId, RECENT_LIMIT), listAccounts(), getMetaAll(),
    ]);
    flows = period ? accountFlows(await accountTxOfPeriod(accountId, period.id), accountId, byId) : null;
    return true;
  }

  try {
    if (!(await load())) return false;
  } catch (e) {
    container.innerHTML = `<div class="banner-aviso is-error">${escHtml(t("cuenta.error.load", { error: userMessage(e) }))}</div>`;
    return true;
  }

  const linkedGoal = () => goals.find((g) => g.account_id && g.account_id === accountId) ?? null;
  const fam = () => familyForAccount(acc, style, goals);
  const balance = () => series[series.length - 1]?.cents ?? 0;
  const accName = (id) => accounts.find((a) => a.id === id)?.name ?? "?";

  // ---- Display --------------------------------------------------------------------------

  /** Saldo de hoy, LED y delta del periodo (lo que entró menos lo que salió: el mismo número que
   *  el bloque de debajo) y la línea de los 6 meses con su eje. Sin periodo abierto, sin LED ni
   *  delta. Deltas en --ok / --disp-ink como Patrimonio (C4). */
  function displayBlock() {
    const delta = flows ? flows.inCents - flows.outCents : null;
    const up = delta !== null && delta >= 0;
    const labels = series.map((p) => cap(String(p.label)));
    const aria = `${t("cuenta.seriesLabel")}: ${series.map((p, i) => `${labels[i]} ${signedMoney(p.cents)}`).join(", ")}`;
    return displayHtml({
      label: t("cuenta.balanceToday"),
      value: signedMoney(balance()),
      size: DISPLAY_PX,
      led: delta === null ? null : { state: up ? "ok" : "idle", text: t(up ? "cuenta.up" : "cuenta.down") },
      footHtml: delta === null ? "" : `<span class="num cta-delta ${up ? "is-up" : "is-down"}">${escHtml(signedMoney(delta, { plus: true }))}</span> ${escHtml(t("cuenta.thisPeriod"))}`,
      slot: series.length > 1
        ? `<div role="img" aria-label="${escAttr(aria)}">${sparklineSvg(series.map((p) => p.cents), { labels, dots: true })}</div>`
        : "",
    });
  }

  // ---- Deuda ---------------------------------------------------------------------------

  /** Deuda (pasivo, o cualquier cuenta en negativo): barra de lo pagado en la familia y lo que
   *  queda con la trama --stripe-debt (C8), con su leyenda; y la cuota, si el pasivo la tiene. */
  function debtBlock() {
    if (balance() >= 0) return "";
    const { paidCents, pendingCents } = debtProgress({ openingCents: acc.opening_balance_cents, balanceCents: balance() });
    const bar = stackedBarHtml([
      { name: t("cuenta.debt.paid"), fam: fam(), value: paidCents, amount: fmtMoney(paidCents) },
      { name: t("cuenta.debt.pending"), debt: true, fam: fam(), value: pendingCents, amount: fmtMoney(pendingCents) },
    ], { label: t("cuenta.debt.label") });
    const monthly = acc.type === "liability" && Object.hasOwn(loans, accountId) ? loans[accountId]?.monthlyCents : 0;
    const quota = monthly > 0
      ? `<p class="cta-quota ${famClass(fam()) || ""}">${escHtml(t("patrimonio.accountLine.installments", { amount: fmtMoney(monthly), n: Math.ceil(pendingCents / monthly) }))}</p>`
      : "";
    return containerHtml({ kind: "chart", label: t("cuenta.debt.label"), body: `${bar}${quota}` });
  }

  // ---- Entró / Salió --------------------------------------------------------------------

  function outName(g) {
    if (g.kind === "transfer") return t("cuenta.transfers");
    if (g.kind === "adjustment") return t("cuenta.adjustments");
    if (g.kind === "uncategorized") return t("cuenta.uncategorized");
    return byId[g.rootId]?.name || t("cuenta.uncategorized");
  }

  /** B-Cuenta: «Entró este periodo» en --pos con «+», «Salió» en tinta con «−» y la barra de lo que
   *  salió, un segmento por categoría raíz en su familia (transferencias, ajustes y sin categoría,
   *  en --idle). Los nombres van en el aria-label de la barra, como en Patrimonio. */
  function flowsBlock() {
    if (!flows) return "";
    const segs = flows.outGroups.map((g) => ({
      name: outName(g), value: g.cents, amount: fmtMoney(g.cents),
      fam: g.kind === "category" ? familyForCategory(g.rootId, byId) : null,
    }));
    const bar = stackedBarHtml(segs, { legend: false, label: t("cuenta.outLabel") });
    const body = `
      <div class="cta-flow"><span class="cta-flow-label">${escHtml(t("cuenta.in"))}</span><span class="num cta-flow-fig${flows.inCents ? " is-in" : ""}">${flows.inCents ? "+" : ""}${escHtml(fmtMoney(flows.inCents))}</span></div>
      <div class="cta-flow"><span class="cta-flow-label">${escHtml(t("cuenta.out"))}</span><span class="num cta-flow-fig">${flows.outCents ? MINUS : ""}${escHtml(fmtMoney(flows.outCents))}</span></div>
      ${bar}`;
    return containerHtml({ kind: "chart", label: t("cuenta.in"), body });
  }

  // ---- Últimos movimientos ---------------------------------------------------------------

  /** Fila del libro de la cuenta (B-Cuenta: 52, cifra a 500): el importe entero que movió la
   *  cuenta, con el signo visto desde ella (una transferencia que entra suma). Toda fila abre el
   *  detalle del movimiento. */
  function rowHtml(r) {
    const s = signedForAccount(r, accountId);
    const sign = s < 0 ? "expense" : "income";
    const amountHtml = moneyPartsHtml(Math.abs(r.amount_cents));
    const base = { amountHtml, sign, data: { tx: r.id }, height: 52, amountWeight: 500 };
    if (r.type === "transfer") {
      return txRowHtml({ ...base, fam: null, icon: "transfer", title: `${accName(r.account_id)} → ${accName(r.counter_account_id)}`, line2: r.merchant || r.note || t("movimientos.type.transfer") });
    }
    if (r.type === "adjustment") {
      return txRowHtml({ ...base, fam: null, icon: "pencil", title: t("common.type.adjustment"), line2: r.merchant || r.note || "" });
    }
    const cat = r.category_id ? byId[r.category_id] : null;
    const parent = cat?.parent_id ? byId[cat.parent_id] : null;
    const path = !cat ? t("cuenta.uncategorized") : parent ? `${parent.name} › ${cat.name}` : cat.name;
    const catFam = cat && r.type !== "income" ? familyForCategory(r.category_id, byId) : null;
    return txRowHtml({
      ...base, fam: catFam, icon: cat ? iconForCategory(r.category_id, byId) : (r.type === "expense" ? "otr" : ""),
      title: r.merchant || cat?.name || t("cuenta.uncategorized"), line2: path,
    });
  }

  function recentBlock() {
    const seeAll = `<button type="button" class="cta-see-all" id="cta-see-all">${escHtml(t("cuenta.recent.seeAll"))}</button>`;
    if (!recent.length) {
      return `<section class="cta-recent">
        <div class="cta-recent-head"><h2 class="cta-recent-title">${escHtml(t("cuenta.recent.title"))}</h2></div>
        ${emptyStateHtml({ title: t("cuenta.recent.empty"), rows: 1 })}
      </section>`;
    }
    const hoy = hoyISO();
    let lastDate = "";
    const items = recent.map((r) => {
      const head = r.date !== lastDate ? `<span class="cta-day">${escHtml(dayLabel(r.date, hoy))}</span>` : "";
      lastDate = r.date;
      return head + rowHtml(r);
    }).join("");
    return `<section class="cta-recent">
      <div class="cta-recent-head"><h2 class="cta-recent-title">${escHtml(t("cuenta.recent.title"))}</h2>${seeAll}</div>
      ${items}
    </section>`;
  }

  // ---- Ajustes de la cuenta --------------------------------------------------------------

  /** B-Cuenta: grupo teñido con las filas de la cuenta. El tipo es un segmentado que guarda al
   *  cambiar; cada otra fila (nombre, saldo inicial, cuota, color) abre el formulario completo de Patrimonio, donde se edita todo como hasta
   *  ahora. «Cuenta por defecto» es meta.default_account_id (Registro, Liquidar e Inicio ya la
   *  leen): se enciende aquí; apagada no hay nada que hacer, así que la encendida no se apaga —
   *  se cambia encendiendo otra. No aplica a un pasivo. */
  function settingsBlock() {
    const f = fam();
    const row = (icon, label, value, key, extra = {}) => settingRowHtml({ icon, fam: f, tileFilled: true, valueInFam: true, label, value, data: { edit: key }, ...extra });
    const sep = '<div class="cta-sep" aria-hidden="true"></div>';
    const monthly = Object.hasOwn(loans, accountId) ? loans[accountId]?.monthlyCents ?? 0 : 0;
    const rows = [
      row("pencil", t("common.name"), acc.name, "name"),
      // Tipo (B-Cuenta): segmentado en su sitio, guarda al cambiar (wire → saveType).
      `<div class="cta-sub">
        <div class="ent-set cta-sub-head">${tileHtml({ fam: f, icon: "grid", size: 30, filled: true })}<span class="ent-set-label" id="cta-tipo-label">${escHtml(t("common.typeLabel"))}</span></div>
        ${segmentedHtml({ id: "cta-tipo", name: t("common.typeLabel"), labelledBy: "cta-tipo-label", value: acc.type, options: ACCOUNT_TYPES.map((k) => ({ value: k, label: typeLabel(k) })) })}
      </div>`,
      row("chart", t("patrimonio.account.openingBalance"), signedMoney(acc.opening_balance_cents), "opening", { valueNum: true }),
    ];
    if (acc.type === "liability") rows.push(row("calendar", t("patrimonio.account.monthlyInstallment"), monthly ? fmtMoney(monthly) : "—", "loan", { valueNum: true }));
    rows.push(row("theme", t("patrimonio.account.color"), f ? t(`families.${f}`) : "—", "color"));
    if (acc.type !== "liability") {
      const isDefault = resolveAccountId(meta.default_account_id, accounts) === accountId;
      const sw = switchHtml({ id: "cta-default", checked: isDefault, label: t("cuenta.defaultAccount"), disabled: isDefault });
      rows.push(settingRowHtml({
        id: "cta-default-row", icon: "estrella", fam: f, tileFilled: true, label: t("cuenta.defaultAccount"),
        controlHtml: sw,
      }));
    }
    return `<section class="cta-group">
      ${sectionHeaderHtml({ title: t("patrimonio.account.settings"), level: "group", fam: f })}
      <div class="cta-block ${famClass(f) || "no-fam"}">${rows.join(sep)}</div>
    </section>`;
  }

  // ---- Pantalla ---------------------------------------------------------------------------

  function render() {
    const f = fam();
    container.innerHTML = `
      <div class="cta">
        ${subHeaderHtml({ id: "cta-back", title: acc.name, leadHtml: tileHtml({ fam: f, icon: accountIcon(acc.type, linkedGoal()), size: 32 }) })}
        ${displayBlock()}
        ${debtBlock()}
        ${flowsBlock()}
        ${recentBlock()}
        ${settingsBlock()}
      </div>`;
    wire();
  }

  function wire() {
    container.querySelector("#cta-back").onclick = () => onBack();
    container.querySelectorAll("[data-edit]").forEach((b) => { b.onclick = () => onEdit(); });
    container.querySelectorAll("[data-tx]").forEach((el) => {
      el.onclick = () => openTxDetail(container, el.dataset.tx, () => renderCuenta(container, accountId, { onBack, onEdit }));
    });
    // «Ver todos»: Movimientos con el filtro de esta cuenta (lo aplica el filtro por cuenta de B-2).
    const seeAll = container.querySelector("#cta-see-all");
    if (seeAll) seeAll.onclick = () => goToTab("movimientos", { accountId });
    const tipo = container.querySelector("#cta-tipo");
    if (tipo) wireSegmented(tipo, (type) => saveType(type));
    const sw = container.querySelector("#cta-default");
    if (sw && !sw.disabled) {
      sw.onclick = async () => {
        sw.disabled = true;
        try {
          await setMeta("default_account_id", accountId);
          meta = { ...meta, default_account_id: accountId };
        } catch (e) {
          sw.disabled = false;
          showError(t("common.saveFailed", { error: userMessage(e) }));
          return;
        }
        render();
        container.querySelector("#cta-default")?.focus();
      };
    }
  }

  /** Cambio de tipo desde el segmentado: las reglas del formulario (cuenta-logic.js#
   *  accountTypeChange), guardado y repintado con los datos nuevos (la familia sigue al tipo si no
   *  se eligió a mano, como en el formulario). Si falla, se repinta lo que había con el aviso. */
  let savingType = false;
  async function saveType(type) {
    if (savingType) return;
    const monthly = Object.hasOwn(loans, accountId) ? loans[accountId]?.monthlyCents ?? 0 : 0;
    const change = accountTypeChange(acc, type, monthly);
    if (!change) return;
    if (change.error) { showError(t("patrimonio.account.validation.name")); return; }
    savingType = true;
    try {
      await updateAccount(accountId, change.fields);
      await setAccountLoan(accountId, change.monthlyCents);
      if (!(await load())) { onBack(); return; }
    } catch (e) {
      render();
      showError(t("common.saveFailed", { error: userMessage(e) }));
      return;
    } finally {
      savingType = false;
    }
    render();
    container.querySelector('#cta-tipo [aria-checked="true"]')?.focus();
  }

  function showError(msg) {
    container.querySelector(".cta")?.insertAdjacentHTML("afterbegin", `<div class="banner-aviso is-error">${escHtml(msg)}</div>`);
  }

  render();
  return true;
}
