# BaseCero — Diseño de la hoja de cálculo (contrato de datos)

- **Fecha**: 2026-08-24
- **Estado**: aprobado por secciones en sesión de brainstorming; pendiente de revisión final del spec
- **Alcance**: estructura del MVP en Google Sheets que actúa como contrato de datos de la futura app BaseCero (open source, offline)

## 1. Contexto y objetivo

BaseCero será una app móvil/web open source y totalmente offline de finanzas personales. El MVP es una hoja de cálculo en Google Sheets cuya estructura es el **contrato de datos** de la app: cada pestaña de datos equivale a una tabla (SQLite de referencia), y la app deberá importar y exportar la base completa en este formato sin pérdida de datos ni de relaciones. Las pestañas de entrada de datos (backend) están estrictamente separadas de las de visualización (dashboards).

Arquitectura elegida: **enfoque B, "contrato relacional completo"** — 8 tablas de datos + 3 dashboards.

## 2. Decisiones de descubrimiento (resumen)

| Tema | Decisión |
|---|---|
| Cuentas | N26 (principal), Revolut y Trade Republic (ahorro/huchas), préstamo del coche como pasivo. Solo EUR |
| Saldos | Sí: saldo calculado por cuenta, con transferencias internas y conciliación |
| Patrimonio neto | Desde el inicio: suma de saldos (préstamo resta) |
| Compartidos | Con Sara, modelo "uno paga y el otro devuelve su parte". Reparto porcentual variable por periodo (según lo que cobra cada uno), con override por transacción |
| Registro | Al momento desde el móvil; 1 línea = 1 categoría (sin split) |
| Periodos | Cierre y apertura MANUAL (nómina entre el 27 y el 31, sin día fijo) |
| Import bancario | CSV de N26 desde el MVP, con antiduplicados y conciliación |
| Filosofía | Observar 2-3 meses; esquema listo para presupuesto base cero y 50/30/20 sin migrar |
| Objetivos | Fondo de emergencia, metas de ahorro, techos de gasto, tasa de ahorro; alimentados por transferencias reales a huchas |
| Recurrentes | Tabla de reglas; provisiones (sinking funds) con dinero real vía huchas |
| Sync Excel↔app | Una sola fuente de verdad a la vez; el import reemplaza la base |
| Sin | Adjuntos, tags, multiusuario, multidivisa (en el MVP) |

## 3. Convenciones globales del contrato

1. **Una pestaña = una tabla.** Fila 1 = cabeceras exactas; datos desde la fila 2. Sin celdas combinadas; el formato visual nunca contiene información.
2. **Pestañas de datos** en gris con nombre técnico `snake_case` en inglés; **dashboards** en verde con nombre en español. El motor de import/export solo lee las de datos.
3. **PK**: columna `id` con ULID (texto, ordenable por creación). Lo genera Apps Script; el usuario no lo toca.
4. **Fechas** ISO `YYYY-MM-DD`; timestamps ISO 8601 con hora. La celda puede mostrar formato español; el valor exportado es ISO.
5. **Importes**: número positivo con 2 decimales; el signo lo da `type`. Única excepción: `adjustment` admite negativo. En SQLite se almacenan céntimos enteros (`INTEGER`).
6. **Booleanos** `TRUE`/`FALSE`. **Enums** en inglés minúscula, validados por desplegable contra las listas de la pestaña `meta`.
7. **Borrado lógico**: nunca se elimina una fila; se marca `deleted = TRUE`. Columnas de sistema `created_at`, `updated_at`, `deleted` al final de toda tabla, ocultas.
8. **Columnas calculadas**: las que empiezan por `_` son fórmulas de solo lectura; el motor de import las ignora y el de export las regenera.
9. **Relaciones**: siempre por `*_id` (ULID). Los desplegables de la hoja muestran nombres, pero la celda almacena el id (par columna visible/columna id o validación con rango de dos columnas).

## 4. Tablas

### 4.1 `meta` (clave-valor + enums)

| key | value |
|---|---|
| `schema_version` | `1` |
| `currency` | `EUR` |
| `created_with` | `basecero-sheets-mvp` |

Desde la columna D, listas de enums con cabecera: `transaction_types` (expense, income, transfer, refund, adjustment), `account_types` (checking, savings, liability), `flow_types` (expense, income), `need_types` (need, want, savings), `period_status` (open, closed), `frequencies` (weekly, monthly, quarterly, yearly), `goal_types` (emergency_fund, savings_target, spending_cap, savings_rate, provision), `tx_status` (pending, reconciled). En SQLite, `meta` es tabla clave-valor y los enums son constraints `CHECK`.

