/** El «Barrido» del cierre de periodo (N4): remanente, destinos propuestos y validación de la
 *  cantidad a barrer. Módulo PURO — solo importa `parseCentsRaw` de format.js. Nada de i18n ni de
 *  DOM: los textos los pone screens/periodo-nuevo.js. */
import { parseCentsRaw } from "./format.js";

/** El remanente que se ofrece barrer.
 *  - Con presupuesto: presupuestado − gastado (el «Te sobran 352,80 € del presupuesto» del
 *    artboard; es el mismo «Disponible del periodo» de Inicio).
 *  - Sin ningún límite puesto: ingresos − gastado, y la pantalla usa otra frase.
 *  Nunca negativo. */
export function remainderCents({ budgetTotalCents, incomeCents, spentCents }) {
  const basis = budgetTotalCents > 0 ? "budget" : "income";
  const base = basis === "budget" ? budgetTotalCents : incomeCents;
  return { cents: Math.max(0, base - spentCents), basis };
}

// Tipos de goal con hucha propia (mismo criterio que repo.js#HUCHA_GOAL_TYPES): los únicos con
// account_id, así que los únicos con un sitio adonde mover el remanente. spending_cap y
// savings_rate no tienen cuenta.
const HUCHA_GOAL_TYPES = new Set(["emergency_fund", "savings_target", "provision"]);

/** Los destinos que se ofrecen, ya con el «quedaría en X €» resuelto.
 *  `goalsProgress`: la salida de repo.goalsWithProgress() — [{ goal, currentCents, targetCents,
 *  pct, level, subtitle }]. `accountsById`: mapa id -> cuenta (con `is_archived`).
 *  Orden: pct descendente (el más cerca de cumplirse primero — barrerlo lo termina), empate por
 *  nombre. `completes` marca el destino que la aportación llevaría a su objetivo. */
export function sweepDestinations(goalsProgress, accountsById, sweepCents, sourceAccountId) {
  const byId = accountsById ?? {};
  const rows = (goalsProgress ?? [])
    .filter((gp) => HUCHA_GOAL_TYPES.has(gp.goal.type) && gp.goal.account_id)
    .filter((gp) => gp.goal.account_id !== sourceAccountId)
    .filter((gp) => {
      const acc = byId[gp.goal.account_id];
      return !!acc && !acc.is_archived;
    })
    .map((gp) => {
      const afterCents = gp.currentCents + sweepCents;
      const completes = gp.targetCents > 0 && gp.currentCents < gp.targetCents && afterCents >= gp.targetCents;
      return {
        goalId: gp.goal.id,
        name: gp.goal.name,
        accountId: gp.goal.account_id,
        currentCents: gp.currentCents,
        targetCents: gp.targetCents,
        pct: gp.pct,
        afterCents,
        completes,
      };
    });
  return rows.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
}

/** Valida la cantidad tecleada. Tope: el saldo de la cuenta de origen A LA FECHA DE LA
 *  TRANSFERENCIA (la misma fecha, no «hoy»): barrer más dejaría la cuenta en negativo.
 *  Se CAPA y se avisa en el copy, no se rechaza: el usuario no tiene que adivinar el máximo. */
export function sweepPlan({ rawAmount, sourceBalanceCents }) {
  const cents = parseCentsRaw(rawAmount);
  if (!(cents > 0)) return { amountCents: 0, capped: false, valid: false };
  const capped = cents > sourceBalanceCents;
  const amountCents = capped ? Math.max(0, sourceBalanceCents) : cents;
  return { amountCents, capped, valid: amountCents > 0 };
}
