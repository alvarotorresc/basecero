/** buildReport(...) — la estructura del Informe del periodo. Módulo PURO: no importa `repo.js`,
 *  ni `db.js`, ni i18n — no compone ni una frase, los textos los pone quien pinta (screens/
 *  informe.js) o quien dibuja (informe-pdf.js). Solo importa de otros módulos puros que ya
 *  existen, para no duplicar aritmética.
 *
 *  Devuelve una estructura SERIALIZABLE (JSON.parse(JSON.stringify(r)) es idéntica — hay test):
 *  números, strings y arrays, nunca HTML ni nodos ni funciones. La pantalla y el PDF son dos
 *  presentadores de este mismo objeto (spec §5.2, D2). */
import { dayIndexOfPeriod, expectedPeriodDays } from "./prevision.js";
import { budgetMap, budgetStatus, pctOf, relativeWidth, sortRootRows } from "./category-spend.js";
import { colorForCategory, textColorForCategory, iconForCategory } from "./category-colors.js";

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

export function buildReport(input) {
  return {
    meta: buildMeta(input),
    summary: buildSummary(input),
    accounts: buildAccounts(input),
    categories: buildCategories(input),
    movements: { count: 0, groups: [], others: { count: 0, items: [] } },
    shared: null,
    subscriptions: null,
  };
}
