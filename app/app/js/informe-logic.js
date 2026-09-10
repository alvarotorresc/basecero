/** buildReport(...) — la estructura del Informe del periodo. Módulo PURO: no importa `repo.js`,
 *  ni `db.js`, ni i18n — no compone ni una frase, los textos los pone quien pinta (screens/
 *  informe.js) o quien dibuja (informe-pdf.js). Solo importa de otros módulos puros que ya
 *  existen, para no duplicar aritmética.
 *
 *  Devuelve una estructura SERIALIZABLE (JSON.parse(JSON.stringify(r)) es idéntica — hay test):
 *  números, strings y arrays, nunca HTML ni nodos ni funciones. La pantalla y el PDF son dos
 *  presentadores de este mismo objeto (spec §5.2, D2). */
import { dayIndexOfPeriod, expectedPeriodDays, ruleApplies, myAmountOfRule, periodMonth } from "./prevision.js";
import { budgetMap, budgetStatus, pctOf, relativeWidth, sortRootRows } from "./category-spend.js";
import { colorForCategory, textColorForCategory, iconForCategory, rootOf } from "./category-colors.js";
import { activeSubscriptions, monthlyTotalCents, annualTotalCents } from "./subscriptions.js";

function buildMeta({ period, todayIso }) {
  const isOpen = period.status === "open";
  return {
    periodId: period.id,
    name: period.name,
    startDate: period.start_date,
    endDate: period.end_date,
    closeDate: isOpen ? todayIso : period.end_date,
    isOpen,
    dayIndex: dayIndexOfPeriod(period.start_date, todayIso),
    expectedDays: expectedPeriodDays(period.start_date),
    elapsedDays: Math.max(0, dayIndexOfPeriod(period.start_date, todayIso) - 1),
    // Fecha (sin hora) de la generación: buildReport es puro y no lee la hora del sistema — la
    // pantalla añade la hora del reloj al pintar «generado hoy 19:07», este campo solo fija el día.
    generatedAtIso: todayIso,
  };
}

function buildSummary({ incomeCents, spentCents, budgets }) {
  const savedCents = incomeCents - spentCents;
  const budgetTotalCents = Object.values(budgetMap(budgets ?? [])).reduce((s, c) => s + c, 0);
  const availableCents = budgetTotalCents - spentCents;
  const savingsRatePct = incomeCents > 0 ? Math.round((savedCents / incomeCents) * 100) : null;
  return {
    incomeCents, spentCents, savedCents, availableCents, budgetTotalCents,
    savingsRatePct,
    // Sin el income/gasto del periodo anterior entre las entradas de repo.reportInputs, no hay de
    // dónde derivar esta cifra sin duplicar dos consultas más: se deja en null (la pantalla omite
    // la segunda frase de «Ahorras el X%…» cuando no hay dato, igual que hoy con hasPrev).
    prevSavingsRatePct: null,
  };
}

function buildAccounts({ accountsStart, accountsEnd }) {
  const startById = Object.fromEntries((accountsStart ?? []).map((a) => [a.id, a.balance_cents]));
  const rows = (accountsEnd ?? [])
    .filter((a) => a.type === "checking")
    .map((a) => {
      const startCents = startById[a.id] ?? 0;
      const endCents = a.balance_cents;
      return { id: a.id, name: a.name, startCents, endCents, deltaCents: endCents - startCents };
    });
  const totalStartCents = rows.reduce((s, r) => s + r.startCents, 0);
  const totalEndCents = rows.reduce((s, r) => s + r.endCents, 0);
  const totalDeltaCents = rows.reduce((s, r) => s + r.deltaCents, 0);
  return { rows, totalStartCents, totalEndCents, totalDeltaCents };
}

/** Fila por raíz de gasto, con su comparativa contra `prevSpentByRoot` (N3). Reutiliza
 *  `budgetMap`/`budgetStatus`/`pctOf`/`relativeWidth`/`sortRootRows` de category-spend.js y
 *  `colorForCategory`/`textColorForCategory`/`iconForCategory` de category-colors.js — nada de
 *  aritmética duplicada (spec §5.5). */
