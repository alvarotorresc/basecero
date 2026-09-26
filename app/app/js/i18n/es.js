// Diccionario español (idioma base): valores attribute-safe (sin " ni <), contrato
// verificado por tests/app/i18n.test.mjs. Solo las claves que usan las tasks vigentes.
export const ES = {
  common: {
    back: "Atrás",
    retry: "Reintentar",
    save: "Guardar",
    cancel: "Cancelar",
    delete: "Borrar",
    saveFailed: "No se pudo guardar: {error}",
    saveChanges: "Guardar cambios",
    deleteFailed: "No se pudo borrar: {error}",
    addNew: "+ Nueva",
    goBack: "Volver",
    noOpenPeriod: "No hay ningún periodo abierto.",
    needAccount: "Crea primero una cuenta en Patrimonio.",
    enterAmount: "Introduce un importe.",
    enterAmountAndCategory: "Introduce un importe y elige una categoría.",
    pickTwoAccounts: "Elige dos cuentas distintas (origen y destino).",
    pickCategory: "Elige una categoría.",
    amount: "Importe",
    category: "Categoría",
    account: "Cuenta",
    destAccount: "Cuenta destino",
    from: "Desde",
    to: "Hacia",
    changeSign: "Cambiar signo",
    linkedTo: "Vinculado a",
    // myShare/pctValue: SISTEMA.md §4.4, segmentos de metaHtml (movimientos.js:583, registro.js:504).
    myShare: "Tu parte",
    pctValue: "{pct} %",
    // dateValue/amountValue: segmentos de metaHtml que envuelven una fecha/importe ya formateados
    // (fmtDiaCorto/fmtMoney) para que pasen por t() como el resto de segmentos de una fila —
    // spec §1.4/§4, fila de liquidar.js#rowHtml.
    dateValue: "{date}",
    amountValue: "{amount}",
    // myPartSuffix se queda en prosa (con su separador ya sin punto medio): lo siguen concatenando tal cual
    // inicio.js y semana.js, que esta PR no toca (spec §9.1/§9.2).
    myPartSuffix: ", tu parte {amount}",
    sharedWith: "Compartido con {name}",
    settlement: {
      theyOwe: "{name} te debe",
      youOwe: "Debes a {name}",
      even: "Estáis en paz",
    },
    paidBy: { label: "Quién pagó", me: "Pagué yo", partner: "Pagó {name}" },
    // paidByName/paidTotal: segmentos de metaHtml para «{name} pagó, total» (movimientos.js:587,
    // registro.js:508). Nombre distinto de `paidBy` a propósito: `common.paidBy` ya es el objeto
    // del selector «Quién pagó» de arriba — reutilizar el nombre lo pisaría. Sustituyen a
    // `paidFull`, que se borra: sin más consumidores tras este cambio.
    paidByName: "pagó {name}",
    paidTotal: "total",
    split: { label: "Reparto", hint: "{name} paga el {pct} %", decreaseAria: "Bajar tu parte", increaseAria: "Subir tu parte" },
    merchant: "Comercio",
    date: "Fecha",
    note: "Nota",
    name: "Nombre",
    optional: "Opcional",
    egPlaceholder: "p. ej. {example}",
    today: "Hoy",
    // H1 de la pantalla Movimientos (y section-title del bloque de movimientos en Inicio) —
    // hoy mismo texto que main.tabs.movimientos (la etiqueta de la pestaña), pero es una clave
    // deliberadamente separada: no fusionar ni dejar que diverjan sin querer en el futuro.
    movements: "Movimientos",
    settle: "Liquidar",
    typeLabel: "Tipo",
    type: {
      expense: "Gasto",
      income: "Ingreso",
      refund: "Devolución",
      adjustment: "Ajuste",
    },
  },
  i18n: {
    months: {
      0: "ene", 1: "feb", 2: "mar", 3: "abr", 4: "may", 5: "jun",
      6: "jul", 7: "ago", 8: "sep", 9: "oct", 10: "nov", 11: "dic",
    },
    // Task 7 (6b): nombres largos, antes solo bajo recurrentes.month.* — promovidos aquí para
    // que cualquier pantalla los pueda usar vía monthLong(i), no solo Recurrentes.
    monthsLong: {
      0: "enero", 1: "febrero", 2: "marzo", 3: "abril", 4: "mayo", 5: "junio",
      6: "julio", 7: "agosto", 8: "septiembre", 9: "octubre", 10: "noviembre", 11: "diciembre",
    },
    weekdays: {
      0: "D", 1: "L", 2: "M", 3: "X", 4: "J", 5: "V", 6: "S",
    },
    // Nombre largo del día de semana (Inicio v2, plan 2026-09-10: la espina de Semana). MISMO
    // índice 0=domingo que `weekdays` (getDay()) — arrays fijos, no Intl, por la deriva de ICU
    // entre versiones de Node ya documentada arriba para months/monthsLong.
    weekdaysLong: {
      0: "domingo", 1: "lunes", 2: "martes", 3: "miércoles", 4: "jueves", 5: "viernes", 6: "sábado",
    },
    demo: {
      rows: { one: "{n} fila", other: "{n} filas" },
    },
  },
  main: {
    banner: {
      locked: "BaseCero ya está abierta en otra pestaña o ventana. Ciérrala y reintenta; mientras tanto, lo que hagas aquí NO se guardará. ",
      memory: "Este navegador no soporta almacenamiento persistente: tus datos NO se guardarán al cerrar.",
      boot_failed: "BaseCero no ha podido arrancar: {error}. Recarga la página.",
    },
    tabs: {
      inicio: "Inicio",
      movimientos: "Movimientos",
      patrimonio: "Patrimonio",
      ajustes: "Ajustes",
    },
    tabsNav: "Secciones",
    fab: "Registrar gasto",
  },
  inicio: {
    error: { load: "No se pudo cargar Inicio: {error}" },
    greeting: {
      morning: "Buenos días",
      afternoon: "Buenas tardes",
      evening: "Buenas noches",
    },
    header: { dayOf: "{period}, día {day} de {total}" },
    // Racha de días registrando seguidos (badge de la cabecera, Inicio v2) — no se pinta con
    // racha 0 (inicio.js), así que el singular/plural nunca ve n=0 en pantalla.
    streak: { one: "{n} día de racha", other: "{n} días de racha" },
    account: { switch: "Cambiar de cuenta" },
    spent: {
      title: "Gastado",
      income: "Ingresos",
      saved: "Ahorrado",
    },
    movements: {
      empty: "Registra tu primer gasto con el botón ＋",
      emptyPeriod: "No hay movimientos en este periodo.",
      viewAll: "Ver todos",
    },
    week: {
      title: "Esta semana",
      viewAll: "Ver la semana",
    },
    categorySpend: {
      title: "Gasto por categoría",
      empty: "Aún no hay gasto categorizado este periodo.",
      over: "supera el límite en {amount}",
      viewAll: "Ver todas",
    },
    savings: {
      rate: "Ahorras el {pct} de lo que ingresas",
      negative: "Este periodo gastas más de lo que ingresas",
    },
    partnerBanner: {
      title: "¿Con quién compartes gastos?",
      body: "Tienes gastos compartidos registrados. Di su nombre para recuperar el bloque de pendientes y «Liquidar».",
      namePlaceholder: "Su nombre",
    },
    pending: {
      title: "Queda por pagar",
      left: "Te quedarán",
    },
    // Solo `manage` sigue viva de este grupo (Task 10: el resto se pintaba en la antigua tarjeta
    // «Previsión» v1, sustituida en la Task 9). Decisión 19 de la spec: fuera el «→», ningún
    // glifo de texto hace de icono — es el enlace «Recurrentes» de «Queda por pagar».
    prevision: {
      manage: "Recurrentes",
    },
    available: {
      title: "Disponible del periodo",
      days: { one: "{n} día", other: "{n} días" },
      spentOf: "{spent} gastados de {budget}",
      today: "Hoy puedes gastar",
    },
    hucha: {
      renewal: "{name} se renueva el {date} por {amount}. ¿Lo sigues usando?",
      limit: "{name} va por el {pct} de su límite este periodo.",
      idle: { one: "Llevas {n} día sin apuntar nada.", other: "Llevas {n} días sin apuntar nada." },
      periodEnd: { one: "Este periodo se cierra en {n} día.", other: "Este periodo se cierra en {n} días." },
      periodEndToday: "Este periodo se cierra hoy.",
      action: {
        renewal: "Ver suscripciones",
        limit: "Ver categorías",
        idle: "Registrar un gasto",
        periodEnd: "Abrir el siguiente",
      },
      dismiss: "Ahora no",
    },
    // Sistema B (S1, B-Home / B-Inicio-Vacio). Las claves de arriba que ya no pinta Inicio
    // (saludo, racha, Gastado/Ingresos/Ahorrado, «Disponible del periodo») se quedan hasta la
    // PR-99: alguna la leen otras pantallas (header.dayOf, savings.negative).
    b: {
      sub: { one: "Día {day} de {total}, queda {n} día", other: "Día {day} de {total}, quedan {n} días" },
      led: "Periodo abierto",
      left: "Quedan {amount} de {budget}",
      over: "Te has pasado {amount} de {budget}",
      todayMark: "hoy",
      endMark: "día {n}",
      balanceToday: "Saldo de hoy",
      balanceStart: "Saldo de partida, sin movimientos",
      savings: "Ahorras",
      savingsOf: "de {amount}",
      rest: "Resto",
      lastMovements: "Últimos movimientos",
      emptyTitle: "Aún no hay movimientos",
      emptyText: "El primer gasto se apunta con el botón de abajo.",
      yesterday: "Ayer",
      weekdayShort: { 0: "dom", 1: "lun", 2: "mar", 3: "mié", 4: "jue", 5: "vie", 6: "sáb" },
      renewalTitle: "{name} se renueva el {date}",
      renewalAsk: "¿Lo sigues usando?",
      afterPay: "Tras pagarlo te quedarán {amount}",
      review: "Revisar",
      switchAccount: "{name}, cambiar de cuenta",
    },
  },
  semana: {
    title: "Semana",
    range: {
      sameMonth: "Del {from} al {to} de {month}",
      crossMonth: "Del {from} de {fromMonth} al {to} de {toMonth}",
    },
    display: { label: "Gastado esta semana" },
    avgPerDay: "Media al día",
    chart: { label: "Gasto por día, apilado por categoría", avg: "media" },
    day: {
      name: "{weekday} {day}",
      today: "Hoy, {day}",
      aria: "{day}, {amount}",
      ariaToday: "{day}, hoy, {amount}",
    },
    noSpend: "Sin gastos",
    uncategorized: "Sin categoría",
    where: { title: "Dónde se ha ido" },
    empty: "Esta semana no hay nada apuntado todavía.",
    emptyPeriod: "En este periodo aún no hay nada apuntado esta semana.",
    error: { load: "No se pudo cargar la semana: {error}" },
  },
  registro: {
    error: { load: "No se pudo cargar la pantalla de registro: {error}" },
    title: "Registrar",
    close: "Cerrar",
    type: { label: "Tipo de movimiento", transfer: "Transferencia", others: "Devolución o ajuste" },
    natural: {
      placeholder: "o dicta «12,50 en el bar»",
      placeholderNoMic: "o escribe «12,50 en el bar»",
      mic: "Dictar el gasto",
      micListening: "Escuchando…",
      micDenied: "No se pudo usar el micro. Escríbelo.",
      notUnderstood: "No he entendido nada de esa frase.",
      reset: "Borrar",
      sharedChip: "{name} {pct} %",
      // §13.10 de la spec (a validar por Álvaro): el reconocimiento de voz del navegador no es
      // local, el audio sale a un servidor del fabricante. Se dice bajo la caja, solo con el micro
      // disponible.
      micNotice: "Al dictar, el navegador envía tu voz a su servidor.",
    },
    save: {
      expense: "Guardar gasto",
      income: "Guardar ingreso",
      transfer: "Guardar transferencia",
      refund: "Guardar devolución",
      adjustment: "Guardar ajuste",
      expenseWithAmount: "Guardar gasto de {amount}",
    },
    categories: {
      showAll: "Ver las {n} categorías",
    },
    more: {
      toggle: "Más",
      summaryNoNote: "sin nota ni foto",
      summaryPhoto: "con foto",
      summaryToday: "hoy",
    },
    merchant: { placeholder: "Comercio o concepto" },
    chosen: { remembered: "La que usas en {merchant}" },
    date: { today: "Hoy" },
    shared: { row: "Con {name}" },
    limit: {
      remaining: "Con este gasto quedan {amount} de {name}",
      over: "Con este gasto te pasas {amount} de {name}",
    },
    refund: {
      unlink: "Quitar vínculo",
      toggle: "¿Devuelve un gasto?",
      empty: "No hay gastos recientes.",
      sharedSuffix: " (compartido)",
      alreadyRefunded: "Ya devuelto, {amount}",
      // Un gasto compartido ya liquidado: lo que volvió es la parte de la contraparte, no una
      // devolución. Se marca distinto de alreadyRefunded para que no se lean como lo mismo.
      settledLabel: "Liquidado, {amount}",
    },
    // Foto del ticket (N5, Registro v2 §9). viewAria se reutiliza también en el visor a pantalla
    // completa del detalle de movimiento (movimientos.js), como movimientos.detail.tagLabel ya se
    // reutiliza aquí.
    photo: {
      add: "Foto del ticket",
      replace: "Otra foto",
      remove: "Quitar la foto",
      viewAria: "Ver la foto del ticket",
      savedWithout: "El gasto se guardó, pero no se pudo adjuntar la foto",
    },
  },
  movimientos: {
    error: {
      load: "No se pudo cargar Movimientos: {error}",
      openDetail: "No se pudo abrir el movimiento: {error}",
      loadPeriod: "No se pudo cargar el periodo: {error}",
      delete: "No se pudo borrar: {error}",
    },
    noPeriods: "No hay ningún periodo todavía.",
    uncategorized: "Sin categorizar",
    tapToCategorize: "toca para categorizar",
    uncategorizedChip: "Sin categoría {n}",
    chipAll: "Todos",
    // filter.toggle sustituye a search.toggle (embudo en vez de lupa, Movimientos.dc.html:24).
    // Hoja de filtros (S5, B-Movimientos-Filtros) con la semántica de siempre: una categoría raíz,
    // «sin categoría» y una etiqueta. apply cuenta los movimientos que dejaría el filtro elegido.
    filter: {
      toggle: "Filtrar",
      title: "Filtros",
      clear: "Quitar filtros",
      category: "Categoría",
      tag: "Etiqueta",
      apply: { one: "Ver {n} movimiento", other: "Ver {n} movimientos" },
    },
    // Sistema B (S5, B-Movimientos): cabecera de raíz con el periodo que se mira y Display compacto.
    header: {
      sub: { one: "Día {day} de {total}, queda {n} día", other: "Día {day} de {total}, quedan {n} días" },
      closed: "Periodo cerrado",
    },
    display: {
      label: "Gastado en el periodo",
      of: "de {amount}",
      meter: "Gastado frente a los límites del periodo",
    },
    yesterday: "Ayer",
    weekdayShort: { 0: "dom", 1: "lun", 2: "mar", 3: "mié", 4: "jue", 5: "vie", 6: "sáb" },
    // Sustituyen al <select id="mov-period"> (Movimientos.dc.html:30-40): aria-label de los dos
    // botones circulares de 40px que mueven state.periodId por índice sobre `periods`.
    period: { prev: "Periodo anterior", next: "Periodo siguiente" },
    search: {
      label: "Buscar",
      placeholder: "Comercio o nota",
    },
    type: { transfer: "Transferencia" },
    detail: {
      lockedNote: "Tiene un apunte de liquidación enlazado (devolución o ajuste): para cambiar el importe o el reparto, bórralo antes.",
      typeLabel: "Tipo",
      // Sin consumidor EN ESTE FICHERO desde la Task 1.5 (la etiqueta del bloque Fecha+Etiqueta
      // desaparece: el artboard no la lleva), pero registro.js:461 (P8) sigue llamando a esta
      // misma clave para el mismo control — borrarla habría roto Registro. No se toca.
      tagLabel: "Etiqueta",
      noTag: "Sin etiqueta",
      newTag: "Nueva etiqueta",
      // Foto del ticket (N5): aria-label del velo a pantalla completa que enseña la foto.
      photoClose: "Cerrar la foto",
    },
    tagCard: {
      movements: { one: "{n} movimiento", other: "{n} movimientos" },
      ofLimit: "de {limit}",
      periodLine: {
        one: "{amount} en {period}, {n} movimiento",
        other: "{amount} en {period}, {n} movimientos",
      },
    },
    // Nota de cierre del filtro de etiqueta (Movimientos.dc.html:146-148): tagTotalsAll.n menos
    // tagTotalsOfPeriod.n, solo con etiqueta activa y resto > 0. {n} solo aparece en «other»: el
    // singular ya dice «el otro movimiento», sin numeral.
    tag: {
      olderNote: {
        one: "El otro movimiento de {tag} es de un periodo anterior. Quita el filtro para ver todo {period}.",
        other: "Los otros {n} movimientos de {tag} son de periodos anteriores. Quita el filtro para ver todo {period}.",
      },
    },
    shared: {
      fallbackName: "la contraparte",
      fallbackLabel: "Contraparte",
    },
    row: { partnerPaid: ", pagó {name}, tu parte {amount}" },
    delete: {
      button: "Borrar",
      title: "¿Borrar este movimiento?",
      message: "{what}. Desaparecerá de las listas y de los totales del periodo.",
      // Sustituye a la concatenación con · de movimientos.js (ModalBorrar.dc.html:137: «Bar La
      // Plaza, 18,50 € del 9 de septiembre»). fmtDiaLargo para el día, como pide la spec §2.2.
      what: "{merchant}, {amount} del {date}",
    },
    empty: {
      noUncategorized: "No hay movimientos sin categorizar.",
      noResults: "Ningún movimiento coincide con el filtro.",
      noPeriod: "No hay movimientos en este periodo.",
    },
  },
  liquidar: {
    error: {
      load: "No se pudo cargar Liquidar: {error}",
      settle: "No se pudo liquidar: {error}",
    },
    title: { withPartner: "Liquidar con {name}" },
    // sub: subtítulo de la cabecera con el reparto común de las filas (B-Liquidar).
    sub: {
      half: "Gastos a medias, {pct} %",
      split: "Su parte, {pct} %",
    },
    balance: {
      favor: "A tu favor",
      against: "En contra",
    },
    account: {
      in: "Entra en",
      out: "Sale de",
    },
    empty: "No queda nada pendiente de liquidar.",
    // select.aria: aria-label de la casilla de selección por fila (SISTEMA.md §4.8bis).
    // select.none: texto del botón de pie cuando no hay ninguna fila marcada.
    select: {
      aria: "Incluir {merchant} en la liquidación",
      none: "Elige al menos un gasto",
    },
    // row.*: línea 2 de una fila; theirPct/myPct se añaden solo si el reparto de la fila no es el
    // del subtítulo.
    row: {
      of: "{date}, de {amount}",
      paidBy: "{date}, pagó {name} {amount}",
      theirPct: "su {pct} %",
      myPct: "tu {pct} %",
    },
    // footer.*: el primario; el importe va detrás, en mono (B-Liquidar).
    footer: {
      collect: "Liquidar y cobrar",
      collectConfirm: "Sí, cobrar",
      pay: "Liquidar y pagar",
      payConfirm: "Sí, pagar",
      even: "Liquidar, queda a cero",
      evenConfirm: "Sí, liquidar",
    },
    note: "Liquidación",
    outflow: {
      merchant: "Liquidación con {name}",
      merchantFallback: "Liquidación",
    },
  },
  gastoCategoria: {
    error: {
      load: "No se pudo cargar Gasto por categoría: {error}",
      detail: "No se pudo cargar el detalle: {error}",
    },
    title: "Gasto por categoría",
    header: {
      dayOf: "{period}, día {day} de {total}",
    },
    total: {
      title: "Gastado este periodo",
      // Decisión 6: el héroe ahora compara con el presupuesto GENERAL del periodo (suma de todos
      // los budgetsOfPeriod), no con el subtotal de las categorías con límite —de ahí que withLimit/
      // remaining/over (que sí hablaban de "la única categoría con límite"/"las N categorías con
      // límite") se borren en este mismo commit: son la lectura antigua que se aparta del artboard.
      ofBudget: "de {budget} presupuestados",
      noLimits: "Ninguna categoría tiene límite este periodo",
      dayMark: "día {day}",
    },
    noSpend: "Sin gasto: {names}",
    noSpendMore: "Sin gasto: {names} y {n} más",
    byCategory: {
      title: "Por categoría",
      empty: "No tienes ninguna categoría de gasto activa.",
    },
    // N3 (Task 14): línea de comparativa con el periodo anterior, a la izquierda de la mini
    // tendencia — mismo criterio de plantilla que el resto de gastoCategoria.row.*, para que un
    // idioma con otro orden de palabras pueda mover {name}/{amount} sin tocar el JS.
    compare: {
      prev: "{name} {amount}",
    },
    row: {
      // Pie de la fila (B-GastoCategoria): el límite puesto, o el exceso si se ha pasado (sustituye
      // a la línea del límite: no se pintan las dos a la vez).
      limit: "límite {limit}",
      // Aviso al 85 % (category-spend.js#budgetStatus, nivel warn): neutro, con icono de aviso.
      nearLimit: "llevas el {pct} de {limit}",
      overBy: "superado por {over}",
    },
    detail: {
      noSubcategory: "Sin subcategoría",
      changeLimit: "Cambiar límite",
      setLimit: "Poner límite",
    },
    edit: {
      title: "Límite de {name}",
      placeholder: "Sin límite",
      save: "Guardar",
      onlyThisPeriod: "Solo para este periodo",
      remove: "Quitar límite",
      saveFailed: "No se pudo guardar el límite: {error}",
    },
  },
  patrimonio: {
    error: {
      load: "No se pudo cargar Patrimonio: {error}",
      openAccount: "No se pudo abrir la cuenta: {error}",
    },
    title: "Patrimonio",
    netWorth: {
      title: "Patrimonio neto",
      thisPeriod: "este periodo",
      // LED del Display (B-Patrimonio): el color nunca es la única señal, el LED lleva texto.
      up: "Sube",
      down: "Baja",
    },
    // Bloque de composición bajo el Display (B-Patrimonio): barra apilada + Tienes / Debes.
    composition: {
      label: "Composición del patrimonio",
      have: "Tienes",
      owe: "Debes",
      operational: "Operativo, sin ahorro ni deudas",
    },
    accountType: {
      checking: "Corriente",
      savings: "Ahorro",
      liability: "Pasivo",
    },
    // Línea 2 de la tarjeta de cuenta (B-Patrimonio): tipo, o lo que la distingue.
    accountLine: {
      checkingDefault: "{type}, por defecto",
      installments: { one: "{amount}/mes, queda {n} cuota", other: "{amount}/mes, quedan {n} cuotas" },
    },
    accounts: {
      title: "Cuentas",
      new: "Nueva cuenta",
      empty: "Todavía no tienes ninguna cuenta.",
    },
    account: {
      title: { edit: "Editar cuenta" },
      settings: "Ajustes de la cuenta",
      openingBalance: "Saldo inicial",
      note: {
        liability: "El saldo de un pasivo es lo que debes: normalmente negativo.",
        default: "El saldo con el que arrancó la cuenta, antes del primer movimiento registrado.",
      },
      create: "Crear cuenta",
      validation: { name: "Ponle un nombre a la cuenta." },
      monthlyInstallment: "Cuota mensual",
      // Selector de familia (C8): el nombre del color sale de families.*.
      color: "Color de la cuenta",
      colorUsedBy: "{color}, la usa {name}",
      colorShared: "{color}, la misma que {name}. El icono las distingue.",
    },
    goals: {
      title: "Objetivos",
      new: "Nuevo objetivo",
      empty: "Todavía no tienes ningún objetivo activo.",
      ofTarget: "{current} de {target}",
      progress: "{name}: {pct} %",
    },
    goalType: {
      emergency_fund: "Fondo de emergencia",
      savings_target: "Ahorro con objetivo",
      provision: "Provisión",
      spending_cap: "Techo de gasto",
      savings_rate: "Tasa de ahorro",
    },
    goal: {
      title: { edit: "Editar objetivo" },
      settings: "Ajustes del objetivo",
      monthsLabel: "Meses a cubrir",
      monthLess: "Un mes menos",
      monthMore: "Un mes más",
      pctLabel: "Objetivo de ahorro",
      amountLabel: { annual: "Objetivo anual", default: "Importe objetivo" },
      dateLabel: "Fecha objetivo (opcional)",
      typeLockedNote: "El tipo no se puede cambiar una vez creado el objetivo. Para cambiarlo, bórralo y crea uno nuevo.",
      savedToday: "Ahorrado hoy",
      linkedSavings: "Hucha vinculada",
      autoSavingsNote: "Se creará su hucha automáticamente",
      activeLabel: "Activo",
      create: "Crear objetivo",
      delete: "Borrar objetivo",
      deleteTitle: "¿Borrar el objetivo?",
      deleteMessage: "{name}. Dejará de aparecer en Patrimonio; el dinero de tus cuentas no se toca.",
      validation: {
        name: "Ponle un nombre al objetivo.",
        months: "Indica cuántos meses de gasto quieres cubrir.",
        amount: "Introduce un importe objetivo.",
        savingsRate: "Introduce un objetivo de ahorro (%).",
      },
    },
  },
  recurrentes: {
    error: { load: "No se pudo cargar Recurrentes: {error}" },
    title: "Recurrentes",
    empty: "Todavía no hay ninguna regla recurrente.",
    hero: {
      pending: "Pendiente este periodo",
      perMonth: "al mes",
      pendingCount: { one: "{n} pendiente", other: "{n} pendientes" },
      allSettled: "Todo pagado",
      remaining: "Te quedarán {amount}",
      paidLabel: "Pagado",
      meterAria: "Pendiente {pending} de {total} este periodo",
    },
    section: { all: "Todas", pending: "Pendiente", paidPeriod: "Pagado este periodo", other: "Otras reglas" },
    state: {
      paid: "pagado",
      pending: "pendiente",
      transfer: "transferencia",
    },
    newRule: "Nueva regla recurrente",
    toggle: { aria: "Activar {name}" },
    footNote: "El interruptor pausa la regla sin borrarla.",
    type: { transfer: "Transfer." },
    freq: {
      weekly: "Semanal",
      monthly: "Mensual",
      quarterly: "Trimestral",
      yearly: "Anual",
    },
    subtitle: {
      day: "día {n}",
      next: "próximo: {month}",
      transferRoute: "{from} → {to}",
      shared: "compartido",
      paused: "pausada",
    },
    shared: { fallbackName: "la contraparte" },
    validation: {
      name: "Ponle un nombre a la regla.",
      day: "El día debe estar entre 1 y 31.",
      month: "El mes debe estar entre 1 y 12.",
    },
    form: {
      title: { edit: "Editar regla", new: "Nueva regla" },
      namePlaceholderExample: "Alquiler",
      frequency: "Frecuencia",
      dayLabel: "Día",
      monthLabel: "Mes",
      sharedWith: "Compartida con {name}",
      activeLabel: "Activa",
      create: "Crear regla",
      delete: "Borrar regla",
      deleteTitle: "¿Borrar la regla?",
      deleteMessage: "{name}. Dejará de proponerse cada periodo; los movimientos ya registrados no se tocan.",
      subscriptionLabel: "Es una suscripción",
      subscriptionHint: "Entra en el radar de suscripciones, con su renovación y su coste anual.",
      perYear: "al año",
      cancelSubscription: "Cancelar la suscripción",
    },
    badge: { subscription: "suscripción", shared: "compartido" },
    radarLink: "Ver el radar de suscripciones",
  },
  categorias: {
    error: { load: "No se pudieron cargar las categorías: {error}" },
    title: "Categorías",
    needLabel: { need: "necesario", want: "prescindible", savings: "ahorro" },
    needType: { need: "Necesario", want: "Prescindible" },
    subcatCount: { one: "{n} subcategoría", other: "{n} subcategorías" },
    archivedLabel: "Archivada",
    addSubcategory: "+ Añadir subcategoría",
    empty: {
      expense: "Todavía no hay categorías de gasto.",
      income: "Todavía no hay categorías de ingreso.",
    },
    list: {
      hint: "Toca una categoría para editarla. El asa la reordena.",
      archiveInfo: "Archivar oculta la categoría de los selectores sin tocar tu historial: los periodos cerrados siguen sumando igual. Nada se borra si algo lo usa.",
    },
    archive: {
      archive: "Archivar categoría",
      title: "¿Archivar la categoría?",
      message: "{name}. Se ocultará de los selectores; tu historial y los periodos cerrados no cambian.",
      messageWithCount: "{name}. Se archivará junto con sus {count}; tu historial y los periodos cerrados no cambian.",
    },
    validation: { name: "Ponle un nombre a la categoría." },
    form: {
      title: { edit: "Editar categoría", newChild: "Nueva subcategoría", new: "Nueva categoría" },
      closeAria: "Cerrar",
      namePlaceholder: "Nombre de la categoría",
      typeLockedNote: "El tipo no se puede cambiar una vez creada la categoría.",
      needSectionTitle: "¿Necesario o prescindible?",
      needHint: "Separa lo imprescindible del capricho en los resúmenes del periodo.",
      parentSectionTitle: "Dentro de",
      rootChip: "Raíz",
      rootLockedNote: "Una raíz con subcategorías no puede colgarse de otra.",
      newRootChip: "Raíz nueva",
      inheritNote: "Una subcategoría hereda el color y el icono de su raíz.",
      colorSectionTitle: "Color",
      colorHint: "Doce familias de color. Te sugerimos una; si repites la de otra categoría, el icono las distingue.",
      iconSectionTitle: "Icono",
      iconHint: "Los iconos del sistema: los doce de las familias y doce más.",
      colorIconSectionTitle: "Color e icono",
      create: "Crear categoría",
      previewTitle: "Vista previa",
      previewKind: "{type}, {need}",
      previewSpend: "{spent} de {limit} este periodo",
      archiveBtn: "Archivar categoría",
      unarchiveBtn: "Desarchivar categoría",
    },
  },
  etiquetas: {
    title: "Etiquetas de proyecto",
    intro: "Cruzan las categorías: agrupan lo que gastas en un viaje, una reforma o una boda, sin importar en qué categoría caiga cada gasto.",
    footerNote: "Archivar una etiqueta la quita de los selectores, pero sus movimientos la siguen enseñando.",
    new: "Nueva etiqueta",
    row: {
      movements: { one: "{n} movimiento", other: "{n} movimientos" },
      open: "abierta",
      archived: "archivada",
      noLimit: "sin límite",
      ofLimit: "{spent} de {limit}",
      seeMovements: "Ver sus movimientos",
    },
    form: {
      titleNew: "Nueva etiqueta",
      titleEdit: "Editar etiqueta",
      nameLabel: "Nombre",
      namePlaceholder: "p. ej. Viaje Japón",
      limitLabel: "Límite (opcional)",
      limitPlaceholder: "Sin límite",
      save: "Guardar",
      archive: "Archivar",
      unarchive: "Desarchivar",
    },
    error: {
      load: "No se pudieron cargar las etiquetas: {error}",
      save: "No se pudo guardar: {error}",
      archive: "No se pudo archivar: {error}",
    },
  },
  periodo: {
    error: {
      noOpenToClose: "No hay ningún periodo abierto que cerrar.",
      load: "No se pudo cargar el asistente: {error}",
      open: "No se pudo abrir el periodo: {error}",
    },
    header: {
      closing: "Cierras {name} y abres el siguiente",
      first: "Primer periodo",
      title: "Nuevo periodo",
    },
    // El Display del cierre (F-13, F-02): la etiqueta y el pie de esta pantalla, con el desglose
    // de 3 datos que antes vivía en una tarjeta aparte.
    closing: {
      saved: "{name} ahorró",
      savedPct: "El {pct} de lo que ingresaste",
      income: "Ingresos",
      spent: "Gastado",
      count: "Movimientos",
    },
    date: {
      title: "{name} empieza el",
      other: "Otra fecha",
      quickPick: "Elegir un día cercano",
      customLabel: "Fecha de inicio",
      groupAria: "Día de inicio",
    },
    share: {
      title: "Gastos compartidos",
      youPay: "Pagas de lo compartido",
      partnerPays: "{name} pagará el {pct} % restante",
      decreaseAria: "Bajar porcentaje",
      increaseAria: "Subir porcentaje",
    },
    budget: {
      lastMonth: "{name} {amount}",
      noLimitPlaceholder: "Sin límite",
      noCategories: "No hay categorías de gasto configuradas.",
      question: "¿Cuánto quieres gastar?",
      hint: "Límite solo donde te sirva.",
      addAnother: "Añadir límite a otra categoría",
    },
    total: {
      budgetedTitle: "Presupuestado",
      expectedIncome: "Ingresos previstos",
      unassigned: "Sin asignar",
      remaining: "Quedan {amount} sin asignar.",
      over: "Te pasas por {amount} de los ingresos previstos.",
    },
    // Primer periodo (D11): campo efímero de "Ingresos previstos" que solo existe mientras el
    // asistente está abierto — no tiene columna en `periods` y no se persiste al guardar.
    first: {
      expectedIncome: "Ingresos previstos",
    },
    cta: {
      submit: "Abrir periodo",
      saving: "Abriendo…",
      reportNote: "Al abrir el periodo se guarda el informe del que se cierra.",
    },
    // El panel final del asistente de cierre (Task 15, plan 2026-09-10): tras abrir el periodo
    // nuevo, en vez de salir directo, ofrece ver el informe del que se acaba de cerrar.
    finish: {
      autoReport: "Al cerrar se genera el informe de {name} automáticamente.",
      seeReport: "Ver el informe y descargar el PDF",
      done: "Hecho",
    },
  },
  ajustes: {
    title: "Ajustes",
    sheet: {
      title: "Tu hoja de cálculo",
      body: "Exporta todos tus datos a un .xlsx editable en LibreOffice/Sheets, o importa una hoja para sustituir los datos actuales. La copia cifrada (.bce) también se importa desde aquí.",
      // Foto del ticket (N5, §9.6/§9.7): la foto es un adjunto, no un dato del contrato — solo
      // viaja en la copia cifrada.
      attachmentsNote: "La copia cifrada (.bce) incluye las fotos; la hoja (.xlsx) no",
      exportBtn: "Exportar hoja (.xlsx)",
      importBtn: "Importar hoja (.xlsx)",
      encWarn: {
        pre: "La copia cifrada (.bce) solo se abre desde BaseCero con esta contraseña. ",
        bold: "Si la olvidas, la copia es irrecuperable",
        post: " — no se guarda en ningún sitio.",
      },
      passPlaceholder: "Contraseña (mín. {min} caracteres)",
      passRepeatPlaceholder: "Repite la contraseña",
      passTooShort: "Mínimo {min} caracteres.",
      passMismatch: "Las contraseñas no coinciden.",
      encConfirmBtn: "Exportar cifrada",
      encExportBtn: "Exportar copia cifrada (.bce)",
      moreErrors: "y {n} más",
      decIntro: "Esta copia está cifrada. Escribe su contraseña para continuar.",
      decPassPlaceholder: "Contraseña de la copia",
      decConfirmBtn: "Descifrar",
      decPassRequired: "Escribe la contraseña de la copia.",
      decWrongPass: "Contraseña incorrecta o archivo dañado.",
      replaceWarn: "Esto reemplaza TODOS los datos de la app ({n} movimientos actuales). Se descargará una copia antes.",
      replaceBtn: "Reemplazar",
      replaceFailed: "No se pudo reemplazar: {error}",
      exportFailed: "No se pudo exportar: {error}",
      readFailed: "No se pudo leer el archivo: {error}",
    },
    period: {
      title: "Periodo",
      // openedOn/days: segmentos de metaHtml (SISTEMA.md §4.18/§1) — la fila de metadatos de
      // Periodo, sin el reparto (Ajustes.dc.html:35-39 no lo repite: ya lo dice shareHint debajo).
      openedOn: "Abierto el {date}",
      days: { one: "{n} día", other: "{n} días" },
      openLabel: "Abierto",
      shareLabel: "Reparto por defecto",
      shareHint: "Para los gastos nuevos, {name} paga el {pct} %",
      shareSaveFailed: "No se pudo guardar el reparto: {error}",
      closeBtn: "Cerrar periodo y abrir el siguiente",
      closeNoteWithPartner: "Al cerrar fijarás la fecha final y elegirás el reparto con {name} del periodo nuevo. Ábrelo el día que entre la nómina.",
      closeNote: "Al cerrar fijarás la fecha final. Ábrelo el día que entre la nómina.",
    },
    recurring: { title: "Gastos e ingresos recurrentes" },
    subscriptions: {
      title: "Suscripciones",
      // subtitleLive: dato vivo (activeSubscriptions + monthlyTotalCents de subscriptions.js),
      // sustituye al texto fijo de antes (Ajustes.dc.html:89).
      subtitleLive: { one: "{n} activa, {amount} al mes", other: "{n} activas, {amount} al mes" },
    },
    categories: {
      title: "Categorías",
      subtitleWithCount: "{n} categorías, colores e iconos",
      subtitleNoCount: "colores e iconos",
    },
    tags: {
      title: "Etiquetas de proyecto",
      sub: { one: "{n} activa", other: "{n} activas" },
    },
    // body (con la explicación larga del import CSV) se borra: la fila-enlace de Banco (Task 6.2,
    // spec §7.1 bloque 6) ya no lleva párrafo de descripción, solo título + subtítulo "Importar CSV".
    bank: {
      title: "Banco",
      importBtn: "Importar CSV",
    },
    // title/body: el cuerpo descriptivo se borra al migrar a <section> (Task 6.2) — el artboard
    // (Ajustes.dc.html:60) titula el bloque entero "Preferencias" y no lleva párrafo, y currency/
    // format ya quedan claros con sus propias etiquetas de campo.
    prefs: {
      title: "Preferencias",
      quickRegisterLabel: "Registro rápido",
      quickRegisterHint: "Al abrir Registro solo pide importe y categoría. El resto queda plegado tras «Más».",
      currency: "Moneda",
      format: "Formato",
      language: "Idioma",
      partnerLabel: "Compartes gastos con",
      partnerPlaceholder: "Nadie — déjalo vacío si llevas tus cuentas solo",
      partnerNote: "Con nombre, aparecen el reparto y «Liquidar». Vacío, la app es solo tuya.",
      saveBtn: "Guardar preferencias",
      saveFailed: "No se pudieron guardar las preferencias: {error}",
    },
    backup: {
      title: "Copia de emergencia",
      body: "Tus datos viven solo en este dispositivo. Sin cuentas, sin nube.",
      exportBtn: "Exportar copia de seguridad (JSON)",
    },
    // Rediseño B (S4, B-Ajustes): etiquetas de grupo y textos de fila nuevos.
    groups: { period: "Periodo y reparto", prefs: "Preferencias", organize: "Organizar", data: "Tus datos" },
    rows: {
      partnerNone: "Nadie",
      partnerField: "Nombre de la otra persona",
      informeSub: "{name}, abierto el {date}",
      quickRegisterSub: "Solo importe y categoría",
      enc: "Copia cifrada",
      sheet: "Hoja de cálculo",
      sheetNote: "Importar sustituye los datos actuales y también abre una copia cifrada (.bce).",
      bank: "Importar del banco",
      json: "Copia de emergencia",
    },
    about: {
      title: "Acerca de BaseCero",
      feedback: "¿No funciona?",
      privacy: "Privacidad",
      source: "Código fuente",
      license: "Licencia MIT",
      feedbackNote: "El formulario se abre en Tally, fuera de la app: solo viaja lo que escribas ahí.",
    },
    assist: {
      // rowCount: cifra de filas de la ficha del fichero del importador (screens/importar.js, S12).
      rowCount: { one: "{n} fila", other: "{n} filas" },
      dateTitle: "Fecha",
      conceptTitle: "Concepto",
      counterpartyTitle: "Contraparte",
      noColumn: "— sin columna",
      amountTitle: "Importe",
      amountSingleBtn: "Una columna con signo",
      amountSplitBtn: "Cargo y abono",
      debitTitle: "Cargo",
      creditTitle: "Abono",
      noConcept: "(sin concepto)",
      previewTitle: "Así se leerán tus movimientos",
      counterOk: "{readable} de {total} filas se leen bien",
      // counterWarnLine + counterReasons: la segunda línea del pie (spec §7.2 bloque 5), con los
      // motivos que junta summarizeReasons(errors) — sustituyen a la vieja "counterWarn", que
      // citaba solo el PRIMER error (errors[0]) en una sola línea.
      counterWarnLine: { one: "1 fila no se lee", other: "{n} filas no se leen" },
      counterReasons: "{reasons}",
      footNote: "El perfil se guarda en tu dispositivo: la próxima vez este banco se importa directo. Los CSV de N26 se reconocen solos, sin configurar nada.",
      dateFormat: { iso: "año-mes-día", dmy: "día/mes/año" },
      date: {
        unrecognized: "No se reconoce el formato de fecha en esta columna.",
        detected: "{raw} → {iso}, formato {fmt} detectado",
      },
      amount: {
        kindExpense: "gasto",
        kindIncome: "ingreso",
        decimalComma: "coma",
        decimalDot: "punto",
        detected: "{raw} → {kind} de {money}, decimal con {dec} detectado",
        noSampleSingle: "La muestra no tiene ningún importe en esta columna.",
        noSampleSplit: "La muestra no tiene ningún importe de cargo o abono.",
        unrecognized: "No se reconoce el formato de importe en esta columna.",
      },
    },
  },
  importar: {
    title: "Importar extracto",
    steps: { aria: "Pasos", file: "Fichero", columns: "Columnas", result: "Resultado" },
    led: {
      unknown: "Formato no reconocido",
      n26: "N26, reconocido solo",
      profile: "Reconocido con tu perfil guardado",
      saved: "Perfil guardado para la próxima vez",
    },
    cta: { one: "Importar 1 movimiento", other: "Importar {n} movimientos" },
    ctaIdle: "Importar movimientos",
    summaryAria: "Resultado del import",
    tiles: {
      created: { one: "nueva", other: "nuevas" },
      reconciled: { one: "conciliada", other: "conciliadas" },
      skipped: { one: "duplicada, saltada", other: "duplicadas, saltadas" },
    },
    omitted: { one: "1 fila no se pudo leer y se ha omitido.", other: "{n} filas no se pudieron leer y se han omitido." },
    inbox: { one: "La que no tiene categoría está en la bandeja de Movimientos.", other: "Las {n} sin categoría están en la bandeja de Movimientos." },
    allCategorized: "Todas llevan categoría, puesta por el comercio.",
    nothingNew: "No había movimientos nuevos en este fichero.",
    bizumHint: "Liquida en Inicio antes de importar: el Bizum que recibes se concilia solo; el que envías entra como movimiento nuevo.",
    done: "Listo",
  },
  onboarding: {
    cta: { next: "Seguir" },
    // Progreso (controls.js#stepsHtml): «1 de 3» junto a los segmentos; el aria del progressbar.
    progress: { count: "{n} de {total}", aria: "Paso {n} de {total}" },
    // Bienvenida (S13, B-Onb-Bienvenida): marca, Display «Saldo de partida» y tres promesas.
    welcome: {
      brand: "basecero",
      tagline: "Gastos, ingresos y ahorro de cada mes.",
      displayLabel: "Saldo de partida",
      ready: "Listo",
      promise1: "Sin registro ni contraseña",
      promise2: "Funciona sin conexión",
      promise3: "Tus datos se quedan en este móvil",
      startBtn: "Empezar de cero",
      importBtn: "Importar una hoja o copia",
      // «Hoja .xlsx o copia cifrada .bce»: las extensiones van en mono entre los trozos.
      importHint: { pre: "Hoja ", mid: " o copia cifrada ", post: "" },
    },
    account: {
      title: "Tus cuentas",
      subtitle: "Con una basta. El resto, luego en Patrimonio.",
      addAnotherTitle: "Añadir otra",
      firstTitle: "Tu primera cuenta",
      // Las cuatro baldosas (onboarding-steps.js#ACCOUNT_KINDS). Hucha = ahorro con familia imp.
      kindGroup: "Tipo de cuenta",
      kind: { checking: "Corriente", savings: "Ahorro", hucha: "Hucha", liability: "Deuda" },
      checkingDefault: "Corriente, por defecto",
      namePlaceholder: "p. ej. Fondo de emergencia",
      balanceTitle: "Saldo de hoy",
      addBtn: "Añadir cuenta",
      liabilityNote: "Lo que debes se guarda en negativo.",
      needOne: "Crea al menos una cuenta para seguir.",
      createFailed: "No se pudo crear la cuenta: {error}",
      nameRequired: "Ponle un nombre a la cuenta.",
      // Borrar (D9, spec §8 punto 4): solo desde el paso Cuentas, solo cuentas sin movimientos.
      deleteAria: "Borrar {name}",
      deleteTitle: "¿Borrar esta cuenta?",
      deleteBody: "{name}, {amount}. Todavía no tiene movimientos.",
      deleteFailed: "No se pudo borrar la cuenta: {error}",
      // deleteHasMovements: deleteEmptyAccount no lanza cuando el guard frena el borrado (D9), así
      // que ese camino necesita su propio texto para rellenar el {error} de deleteFailed.
      deleteHasMovements: "Ya tiene movimientos.",
    },
    prefs: {
      title: "A tu manera",
      subtitle: "Todo se cambia luego en Ajustes.",
      sharedTitle: "Gastos compartidos",
      partnerLabel: "Con quién, opcional",
      partnerPlaceholder: "Su nombre",
      shareLabel: "Tu parte",
      shareYou: "Tú",
      prefsTitle: "Preferencias",
      currencyLabel: "Moneda",
      currencyOther: "Otra",
      currencyOtherLabel: "Otra moneda",
      language: "Idioma",
      formatLabel: "Formato",
    },
    // Paso 4 (D10/D11, spec §8 punto 6): título + subtítulo del paso — el formulario real vive
    // embebido debajo (renderPeriodoNuevo, embed:true), sin pantalla ilustrativa.
    period: {
      title: "Tu primer periodo",
      subtitle: "Va de nómina a nómina: se abre cuando cobras y se cierra con la siguiente.",
    },
    import: {
      title: "Traer tu copia",
      introPre: "Una hoja ",
      introMid: " exportada desde BaseCero o un backup cifrado ",
      introPost: ". Se carga entera en este dispositivo.",
      chooseFileBtn: "Elegir fichero",
      changeBtn: "Cambiar",
      encryptedTitle: "Backup cifrado",
      passPlaceholder: "Contraseña del backup",
      decrypting: "Descifrando…",
      decryptBtn: "Descifrar",
      readyTitle: "Listo para cargar",
      loading: "Cargando…",
      loadBtn: "Cargar mi copia",
      wrongPass: "La contraseña no es correcta.",
      decryptFailed: "No se pudo descifrar el backup: {error}",
      readFailed: "No se pudo leer el fichero: {error}",
      loadFailed: "No se pudo cargar la copia: {error}",
      summaryAccounts: { one: "{n} cuenta", other: "{n} cuentas" },
      summaryPeriods: { one: "{n} periodo", other: "{n} periodos" },
      summaryMovements: { one: "{n} movimiento", other: "{n} movimientos" },
    },
  },
  // Acuses de recibo de toast.js: guardados que antes no decían nada. Frases cortas, en pasado y
  // sin signos de puntuación finales — se leen de reojo mientras el usuario ya está en otra cosa.
  toast: {
    saved: "Guardado",
    limitSaved: "Límite guardado",
    limitRemoved: "Límite quitado",
    profileSaved: "Perfil de banco guardado",
    subscriptionCancelled: "Suscripción cancelada",
    subscriptionAdded: "Suscripción añadida",
    subscriptionIgnored: "Comercio ignorado",
    renewalSnoozed: "Aviso silenciado hasta la próxima renovación",
  },
  // Suscripciones (N6, «el radar»): cancelar desde el formulario de Recurrentes O desde la propia
  // pantalla del radar comparten este mismo modal — mismas claves para las dos entradas.
  suscripciones: {
    title: "Suscripciones",
    error: { load: "No se pudieron cargar las suscripciones: {error}" },
    empty: {
      title: "Todavía no hay ninguna suscripción",
      body: "Marca una recurrente como suscripción, o espera a que el radar detecte un cargo que se repite con el mismo importe.",
    },
    hero: {
      label: "Te cuestan al año",
      perMonth: "al mes",
      activeCount: { one: "{n} activa", other: "{n} activas" },
      chartLabel: "Renovaciones de los próximos 30 días",
    },
    notice: {
      title: "{name} se renueva el {when}",
      question: "¿Lo sigues usando?",
      keep: "Lo sigo usando",
      cancel: "Voy a cancelarlo",
    },
    section: {
      active: "Activas",
      activeHint: "Por fecha de renovación",
      candidates: "Puede que sea una suscripción",
      cancelled: "Canceladas",
    },
    row: {
      renewsOn: "renueva el {date}",
      renewsInDays: { one: "renueva el {date}, en {n} día", other: "renueva el {date}, en {n} días" },
      renewsWeekly: "renueva cada semana",
      perYear: "/año",
      noDate: "sin fecha de renovación",
    },
    candidate: {
      sameAmountOn: "mismo importe el {dates}",
      add: "Sí, añádela",
      ignore: "Ignorar",
    },
    cancelled: {
      on: "cancelada el {date}",
      saved: "ahorrados desde entonces",
      paused: "pausada",
    },
    cancel: {
      title: "¿Cancelar la suscripción?",
      message: "{name}. Dejará de contar como pendiente y empezaremos a contar lo que te ahorras. Puedes volver a activarla cuando quieras.",
      confirm: "Cancelar",
    },
  },
  // Task 5 (PR i18n): errores de capas no-UI (repo/n26/xlsx/csv-generic/backup-crypto/db-worker) —
  // el string ES es el mensaje literal que ya lanzaban esas capas (byte-exacto, lo pinnean los
  // asserts de xlsx.test/patrimonio.test/categorias.test bajo el idioma por defecto).
  errors: {
    // Lo que ve el usuario cuando el error NO está escrito para él (errors.js#userMessage): el
    // detalle técnico se va a console.error y aquí queda algo accionable.
    generic: "Algo no fue bien. Inténtalo de nuevo.",
    repo: {
      periodStartTooEarly: "La fecha debe ser posterior al inicio del periodo actual",
      settleNotFound: "Gasto compartido no encontrado o ya liquidado",
      txNotFound: "Movimiento no encontrado",
      txLockedSettled: "Este gasto tiene un apunte de liquidación enlazado (devolución o ajuste): bórralo antes en Movimientos para cambiar el importe, el reparto o quién pagó.",
      sharePctInvalid: "El reparto debe estar entre 0 y 100.",
      budgetInvalid: "El límite tiene que ser un importe mayor que cero.",
      refundLockedSettled: "Este apunte está enlazado a un gasto ya liquidado. Bórralo o desvincúlalo antes de cambiar su importe.",
      expenseLockedHasRefund: "Este gasto tiene un apunte de liquidación enlazado. Bórralo antes en Movimientos.",
      paidByNotShared: "Solo un gasto compartido puede pagarlo la contraparte.",
      ruleNotFound: "Regla no encontrada",
      accountNotFound: "Cuenta no encontrada",
      goalNotFound: "Objetivo no encontrado",
      invalidParent: "La categoría elegida como padre no es válida: debe ser una categoría principal del mismo tipo (gasto o ingreso)",
      categoryNameEmpty: "El nombre de la categoría no puede estar vacío",
      parentArchived: "No se puede crear una subcategoría dentro de una categoría archivada",
      flowImmutable: "El tipo de la categoría (gasto o ingreso) no se puede cambiar una vez creada",
      categoryNotFound: "Categoría no encontrada",
      categoryHasChildren: "Esta categoría tiene subcategorías: solo se permiten dos niveles, no puede convertirse en subcategoría de otra",
      colorUnavailable: "Ese color no está disponible",
      iconUnavailable: "Ese icono no está disponible",
      tagNameEmpty: "El nombre de la etiqueta no puede estar vacío",
      tagNotFound: "Etiqueta no encontrada",
    },
    // Compartida entre repo.js y n26.js (3 sitios, mismo mensaje EXACTO): distinta de
    // common.noOpenPeriod (esa lleva punto final, esta no — no son byte-idénticas).
    common: {
      noOpenPeriod: "No hay ningún periodo abierto",
    },
    n26: {
      noAccount: "No hay ninguna cuenta donde importar: crea una en Patrimonio",
    },
    backupCrypto: {
      notEncrypted: "No es una copia cifrada de BaseCero",
      truncated: "El archivo está truncado o dañado",
      newerVersion: "Copia de una versión más nueva (formato {version}). Actualiza BaseCero.",
      invalidHeader: "Cabecera inválida (iteraciones fuera de rango)",
      wrongPassphrase: "Contraseña incorrecta o archivo dañado",
    },
    // Foto del ticket (N5, Registro v2 §9). bundleCorrupt es el mensaje del UserError que lanza
    // unpackBundle (bundle.js): CFB.read es de una librería que no controlamos.
    attachments: {
      writeFailed: "No se pudo guardar la foto: {error}",
      bundleCorrupt: "La copia está dañada y no se pudieron leer las fotos.",
    },
    xlsx: {
      missingSheet: "falta la pestaña «{table}»",
      schemaVersion: "meta: schema_version debe ser {versions} (es «{value}»)",
      createdWith: "meta: created_with no reconocido («{value}»)",
      pkEmpty: "pestaña «{table}» fila {row}: id vacío",
      pkDuplicate: "pestaña «{table}» fila {row}: id duplicado («{pk}»)",
      pkInvalidChars: "pestaña «{table}» fila {row}: id con caracteres no válidos («{pk}»)",
      enumInvalid: "pestaña «{table}» fila {row}: {col} inválido («{value}»)",
      fkEmpty: "pestaña «{table}» fila {row}: {col} vacío",
      required: "pestaña «{table}» fila {row}: {col} es obligatorio y está vacío",
      fkMissing: "pestaña «{table}» fila {row}: {col} apunta a «{value}» que no existe en {ref}",
      multipleOpen: "periods: hay {n} periodos open (máximo 1)",
      amountNotPositive: "pestaña «transactions» fila {row}: amount debe ser > 0",
      parentSelf: "pestaña «categories» fila {row}: parent_id no puede apuntar a sí misma",
      parentNotRoot: "pestaña «categories» fila {row}: parent_id debe apuntar a una categoría raíz (con parent_id vacío)",
      parentFlow: "pestaña «categories» fila {row}: flow no coincide con el de su categoría padre",
      dateFormat: "pestaña «{table}» fila {row}: {col} no es una fecha ISO válida («{value}»)",
      periodEndMismatch: "pestaña «periods» fila {row}: end_date debe estar vacío si status es open, y con valor si es closed",
      periodOrder: "pestaña «periods» fila {row}: start_date es posterior a end_date",
      fkDeleted: "pestaña «{table}» fila {row}: {col} apunta a «{value}» que está borrado en {ref}",
      numericInvalid: "pestaña «{table}» fila {row}: {col} no es un número válido («{value}»)",
      numericRange: "pestaña «{table}» fila {row}: {col} fuera de rango [{min}, {max}] («{value}»)",
      booleanInvalid: "pestaña «{table}» fila {row}: {col} no es un valor booleano válido («{value}»)",
      paidByNotShared: "pestaña «transactions» fila {row}: paid_by «partner» solo vale en un gasto compartido",
      paidByAccount: "pestaña «transactions» fila {row}: un gasto que pagó la contraparte no puede llevar cuenta",
      refundOfPartnerPaid: "pestaña «transactions» fila {row}: una devolución no puede enlazar un gasto pagado por la contraparte",
      budgetDuplicate: "pestaña «budgets» fila {row}: ya hay otro límite vivo para la misma pareja periodo/categoría (fila {first})",
      cancelledActive: "pestaña «recurring_rules» fila {row}: cancelled_at no puede tener valor con is_active=1",
    },
    csvGeneric: {
      invalidHeaders: "cabeceras inválidas",
      noSampleDate: "la muestra no tiene ninguna fecha válida para autodetectar el formato",
      invalidDate: "fecha inválida",
      invalidAmount: "importe inválido",
      debitCreditBoth: "cargo y abono con valor a la vez",
      debitCreditEmpty: "cargo y abono vacíos",
    },
    worker: {
      unknownOp: "Operación desconocida: {op}",
      failed: "Error en el worker de base de datos: ",
      unknownDetail: "desconocido",
      notInitialized: "La base de datos aún no está lista, inténtalo de nuevo en un momento",
    },
  },
  // Subtítulos de goalProgress (repo.js) por tipo de objetivo — «Superado», «antes de», «/mes»…
  // ES byte-exacto: patrimonio.test.mjs los comprueba con includes/match bajo el idioma por defecto.
  goals: {
    emergencyFund: {
      withAvg: "Hucha en {account}, cubre {months} meses de gasto",
      noAvg: "Hucha en {account}, todavía sin periodos cerrados para calcular el gasto medio",
    },
    savingsTarget: {
      base: "Hucha en {account}",
      beforeDate: ", antes de {date}",
    },
    provision: {
      subtitle: "Provisión, {amount} al mes",
    },
    spendingCap: {
      over: "Superado por {amount}",
      remaining: "Te quedan {amount} para el cierre del periodo",
    },
    savingsRate: {
      subtitle: "Tasa de ahorro del periodo abierto",
    },
  },
  recibo: {
    stamp: "Guardado",
    total: "Total",
    undo: "Deshacer",
    undone: "Movimiento deshecho",
    myPart: "Tu parte",
    tagLabel: "Etiqueta",
    left: "Quedan en {month}",
    today: "Hoy puedes gastar",
    undoFailed: "No se pudo deshacer: {error}",
  },
  // Informe del periodo (F1). screens/informe.js.
  informe: {
    title: "Informe",
    openPeriod: "Periodo en curso, día {n} de {m}",
    closedPeriod: "Cerrado, del {start} al {end}",
    download: "Descargar el PDF",
    downloading: "Generando…",
    // downloadNote: la única nota bajo el primario (F-11, B-Informe).
    downloadNote: { one: "Se genera en tu móvil, con {n} movimiento.", other: "Se genera en tu móvil, con los {n} movimientos." },
    downloadNoteEmpty: "Se genera en tu móvil.",
    selector: { label: "Periodo" },
    older: {
      label: "Anteriores",
      title: "Periodos cerrados",
      viewing: "Viendo",
      none: "Aún no hay periodos cerrados.",
    },
    display: {
      rate: "Ahorras de lo que ingresas",
      overspent: "Gastas más de lo que ingresas",
      vsPrev: "En {name}, el {pct}",
    },
    split: {
      income: "Ingresado",
      aria: "De {income} ingresados, {spent} gastados y {saved} ahorrados",
    },
    summary: {
      spent: "Gastado",
      saved: "Ahorrado",
    },
    compare: {
      title: "Frente a {name}",
      up: "Sube",
      down: "Baja",
    },
    categories: {
      byCategory: "Por categoría",
      vsPrev: "vs {name}",
      rest: "Resto",
      orientativo: "{prev} está cerrado y {current} va por el día {day} de {total}, así que la comparación es orientativa hasta el cierre.",
    },
    shared: {
      net: {
        theyOwe: "{name} te debe",
        youOwe: "Debes a {name}",
        even: "Estáis en paz",
      },
    },
    bento: { movements: "Movimientos" },
    movements: {
      tag: "Etiqueta: {name}",
    },
    empty: {
      title: "Este periodo aún no tiene movimientos",
      text: "El informe se llena con lo que apuntes.",
    },
    error: {
      load: "No se pudo cargar el informe: {error}",
      pdf: "No se pudo generar el PDF: {error}",
    },
    entry: {
      fromHome: "Ver el informe de {name}",
      fromSettings: "Informe del periodo",
    },
    pdf: {
      summary: "Resumen",
      income: "Ingresos",
      spent: "Gastado",
      saved: "Ahorrado",
      available: "Disponible",
      savingsRate: "Tasa de ahorro {pct}%",
      savingsRateNegative: "Gastas más de lo que ingresas",
      savingsRateVsPrev: "En {name}, el {pct} %",
      accounts: "Tus cuentas",
      accountsTotal: "Total operativo {amount}",
      categories: "Gasto por categoría",
      categoriesTotal: "Total {amount}",
      shared: "Con {name}",
      periodTotal: "Total del periodo {amount}",
      myPart: "Mi parte {amount}",
      net: "Neto {amount}",
      subscriptions: "Suscripciones",
      subscriptionsActive: "{n} activas, {amount} al mes",
      subscriptionsYear: "{amount} al año",
      movements: "Movimientos por categoría",
      others: "Otros",
    },
  },
  // El barrido (N4, plan 2026-09-10): paso del asistente de cierre.
  barrido: {
    title: "Te sobran {amount} del presupuesto",
    titleIncome: "Te sobran {amount}",
    question: "¿Qué hacemos con ellos?",
    toGoal: "Al {name}",
    wouldBe: "quedaría en {amount}",
    completes: "¡Lo completa!",
    leaveIt: "Dejarlo en la cuenta",
    amount: "Cantidad a barrer",
    capped: "Como mucho puedes barrer {amount}: es lo que hay en {account}",
    note: "Barrido de fin de periodo",
  },
  // Tema de la app (DESIGN §3): fila de Ajustes. Las claves de valor son las preferencias de theme.js.
  theme: {
    label: "Tema",
    light: "Claro",
    dark: "Oscuro",
    system: "Sistema",
  },
  // Familias de color de categoría (PR-04): el NOMBRE del color, no el de la categoría que lo usa.
  families: {
    casa: "Arena", ali: "Salvia", res: "Mostaza", tra: "Cielo", coc: "Pizarra", sal: "Agua",
    sus: "Lavanda", oci: "Rosa", rop: "Ciruela", reg: "Arcilla", imp: "Oliva", otr: "Piedra",
  },
  // Etiquetas accesibles de los iconos de categoría (selector de la pantalla de edición).
  icons: {
    cat: {
      casa: "Casa", ali: "Cesta de la compra", res: "Taza", tra: "Autobús", coc: "Coche", sal: "Pulso",
      sus: "Renovación", oci: "Entrada", rop: "Camiseta", reg: "Regalo", imp: "Recibo", otr: "Puntos",
      huella: "Huella", hoja: "Hoja", libro: "Libro", nota: "Nota musical", avion: "Avión", estrella: "Estrella",
      billete: "Billete", bebe: "Bebé", portatil: "Portátil", mando: "Mando de juego", paquete: "Paquete", birrete: "Birrete",
    },
  },
};
