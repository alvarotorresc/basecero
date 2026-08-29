// Diccionario inglés: espejo exacto de claves de es.js (test de paridad). Valores
// attribute-safe (sin " ni <), inglés natural de producto, concisos y en sentence case.
export const EN = {
  common: {
    back: "Back",
    retry: "Retry",
  },
  i18n: {
    months: {
      0: "Jan", 1: "Feb", 2: "Mar", 3: "Apr", 4: "May", 5: "Jun",
      6: "Jul", 7: "Aug", 8: "Sep", 9: "Oct", 10: "Nov", 11: "Dec",
    },
    weekdays: {
      0: "S", 1: "M", 2: "T", 3: "W", 4: "T", 5: "F", 6: "S",
    },
    demo: {
      rows: { one: "{n} row", other: "{n} rows" },
    },
  },
  main: {
    banner: {
      locked: "⚠ BaseCero is already open in another tab or window. Close it and retry; meanwhile, anything you do here will NOT be saved. ",
      memory: "⚠ This browser does not support persistent storage: your data will NOT be saved when you close it.",
      boot_failed: "⚠ BaseCero failed to start: {error}. Reload the page.",
    },
    tabs: {
      inicio: "Home",
      movimientos: "Transactions",
      patrimonio: "Net worth",
      ajustes: "Settings",
    },
    fab: "Log expense",
  },
};
