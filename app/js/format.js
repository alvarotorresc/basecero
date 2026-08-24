// useGrouping:"always" — el "auto" por defecto usa la estrategia CLDR "min2" y NO agrupa
// miles en importes de 4 cifras (p.ej. 1800 -> "1800,00 €" en vez de "1.800,00 €").
const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", useGrouping: "always" });
export const fmtEUR = (cents) => eur.format((cents ?? 0) / 100);
export const hoyISO = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD en hora local
export const nowIso = () => new Date().toISOString().slice(0, 19) + "Z";
export const fmtDiaLargo = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
// Formato corto ("12 ago") — filas de Liquidar y el pie del bloque "Con Sara" en Inicio.
export const fmtDiaCorto = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" });

// Día anterior a un ISO (YYYY-MM-DD), cruzando mes/año si hace falta. T12:00:00 evita líos de DST.
export function prevDayIso(iso) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("sv-SE");
}

// "agosto de 2026" (Intl es-ES) -> "Agosto 2026" — nombre por defecto del periodo (onboarding y asistente).
export function nombrePorDefecto() {
  const raw = new Date().toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  const sinDe = raw.replace(" de ", " ");
  return sinDe.charAt(0).toUpperCase() + sinDe.slice(1);
}
