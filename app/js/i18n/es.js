// Diccionario español (idioma base): valores attribute-safe (sin " ni <), contrato
// verificado por tests/app/i18n.test.mjs. Solo las claves que usan las tasks vigentes.
export const ES = {
  common: {
    back: "Atrás",
    retry: "Reintentar",
  },
  i18n: {
    months: {
      0: "ene", 1: "feb", 2: "mar", 3: "abr", 4: "may", 5: "jun",
      6: "jul", 7: "ago", 8: "sep", 9: "oct", 10: "nov", 11: "dic",
    },
    weekdays: {
      0: "D", 1: "L", 2: "M", 3: "X", 4: "J", 5: "V", 6: "S",
    },
    demo: {
      rows: { one: "{n} fila", other: "{n} filas" },
    },
  },
  main: {
    banner: {
      locked: "⚠ BaseCero ya está abierta en otra pestaña o ventana. Ciérrala y reintenta; mientras tanto, lo que hagas aquí NO se guardará. ",
      memory: "⚠ Este navegador no soporta almacenamiento persistente: tus datos NO se guardarán al cerrar.",
      boot_failed: "⚠ BaseCero no ha podido arrancar: {error}. Recarga la página.",
    },
    tabs: {
      inicio: "Inicio",
      movimientos: "Movimientos",
      patrimonio: "Patrimonio",
      ajustes: "Ajustes",
    },
    fab: "Registrar gasto",
  },
};
