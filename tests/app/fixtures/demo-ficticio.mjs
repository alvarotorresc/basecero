// Datos de demostración INVENTADOS para las capturas del rediseño B (plan §2, K11): se importan
// desde Ajustes → Importar. El repo es público: nada de datos reales («Marta», «Bar Pepe»…).
//
// Contenido: 1 periodo abierto y 2 cerrados; 4 cuentas (corriente, ahorro, hucha y préstamo);
// unos 40 movimientos con gastos en las 12 familias; 1 gasto compartido con «Marta»;
// 2 suscripciones; 1 etiqueta; 1 objetivo (sobre la hucha, D-impl-2).
//
// Regenerar tests/app/fixtures/demo-ficticio.xlsx (desde la raíz del repo):
//   node tests/app/fixtures/demo-ficticio.mjs
// demo-ficticio.test.mjs comprueba que el .xlsx del repo coincide con lo que construye este script
// y que pasa validateImport.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { CONTRACT, insertSql } from "../../../app/app/js/contract.js";
import { seedStatements } from "../../../app/app/js/seeds.js";
import { rowsToWorkbook } from "../../../app/app/js/xlsx.js";

export const XLSX_PATH = fileURLToPath(new URL("./demo-ficticio.xlsx", import.meta.url));
const T = "2026-09-01T09:00:00.000Z"; // marca de tiempo fija: el fichero sale igual en cada regeneración

const DEFAULTS = {
  accounts: { opening_balance_cents: 0, display_order: 0, is_archived: 0 },
  periods: { end_date: "", my_share_pct: 50, notes: "" },
  transactions: { counter_account_id: "", category_id: "", merchant: "", note: "", is_shared: 0,
    share_pct_override: null, paid_by: "me", settled: 0, ref_id: "", rule_id: "", tag_id: "",
    external_id: "", has_attachment: 0, status: "pending" },
  recurring_rules: { category_id: "", counter_account_id: "", due_day: null, due_month: null,
    is_shared: 0, is_active: 1, is_subscription: 0, cancelled_at: "" },
  goals: { target_amount_cents: null, target_months: null, target_pct: null, target_date: "",
    account_id: "", category_id: "", is_active: 1 },
  budgets: {},
  tags: { budget_cents: null, is_archived: 0 },
};

