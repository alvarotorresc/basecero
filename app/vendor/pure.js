// Fuente única de la lógica pura de import (antes vivía en apps_script/, retirado del repo en la PR E).
// Lógica pura de BaseCero, compartida entre Google Apps Script y Node (tests).
// Sintaxis compatible GAS: var + function, sin import/export.

var BC_B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function bcEncodeB32(value, length) {
  var out = "";
  for (var i = 0; i < length; i++) {
    out = BC_B32.charAt(value % 32) + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function bcUlid(nowMs, randByteFn) {
  var t = nowMs === undefined ? Date.now() : nowMs;
  var rb = randByteFn || function () { return Math.floor(Math.random() * 256); };
  var rand = "";
  for (var i = 0; i < 16; i++) rand += BC_B32.charAt(rb() % 32);
  return bcEncodeB32(t, 10) + rand;
}

function bcBuildExternalId(dateIso, amountCents, partner, reference, sha256HexFn) {
  var payload = dateIso + "|" + amountCents + "|" + (partner || "") + "|" + (reference || "");
  return sha256HexFn(payload).slice(0, 16);
}

function bcParseCsvLine(line) {
  var out = [], cur = "", inQ = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line.charAt(i);
    if (inQ) {
      if (ch === '"' && line.charAt(i + 1) === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function bcParseN26Csv(text) {
  var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ""; });
  var head = bcParseCsvLine(lines[0]);
  var ix = {
    date: head.indexOf("Booking Date"),
    partner: head.indexOf("Partner Name"),
    ref: head.indexOf("Payment Reference"),
    amount: head.indexOf("Amount (EUR)"),
  };
  if (ix.date === -1 || ix.partner === -1 || ix.ref === -1 || ix.amount === -1) {
    throw new Error("Cabecera CSV de N26 no reconocida");
  }
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    var f = bcParseCsvLine(lines[i]);
    rows.push({
      bookingDate: f[ix.date],
      partnerName: f[ix.partner],
      paymentReference: f[ix.ref],
      amountCents: Math.round(parseFloat(f[ix.amount]) * 100),
    });
  }
  return rows;
}

function bcDaysBetween(isoA, isoB) {
  return Math.abs(new Date(isoA + "T00:00:00Z") - new Date(isoB + "T00:00:00Z")) / 86400000;
}

function bcNormalizeDateIso(value, formatFn) {
  if (value && typeof value.getTime === "function") return formatFn(value);
  return String(value).slice(0, 10);
}

function bcSanitizeCell(s) {
  var t = String(s === undefined || s === null ? "" : s);
  if (t.length > 0 && (t.charAt(0) === "=" || t.charAt(0) === "+" || t.charAt(0) === "@")) return "'" + t;
  return t;
}

function bcDecideImportAction(row, existing) {
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].externalId && existing[i].externalId === row.externalId) {
      return { action: "skip" };
    }
  }
  var quiereGasto = row.amountCents < 0;
  for (var j = 0; j < existing.length; j++) {
    var t = existing[j];
    // A2 (review-seguridad-2026-08-29.md): expense/income/refund son candidatos reales de
    // conciliación — cada uno corresponde 1:1 a una única línea bancaria (un reembolso de un
    // partner es un abono normal, igual que un ingreso). Solo transfer/adjustment quedan
    // excluidos: son el defecto real de A2 — dirección ambigua/sintética frente a la cuenta
    // importada, no una única línea bancaria identificable. Sin este filtro, una transferencia
    // pendiente (siempre dinero saliente de la cuenta importada, ver n26.js signedAmountCents)
    // puede casar con un abono cualquiera del mismo importe ±3 días — el abono se pierde en
    // silencio y la transferencia queda marcada con un external_id ajeno. (Fix round 1: excluir
    // también 'refund' aquí double-counteaba dinero — un reembolso pendiente dejaba de conciliar
    // contra su abono bancario, así que el abono entraba como income NUEVO mientras el reembolso
    // seguía contando en el saldo vía accountBalance, que suma type IN ('income','refund').)
    if (t.status === "pending" && !t.externalId &&
        (t.type === "expense" || t.type === "income" || t.type === "refund") &&
        Math.abs(t.amountCents) === Math.abs(row.amountCents) &&
        (t.type === "expense") === quiereGasto &&
        bcDaysBetween(t.dateIso, row.bookingDate) <= 3) {
      return { action: "reconcile", matchId: t.id };
    }
  }
  return { action: "create" };
}

function bcResolvePickerToId(picker, categories) {
  var parts = picker.split(" → ");
  for (var i = 0; i < categories.length; i++) {
    var cat = categories[i];
    if (parts.length === 1 && cat.name === parts[0] && cat.parentId === "") return cat.id;
    if (parts.length === 2 && cat.name === parts[1] && cat.parentId !== "") {
      for (var j = 0; j < categories.length; j++) {
        if (categories[j].id === cat.parentId && categories[j].name === parts[0]) return cat.id;
      }
    }
  }
  return "";
}

function bcFirstEmptyIndex(values) {
  for (var i = 0; i < values.length; i++) {
    if (values[i] === "" || values[i] === null || values[i] === undefined) return i;
  }
  return values.length;
}

if (typeof module !== "undefined") {
  module.exports = { bcUlid: bcUlid, bcBuildExternalId: bcBuildExternalId,
    bcParseCsvLine: bcParseCsvLine, bcParseN26Csv: bcParseN26Csv,
    bcDaysBetween: bcDaysBetween, bcDecideImportAction: bcDecideImportAction,
    bcResolvePickerToId: bcResolvePickerToId, bcFirstEmptyIndex: bcFirstEmptyIndex,
    bcNormalizeDateIso: bcNormalizeDateIso, bcSanitizeCell: bcSanitizeCell };
}