function buildCategories({ spentByRoot, prevSpentByRoot, budgets, categoriesById, prevPeriod }) {
  const hasPrev = !!prevPeriod;
  const budgetByCategory = budgetMap(budgets ?? []);
  const prevByRoot = Object.fromEntries((prevSpentByRoot ?? []).map((r) => [r.root_id, r.spent_cents]));
  const byId = categoriesById ?? {};
  const sorted = sortRootRows(spentByRoot ?? [], budgetByCategory);
  const maxSpent = Math.max(0, ...sorted.map((r) => r.spent_cents), 0);

  const rows = sorted.map((r) => {
    const limitCents = budgetByCategory[r.root_id] ?? 0;
    const status = budgetStatus(r.spent_cents, limitCents);
    let prevCents = null, deltaCents = null, deltaPct = null, direction = "new";
    if (hasPrev) {
      prevCents = prevByRoot[r.root_id] ?? 0;
      deltaCents = r.spent_cents - prevCents;
      if (prevCents > 0) {
        deltaPct = ((r.spent_cents - prevCents) / prevCents) * 100;
        direction = deltaCents === 0 ? "flat" : deltaCents > 0 ? "up" : "down";
      } else {
        // sin gasto previo: "new" si ahora sí se gastó algo, "flat" si sigue sin haber nada —
        // en ninguno de los dos casos hay un porcentaje que calcular sin dividir por cero.
        direction = r.spent_cents > 0 ? "new" : "flat";
      }
    }
    return {
      rootId: r.root_id,
      name: r.name,
      color: colorForCategory(r.root_id, byId),
      textColor: textColorForCategory(r.root_id, byId),
      icon: iconForCategory(r.root_id, byId),
      spentCents: r.spent_cents,
      limitCents,
      pctOfLimit: pctOf(r.spent_cents, limitCents),
      level: status?.level ?? null,
      shareOfMax: relativeWidth(r.spent_cents, maxSpent),
      prevCents,
      deltaCents,
      deltaPct,
      direction,
    };
  });

  const totalCents = rows.reduce((s, r) => s + r.spentCents, 0);
  const prevTotalCents = hasPrev ? rows.reduce((s, r) => s + (r.prevCents ?? 0), 0) : 0;
  const totalDeltaPct = hasPrev && prevTotalCents > 0 ? ((totalCents - prevTotalCents) / prevTotalCents) * 100 : null;
  return { rows, totalCents, prevTotalCents, totalDeltaPct, hasPrev };
}

const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

function movementItem(t) {
  return {
    id: t.id, date: t.date, merchant: t.merchant, cents: t.amount_cents,
    type: t.type, isShared: !!t.is_shared, paidBy: t.paid_by,
  };
}

/** Movimientos agrupados por raíz de gasto (expense/refund); ingresos, transferencias y ajustes
 *  van al grupo `others` (spec §5.6): esos tres tipos no componen `spentOfPeriod`, así que
 *  agruparlos por categoría no significaría nada. El total de cabecera de cada grupo es el de
 *  `categories.rows` (que a su vez viene de `spentByRootCategory`, D12) — NUNCA la suma de los
 *  `items` listados, que puede ser una muestra parcial de los movimientos reales de la raíz. */
