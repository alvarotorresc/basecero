// Lógica pura del detalle de cuenta (B-6, B-Cuenta): fechas de la serie de saldo, el signo de un
// movimiento visto desde una cuenta, lo que entró y salió en el periodo y el avance de una deuda.
// Sin DOM ni BD: la prueba tests/app/cuenta-logic.test.mjs, contra SQL.accountBalance en node:sqlite.
import { rootOf } from "./category-colors.js";

const pad = (n) => String(n).padStart(2, "0");

/** Fechas de la serie de saldo: el último día de cada uno de los `n - 1` meses anteriores y, al
 *  final, hoy. Todo en aritmética de calendario (sin Date en UTC): «2026-09-27», 6 → abr 30 … ago 31,
 *  sep 27. `n` entero ≥ 1. */
export function monthEndDates(todayIso, n = 6) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`monthEndDates: n ${n} no es un entero ≥ 1`);
  const [y, m] = todayIso.split("-").map(Number);
  const out = [];
  for (let k = n - 1; k >= 1; k--) {
    // Mes (1-based) k meses antes; el día 0 del mes siguiente es el último de este.
    const idx = y * 12 + (m - 1) - k;
    const yy = Math.floor(idx / 12);
    const mm = (idx % 12) + 1;
    const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    out.push(`${yy}-${pad(mm)}-${pad(last)}`);
  }
  out.push(todayIso);
  return out;
}

/** Importe con signo de un movimiento desde el punto de vista de `accountId`. Es el CASE de
 *  SQL.accountBalance, uno a uno (el saldo y estas sumas tienen que cuadrar siempre): gasto y
 *  transferencia que sale restan, transferencia que entra, ingreso y devolución suman, y el ajuste
 *  lleva su propio signo. Un movimiento de otra cuenta da 0. */
export function signedForAccount(row, accountId) {
  const amt = Number(row.amount_cents) || 0;
  const own = row.account_id === accountId;
  if ((row.type === "expense" || row.type === "transfer") && own) return -amt;
  if (row.type === "transfer" && row.counter_account_id === accountId) return amt;
  if ((row.type === "income" || row.type === "refund") && own) return amt;
  if (row.type === "adjustment" && own) return amt;
  return 0;
}

/** «Entró» y «Salió» de una cuenta sobre unas filas (las del periodo abierto), más lo que salió
 *  agrupado para la barra: por categoría raíz (gasto), sin categoría, transferencias y ajustes;
 *  de mayor a menor. `inCents - outCents` es lo que cambió el saldo con esas filas. */
export function accountFlows(rows, accountId, byId) {
  let inCents = 0;
  let outCents = 0;
  const groups = new Map();
  const add = (key, kind, rootId, cents) => {
    const g = groups.get(key) ?? { kind, rootId, cents: 0 };
    g.cents += cents;
    groups.set(key, g);
  };
  for (const r of rows ?? []) {
    const s = signedForAccount(r, accountId);
    if (s > 0) inCents += s;
    if (s >= 0) continue;
    const out = -s;
    outCents += out;
    if (r.type === "expense") {
      if (r.category_id) {
        const root = rootOf(r.category_id, byId);
        add(`cat:${root}`, "category", root, out);
      } else add("uncat", "uncategorized", null, out);
    } else if (r.type === "transfer") add("transfer", "transfer", null, out);
    else add("adjustment", "adjustment", null, out);
  }
  const outGroups = [...groups.values()].sort((a, b) => b.cents - a.cents);
  return { inCents, outCents, outGroups };
}

/** Avance de una deuda: lo pagado desde el saldo inicial (solo si arrancó en negativo, y nunca más
 *  que lo que se debía al abrirla) y lo que queda pendiente (lo que el saldo tiene de negativo). */
export function debtProgress({ openingCents, balanceCents }) {
  const owedAtStart = Math.max(0, -openingCents);
  const paidCents = Math.min(owedAtStart, Math.max(0, balanceCents - openingCents));
  return { paidCents, pendingCents: Math.max(0, -balanceCents) };
}

export const ACCOUNT_TYPES = ["checking", "savings", "liability"];

/** Cambio de tipo en el detalle (B-Cuenta: selector segmentado en el grupo, guarda al cambiar).
 *  Mismas reglas que guardar el formulario de Patrimonio: el tipo tiene que ser uno de los tres y
 *  el nombre no puede quedar vacío; la cuota mensual solo vive en un pasivo (otro tipo manda 0,
 *  que setAccountLoan lee como «borrar la cuota»). El saldo inicial no cambia. Devuelve null si
 *  no hay nada que guardar (mismo tipo o tipo desconocido), o { error } si no pasa la validación.
 *  @returns {null | {error:string} | {fields:{name:string,type:string}, monthlyCents:number}} */
export function accountTypeChange(account, newType, currentMonthlyCents = 0) {
  if (!account || !ACCOUNT_TYPES.includes(newType) || newType === account.type) return null;
  const name = String(account.name ?? "").trim();
  if (!name) return { error: "name" };
  return {
    fields: { name, type: newType },
    monthlyCents: newType === "liability" ? Math.max(0, Number(currentMonthlyCents) || 0) : 0,
  };
}
