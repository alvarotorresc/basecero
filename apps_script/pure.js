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

function bcDecideImportAction(row, existing) {
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].externalId && existing[i].externalId === row.externalId) {
      return { action: "skip" };
    }
  }
  var quiereGasto = row.amountCents < 0;
  for (var j = 0; j < existing.length; j++) {
    var t = existing[j];
    if (t.status === "pending" && !t.externalId &&
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

if (typeof module !== "undefined") {
  module.exports = { bcUlid: bcUlid, bcBuildExternalId: bcBuildExternalId,
    bcParseCsvLine: bcParseCsvLine, bcParseN26Csv: bcParseN26Csv,
    bcDaysBetween: bcDaysBetween, bcDecideImportAction: bcDecideImportAction,
    bcResolvePickerToId: bcResolvePickerToId };
}
