/** Resolución de las cuentas preferidas guardadas en meta (import_account_id /
 *  default_account_id). Valor vacío, o una cuenta que ya no está en la lista (borrada o
 *  archivada: `accounts` llega YA filtrada, shape de SQL.listAccounts), caen al automático:
 *  la primera cuenta corriente por display_order, si no la primera cuenta a secas, y null
 *  si no hay ninguna (BD nueva antes de crear cuentas — el caller decide qué hacer). */
export function resolveAccountId(preferredId, accounts) {
  if (preferredId && accounts.some((a) => a.id === preferredId)) return preferredId;
  return accounts.find((a) => a.type === "checking")?.id ?? accounts[0]?.id ?? null;
}

// ---- account_loans (Task 6, cuotas en pasivos) — CONFIG-IN-META ------------------------
// Mismo patrón que meta.category_style (category-colors.js#sanitizeStyleMap/parseStyle): sin
// migración de esquema ni cambio de contrato xlsx, la cuota mensual de un pasivo vive en
// meta.account_loans como JSON {accountId: {monthlyCents}}. sanitizeLoanMap es la defensa en
// profundidad (CRITICAL, mismo criterio que category_style): este JSON puede llegar de un
// import xlsx a mano o de una clave de meta manipulada directamente, así que un accountId o un
// monthlyCents corrupto no debe colar hasta patrimonio.js#accountSubtitle, donde
// Math.ceil(saldo/monthlyCents) lo convertiría en Infinity/NaN visible en la UI. Descarta en
// SILENCIO (sin throw) cualquier entrada que no encaje — última línea de defensa, no la única
// (repo.setAccountLoan también valida antes de escribir).
const ACCOUNT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function sanitizeLoanMap(map) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return {};
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    // Mismo guard que sanitizeStyleMap: JSON.parse crea "__proto__" como own property normal,
    // pero out[k]= con k="__proto__" dispara el setter especial de Object.prototype. Saltarla
    // evita tocar out.__proto__ por completo.
    if (k === "__proto__") continue;
    if (!ACCOUNT_ID_RE.test(k)) continue;
    if (!v || typeof v !== "object") continue;
    const { monthlyCents } = v;
    if (!Number.isInteger(monthlyCents) || monthlyCents <= 0) continue;
    out[k] = { monthlyCents };
  }
  return out;
}

/** JSON.parse seguro para meta.account_loans: cualquier fallo (valor ausente, corrupto,
 *  no-objeto) vuelve a {} en vez de romper la carga — mismo criterio que parseStyle. */
export function parseLoanMap(raw) {
  try {
    return sanitizeLoanMap(JSON.parse(raw));
  } catch {
    return {};
  }
}
