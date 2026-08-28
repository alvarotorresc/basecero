// Módulo ES puro (Task 4, PR E): sniff/mapeo/parseo genérico de CSV para bancos sin soporte
// dedicado. CERO imports — toda función que necesite trocear líneas CSV recibe `parseLine` como
// parámetro (patrón externalIdFor de n26.js): el navegador pasa el global `bcParseCsvLine`
// (vendor/pure.js), los tests el require de ese mismo fichero. Nada de este módulo toca DB/DOM.
//
// El perfil guardado en meta.csv_profile (Decisión 1 del plan, docs/superpowers/plans/
// 2026-08-28-pr-e-import-generico.md) tiene esta forma exacta:
//   { headers: string[], date: string, dateFormat: "iso"|"dmy-slash"|"dmy-dot"|"dmy-dash",
//     concept: string, counterparty: string|null,
//     amount: { kind:"single", col: string, decimal: ","|"." }
//           | { kind:"split", debit: string, credit: string, decimal: ","|"." } }
// Match de perfil = igualdad EXACTA del array de cabeceras (profileMatches).

// Cabeceras EXACTAS del CSV de N26 actual (ver tests/app/fixtures/n26_sample.csv línea 1). Sirven
// para reconocer el camino N26 (bcParseN26Csv, intacto) sin pasar por el asistente de mapeo.
const N26_HEADERS = ["Booking Date", "Value Date", "Partner Name", "Partner Iban", "Type",
  "Payment Reference", "Account Name", "Amount (EUR)", "Original Amount", "Original Currency",
  "Exchange Rate"];

export function isN26Headers(headers) {
  if (!Array.isArray(headers) || headers.length !== N26_HEADERS.length) return false;
  return N26_HEADERS.every((h, i) => h === headers[i]);
}

// Trocea el texto en líneas no vacías (mismo criterio que bcParseN26Csv), cabecera + hasta 5 filas
// de muestra para el asistente/autodetección — filas en blanco quedan fuera desde el split.
function nonEmptyLines(text) {
  return String(text ?? "").split(/\r?\n/).filter((l) => l.trim() !== "");
}

export function sniffCsv(text, parseLine) {
  const lines = nonEmptyLines(text);
  if (lines.length === 0) return { headers: [], sample: [] };
  return { headers: parseLine(lines[0]), sample: lines.slice(1, 6).map((l) => parseLine(l)) };
}

// ---------------------------------------------------------------------- fechas

// Cada patrón captura día/mes/año en el orden que corresponda a su formato; dayIdx/monthIdx
// indexan los grupos de captura para poder validar rango sin duplicar el regex.
const DATE_PATTERNS = [
  { fmt: "iso", re: /^(\d{4})-(\d{2})-(\d{2})$/, yearIdx: 1, monthIdx: 2, dayIdx: 3 },
  { fmt: "dmy-slash", re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, dayIdx: 1, monthIdx: 2, yearIdx: 3 },
  { fmt: "dmy-dot", re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, dayIdx: 1, monthIdx: 2, yearIdx: 3 },
  { fmt: "dmy-dash", re: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, dayIdx: 1, monthIdx: 2, yearIdx: 3 },
];

