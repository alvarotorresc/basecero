# BaseCero App — Fase 2: PWA completa (diseño)

- **Fecha**: 2026-08-24 · **Estado**: pendiente de revisión de Álvaro
- **Referencia visual (APROBADA)**: canvas Claude Design, 6 artboards — fuentes en `design/`
- **Contrato de datos**: `docs/specs/2026-08-24-basecero-hoja-calculo-design.md` (autoridad)
- **Fase 1**: `docs/specs/2026-08-24-app-pwa-fase1-design.md` (arquitectura vigente: vanilla, sin build, sqlite-wasm opfs-sahpool, worker, `sql.js` compartido con tests)

## 1. Objetivo

Terminar la PWA: que Álvaro pueda vivir en la app (registrar los 5 tipos de movimiento, presupuestar por periodo, ver patrimonio/objetivos/previsión, importar el CSV de N26) y que **el dato canónico siga siendo la hoja de cálculo**: exportar un xlsx, editarlo donde quiera (Google Sheets, LibreOffice) y reimportarlo sin pérdidas. Al final, publicación en GitHub Pages (repo público) y una ronda de QA de Álvaro seguida de una ola de fixes.

## 2. Orden de construcción

Se construye todo y se publica al final (decisión de Álvaro: prioridad = tenerlo entero cuanto antes):

- **A. Motor xlsx** (export + import con validación) — el corazón del contrato.
- **B. Registro completo** (transfer/refund/adjustment) **+ pantalla Movimientos** (lista, detalle, editar/borrar, liquidar compartidos).
- **C. Periodos y presupuestos** (asistente Nuevo periodo, cierre, pantalla Presupuesto, onboarding unificado).
- **D. Recurrentes y previsión** (CRUD de reglas + bloque Previsión en Inicio).
- **E. Patrimonio, objetivos y gráficas** (pantalla Patrimonio + formularios + gráficas de Inicio).
- **F. Import CSV N26** en la app.
- **G. Publicación**: repo público en GitHub + Pages + icono maskable + QA E2E.

## 3. Sub-fase A — Motor xlsx

### Export
- Un `.xlsx` con **una pestaña por tabla de datos** (las 8: `meta`, `accounts`, `categories`, `periods`, `transactions`, `recurring_rules`, `goals`, `budgets`), cabecera en fila 1 con los nombres snake_case del contrato. Sin dashboards, sin columnas `_`.
- Tipos de celda: importes en **euros** (número, 2 decimales; conversión desde céntimos con redondeo), fechas **texto ISO** `YYYY-MM-DD`, booleanos como booleanos de celda (TRUE/FALSE).
- Botón "Exportar hoja (.xlsx)" en Ajustes, nombre `basecero-YYYY-MM-DD.xlsx`. El export JSON de emergencia de fase 1 se mantiene.
- **Librería: SheetJS CE vendorizada** en `app/vendor/xlsx/` (un archivo, Apache-2.0, sin build step — coherente con "cero npm en runtime"). Se añade al precache del SW.

### Import
- Acepta el xlsx exportado por la app **y** el descargado de Google Sheets (la hoja generada por el generador Python): localiza las pestañas **por nombre de tabla**, ignora las demás (dashboards) y las columnas desconocidas o que empiecen por `_`. Columnas resueltas **por nombre de cabecera**, no por posición. Fechas que lleguen como seriales de Excel se normalizan a ISO.
- **Validación previa** (contrato §10), todo o nada, con informe de errores legible (pestaña + fila + motivo):
  - `meta.schema_version = 1`; `meta.created_with` acepta **`basecero-sheets-mvp` o `basecero-pwa`** (deferred de fase 1 resuelto).
  - Enums contra los valores del contrato (`type`, `status`, `frequency`, `flow`, `need_type`, tipos de goal…).
  - Integridad referencial de todos los `*_id` (incluidos `ref_id`, `rule_id`, `parent_id`, `counter_account_id`).
  - Invariante: **máximo un periodo `open`**; importes > 0 salvo `adjustment`.
