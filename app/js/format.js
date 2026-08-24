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