function isPlausibleDayMonth(day, month) {
  return Number.isInteger(day) && Number.isInteger(month) && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function nonEmptyValues(values) {
  return (values || []).filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
}

// Gana el PRIMER formato (orden de DATE_PATTERNS) que parsea TODAS las muestras no vacías. Sin
// distinción día/mes vs mes/día en el enum (solo hay variantes día/mes): una fecha ambigua como
// "01/02/2026" siempre entra por dmy-slash, con o sin fila que la desambigüe (día>12) en la
// muestra — eso es justo "si nada desambigua, se asume día/mes" (Decisión 3 del plan).
export function detectDateFormat(values) {
  const samples = nonEmptyValues(values);
  if (samples.length === 0) return null;
  for (const pat of DATE_PATTERNS) {
    const allValid = samples.every((raw) => {
      const m = pat.re.exec(String(raw).trim());
      if (!m) return false;
      return isPlausibleDayMonth(Number(m[pat.dayIdx]), Number(m[pat.monthIdx]));
    });
    if (allValid) return pat.fmt;
  }
  return null;
}

export function parseDateIso(raw, fmt) {
  if (raw === null || raw === undefined) return null;
  const pat = DATE_PATTERNS.find((p) => p.fmt === fmt);
  if (!pat) return null;
  const m = pat.re.exec(String(raw).trim());
  if (!m) return null;
  const day = Number(m[pat.dayIdx]);
  const month = Number(m[pat.monthIdx]);
  if (!isPlausibleDayMonth(day, month)) return null;
  return `${m[pat.yearIdx]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------- importes

// Heurística: en cada valor, el separador (coma o punto) que aparece MÁS A LA DERECHA es el
// decimal (el otro, si lo hay, es de miles). "1.234,56" → coma gana (posición 6 > posición 1);
// "1,234.56" → punto gana. Empate (o sin separadores) → coma, por defecto es-ES de la app.
export function detectDecimal(values) {
  let commaWins = 0, dotWins = 0;
  for (const raw of nonEmptyValues(values)) {
    const s = String(raw).trim();
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) commaWins++;
    else if (lastDot > lastComma) dotWins++;
  }
  return dotWins > commaWins ? "." : ",";
}

// Soporta guion normal "-" y signo menos U+2212 (bancos exportan ambos), separador de miles
// tolerado (se elimina) y `decimal` fijo (no autodetectado aquí: eso es cosa de detectDecimal /
// buildProfile). Devuelve céntimos con signo, o null si `raw` no es un importe reconocible.
export function parseAmountCents(raw, decimal) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim().replace(/−/g, "-");
  if (s === "") return null;
  let sign = 1;
  if (s.startsWith("-")) { sign = -1; s = s.slice(1); }
  else if (s.startsWith("+")) { s = s.slice(1); }
  const thousands = decimal === "," ? "." : ",";
  s = s.split(thousands).join("");
  if (decimal !== ".") s = s.split(decimal).join(".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [intPart, fracPart = ""] = s.split(".");
  const cents = Number(intPart) * 100 + Number((fracPart + "00").slice(0, 2));
  return sign * cents;
}

// ---------------------------------------------------------------------- perfil

const AMOUNT_KEYS_SINGLE = ["kind", "col", "decimal"];
const AMOUNT_KEYS_SPLIT = ["kind", "debit", "credit", "decimal"];
const DATE_FORMATS = new Set(DATE_PATTERNS.map((p) => p.fmt));
const DECIMALS = new Set([",", "."]);
const PROFILE_KEYS = ["headers", "date", "dateFormat", "concept", "counterparty", "amount"];

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// "" y null/undefined se tratan como "sin contraparte": el perfil NUNCA guarda "" (Decisión 1:
// counterparty es "<cabecera>"|null), así parseCsvProfile no tiene que aceptar dos formas del
// mismo "nada".
function normalizeCounterparty(counterparty) {
  return counterparty === null || counterparty === undefined || counterparty === "" ? null : counterparty;
}

// Autodetecta dateFormat/decimal contra `sample` y los FIJA en el perfil; valida que las
// cabeceras elegidas existan de verdad en `headers`. Cualquier fallo → {error}, nunca throw (lo
// consume la UI del asistente, Task 6, para mostrar la nota de validación).
export function buildProfile({ headers, date, concept, counterparty, amountKind, amountCol,
  debitCol, creditCol, sample }) {
  if (!Array.isArray(headers)) return { error: "cabeceras inválidas" };
  const idx = (h) => headers.indexOf(h);
  const rows = Array.isArray(sample) ? sample : [];

  if (date === "" || idx(date) === -1) return { error: `columna de fecha inexistente: «${date}»` };
  if (concept === "" || idx(concept) === -1) return { error: `columna de concepto inexistente: «${concept}»` };
  const cp = normalizeCounterparty(counterparty);
  if (cp !== null && (cp === "" || idx(cp) === -1)) return { error: `columna de contraparte inexistente: «${cp}»` };

  let amount;
  let amountSampleValues;
  if (amountKind === "single") {
    if (amountCol === "" || idx(amountCol) === -1) return { error: `columna de importe inexistente: «${amountCol}»` };
    const ai = idx(amountCol);
    amountSampleValues = rows.map((r) => r[ai]);
    amount = { kind: "single", col: amountCol };
  } else if (amountKind === "split") {
    if (debitCol === "" || idx(debitCol) === -1) return { error: `columna de cargo inexistente: «${debitCol}»` };
    if (creditCol === "" || idx(creditCol) === -1) return { error: `columna de abono inexistente: «${creditCol}»` };
    const di = idx(debitCol), ci = idx(creditCol);
    amountSampleValues = rows.flatMap((r) => [r[di], r[ci]]);
    amount = { kind: "split", debit: debitCol, credit: creditCol };
  } else {
    return { error: `tipo de importe desconocido: «${amountKind}»` };
  }

  const dateSampleValues = rows.map((r) => r[idx(date)]);
  const dateFormat = detectDateFormat(dateSampleValues);
  if (!dateFormat) return { error: "la muestra no tiene ninguna fecha válida para autodetectar el formato" };

  amount.decimal = detectDecimal(amountSampleValues);
  return { headers: [...headers], date, dateFormat, concept, counterparty: cp, amount };
}

// Salta la cabecera; filas con fecha o importe inválidos van a `errors` (con el nº de línea del
// fichero, cabecera=1) y NO rompen el import del resto. Índices de columna se resuelven contra la
// cabecera REAL del `text` (no contra profile.headers): más robusto si algún caller no ha pasado
// por profileMatches todavía, y de paso hace las pruebas más naturales.
export function applyProfile(text, profile, parseLine) {
  const lines = nonEmptyLines(text);
  const rows = [];
  const errors = [];
  if (lines.length === 0) return { rows, errors };

  const header = parseLine(lines[0]);
  const dateIdx = header.indexOf(profile.date);
  const conceptIdx = header.indexOf(profile.concept);
  const counterpartyIdx = profile.counterparty ? header.indexOf(profile.counterparty) : -1;
  const isSplit = profile.amount.kind === "split";
  const amountIdx = isSplit ? -1 : header.indexOf(profile.amount.col);
  const debitIdx = isSplit ? header.indexOf(profile.amount.debit) : -1;
  const creditIdx = isSplit ? header.indexOf(profile.amount.credit) : -1;
  const decimal = profile.amount.decimal;

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const cells = parseLine(lines[i]);

    const bookingDate = parseDateIso(cells[dateIdx], profile.dateFormat);
    if (!bookingDate) { errors.push({ line: lineNo, reason: "fecha inválida" }); continue; }

    let amountCents;
    if (!isSplit) {
      amountCents = parseAmountCents(cells[amountIdx], decimal);
      if (amountCents === null) { errors.push({ line: lineNo, reason: "importe inválido" }); continue; }
    } else {
      const debitRaw = cells[debitIdx];
      const creditRaw = cells[creditIdx];
      const hasDebit = debitRaw !== undefined && String(debitRaw).trim() !== "";
      const hasCredit = creditRaw !== undefined && String(creditRaw).trim() !== "";
      if (hasDebit && hasCredit) { errors.push({ line: lineNo, reason: "cargo y abono con valor a la vez" }); continue; }
      if (!hasDebit && !hasCredit) { errors.push({ line: lineNo, reason: "cargo y abono vacíos" }); continue; }
      const parsed = parseAmountCents(hasDebit ? debitRaw : creditRaw, decimal);
      if (parsed === null) { errors.push({ line: lineNo, reason: "importe inválido" }); continue; }
      amountCents = hasDebit ? -Math.abs(parsed) : Math.abs(parsed);
    }

    rows.push({
      bookingDate,
      partnerName: counterpartyIdx !== -1 ? (cells[counterpartyIdx] ?? "") : "",
      paymentReference: cells[conceptIdx] ?? "",
      amountCents,
    });
  }
  return { rows, errors };
}

function validAmountShape(v) {
  if (!isPlainObject(v)) return false;
  const keys = Object.keys(v);
  if (v.kind === "single") {
    return keys.length === AMOUNT_KEYS_SINGLE.length && keys.every((k) => AMOUNT_KEYS_SINGLE.includes(k)) &&
      typeof v.col === "string" && v.col !== "" && DECIMALS.has(v.decimal);
  }
  if (v.kind === "split") {
    return keys.length === AMOUNT_KEYS_SPLIT.length && keys.every((k) => AMOUNT_KEYS_SPLIT.includes(k)) &&
      typeof v.debit === "string" && v.debit !== "" && typeof v.credit === "string" && v.credit !== "" &&
      DECIMALS.has(v.decimal);
  }
  return false;
}

// try/catch + validación de FORMA COMPLETA (lección del hardening de la PR anterior, precedente
// sanitizeStyleMap en app/js/category-colors.js): claves conocidas y SOLO esas, tipos correctos,
// kind ∈ {single,split}, dateFormat ∈ el enum, decimal ∈ {",","."}, headers array de strings.
// Cualquier desviación → null (drop silencioso), nunca throw. El objeto de salida se construye
// campo a campo desde `parsed` (nunca copiando claves genéricas) — igual que sanitizeStyleMap,
// eso hace inocua una clave "__proto__" en el JSON de entrada (JSON.parse la deja como propiedad
// propia normal, pero jamás la asignamos por [] a nuestro objeto de salida).
export function parseCsvProfile(json) {
  let parsed;
  try { parsed = JSON.parse(json); } catch { return null; }
  if (!isPlainObject(parsed)) return null;

  const keys = Object.keys(parsed);
  if (keys.length !== PROFILE_KEYS.length) return null;
  if (!keys.every((k) => PROFILE_KEYS.includes(k))) return null;

  if (!Array.isArray(parsed.headers) || !parsed.headers.every((h) => typeof h === "string")) return null;
  if (typeof parsed.date !== "string" || parsed.date === "") return null;
  if (!DATE_FORMATS.has(parsed.dateFormat)) return null;
  if (typeof parsed.concept !== "string" || parsed.concept === "") return null;
  if (!(parsed.counterparty === null || (typeof parsed.counterparty === "string" && parsed.counterparty !== ""))) return null;
  if (!validAmountShape(parsed.amount)) return null;

  // Un perfil editado a mano puede tener cabeceras válidas por fuera (profileMatches solo compara
  // ese array) pero columnas interiores que ya no existen en `headers` — hay que comprobarlas aquí
  // o el import falla en silencio con "0 nuevas · N filas ilegibles".
  if (!parsed.headers.includes(parsed.date)) return null;
  if (!parsed.headers.includes(parsed.concept)) return null;
  if (parsed.counterparty !== null && !parsed.headers.includes(parsed.counterparty)) return null;
  if (parsed.amount.kind === "single") {
    if (!parsed.headers.includes(parsed.amount.col)) return null;
  } else {
    if (!parsed.headers.includes(parsed.amount.debit) || !parsed.headers.includes(parsed.amount.credit)) return null;
  }

  return {
    headers: [...parsed.headers],
    date: parsed.date,
    dateFormat: parsed.dateFormat,
    concept: parsed.concept,
    counterparty: parsed.counterparty,
    amount: parsed.amount.kind === "single"
      ? { kind: "single", col: parsed.amount.col, decimal: parsed.amount.decimal }
      : { kind: "split", debit: parsed.amount.debit, credit: parsed.amount.credit, decimal: parsed.amount.decimal },
  };
}

// Match de perfil = igualdad EXACTA del array de cabeceras, orden incluido (Decisión 1).
export function profileMatches(profile, headers) {
  if (!profile || !Array.isArray(profile.headers) || !Array.isArray(headers)) return false;
  if (profile.headers.length !== headers.length) return false;
  return profile.headers.every((h, i) => h === headers[i]);
}