function buildMovements({ transactions, categoriesById }, categories) {
  const txs = transactions ?? [];
  const byId = categoriesById ?? {};
  const othersTypes = new Set(["income", "transfer", "adjustment"]);
  const groupsById = new Map();
  const others = [];
  for (const t of txs) {
    if (othersTypes.has(t.type)) { others.push(t); continue; }
    const rootId = rootOf(t.category_id, byId);
    if (!groupsById.has(rootId)) groupsById.set(rootId, []);
    groupsById.get(rootId).push(t);
  }

  const groups = [];
  const seenRoots = new Set();
  for (const catRow of categories.rows) {
    if (!groupsById.has(catRow.rootId)) continue;
    seenRoots.add(catRow.rootId);
    const items = groupsById.get(catRow.rootId).slice().sort(byDateDesc);
    groups.push({
      rootId: catRow.rootId, name: catRow.name, color: catRow.color, icon: catRow.icon,
      totalCents: catRow.spentCents, count: items.length, items: items.map(movementItem),
    });
  }
  // Una raíz con movimientos pero SIN fila en categories.rows (p.ej. archivada a mitad de periodo,
  // spec §5.3) no puede perder sus movimientos en silencio: se añade al final con el total de sus
  // propias filas, lo único que queda disponible para ella.
  for (const [rootId, items] of groupsById) {
    if (seenRoots.has(rootId)) continue;
    const sorted = items.slice().sort(byDateDesc);
    groups.push({
      rootId, name: byId[rootId]?.name ?? "", color: colorForCategory(rootId, byId), icon: iconForCategory(rootId, byId),
      totalCents: sorted.reduce((s, t) => s + t.amount_cents, 0), count: sorted.length,
      items: sorted.map(movementItem),
    });
  }

  const sortedOthers = others.slice().sort(byDateDesc);
  return {
    count: txs.length,
    groups,
    others: { count: sortedOthers.length, items: sortedOthers.map(movementItem) },
  };
}

/** Compartidos del periodo: `periodTotalCents`/`myPartCents` salen de las filas `is_shared=1` de
 *  `transactions` (íntegro vs. mi parte, spec §5.6); `netCents` es `partnerNetCents`, que viene
 *  de fuera y NO está acotado al periodo (es el mismo héroe de Liquidar). Sin `partnerName`
 *  configurado, la sección entera es `null` (mismo criterio que periodo-nuevo.js:222). */
function buildShared({ transactions, partnerNetCents, partnerName }) {
  const name = (partnerName ?? "").trim();
  if (!name) return null;
  const sharedTx = (transactions ?? []).filter((t) => t.is_shared);
  const periodTotalCents = sharedTx.reduce((s, t) => s + t.amount_cents, 0);
  const myPartCents = sharedTx.reduce((s, t) => s + t.my_amount_cents, 0);
  const netCents = partnerNetCents ?? 0;
  const direction = netCents > 0 ? "partner_owes" : netCents < 0 ? "i_owe" : "settled";
  const items = sharedTx.slice().sort(byDateDesc).map((t) => ({
    id: t.id, date: t.date, merchant: t.merchant, cents: t.amount_cents, myCents: t.my_amount_cents, paidBy: t.paid_by,
  }));
  return { partnerName: name, periodTotalCents, myPartCents, netCents, direction, items };
}

/** Suscripciones activas y su coste (spec §5.6). Se reutilizan enteras `activeSubscriptions`/
 *  `monthlyTotalCents`/`annualTotalCents` de subscriptions.js (cero aritmética duplicada) y
 *  `ruleApplies`/`myAmountOfRule`/`periodMonth` de prevision.js para el coste de ESTE periodo.
 *  Sin ninguna suscripción activa, la sección es `null`. */
function buildSubscriptions({ subscriptionRules, period }) {
  const rules = subscriptionRules ?? [];
  const active = activeSubscriptions(rules);
  if (active.length === 0) return null;
  const month = periodMonth(period.start_date, period.end_date);
  const periodCents = active
    .filter((r) => ruleApplies(r, month))
    .reduce((s, r) => s + myAmountOfRule(r, period.my_share_pct), 0);
  return {
    activeCount: active.length,
    periodCents,
    monthlyCents: monthlyTotalCents(rules),
    annualCents: annualTotalCents(rules),
  };
}

export function buildReport(input) {
  const meta = buildMeta(input);
  const summary = buildSummary(input);
  const accounts = buildAccounts(input);
  const categories = buildCategories(input);
  const movements = buildMovements(input, categories);
  const shared = buildShared(input);
  const subscriptions = buildSubscriptions(input);
  return { meta, summary, accounts, categories, movements, shared, subscriptions };
}
