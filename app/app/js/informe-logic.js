/** buildReport(...) — la estructura del Informe del periodo. Módulo PURO: no importa `repo.js`,
 *  ni `db.js`, ni i18n — no compone ni una frase, los textos los pone quien pinta (screens/
 *  informe.js) o quien dibuja (informe-pdf.js). Solo importa de otros módulos puros que ya
 *  existen, para no duplicar aritmética.
 *
 *  Devuelve una estructura SERIALIZABLE (JSON.parse(JSON.stringify(r)) es idéntica — hay test):
 *  números, strings y arrays, nunca HTML ni nodos ni funciones. La pantalla y el PDF son dos
 *  presentadores de este mismo objeto (spec §5.2, D2). */
import { dayIndexOfPeriod, expectedPeriodDays } from "./prevision.js";
import { budgetMap } from "./category-spend.js";

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

export function buildReport(input) {
  return {
    meta: buildMeta(input),
    summary: buildSummary(input),
    accounts: buildAccounts(input),
    categories: { rows: [], totalCents: 0, prevTotalCents: 0, totalDeltaPct: null, hasPrev: false },
    movements: { count: 0, groups: [], others: { count: 0, items: [] } },
    shared: null,
    subscriptions: null,
  };
}
