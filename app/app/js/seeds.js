// Las cuentas ya no se siembran: las crea el usuario (Patrimonio hoy, onboarding en PR F).
// Cada fila: [id, nameEs, parentId, flow, needType, displayOrder, nameEn]. nameEn va AL FINAL a
// propósito: tests/app/schema.test.mjs indexa SEED_CATEGORIES por c[0] (id) y c[2] (parent_id)
// directamente (test que debe seguir verde sin tocarlo) — insertar una columna antes de esas dos
// las habría desplazado.
export const SEED_CATEGORIES = [
  ["cat-casa", "Casa", "", "expense", "need", 10, "Home"],
  ["cat-casa-alquiler", "Alquiler/Hipoteca", "cat-casa", "expense", "need", 11, "Rent/Mortgage"],
  ["cat-casa-luz", "Luz", "cat-casa", "expense", "need", 12, "Electricity"],
  ["cat-casa-agua", "Agua", "cat-casa", "expense", "need", 13, "Water"],
  ["cat-casa-gas", "Gas", "cat-casa", "expense", "need", 14, "Gas"],
  ["cat-casa-internet", "Internet", "cat-casa", "expense", "need", 15, "Internet"],
  ["cat-casa-hogar", "Hogar", "cat-casa", "expense", "need", 16, "Home goods"],
  ["cat-alimentacion", "Alimentación", "", "expense", "need", 20, "Groceries"],
  ["cat-alimentacion-supermercado", "Supermercado", "cat-alimentacion", "expense", "need", 21, "Supermarket"],
  ["cat-alimentacion-domicilio", "Comida a domicilio", "cat-alimentacion", "expense", "want", 22, "Food delivery"],
  ["cat-restauracion", "Restauración", "", "expense", "want", 30, "Eating out"],
  ["cat-restauracion-restaurantes", "Restaurantes", "cat-restauracion", "expense", "want", 31, "Restaurants"],
  ["cat-restauracion-bares", "Bares y cafés", "cat-restauracion", "expense", "want", 32, "Bars & cafés"],
  ["cat-transporte", "Transporte", "", "expense", "need", 40, "Transport"],
  ["cat-transporte-gasolina", "Gasolina", "cat-transporte", "expense", "need", 41, "Fuel"],
  ["cat-transporte-publico", "Transporte público", "cat-transporte", "expense", "need", 42, "Public transport"],
  ["cat-transporte-parking", "Parking/peajes", "cat-transporte", "expense", "want", 43, "Parking/tolls"],
  ["cat-transporte-taxi", "Taxi/VTC", "cat-transporte", "expense", "want", 44, "Taxi/rideshare"],
  ["cat-coche", "Coche", "", "expense", "need", 50, "Car"],
  ["cat-coche-prestamo", "Préstamo", "cat-coche", "expense", "need", 51, "Loan"],
  ["cat-coche-seguro", "Seguro", "cat-coche", "expense", "need", 52, "Insurance"],
  ["cat-coche-mantenimiento", "Mantenimiento/ITV", "cat-coche", "expense", "need", 53, "Maintenance/inspection"],
  ["cat-salud", "Salud", "", "expense", "need", 60, "Health"],
  ["cat-salud-farmacia", "Farmacia", "cat-salud", "expense", "need", 61, "Pharmacy"],
  ["cat-salud-medico", "Médico", "cat-salud", "expense", "need", 62, "Doctor"],
  ["cat-salud-gimnasio", "Gimnasio", "cat-salud", "expense", "want", 63, "Gym"],
  ["cat-suscripciones", "Suscripciones", "", "expense", "want", 70, "Subscriptions"],
  ["cat-suscripciones-streaming", "Streaming", "cat-suscripciones", "expense", "want", 71, "Streaming"],
  ["cat-suscripciones-software", "Software", "cat-suscripciones", "expense", "want", 72, "Software"],
  ["cat-suscripciones-otras-subs", "Otras", "cat-suscripciones", "expense", "want", 73, "Other"],
  ["cat-ocio", "Ocio", "", "expense", "want", 80, "Leisure"],
  ["cat-ocio-planes", "Planes y eventos", "cat-ocio", "expense", "want", 81, "Plans & events"],
  ["cat-ocio-viajes", "Viajes", "cat-ocio", "expense", "want", 82, "Travel"],
  ["cat-ocio-hobbies", "Hobbies", "cat-ocio", "expense", "want", 83, "Hobbies"],
  ["cat-ropa", "Ropa y cuidado personal", "", "expense", "want", 90, "Clothing & personal care"],
  ["cat-regalos", "Regalos y donaciones", "", "expense", "want", 100, "Gifts & donations"],
  ["cat-impuestos", "Impuestos y tasas", "", "expense", "need", 110, "Taxes & fees"],
  ["cat-otros", "Otros gastos", "", "expense", "want", 120, "Other expenses"],
  ["cat-nomina", "Ingresos", "", "income", "", 910, "Income"],
  ["cat-puntuales", "Ingresos puntuales", "", "income", "", 920, "One-off income"],
  ["cat-intereses", "Intereses de ahorro", "", "income", "", 930, "Savings interest"],
];

// id -> {es, en}, derivado de SEED_CATEGORIES (misma fuente, sin duplicar datos aparte): lo usa
// repo.retranslateSeedNames para saber qué UPDATE emitir por categoría al cambiar de idioma.
export const SEED_NAMES = Object.fromEntries(
  SEED_CATEGORIES.map((c) => [c[0], { es: c[1], en: c[6] }]),
);

export function seedStatements(now, lang = "es") {
  const nameOf = (c) => (lang === "en" ? c[6] : c[1]);
  const rows = SEED_CATEGORIES.map((c) => [c[0], nameOf(c), c[2], c[3], c[4], c[5]]);
  return [
    { sql: "INSERT INTO categories (id,name,parent_id,flow,need_type,display_order,is_archived,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,0,'" + now + "','" + now + "',0)", rows },
  ];
}
