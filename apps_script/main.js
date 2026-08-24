// Pegamento de Google Apps Script. Requiere pure.js en el mismo proyecto.
var BC_DATA_SHEETS = ["accounts", "categories", "periods", "transactions",
                      "recurring_rules", "goals", "budgets"];

function onOpen() {
  SpreadsheetApp.getUi().createMenu("BaseCero")
    .addItem("Importar CSV de N26…", "abrirDialogoImport")
    .addToUi();
}

function gasSha256Hex(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s,
                                      Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    return ((b + 256) % 256).toString(16).padStart(2, "0");
  }).join("");
}

function bcNowIso() {
  return Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

function bcHeaderIndex(sheet) {
  var head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var ix = {};
  head.forEach(function (h, i) { ix[h] = i + 1; });
  return ix;
}

function bcLookupIdByName(sheetName, name) {
  var vals = SpreadsheetApp.getActive().getSheetByName(sheetName)
    .getRange("A2:B200").getValues();
  for (var i = 0; i < vals.length; i++) if (vals[i][1] === name) return vals[i][0];
  return "";
}

function bcOpenPeriodId() {
  var vals = SpreadsheetApp.getActive().getSheetByName("periods")
    .getRange("A2:E100").getValues();
  for (var i = 0; i < vals.length; i++) if (vals[i][4] === "open") return vals[i][0];
  return "";
}

function bcCategoriesForPicker() {
  var vals = SpreadsheetApp.getActive().getSheetByName("categories")
    .getRange("A2:C300").getValues();
  return vals.filter(function (v) { return v[0] !== ""; })
    .map(function (v) { return { id: v[0], name: v[1], parentId: v[2] || "" }; });
}

// Trigger INSTALABLE (Editor GAS > Triggers > onEditInstalable, evento "Al editar").
function onEditInstalable(e) {
  var sheet = e.range.getSheet();
  if (BC_DATA_SHEETS.indexOf(sheet.getName()) < 0) return;
  var ix = bcHeaderIndex(sheet);
  var startRow = e.range.getRow();
  var endRow = e.range.getRow() + e.range.getNumRows() - 1;
  for (var row = startRow; row <= endRow; row++) {
    if (row < 2) continue;
    var now = bcNowIso();
    if (sheet.getRange(row, ix["id"]).getValue() === "") {
      sheet.getRange(row, ix["id"]).setValue(bcUlid());
      sheet.getRange(row, ix["created_at"]).setValue(now);
      if (ix["deleted"]) sheet.getRange(row, ix["deleted"]).setValue(false);
    }
    sheet.getRange(row, ix["updated_at"]).setValue(now);
    if (sheet.getName() !== "transactions") continue;
    if (sheet.getRange(row, ix["date"]).getValue() === "") {
      sheet.getRange(row, ix["date"]).setValue(
        Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"));
    }
    if (sheet.getRange(row, ix["period_id"]).getValue() === "") {
      sheet.getRange(row, ix["period_id"]).setValue(bcOpenPeriodId());
    }
    if (sheet.getRange(row, ix["status"]).getValue() === "") {
      sheet.getRange(row, ix["status"]).setValue("pending");
    }
    var pares = [["_account", "account_id", "accounts"],
                 ["_counter_account", "counter_account_id", "accounts"],
                 ["_rule", "rule_id", "recurring_rules"]];
    pares.forEach(function (par) {
      var visible = sheet.getRange(row, ix[par[0]]).getValue();
      if (visible !== "" && sheet.getRange(row, ix[par[1]]).getValue() === "") {
        sheet.getRange(row, ix[par[1]]).setValue(bcLookupIdByName(par[2], visible));
      }
    });
    var picker = sheet.getRange(row, ix["_category"]).getValue();
    if (picker !== "" && sheet.getRange(row, ix["category_id"]).getValue() === "") {
      sheet.getRange(row, ix["category_id"]).setValue(
        bcResolvePickerToId(picker, bcCategoriesForPicker()));
    }
  }
}

function abrirDialogoImport() {
  var html = HtmlService.createHtmlOutput(
    '<textarea id="t" rows="15" style="width:100%"></textarea><br>' +
    '<button onclick="google.script.run.withFailureHandler(function(e){' +
    'document.body.innerHTML=\'Error: \'+e.message;}).withSuccessHandler(function(m){' +
    'document.body.innerHTML=m;}).processN26Csv(' +
    'document.getElementById(\'t\').value)">Importar</button>')
    .setWidth(520).setHeight(360);
  SpreadsheetApp.getUi().showModalDialog(html, "Pega aquí el CSV de N26");
}

function processN26Csv(text) {
  var sheet = SpreadsheetApp.getActive().getSheetByName("transactions");
  var ix = bcHeaderIndex(sheet);
  var last = sheet.getLastRow();
  var n26Id = bcLookupIdByName("accounts", "N26");
  var existing = [];
  if (last >= 2) {
    var vals = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
    vals.forEach(function (v, i) {
      if (v[ix["id"] - 1] === "") return;
      if (v[ix["account_id"] - 1] !== n26Id) return;
      existing.push({ id: v[ix["id"] - 1], rowNum: i + 2,
        dateIso: bcNormalizeDateIso(v[ix["date"] - 1], function (d) {
          return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
        }),
        type: v[ix["type"] - 1],
        amountCents: Math.round((parseFloat(v[ix["amount"] - 1]) || 0) * 100) *
          (v[ix["type"] - 1] === "expense" ? -1 : 1),
        externalId: v[ix["external_id"] - 1], status: v[ix["status"] - 1] });
    });
  }
  var rows = bcParseN26Csv(text);
  var res = { skip: 0, reconcile: 0, create: 0 };
  var now = bcNowIso();
  rows.forEach(function (r) {
    r.externalId = bcBuildExternalId(r.bookingDate, r.amountCents, r.partnerName,
                                     r.paymentReference, gasSha256Hex);
    var d = bcDecideImportAction(r, existing);
    res[d.action]++;
    if (d.action === "reconcile") {
      var m = existing.filter(function (t) { return t.id === d.matchId; })[0];
      sheet.getRange(m.rowNum, ix["external_id"]).setValue(r.externalId);
      sheet.getRange(m.rowNum, ix["status"]).setValue("reconciled");
      sheet.getRange(m.rowNum, ix["updated_at"]).setValue(now);
      m.externalId = r.externalId;
    } else if (d.action === "create") {
      var idVals = sheet.getRange(2, ix["id"], Math.max(1, sheet.getLastRow() - 1), 1)
        .getValues().map(function (r) { return r[0]; });
      var newRow = 2 + bcFirstEmptyIndex(idVals);
      var set = function (colName, value) {
        sheet.getRange(newRow, ix[colName]).setValue(value);
      };
      set("id", bcUlid()); set("date", r.bookingDate);
      set("period_id", bcOpenPeriodId());
      set("type", r.amountCents < 0 ? "expense" : "income");
      set("amount", Math.abs(r.amountCents) / 100);
      set("_account", "N26"); set("account_id", bcLookupIdByName("accounts", "N26"));
      set("merchant", bcSanitizeCell(r.partnerName)); set("note", bcSanitizeCell(r.paymentReference));
      set("external_id", r.externalId); set("status", "reconciled");
      set("created_at", now); set("updated_at", now); set("deleted", false);
      existing.push({ id: "nuevo", rowNum: newRow, dateIso: r.bookingDate,
        type: r.amountCents < 0 ? "expense" : "income", amountCents: r.amountCents,
        externalId: r.externalId, status: "reconciled" });
    }
  });
  return "Importado. Nuevas: " + res.create + " · Conciliadas: " + res.reconcile +
         " · Duplicadas (saltadas): " + res.skip +
         ". Revisa la bandeja «sin categorizar» y reclasifica a refund los Bizum de Sara.";
}
