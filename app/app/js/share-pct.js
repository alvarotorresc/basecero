/** Reparto de gastos compartidos: helpers PUROS (sin DOM ni BD) que comparten Registro,
 *  Movimientos y Ajustes. Los porcentajes son «mi parte» en entero 0..100. */
export const PCT_STEP = 5;

/** ¿Es un porcentaje válido (número finito en [0, 100])? Guard de repo.updatePeriodSharePct. */
export const isValidPct = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;

/** Normaliza lo que llega de la BD/xlsx (REAL, puede venir nulo o roto) a entero 0..100;
 *  si no es válido devuelve fallback. */
export function normalizePct(v, fallback = 100) {
  return isValidPct(v) ? Math.round(v) : fallback;
}

/** Aplica delta y acota a [0, 100]. */
export function stepPct(pct, delta) {
  return Math.min(100, Math.max(0, pct + delta));
}

/** Reparte amountCents según pct (mi parte redondeada al céntimo; la contraparte es el resto,
 *  así mine + partner === amountCents siempre). Misma fórmula que MY_AMOUNT en sql.js. */
export function splitCents(amountCents, pct) {
  const mine = Math.round((amountCents * pct) / 100);
  return { mine, partner: amountCents - mine };
}
