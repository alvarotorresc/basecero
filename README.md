# BaseCero

BaseCero es una app de finanzas personales, **open source y totalmente
offline**.

## La app (PWA)

**https://alvarotorresc.github.io/basecero/** — instalable desde el navegador
(en Android: Chrome → menú → «Añadir a pantalla de inicio»; en escritorio:
icono de instalación en la barra de direcciones).

- **Tus datos no salen del dispositivo.** Todo vive en una base SQLite local
  (OPFS); no hay servidor, ni cuentas, ni telemetría. Funciona sin conexión.
- **El dato canónico es una hoja de cálculo**: desde Ajustes puedes exportar
  un `.xlsx` (una pestaña por tabla), editarlo en Google Sheets o LibreOffice
  y volver a importarlo; el import valida el contrato completo y reemplaza la
  base (descargando antes una copia de seguridad). También puedes exportar una
  **copia cifrada** (`.bce`, AES-256-GCM con contraseña) desde el mismo sitio:
  se descifra solo desde BaseCero al importarla, y si olvidas la contraseña
  no hay forma de recuperarla — no se guarda en ningún sitio.
- Incluye: registro rápido de gastos/ingresos/transferencias/devoluciones/
  ajustes, gastos compartidos con liquidación, periodos manuales con
  presupuestos por categoría, recurrentes con previsión y «disponible real»,
  patrimonio con objetivos, gráficas, e import del CSV de N26 con
  deduplicación y conciliación.
- El código de la app está en [`app/`](app/) (vanilla JS, sin build step);
  se sirve tal cual desde GitHub Pages.

## El contrato de datos (hoja de cálculo)

Antes de la app, este repositorio construyó su **contrato de datos**: una
hoja de cálculo de Google Sheets cuya estructura (pestañas, columnas, tipos y
relaciones) es la que la app importa y exporta sin pérdida de datos ni de
relaciones. Antes de escribir la app, este
repositorio construye su **contrato de datos**: una hoja de cálculo de Google
Sheets cuya estructura (pestañas, columnas, tipos y relaciones) es la que la
futura app deberá importar y exportar sin pérdida de datos ni de relaciones.

El diseño completo del contrato —8 tablas de datos (`accounts`, `categories`,
`periods`, `transactions`, `recurring_rules`, `goals`, `budgets` y `meta`) más
3 dashboards de solo lectura— está documentado en
[`docs/specs/2026-08-24-basecero-hoja-calculo-design.md`](docs/specs/2026-08-24-basecero-hoja-calculo-design.md).
Ese documento es la referencia técnica; este README solo cubre cómo generar
el fichero y ponerlo en marcha.

La hoja de cálculo en sí **no se versiona** en el repositorio: se genera a
partir del código en `generator/` con un script Python, y ese `.xlsx`
generado es lo que se importa en Google Sheets.

## El generador histórico de la hoja (retirado)

La plantilla original de Google Sheets (pestañas de datos, validaciones y
dashboards con fórmulas) se construía con un generador en Python que vivía
en `generator/`. La app ya exporta y consume su propia hoja (Ajustes →
«Descargar hoja (.xlsx)»), así que el generador quedó sin mantenimiento y
fue retirado del repositorio; se recupera del historial con
`git show dae6b77^:generator/basecero_generator/cli.py` (y análogos), donde
`dae6b77` es el commit del borrado.

## Puesta en marcha en Google Sheets