- Si valida: **reemplaza la base completa** en una transacción (`DELETE` de las 8 tablas + `INSERT` de todo). Antes de tocar nada: confirmación explícita del usuario + **descarga automática de un xlsx de seguridad** con el estado actual.
- Los ULID hacen el import idempotente (reordenar o borrar filas en la hoja no rompe nada).

### Garantía round-trip
Test de node: export → import → export produce datos equivalentes (mismas filas, mismos valores). Es el test más importante de la fase.

## 4. Sub-fase B — Registro completo y Movimientos

### Registro (5 tipos)
El segmented de Registro pasa a `Gasto · Ingreso · Transferencia · Devolución · Ajuste` (chips con scroll horizontal, mismo patrón que categorías). Campos por tipo (contrato §4.5):
- **transfer**: cuenta origen + cuenta destino (`counter_account_id`), sin categoría, sin compartido.
- **refund**: cuenta destino + categoría + **vínculo opcional al gasto original** (`ref_id`): selector con los compartidos sin liquidar y los gastos recientes. Si se vincula a un compartido → marca `settled=1` en el original.
- **adjustment**: cuenta + importe con signo (toggle +/−), sin categoría, sin compartido.
- `expense`/`income` quedan como en fase 1.

**Fix del deferred `MY_AMOUNT`**: `spentOfPeriod` aplica el prorrateo `MY_AMOUNT` también al brazo de `refund` (hoy resta el importe completo, `app/js/sql.js:11-16`), manteniendo las reglas anticonteo doble del contrato (§4.5): refund con `ref_id` a compartido = solo caja; refund sin vínculo = resta gasto de su categoría.

### Pantalla Movimientos (sin artboard; diseño derivado del patrón de Inicio)
- **Selector de periodo** arriba (por defecto el abierto), lista completa agrupada por día con las mismas filas que Inicio.
- **Bandeja "sin categorizar"**: si hay transacciones con `category_id` vacío (import N26), chip contador arriba que filtra la lista para clasificarlas rápido.
- Tocar una fila → **detalle** con todos los campos editables según su tipo + **borrar** (borrado lógico `deleted=1`). Editar actualiza `updated_at`.

### Liquidar compartidos (bloque "Con Sara" del artboard de Inicio)
El botón "Liquidar" abre la lista de compartidos `settled=0` (todos los periodos). Liquidar una fila = crear el `refund` vinculado (importe = parte de Sara, categoría la del gasto, cuenta por defecto N26) + `settled=1`. Una fila cada vez; si Sara paga varias en un Bizum, se liquidan una a una (los importes cuadran igual).

## 5. Sub-fase C — Periodos y presupuestos

### Asistente "Nuevo periodo" (artboard `design/Periodo.dc.html`, pantalla única)
1. **Cierre del anterior**: nombre, rango de fechas, nº de movimientos y métricas (gastado / ahorrado / tasa).
2. **Datos del nuevo**: fecha de inicio (por defecto hoy), nombre autogenerado ("Septiembre 2026"), `% Sara` heredado del periodo anterior (stepper editable).
3. **Presupuestos por categoría raíz** de gasto: referencia "Mes pasado: X €" (gastado real con `MY_AMOUNT` del periodo que se cierra, subárbol incluido), input en euros; vacío = sin límite. "Añadir límite a otra categoría" despliega las raíces restantes.
4. **Total**: presupuestado vs "ingresos previstos" (= ingresos del periodo que se cierra), barra y nota de lo sin asignar.
5. **"Abrir periodo"** ejecuta en **una transacción**: cerrar el viejo (`end_date` = día anterior al inicio nuevo, `status=closed`) + crear el nuevo + insertar las filas de `budgets`.

Entradas: desde la cabecera del periodo en Inicio y desde Ajustes.

### Onboarding unificado (deferred "chrome oculto" resuelto)
El onboarding del primer periodo **reutiliza el asistente** (sin bloque de cierre ni referencias "mes pasado"). Mientras está activo, tab bar y FAB quedan ocultos/deshabilitados (hoy un tap en una pestaña aborta el onboarding y cuelga el arranque, `app/js/main.js:16-31`).

