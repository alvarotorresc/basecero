const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
export const fmtEUR = (cents) => eur.format((cents ?? 0) / 100);
export const hoyISO = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD en hora local
export const nowIso = () => new Date().toISOString().slice(0, 19) + "Z";
export const fmtDiaLargo = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
