# BaseCero

BaseCero es una app de finanzas personales, **open source y totalmente
offline**.

## La app

**https://basecero.alvarotc.com/app/**

Landing con capturas, instalación paso a paso y preguntas frecuentes:
**[basecero.alvarotc.com](https://basecero.alvarotc.com/)** (en inglés,
**[/en/](https://basecero.alvarotc.com/en/)**).

- Onboarding guiado en 4 pasos: bienvenida, cuentas, preferencias (idioma,
  moneda, reparto de gastos compartidos) y primer periodo; puedes importar
  una copia ya desde la primera pantalla.
- Import de CSV: perfil directo para N26 (con deduplicación y conciliación
  de movimientos ya registrados a mano) y un asistente genérico para
  mapear el CSV de cualquier otro banco.
- Categorías editables: color, icono y orden, con presupuesto por
  categoría y periodo.
- Gastos compartidos con liquidación entre dos personas.
- Movimientos recurrentes con previsión y «disponible real» del periodo.
- Patrimonio: evolución del patrimonio neto por periodo, saldo actual por
  cuenta y objetivos.
- Copias de seguridad: exporta un `.xlsx` (contrato de datos completo,
  round-trip sin pérdidas) o una copia cifrada `.bce`.
- Bilingüe, español e inglés.
- 100% offline: PWA instalable, sin servidor.
- El código de la app está en [`app/app/`](app/app/) (vanilla JS, sin build
  step); se sirve tal cual. `app/` es la raíz publicada del sitio: la landing
  (`/`, `/en/`), los legales y la app bajo `/app/`.

## Instalación (PWA)

- **Android / Chrome**: abre la URL, menú (⋮) → «Añadir a pantalla de
  inicio» (o el banner de instalación que ofrece el propio navegador).
- **iOS / Safari**: abre la URL, botón Compartir → «Añadir a pantalla de
  inicio». Solo funciona desde Safari; otros navegadores en iOS no
  exponen esta opción.
- **Escritorio / Chrome, Edge**: abre la URL, icono de instalación en la
  barra de direcciones (o menú → «Instalar BaseCero…»).

Una vez instalada funciona sin conexión: la app y sus datos ya viven en el
dispositivo.

## Privacidad

- Cero servidor, cero telemetría, cero cookies. BaseCero no envía nada a
  ningún sitio.
- Todos los datos viven en una base SQLite local (OPFS, Origin Private
  File System del navegador); no salen del dispositivo salvo que tú los
  exportes.
- Los backups cifrados (`.bce`, AES-256-GCM con contraseña) solo se
  descifran desde BaseCero al importarlos; si olvidas la contraseña no
  hay forma de recuperarla, no se guarda en ningún sitio.
- Exporta cuando quieras, en el formato que prefieras: `.xlsx` en claro
  (para editar en Google Sheets o LibreOffice) o `.bce` cifrado.

## Para desarrolladores

- Vanilla JS, sin build step ni dependencias de paquete: el código en
  [`app/app/`](app/app/) se sirve tal cual. Para levantarlo en local basta
  un servidor estático (necesario porque usa `<script type="module">` y
  Service Worker, que no funcionan sobre `file://`), por ejemplo:
  `python3 -m http.server 8000 -d app` y abrir `http://localhost:8000/`
  (la landing) o `http://localhost:8000/app/` (la app).
- Estructura publicada: `app/` es la raíz del sitio — `app/index.html` y
  `app/en/index.html` (landing ES/EN), los legales, `app/css/landing.css`,
  `app/img/`, `robots.txt` y `sitemap.xml`. La PWA entera vive en
  `app/app/`: `app/app/js/` (lógica y pantallas), `app/app/js/screens/`
  (una pantalla por fichero), `app/app/js/i18n/` (es/en), `app/app/css/`,
  `app/app/vendor/` (SheetJS, SQLite WASM, fuente Outfit).
- Tests con `node --test`, sin dependencias externas. El contrato de
  import/export `.xlsx` tiene su propio round-trip test
  ([`tests/app/contract.test.mjs`](tests/app/contract.test.mjs)): exporta,
  reimporta y compara que los datos y relaciones queden intactos.
- CI: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) corre la
  suite en cada push a `main` y en cada PR.

## Historia

BaseCero nació como una hoja de cálculo de Google Sheets: un generador en
Python (`generator/`) construía la plantilla y un script de Apps Script
(`apps_script/main.js`) le daba autorrelleno e import de CSV. La app
sustituyó a ambos y los dos quedaron retirados del repositorio; se
recuperan del historial de git con `git show dae6b77^:generator/…` y
`git show 76bfdfb^:apps_script/main.js` (requiere un clon con historia
completa, no `--depth 1`).

## Licencia

MIT — ver [`LICENSE`](LICENSE).

Incluye software de terceros en `app/app/vendor/`:

- [SheetJS](https://sheetjs.com/) (`xlsx.full.min.js`) — Apache-2.0.
- [SQLite WASM](https://sqlite.org/wasm) — SQLite es de dominio público;
  el «glue code» de Emscripten es MIT / University of Illinois-NCSA.
- [Outfit](https://fonts.google.com/specimen/Outfit) — SIL Open Font
  License 1.1.
