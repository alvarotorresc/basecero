/** Parser puro de lenguaje natural para Registro (Registro v2 §8.1). PURO: sin DOM, sin BD, sin
 *  i18n — el único import es `normalizeMerchant` de merchant-memory.js (misma normalización que ya
 *  usa el resto de la app para casar comercios, no se reescribe). `today` es un parámetro
 *  OBLIGATORIO (ISO YYYY-MM-DD): nunca se llama a `new Date()` sin argumentos, para que «ayer» y
 *  «el lunes» se puedan afirmar con igualdad estricta en los tests. Nunca lanza: una entrada rara
 *  (basura, null, undefined) devuelve el mismo objeto con todo a null.
 *
 *  ORDEN DE RESOLUCIÓN (spec §8.1, y es lo que hace funcionar la frase del artboard):
 *    1. Importe   2. Compartido   3. Fecha   4. Cuenta   5. Comercio   6. Categoría
 *  Cada paso, si encuentra algo, «blanquea» (sustituye por espacios, misma longitud) el tramo de
 *  texto que ha consumido antes de que corra el paso siguiente — así «12 con 50 en el bar con
 *  Marta» funciona: el PRIMER «con» se lo come el importe y desaparece del texto antes de que la
 *  regla de compartido mire; el segundo es Marta. Invertir el orden rompe la frase (hay test).
 *
 *  RESERVA PREVIA (antes del paso 1): un «al 60 %» o una fecha numérica («3/9», «el 3») NO son
 *  candidatos a importe aunque sean dígitos sueltos — se reservan sus tramos ANTES de que el
 *  escaneo de importe empiece, y el escaneo salta cualquier token que caiga dentro de una reserva.
 *  Esto no contradice el orden de arriba: ese orden decide quién se queda un `con` ambiguo: esto
 *  solo evita que el paso 1 lea un dígito que a todas luces pertenece a otro campo. */
import { normalizeMerchant } from "./merchant-memory.js";

// Apóstrofo inicial fuera a propósito (normalizeMerchant ya lo quita): aquí solo hace falta
// minúsculas + sin diacríticos, SIN colapsar espacios — colapsar espacios desalinearía los índices
// de esta cadena "folded" respecto al texto original, y el resto del módulo depende de que ambas
// cadenas tengan la MISMA longitud carácter a carácter (ver `sliceOriginal`).
const fold = (s) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------- números en palabras (R5)

// "un"/"una"/"uno" NO entran aquí como número que pueda empezar un importe: son artículos («un
// café», «una cerveza») muchísimo más frecuentes en este dominio que su lectura numeral, y el
// escaneo de importe prueba CADA palabra de la frase como posible arranque — sin este guard, «un
// café en el bar» se leería como 1,00 €. Test: natural.test.mjs "un café en el bar". Siguen
// disponibles dentro de un compuesto tipo "treinta y un euros" via UNITS_1_9, donde el "y" previo
// ya desambigua (no hay lectura de artículo posible ahí).
const UNITS_BARE = {
  cero: 0, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const UNITS_1_9 = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
const TENS = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const HUNDREDS = {
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500,
  seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900,
};

const WEEKDAYS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const MONTHS = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7,
  septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};

const RULES_ES = {
  merchantTriggerSrc: "\\ben\\s+(?:(?:el|la|los|las)\\s+)?",
  stopWords: ["con", "de", "para", "hoy", "ayer", "anteayer", "el"],
  sharedTrigger: /\bcon\s+([a-z]+)\b/,
  sharedAltTrigger: /\ba\s+medias\b/,
  pctTrigger: /\bal\s+(\d{1,3})\s*%/,
  centsSeparators: ["con", "y"],
  wordNumbers: true,
  todayWord: /\bhoy\b/,
  yesterdayWord: /\bayer\b/,
  dayBeforeYesterdayWord: /\banteayer\b|\bantes\s+de\s+ayer\b/,
  weekdayRe: /\bel\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/,
  weekdays: WEEKDAYS,
  monthDayRe: /\bel\s+(\d{1,2})\s+de\s+([a-z]+)\b/,
  months: MONTHS,
  dayOnlyRe: /\bel\s+(\d{1,2})\b/,
};

