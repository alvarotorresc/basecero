# Avisos de terceros

BaseCero se distribuye bajo la licencia MIT (ver [`LICENSE`](LICENSE)) e incluye, dentro del propio
repositorio, el software de terceros que se lista aquí. Cada componente conserva su licencia
original; este fichero recoge los avisos que esas licencias exigen conservar.

Todo lo demás bajo `app/app/vendor/` es código propio de BaseCero — en particular
`app/app/vendor/pure.js`, que vive ahí por motivos de carga y está cubierto por la licencia MIT del
proyecto.

---

## SheetJS (`xlsx.full.min.js`)

- **Componente:** SheetJS Community Edition (`xlsx`), versión **0.20.3**.
- **Ruta:** `app/app/vendor/xlsx/xlsx.full.min.js`
- **Licencia:** Apache License 2.0 — <https://www.apache.org/licenses/LICENSE-2.0>
- **Web del proyecto:** <https://sheetjs.com/>

Aviso de copyright, tal y como aparece en la primera línea del fichero distribuido:

```
/*! xlsx.js (C) 2013-present SheetJS -- http://sheetjs.com */
```

El bundle incluye además `js-codepage` (`cptable`) **1.15.0**, del mismo proyecto y bajo la misma
licencia.

El artefacto minificado no incorpora el texto de la licencia ni un fichero `NOTICE` propio; la
licencia procede de los metadatos del proyecto upstream. La Apache-2.0 no exige reproducir su texto
íntegro cuando no hay un `NOTICE` que propagar, solo conservar los avisos de copyright — que es lo
que hace este apartado.

## Schibsted Grotesk (fuente)

- **Componente:** Schibsted Grotesk, fuente variable (eje `wght`), subset latin.
- **Rutas:** `app/app/vendor/fonts/schibsted-grotesk-latin.woff2` y `app/app/vendor/fonts/fonts.css`
- **Licencia:** SIL Open Font License, versión 1.1 — texto completo más abajo, tal y como exige la
  propia licencia.

Aviso de copyright:

```
Copyright The Schibsted Grotesk Project Authors
```

## JetBrains Mono (fuente)

- **Componente:** JetBrains Mono, fuente variable (eje `wght`), subset latin.
- **Rutas:** `app/app/vendor/fonts/jetbrains-mono-latin.woff2` y `app/app/vendor/fonts/fonts.css`
- **Licencia:** SIL Open Font License, versión 1.1 — texto completo más abajo, tal y como exige la
  propia licencia.

Aviso de copyright:

```
Copyright 2020 The JetBrains Mono Project Authors
```

JetBrains Mono declara un *Reserved Font Name*: «JetBrains Mono». La cláusula 5 de la licencia
impide que un trabajo derivado y modificado siga usando ese nombre.

### Texto de la SIL Open Font License, Version 1.1

(Cubre tanto Schibsted Grotesk como JetBrains Mono: ambas se distribuyen bajo la misma versión de
la licencia.)

```
-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## SQLite WASM

- **Componente:** SQLite compilado a WebAssembly, versión **3.49.2** (source id `2025-05-07`),
  construido con el SDK de Emscripten 3.1.70.
- **Rutas:** `app/app/vendor/sqlite-wasm/jswasm/sqlite3.mjs`,
  `app/app/vendor/sqlite-wasm/jswasm/sqlite3.wasm` y
  `app/app/vendor/sqlite-wasm/jswasm/sqlite3-opfs-async-proxy.js`
- **Licencia:** el propio fichero `sqlite3.mjs` lleva su cabecera de licencia, que reproduce el
  estado de las dos partes que amalgama: el código de SQLite es de **dominio público** (sus autores
  renuncian al copyright) y el *glue code* de Emscripten está bajo **MIT** y **University of
  Illinois/NCSA Open Source License**.
- **Web del proyecto:** <https://sqlite.org/wasm>
