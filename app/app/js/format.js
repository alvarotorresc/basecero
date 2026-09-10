// Moneda y locale de presentación de TODA la app. Por defecto es-ES/EUR; main.js llama a
// initFormat(meta) en el boot (la app espera al worker antes de pintar, no hay carrera).
// useGrouping:"always" — el "auto" por defecto usa la estrategia CLDR "min2" y NO agrupa
// miles en importes de 4 cifras (p.ej. 1800 -> "1800,00 €" en vez de "1.800,00 €").
// OJO: los "sv-SE" de más abajo NO son locale de presentación (truco YYYY-MM-DD): no dependen de esto.
import { weekdayInitial } from "./i18n/index.js";
let locale = "es-ES";
let currency = "EUR";
let money = buildMoney();
let pct = buildPct();
let pct0 = buildPct0();
let dec1 = buildDec1();
function buildMoney() {
  return new Intl.NumberFormat(locale, { style: "currency", currency, useGrouping: "always" });
}
function buildPct() {
  return new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
// Porcentaje SIN decimales («54 %», no «54,2 %»): la frase de ahorro de Inicio v2 y la de la
// hucha («va por el X % de su límite») — un color de estado ya dice si preocupa o no, así que la
// cifra no necesita más precisión que la de un vistazo.
function buildPct0() {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
}
function buildDec1() {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
export function initFormat(meta) {
  const prev = { locale, currency };
  locale = meta?.locale || "es-ES";
  currency = meta?.currency || "EUR";
  try {
    money = buildMoney();
    pct = buildPct();
    pct0 = buildPct0();
    dec1 = buildDec1();
  } catch {
    // currency/locale corruptos en meta: la app arranca igual, con los valores anteriores
    ({ locale, currency } = prev);
    money = buildMoney();
    pct = buildPct();
    pct0 = buildPct0();
    dec1 = buildDec1();
  }
}
export const fmtMoney = (cents) => money.format((cents ?? 0) / 100);
// Para el importe héroe (céntimos reducidos al 60%, ver DesignSystem.dc.html): parte el resultado
// de money.formatToParts en tres trozos SIN reimplementar el locale. Split por POSICIÓN respecto a
// la part "fraction", no por tipo: en monedas sin decimales (JPY) esa part no existe y el símbolo de
// moneda puede ir de prefijo (ja-JP: "￥1.285") — filtrar por integer/group/decimal dejaría ese
// prefijo fuera de main y rompería el orden al reconstruir main+cents+suffix.
//   - main   = todas las parts anteriores a "fraction", concatenadas en orden (incluye separador
//              decimal si lo hay, o el símbolo de moneda si va de prefijo)
//   - cents  = el valor de la part "fraction" (si no existe, "")
//   - suffix = todas las parts posteriores a "fraction" (si no existe "fraction", queda "")
export const fmtMoneyParts = (cents) => {
  const parts = money.formatToParts((cents ?? 0) / 100);
  let main = "";
  let centsOut = "";
  let suffix = "";
  let sawFraction = false;
  for (const p of parts) {
    if (p.type === "fraction") {
      centsOut = p.value;
      sawFraction = true;
    } else if (!sawFraction) {
      main += p.value;
    } else {
      suffix += p.value;
    }
  }
  return { main, cents: centsOut, suffix };
};
// Escape local (patrón del resto del proyecto: cada módulo lleva el suyo, ver modal.js/inicio.js).
// Solo & y < hacen falta aquí: lo que sale de Intl.NumberFormat nunca trae ninguno de los dos,
// pero el contrato del repo es que todo lo que entra en un template string va escapado.
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
/** Anatomía del importe (SISTEMA.md §2.3): entero pleno, céntimos reducidos, símbolo aún menor.
 *  Devuelve HTML, no texto: es el ÚNICO helper del proyecto que lo hace, y por eso escapa sus
 *  tres trozos aunque salgan de Intl.NumberFormat (nunca traen < ni &, pero el contrato del
 *  repo es que todo lo que entra en un template string va escapado). */
export const moneyPartsHtml = (cents) => {
  const { main, cents: c, suffix } = fmtMoneyParts(cents);
  return `${esc(main)}<span class="money-cents">${esc(c)}</span>` +
         `<span class="money-cur">${esc(suffix)}</span>`;
};
export const fmtPct = (v) => pct.format(v);
export const fmtPct0 = (v) => pct0.format(v);
export const fmtDec1 = (n) => dec1.format(n);
export const currencySymbol = () => money.formatToParts(0).find((p) => p.type === "currency").value;
export const currencyCode = () => currency;
export const appLocale = () => locale;
export const hoyISO = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD en hora local
export const nowIso = () => new Date().toISOString().slice(0, 19) + "Z";
export const fmtDiaLargo = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });

// Parseo de un importe tecleado a céntimos. Coma = decimal; los puntos son separador de
// millar cuando hay coma o cuando forman grupos de 3 («1.250» → 1250,00 €); un punto
// suelto sin coma se trata como decimal tecleado («12.5» → 12,50 €). NaN/vacío → 0
// (contrato de los 6 llamantes); el signo del texto se respeta y el flip (pasivos,
// ajustes) queda SIEMPRE en el llamante.
// B4: cuando aparecen coma Y punto a la vez (pegar un importe en-US como «1,250.50», locale que
// la propia app ofrece), gana el separador que va ÚLTIMO — es el decimal, el otro es de millar.
// Es un desempate, no una reescritura: con un solo tipo de separador el comportamiento de
// arriba no cambia ni un bit (verificado contra las 9 assertions previas de format.test.mjs).
export function parseCentsRaw(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return 0;
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Math.round(parseFloat(s) * 100);
  return Number.isFinite(n) ? n : 0;
}

// Inverso para precargar inputs de importe: céntimos → «1250,50» (absoluto, sin puntos
// de millar — es un valor editable, no un formateado); 0 → cadena vacía.
export const centsToRaw = (cents) => (cents ? (Math.abs(cents) / 100).toFixed(2).replace(".", ",") : "");

// opfs-sahpool solo admite una instancia de la app: otra pestaña/PWA con la BD
// abierta hace fallar createSyncAccessHandle con NoModificationAllowedError.
// Ese fallo es recuperable ("locked": cierra la otra y reintenta); el resto
// significa que OPFS no está disponible de verdad ("unsupported").
export function classifyStorageFailure(e) {
  const name = e?.name ?? "";
  const msg = String(e?.message ?? e ?? "");
  if (name === "NoModificationAllowedError" || msg.includes("Access Handle")) return "locked";
  return "unsupported";
}
// Formato corto ("12 ago") — filas de Liquidar y el pie del bloque de compartidos en Inicio.
export const fmtDiaCorto = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString(locale, { day: "numeric", month: "short" });

// Inicial del día de la semana (tarjeta "Flujo de gasto" de Inicio, Task 12), vía i18n —
// getDay(): 0=domingo..6=sábado, de ahí que i18n.weekdays empiece en D/S (es/en).
export const fmtDiaIni = (iso) => weekdayInitial(new Date(iso + "T12:00:00").getDay());

// Día anterior a un ISO (YYYY-MM-DD), cruzando mes/año si hace falta. T12:00:00 evita líos de DST.
export function prevDayIso(iso) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("sv-SE");
}

// "agosto de 2026" (Intl es-ES) -> "Agosto 2026" — nombre por defecto del periodo (onboarding y asistente).
export function nombrePorDefecto() {
  const raw = new Date().toLocaleDateString(locale, { month: "long", year: "numeric" });
  const sinDe = raw.replace(" de ", " ");
  return sinDe.charAt(0).toUpperCase() + sinDe.slice(1);
}
