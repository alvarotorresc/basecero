const MY_AMOUNT = `CAST(ROUND(t.amount_cents * (CASE WHEN t.is_shared=1
  THEN COALESCE(t.share_pct_override, p.my_share_pct, 100) ELSE 100 END) / 100.0) AS INTEGER)`;

// Una devolución resta del gasto SIEMPRE, salvo que sea la liquidación de un gasto compartido
// (ref_id apunta a un gasto con is_shared=1): ahí mi gasto ya contaba solo mi parte y lo que
// vuelve es la parte de la contraparte. Vinculada a un gasto NO compartido (la tienda devuelve el
// dinero) o sin vincular, resta prorrateada por MY_AMOUNT. Lo usan spentOfPeriod,
// spentByRootCategory y spentByDay — los tres con el MISMO criterio. Un gasto enlazado ya borrado
// (solo alcanzable importando una hoja: la app bloquea borrar un gasto con devolución viva) cuenta
// como huérfano.
const REFUND_REDUCES_SPEND = `(t.ref_id='' OR NOT EXISTS (
  SELECT 1 FROM transactions e WHERE e.id=t.ref_id AND e.is_shared=1 AND e.deleted=0))`;

// El gasto imputado a una etiqueta, con el MISMO criterio que spentByRootCategory: mi parte
// prorrateada (MY_AMOUNT) y las devoluciones restadas salvo que liquiden un compartido
// (REFUND_REDUCES_SPEND). Se escribe UNA vez: si el total de la pantalla Etiquetas y el de la
// cabecera de Movimientos usaran criterios distintos, el mismo viaje valdría dos cifras.
// Alias `tg` para tags: `t` y `p` los ocupan MY_AMOUNT y REFUND_REDUCES_SPEND.
const TAG_SPENT = `COALESCE(SUM(CASE
    WHEN t.type='expense' THEN ${MY_AMOUNT}
    WHEN t.type='refund' AND ${REFUND_REDUCES_SPEND} THEN -${MY_AMOUNT} ELSE 0 END),0)`;