1. Ir a [sheets.new](https://sheets.new), luego **Archivo > Importar > Subir**
   y seleccionar `dist/BaseCero.xlsx`, eligiendo la opción
   **"Reemplazar hoja de cálculo"**.
2. Abrir **Extensiones > Apps Script** y crear dos archivos de script:
   `pure.gs` y `main.gs`. En `pure.gs`, pegar el contenido de
   `app/vendor/pure.js`; en `main.gs`, el antiguo `apps_script/main.js`,
   retirado del repo en la PR de import genérico — se recupera del
   historial con `git show 76bfdfb^:apps_script/main.js`. Guardar el
   proyecto.
3. Configurar el activador (icono del reloj ⏰ del editor de Apps Script):
   **Añadir activador** → función `onEditInstalable`, evento "De hoja de
   cálculo / Al editar". Al ser un trigger instalable (no el `onEdit` simple),
   también funciona al editar desde la app móvil de Sheets.
4. Rellenar los datos reales de arranque: los `opening_balance` de cada
   cuenta en `accounts` (el préstamo del coche en negativo, como pasivo), y
   crear la primera fila en `periods` (`name`, `start_date` de hoy, `status`
   en `open`, y el `my_share_pct` del mes).
5. Opcional: convertir las columnas `is_shared` y `settled` de
   `transactions` en casillas de verificación
   (**Insertar > Casilla de verificación**) para que sean más cómodas de
   marcar desde el móvil.

Tras esto, el menú **BaseCero > Importar CSV de N26…** (creado por
`onOpen()`) y el autorrelleno de `id`, `period_id`, `status` y timestamps
(creado por `onEditInstalable`) ya deberían funcionar en cualquier fila
nueva. Las columnas `_account`/`_counter_account`/`_category`/`_rule` las
rellena el usuario eligiendo de un desplegable, y es el trigger quien
resuelve a partir de ellas los `*_id` ocultos correspondientes.

## Checklist de QA manual (marcar en el primer uso)

- [ ] Registrar un gasto (fecha + importe + `_category` + `_account`) → `id`,
      `period_id`, `status` y los timestamps se rellenan solos, y
      `category_id` se resuelve a partir del picker.
- [ ] Gasto compartido con `is_shared=TRUE` → `_my_amount`/`_sara_amount`
      correctos según el `my_share_pct` del periodo; con
      `share_pct_override=50` → a mitad.
- [ ] Un `transfer` de N26 a Revolut → los dos saldos se mueven en
      "Patrimonio y objetivos" y el patrimonio neto no cambia.
- [ ] Una regla mensual en `recurring_rules` → aparece "⏳ pendiente" en
      Previsión; tras registrarla eligiendo su `_rule` → pasa a
      "✅ pagado".
- [ ] Menú BaseCero > Importar CSV de N26… con un CSV de prueba → importa correctamente;
      al reimportar el mismo fichero → 0 nuevas, N saltadas (ver historial de git para fixture de ejemplo; retirado en la PR E).
- [ ] Un gasto manual de 45,20 € del 19-08 seguido del import del fixture →
      esa fila queda `reconciled` sin duplicarse.
- [ ] Reclasificar el Bizum de Sara importado: `type=refund`, `ref_id` del
      gasto original, `settled=TRUE` en aquella fila original → el
      "Pendiente de cobro" del dashboard baja.
- [ ] Cerrar el periodo (`end_date` + `status=closed`) y abrir el siguiente
      → aparece una nueva fila en la serie de patrimonio.

## Limitaciones documentadas del MVP

- Los dashboards leen como máximo **2000 filas** de `transactions`, y las
  plantillas prerrellenadas de las demás tablas tienen tope fijo: 12
  `periods`, 10 `goals`, 20 `recurring_rules`, 200 `categories`.
- El objetivo (`goal`) de tipo `savings_rate` muestra siempre una barra de
  progreso fija al 100 %; hay que comparar a ojo con la tasa de ahorro real
  del bloque "Resumen del periodo".
- La barra de un objetivo `spending_cap` muestra el % gastado sobre el
  límite, pero no se pone en rojo al superarlo (el "en rojo" del §7.2 de la
  spec no está implementado en la hoja del MVP).
- Solo los `refund` **sin** `ref_id` restan gasto de su categoría; los que sí
  tienen `ref_id` (devolución de un gasto compartido) solo son entrada de
  caja, para no contar el gasto dos veces.
- El importador de CSV de N26 clasifica todo movimiento como `expense` o
  `income` según el signo del importe: los `refund` (por ejemplo, el Bizum
  de Sara devolviendo su parte de un gasto compartido) hay que
  reclasificarlos a mano tras importar.
