# BaseCero App — Fase 1: PWA local-first (diseño)

- **Fecha**: 2026-08-24 · **Estado**: pendiente de revisión de Álvaro
- **Referencia visual (APROBADA)**: canvas Claude Design, 6 artboards — https://claude.ai/code/artifact/ac537fec-e670-4cec-a6a9-b22dad7c5e70 · fuentes en `design/`
- **Contrato de datos**: `docs/specs/2026-08-24-basecero-hoja-calculo-design.md` (autoridad; el esquema SQLite sale de él sin cambios)

## 1. Objetivo de la fase 1

Una PWA instalable (móvil y PC) con datos 100 % locales donde Álvaro pueda: abrir su primer periodo, registrar un gasto en <10 segundos con la pantalla del diseño aprobado, y ver el Inicio básico (gastado del periodo, lista de movimientos). Nada más.

## 2. Decisiones de arquitectura

1. **Sin framework y sin build step**: HTML + CSS + ES modules vanilla. Motivos: cero dependencias que auditar, deploy = copiar archivos a GitHub Pages, y el diseño ya está resuelto (tokens CSS extraídos de `design/*.dc.html`).
2. **SQLite oficial WASM** (`@sqlite.org/sqlite-wasm`) **vendorizado** en `app/vendor/sqlite-wasm/` (sin npm en runtime). VFS **`opfs-sahpool`**: persistente y sin COOP/COEP → funciona en GitHub Pages. Fallback si OPFS no está disponible: base en memoria + aviso permanente "tus datos no se guardarán".
3. **Persistencia**: pedir `navigator.storage.persist()` al arrancar. El backup real del usuario será el export xlsx (fase 2); la fase 1 incluye un export JSON crudo de emergencia en Ajustes para no dejar los datos sin salida.
4. **Esquema**: 1:1 desde el contrato — mismas tablas, columnas y enums (CHECK). Importes en **céntimos INTEGER** (`amount_cents`); fechas TEXT ISO; booleanos INTEGER 0/1; `meta.schema_version = 1`. Las columnas `_*` calculadas de la hoja NO existen en SQLite (se calculan en queries).
5. **Reutilización**: `apps_script/pure.js` se importa tal cual (ULID, sanitización; parser N26 en fase 2). Semillas portadas de `seeds.py` (mismos ids-slug). Los colores por categoría del canvas viven en un mapa estático `js/category-colors.js` (clave = id de categoría) — NO se añaden a la tabla, para no bifurcar el contrato xlsx.
6. **Tests**: lógica SQL y de dominio con `node --test` + `node:sqlite` (Node 22, `--experimental-sqlite`): mismo `schema.sql` y mismas queries que la app (archivos compartidos).

## 3. Estructura de archivos

```
app/
├── index.html              # shell: tab bar (Inicio · Movimientos · Patrimonio · Ajustes) + botón registro
├── manifest.webmanifest    # standalone, theme #0b0c0e, iconos
├── sw.js                   # cache-first del shell para offline
├── css/tokens.css          # paleta/radios/tipografías EXACTOS del canvas
├── css/app.css
├── js/main.js              # router por pestañas + arranque
├── js/db.js                # init sqlite-wasm (opfs-sahpool), aplica schema.sql + seeds si BD vacía
├── js/schema.sql           # CREATE TABLEs desde el contrato
├── js/seeds.js             # cuentas + categorías (ids-slug de seeds.py)
├── js/category-colors.js   # mapa id categoría → color del canvas
├── js/repo.js              # insertTransaction, openPeriod, getOpenPeriod, listByDay, spentByCategory, accountBalance
├── js/screens/registro.js  # pantalla completa del diseño
├── js/screens/inicio.js    # fase 1: cabecera periodo + gastado + lista de movimientos (flujo/donut → fase 2)
├── js/screens/placeholder.js # Patrimonio y Ajustes: "próximamente" + export JSON en Ajustes
├── js/onboarding.js        # sin periodo open → diálogo "Abrir primer periodo" (fecha + % Sara; presupuestos → fase 2)
└── vendor/sqlite-wasm/
tests/app/                  # node --test (schema, repo, cuadre)
```

## 4. Reglas de dominio de la fase 1

- Registrar `expense`/`income` (transfer/refund/adjustment: fase 2): ULID, `period_id` del periodo `open`, `status='pending'`, `is_shared` con desglose según `my_share_pct` del periodo (override por transacción: columna existe, UI en fase 2).
- "Gastado del periodo" = suma de `my_amount` (céntimos × pct/100, redondeado) de expenses no borrados, menos refunds sin `ref_id` — la query nace con la regla completa del spec §4.5 aunque los refunds lleguen después.
- Un solo periodo `open` (índice parcial único).

## 5. Fuera de la fase 1 (fase 2+)

Import/export xlsx · import CSV N26 · presupuestos (asistente completo + pantalla Presupuesto) · Patrimonio y objetivos · gráficas (flujo, donut) · transfer/refund/adjustment en UI · cierre de periodo · despliegue en GitHub Pages con Action (crear el repo en GitHub requerirá confirmación de Álvaro) · sync entre dispositivos.

## 6. Criterio de éxito

En móvil (Chrome/Android) y PC: instalar la PWA, abrir primer periodo, registrar 3 gastos (uno compartido) en <10 s cada uno, cerrar el navegador, reabrir sin red y ver los datos intactos en Inicio.
