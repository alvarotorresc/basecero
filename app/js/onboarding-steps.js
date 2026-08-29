// Lógica pura del onboarding de primera ejecución (PR F). SIN imports de db/repo — así los
// tests de node pueden importarla directo, sin worker ni sqlite de por medio (mismo motivo
// que prevision.js y category-order.js). Importa parseCentsRaw de format.js: sigue siendo
// puro (format.js tampoco importa db/repo).
import { parseCentsRaw } from "./format.js";

// Gate del onboarding: cero periodos. Una BD virgen no tiene ninguno; un usuario a mitad de
// onboarding (creó cuentas pero aún no abrió periodo) debe RETOMARLO al reabrir; y una BD
// real siempre tiene periodos (abiertos o cerrados), así que jamás lo ve.
export const needsOnboarding = (periods) => periods.length === 0;

// El paso Cuentas no se puede abandonar sin al menos una cuenta creada.
export const canLeaveAccounts = (accountCount) => accountCount >= 1;

// Borrador del form de cuenta del paso 2 → cuenta lista para createAccount, o {error}.
// "liability" guarda el saldo en negativo aunque se teclee en positivo: es lo que debes.
export function accountDraft({ name, type, raw }) {
  if (!name.trim()) return { error: "Ponle un nombre a la cuenta." };
  const parsed = parseCentsRaw(raw);
  return { name: name.trim(), type, openingBalanceCents: type === "liability" ? -Math.abs(parsed) : parsed };
}
