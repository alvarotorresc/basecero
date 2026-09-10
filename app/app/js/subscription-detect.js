/** Candidatas a suscripción a partir de los cargos ya cobrados (N6, «el radar»). Importa SOLO
 *  normalizeMerchant: nunca duplica la normalización de comercios que ya vive en
 *  merchant-memory.js (spec §6.1) — dos normalizaciones distintas del mismo comercio es
 *  exactamente el defecto que esa memoria existe para evitar. */
import { normalizeMerchant } from "./merchant-memory.js";

export const DETECT_WINDOW_DAYS = 760; // dos años y pico: una anual necesita dos cargos a >365 días
export const AMOUNT_TOLERANCE_PCT = 10;
export const MAX_CANDIDATES = 5;
export const CADENCES = [
  { frequency: "weekly", min: 6, max: 8, nominal: 7 },
  { frequency: "monthly", min: 28, max: 32, nominal: 30 },
  { frequency: "yearly", min: 360, max: 370, nominal: 365 },
];

/** ISO del día `day` en el mes `monthIndex` (0-based) de `year`, recortado al último día real de
 *  ese mes. Copia deliberada de subscriptions.js#isoFromParts: este módulo no importa nada salvo
 *  normalizeMerchant (arriba), así que la clampa de fin de mes vive aquí también, pequeña y sin
 *  imports cruzados. */
function isoFromParts(year, monthIndex, day) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(day, lastDay), 12).toLocaleDateString("sv-SE");
}

/** Días naturales entre dos ISO (positivo si `laterIso` es posterior a `earlierIso`). Aritmética a
 *  mediodía, como el resto del proyecto, para no pisar un cambio de hora. */
function daysBetween(earlierIso, laterIso) {
  const ms = new Date(laterIso + "T12:00:00") - new Date(earlierIso + "T12:00:00");
  return Math.round(ms / 86400000);
}

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Última fecha + UNA cadencia NATURAL (mes o año de calendario, o +7 días) — nunca «+30 días»: si
 *  te cobran el 31 de enero, la siguiente estimada es el 28 o el 29 de febrero, no el 2 de marzo. */
function advanceOneCadence(dateIso, frequency) {
  const [y, m, d] = dateIso.split("-").map(Number);
  if (frequency === "weekly") {
    const dt = new Date(y, m - 1, d, 12);
    dt.setDate(dt.getDate() + 7);
    return dt.toLocaleDateString("sv-SE");
  }
  if (frequency === "monthly") {
    let year = y, monthIndex = m; // +1 mes, ya en 0-based (m es 1-based)
    if (monthIndex > 11) { monthIndex = 0; year += 1; }
    return isoFromParts(year, monthIndex, d);
  }
  if (frequency === "yearly") return isoFromParts(y + 1, m - 1, d);
  return "";
}

/** Candidatas a suscripción a partir de los cargos ya cobrados.
 *  PURA: ni repo, ni Date.now() — `todayIso` entra por parámetro (aunque hoy no participa en el
 *  cálculo: la ventana de fechas ya la aplicó SQL.subscriptionCharges antes de llegar aquí; se
 *  mantiene en la firma por simetría con el resto de funciones puras del proyecto).
 *  @param charges filas de SQL.subscriptionCharges, ordenadas date DESC, id DESC.
 *  @param rules   reglas VIVAS (listRules), para no proponer lo que ya está.
 *  @param opts    { todayIso, ignored: string[] }
 *  @returns candidatas ordenadas y capadas a MAX_CANDIDATES. */
