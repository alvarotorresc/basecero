/** Resolución de las cuentas preferidas guardadas en meta (import_account_id /
 *  default_account_id). Valor vacío, o una cuenta que ya no está en la lista (borrada o
 *  archivada: `accounts` llega YA filtrada, shape de SQL.listAccounts), caen al automático:
 *  la primera cuenta corriente por display_order, si no la primera cuenta a secas, y null
 *  si no hay ninguna (BD nueva antes de crear cuentas — el caller decide qué hacer). */
export function resolveAccountId(preferredId, accounts) {
  if (preferredId && accounts.some((a) => a.id === preferredId)) return preferredId;
  return accounts.find((a) => a.type === "checking")?.id ?? accounts[0]?.id ?? null;
}