### Pantalla Presupuesto (artboard `design/Presupuesto.dc.html`)
Accesible desde "Ver presupuesto →" en Inicio. Tarjeta total (gastado de lo presupuestado, %, restante) + una tarjeta por categoría con límite (gastado con `MY_AMOUNT` sobre el subárbol, %, barra y línea de estado) + fila "Sin límite este periodo" con el total gastado fuera de presupuesto. Umbrales de estado: **verde < 85 %, ámbar ≥ 85 %, rojo > 100 %** (el rojo añade borde y píldora "Superado por X €", como el artboard).

## 6. Sub-fase D — Recurrentes y previsión (sin artboard; añadido por Álvaro a la fase 2)

- **Pantalla "Recurrentes"** (CRUD de `recurring_rules`), accesible desde Ajustes y desde el bloque Previsión: nombre, tipo (`expense`/`income`/`transfer`), importe, categoría, cuenta (+ destino en transfer), frecuencia, `due_day`/`due_month`, compartida, activa. Mismo estilo de formulario que el asistente.
- **Bloque "Previsión" en Inicio** (solo con periodo abierto), según contrato §7.3:
  - Reglas esperadas en el periodo con estado **pagada/pendiente**. Pagada = existe transacción del periodo con su `rule_id`; fallback: misma categoría + mismo importe. Las compartidas muestran la parte del usuario.
  - **Comprometido restante** = suma de pendientes (provisiones y ahorro recurrente incluidos).
  - **Disponible real = saldo N26 − comprometido restante + pendiente de cobro de Sara.**
  - Qué reglas caen en el periodo abierto: `monthly` siempre; `quarterly`/`yearly` si su `due_month` cae dentro del rango del periodo; `weekly` una por semana del periodo. (Mismas reglas que el dashboard Previsión de la hoja; el plan fijará el detalle mirando el generador.)
- **Precarga**: tocar una regla pendiente abre Registro precargado (tipo, importe, categoría, cuenta, comercio = nombre de la regla, `rule_id`).

## 7. Sub-fase E — Patrimonio, objetivos y gráficas

### Pantalla Patrimonio (artboard `design/Patrimonio.dc.html`)
- **Patrimonio neto** (suma de saldos de cuentas activas; el pasivo resta) + variación absoluta vs el periodo cerrado anterior + **sparkline SVG** con la serie por periodo cerrado (patrimonio a `end_date`; con menos de 2 periodos cerrados se oculta la gráfica).
- **Cuentas**: saldo calculado por cuenta = `opening_balance` + movimientos (expense −, income +, transfer ±, refund +, adjustment con signo). Nunca editados a mano: los descuadres se corrigen con `adjustment`.
- **Objetivos**: una fila por goal activo con barra y fórmula por tipo (contrato §7.2): `emergency_fund` saldo hucha ÷ (meses × gasto medio); `savings_target` saldo ÷ objetivo (+fecha); `provision` apartado vs anual; `spending_cap` gastado vs techo (rojo si se supera); `savings_rate` tasa del periodo vs objetivo.

### Formularios (sin artboard; mismo estilo del asistente)
- **Nueva cuenta / editar cuenta**: nombre, tipo (`checking`/`savings`/`liability`), `opening_balance` (el préstamo en negativo). Editar `opening_balance` es la vía para poner los saldos reales iniciales. **La cuenta "N26" no se puede renombrar** (rompería el dedupe del import CSV).
- **Nuevo objetivo / editar**: tipo + campos según tipo (`target_amount`/`target_months`/`target_pct`/`target_date`/`category_id`). Los tipos con hucha (`emergency_fund`, `savings_target`, `provision`) **crean su hucha automáticamente** (regla del contrato: una hucha por objetivo, sin compartir). Activar/desactivar.