export function detectSubscriptions(charges, rules, opts = {}) {
  const ignored = new Set(opts.ignored ?? []);

  // 1. Agrupar por normalizeMerchant(merchant) en un Map — nunca un objeto literal: la clave viene
  // de texto del usuario y un comercio "__proto__" es perfectamente posible. Un Map trata esa
  // clave como una entrada normal y corriente, sin tocar Object.prototype.
  const groups = new Map();
  for (const c of charges ?? []) {
    const key = normalizeMerchant(c.merchant);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  // 2. Comercios ya cubiertos. El filtro que de verdad trabaja: CUALQUIER cargo del grupo con
  // rule_id<>'' descarta el grupo ENTERO — no basta con filtrar fila a fila (dos huérfanos
  // seguirían formando candidata si solo el cargo más reciente estuviera enlazado). El filtro por
  // nombre de regla es más débil (texto libre vs. comercio del banco) pero es una red barata.
  const coveredByRuleId = new Set();
  for (const c of charges ?? []) if (c.rule_id) coveredByRuleId.add(normalizeMerchant(c.merchant));
  const coveredByRuleName = new Set((rules ?? []).map((r) => normalizeMerchant(r.name)));

  const candidates = [];
  for (const [key, groupCharges] of groups) {
    if (coveredByRuleId.has(key)) continue;
    if (coveredByRuleName.has(key)) continue;
    if (ignored.has(key)) continue;

    // 3. Un cargo por día: se conserva el primero del orden date DESC, id DESC (el grupo ya llega
    // en ese orden porque `charges` lo trae así). Un segundo cargo el mismo día no es señal de
    // cadencia; dejarlo metería un hueco de 0 días que rompería cualquier racha legítima.
    const seenDates = new Set();
    const deduped = [];
    for (const c of groupCharges) {
      if (seenDates.has(c.date)) continue;
      seenDates.add(c.date);
      deduped.push(c);
    }
    if (deduped.length < 2) continue;

    // 4. Racha hacia atrás desde el cargo más reciente. ref fijo (D7): el importe que vio el
    // usuario la última vez, no una media móvil. La clase de cadencia la fija el PRIMER hueco
    // aceptado y ya no cambia — un hueco posterior que encaje en OTRA clase igualmente corta la
    // racha, porque mezclaría, p.ej., mensual con semanal en la misma suscripción.
    const ref = deduped[0].amount_cents;
    const streak = [deduped[0]];
    let cadenceClass = null;
    for (let i = 1; i < deduped.length; i++) {
      const cur = deduped[i];
      const amountOk = Math.abs(cur.amount_cents - ref) * 100 <= ref * AMOUNT_TOLERANCE_PCT;
      if (!amountOk) break;
      const prev = streak[streak.length - 1];
      const gapDays = daysBetween(cur.date, prev.date);
      const cls = CADENCES.find((c) => gapDays >= c.min && gapDays <= c.max);
      if (!cls || (cadenceClass && cls.frequency !== cadenceClass.frequency)) break;
      cadenceClass = cls;
      streak.push(cur);
    }

    // 5. Mínimo 2 cargos en la racha (= 1 hueco, D8). Con 1, no hay candidata.
    if (streak.length < 2) continue;

    const amountCents = Math.round(streak.reduce((s, c) => s + c.amount_cents, 0) / streak.length);
    const gaps = [];
    for (let i = 1; i < streak.length; i++) gaps.push(daysBetween(streak[i].date, streak[i - 1].date));

    candidates.push({
      merchantKey: key,
      merchant: streak[0].merchant,
      amountCents,
      frequency: cadenceClass.frequency,
      cadenceDays: median(gaps),
      count: streak.length,
      lastDates: streak.slice(0, 3).map((c) => c.date),
      nextEstimated: advanceOneCadence(streak[0].date, cadenceClass.frequency),
      categoryId: streak[0].category_id ?? "",
      accountId: streak[0].account_id ?? "",
      txIds: streak.map((c) => c.id),
    });
  }

  // 6. Orden y tope (determinista, sin empates sin resolver): count desc → amountCents desc →
  // merchant asc. La sección es una sugerencia, no una bandeja de entrada.
  candidates.sort((a, b) => b.count - a.count || b.amountCents - a.amountCents || a.merchant.localeCompare(b.merchant));
  return candidates.slice(0, MAX_CANDIDATES);
}