### 4.2 `accounts`

| columna | tipo | notas |
|---|---|---|
| `id` | ULID | PK |
| `name` | texto | "N26", "Revolut", "Trade Republic", "Préstamo coche" |
| `type` | enum | `checking` \| `savings` \| `liability` |
| `opening_balance` | número | saldo real al empezar; en `liability`, capital pendiente en negativo |
| `display_order` | número | orden en desplegables y dashboard |
| `is_archived` | bool | cerrar cuentas sin perder historial |

- El saldo actual **no se almacena**: saldo = `opening_balance` + movimientos.
- Préstamo del coche: cuenta `liability` con `opening_balance` negativo. La cuota mensual es un `expense` normal (Coche → Préstamo); el capital pendiente se corrige periódicamente con un `adjustment` sobre esta cuenta, consultando el cuadro de amortización.
- Cada hucha de Revolut (pockets) vinculada a un objetivo es su propia fila `savings`.

### 4.3 `categories`

| columna | tipo | notas |
|---|---|---|
| `id` | ULID | PK |
| `name` | texto | en español (visible en desplegables) |
| `parent_id` | ULID o vacío | vacío = raíz; con valor = subcategoría (2 niveles en el MVP; el modelo admite N) |
| `flow` | enum | `expense` \| `income` |
| `need_type` | enum | `need` \| `want` \| `savings` (latente para 50/30/20; se define a nivel de subcategoría) |
| `display_order` | número | |
| `is_archived` | bool | |

No existe categoría "Ahorro": mover dinero a huchas es `transfer`. Las devoluciones no tienen categoría propia: son `refund` sobre la categoría original.

### 4.4 `periods`

| columna | tipo | notas |
|---|---|---|
| `id` | ULID | PK |
| `name` | texto | etiqueta legible: "2026-09" |
| `start_date` | fecha | día en que se abre (llegada de la nómina) |
| `end_date` | fecha o vacío | se rellena al cerrar |
| `status` | enum | `open` \| `closed`; **invariante: máximo un periodo `open`** |
| `my_share_pct` | número 0-100 | % de los gastos compartidos que paga el usuario este periodo |
| `notes` | texto | opcional |

- Cada transacción almacena `period_id` explícito (el periodo abierto al registrarla); nunca se deduce de la fecha, porque los periodos son manuales.
- Cerrar el mes = `end_date` + `status=closed`; abrir el nuevo = fila nueva con su `my_share_pct`.

### 4.5 `transactions`

| columna | tipo | notas |
|---|---|---|
| `id` | ULID | PK |
| `date` | fecha | día del movimiento |
| `period_id` | ULID → periods | asignado automáticamente (periodo abierto) |
| `type` | enum | `expense` \| `income` \| `transfer` \| `refund` \| `adjustment` |
| `amount` | número > 0 | `adjustment` admite negativo |
| `account_id` | ULID → accounts | cuenta origen (expense/transfer) o destino (income/refund) |
| `counter_account_id` | ULID o vacío | solo `transfer`: cuenta destino. Una transferencia = una fila |
| `category_id` | ULID o vacío | obligatoria en expense/income/refund (salvo importadas pendientes de categorizar); vacía en transfer/adjustment |
| `merchant` | texto | comercio o beneficiario |
| `note` | texto | libre |
| `is_shared` | bool | gasto compartido con Sara |
| `share_pct_override` | número o vacío | vacío = hereda `my_share_pct` del periodo |
| `settled` | bool | compartidos: ¿devuelta ya su parte? |
| `ref_id` | ULID o vacío | en `refund`: transacción original |
| `rule_id` | ULID o vacío | vínculo a `recurring_rules` (precarga y previsión exacta) |
| `external_id` | texto o vacío | huella del movimiento del CSV de N26 (antiduplicados) |
| `status` | enum | `pending` (manual) \| `reconciled` (cruzado con banco) |
| `_my_amount` | calculada | gasto real del usuario: `amount × pct/100` si compartido; `amount` si no |
| `_sara_amount` | calculada | `amount − _my_amount` en compartidos |

Registro típico (4 celdas): fecha (por defecto hoy), importe, categoría, cuenta (por defecto N26). Apps Script rellena `id`, `period_id`, `status`, timestamps.

