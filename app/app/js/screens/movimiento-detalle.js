import {
  listPeriods, getTransaction, updateTransaction, softDeleteTransaction,
  listExpenseLeafCategories, listIncomeCategories, listAccounts, allCategoriesById, hasActiveLinkedSettlement,
  getMetaAll, listTags, createTag, tagTotals, listGoals,
} from "../repo.js";
import { attachments } from "../attachments.js";
import { familyForCategory, iconForCategory, rootOf } from "../category-colors.js";
import { familyForAccount, parseAccountStyle } from "../account-colors.js";
import { fmtMoney, fmtDiaCorto, hoyISO, prevDayIso, currencySymbol, parseCentsRaw, centsToRaw } from "../format.js";
import { resolveAccountId } from "../account-defaults.js";
import { t } from "../i18n/index.js";
import { metaHtml, subHeaderHtml, buttonHtml } from "../ui.js";
import { icon } from "../icons.js";
import { displayHtml } from "../instrument.js";
import { switchHtml, segmentedHtml, wireSegmented, stepperHtml, fieldHtml } from "../controls.js";
import { chosenCategoryHtml, settingRowHtml, filterChipHtml, tileHtml, sectionHeaderHtml } from "../entity.js";
import { PCT_STEP, normalizePct, stepPct, splitCents } from "../share-pct.js";
import { pushBack, goBack } from "../back.js";
import { userMessage, writeThenRefresh } from "../errors.js";
import { showToast } from "../toast.js";
import { showConfirm } from "../modal.js";
import { showSheet } from "../sheet.js";
import { escHtml, escAttr } from "../esc.js";
import { buildDuplicatePrefill } from "../duplicate-prefill.js";
import { renderRegistro } from "./registro.js";

// Detalle de un movimiento (S6 del rediseño B: B-Movimiento-Detalle, B-Borrar y el visor de foto
// de DESIGN.md §9). Dos estados en la misma pantalla:
//  - VISTA (el mockup): Display de 48 con el comercio arriba y la cifra con signo, tarjeta de la
//    categoría elegida, filas de ajuste (cuenta, fecha, compartido, etiqueta), la nota con la foto
//    y, abajo, «Editar» (el primario de la vista, a todo el ancho) y debajo, en dos columnas,
//    «Duplicar» (B-5: abre Crear gasto prellenado con la fila, fecha de hoy y sin foto — nada se
//    escribe hasta que el usuario guarda ahí) y «Borrar» (entrada destructiva, C5).
//  - EDICIÓN: la misma pantalla con los campos vivos (comercio e importe en el Display, categoría
//    en una hoja, cuentas y etiquetas desplegadas bajo su fila, fecha nativa, reparto) y «Guardar
//    cambios» como único primario. Tocar una fila o la tarjeta en la vista entra en edición con
//    ese control abierto. Nada toca la BD hasta «Guardar cambios»; «Cancelar» vuelve a la vista.
// Edición no apunta entrada de «atrás»: «Atrás» sale del detalle descartando lo no guardado, como
// antes de B (el detalle era un formulario sin paso de vista).

const needsCategory = (tipo) => tipo === "expense" || tipo === "income" || tipo === "refund";

/** ¿Es el detalle de un gasto compartido que pagó la contraparte? Gatea la fila de cuenta, el
 *  guard de validación y lo que se guarda — mismo criterio que registro.js#partnerPaid. */
const partnerPaid = (d) => d.type === "expense" && d.isShared && d.paidBy === "partner";

// TIPO_KEY guarda claves, no texto resuelto: es una const de módulo evaluada al importar el
// fichero (antes de que boot() llame a initI18n con el idioma real) — ver mismo comentario en
// registro.js#TIPOS/SAVE_KEY.
const TIPO_KEY = {
  expense: "common.type.expense", income: "common.type.income", transfer: "movimientos.type.transfer",
  refund: "common.type.refund", adjustment: "common.type.adjustment",
};

const MINUS = "−"; // «−» tipográfico, el mismo ancho que «+» en la mono tabular (entity.js).

/** Cifra del Display en px (B-Movimiento-Detalle y B-Borrar): la misma en vista y en edición, para
 *  que entrar a editar no la haga saltar de tamaño. */
const DISP_PX = 48;

/** Ancho del input del importe en el Display de edición: tantos caracteres como lleva (mismo
 *  criterio que registro.js#amountWidth), para que el símbolo de moneda vaya pegado. */
const amountWidth = (raw) => `${Math.max(1, String(raw ?? "").length)}ch`;

/** Pinta el detalle del movimiento `txId` en `container`.
 *
 *  Quién lo abre decide el historial: la lista de Movimientos apunta su entrada de «atrás» en
 *  `onOpen` (justo antes del primer pintado, solo si el movimiento existe); open-tx.js (Inicio,
 *  Semana) la apunta antes de llamar. Aquí dentro, «Atrás», Guardar y Borrar terminan siempre en
 *  goBack(), que deshace esa entrada.
 *  `onChanged`: se espera ANTES de goBack() tras guardar o borrar (la lista recarga su periodo ahí,
 *  para que al volver ya pinte los datos nuevos).
 *
 *  @returns {Promise<(() => void)|null>} null si el movimiento ya no existe (borrado en otra
 *  pestaña); si no, `dispose`, que revoca la URL de la foto: quien abre lo llama al volver.
 *  Lanza si falla la carga: quien abre decide cómo avisarlo. */