export function buildDemoDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../../../app/app/js/schema.sql", import.meta.url), "utf8"));
  for (const { sql, rows } of seedStatements(T, "es")) for (const r of rows) db.prepare(sql).run(...r);

  const ins = (table, row) => {
    const full = { ...DEFAULTS[table], ...row, created_at: T, updated_at: T, deleted: 0 };
    db.prepare(insertSql(table)).run(...CONTRACT[table].cols.map((c) => full[c]));
  };
  const meta = (key, value) => db.prepare("UPDATE meta SET value=? WHERE key=?").run(value, key);
  meta("partner_name", "Marta");
  meta("default_account_id", "acc-corriente");
  meta("lang", "es");
  meta("account_loans", JSON.stringify({ "acc-prestamo": { monthlyCents: 18000 } }));

  ins("accounts", { id: "acc-corriente", name: "Cuenta corriente", type: "checking", opening_balance_cents: 185000, display_order: 1 });
  ins("accounts", { id: "acc-ahorro", name: "Ahorro", type: "savings", opening_balance_cents: 420000, display_order: 2 });
  ins("accounts", { id: "acc-hucha", name: "Hucha", type: "savings", opening_balance_cents: 30000, display_order: 3 });
  ins("accounts", { id: "acc-prestamo", name: "Préstamo coche", type: "liability", opening_balance_cents: -540000, display_order: 4 });

  ins("periods", { id: "per-2026-07", name: "Julio 2026", start_date: "2026-07-01", end_date: "2026-07-31", status: "closed" });
  ins("periods", { id: "per-2026-08", name: "Agosto 2026", start_date: "2026-08-01", end_date: "2026-08-31", status: "closed" });
  ins("periods", { id: "per-2026-09", name: "Septiembre 2026", start_date: "2026-09-01", status: "open" });

  ins("tags", { id: "tag-cadiz", name: "Viaje a Cádiz", budget_cents: 60000 });
  ins("goals", { id: "goal-vacaciones", name: "Vacaciones", type: "savings_target", target_amount_cents: 150000, target_date: "2027-06-30", account_id: "acc-hucha" });
  ins("budgets", { id: "bud-restauracion", period_id: "per-2026-09", category_id: "cat-restauracion", amount_cents: 15000 });
  ins("budgets", { id: "bud-alimentacion", period_id: "per-2026-09", category_id: "cat-alimentacion", amount_cents: 35000 });

  ins("recurring_rules", { id: "rule-cine", name: "Cine en casa", type: "expense", amount_cents: 1299, category_id: "cat-suscripciones-streaming", account_id: "acc-corriente", frequency: "monthly", due_day: 5, is_subscription: 1 });
  ins("recurring_rules", { id: "rule-nube", name: "Nube de fotos", type: "expense", amount_cents: 299, category_id: "cat-suscripciones-software", account_id: "acc-corriente", frequency: "monthly", due_day: 12, is_subscription: 1 });

  // [id, fecha, periodo, tipo, céntimos, cuenta, categoría, comercio, extra]
  const tx = [
    // Julio (cerrado)
    ["tx-01", "2026-07-01", "per-2026-07", "income", 210000, "acc-corriente", "cat-nomina", "Nómina"],
    ["tx-02", "2026-07-02", "per-2026-07", "expense", 65000, "acc-corriente", "cat-casa-alquiler", "Alquiler piso"],
    ["tx-03", "2026-07-04", "per-2026-07", "expense", 7420, "acc-corriente", "cat-alimentacion-supermercado", "Súper Lola"],
    ["tx-04", "2026-07-05", "per-2026-07", "expense", 1299, "acc-corriente", "cat-suscripciones-streaming", "Cine en casa", { rule_id: "rule-cine" }],
    ["tx-05", "2026-07-09", "per-2026-07", "expense", 2350, "acc-corriente", "cat-restauracion-bares", "Bar Pepe"],
    ["tx-06", "2026-07-12", "per-2026-07", "expense", 299, "acc-corriente", "cat-suscripciones-software", "Nube de fotos", { rule_id: "rule-nube" }],
    ["tx-07", "2026-07-15", "per-2026-07", "expense", 5200, "acc-corriente", "cat-transporte-gasolina", "Gasolinera Norte"],
    ["tx-08", "2026-07-20", "per-2026-07", "expense", 3990, "acc-corriente", "cat-ropa", "Tienda Alba"],
    ["tx-09", "2026-07-27", "per-2026-07", "transfer", 18000, "acc-corriente", "", "Cuota préstamo", { counter_account_id: "acc-prestamo" }],
    ["tx-10", "2026-07-28", "per-2026-07", "transfer", 10000, "acc-corriente", "", "A la hucha", { counter_account_id: "acc-hucha" }],
    // Agosto (cerrado)
    ["tx-11", "2026-08-01", "per-2026-08", "income", 210000, "acc-corriente", "cat-nomina", "Nómina"],
    ["tx-12", "2026-08-02", "per-2026-08", "expense", 65000, "acc-corriente", "cat-casa-alquiler", "Alquiler piso"],
    ["tx-13", "2026-08-05", "per-2026-08", "expense", 1299, "acc-corriente", "cat-suscripciones-streaming", "Cine en casa", { rule_id: "rule-cine" }],
    ["tx-14", "2026-08-06", "per-2026-08", "expense", 8815, "acc-corriente", "cat-alimentacion-supermercado", "Súper Lola"],
    ["tx-15", "2026-08-08", "per-2026-08", "expense", 12400, "acc-corriente", "cat-ocio-viajes", "Hostal La Caleta", { tag_id: "tag-cadiz" }],
    ["tx-16", "2026-08-09", "per-2026-08", "expense", 4680, "acc-corriente", "cat-restauracion-restaurantes", "Casa Paco", { tag_id: "tag-cadiz" }],
    ["tx-17", "2026-08-12", "per-2026-08", "expense", 299, "acc-corriente", "cat-suscripciones-software", "Nube de fotos", { rule_id: "rule-nube" }],
    ["tx-18", "2026-08-14", "per-2026-08", "expense", 2500, "acc-corriente", "cat-regalos", "Floristería Rosa"],
    ["tx-19", "2026-08-18", "per-2026-08", "expense", 1640, "acc-corriente", "cat-salud-farmacia", "Farmacia Sol"],
    ["tx-20", "2026-08-21", "per-2026-08", "expense", 3200, "acc-corriente", "cat-casa-luz", "Luz"],
    ["tx-21", "2026-08-27", "per-2026-08", "transfer", 18000, "acc-corriente", "", "Cuota préstamo", { counter_account_id: "acc-prestamo" }],
    ["tx-22", "2026-08-28", "per-2026-08", "transfer", 10000, "acc-corriente", "", "A la hucha", { counter_account_id: "acc-hucha" }],
    ["tx-23", "2026-08-31", "per-2026-08", "income", 410, "acc-ahorro", "cat-intereses", "Intereses"],
    // Septiembre (abierto)
    ["tx-24", "2026-09-01", "per-2026-09", "income", 210000, "acc-corriente", "cat-nomina", "Nómina"],
    ["tx-25", "2026-09-02", "per-2026-09", "expense", 65000, "acc-corriente", "cat-casa-alquiler", "Alquiler piso"],
    ["tx-26", "2026-09-03", "per-2026-09", "expense", 6230, "acc-corriente", "cat-alimentacion-supermercado", "Súper Lola"],
    ["tx-27", "2026-09-04", "per-2026-09", "expense", 1850, "acc-corriente", "cat-restauracion-bares", "Bar Pepe"],
    ["tx-28", "2026-09-05", "per-2026-09", "expense", 1299, "acc-corriente", "cat-suscripciones-streaming", "Cine en casa", { rule_id: "rule-cine" }],
    ["tx-29", "2026-09-06", "per-2026-09", "expense", 4800, "acc-corriente", "cat-restauracion-restaurantes", "Casa Paco",
      { is_shared: 1, note: "Cena con Marta" }],
    ["tx-30", "2026-09-07", "per-2026-09", "expense", 1200, "acc-corriente", "cat-transporte-publico", "Bono bus"],
    ["tx-31", "2026-09-08", "per-2026-09", "expense", 38000, "acc-corriente", "cat-coche-seguro", "Seguro coche"],
    ["tx-32", "2026-09-09", "per-2026-09", "expense", 3500, "acc-corriente", "cat-salud-gimnasio", "Gimnasio Barrio"],
    ["tx-33", "2026-09-10", "per-2026-09", "expense", 2400, "acc-corriente", "cat-ocio-planes", "Cine Plaza"],
    ["tx-34", "2026-09-11", "per-2026-09", "expense", 9500, "acc-corriente", "cat-impuestos", "Tasa de basuras"],
    ["tx-35", "2026-09-12", "per-2026-09", "expense", 299, "acc-corriente", "cat-suscripciones-software", "Nube de fotos", { rule_id: "rule-nube" }],
    ["tx-36", "2026-09-13", "per-2026-09", "expense", 1575, "acc-corriente", "cat-otros", "Ferretería Pino"],
    ["tx-37", "2026-09-14", "per-2026-09", "expense", 2890, "acc-corriente", "cat-ropa", "Tienda Alba"],
    ["tx-38", "2026-09-15", "per-2026-09", "expense", 1990, "acc-corriente", "cat-regalos", "Librería Luna"],
    ["tx-39", "2026-09-16", "per-2026-09", "expense", 4150, "acc-corriente", "cat-alimentacion-supermercado", "Mercado Central"],
    ["tx-40", "2026-09-17", "per-2026-09", "expense", 4700, "acc-corriente", "cat-transporte-gasolina", "Gasolinera Norte"],
    ["tx-41", "2026-09-18", "per-2026-09", "transfer", 10000, "acc-corriente", "", "A la hucha", { counter_account_id: "acc-hucha" }],
  ];
  for (const [id, date, period_id, type, amount_cents, account_id, category_id, merchant, extra = {}] of tx) {
    ins("transactions", { id, date, period_id, type, amount_cents, account_id, category_id, merchant, ...extra });
  }
  return db;
}

export function dumpDemo(db = buildDemoDb()) {
  const out = {};
  for (const t of Object.keys(CONTRACT)) out[t] = db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();
  return out;
}

export function buildDemoWorkbook(X) {
  return rowsToWorkbook(X, dumpDemo());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const X = createRequire(import.meta.url)("../../../app/app/vendor/xlsx/xlsx.full.min.js");
  writeFileSync(XLSX_PATH, X.write(buildDemoWorkbook(X), { type: "buffer", bookType: "xlsx" }));
  console.log("escrito", XLSX_PATH);
}