export const RULES_BY_LANG = { es: RULES_ES };

// ---------------------------------------------------------------------- helpers de tramo (spans)

/** Sustituye [start,end) por espacios (misma longitud): así el resto del texto no se desplaza y
 *  los índices siguen valiendo para los pasos siguientes, pero el tramo consumido ya no puede
 *  volver a casar con nada (ni con el propio paso que lo consumió, si se re-ejecutara). */
function blank(text, start, end) {
  return text.slice(0, start) + " ".repeat(end - start) + text.slice(end);
}

function trimSpan(text, start, end) {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return [start, end];
}

function overlapsAny(start, end, spans) {
  return spans.some(([s, e]) => start < e && end > s);
}

/** Tramos que NUNCA son un importe aunque sean dígitos sueltos: un porcentaje de reparto o una
 *  fecha numérica. Se calculan ANTES del escaneo de importe (ver cabecera del módulo). */
function reservedSpans(folded) {
  const spans = [];
  for (const m of folded.matchAll(/\b\d{1,3}\s*%/g)) spans.push([m.index, m.index + m[0].length]);
  for (const m of folded.matchAll(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g)) spans.push([m.index, m.index + m[0].length]);
  for (const m of folded.matchAll(/\bel\s+\d{1,2}\b/g)) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

// ---------------------------------------------------------------------- 1. importe

function matchSpokenNumber(tokens, i) {
  let j = i, value = 0, matched = false;
  const w1 = tokens[j]?.[0];
  if (w1 !== undefined && HUNDREDS[w1] !== undefined) { value += HUNDREDS[w1]; j++; matched = true; }
  const w2 = tokens[j]?.[0];
  if (w2 !== undefined && TENS[w2] !== undefined) {
    value += TENS[w2]; j++; matched = true;
    const y = tokens[j]?.[0];
    const u = tokens[j + 1]?.[0];
    if (y === "y" && u !== undefined && UNITS_1_9[u] !== undefined) { value += UNITS_1_9[u]; j += 2; }
  } else if (w2 !== undefined && UNITS_BARE[w2] !== undefined) {
    value += UNITS_BARE[w2]; j++; matched = true;
  }
  return matched ? { value, endIdx: j } : null;
}

function matchNumberToken(tokens, i, rules) {
  const tok = tokens[i];
  if (!tok) return null;
  if (/^\d+$/.test(tok[0])) return { value: Number(tok[0]), endIdx: i + 1 };
  if (!rules.wordNumbers) return null;
  return matchSpokenNumber(tokens, i);
}

function findAmount(folded, reserved, rules) {
  // R1: notación decimal clásica (12,50 / 12.50) — SIEMPRE con dos dígitos de céntimo, nunca uno
  // solo (evita que un "3.9" de fecha o un "12.5" ambiguo se lean como importe por accidente).
  const dec = folded.match(/\d+[.,]\d{2}(?!\d)/);
  if (dec && !overlapsAny(dec.index, dec.index + dec[0].length, reserved)) {
    const [intPart, decPart] = dec[0].split(/[.,]/);
    return { cents: Number(intPart) * 100 + Number(decPart), start: dec.index, end: dec.index + dec[0].length };
  }
  const tokens = [...folded.matchAll(/[a-z]+|\d+/g)];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (overlapsAny(tok.index, tok.index + tok[0].length, reserved)) continue;
    const euros = matchNumberToken(tokens, i, rules);
    if (!euros) continue;
    let end = euros.endIdx;
    let cents = 0;
    const sep = tokens[end];
    if (sep && rules.centsSeparators.includes(sep[0]) && !overlapsAny(sep.index, sep.index + sep[0].length, reserved)) {
      const next = tokens[end + 1];
      if (next && !overlapsAny(next.index, next.index + next[0].length, reserved)) {
        const centsMatch = matchNumberToken(tokens, end + 1, rules);
        if (centsMatch) { cents = centsMatch.value; end = centsMatch.endIdx; }
      }
    }
    const startChar = tokens[i].index;
    const endChar = tokens[end - 1].index + tokens[end - 1][0].length;
    return { cents: euros.value * 100 + cents, start: startChar, end: endChar };
  }
  return null;
}

