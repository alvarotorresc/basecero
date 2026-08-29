// Diccionario inglés: espejo exacto de claves de es.js (test de paridad). Valores
// attribute-safe (sin " ni <), inglés natural de producto, concisos y en sentence case.
export const EN = {
  common: {
    back: "Back",
    retry: "Retry",
    save: "Save",
    saveFailed: "Couldn’t save: {error}",
    goBack: "Back",
    noOpenPeriod: "There’s no open period.",
    needAccount: "Create an account in Net worth first.",
    enterAmount: "Enter an amount.",
    enterAmountAndCategory: "Enter an amount and pick a category.",
    pickTwoAccounts: "Pick two different accounts (from and to).",
    pickCategory: "Pick a category.",
    amount: "Amount",
    category: "Category",
    account: "Account",
    destAccount: "Destination account",
    from: "From",
    to: "To",
    changeSign: "Change sign",
    linkedTo: "Linked to",
    myShare: "Your share · {pct}%",
    myPartSuffix: " · your share {amount}",
    sharedWith: "Shared with {name}",
    merchant: "Merchant",
    date: "Date",
    note: "Note",
    optional: "Optional",
    today: "Today",
    // H1 de la pantalla Movimientos (y section-title del bloque de movimientos en Inicio) —
    // hoy mismo texto que main.tabs.movimientos (la etiqueta de la pestaña), pero es una clave
    // deliberadamente separada: no fusionar ni dejar que diverjan sin querer en el futuro.
    movements: "Transactions",
    settle: "Settle up",
    type: {
      expense: "Expense",
      income: "Income",
      refund: "Refund",
      adjustment: "Adjustment",
    },
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
  inicio: {
    error: { load: "Couldn’t load Home: {error}" },
    greeting: {
      morning: "Good morning",
      afternoon: "Good afternoon",
      evening: "Good evening",
    },
    header: { dayOf: "{period} · day {day} of {total}" },
    spent: {
      title: "Spent",
      income: "Income",
      saved: "Saved",
      rate: "Rate",
    },
    movements: { empty: "Log your first expense with the ＋ button" },
    flow: {
      title: "Spending flow",
      last7: "Last 7 days · {total}",
    },
    categorySpend: {
      title: "Spending by category",
      subtitle: "Only your share of shared expenses",
      empty: "No categorized spending yet this period.",
      others: "{n} others",
      spent: "{currency} spent",
      of: "of {limit}",
      noLimit: "no limit",
    },
    shared: {
      withPartner: "With {name}",
      periodSplit: "This period: {mine} / {theirs}",
      pendingLabel: "Pending for them to pay back",
      oldest: {
        one: "{n} unsettled expense · oldest from {date}",
        other: "{n} unsettled expenses · oldest from {date}",
      },
    },
    partnerBanner: {
      title: "Who do you share expenses with?",
      body: "You have shared expenses on record. Add their name to bring back the pending block and “Settle up”.",
      namePlaceholder: "Their name",
    },
    prevision: {
      title: "Forecast",
      manage: "Manage recurring →",
      paid: "Paid",
      pending: "Pending",
      committed: "Remaining committed",
      available: "Actually available",
    },
    budget: { viewLink: "View budget →" },
    available: {
      title: "Available this period",
      ofBudgeted: "of {amount} budgeted",
      paceOver: "▲ {amount} over the plan’s pace",
      paceUnder: "▼ {amount} under the plan’s pace",
      settleWithAmount: "Settle up · {amount}",
    },
  },
  registro: {
    error: { load: "Couldn’t load the entry screen: {error}" },
    title: "Log transaction",
    close: "Close",
    type: { transfer: "Transfer" },
    save: {
      expense: "Save expense",
      income: "Save income",
      transfer: "Save transfer",
      refund: "Save refund",
      adjustment: "Save adjustment",
    },
    refund: {
      unlink: "Remove link",
      toggle: "Refunding an expense? {arrow}",
      empty: "No recent expenses.",
      sharedSuffix: " · shared",
    },
    keypad: { delete: "Backspace" },
  },
  movimientos: {
    error: {
      load: "Couldn’t load Transactions: {error}",
      openDetail: "Couldn’t open the transaction: {error}",
      loadPeriod: "Couldn’t load the period: {error}",
      delete: "Couldn’t delete: {error}",
    },
    noPeriods: "No periods yet.",
    periodLabel: "Period",
    uncategorized: "Uncategorized",
    tapToCategorize: "tap to categorize",
    uncategorizedChip: "No category · {n}",
    type: { transfer: "Transfer" },
    detail: {
      lockedNote: "Settled. To edit the amount, first delete its settlement in Transactions.",
    },
    shared: {
      fallbackName: "the other party",
      fallbackLabel: "Other party",
    },
    delete: {
      button: "Delete",
      confirm: "Yes, delete",
    },
    empty: {
      noUncategorized: "No uncategorized transactions.",
      noPeriod: "No transactions in this period.",
    },
  },
  liquidar: {
    error: {
      load: "Couldn’t load Settle up: {error}",
      settle: "Couldn’t settle: {error}",
    },
    title: { withPartner: "Settle up with {name}" },
    total: { title: "Pending total" },
    pending: { title: "Pending expenses" },
    empty: "Nothing left to settle.",
    row: {
      sub: "{date} · {amount} · their {pct}%",
      confirm: "Yes, settle",
    },
  },
  presupuesto: {
    error: { load: "Couldn’t load Budget: {error}" },
    title: "Budget",
    header: {
      openedOn: "{period} · opened on {date}{days}",
      days: { one: " · {n} day", other: " · {n} days" },
    },
    empty: "This period has no category with a limit.",
    total: {
      title: "Spent of budget",
      ofBudgeted: "of {amount} budgeted",
      remaining: {
        one: "You have {amount} left in the {n} category with a limit",
        other: "You have {amount} left in the {n} categories with a limit",
      },
      over: {
        one: "You’ve gone {amount} over in the {n} category with a limit",
        other: "You’ve gone {amount} over in the {n} categories with a limit",
      },
    },
    byCategory: {
      title: "By category",
      countWithLimit: "{n} with a limit this period",
    },
    category: {
      over: "Over by {amount}",
      warn: "Almost at the limit · {amount} left",
      ok: "{amount} left",
    },
    noLimit: {
      title: "No limit this period",
      summary: "{names} · {amount} spent",
      andMore: "{names} and {n} more",
    },
  },
};