**Semántica por tipo**
- `expense`: sale de `account_id`; categoría obligatoria.
- `income`: entra en `account_id`; categoría de flow income.
- `transfer`: sale de `account_id`, entra en `counter_account_id`; sin categoría; no es gasto ni ingreso.
- `refund`: entra en `account_id`; misma categoría que el gasto original; `ref_id` opcional.
- `adjustment`: corrige el saldo de `account_id` (positivo o negativo); sin categoría; no computa como gasto ni ingreso.

**Reglas de cálculo de gasto (evitan doble conteo)**
1. El gasto por categoría/periodo se calcula siempre con `_my_amount`.
2. Un `refund` cuyo `ref_id` apunta a un gasto compartido es solo entrada de caja (afecta al saldo, no al gasto).
3. Un `refund` sin ese vínculo (devolución de tienda) resta gasto de su categoría.

### 4.6 `recurring_rules`

| columna | tipo | notas |
|---|---|---|
| `id` | ULID | PK |
| `name` | texto | "Alquiler", "Netflix", "Seguro coche" |
| `type` | enum | `expense` \| `income` \| `transfer` (el ahorro mensual a hucha es una regla transfer) |
| `amount` | número | importe esperado |
| `category_id` | ULID o vacío | expense/income |
| `account_id` | ULID | cuenta por defecto |
| `counter_account_id` | ULID o vacío | destino, solo transfer |
| `frequency` | enum | `weekly` \| `monthly` \| `quarterly` \| `yearly` |
| `due_day` | número 1-31 | día esperado |
| `due_month` | número 1-12 o vacío | solo anuales/trimestrales |
| `is_shared` | bool | la previsión muestra la parte del usuario |
| `is_active` | bool | |

### 4.7 `goals`

| columna | tipo | notas |
|---|---|---|
| `id` | ULID | PK |
| `name` | texto | |
| `type` | enum | `emergency_fund` \| `savings_target` \| `spending_cap` \| `savings_rate` \| `provision` |
| `target_amount` | número o vacío | € (savings_target; provision = importe anual; spending_cap = techo por periodo) |
| `target_months` | número o vacío | solo emergency_fund: meses de gasto medio |
| `target_pct` | número o vacío | solo savings_rate |
| `target_date` | fecha o vacío | límite opcional |
| `account_id` | ULID o vacío | hucha vinculada; su saldo ES el progreso (emergency_fund, savings_target, provision) |
| `category_id` | ULID o vacío | spending_cap y provision |
| `is_active` | bool | |

Regla: cada objetivo de ahorro apunta a su propia hucha (una fila de `accounts`); dos objetivos no comparten cuenta.

**Provisiones (sinking funds), con dinero real**: goal `provision` (p. ej. seguro 360 €/año) + regla `transfer` mensual (30 €) de N26 a su hucha. Al llegar el recibo: `expense` de 360 € (Coche → Seguro) + `transfer` de 360 € de la hucha a N26. El mes no se descuadra y todo cuadra con el banco.

### 4.8 `budgets` (dormida hasta activar presupuesto)

| columna | tipo | notas |
|---|---|---|
| `id` | ULID | PK |
| `period_id` | ULID → periods | presupuesto por periodo |
| `category_id` | ULID → categories | |
| `amount` | número | asignado a la categoría en el periodo |

Cubre base cero (suma de budgets del periodo = ingreso del periodo) y 50/30/20 (agrupar por `need_type`) sin migración. Al activarla, los `spending_cap` redundantes se retiran.

## 5. Flujo de gastos compartidos (Sara)

Regla de oro: **solo se registran movimientos de las cuentas del usuario**. Con `my_share_pct = 60`:

1. Usuario paga alquiler 900 € desde N26 → `expense` 900, `is_shared=TRUE` → `_my_amount=540`, `_sara_amount=360`, `settled=FALSE`.
2. Sara devuelve 360 € por Bizum → `refund` 360 en N26, categoría Casa→Alquiler, `ref_id` al alquiler; `settled=TRUE` en la fila original.
3. Cena al 50 %: `expense` 80, `is_shared=TRUE`, `share_pct_override=50`.
4. Si paga Sara y el usuario le pasa su parte: el Bizum saliente es un `expense` de su parte con la categoría real, sin marcar compartido. Los gastos de Sara no existen en esta base.

El "pendiente de cobro" del dashboard suma compartidos `settled=FALSE` de todos los periodos.

## 6. Import del CSV de N26