### Gráficas de Inicio (SVG a mano, réplica del artboard `design/Resumen.dc.html`)
- **Flujo de gasto**: 7 barras verticales (últimos 7 días, `MY_AMOUNT`), día actual destacado en acento con etiqueta de importe, iniciales L-D debajo.
- **Donut "Gasto por categoría"**: SVG con arcos `stroke-dasharray` por categoría raíz (colores de `category-colors.js`), total en el centro, subtítulo "Solo tu parte de lo compartido", enlace "Ver presupuesto →", y lista de categorías con "X € de Y €" + barra de límite (verde/ámbar/rojo) para las presupuestadas y "sin límite" para el resto.
- Sin librería de charts: son dos gráficas con diseño cerrado; una librería sería peso muerto.

## 8. Sub-fase F — Import CSV N26 en la app

- Botón "Importar CSV de N26" en Ajustes. Mismo algoritmo que el Apps Script (`apps_script/main.js:106-164`), reutilizando `pure.js` **tal cual**: `bcParseN26Csv`, `bcBuildExternalId`, `bcDecideImportAction` (skip por `external_id` / reconcile con pendiente de igual importe, sentido y ≤3 días / create).
- Los existentes a comparar: solo transacciones de la cuenta N26, con importe re-signado como en GAS. Las creadas entran `status='reconciled'`, sin categoría → **bandeja "sin categorizar"** de Movimientos.
- SHA-256 con `crypto.subtle` (async) adaptado a la firma síncrona de `bcBuildExternalId` — el plan fija el adaptador; `pure.js` no se modifica.
- Resumen final: "Nuevas: N · Conciliadas: N · Duplicadas (saltadas): N" + aviso de reclasificar los Bizum de Sara a refund.

## 9. Sub-fase G — Publicación

1. **Repo público en GitHub** (nombre propuesto: `basecero`; **se pedirá confirmación explícita a Álvaro del nombre y visibilidad antes de crearlo**), push de `main`.
2. **GitHub Pages vía Action** oficial (`upload-pages-artifact` con `path: app` + `deploy-pages`). Las rutas de la app ya son 100 % relativas (verificado: `index.html`, `manifest`, `sw.js`, `new URL(..., import.meta.url)`), así que sirve bajo `/basecero/` sin cambios.
3. **Icono maskable split** (deferred): dos entradas en el manifest — `icons/icon.svg` con `purpose:"any"` y un `icons/icon-maskable.svg` nuevo con el arte dentro de la zona segura (~80 % central).
4. SW: bump de `CACHE` y `SHELL` actualizado con todos los archivos nuevos de la fase (incluido el vendor de SheetJS).
5. README del repo público (español) con qué es, capturas y cómo se sirve.

Tras publicar: QA de Álvaro en el móvil (checklist en el plan) → **ola de fixes** como cierre de la fase.

## 10. Tests

- `node --test` (mismo patrón de fase 1, `sql.js` compartido): round-trip xlsx (el crítico), validador de import (enum malo, FK rota, dos periodos open, importe negativo, `created_with` dual), cierre/apertura de periodo con budgets (transaccional), `spentOfPeriod` con refunds compartidos, saldos y patrimonio por tipo de movimiento, previsión (pagada/pendiente, disponible real), liquidar compartidos, import N26 con fixtures CSV (skip/reconcile/create).
- `pytest` del generador queda intacto.
- QA E2E con Playwright (como en fase 1) antes de publicar.

## 11. Fuera de la fase 2

Export ZIP de CSVs (el xlsx cubre el round-trip) · edición de la taxonomía de categorías en la app (se hace vía export → editar hoja → import) · sync entre dispositivos · split multicategoría · tags · adjuntos · multidivisa · desglose capital/interés del préstamo.

## 12. Criterio de éxito

En el móvil, con la app publicada en GitHub Pages: registrar los 5 tipos de movimiento; cerrar el periodo y abrir el siguiente con presupuestos; ver Presupuesto, Patrimonio (saldos reales tras editar `opening_balance`), objetivos y previsión con disponible real; exportar el xlsx, editarlo en Google Sheets (añadir una transacción y una regla recurrente), reimportarlo y ver los cambios reflejados; importar un CSV de N26 y categorizar la bandeja; todo offline salvo la descarga inicial.