export async function renderMovimientoDetalle(container, txId, { onOpen = () => {}, onChanged = async () => {} } = {}) {
  const [periods, expenseCats, incomeCats, accountsAll, byId, meta, tagsLoaded, tagTotalsAll, row] = await Promise.all([
    listPeriods(), listExpenseLeafCategories(), listIncomeCategories(), listAccounts(), allCategoriesById(),
    getMetaAll(), listTags(), tagTotals(), getTransaction(txId),
  ]);
  if (!row) return null;
  let tagsAll = tagsLoaded;
  const partnerName = (meta.partner_name || "").trim();
  const partnerLabel = partnerName || t("movimientos.shared.fallbackName");
  const state = { detailId: txId, detail: null, linkedExpense: null, tagTotalsAll };
  let errorMsg = "";
  // Foto del ticket (N5, spec §9.8): la URL del Blob leído al abrir (state.detail.photoBlob). Se
  // crea UNA vez y se revoca al salir del detalle (dispose): el Blob no cambia durante la sesión,
  // así que los repintados (innerHTML en cada cambio de estado) reutilizan la misma URL.
  let detailPhotoUrl = null;
  // Visor de foto a pantalla completa (§9, D-impl-4): <dialog> colgado de <body>, no de
  // `container` —los repintados con innerHTML se lo llevarían—. `closeViewer` lo cierra sin tocar
  // el historial (lo llama la entrada de «atrás» que apunta al abrirse).
  let viewer = null;
  let closeViewer = null;

  // Familia de cada cuenta (C8, PR-10): la muestra de 10 de las filas de cuenta y de sus chips. Los
  // objetivos solo deciden la familia por defecto de una hucha; si fallan, cae al tipo de cuenta.
  let goals = [];
  try { goals = await listGoals(); } catch { goals = []; }
  const accountStyle = parseAccountStyle(meta.account_style);
  const accountFam = (a) => (a ? familyForAccount(a, accountStyle, goals) : null);

  const id = txId;
  state.detail = {
    type: row.type,
    raw: centsToRaw(row.amount_cents),
    cents: Math.abs(row.amount_cents),
    sign: row.amount_cents < 0 ? "-" : "+",
    categoryId: row.category_id || null,
    accountId: row.account_id,
    counterAccountId: row.counter_account_id,
    isShared: !!row.is_shared,
    paidBy: row.paid_by,
    // Fija en apertura si el movimiento YA era compartido, distinto del isShared vivo que cambia
    // con el interruptor: gatea la visibilidad de la fila «Compartido» para que no desaparezca al
    // desmarcar sin contraparte configurada, dejando al usuario sin forma de volver a marcarlo.
    wasShared: !!row.is_shared,
    // El override manda; si no hay (null), el % del periodo del propio gasto (no el abierto).
    sharePct: normalizePct(row.share_pct_override ?? periods.find((p) => p.id === row.period_id)?.my_share_pct, 100),
    fecha: row.date,
    merchant: row.merchant ?? "",
    note: row.note ?? "",
    refId: row.ref_id,
    ruleId: row.rule_id,
    tagId: row.tag_id || null,
    // Solo UI, nunca se mandan al guardar:
    editing: false,
    accPicker: null,      // "from" | "to" | null: lista de cuentas desplegada bajo su fila
    tagPickerOpen: false, // lista de etiquetas desplegada bajo su fila
    newTagDraft: null,    // != null mientras se escribe el nombre de una etiqueta nueva
    // Foto del ticket (N5): photoBlob se lee AQUÍ (render no puede esperar a OPFS).
    // has_attachment=1 sin fichero (hoja .xlsx restaurada, o un fallo del paso 3 de §9.4) se trata
    // como "sin foto" — null, sin banner ni error (spec §9.2/§13.11): el FICHERO es la verdad, la
    // columna solo evita sondear OPFS en la lista.
    photoBlob: null,
  };
  if (row.has_attachment && attachments) {
    try { state.detail.photoBlob = await attachments.blob(id); } catch { state.detail.photoBlob = null; }
  }
  if (state.detail.photoBlob) detailPhotoUrl = URL.createObjectURL(state.detail.photoBlob);
  // El apunte de liquidación tiene DOS formas desde Task 3: la devolución ENTRANTE (refund) y el
  // ajuste SALIENTE (adjustment con ref_id, el que se crea cuando pagó ella). Los dos apuntan a un
  // gasto por ref_id y los dos los cubre settlementAmountLocked en repo.js.
  if ((row.type === "refund" || row.type === "adjustment") && row.ref_id) {
    try { state.linkedExpense = await getTransaction(row.ref_id); } catch { state.linkedExpense = null; }
  }
  // Task 17 ronda 2 (controller ruling, finding A): un gasto ya liquidado con la contraparte (settled=1
  // Y con un refund activo enlazado) bloquea importe/compartido — editar el importe aquí sin
  // tocar el refund deja la deuda con la contraparte mal calculada y sin nada pendiente que lo delate.
  state.detail.settledLocked = row.type === "expense" && !!row.settled
    && (await hasActiveLinkedSettlement(id).catch(() => false));
  // Task 7 (5d): espejo en UI del guard settlementAmountLocked (repo.js) — el lado del REFUND. Si el
  // gasto enlazado ya está settled, bajar aquí el importe del refund descuadra la deuda liquidada
  // en silencio (el guard de repo lo rechazaría en save, pero mejor prevenirlo en el input).
  state.detail.refundLocked = (row.type === "refund" || row.type === "adjustment") && !!state.linkedExpense?.settled;

  // Copia de lo editable al entrar en edición: «Cancelar» la restaura tal cual.
  const EDITABLE = ["raw", "cents", "sign", "categoryId", "accountId", "counterAccountId", "isShared",
    "paidBy", "sharePct", "fecha", "merchant", "note", "tagId"];
  let snapshot = null;

  function categoriesFor(tipo) {
    if (tipo === "income") return incomeCats;
    if (needsCategory(tipo)) return expenseCats;
    return [];
  }

  /** Familia de una categoría para ESTE movimiento: los ingresos no llevan familia (C9). */
  const catFam = (catId) => (state.detail.type === "income" ? null : familyForCategory(catId, byId));

  /** Nombre de una etiqueta por id, resuelto contra tagTotalsAll (D7: TODAS las vivas, archivadas
   *  incluidas) y no contra `tagsAll` (solo activas, listTags — selector de alta): un movimiento
   *  guardado puede llevar una etiqueta archivada después, y su nombre tiene que seguir resolviendo. */
  function tagName(tagId) {
    return state.tagTotalsAll.find((tg) => tg.id === tagId)?.name ?? "";
  }

  /** Opciones del selector de etiqueta: las activas (`tagsAll`, mismo criterio que Registro) más
   *  la asignada actualmente si es una archivada que ya no está en `tagsAll` — así no desaparece
   *  de golpe del selector al abrirlo (mismo criterio que etiquetas.js). */
  function tagOptions() {
    const currentId = state.detail?.tagId;
    if (!currentId || tagsAll.some((tg) => tg.id === currentId)) return tagsAll;
    const current = state.tagTotalsAll.find((tg) => tg.id === currentId);
    return current ? [...tagsAll, current] : tagsAll;
  }

  /** «Comercio» del Display y de la vista previa de Borrar: el comercio, o la categoría, o el tipo. */
  function titleOf(d) {
    return d.merchant.trim() || (d.categoryId ? byId[d.categoryId]?.name : "") || t(TIPO_KEY[d.type]);
  }

  /** Cifra con signo (B-Movimiento-Detalle): «−» gasto, «+» ingreso y devolución, el signo propio
   *  del ajuste y sin signo la transferencia (va de una cuenta mía a otra). */
  function signedAmount(d) {
    const abs = fmtMoney(d.cents);
    if (d.type === "expense") return MINUS + abs;
    if (d.type === "income" || d.type === "refund") return "+" + abs;
    if (d.type === "adjustment") return (d.sign === "-" ? MINUS : "+") + abs;
    return abs;
  }

  /** «Restauración › Bares y cafés»: la raíz y la hoja, o solo la raíz (fila de movimiento). */
  function categoryPath(catId) {
    const cat = catId ? byId[catId] : null;
    if (!cat) return "";
    const root = rootOf(catId, byId);
    return root && root !== catId && byId[root] ? `${byId[root].name} › ${cat.name}` : cat.name;
  }

  const weekdayShort = (iso) => t(`movimientos.weekdayShort.${new Date(iso + "T12:00:00").getDay()}`);
  /** Fecha de la fila: «Hoy, 13 sep», «Ayer, 12 sep» o «vie 11 sep». */
  function dateLabel(iso) {
    const hoy = hoyISO();
    if (iso === hoy) return t("movimientos.detail.dateToday", { date: fmtDiaCorto(iso) });
    if (iso === prevDayIso(hoy)) return t("movimientos.detail.dateYesterday", { date: fmtDiaCorto(iso) });
    return `${weekdayShort(iso)} ${fmtDiaCorto(iso)}`;
  }

  function validationError() {
    const d = state.detail;
    // Desmarcar «Compartido» en una fila que pagó la contraparte (guardada con account_id='')
    // devuelve la cuenta al juego y hay que exigirla — si no, el save escribiría un gasto mío sin
    // cuenta.
    if (d.type === "expense" && !partnerPaid(d) && !d.accountId) return t("common.needAccount");
    if (d.type === "transfer") {
      if (d.cents <= 0) return t("common.enterAmount");
      if (!d.counterAccountId || d.counterAccountId === d.accountId) return t("common.pickTwoAccounts");
      return "";
    }
    if (d.type === "adjustment") return d.cents <= 0 ? t("common.enterAmount") : "";
    if (d.cents <= 0 && !d.categoryId) return t("common.enterAmountAndCategory");
    if (d.cents <= 0) return t("common.enterAmount");
    if (!d.categoryId) return t("common.pickCategory");
    return "";
  }

  // ---- Display -------------------------------------------------------------------------------

  /** Vista: Display con el comercio arriba (15/600 en --disp-ink, `labelStrong`) y la cifra con
   *  signo a 48, como en B-Movimiento-Detalle. */
  function displayViewHtml(d) {
    return `<div class="mdet-disp-view">${displayHtml({ label: titleOf(d), value: signedAmount(d), size: DISP_PX, labelStrong: true })}</div>`;
  }

  /** Edición: el comercio y el importe son los campos (patrón de B-Gasto, registro.js). El importe
   *  es la única cifra .disp-value (K4); el signo del ajuste, un botón de 44 a su izquierda. */
  function displayEditHtml(d, amountLocked) {
    const sign = d.type === "adjustment"
      ? `<button type="button" class="mdet-sign" id="mdet-sign" aria-label="${escAttr(t("common.changeSign"))}"${amountLocked ? " disabled" : ""}>${d.sign === "-" ? MINUS : "+"}</button>`
      : "";
    return `<section class="disp mdet-disp" id="mdet-disp-edit" tabindex="-1">
      <input type="text" id="mdet-merchant" class="mdet-merchant-input" value="${escAttr(d.merchant)}"
        placeholder="${escAttr(t("common.merchant"))}" aria-label="${escAttr(t("common.merchant"))}" autocomplete="off">
      <div class="num disp-value disp-value-free mdet-amount${amountLocked ? " is-locked" : ""}" style="--disp-fs:${DISP_PX}px">
        ${sign}
        <input type="text" inputmode="decimal" id="mdet-raw" class="mdet-amount-input" value="${escAttr(d.raw)}" placeholder="0" autocomplete="off"
          aria-label="${escAttr(t("common.amount"))}"${amountLocked ? " disabled" : ""} style="width:${amountWidth(d.raw)}">
        <span class="mdet-amount-cur" aria-hidden="true">${escHtml(currencySymbol())}</span>
      </div>
    </section>`;
  }

  // ---- Categoría -----------------------------------------------------------------------------

  /** Tarjeta de categoría elegida (variante «detail», B-Movimiento-Detalle): su raíz arriba en -x y,
   *  debajo, el nombre de la hoja a 17/700, con borde de su familia. Sin categoría,
   *  neutra con «Sin categorizar». Siempre es un botón: en la vista entra en edición y abre la hoja. */
  function chosenHtml(d) {
    const c = d.categoryId ? byId[d.categoryId] : null;
    if (!c) {
      return chosenCategoryHtml({ fam: null, icon: "otr", name: t("movimientos.uncategorized"), id: "mdet-cat" });
    }
    const root = rootOf(c.id, byId);
    const path = root && root !== c.id ? (byId[root]?.name ?? "") : "";
    return chosenCategoryHtml({ fam: catFam(c.id), icon: iconForCategory(c.id, byId), name: c.name, path, id: "mdet-cat", variant: "detail" });
  }

  // ---- Filas de ajuste -----------------------------------------------------------------------

  const DIVIDER = '<div class="mdet-div" aria-hidden="true"></div>';

  function accountRowHtml(which, d) {
    const accId = which === "to" ? d.counterAccountId : d.accountId;
    const acc = accountsAll.find((a) => a.id === accId);
    let label = t("common.account");
    if (d.type === "transfer") label = which === "to" ? t("common.to") : t("common.from");
    else if (d.type === "refund") label = t("common.destAccount");
    const open = d.editing && d.accPicker === which;
    const rowHtml = settingRowHtml({
      label, value: acc?.name ?? "", valueFam: accountFam(acc), id: `mdet-acc-${which}`,
      data: { accRow: which },
      ...(d.editing ? { expanded: open, controls: `mdet-acc-${which}-panel` } : {}),
    });
    if (!open) return rowHtml;
    // «Desde»/«Cuenta»: solo cuentas mías con saldo (sin pasivos). «Hacia» de una transferencia sí
    // admite pasivos (pagar la tarjeta), menos la cuenta de origen.
    const list = which === "to"
      ? accountsAll.filter((a) => a.id !== d.accountId)
      : accountsAll.filter((a) => a.type !== "liability");
    const chips = list.map((a) => filterChipHtml({
      fam: accountFam(a), label: a.name, selected: accId === a.id, data: which === "to" ? { counterAcc: a.id } : { acc: a.id },
    })).join("");
    return `${rowHtml}<div class="mdet-panel" id="mdet-acc-${which}-panel" role="group" aria-label="${escAttr(label)}">${chips}</div>`;
  }

  /** Fecha. En la vista, fila botón; en edición, la misma anatomía con el <input type=date> nativo
   *  transparente encima (un input no puede ir dentro de un botón): tocar la fila abre el selector
   *  del sistema. El foco se pinta en la fila (:focus-within, screens.css). */
  function dateRowHtml(d) {
    if (!d.editing) return settingRowHtml({ label: t("common.date"), value: dateLabel(d.fecha), id: "mdet-date-row" });
    return `<label class="ent-set mdet-date">
      <span class="ent-set-body"><span class="ent-set-label">${escHtml(t("common.date"))}</span></span>
      <span class="ent-set-value">${escHtml(dateLabel(d.fecha))}</span>
      <span class="ent-chev">${icon("chevronRight", { size: 16 })}</span>
      <input type="date" id="mdet-fecha" class="mdet-date-input" value="${escAttr(d.fecha)}" aria-label="${escAttr(t("common.date"))}">
    </label>`;
  }

  /** ¿Se ofrece «Compartido con …»? Mismo criterio de siempre: tipos con categoría salvo ingreso, y
   *  solo si ya era compartido o hay contraparte configurada. */
  const sharedOffered = (d) => needsCategory(d.type) && d.type !== "income" && (d.wasShared || partnerName);

  function sharedRowHtml(d) {
    let sub = "";
    if (!d.editing && d.isShared) {
      const { mine } = splitCents(d.cents, d.sharePct);
      sub = partnerPaid(d)
        ? t("movimientos.detail.sharedPartnerPaid", { name: partnerLabel, amount: fmtMoney(mine) })
        : t("movimientos.detail.sharedMine", { amount: fmtMoney(mine), pct: d.sharePct });
    }
    const label = t("common.sharedWith", { name: partnerLabel });
    return settingRowHtml({
      label, sub, id: "mdet-shared-row",
      controlHtml: switchHtml({ id: "mdet-shared", checked: d.isShared, label }),
    });
  }

  function tagRowHtml(d) {
    const label = t("movimientos.detail.tagLabel");
    const open = d.editing && d.tagPickerOpen;
    const rowHtml = settingRowHtml({
      label, value: d.tagId ? tagName(d.tagId) : t("movimientos.detail.noTag"), valueIcon: d.tagId ? "tag" : "", id: "mdet-tag",
      ...(d.editing ? { expanded: open, controls: "mdet-tag-panel" } : {}),
    });
    if (!open) return rowHtml;
    const draft = d.newTagDraft == null
      ? filterChipHtml({ label: t("movimientos.detail.newTag"), id: "mdet-tag-new" })
      : `<span class="mdet-newtag">
          <span class="ctl-field mdet-newtag-field"><input type="text" class="ctl-field-input" id="mdet-tag-new-input" value="${escAttr(d.newTagDraft)}" placeholder="${escAttr(t("etiquetas.form.namePlaceholder"))}" aria-label="${escAttr(t("movimientos.detail.newTag"))}"></span>
          <button type="button" id="mdet-tag-new-save" class="icon-btn" aria-label="${escAttr(t("common.save"))}">${icon("check", { size: 18 })}</button>
        </span>`;
    return `${rowHtml}<div class="mdet-panel" id="mdet-tag-panel" role="group" aria-label="${escAttr(label)}">
      ${filterChipHtml({ label: t("movimientos.detail.noTag"), selected: !d.tagId, check: true, data: { tagPick: "" } })}
      ${tagOptions().map((tg) => filterChipHtml({ tag: true, label: tg.name, selected: d.tagId === tg.id, data: { tagPick: tg.id } })).join("")}
      ${draft}
    </div>`;
  }

  function rowsHtml(d) {
    const rows = [];
    if (!partnerPaid(d)) {
      rows.push(accountRowHtml("from", d));
      if (d.type === "transfer") rows.push(accountRowHtml("to", d));
    }
    rows.push(dateRowHtml(d));
    if (sharedOffered(d)) rows.push(sharedRowHtml(d));
    rows.push(tagRowHtml(d));
    return `<div class="mdet-group">${rows.join(DIVIDER)}</div>`;
  }

  /** Reparto (edición, con «Compartido» encendido): quién pagó (solo gasto), el paso a paso del %
   *  y las dos partes. Mismo bloque que B-Gasto (registro.js#sharedDetailHtml). */
  function sharedDetailHtml(d, locked) {
    if (!d.editing || !sharedOffered(d) || !d.isShared) return "";
    const { mine: myCents, partner: partnerCents } = splitCents(d.cents, d.sharePct);
    const partnerSeg = partnerName || t("movimientos.shared.fallbackLabel");
    return `
    <div class="mdet-block${locked ? " is-locked" : ""}">
      ${d.type === "expense" ? `
      <div class="mdet-block-sec">
        <span class="mdet-block-label" id="mdet-paidby-label">${escHtml(t("common.paidBy.label"))}</span>
        ${segmentedHtml({ id: "mdet-paidby", name: t("common.paidBy.label"), labelledBy: "mdet-paidby-label", value: d.paidBy,
          options: [{ value: "me", label: t("common.paidBy.me") }, { value: "partner", label: t("common.paidBy.partner", { name: partnerLabel }) }] })}
      </div>` : ""}
      <div class="mdet-split-row">
        <div class="mdet-split-text">
          <span class="mdet-block-title">${escHtml(t("common.split.label"))}</span>
          <span class="mdet-block-hint">${escHtml(t("common.split.hint", { name: partnerLabel, pct: 100 - d.sharePct }))}</span>
        </div>
        ${stepperHtml({ value: `${d.sharePct} %`, decId: "mdet-pct-down", incId: "mdet-pct-up", decLabel: t("common.split.decreaseAria"), incLabel: t("common.split.increaseAria") })}
      </div>
      <div class="mdet-split">
        <div class="mdet-split-cell">
          ${metaHtml([t("common.myShare"), t("common.pctValue", { pct: d.sharePct })], { cls: "mdet-split-label" })}
          <span class="num mdet-split-value" id="mdet-split-mine">${escHtml(fmtMoney(myCents))}</span>
        </div>
        <div class="mdet-split-cell">
          ${partnerPaid(d)
            ? metaHtml([t("common.paidByName", { name: partnerSeg }), t("common.paidTotal")], { cls: "mdet-split-label" })
            : metaHtml([partnerSeg, t("common.pctValue", { pct: 100 - d.sharePct })], { cls: "mdet-split-label" })}
          <span class="num mdet-split-value" id="mdet-split-partner">${escHtml(fmtMoney(partnerPaid(d) ? d.cents : partnerCents))}</span>
        </div>
      </div>
    </div>`;
  }

  // ---- Nota y foto ---------------------------------------------------------------------------

  /** Tarjeta de nota con la foto del ticket (B-Movimiento-Detalle): la miniatura (la foto real,
   *  en un pozo de 60×76) abre el visor. En la vista, la nota en texto; en edición, su campo
   *  hundido. En la vista, sin nota ni foto no se pinta. */
  function noteCardHtml(d) {
    const photo = detailPhotoUrl
      ? `<button type="button" class="mdet-photo" id="mdet-photo" aria-label="${escAttr(t("registro.photo.viewAria"))}">
          <img class="mdet-photo-img" src="${escAttr(detailPhotoUrl)}" alt="">
        </button>`
      : "";
    if (d.editing) {
      return `<div class="mdet-notecard">${photo}<div class="mdet-note-field">${fieldHtml({ id: "mdet-note", label: t("common.note"), value: d.note, placeholder: t("common.optional") })}</div></div>`;
    }
    const note = d.note.trim();
    if (!photo && !note) return "";
    return `<div class="mdet-notecard">${photo}
      ${note ? `<div class="mdet-note-body"><span class="mdet-note-label">${escHtml(t("common.note"))}</span><span class="mdet-note-text">${escHtml(note)}</span></div>` : ""}
    </div>`;
  }

  /** Devolución enlazada: a qué gasto devuelve (bloque neutro, en los dos estados). */
  function linkedHtml(d) {
    if (d.type !== "refund" || !state.linkedExpense) return "";
    const le = state.linkedExpense;
    return `<div class="mdet-linked">
      <span class="mdet-linked-label">${escHtml(t("common.linkedTo"))}</span>
      ${metaHtml([le.merchant || byId[le.category_id]?.name || t("common.type.expense"), fmtMoney(le.amount_cents)], { cls: "mdet-linked-meta" })}
    </div>`;
  }

  // ---- Pintado -------------------------------------------------------------------------------

  function render(focusSel = "") {
    const d = state.detail;
    const locked = !!d.settledLocked;
    // Task 7 (5d): además de `locked` (lado del gasto), el importe del apunte de liquidación
    // (refund entrante o adjustment saliente) se bloquea si su gasto enlazado ya está settled.
    const amountLocked = locked || !!d.refundLocked;
    const cats = categoriesFor(d.type);

    const actions = d.editing
      ? `${errorMsg ? `<div class="mdet-error" role="alert">${icon("warn", { size: 18 })}<span>${escHtml(errorMsg)}</span></div>` : ""}
        <div class="mdet-actions-edit">
          ${buttonHtml({ kind: "primary", id: "mdet-save", label: t("common.saveChanges") })}
          ${buttonHtml({ kind: "tertiary", id: "mdet-cancel", label: t("common.cancel") })}
        </div>`
      : `${errorMsg ? `<div class="mdet-error" role="alert">${icon("warn", { size: 18 })}<span>${escHtml(errorMsg)}</span></div>` : ""}
        <div class="mdet-actions">
          ${buttonHtml({ kind: "primary", id: "mdet-edit", label: t("movimientos.detail.edit"), icon: "pencil" })}
          <div class="mdet-actions-row">
            ${buttonHtml({ kind: "secondary", id: "mdet-duplicate", label: t("movimientos.detail.duplicate"), icon: "duplicate" })}
            ${buttonHtml({ kind: "danger-entry", id: "mdet-delete", label: t("movimientos.delete.button"), icon: "trash" })}
          </div>
        </div>`;

    container.innerHTML = `
    <div class="mdet${d.editing ? " is-editing" : ""}">
      ${subHeaderHtml({ id: "mdet-back", title: t(TIPO_KEY[d.type]), center: true })}
      ${d.editing && locked ? `<p class="mdet-locked" role="note">${icon("lock", { size: 18 })}<span>${escHtml(t("movimientos.detail.lockedNote"))}</span></p>` : ""}
      ${d.editing ? displayEditHtml(d, amountLocked) : displayViewHtml(d)}
      ${linkedHtml(d)}
      ${cats.length ? chosenHtml(d) : ""}
      ${rowsHtml(d)}
      ${sharedDetailHtml(d, locked)}
      ${noteCardHtml(d)}
      <div class="mdet-foot">${actions}</div>
    </div>`;

    wire(locked);
    if (focusSel) container.querySelector(focusSel)?.focus();
  }

  function update(patch, focusSel = "") {
    Object.assign(state.detail, patch);
    render(focusSel);
  }

  /** Entra en edición (desde «Editar» o tocando una fila de la vista) con `patch` aplicado —p. ej.
   *  la lista de cuentas ya desplegada— y el foco en `focusSel`. Por defecto el foco va al Display
   *  de edición (no a un campo: en el móvil abriría el teclado sin pedirlo). */
  function enterEdit(patch = {}, focusSel = "#mdet-disp-edit") {
    const d = state.detail;
    if (!d.editing) snapshot = Object.fromEntries(EDITABLE.map((k) => [k, d[k]]));
    errorMsg = "";
    update({ editing: true, accPicker: null, tagPickerOpen: false, newTagDraft: null, ...patch }, focusSel);
  }

  function cancelEdit() {
    errorMsg = "";
    update({ ...(snapshot ?? {}), editing: false, accPicker: null, tagPickerOpen: false, newTagDraft: null }, "#mdet-edit");
    snapshot = null;
  }

  // ---- Hoja de categoría ---------------------------------------------------------------------

  /** Categoría en una hoja inferior (sustituye a la rejilla de 30 fichas, auditoría §33): las
   *  hojas agrupadas por su raíz, como chips de filtro con su familia; las raíces sin hijas van
   *  juntas arriba, sin encabezado. Elegir cierra la hoja; el repintado espera a su `close` (la
   *  página es inerte mientras está abierta) y devuelve el foco a la tarjeta. */
  function openCategorySheet() {
    const d = state.detail;
    const order = [];
    const byRoot = new Map();
    for (const c of categoriesFor(d.type)) {
      const root = rootOf(c.id, byId) || c.id;
      if (!byRoot.has(root)) { byRoot.set(root, []); order.push(root); }
      byRoot.get(root).push(c);
    }
    const chip = (c) => filterChipHtml({ fam: catFam(c.id), label: c.name, selected: d.categoryId === c.id, check: true, data: { pickCat: c.id } });
    const direct = [];
    const groups = [];
    for (const root of order) {
      const items = byRoot.get(root);
      if (items.length === 1 && items[0].id === root) direct.push(items[0]);
      else groups.push({ name: byId[root]?.name ?? items[0].name, items });
    }
    const body = `
      ${direct.length ? `<div class="mdet-sheet-chips">${direct.map(chip).join("")}</div>` : ""}
      ${groups.map((g) => `<div class="mdet-sheet-group">
        ${sectionHeaderHtml({ title: g.name, level: "group", tag: "h3" })}
        <div class="mdet-sheet-chips">${g.items.map(chip).join("")}</div>
      </div>`).join("")}`;
    const dlg = showSheet({ title: t("common.category"), body });
    if (!dlg) return;
    let picked = null;
    dlg.querySelectorAll("[data-pick-cat]").forEach((b) => {
      b.onclick = () => { picked = b.dataset.pickCat; goBack(); };
    });
    dlg.addEventListener("close", () => {
      // Sin elegir, nada que repintar: la hoja ya devuelve el foco a la tarjeta. Y si un salto de
      // varias entradas de «atrás» ya pintó otra pantalla en `container`, no se pisa.
      if (!picked || !container.querySelector(".mdet")) return;
      state.detail.categoryId = picked;
      errorMsg = "";
      render("#mdet-cat");
    });
  }

  // ---- Visor de foto -------------------------------------------------------------------------

  /** Visor a pantalla completa (§9, D-impl-4): <dialog> modal sobre --disp, la foto contenida y
   *  cerrar de 44 en --disp-ink arriba a la derecha. Apunta una entrada de «atrás» (sin cambio de
   *  pantalla ni de chrome, como el aviso) para que el gesto del sistema lo cierre a él y no al
   *  detalle; cerrar, Escape y tocar la foto hacen goBack(), que deshace esa entrada. */
  function openViewer() {
    if (viewer || !detailPhotoUrl) return;
    const dlg = document.createElement("dialog");
    dlg.className = "mdet-viewer";
    dlg.setAttribute("aria-label", t("registro.photo.viewAria"));
    dlg.innerHTML = `
      <button type="button" class="mdet-viewer-close" id="mdet-viewer-close" aria-label="${escAttr(t("movimientos.detail.photoClose"))}">${icon("close", { size: 24 })}</button>
      <img class="mdet-viewer-img" src="${escAttr(detailPhotoUrl)}" alt="">`;
    viewer = dlg;
    let closed = false;
    let pushed = false;
    let myDepth = null;
    const onPopstate = (e) => {
      // Salto de varias entradas de golpe: back.js solo llama al callback de la más baja, que no
      // es la nuestra. Si el historial ya está por debajo de nuestra profundidad, se cierra solo.
      if (myDepth !== null && (e.state?.bc ?? -1) < myDepth) closeViewer?.();
    };
    closeViewer = () => {
      if (closed) return;
      closed = true;
      window.removeEventListener("popstate", onPopstate);
      if (dlg.open) dlg.close();
      dlg.remove();
      viewer = null;
      closeViewer = null;
      container.querySelector("#mdet-photo")?.focus();
    };
    // Un solo goBack() por visor: un doble toque antes del popstate deshacería también la entrada
    // del detalle y sacaría de la pantalla.
    let requested = false;
    const requestClose = () => {
      if (requested) return;
      requested = true;
      if (pushed) goBack(); else closeViewer?.();
    };
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); requestClose(); });
    dlg.addEventListener("click", () => requestClose());
    document.body.appendChild(dlg);
    dlg.showModal();
    try {
      pushBack(() => closeViewer?.(), { scroll: false, chrome: false });
      pushed = true;
      myDepth = window.history.state?.bc ?? null;
      window.addEventListener("popstate", onPopstate);
    } catch { /* sin entrada de historial: cerrar no toca el historial */ }
    dlg.querySelector("#mdet-viewer-close").focus();
  }

  // ---- Duplicar (B-5) -------------------------------------------------------------------------

  /** Recarga los datos del periodo detrás (Movimientos) o Inicio/Semana (open-tx.js: no hace
   *  nada). No pinta nada — es la MISMA función que `save()`/`confirmDelete()` pasan a
   *  `writeThenRefresh`; aquí se llama a mano porque el guardado real ocurre dentro de Registro,
   *  fuera de este cierre, y un fallo se avisa igual que allí (con un toast) sin cortar la
   *  navegación. */
  async function refreshBehind() {
    try { await onChanged(); } catch (e) { showToast(t("movimientos.error.loadPeriod", { error: userMessage(e) })); }
  }

  /** «Duplicar» (B-5, decisiones.md 2026-09-27): abre Crear gasto (registro.js) prellenado con la
   *  fila —tipo, importe, comercio, categoría, cuenta, etiqueta, reparto y nota—, fecha de hoy y
   *  sin foto (buildDuplicatePrefill, duplicate-prefill.js). Nada se escribe hasta que el usuario
   *  guarda AHÍ: esta pantalla no toca la BD. Se apunta una entrada de «atrás» que vuelve a ESTE
   *  detalle (no se vuelve a llamar a renderMovimientoDetalle: repetiría onOpen y abriría una
   *  segunda URL de la foto que nadie revocaría); cerrar Registro, guardar o el gesto del sistema
   *  llaman todos a goBack(), que la deshace. */
  function openDuplicate() {
    const prefill = buildDuplicatePrefill(row, periods.find((p) => p.id === row.period_id)?.my_share_pct);
    pushBack(() => render("#mdet-duplicate"));
    renderRegistro(
      container,
      async () => { await refreshBehind(); goBack(); },
      prefill,
      async () => { await refreshBehind(); render("#mdet-duplicate"); },
    );
  }

  // ---- Borrar --------------------------------------------------------------------------------

  /** Vista previa de la fila en el pozo del aviso (B-Borrar): baldosa, comercio, ruta de la
   *  categoría, cifra con signo y día. HTML de confianza para modal.js: todo va escapado aquí. */
  function deletePreviewHtml(d) {
    const fam = needsCategory(d.type) ? catFam(d.categoryId) : null;
    let key = d.categoryId ? iconForCategory(d.categoryId, byId) : "";
    if (!key) key = d.type === "income" ? "income" : d.type === "transfer" ? "transfer" : "otr";
    const line2 = categoryPath(d.categoryId);
    const fc = fam ? ` fam-${fam}` : "";
    return `${tileHtml({ fam, icon: key })}
      <span class="mdet-prev-body">
        <span class="mdet-prev-name">${escHtml(titleOf(d))}</span>
        ${line2 ? `<span class="mdet-prev-line2${fc}">${escHtml(line2)}</span>` : ""}
      </span>
      <span class="mdet-prev-side">
        <span class="num mdet-prev-amount${signedAmount(d).startsWith("+") ? " is-pos" : ""}">${escHtml(signedAmount(d))}</span>
        <span class="mdet-prev-date">${escHtml(`${weekdayShort(d.fecha)} ${fmtDiaCorto(d.fecha)}`)}</span>
      </span>`;
  }

  function confirmDelete() {
    const d = state.detail;
    showConfirm({
      title: t("movimientos.delete.title"),
      message: t("movimientos.delete.body"),
      preview: deletePreviewHtml(d),
      destructive: true,
      confirmIcon: "trash",
      cancelText: t("common.cancel"),
      confirmText: t("common.delete"),
      onConfirm: async () => {
        // El aviso ya se ha desmontado; el botón sigue vivo detrás hasta que goBack() cierre el
        // detalle, así que se deshabilita para que un segundo toque no abra otro aviso.
        const btn = container.querySelector("#mdet-delete");
        if (btn) btn.disabled = true;
        const res = await writeThenRefresh(() => softDeleteTransaction(state.detailId), onChanged);
        if (!res.written) {
          if (btn) btn.disabled = false;
          // Incluye el guard de repo.js (expenseDeleteLocked): un gasto con su devolución de
          // liquidación activa no se borra; el motivo llega en el mensaje del error.
          errorMsg = t("movimientos.error.delete", { error: userMessage(res.error) });
          render("#mdet-delete");
          return;
        }
        afterWrite(res);
      },
    });
  }

  // ---- Guardar -------------------------------------------------------------------------------

  async function save() {
    const d = state.detail;
    const btn = container.querySelector("#mdet-save");
    const msg = validationError();
    if (msg) {
      errorMsg = msg;
      render();
      const again = container.querySelector("#mdet-save");
      again.classList.add("shake");
      setTimeout(() => again.classList.remove("shake"), 400);
      return;
    }
    btn.disabled = true;
    const withCategory = needsCategory(d.type);
    const res = await writeThenRefresh(() => updateTransaction(state.detailId, {
      type: d.type,
      amountCents: d.type === "adjustment" && d.sign === "-" ? -d.cents : d.cents,
      date: d.fecha,
      categoryId: withCategory ? d.categoryId : "",
      // Un gasto que pagó la contraparte no toca ninguna cuenta mía hasta liquidar (el repo
      // además lo blanquea por su cuenta, pero el payload no debe contradecirlo).
      accountId: partnerPaid(d) ? "" : d.accountId,
      counterAccountId: d.type === "transfer" ? d.counterAccountId : "",
      merchant: d.merchant,
      note: d.note,
      isShared: withCategory && d.type !== "income" ? d.isShared : false,
      // Locked (gasto liquidado con apunte enlazado): se deja undefined para que updateTransaction
      // conserve el valor guardado — si mandáramos d.sharePct explícito, un gasto antiguo con override
      // NULL dispararía sharedFieldsLocked al editar solo la nota o la fecha.
      sharePctOverride: d.settledLocked ? undefined : (withCategory && d.type !== "income" && d.isShared ? d.sharePct : null),
      // Mismo motivo que sharePctOverride: undefined conserva el paid_by guardado. Desmarcar
      // «Compartido» cae a "me" — el guard del repo rechazaría un 'partner' sin is_shared.
      paidBy: d.settledLocked ? undefined : (withCategory && d.type === "expense" && d.isShared ? d.paidBy : "me"),
      refId: d.refId,
      ruleId: d.ruleId,
      tagId: d.tagId || "",
    }), onChanged);
    if (!res.written) {
      btn.disabled = false;
      errorMsg = t("common.saveFailed", { error: userMessage(res.error) });
      render();
      return;
    }
    afterWrite(res);
  }

  /** Tras guardar o borrar con éxito se vuelve SIEMPRE: si falló la recarga de la lista (onChanged),
   *  el cambio ya está hecho y se avisa con un toast, no con «no se pudo guardar». */
  function afterWrite(res) {
    if (res.error) showToast(t("movimientos.error.loadPeriod", { error: userMessage(res.error) }));
    goBack();
  }

  async function submitNewTag() {
    const d = state.detail;
    const btn = container.querySelector("#mdet-tag-new-save");
    if (btn) btn.disabled = true;
    try {
      const newId = await createTag({ name: d.newTagDraft });
      [tagsAll, state.tagTotalsAll] = await Promise.all([listTags(), tagTotals()]);
      update({ tagId: newId, tagPickerOpen: false, newTagDraft: null }, "#mdet-tag");
    } catch (e) {
      if (btn) btn.disabled = false;
      errorMsg = t("common.saveFailed", { error: userMessage(e) });
      render("#mdet-tag-new-input");
    }
  }

  // ---- Cableado ------------------------------------------------------------------------------

  function wire(locked) {
    const d = state.detail;
    const $ = (sel) => container.querySelector(sel);
    $("#mdet-back").onclick = () => goBack();

    const photo = $("#mdet-photo");
    if (photo) photo.onclick = () => openViewer();

    // Tarjeta de categoría: en la vista entra en edición; en los dos casos abre la hoja.
    const cat = $("#mdet-cat");
    if (cat) {
      cat.onclick = () => {
        if (!d.editing) enterEdit({}, "#mdet-cat");
        openCategorySheet();
      };
    }

    // Filas de cuenta: en la vista entran en edición con su lista desplegada; en edición, la
    // despliegan o la pliegan.
    container.querySelectorAll("[data-acc-row]").forEach((b) => {
      const which = b.dataset.accRow;
      b.onclick = () => {
        if (!d.editing) enterEdit({ accPicker: which }, `#mdet-acc-${which}`);
        else update({ accPicker: d.accPicker === which ? null : which, tagPickerOpen: false }, `#mdet-acc-${which}`);
      };
    });
    container.querySelectorAll("[data-acc]").forEach((b) => {
      b.onclick = () => update({
        accountId: b.dataset.acc,
        counterAccountId: d.counterAccountId === b.dataset.acc ? "" : d.counterAccountId,
        accPicker: null,
      }, "#mdet-acc-from");
    });
    container.querySelectorAll("[data-counter-acc]").forEach((b) => {
      b.onclick = () => update({ counterAccountId: b.dataset.counterAcc, accPicker: null }, "#mdet-acc-to");
    });

    const dateRow = $("#mdet-date-row");
    if (dateRow) {
      dateRow.onclick = () => {
        enterEdit({}, "#mdet-fecha");
        // Mismo gesto del usuario: el selector nativo se puede pedir ya (en escritorio el input
        // transparente solo lo abre desde su icono; donde showPicker no existe, el foco basta).
        try { $("#mdet-fecha")?.showPicker?.(); } catch { /* sin gesto válido */ }
      };
    }
    const fecha = $("#mdet-fecha");
    if (fecha) {
      fecha.onchange = (e) => update({ fecha: e.target.value || hoyISO() }, "#mdet-fecha");
      fecha.onclick = () => { try { fecha.showPicker?.(); } catch { /* sin gesto válido */ } };
    }

    const shared = $("#mdet-shared");
    if (shared) {
      shared.disabled = locked;
      shared.onclick = () => {
        if (!d.editing) enterEdit({ isShared: !d.isShared }, "#mdet-shared");
        else update({ isShared: !d.isShared }, "#mdet-shared");
      };
    }

    const tagRow = $("#mdet-tag");
    if (tagRow) {
      tagRow.onclick = () => {
        if (!d.editing) enterEdit({ tagPickerOpen: true }, "#mdet-tag");
        else update({ tagPickerOpen: !d.tagPickerOpen, newTagDraft: null, accPicker: null }, "#mdet-tag");
      };
    }
    container.querySelectorAll("[data-tag-pick]").forEach((b) => {
      b.onclick = () => update({ tagId: b.dataset.tagPick || null, tagPickerOpen: false, newTagDraft: null }, "#mdet-tag");
    });
    const tagNew = $("#mdet-tag-new");
    if (tagNew) tagNew.onclick = () => update({ newTagDraft: "" }, "#mdet-tag-new-input");
    const tagNewInput = $("#mdet-tag-new-input");
    if (tagNewInput) {
      // Sin repintar en oninput (perdería el foco): el valor solo se lee al guardar la etiqueta.
      tagNewInput.oninput = (e) => { d.newTagDraft = e.target.value; };
      tagNewInput.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submitNewTag(); } };
    }
    const tagNewSave = $("#mdet-tag-new-save");
    if (tagNewSave) tagNewSave.onclick = () => submitNewTag();

    const edit = $("#mdet-edit");
    // Con teclado (e.detail 0: Intro o Espacio) el foco va directo al comercio, el primer campo.
    if (edit) edit.onclick = (e) => enterEdit({}, e.detail === 0 ? "#mdet-merchant" : "#mdet-disp-edit");
    const dup = $("#mdet-duplicate");
    if (dup) dup.onclick = () => openDuplicate();
    const del = $("#mdet-delete");
    if (del) del.onclick = () => confirmDelete();

    if (!d.editing) return;

    // ---- solo en edición ----
    const signBtn = $("#mdet-sign");
    if (signBtn) signBtn.onclick = () => update({ sign: d.sign === "+" ? "-" : "+" }, "#mdet-sign");

    $("#mdet-raw").oninput = (e) => {
      d.raw = e.target.value;
      d.cents = parseCentsRaw(d.raw);
      e.target.style.width = amountWidth(d.raw);
      // Sin repintar (perdería el foco y el cursor): se parchean a mano las dos partes del reparto.
      const mineEl = $("#mdet-split-mine");
      const partnerEl = $("#mdet-split-partner");
      if (d.isShared && mineEl && partnerEl) {
        const { mine: myCents, partner: partnerCents } = splitCents(d.cents, d.sharePct);
        mineEl.textContent = fmtMoney(myCents);
        partnerEl.textContent = fmtMoney(partnerPaid(d) ? d.cents : partnerCents);
      }
    };
    $("#mdet-merchant").oninput = (e) => { d.merchant = e.target.value; };
    $("#mdet-note").oninput = (e) => { d.note = e.target.value; };

    const paidBy = $("#mdet-paidby");
    if (paidBy) {
      if (locked) paidBy.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      wireSegmented(paidBy, (value) => {
        // Volver a «Pagué yo» en una fila guardada sin cuenta: se precarga la cuenta por defecto
        // para que el guard de validationError no deje al usuario sin salida.
        const accounts = accountsAll.filter((a) => a.type !== "liability");
        update({
          paidBy: value,
          accountId: value === "me" ? (d.accountId || resolveAccountId(meta.default_account_id, accounts) || "") : d.accountId,
        }, `#mdet-paidby [data-value="${value}"]`);
      });
    }
    const pctDown = $("#mdet-pct-down");
    const pctUp = $("#mdet-pct-up");
    if (pctDown) { pctDown.disabled = locked; pctDown.onclick = () => update({ sharePct: stepPct(d.sharePct, -PCT_STEP) }, "#mdet-pct-down"); }
    if (pctUp) { pctUp.disabled = locked; pctUp.onclick = () => update({ sharePct: stepPct(d.sharePct, PCT_STEP) }, "#mdet-pct-up"); }

    $("#mdet-save").onclick = () => save();
    $("#mdet-cancel").onclick = () => cancelEdit();
  }

  onOpen();
  render();
  return () => {
    closeViewer?.();
    if (detailPhotoUrl) { URL.revokeObjectURL(detailPhotoUrl); detailPhotoUrl = null; }
  };
}