// ---------------------------------------------------------------------- 2. compartido

function findShared(folded, rules) {
  const conMatch = folded.match(rules.sharedTrigger);
  const mediasMatch = rules.sharedAltTrigger ? folded.match(rules.sharedAltTrigger) : null;
  const pctMatch = rules.pctTrigger ? folded.match(rules.pctTrigger) : null;
  if (!conMatch && !mediasMatch && !pctMatch) return null;
  const spans = [];
  if (conMatch) spans.push([conMatch.index, conMatch.index + conMatch[0].length]);
  else if (mediasMatch) spans.push([mediasMatch.index, mediasMatch.index + mediasMatch[0].length]);
  let sharePct = null;
  if (pctMatch) { sharePct = Number(pctMatch[1]); spans.push([pctMatch.index, pctMatch.index + pctMatch[0].length]); }
  return { shared: true, sharePct, spans };
}

// ---------------------------------------------------------------------- 3. fecha

function isoFromDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDaysIso(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return isoFromDate(r);
}

function findDate(folded, todayIso, rules) {
  const todayDate = new Date(todayIso + "T12:00:00");
  let m = folded.match(rules.dayBeforeYesterdayWord);
  if (m) return { date: addDaysIso(todayDate, -2), start: m.index, end: m.index + m[0].length };
  m = folded.match(rules.yesterdayWord);
  if (m) return { date: addDaysIso(todayDate, -1), start: m.index, end: m.index + m[0].length };
  m = folded.match(rules.todayWord);
  if (m) return { date: todayIso, start: m.index, end: m.index + m[0].length };
  m = folded.match(rules.weekdayRe);
  if (m) {
    const targetDow = rules.weekdays[m[1]];
    const diff = (todayDate.getDay() - targetDow + 7) % 7;
    return { date: addDaysIso(todayDate, -diff), start: m.index, end: m.index + m[0].length };
  }
  m = folded.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) return dateFromParts(m, todayDate);
  m = folded.match(/\b(\d{1,2})-(\d{1,2})(?:-(\d{2,4}))?\b/);
  if (m) return dateFromParts(m, todayDate);
  if (rules.monthDayRe) {
    m = folded.match(rules.monthDayRe);
    if (m && rules.months[m[2]] !== undefined) {
      const d = new Date(todayDate.getFullYear(), rules.months[m[2]], Number(m[1]), 12);
      return { date: isoFromDate(d), start: m.index, end: m.index + m[0].length };
    }
  }
  if (rules.dayOnlyRe) {
    m = folded.match(rules.dayOnlyRe);
    if (m) {
      const d = new Date(todayDate.getFullYear(), todayDate.getMonth(), Number(m[1]), 12);
      return { date: isoFromDate(d), start: m.index, end: m.index + m[0].length };
    }
  }
  return { date: todayIso, start: null, end: null };
}

function dateFromParts(m, todayDate) {
  const day = Number(m[1]), month = Number(m[2]) - 1;
  const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : todayDate.getFullYear();
  const d = new Date(year, month, day, 12);
  return { date: isoFromDate(d), start: m.index, end: m.index + m[0].length };
}

// ---------------------------------------------------------------------- 4/6. cuenta y categoría por nombre literal

/** Casa el `name` de cada item contra el texto, por orden de longitud DESC (evita que un nombre
 *  corto como "N26" se coma parte de otro más largo que lo contenga). Usa `normalizeMerchant`
 *  (importada, no reescrita) para la CLAVE de casado — el mismo criterio que el resto de la app. */
function findEntityMatch(folded, items) {
  const candidates = (items ?? [])
    .map((it) => ({ it, key: normalizeMerchant(it.name) }))
    .filter((c) => c.key)
    .sort((a, b) => b.key.length - a.key.length);
  for (const { it, key } of candidates) {
    const re = new RegExp("\\b" + key.split(" ").map(escapeRegExp).join("\\s+") + "\\b");
    const m = folded.match(re);
    if (m) return { item: it, start: m.index, end: m.index + m[0].length };
  }
  return null;
}

