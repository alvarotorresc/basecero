# media/ — imágenes de producto de BaseCero

Capturas, portadas, promo y social preview para el README, la landing y la ficha de
alvarotc.com. Todo sale de la app real servida en local y de plantillas HTML propias, con
Playwright y un Chromium headless propio. Los scripts no tocan el código de la app.

## Regenerar

Desde la raíz del repo, en este orden:

```sh
node media/shots.mjs     # galería ES/EN, cover y cover-mobile  -> media/out/
node media/compose.mjs   # promo, og e icono                    -> media/out/
node media/web.mjs       # copias webp y og                     -> app/img/  (+ hoja de contacto)
```

- `shots.mjs --lang es` o `--only 03-movimientos` para repetir solo una parte.
- **Playwright:** se usa el paquete `playwright` si está instalado en el repo. Si no, se toma el de
  `PLAYWRIGHT_FROM`, que por defecto es `~/Documents/apps/BaseCero/node_modules`. El navegador es
  el de `npx playwright install chromium`.
- **Servidor:** `lib.mjs` levanta el suyo en `:8093`. Sirve `app/` en la raíz, como Vercel, y
  `media/` en `/media/`.
- **Revisión:** `media/.cache/hoja-contacto.jpg` junta todo en 1200 px de ancho. No va a git.

## Cómo se hacen las capturas

- **Datos:** los inventados de `tests/app/fixtures/demo-ficticio.mjs`, el mismo builder que genera
  `demo-ficticio.xlsx`. `demo.mjs` escribe un libro por idioma en `media/.cache/`, y `shots.mjs` lo
  importa en una base limpia desde la Bienvenida («Importar»). Hay dos retoques y ninguno cambia
  importes ni fechas:
  - **Límites.** Se añaden límites en todas las familias con gasto. El fixture solo trae 500 € y el
    alquiler ya los rebasa, así que Inicio diría «0,00 €, te has pasado».
  - **Inglés.** Se traducen los nombres que escribiría el usuario: cuentas, comercios, periodos,
    etiqueta, objetivo y suscripciones. El formato es en-GB. Después se cambia el idioma en
    Ajustes, y la propia app retraduce las categorías.
- **Reloj:** parado el viernes 18 de septiembre de 2026 a las 21:00, hora de Madrid. Es el día del
  último movimiento del fixture, así que no hay movimientos futuros. Es el día 18 del periodo de
  septiembre, con la semana y la línea del periodo llenas.
- **Móvil:** 390×845 CSS a DPR 1080/390, lo que da exactamente 1080×2340.
- **Escritorio (cover):** 1120×700 a DPR 1600/1120, que da 1600×1000. La app es de una columna y a
  ese ancho se lee bien dentro del marco estrecho de la web.
- **Temas:**
  - claro: 01, 02, 04, 06 y las portadas;
  - oscuro: 03 y 05.
- **Guardas de cada captura:**
  - dimensiones exactas;
  - sin esqueletos de carga;
  - tema pedido;
  - sin `undefined`, `NaN` ni `[object`;
  - sin palabras de la interfaz del otro idioma;
  - sin aviso de error;
  - dos capturas seguidas idénticas (hash).

  Además, animaciones congeladas, sin service worker y fuentes comprobadas con
  `document.fonts.check`.

## Ficheros

| Fuente (`media/out/`) | Tamaño | Copia web (`app/img/`) |
|---|---|---|
| `shots/{es,en}/01-inicio.png` … `06-informe.png` | 1080×2340 | `shots/{es,en}/NN-*.webp` (780 px) |
| `cover-{es,en}.png` | 1600×1000 | `cover-{es,en}.webp` |
| `cover-mobile-{es,en}.png` | 1080×2340 | `cover-mobile-{es,en}.webp` (780 px) |
| `promo-{es,en}.png` | 1920×1080 | `promo-{es,en}.webp` |
| `og-{es,en}.png` | 1200×630 | `og-{es,en}.png` |
| `icon-512.png` | 512×512 | — (icono de la ficha; sale de `brand/`) |

- **Textos:** `labels.json` tiene, por pieza e idioma, `name`, `alt` y `caption` para la galería, y
  los titulares (`headline`, `sub`) que pintan `templates/promo.html` y `templates/og.html`. Si
  cambia un titular, basta con volver a pasar `compose.mjs` y `web.mjs`.
- **Marca:** `brand/` es una copia de los ficheros de marca del vault (`design/marca/`). Las
  plantillas solo leen del repo.
