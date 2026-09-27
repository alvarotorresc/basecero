// ===== Datos de las capturas =====
//
// Parte de los datos inventados del repo (tests/app/fixtures/demo-ficticio.mjs, el mismo builder
// que genera demo-ficticio.xlsx) y escribe dos libros en media/.cache/ para importarlos:
//
//  - Los dos llevan límites en todas las familias con gasto. El fixture solo trae dos (Restauración
//    y Alimentación, 500 € en total) y el alquiler ya los rebasa, así que Inicio diría «Hoy puedes
//    gastar 0,00 €, te has pasado 969,83 €»: cierto para los datos, pero no es el mes que se enseña.
//    Con estos límites el Display reparte lo que queda entre los días del periodo.
//  - El inglés traduce además los nombres que el usuario escribiría (cuentas, comercios, periodos,
//    etiqueta, objetivo, suscripciones) y fija el formato en-GB. Las categorías NO se tocan aquí:
//    las retraduce la propia app al cambiar el idioma en Ajustes (shots.mjs).
//
// Mismos ids, importes y fechas que el fixture: solo cambian nombres y límites.

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { REPO_ROOT, MEDIA } from "./lib.mjs";
import { buildDemoDb, dumpDemo } from "../tests/app/fixtures/demo-ficticio.mjs";
import { rowsToWorkbook } from "../app/app/js/xlsx.js";

const T = "2026-09-01T09:00:00.000Z";

// Límites del periodo abierto por familia (céntimos). Suman 2.000 € de una nómina de 2.100 €.
const LIMITS = {
  "cat-casa": 68000, "cat-coche": 40000, "cat-transporte": 11000, "cat-salud": 5000,
  "cat-suscripciones": 2000, "cat-ocio": 5000, "cat-ropa": 4000, "cat-regalos": 3000,
  "cat-impuestos": 12000,
};

const EN = {
  accounts: { "acc-corriente": "Current account", "acc-ahorro": "Savings", "acc-hucha": "Holiday jar", "acc-prestamo": "Car loan" },
  periods: { "per-2026-07": "July 2026", "per-2026-08": "August 2026", "per-2026-09": "September 2026" },
  tags: { "tag-cadiz": "Trip to Cádiz" },
  goals: { "goal-vacaciones": "Holidays" },
  recurring_rules: { "rule-cine": "Movie streaming", "rule-nube": "Photo cloud" },
  merchants: {
    "Nómina": "Salary", "Alquiler piso": "Flat rent", "Súper Lola": "Lola's Market", "Cine en casa": "Movie streaming",
    "Bar Pepe": "Pepe's Bar", "Nube de fotos": "Photo cloud", "Gasolinera Norte": "North Fuel", "Tienda Alba": "Alba Store",
    "Cuota préstamo": "Loan payment", "A la hucha": "To the jar", "Hostal La Caleta": "La Caleta Guesthouse",
    "Casa Paco": "Paco's Kitchen", "Floristería Rosa": "Rosa Florist", "Farmacia Sol": "Sol Pharmacy", "Luz": "Electricity",
    "Intereses": "Interest", "Bono bus": "Bus pass", "Seguro coche": "Car insurance", "Gimnasio Barrio": "Corner Gym",
    "Cine Plaza": "Plaza Cinema", "Tasa de basuras": "Waste collection fee", "Ferretería Pino": "Pino Hardware",
    "Librería Luna": "Luna Books", "Mercado Central": "Central Market",
  },
  notes: { "Cena con Marta": "Dinner with Marta" },
};

function patch(db, lang) {
  for (const [cat, cents] of Object.entries(LIMITS)) {
    db.prepare(`INSERT INTO budgets (id, period_id, category_id, amount_cents, created_at, updated_at, deleted)
      VALUES (?, 'per-2026-09', ?, ?, ?, ?, 0)`).run(`bud-${cat.slice(4)}`, cat, cents, T, T);
  }
  if (lang !== "en") return;
  const setName = (table, map) => {
    for (const [id, name] of Object.entries(map)) db.prepare(`UPDATE ${table} SET name=? WHERE id=?`).run(name, id);
  };
  setName("accounts", EN.accounts);
  setName("periods", EN.periods);
  setName("tags", EN.tags);
  setName("goals", EN.goals);
  setName("recurring_rules", EN.recurring_rules);
  for (const [es, en] of Object.entries(EN.merchants)) db.prepare("UPDATE transactions SET merchant=? WHERE merchant=?").run(en, es);
  for (const [es, en] of Object.entries(EN.notes)) db.prepare("UPDATE transactions SET note=? WHERE note=?").run(en, es);
  db.prepare("UPDATE meta SET value='en-GB' WHERE key='locale'").run();
}

/** Escribe media/.cache/demo-{lang}.xlsx y devuelve su ruta. */
export async function demoWorkbook(lang) {
  const X = createRequire(import.meta.url)(join(REPO_ROOT, "app/app/vendor/xlsx/xlsx.full.min.js"));
  const db = buildDemoDb();
  patch(db, lang);
  const buf = X.write(rowsToWorkbook(X, dumpDemo(db)), { type: "buffer", bookType: "xlsx" });
  const dir = join(MEDIA, ".cache");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `demo-${lang}.xlsx`);
  await writeFile(path, buf);
  return path;
}