// ---------------------------------------------------------------------- 5. comercio

function findMerchant(folded, original, rules) {
  const re = new RegExp(rules.merchantTriggerSrc + "([\\s\\S]*?)(?=\\s+(?:" + rules.stopWords.join("|") + ")\\b|$)", "d");
  const m = folded.match(re);
  if (!m) return null;
  let [start, end] = m.indices[1];
  [start, end] = trimSpan(folded, start, end);
  if (end <= start) return null;
  // Guard de alineación (spans § cabecera del módulo): fold() está pensado para preservar la
  // longitud carácter a carácter (minúsculas + quitar diacríticos, sin colapsar espacios), pero
  // si algún día una entrada rompiera esa invariante (p.ej. un carácter Unicode exótico que NFD
  // expanda a más de un código), se degrada a extraer del propio texto folded en vez de leer basura
  // del original con índices desalineados.
  const source = folded.length === original.length ? original : folded;
  return { text: source.slice(start, end).trim(), start, end };
}

// ---------------------------------------------------------------------- parser principal

const EMPTY_RESULT = (dateIso) => ({
  cents: null, merchant: null, categoryId: null, accountId: null,
  shared: false, sharePct: null, date: dateIso ?? null, spans: {},
});

export function parseNaturalExpense(text, opts = {}) {
  const {
    categories = [], accounts = [], merchants = {}, counterpartName = "", today, lang = "es",
  } = opts;
  const rules = RULES_BY_LANG[lang] ?? RULES_BY_LANG.es;
  const result = EMPTY_RESULT(today);
  try {
    const original = String(text ?? "");
    if (!original.trim()) return result;
    let folded = fold(original);

    // 1. importe
    const reserved = reservedSpans(folded);
    const amount = findAmount(folded, reserved, rules);
    if (amount) {
      result.cents = amount.cents;
      result.spans.amount = [amount.start, amount.end];
      folded = blank(folded, amount.start, amount.end);
    }

    // 2. compartido — solo si hay contraparte (spec §8.3): sin ella, «con Marta» no consume nada
    // y «Marta» no puede colarse luego como comercio.
    if (counterpartName) {
      const shared = findShared(folded, rules);
      if (shared) {
        result.shared = true;
        if (shared.sharePct != null) result.sharePct = shared.sharePct;
        result.spans.shared = shared.spans;
        for (const [s, e] of shared.spans) folded = blank(folded, s, e);
      }
    }

    // 3. fecha
    const dateFound = findDate(folded, today, rules);
    result.date = dateFound.date;
    if (dateFound.start != null) {
      result.spans.date = [dateFound.start, dateFound.end];
      folded = blank(folded, dateFound.start, dateFound.end);
    }

    // 4. cuenta
    const acc = findEntityMatch(folded, accounts);
    if (acc) {
      result.accountId = acc.item.id;
      result.spans.account = [acc.start, acc.end];
      folded = blank(folded, acc.start, acc.end);
    }

    // 5. comercio
    const merchant = findMerchant(folded, original, rules);
    if (merchant) {
      const key = normalizeMerchant(merchant.text);
      const entry = merchants?.[key];
      result.merchant = entry ? entry.display : merchant.text;
      result.spans.merchant = [merchant.start, merchant.end];
    }

    // 6. categoría — por nombre en la frase GANA a la de la memoria del comercio (spec §8.6); una
    // categoría fuera de `categories` no se devuelve nunca, ni por nombre (no está en la lista que
    // se escanea) ni por memoria (guard explícito abajo).
    const catByName = findEntityMatch(folded, categories);
    if (catByName) {
      result.categoryId = catByName.item.id;
    } else if (merchant) {
      const key = normalizeMerchant(merchant.text);
      const entry = merchants?.[key];
      if (entry?.categoryId && categories.some((c) => c.id === entry.categoryId)) {
        result.categoryId = entry.categoryId;
      }
    }
  } catch {
    return EMPTY_RESULT(today);
  }
  return result;
}
