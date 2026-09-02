# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versionado según [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

## [1.0.0] — 2026-09-02

La primera versión para compartir. BaseCero ya se instala desde el navegador de cualquiera y
funciona sin conexión, sin cuentas y sin nube.

### Añadido

- **Periodos de nómina a nómina.** Abres uno el día que cobras y lo cierras cuando llega el
  siguiente; al cerrarlo ves lo gastado, lo ahorrado y tu tasa de ahorro del tramo.
- **Registrar en una pantalla.** El importe se teclea con el teclado numérico del móvil, y hay
  cinco tipos de apunte: gasto, ingreso, transferencia entre cuentas, devolución —enlazada al
  gasto que reembolsa— y ajuste.
- **Presupuesto por categoría y periodo.** Pones límite solo donde te sirve, y el inicio te dice
  si vas por encima o por debajo del ritmo del plan.
- **41 categorías de serie, en dos niveles**, y todas tuyas: nombre, color de una paleta legible
  con daltonismo, icono y orden. Las que sobran se archivan sin tocar el historial.
- **Gastos compartidos en las dos direcciones.** Dices con quién compartes y el reparto por
  defecto del periodo, y en cada gasto ajustas tu parte de 5 en 5 y apuntas quién lo pagó. Si
  pagó la otra persona, el gasto cuenta como tuyo pero no toca tus cuentas hasta que liquidas.
  «Liquidar» enseña las dos deudas, el neto, y las cierra de golpe.
- **Recurrentes y previsión.** Reglas semanales, mensuales, trimestrales o anuales para el
  alquiler, las suscripciones o la nómina. Con ellas el inicio calcula lo que queda comprometido
  y tu disponible real.
- **Patrimonio.** El neto a día de hoy y su evolución, cuentas corrientes y de ahorro, pasivos
  con su cuota y las que quedan, y objetivos: fondo de emergencia, ahorro con objetivo,
  provisión, techo de gasto y tasa de ahorro.
- **Importar el extracto del banco.** Los CSV de N26 se reconocen solos; para cualquier otro, un
  asistente pregunta una vez qué es cada columna, detecta el formato de fecha y de decimales,
  enseña la vista previa y guarda el perfil en tu dispositivo. Al importar concilia lo que ya
  habías apuntado a mano y se salta los duplicados.
- **Copias de seguridad cifradas.** Una copia `.bce` protegida con tu contraseña, además de la
  hoja `.xlsx` con el contrato de datos completo —que se puede reimportar— y un volcado `.json`
  de emergencia.
- **El gesto de atrás hace lo que esperas.** En la app instalada, deslizar hacia atrás cierra la
  pantalla que tengas abierta en vez de cerrar la app.
- **En español y en inglés**, con la moneda y el formato de números y fechas que elijas.

### Notas

- Las instalaciones que ya existen migran su base de datos solas en el primer arranque: no hay
  nada que hacer, ni nada que se pierda.

[1.0.0]: https://github.com/alvarotorresc/basecero/releases/tag/v1.0.0
