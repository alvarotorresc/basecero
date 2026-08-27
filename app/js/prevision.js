/** Lógica pura de Previsión (Task 11): SIN imports de db/repo — así los tests de node
 *  pueden importarlo directo, sin worker ni sqlite de por medio. Espeja EXACTAMENTE la
 *  hoja "Previsión" del generador (generator/basecero_generator/dashboards.py:103-134).
 *
 *  RULING del controller (resuelve una contradicción del spec, es vinculante): weekly se
 *  trata IGUAL que monthly — aplica una vez por periodo con el importe simple, NO "una vez
 *  por semana". Así lo hace la propia fórmula de la hoja (linea 118-123 de dashboards.py,
 *  declarada autoritativa), que solo distingue monthly/weekly del resto agrupándolos juntos. */

/** Mes (1-12) al que se atribuye un periodo: el mes que contiene la MAYOR PARTE del rango
 *  [start_date, end_date]. Periodo abierto (end_date vacío): se asume un mes natural menos un
 *  día — la convención "de nómina a nómina". Empate: gana el mes más tardío (mismo criterio
 *  que la heurística anterior). T12:00:00 evita líos de cambio de hora (como format.js#prevDayIso). */
export function periodMonth(startDateIso, endDateIso = "") {
  const d = new Date(startDateIso + "T12:00:00");
  const startMonth = d.getMonth() + 1;
  let end;
  if (endDateIso) {
    end = new Date(endDateIso + "T12:00:00");
  } else {
    end = new Date(d);
    end.setMonth(end.getMonth() + 1);
    end.setDate(end.getDate() - 1);
  }
  const counts = []; // [{month, n}] en orden de aparición dentro del rango
  for (; d <= end; d.setDate(d.getDate() + 1)) {
    const m = d.getMonth() + 1;
    const last = counts[counts.length - 1];
    if (last && last.month === m) last.n += 1;
    else counts.push({ month: m, n: 1 });
  }
  if (!counts.length) return startMonth; // rango vacío o fechas incoherentes: mes de inicio
  let best = counts[0];
  for (const c of counts) if (c.n >= best.n) best = c; // >= : el empate lo gana el mes más tardío
  return best.month;
}

/** ¿Aplica `rule` en el mes `month` (1-12) del periodo? Mismo orden de comprobación que la
 *  fórmula de la columna "¿Aplica este mes?":
 *  - inactiva → no.
 *  - monthly / weekly → sí (siempre, ver RULING arriba).
 *  - quarterly / yearly sin due_month → no.
 *  - yearly → due_month === month.
 *  - quarterly → mismo múltiplo de 3 de distancia (ciclo de 3 en 3 meses desde due_month). */
export function ruleApplies(rule, month) {
  if (!rule.is_active) return false;
  if (rule.frequency === "monthly" || rule.frequency === "weekly") return true;
  if (rule.due_month == null || rule.due_month === "") return false;
  if (rule.frequency === "yearly") return rule.due_month === month;
  if (rule.frequency === "quarterly") return (((month - rule.due_month) % 12) + 12) % 3 === 0;
  return false;
}

/** Mi importe de la regla: prorrateado por sharePct si is_shared, si no el importe íntegro. */
export function myAmountOfRule(rule, sharePct) {
  return rule.is_shared ? Math.round((rule.amount_cents * sharePct) / 100) : rule.amount_cents;
}