export const SQL = {
  getOpenPeriod: `SELECT * FROM periods WHERE status='open' AND deleted=0 LIMIT 1`,
  insertPeriod: `INSERT INTO periods (id,name,start_date,end_date,status,my_share_pct,notes,created_at,updated_at,deleted)
    VALUES (?,?,?,'','open',?,'',?,?,0)`,
  insertTransaction: `INSERT INTO transactions (id,date,period_id,type,amount_cents,account_id,counter_account_id,
    category_id,merchant,note,is_shared,share_pct_override,paid_by,settled,ref_id,rule_id,tag_id,external_id,has_attachment,status,created_at,updated_at,deleted)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
  spentOfPeriod: `SELECT COALESCE(SUM(CASE
      WHEN t.type='expense' THEN ${MY_AMOUNT}
      WHEN t.type='refund' AND ${REFUND_REDUCES_SPEND} THEN -${MY_AMOUNT}
      ELSE 0 END),0) AS spent_cents
    FROM transactions t JOIN periods p ON p.id=t.period_id
    WHERE t.period_id=? AND t.deleted=0`,
  // Gastos que se pueden enlazar desde una devolución (selector de Registro). paid_by='me': una
  // devolución de tienda sobre una compra que pagó la contraparte es dinero que le devuelven a ELLA;
  // enlazarla desde mi Registro crearía un ingreso en mi cuenta que nunca existió.
  //
  // refunded_cents = lo que ya ha vuelto de ese gasto: la suma de los apuntes de liquidación VIVOS
  // que lo enlazan por ref_id, con el mismo criterio de tipos que hasActiveLinkedSettlement
  // ('refund' + 'adjustment'). ABS a propósito: el ajuste SALIENTE de una liquidación se guarda con
  // importe negativo (repo.settleAllSharedStmts). Hoy no puede alcanzar esta consulta —solo enlaza
  // gastos con paid_by='partner', que el WHERE excluye—, pero una hoja editada a mano sí puede dejar
  // uno colgando de un gasto mío, y sin el ABS ese gasto sumaría un «devuelto» NEGATIVO que el
  // marcador de la UI (refunded_cents > 0) leería como «sin devolver».
  //
  // Dos ORDER BY, no uno: el de DENTRO con su LIMIT 15 elige EXACTAMENTE las mismas 15 filas de
  // siempre (las más recientes); el de FUERA solo las recoloca, empujando al final las que ya tienen
  // algo devuelto. Con un único ORDER BY, el LIMIT preferiría los gastos sin devolver y un gasto
  // reciente ya devuelto —el que el usuario más probablemente busca para una devolución parcial—
  // podría desaparecer de la lista.
  recentForRefund: `SELECT * FROM (
      SELECT t.id, t.date, t.created_at, t.amount_cents, t.merchant, t.category_id, t.is_shared, t.settled,
        t.share_pct_override, p.my_share_pct AS period_pct,
        COALESCE((SELECT SUM(ABS(r.amount_cents)) FROM transactions r
          WHERE r.ref_id=t.id AND r.type IN ('refund','adjustment') AND r.deleted=0),0) AS refunded_cents
      FROM transactions t JOIN periods p ON p.id=t.period_id
      WHERE t.deleted=0 AND t.type='expense' AND t.paid_by='me'
        AND (t.period_id=? OR (t.is_shared=1 AND t.settled=0))
      ORDER BY t.date DESC, t.created_at DESC LIMIT 15
    ) AS recent
    ORDER BY (refunded_cents > 0), date DESC, created_at DESC`,
  incomeOfPeriod: `SELECT COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount_cents ELSE 0 END),0) AS income_cents
    FROM transactions t WHERE t.period_id=? AND t.deleted=0`,
  // 'adjustment' entra en la lista de Inicio (antes: expense/income/refund). Una liquidación crea
  // DOS apuntes (repo.js#settleAllSharedStmts): la devolución ENTRANTE de un gasto que pagué yo y
  // el ajuste SALIENTE —negativo— de uno que pagó ella. Sin los adjustments, Inicio enseñaba solo
  // la mitad de la liquidación y el pago a la contraparte desaparecía de la pantalla que más se
  // mira. Entran TODOS, no solo los enlazados por ref_id: un ajuste suelto también mueve dinero de
  // una cuenta y Movimientos (listAllByDay) ya los enseña, así que las dos listas dicen lo mismo.
  // NO cambia ningún total: spentOfPeriod / spentByRootCategory / spentByDay solo suman expense y
  // refund, e incomeOfPeriod solo income. Las transferencias siguen fuera (no son del periodo, son
  // entre cuentas propias).
  // OJO para quien pinte estas filas: amount_cents (y my_amount_cents) de un adjustment pueden ser
  // NEGATIVOS — el CHECK de schema.sql:34 lo permite solo para este tipo.
  listByDay: `SELECT t.id, t.date, t.type, t.amount_cents, t.category_id, t.merchant, t.note, t.is_shared, t.paid_by,
      ${MY_AMOUNT} AS my_amount_cents
    FROM transactions t JOIN periods p ON p.id=t.period_id
    WHERE t.period_id=? AND t.deleted=0 AND t.type IN ('expense','income','refund','adjustment')
    ORDER BY t.date DESC, t.created_at DESC`,
  // PR D (categorías editables), Task 4 fix round: el NOT EXISTS comprobaba h.deleted=0 pero NO
  // h.is_archived — una raíz con su única hija archivada (no borrada) seguía "teniendo hijas"
  // para esta query y desaparecía del selector junto a ella. Con AND h.is_archived=0, una hija
  // archivada deja de contar: la raíz vuelve a ser hoja efectiva y reaparece (ver
  // tests/app/categorias.test.mjs, test de regresión).
  // Item 5 (Important, review final): el ORDER BY ya no es solo c.display_order — ese es el
  // display_order DENTRO del grupo (raíces entre sí, hijas de una misma raíz entre sí), así que
  // tras reordenar hijas de una raíz, sus posiciones (1..n) podían intercalarse con las de OTRA
  // raíz que casualmente compartiera los mismos números, descolocando el selector de Registro. El
  // COALESCE ordena primero por el display_order de la RAÍZ de cada hoja (su propio display_order
  // si ya es raíz, como en listIncomeCategories), agrupando las hojas por la posición de su árbol;
  // c.parent_id de tiebreak dentro de esa raíz pone a la raíz ('' ordena antes que cualquier id)
  // justo antes de sus hijas en listIncomeCategories (que no filtra por hoja, incluye raíces e
  // hijas mezcladas); c.display_order final decide el orden dentro de ese mismo grupo.
  listExpenseLeafCategories: `SELECT c.id, c.name FROM categories c
    WHERE c.flow='expense' AND c.deleted=0 AND c.is_archived=0
      AND NOT EXISTS (SELECT 1 FROM categories h WHERE h.parent_id=c.id AND h.deleted=0 AND h.is_archived=0)
    ORDER BY COALESCE((SELECT p.display_order FROM categories p WHERE p.id=c.parent_id AND p.deleted=0), c.display_order), c.parent_id, c.display_order`,
  listIncomeCategories: `SELECT c.id, c.name FROM categories c
    WHERE c.flow='income' AND c.deleted=0 AND c.is_archived=0
    ORDER BY COALESCE((SELECT p.display_order FROM categories p WHERE p.id=c.parent_id AND p.deleted=0), c.display_order), c.parent_id, c.display_order`,
  listAccounts: `SELECT id, name, type FROM accounts WHERE deleted=0 AND is_archived=0 ORDER BY display_order`,
  allCategories: `SELECT id, name, parent_id FROM categories WHERE deleted=0`,
  dumpTable: (t) => `SELECT * FROM ${t}`,   // solo para exportAllJson; t viene de la lista fija de tablas

  // my_share_pct se añade sobre el SELECT literal del brief: el detalle de Movimientos lo
  // necesita para mostrar el reparto real (mismo criterio que registro.js), no un 100% fijo.
  listPeriods: `SELECT id, name, start_date, end_date, status, my_share_pct FROM periods WHERE deleted=0 ORDER BY start_date DESC`,
  listAllByDay: `SELECT t.id, t.date, t.type, t.amount_cents, t.category_id, t.merchant, t.note, t.is_shared,
      t.account_id, t.counter_account_id, t.share_pct_override, t.paid_by, t.ref_id, t.rule_id, t.tag_id, t.status,
      ${MY_AMOUNT} AS my_amount_cents
    FROM transactions t JOIN periods p ON p.id=t.period_id
    WHERE t.period_id=? AND t.deleted=0
    ORDER BY t.date DESC, t.created_at DESC`,
  // Ventana de la memoria de comercios (merchant-memory.js). Solo gastos/ingresos/devoluciones:
  // una transferencia o un ajuste no tienen comercio que recordar. `LIMIT ?` lo pone el repo con
  // MEMORY_WINDOW. Sirve el índice tx_date (schema.sql:48): no hace falta uno nuevo sobre merchant
  // — la app es de un único usuario, y 500 filas ordenadas por fecha se resuelven de sobra con el
  // índice que ya existe.
  merchantHistory: `SELECT merchant, category_id, account_id, is_shared, share_pct_override,
      paid_by, date, type
    FROM transactions
    WHERE deleted=0 AND merchant<>'' AND type IN ('expense','income','refund')
    ORDER BY date DESC, id DESC LIMIT ?`,
  getTransaction: `SELECT * FROM transactions WHERE id=? AND deleted=0`,
  updateTransaction: `UPDATE transactions SET type=?, amount_cents=?, date=?, category_id=?, account_id=?,
    counter_account_id=?, merchant=?, note=?, is_shared=?, share_pct_override=?, paid_by=?, ref_id=?, rule_id=?, tag_id=?, status=?,
    updated_at=? WHERE id=?`,
  softDeleteTransaction: `UPDATE transactions SET deleted=1, updated_at=? WHERE id=?`,
  // Foto del ticket (N5, Registro v2 §9.4): UPDATE de una sola columna, aparte de
  // insertTransaction/updateTransaction — se llama DESPUÉS de que el fichero ya esté escrito en
  // OPFS (attachments.put), nunca antes: así una fila nunca promete una foto que no existe.
  setAttachmentFlag: `UPDATE transactions SET has_attachment=?, updated_at=? WHERE id=?`,
  // Al borrar un apunte de liquidación enlazado (ref_id) —la devolución ENTRANTE de un gasto mío o
  // el ajuste SALIENTE de uno que pagó la contraparte— revierte settled=1 del gasto original SOLO
  // si no queda ningún otro apunte activo apuntándole — bind: [refId, apunteIdBorrado, now, refId].
  unsettleIfNoActiveSettlements: `UPDATE transactions SET settled = CASE WHEN EXISTS(
      SELECT 1 FROM transactions r WHERE r.ref_id=? AND r.type IN ('refund','adjustment') AND r.deleted=0 AND r.id<>?
    ) THEN 1 ELSE 0 END, updated_at=? WHERE id=?`,
  // ¿Tiene `txId` algún apunte de liquidación ACTIVO (no borrado) que lo enlace por ref_id? Cubre
  // la devolución entrante y el ajuste saliente. Guarda tanto la UI (bloquea importe/compartido en
  // Movimientos) como updateTransaction (rechaza el cambio aunque alguien salte la UI). Discriminador
  // seguro: ningún adjustment de usuario lleva ref_id (Registro solo lo guarda para type='refund',
  // registro.js:426, y el selector de vínculo solo se pinta para ese tipo, registro.js:245).
  hasActiveLinkedSettlement: `SELECT 1 FROM transactions r
    WHERE r.ref_id=? AND r.type IN ('refund','adjustment') AND r.deleted=0 LIMIT 1`,
  countUncategorized: `SELECT COUNT(*) AS n FROM transactions
    WHERE period_id=? AND deleted=0 AND category_id='' AND type IN ('expense','income','refund')`,
  // Compartidos sin liquidar de TODOS los periodos (no solo el abierto), en las DOS direcciones.
  // La fila ya no trae "lo que me debe" sino settle_cents (lo que hay que mover por esa fila) y
  // direction (quién debe a quién):
  //   paid_by='me'      → lo pagué yo, ella me debe amount_cents - MY_AMOUNT   → 'partner_owes'
  //   paid_by='partner' → lo pagó ella, yo le debo MI parte, MY_AMOUNT         → 'i_owe'
  // type='expense' sigue siendo necesario (is_shared/settled existen también en income/refund) y el
  // filtro settle_cents > 0 es el criterio de siempre extendido a la otra dirección: una fila a 0 no
  // cambia el neto, pero SÍ reventaría el CHECK amount_cents>0 del apunte que la liquidación crearía.
  pendingSettlements: `SELECT t.id, t.date, t.amount_cents, t.merchant, t.category_id, t.paid_by,
      CASE WHEN t.paid_by='partner' THEN 'i_owe' ELSE 'partner_owes' END AS direction,
      CASE WHEN t.paid_by='partner' THEN ${MY_AMOUNT} ELSE t.amount_cents - ${MY_AMOUNT} END AS settle_cents
    FROM transactions t JOIN periods p ON p.id=t.period_id
    WHERE t.type='expense' AND t.is_shared=1 AND t.settled=0 AND t.deleted=0
      AND (CASE WHEN t.paid_by='partner' THEN ${MY_AMOUNT} ELSE t.amount_cents - ${MY_AMOUNT} END) > 0
    ORDER BY t.date ASC`,
  // Neto: POSITIVO = la contraparte me debe, NEGATIVO = le debo yo. Mismo WHERE (filtro > 0
  // incluido) que pendingSettlements, para que el neto sea siempre la suma exacta de las filas que
  // la pantalla lista y no pueda divergir del hero de Liquidar.
  pendingSettlementNet: `SELECT COALESCE(SUM(CASE WHEN t.paid_by='partner'
        THEN -${MY_AMOUNT} ELSE t.amount_cents - ${MY_AMOUNT} END),0) AS net_cents
    FROM transactions t JOIN periods p ON p.id=t.period_id
    WHERE t.type='expense' AND t.is_shared=1 AND t.settled=0 AND t.deleted=0
      AND (CASE WHEN t.paid_by='partner' THEN ${MY_AMOUNT} ELSE t.amount_cents - ${MY_AMOUNT} END) > 0`,

  // PR C (contraparte), Task 5: ¿existe alguna transacción o regla con is_shared=1, de
  // cualquier tipo? Detecta el caso "BD con compartidos de antes de la contraparte configurable"
  // para el banner de migración de una sola vez de Inicio (repo.hasSharedData) — a diferencia de
  // pendingSettlements, aquí no importa el type ni si está settled: solo si alguna vez se marcó algo
  // como compartido.
  hasSharedTx: `SELECT 1 FROM transactions WHERE is_shared=1 AND deleted=0 LIMIT 1`,
  hasSharedRule: `SELECT 1 FROM recurring_rules WHERE is_shared=1 AND deleted=0 LIMIT 1`,

  closePeriod: `UPDATE periods SET end_date=?, status='closed', updated_at=? WHERE id=?`,
  // Cambia el reparto por defecto del periodo (Ajustes). Va SIEMPRE precedido, en el mismo
  // execMany, de freezePeriodShareOverrides: los gastos compartidos del periodo que aún seguían al
  // periodo (override NULL: filas de antes de que la UI guardara el % explícito, o importadas de
  // una hoja con la celda en blanco) se congelan en el valor ACTUAL antes de cambiarlo — así el
  // cambio afecta solo a los gastos nuevos, que es lo que promete el texto de Ajustes, y ningún
  // importe ya calculado se mueve.
  updatePeriodShare: `UPDATE periods SET my_share_pct=?, updated_at=? WHERE id=? AND deleted=0`,
  // Bind: [periodId, now, periodId]. La subconsulta lee el my_share_pct VIGENTE (por eso debe
  // ejecutarse ANTES de updatePeriodShare dentro de la misma transacción).
  freezePeriodShareOverrides: `UPDATE transactions
    SET share_pct_override=(SELECT my_share_pct FROM periods WHERE id=?), updated_at=?
    WHERE period_id=? AND is_shared=1 AND share_pct_override IS NULL AND deleted=0`,
  // Suma por categoría RAÍZ de gasto (parent_id='') el gasto de toda su subárbol (ella misma +
  // hijas directas): child.id=root.id cubre el gasto registrado directamente en la raíz, y
  // child.parent_id=root.id el de sus hijas. Resta refunds que no sean liquidación de un
  // compartido (REFUND_REDUCES_SPEND), prorrateados, igual criterio que spentOfPeriod. La
  // reutilizan CUATRO consumidores, no dos: inicio.js (donut y tarjeta de categorías),
  // gasto-por-categoria.js (la lista entera), periodo-nuevo.js (las filas de límites del asistente,
  // en los dos modos) y repo.goalsWithProgress (el ctx de un goal de tipo spending_cap). Filtrar
  // aquí is_archived/deleted en la raíz afecta a los cuatro a la vez: es lo que hace, por ejemplo,
  // que una raíz archivada no pueda recibir límite en Periodo nuevo.
  spentByRootCategory: `SELECT root.id AS root_id, root.name,
    COALESCE(SUM(CASE WHEN t.type='expense' THEN ${MY_AMOUNT}
                 WHEN t.type='refund' AND ${REFUND_REDUCES_SPEND} THEN -${MY_AMOUNT} ELSE 0 END),0) AS spent_cents
  FROM categories root
  LEFT JOIN categories child ON (child.id=root.id OR child.parent_id=root.id) AND child.deleted=0
  LEFT JOIN transactions t ON t.category_id=child.id AND t.period_id=? AND t.deleted=0
  LEFT JOIN periods p ON p.id=t.period_id
  WHERE root.parent_id='' AND root.flow='expense' AND root.deleted=0 AND root.is_archived=0
  GROUP BY root.id ORDER BY spent_cents DESC`,
  // Gasto por SUBcategoría dentro de una raíz (pantalla «Gasto por categoría», bloque desplegable).
  // Una fila por la raíz misma (c.id=?) y otra por cada hija directa (c.parent_id=?) — el árbol de
  // categorías tiene solo dos niveles, no hay que recursar. La fila con category_id = la raíz es el
  // gasto anotado DIRECTAMENTE en ella (la pantalla la pinta como «Sin subcategoría», y solo si la
  // raíz tiene hijas: sin hijas esa fila sería el total de la raíz repetido).
  // Mismo criterio que spentByRootCategory (MY_AMOUNT prorrateado, REFUND_REDUCES_SPEND, periodo y
  // t.deleted=0) para que la suma de las filas cuadre EXACTAMENTE con el spent_cents de la raíz.
  // Por eso NO se filtra is_archived: spentByRootCategory tampoco lo hace en su join de hijas y
  // archivar conserva el historial; si aquí se filtrara, el desglose dejaría de sumar el total de la
  // fila de arriba justo cuando el usuario archiva una subcategoría que sí tuvo gasto. La UI ya
  // descarta las filas a 0, así que una archivada sin usar nunca llega a pintarse.
  // Bind: [periodId, rootId, rootId].
  spentByChildCategory: `SELECT c.id AS category_id, c.name,
    COALESCE(SUM(CASE WHEN t.type='expense' THEN ${MY_AMOUNT}
                 WHEN t.type='refund' AND ${REFUND_REDUCES_SPEND} THEN -${MY_AMOUNT} ELSE 0 END),0) AS spent_cents
  FROM categories c
  LEFT JOIN transactions t ON t.category_id=c.id AND t.period_id=? AND t.deleted=0
  LEFT JOIN periods p ON p.id=t.period_id
  WHERE (c.id=? OR c.parent_id=?) AND c.deleted=0
  GROUP BY c.id ORDER BY spent_cents DESC`,
  insertBudget: `INSERT INTO budgets (id,period_id,category_id,amount_cents,created_at,updated_at,deleted)
    VALUES (?,?,?,?,?,?,0)`,
  // Límites VIVOS del periodo, SOLO los de categorías vivas y NO archivadas — el JOIN es el filtro.
  // Un límite cuya categoría se archivó (o se borró) después de ponerlo sigue en la tabla, así que
  // desarchivarla lo recupera tal cual; pero mientras tanto no puede sumar en ningún total. Era el
  // defecto real: spentByRootCategory filtra root.is_archived=0, así que esa categoría desaparecía
  // de todas las listas, y sin embargo disponibleCardHtml (inicio.js) seguía descontando su límite
  // del «disponible» — un presupuesto invisible que el usuario no podía ni ver ni quitar.
  //
  // ORDER BY updated_at DESC, id DESC: el MISMO desempate que budgetOfCategory. La app nunca crea dos
  // filas vivas para la misma (periodo, categoría) —upsertBudget actualiza la que ya hay—, pero una
  // hoja editada a mano sí; con este orden, «el primero gana» (category-spend.js#budgetMap) elige
  // siempre el más reciente, exactamente el mismo que budgetOfCategory carga al editarlo.
  budgetsOfPeriod: `SELECT b.id, b.category_id, b.amount_cents FROM budgets b
    JOIN categories c ON c.id=b.category_id AND c.deleted=0 AND c.is_archived=0
    WHERE b.period_id=? AND b.deleted=0
    ORDER BY b.updated_at DESC, b.id DESC`,
  // Límite VIVO de una categoría en un periodo (pantalla «Gasto por categoría»): lo lee upsertBudget
  // para decidir entre UPDATE e INSERT. Con más de una fila viva —solo alcanzable importando una
  // hoja a mano; softDeleteBudget las barre todas— gana la de updated_at más reciente, con id DESC
  // de desempate para que la elección sea determinista aunque coincidan los timestamps.
  // Bind: [periodId, categoryId].
  budgetOfCategory: `SELECT id, amount_cents FROM budgets WHERE period_id=? AND category_id=? AND deleted=0
    ORDER BY updated_at DESC, id DESC LIMIT 1`,
  // Bind: [amountCents, updatedAt, budgetId].
  updateBudget: `UPDATE budgets SET amount_cents=?, updated_at=? WHERE id=? AND deleted=0`,
  // Quitar el límite = borrado LÓGICO (la fila se conserva para el round-trip del xlsx, que ya
  // salta las FKs de las filas con deleted=1). Por (periodo, categoría) y no por id: así es
  // idempotente (sin fila viva no toca nada) y barre un duplicado colado por un import a mano.
  // Bind: [updatedAt, periodId, categoryId].
  softDeleteBudget: `UPDATE budgets SET deleted=1, updated_at=? WHERE period_id=? AND category_id=? AND deleted=0`,

  // Gasto por día en un rango. Mismo criterio que spentOfPeriod (MY_AMOUNT de expenses, restan
  // las devoluciones que no sean liquidación de un compartido (REFUND_REDUCES_SPEND),
  // prorrateadas), agrupado por fecha. Solo trae los días con movimiento — quien la consuma
  // rellena los que faltan con 0 en JS (semana-logic.js#fillDays). Se mantiene como invariante de
  // regresión de spentByDayAndRootCategory (tests/app/charts.test.mjs y repo-sql.test.mjs), que
  // comparte el mismo criterio de prorrateo/devoluciones.
  // Bind: [periodId, startDateIso, endDateIso].
  spentByDay: `SELECT t.date AS date,
    COALESCE(SUM(CASE WHEN t.type='expense' THEN ${MY_AMOUNT}
                 WHEN t.type='refund' AND ${REFUND_REDUCES_SPEND} THEN -${MY_AMOUNT} ELSE 0 END),0) AS cents
  FROM transactions t JOIN periods p ON p.id=t.period_id
  WHERE t.period_id=? AND t.deleted=0 AND t.date BETWEEN ? AND ?
  GROUP BY t.date`,

  // Gasto por día Y categoría RAÍZ (Inicio v2, plan 2026-09-10: la espina de Semana y sus chips).
  // Mismo criterio de prorrateo/devoluciones que spentByDay — (a) LEFT JOIN en vez de JOIN: el
  // total de un día tiene que poder seguir siendo el mismo que da spentByDay aunque el movimiento
  // no tenga categoría o su categoría esté borrada (root_id cae a ''); con INNER JOIN esas filas
  // desaparecerían y la suma por root_id de un día dejaría de cuadrar con spentByDay de ese día
  // (invariante fijada por el test "invariante" de repo-sql.test.mjs). (b) NO se filtra
  // root.is_archived (a diferencia de spentByRootCategory:188 más abajo): esta consulta agrupa por
  // DÍA, no por periodo, así que una raíz archivada con historial en la ventana sigue sumando en
  // su día — divergencia aceptada y documentada en la spec (decisión 10): aquí importa más que el
  // total del día cuadre que la simetría con el desglose del periodo. (c) bind:
  // [periodId, startIso, endIso].
  spentByDayRootCategory: `SELECT t.date AS date, COALESCE(root.id, '') AS root_id,
    COALESCE(SUM(CASE WHEN t.type='expense' THEN ${MY_AMOUNT}
                 WHEN t.type='refund' AND ${REFUND_REDUCES_SPEND} THEN -${MY_AMOUNT} ELSE 0 END),0) AS cents
  FROM transactions t
  JOIN periods p ON p.id = t.period_id
  LEFT JOIN categories child ON child.id = t.category_id AND child.deleted = 0
  LEFT JOIN categories root ON root.id = CASE WHEN COALESCE(child.parent_id,'') = '' THEN child.id ELSE child.parent_id END
  WHERE t.period_id = ? AND t.deleted = 0 AND t.date BETWEEN ? AND ?
    AND t.type IN ('expense','refund')
  GROUP BY t.date, root_id`,

  // Fechas (únicas) con algún apunte de dinero real, más recientes primero — la racha y el «llevas
  // N días sin apuntar» de la hucha (Inicio v2). SIN filtro de periodo a propósito (spec decisión
  // 17): acotarla al periodo abierto haría que el día 1 de un periodo nuevo una racha de 40 días se
  // leyera «1 día». transfer/adjustment quedan fuera: mover dinero entre cuentas propias o el
  // apunte automático de una liquidación no son «haber apuntado algo». LIMIT 60 acota el coste —
  // de sobra para una racha que se enseña en dos dígitos.
  recentTxDates: `SELECT DISTINCT date FROM transactions
    WHERE deleted = 0 AND type IN ('expense','income','refund')
    ORDER BY date DESC LIMIT 60`,

  // Reglas recurrentes (Task 10). Activas primero, luego alfabético — mismo criterio que la
  // lista de Recurrentes (las inactivas se apilan al final con su badge gris).
  listRules: `SELECT * FROM recurring_rules WHERE deleted=0 ORDER BY is_active DESC, name`,
  getRule: `SELECT * FROM recurring_rules WHERE id=? AND deleted=0`,
  insertRule: `INSERT INTO recurring_rules (id,name,type,amount_cents,category_id,account_id,counter_account_id,
    frequency,due_day,due_month,is_shared,is_active,is_subscription,cancelled_at,created_at,updated_at,deleted)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
  updateRule: `UPDATE recurring_rules SET name=?, type=?, amount_cents=?, category_id=?, account_id=?,
    counter_account_id=?, frequency=?, due_day=?, due_month=?, is_shared=?, is_active=?, is_subscription=?,
    cancelled_at=?, updated_at=?
    WHERE id=?`,
  softDeleteRule: `UPDATE recurring_rules SET deleted=1, updated_at=? WHERE id=?`,

  // Cancela una suscripción (Task 2): apaga is_active Y sella cancelled_at en el MISMO UPDATE — no
  // existe el estado intermedio (spec §5.2). No toca una regla ya borrada.
  cancelRule: `UPDATE recurring_rules SET is_active=0, cancelled_at=?, updated_at=? WHERE id=? AND deleted=0`,

  // Enlaza un cargo ya cobrado con la regla que acaba de aceptarse (subscription-detect.js /
  // acceptSubscriptionCandidate). `rule_id=''` en el WHERE es lo que lo hace idempotente y lo que
  // evita pisar un enlace que ya existiera (un cargo que ya cuenta para otra regla no se toca).
  linkTxsToRule: `UPDATE transactions SET rule_id=?, updated_at=? WHERE id=? AND rule_id='' AND deleted=0`,

  // Cargos candidatos a suscripción (subscription-detect.js). Solo gastos MÍOS con comercio: un
  // gasto con paid_by='partner' no salió de ninguna cuenta mía y además lleva account_id='' (ver
  // FKS.optionalWhen en contract.js), así que no podría convertirse en una recurring_rule, cuyo
  // account_id es NOT NULL. La ventana es por FECHA y no por número de filas porque la cadencia
  // anual necesita dos cargos separados más de un año (DETECT_WINDOW_DAYS = 760, ver
  // subscription-detect.js). El LIMIT es solo un tope de seguridad; como el ORDER BY es date DESC,
  // truncar recorta los cargos MÁS ANTIGUOS — puede acortar una racha, nunca inventar un hueco falso.
  // Índice: tx_date (schema.sql). No hace falta ninguno nuevo.
  subscriptionCharges: `SELECT id, date, merchant, amount_cents, category_id, account_id, rule_id
    FROM transactions
    WHERE deleted=0 AND type='expense' AND paid_by='me' AND merchant<>'' AND date>=?
    ORDER BY date DESC, id DESC LIMIT ?`,

  // Previsión (Task 11). Una regla se da por pagada este periodo si hay una transacción
  // ligada por rule_id, O (fallback del dashboard, para movimientos metidos a mano sin
  // enlazar la regla) una con la MISMA categoría y el MISMO importe (sin prorratear).
  paidRuleIds: `SELECT DISTINCT rule_id FROM transactions WHERE period_id=? AND deleted=0 AND rule_id<>''`,
  paidByCatAmount: `SELECT DISTINCT category_id || '|' || amount_cents AS k FROM transactions WHERE period_id=? AND deleted=0`,
  // Saldo de una cuenta a una fecha dada: opening_balance_cents + movimientos hasta esa fecha
  // (inclusive). SQL VERBATIM del brief de Task 11 — la reutilizan Tasks 13/14, no tocar sin
  // revisar esas tareas. Bind: [atDateIso, accountId].
  accountBalance: `SELECT a.opening_balance_cents + COALESCE((SELECT SUM(CASE
      WHEN t.type IN ('expense','transfer') AND t.account_id=a.id THEN -t.amount_cents
      WHEN t.type='transfer' AND t.counter_account_id=a.id THEN t.amount_cents
      WHEN t.type IN ('income','refund') AND t.account_id=a.id THEN t.amount_cents
      WHEN t.type='adjustment' AND t.account_id=a.id THEN t.amount_cents
      ELSE 0 END) FROM transactions t
    WHERE t.deleted=0 AND (t.account_id=a.id OR t.counter_account_id=a.id) AND t.date<=?),0) AS balance_cents
  FROM accounts a WHERE a.id=?`,

  // Patrimonio (Task 13). listAllAccounts es a propósito el mismo shape que listAccounts (no
  // filtra type, incluye el pasivo): un nombre propio para el caso de uso de Patrimonio, que
  // SIEMPRE quiere las 3 cuentas (no solo las de "elige cuenta" de un formulario).
  listAllAccounts: `SELECT id, name, type FROM accounts WHERE deleted=0 AND is_archived=0 ORDER BY display_order`,
  listClosedPeriods: `SELECT * FROM periods WHERE status='closed' AND deleted=0 ORDER BY start_date`,
  listGoals: `SELECT * FROM goals WHERE is_active=1 AND deleted=0 ORDER BY created_at`,

  // Formularios de cuentas y objetivos (Task 14).
  // Selector de categoría de spending_cap: SOLO raíces de gasto (parent_id=''), nunca hijas —
  // ver handoff de goalProgress (repo.js): una hija ahí no hace match con spentByRootCategory
  // y se queda silenciosamente en 0%.
  listExpenseRootCategories: `SELECT id, name FROM categories c
    WHERE c.flow='expense' AND c.parent_id='' AND c.deleted=0 AND c.is_archived=0 ORDER BY c.display_order`,
  getAccount: `SELECT * FROM accounts WHERE id=? AND deleted=0`,
  // display_order = MAX actual + 1 en la MISMA sentencia (SELECT en vez de VALUES): así una
  // cuenta nueva (manual o hucha automática de un goal) siempre se coloca al final de la lista
  // sin que repo.js tenga que hacer una query aparte para calcularlo.
  insertAccount: `INSERT INTO accounts (id,name,type,opening_balance_cents,display_order,is_archived,created_at,updated_at,deleted)
    SELECT ?,?,?,?, COALESCE(MAX(display_order),0)+1, 0, ?,?,0 FROM accounts WHERE deleted=0`,
  updateAccount: `UPDATE accounts SET name=?, type=?, opening_balance_cents=?, updated_at=? WHERE id=?`,
  // Onboarding paso 2, D9 (repo.js#deleteEmptyAccount): borrado DURO guardado. El WHERE hace la
  // comprobación de "sin movimientos activos, sin regla recurrente ni objetivo que la referencien"
  // en el MISMO statement — no hay ventana entre comprobar y borrar. Bind SIEMPRE
  // [id, id, id, id, id, id]. Filas deleted=1 no cuentan (se ignoran) en ninguna de las tres tablas.
  deleteEmptyAccount: `DELETE FROM accounts WHERE id=? AND NOT EXISTS (
    SELECT 1 FROM transactions WHERE deleted=0 AND (account_id=? OR counter_account_id=?)
  ) AND NOT EXISTS (
    SELECT 1 FROM recurring_rules WHERE deleted=0 AND (account_id=? OR counter_account_id=?)
  ) AND NOT EXISTS (
    SELECT 1 FROM goals WHERE deleted=0 AND account_id=?
  )`,
  getGoal: `SELECT * FROM goals WHERE id=? AND deleted=0`,
  insertGoal: `INSERT INTO goals (id,name,type,target_amount_cents,target_months,target_pct,target_date,account_id,category_id,is_active,created_at,updated_at,deleted)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`,
  updateGoal: `UPDATE goals SET name=?, type=?, target_amount_cents=?, target_months=?, target_pct=?,
    target_date=?, account_id=?, category_id=?, is_active=?, updated_at=? WHERE id=?`,
  softDeleteGoal: `UPDATE goals SET deleted=1, updated_at=? WHERE id=?`,

  // Import CSV (Task 15, generalizada en PR B): trae las transacciones NO borradas de la
  // cuenta de import (meta.import_account_id resuelta por repo.importAccountId) para que
  // n26.js las re-firme en memoria (bcDecideImportAction espera amountCents CON signo,
  // aquí siempre viene positivo por el CHECK de la tabla) sin una query por fila del CSV.
  // reconcileTx SOLO toca external_id/status/updated_at — nunca amount/date/category/merchant,
  // así una fila manual conciliada conserva su categoría y comercio tal cual los metió el usuario.
  n26Existing: `SELECT id, date, type, amount_cents, external_id, status FROM transactions
    WHERE account_id=? AND deleted=0`,
  reconcileTx: `UPDATE transactions SET external_id=?, status='reconciled', updated_at=? WHERE id=?`,
  upsertMeta: `INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  allMeta: `SELECT key, value FROM meta`,

  // ---- Categorías editables (PR D, Task 4) -----------------------------------

  // Pantalla de administración: TODAS (incl. archivadas — el admin necesita poder reactivarlas),
  // con el conteo de hijas ACTIVAS de cada una (lo usa el guard "máx 2 niveles" de updateCategory:
  // una categoría con children>0 no puede convertirse en hija de otra). Orden por
  // (flow, parent_id, display_order) — no solo display_order a secas (literal del brief): así
  // cada raíz queda agrupada con sus propias hijas (parent_id='' ordena antes que cualquier id
  // no vacío), con display_order decidiendo el orden dentro de cada grupo — el mismo grupo que
  // usa insertCategory para calcular el +1.
  listCategoriesAdmin: `SELECT c.*,
      (SELECT COUNT(*) FROM categories h WHERE h.parent_id=c.id AND h.deleted=0 AND h.is_archived=0) AS children
    FROM categories c WHERE c.deleted=0 ORDER BY c.flow, c.parent_id, c.display_order`,
  // No estaba en la lista de "SQL nuevos" del brief, pero updateCategory la necesita para el
  // merge-on-current (mismo patrón que getAccount/getRule/getGoal) y para leer el flow real de
  // la categoría que se edita (el guard de padre compara contra ESE flow, nunca el que mande el
  // caller: flow es inmutable).
  getCategory: `SELECT * FROM categories WHERE id=? AND deleted=0`,
  // display_order = MAX del grupo (flow, parent_id) + 1 en la MISMA sentencia — mismo patrón que
  // insertAccount: un agregado SIN GROUP BY sobre el subconjunto ya filtrado por WHERE colapsa
  // siempre a una fila (incluso con 0 filas, COALESCE cubre el NULL de MAX de una tabla vacía).
  insertCategory: `INSERT INTO categories (id,name,parent_id,flow,need_type,display_order,is_archived,created_at,updated_at,deleted)
    SELECT ?,?,?,?,?, COALESCE(MAX(display_order),0)+1, 0, ?,?,0
    FROM categories WHERE flow=? AND parent_id=? AND deleted=0`,
  // flow NO está en el SET a propósito: es inmutable tras crear la categoría. repo.updateCategory
  // ya rechaza la clave antes de llegar aquí, pero la propia SQL es la última línea de defensa —
  // aunque alguien se saltara el guard del repo, no hay forma de tocar flow con esta sentencia.
  updateCategory: `UPDATE categories SET name=?, need_type=?, parent_id=?, updated_at=? WHERE id=?`,
  setCategoryArchived: `UPDATE categories SET is_archived=?, updated_at=? WHERE id=?`,
  updateCategoryOrder: `UPDATE categories SET display_order=?, updated_at=? WHERE id=?`,
  // Hijas ACTIVAS de una categoría: archiveCategory las recorre para archivarlas en cascada (una
  // SQL.setCategoryArchived por cada una, en el MISMO execMany que la de la propia raíz).
  childrenOf: `SELECT id FROM categories WHERE parent_id=? AND deleted=0 AND is_archived=0`,
  // ¿Tiene `id` alguna hija ACTIVA? Ya NO la usa el guard de updateCategory (ver hasChildren) —
  // se conserva porque el label de cascada de archivar SÍ es active-only a propósito (archiveCategory
  // solo archiva en cascada las hijas activas, ver childrenOf) y porque tests/app/categorias.test.mjs
  // la ejerce directamente. Mismo patrón que hasActiveLinkedSettlement (SELECT 1 ... LIMIT 1, solo
  // interesa la existencia).
  hasActiveChildren: `SELECT 1 FROM categories WHERE parent_id=? AND deleted=0 AND is_archived=0 LIMIT 1`,
  // Item 3 (Important, review final): ¿tiene `id` alguna hija, ACTIVA o ARCHIVADA? Guard real de
  // "máx 2 niveles" de updateCategory: hasActiveChildren (arriba) dejaba demotar una raíz cuya
  // ÚNICA hija estaba archivada (activeChildren=0) — la hija archivada seguía apuntando, vía
  // parent_id, a una categoría que dejaba de ser raíz, dejando un árbol de 3 niveles (huérfana en
  // los hechos, aunque nunca se borra la fila). Sin filtro is_archived: cuenta cualquier hija.
  hasChildren: `SELECT 1 FROM categories WHERE parent_id=? AND deleted=0 LIMIT 1`,

  // i18n (PR i18n, Task 6; fix round 1 la hizo idempotente/basada en estado): retraduce el
  // nombre de UNA categoría semilla. `AND name = ?` es el guard — solo toca la fila si su nombre
  // actual es EXACTAMENTE ese. repo.retranslateSeedNames liga ese bind al nombre semilla del
  // OTRO idioma soportado (no al idioma "anterior"): así una fila ya en el idioma destino, o una
  // renombrada por el usuario ("Mi casa"), no matchean nada (0 filas, no-op). Bind:
  // [nombreNuevo, now, id, nombreSemillaDelOtroIdioma].
  retranslateCategory: `UPDATE categories SET name = ?, updated_at = ? WHERE id = ? AND name = ? AND deleted = 0`,

  // ---- Etiquetas de proyecto (N11, Task 4: CRUD) -----------------------------

  getTag: `SELECT * FROM tags WHERE id=? AND deleted=0`,
  insertTag: `INSERT INTO tags (id,name,budget_cents,is_archived,created_at,updated_at,deleted)
    VALUES (?,?,?,0,?,?,0)`,
  updateTag: `UPDATE tags SET name=?, budget_cents=?, updated_at=? WHERE id=?`,
  setTagArchived: `UPDATE tags SET is_archived=?, updated_at=? WHERE id=?`,
  // Selector de Registro y del detalle: solo activas, barata.
  listTags: `SELECT id, name, budget_cents FROM tags WHERE deleted=0 AND is_archived=0 ORDER BY created_at`,
  // Pantalla Etiquetas y tarjeta de Movimientos: TODAS las vivas (archivadas al final), con su
  // total de SIEMPRE — no el de un periodo (D7: una etiqueta cruza periodos).
  tagTotals: `SELECT tg.id, tg.name, tg.budget_cents, tg.is_archived,
      ${TAG_SPENT} AS spent_cents, COUNT(t.id) AS n
    FROM tags tg
    LEFT JOIN transactions t ON t.tag_id=tg.id AND t.deleted=0
    LEFT JOIN periods p ON p.id=t.period_id
    WHERE tg.deleted=0
    GROUP BY tg.id ORDER BY tg.is_archived, spent_cents DESC, tg.name`,
  // La segunda línea de la tarjeta de Movimientos y qué chips se pintan. NO filtra is_archived: un
  // movimiento del periodo puede llevar una etiqueta archivada y su chip tiene que seguir estando.
  tagTotalsOfPeriod: `SELECT tg.id, ${TAG_SPENT} AS spent_cents, COUNT(t.id) AS n
    FROM tags tg
    LEFT JOIN transactions t ON t.tag_id=tg.id AND t.deleted=0 AND t.period_id=?
    LEFT JOIN periods p ON p.id=t.period_id
    WHERE tg.deleted=0
    GROUP BY tg.id`,
};
export const TABLES = ["meta","accounts","categories","periods","transactions","recurring_rules","goals","budgets","tags"];