- N26 no incluye id único por movimiento → `external_id` = hash SHA-256 (hex, truncado a 16 caracteres) de la concatenación `fecha|importe|contraparte|referencia`.
- Mapeo: `date` ← Booking Date · `merchant` ← Partner Name · `note` ← Payment Reference · `amount` ← |Amount (EUR)| · `type` ← signo del importe.
- Algoritmo (Apps Script en el MVP; motor de la app después):
  1. Hash ya presente en `external_id` → saltar (re-importar es idempotente).
  2. Existe transacción `pending` en N26 con mismo importe y fecha ±3 días → conciliar: escribir `external_id`, `status=reconciled`.
  3. Sin match → crear fila nueva `reconciled` con `category_id` vacío → aparece en la bandeja "sin categorizar" del dashboard.

## 7. Dashboards (pestañas verdes, 100 % fórmulas, fuera del contrato)

### 7.1 Resumen del periodo
Selector de periodo (por defecto el abierto). Bloques: cabecera (ingresos, gasto real con `_my_amount`, ahorro €, tasa de ahorro %); gasto por categoría→subcategoría con columnas periodo actual / anterior / Δ % (+ "presupuestado" al activar budgets); cuentas con Sara (total compartido, mi parte, su parte, pendiente de cobro global); bandeja de sin categorizar.

### 7.2 Patrimonio y objetivos
Saldos por cuenta calculados (`opening_balance` + movimientos; nunca editados a mano — los descuadres se corrigen con `adjustment`); patrimonio neto (el préstamo resta) con serie por periodo cerrado; una fila por goal activo con barra de progreso según su tipo (emergency_fund: saldo hucha ÷ (meses × gasto medio); savings_target: saldo ÷ objetivo y fecha; provision: apartado vs anual; spending_cap: gastado vs techo, en rojo si se supera; savings_rate: tasa del periodo vs objetivo).

### 7.3 Previsión (periodo abierto)
Reglas del periodo pagadas/pendientes (por `rule_id`; fallback: categoría + importe); las compartidas muestran la parte del usuario. Comprometido restante (provisiones y ahorro recurrente incluidos). **Disponible real = saldo N26 − comprometido restante + pendiente de cobro de Sara.**

## 8. Datos semilla

**accounts**: N26 (checking), Revolut (savings), Trade Republic (savings), Préstamo coche (liability, opening_balance negativo). Más una hucha por objetivo/provisión al crearlos.

**categories** (subcategoría · need_type):
- Casa (expense): Alquiler/Hipoteca, Luz, Agua, Gas, Internet, Hogar · need
- Alimentación: Supermercado · need; Comida a domicilio · want
- Restauración: Restaurantes, Bares y cafés · want
- Transporte: Gasolina, Transporte público · need; Parking/peajes, Taxi/VTC · want
- Coche: Préstamo, Seguro, Mantenimiento/ITV · need
- Salud: Farmacia, Médico · need; Gimnasio · want
- Suscripciones: Streaming, Software, Otras · want
- Ocio: Planes y eventos, Viajes, Hobbies · want
- Ropa y cuidado personal · want
- Regalos y donaciones · want
- Impuestos y tasas · need
- Otros gastos · want
- Ingresos (income): Nómina, Ingresos puntuales, Intereses de ahorro

## 9. Automatización mínima en Sheets (Apps Script)

1. Trigger instalable `onEdit` sobre `transactions`: si la fila nueva no tiene `id`, generar ULID, `period_id` (periodo `open`), `status=pending`, `created_at`; actualizar `updated_at` en ediciones.
2. Mismo autocompletado (id + timestamps) para las demás tablas de datos.
3. Función de import CSV N26 (menú propio) con el algoritmo de la sección 6.
4. Los triggers instalables funcionan también con ediciones desde la app móvil de Google Sheets.

## 10. Contrato del motor import/export de la app

- Export: un `.xlsx` con una pestaña por tabla de datos (sin dashboards, sin columnas `_`), + alternativa ZIP de CSVs (uno por tabla, UTF-8, separador coma, decimales con punto, fechas ISO).
- Import: reemplaza la base completa (una sola fuente de verdad a la vez). Valida: `schema_version`, enums contra `meta`, integridad referencial de todos los `*_id`, invariante de un solo periodo `open`, positividad de importes (salvo adjustment).
- Los ULID hacen el import idempotente y a prueba de reordenaciones y borrados de filas.
- En SQLite: importes en céntimos (`INTEGER`), fechas `TEXT` ISO, booleanos `INTEGER` 0/1, enums con `CHECK`.

## 11. Fuera de alcance del MVP

Split multicategoría (el esquema lo admitiría añadiendo tabla `transaction_splits`), tags, adjuntos, multidivisa, multiusuario, desglose capital/interés del préstamo, patrimonio con activos de inversión, presupuesto activo (tabla lista, sin uso), sincronización con merge.
