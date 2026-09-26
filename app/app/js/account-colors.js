// Familia de cuenta (dirección B, D-2/D-impl-2, DESIGN.md C8): cada cuenta elige una de las 12
// familias, igual que una categoría — la familia es un DATO (meta.account_style), nunca un hex ni
// una clase de CSS inventada (C13). Por defecto, según el tipo: Corriente (checking) → tra,
// Ahorro (savings) → ali, salvo que esté enlazada a un objetivo (D-impl-2: la hucha deriva su
// familia del objetivo, no al revés) → imp, Deuda (liability) → coc (con --stripe-debt, que pinta
// el componente que dibuja la barra, no este módulo). Objetivos (goals) toman la familia de SU
// cuenta (C8): goalFamily.
//
// Reutiliza FAMILIES/isFamily de category-colors.js (lista cerrada de 12 claves, una sola vez).
// Módulo PURO: sin DOM, sin BD — repo.js es quien lee/escribe meta.account_style con estas
// funciones (setAccountFamily/getAccountStyle, patrón read-modify-write de setAccountLoan).
import { isFamily } from "./category-colors.js";

// Búsqueda por clave con Object.hasOwn: un id de cuenta como "toString" o "constructor" (nunca los
// genera bcUlid, pero styleMap/accountsById pueden llegar de un import xlsx a mano) no debe
// resolver a lo que hereda de Object.prototype. Mismo guard que category-colors.js#own.
const own = (obj, k) => (obj && typeof obj === "object" && Object.hasOwn(obj, k) ? obj[k] : undefined);

/** ¿`goals` trae un objetivo vivo enlazado a esta cuenta? Un objetivo con `account_id` vacío no
 *  enlaza a NINGUNA cuenta (spending_cap/savings_rate, D-impl-2); uno con `deleted:1` no cuenta
 *  (defensa en profundidad: listGoals ya filtra deleted=0, pero esta es la última línea, igual
 *  que sanitizeLoanMap con account_loans). `is_active` NO se mira a propósito: pausar un objetivo
 *  no debe hacer que su hucha pierda el color de hucha. */
function hasLinkedGoal(accountId, goals) {
  return Array.isArray(goals) && goals.some((g) => g && g.account_id && g.account_id === accountId && g.deleted !== 1);
}

/** Familia por defecto de una cuenta, antes de mirar ningún override (C8): checking → tra,
 *  liability → coc, savings → ali salvo que `goals` traiga un objetivo enlazado (D-impl-2), que
 *  da imp — la hucha deriva su familia del objetivo, un objetivo no la suya. Un tipo que no sea
 *  uno de los tres (el CHECK de accounts.type y validateImport lo impiden en la práctica) da null:
 *  ninguna familia inventada. */
export function defaultFamilyForAccount(account, goals) {
  if (!account) return null;
  switch (account.type) {
    case "checking": return "tra";
    case "liability": return "coc";
    case "savings": return hasLinkedGoal(account.id, goals) ? "imp" : "ali";
    default: return null;
  }
}

/** Familia final de una cuenta: el override de `styleMap` (meta.account_style saneado) si hay uno
 *  válido, si no la familia por defecto de su tipo. `styleMap` es el mapa {accountId: {fam}} que
 *  devuelve parseAccountStyle/getAccountStyle. */
export function familyForAccount(account, styleMap, goals) {
  if (!account) return null;
  const fam = own(styleMap, account.id)?.fam;
  return isFamily(fam) ? fam : defaultFamilyForAccount(account, goals);
}

/** Familia de un objetivo (C8): la de SU cuenta, si tiene una enlazada. Un objetivo sin cuenta
 *  (`account_id` vacío o ausente) o cuya cuenta no aparece en `accountsById` (borrada) no tiene
 *  familia. Se le pasa a familyForAccount el propio `goal` como único elemento de `goals`: es
 *  justo lo que prueba que su cuenta es una hucha enlazada, sin necesitar la lista completa. */
export function goalFamily(goal, accountsById, style) {
  if (!goal || !goal.account_id) return null;
  const account = own(accountsById, goal.account_id);
  if (!account) return null;
  return familyForAccount(account, style, [goal]);
}

/** Deuda (C8): la única cuenta que lleva el rayado --stripe-debt. Lo pinta el componente que
 *  dibuja la barra/baldosa (fuera de este módulo, puro): aquí solo vive el dato. */
export const isDebt = (account) => account?.type === "liability";

// Defensa en profundidad: meta.account_style llega de un import xlsx sin más validación que «es
// JSON válido». sanitizeAccountStyle descarta EN SILENCIO (sin throw: es la última línea de
// defensa; repo.setAccountFamily es quien lanza) todo lo que no encaje en la lista cerrada de
// FAMILIES. Mismas dos defensas que sanitizeStyleMap (category-colors.js): __proto__ y FAMILIES.
export function sanitizeAccountStyle(map) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return {};
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    // out["__proto__"]= dispararía el setter de Object.prototype: se salta la clave.
    if (k === "__proto__") continue;
    if (!v || typeof v !== "object") continue;
    if (isFamily(v.fam)) out[k] = { fam: v.fam };
  }
  return out;
}

/** JSON.parse seguro de meta.account_style, ya saneado. Cualquier fallo (ausente, corrupto, no
 *  objeto) devuelve {} — mismo criterio que parseStyle/parseLoanMap. */
export function parseAccountStyle(raw) {
  try {
    return sanitizeAccountStyle(JSON.parse(raw));
  } catch {
    return {};
  }
}
