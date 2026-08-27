# Backups cifrados (P1) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export/import opcional del backup `.xlsx` cifrado con passphrase (AES-256-GCM + PBKDF2 vía Web Crypto), sin servidor y sin guardar nada.

**Architecture:** Un módulo puro `app/js/backup-crypto.js` define un contenedor binario propio (magic `BCE1` + cabecera de 37 bytes + ciphertext AES-GCM) y las funciones `encryptBackup`/`decryptBackup`/`isEncryptedBackup` sobre bytes. La pantalla de Ajustes añade un export cifrado opcional (passphrase pedida en el momento, nunca persistida) y detecta al importar, por magic bytes y antes de llamar a SheetJS, si el fichero está cifrado para pedir la passphrase. El diseño replica el de los backups de Bito adaptado a Web Crypto (no hay Argon2 nativo en navegador → PBKDF2-SHA256 con iteraciones en cabecera).

**Tech Stack:** Vanilla JS (ES modules, sin build), Web Crypto API (`crypto.subtle`), SheetJS ya vendorizado, tests con `node --test` (Node 22, `crypto.subtle` global disponible).

**Spec:** No hay spec formal; la autoridad es `BACKLOG.md` §P1 más el estudio del diseño de Bito en `.superpowers/sdd/BACKLOG/bito-backups-research.md` (local). Decisiones ya tomadas ahí: PBKDF2-HMAC-SHA256 600k iteraciones (viajan en cabecera), AES-256-GCM (IV 12 bytes, tag 128 bits), salt 16 bytes, extensión propia `.bce` (nunca `.xlsx`), sin persistir passphrase ni clave derivada, error de tag GCM indistinguible entre «contraseña incorrecta» y «fichero corrupto».

## Global Constraints

- El backup en claro actual (`.xlsx` + copia pre-import) sigue existiendo tal cual: el cifrado es capa OPCIONAL añadida, no sustituye nada.
- Repo público: ningún dato personal nuevo en código, tests o fixtures.
- Todo cambio con tests verdes: `node --test tests/app/` (suite completa, el round-trip xlsx es sagrado).
- Commits atómicos, Conventional Commits en inglés, SIN ninguna referencia a IA (ni en el mensaje ni trailers tipo Co-Authored-By).
- Textos de UI en español, tono cercano de la app actual («contraseña», no «passphrase», en la UI).
- Estilo del código: vanilla JS como el existente (comentarios en español solo donde aportan, doble comilla, sin dependencias nuevas).
- Formato del contenedor (fijo, no negociable): `magic "BCE1"(4) · versión uint8=1(1) · salt(16) · iteraciones uint32 big-endian(4) · IV(12) · ciphertext+tag GCM(resto)`; cabecera total 37 bytes, tag 16 bytes.
- Contraseña mínima: 10 caracteres (PBKDF2 no es memory-hard; se compensa con mínimo más alto que los 8 de Bito).

---

### Task 1: Módulo `backup-crypto.js` (contenedor + cifrado)

**Files:**
- Create: `app/js/backup-crypto.js`
- Test: `tests/app/backup-crypto.test.mjs`

**Interfaces:**
- Consumes: nada del resto de la app (módulo puro sobre bytes; `crypto` global).
- Produces (Task 2 y 3 dependen de estas firmas exactas):
  - `PBKDF2_ITERATIONS: number` (600000)
  - `MIN_PASSPHRASE = 10`
  - `isEncryptedBackup(data: ArrayBuffer|Uint8Array): boolean`
  - `encryptBackup(plainData: ArrayBuffer|Uint8Array, passphrase: string, opts?: {iterations?: number}): Promise<Uint8Array>`
  - `decryptBackup(fileData: ArrayBuffer|Uint8Array, passphrase: string): Promise<Uint8Array>`
  - `class BackupFormatError extends Error` (fallos estructurales: magic/versión/truncado/cabecera inválida)
  - `class WrongPassphraseError extends Error` (fallo de tag GCM: contraseña incorrecta o datos dañados, indistinguibles)

- [ ] **Step 1: Write the failing tests**

`tests/app/backup-crypto.test.mjs` (usa `iterations: 1000` en los tests para que la suite siga siendo rápida; el default de producción solo se comprueba como constante):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PBKDF2_ITERATIONS, MIN_PASSPHRASE, isEncryptedBackup,
  encryptBackup, decryptBackup, BackupFormatError, WrongPassphraseError,
} from "../../app/js/backup-crypto.js";
import { X } from "./helpers.mjs";

const FAST = { iterations: 1000 };
const sample = () => crypto.getRandomValues(new Uint8Array(256));

test("constantes de producción", () => {
  assert.equal(PBKDF2_ITERATIONS, 600000);
  assert.equal(MIN_PASSPHRASE, 10);
});

test("round-trip: encrypt → decrypt devuelve el plaintext exacto", async () => {
  const plain = sample();
  const enc = await encryptBackup(plain, "contraseña larga", FAST);
  assert.equal(isEncryptedBackup(enc), true);
  const dec = await decryptBackup(enc, "contraseña larga");
  assert.deepEqual(dec, plain);
});

test("acepta ArrayBuffer además de Uint8Array", async () => {
  const plain = sample();
  const enc = await encryptBackup(plain.buffer, "contraseña larga", FAST);
  const dec = await decryptBackup(enc.buffer, "contraseña larga");
  assert.deepEqual(dec, plain);
});

test("cabecera: offsets y valores del contenedor v1", async () => {
  const enc = await encryptBackup(sample(), "contraseña larga", FAST);
  assert.equal(new TextDecoder().decode(enc.slice(0, 4)), "BCE1");
  assert.equal(enc[4], 1); // versión de contenedor
  assert.equal(new DataView(enc.buffer, enc.byteOffset).getUint32(21), 1000); // iteraciones BE
  assert.equal(enc.length, 37 + 256 + 16); // cabecera + plaintext + tag GCM
});

test("cada export usa salt e IV nuevos", async () => {
  const plain = sample();
  const a = await encryptBackup(plain, "contraseña larga", FAST);
  const b = await encryptBackup(plain, "contraseña larga", FAST);
  assert.notDeepEqual(a.slice(5, 21), b.slice(5, 21));   // salt
  assert.notDeepEqual(a.slice(25, 37), b.slice(25, 37)); // IV
});

test("contraseña incorrecta → WrongPassphraseError", async () => {
  const enc = await encryptBackup(sample(), "contraseña larga", FAST);
  await assert.rejects(() => decryptBackup(enc, "otra distinta x"), WrongPassphraseError);
});

test("ciphertext manipulado → WrongPassphraseError (mismo error que contraseña mala)", async () => {
  const enc = await encryptBackup(sample(), "contraseña larga", FAST);
  enc[40] ^= 0xff;
  await assert.rejects(() => decryptBackup(enc, "contraseña larga"), WrongPassphraseError);
});

test("fichero truncado → BackupFormatError", async () => {
  const enc = await encryptBackup(sample(), "contraseña larga", FAST);
  await assert.rejects(() => decryptBackup(enc.slice(0, 30), "contraseña larga"), BackupFormatError);
  await assert.rejects(() => decryptBackup(enc.slice(0, 40), "contraseña larga"), BackupFormatError);
});

test("versión de contenedor desconocida → BackupFormatError", async () => {
  const enc = await encryptBackup(sample(), "contraseña larga", FAST);
  enc[4] = 9;
  await assert.rejects(() => decryptBackup(enc, "contraseña larga"), BackupFormatError);
});

test("iteraciones fuera de rango en cabecera hostil → BackupFormatError", async () => {
  const enc = await encryptBackup(sample(), "contraseña larga", FAST);
  new DataView(enc.buffer, enc.byteOffset).setUint32(21, 0);
  await assert.rejects(() => decryptBackup(enc, "contraseña larga"), BackupFormatError);
  new DataView(enc.buffer, enc.byteOffset).setUint32(21, 100000000);
  await assert.rejects(() => decryptBackup(enc, "contraseña larga"), BackupFormatError);
});

test("un fichero no cifrado no se confunde con uno cifrado", async () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]); // magic de .xlsx (ZIP)
  assert.equal(isEncryptedBackup(zip), false);
  assert.equal(isEncryptedBackup(new Uint8Array(0)), false);
  assert.equal(isEncryptedBackup(new Uint8Array([0x42, 0x43])), false); // más corto que el magic
  await assert.rejects(() => decryptBackup(zip, "contraseña larga"), BackupFormatError);
});

test("round-trip con un .xlsx real de SheetJS", async () => {
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["k", "v"], ["a", 1]]), "Hoja");
  const xlsxBytes = new Uint8Array(X.write(wb, { type: "array", bookType: "xlsx" }));
  const enc = await encryptBackup(xlsxBytes, "contraseña larga", FAST);
  assert.equal(isEncryptedBackup(xlsxBytes), false);
  assert.equal(isEncryptedBackup(enc), true);
  const dec = await decryptBackup(enc, "contraseña larga");
  const wb2 = X.read(dec, { type: "array" });
  assert.deepEqual(X.utils.sheet_to_json(wb2.Sheets.Hoja), [{ k: "a", v: 1 }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/app/backup-crypto.test.mjs`
Expected: FAIL (module not found `app/js/backup-crypto.js`).

- [ ] **Step 3: Write the implementation**

`app/js/backup-crypto.js`:

```js
/** Contenedor de backup cifrado de BaseCero (v1).
 *  Layout binario (offsets en bytes): magic "BCE1"(0,4) · versión(4,1) · salt(5,16) ·
 *  iteraciones PBKDF2 uint32 BE(21,4) · IV GCM(25,12) · ciphertext+tag(37,resto).
 *  Las iteraciones viajan en la cabecera para poder subir el coste en el futuro sin
 *  romper la lectura de copias antiguas. La passphrase no se persiste jamás. */

const MAGIC = new Uint8Array([0x42, 0x43, 0x45, 0x31]); // "BCE1"
const VERSION = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = 4 + 1 + SALT_LEN + 4 + IV_LEN; // 37
// Cota superior al leer cabeceras no confiables: evita que un fichero hostil dispare
// una derivación absurdamente cara (paralelo a la validación defensiva de Bito).
const MAX_ITERATIONS = 10_000_000;

export const PBKDF2_ITERATIONS = 600000; // OWASP 2023 para PBKDF2-HMAC-SHA256
export const MIN_PASSPHRASE = 10;

export class BackupFormatError extends Error {
  constructor(message) { super(message); this.name = "BackupFormatError"; }
}
export class WrongPassphraseError extends Error {
  constructor(message) { super(message); this.name = "WrongPassphraseError"; }
}

const toBytes = (data) => (data instanceof Uint8Array ? data : new Uint8Array(data));

export function isEncryptedBackup(data) {
  const b = toBytes(data);
  return b.length >= MAGIC.length && MAGIC.every((v, i) => b[i] === v);
}

async function deriveKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false, // no extraíble: la clave nunca se materializa como bytes
    ["encrypt", "decrypt"]);
}

export async function encryptBackup(plainData, passphrase, { iterations = PBKDF2_ITERATIONS } = {}) {
  const plain = toBytes(plainData);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(passphrase, salt, iterations);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const out = new Uint8Array(HEADER_LEN + cipher.length);
  out.set(MAGIC, 0);
  out[4] = VERSION;
  out.set(salt, 5);
  new DataView(out.buffer).setUint32(21, iterations); // big-endian
  out.set(iv, 25);
  out.set(cipher, HEADER_LEN);
  return out;
}

export async function decryptBackup(fileData, passphrase) {
  const bytes = toBytes(fileData);
  if (!isEncryptedBackup(bytes)) throw new BackupFormatError("No es una copia cifrada de BaseCero");
  if (bytes.length < HEADER_LEN + TAG_LEN) throw new BackupFormatError("El archivo está truncado o dañado");
  if (bytes[4] !== VERSION)
    throw new BackupFormatError(`Copia de una versión más nueva (formato ${bytes[4]}). Actualiza BaseCero.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const iterations = view.getUint32(21);
  if (iterations < 1 || iterations > MAX_ITERATIONS)
    throw new BackupFormatError("Cabecera inválida (iteraciones fuera de rango)");
  const salt = bytes.slice(5, 21);
  const iv = bytes.slice(25, 37);
  const key = await deriveKey(passphrase, salt, iterations);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, bytes.subarray(HEADER_LEN)));
  } catch {
    // El tag GCM no distingue contraseña mala de datos dañados: un solo error, a propósito.
    throw new WrongPassphraseError("Contraseña incorrecta o archivo dañado");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/app/backup-crypto.test.mjs`
Expected: PASS (todos). Después: `node --test tests/app/` — la suite completa sigue verde.

- [ ] **Step 5: Commit**

```bash
git add app/js/backup-crypto.js tests/app/backup-crypto.test.mjs
git commit -m "feat(app): add encrypted backup container (PBKDF2 + AES-256-GCM)"
```

---

### Task 2: Export cifrado en Ajustes + service worker

**Files:**
- Modify: `app/js/screens/ajustes.js` (card «Tu hoja de cálculo»: nuevo botón + formulario inline)
- Modify: `app/sw.js` (añadir `js/backup-crypto.js` al SHELL y bump de versión de caché)

**Interfaces:**
- Consumes (de Task 1): `encryptBackup(bytes, passphrase)` (default 600k iteraciones), `MIN_PASSPHRASE`.
- Produces: fichero descargado `basecero-cifrado-${hoyISO()}.bce` (contenedor BCE1 sobre los bytes del `.xlsx`). Task 3 debe poder reimportarlo.

Notas para el implementador:
- `ajustes.js` re-renderiza TODO el HTML en cada cambio de `state` (patrón `render()`+`wire()`): los valores de los `<input>` se pierden en cada `render()`. Por eso la validación de contraseña se hace SIN re-render, manipulando un `<div>` de error directamente (patrón de abajo).
- Si `css/app.css` define una clase estándar para inputs, úsala en vez del estilo inline `INPUT_STYLE` de abajo (compruébalo con grep antes; los screens actuales usan estilos inline con tokens `var(--…)`).

- [ ] **Step 1: Añadir imports y estado**

En `app/js/screens/ajustes.js`:

```js
import { encryptBackup, MIN_PASSPHRASE } from "../backup-crypto.js";
```

En `renderAjustes`, ampliar el estado inicial:

```js
const state = { errors: null, pending: null, busy: false, n26Result: null, n26Error: null, encExport: false };
```

Junto a `BTN_SECONDARY`, añadir:

```js
const INPUT_STYLE = "background:transparent;color:var(--text);border:1px solid var(--border);"
  + "border-radius:var(--radius-sm);padding:12px;width:100%;font:400 15px var(--font-ui);";
```

- [ ] **Step 2: HTML del formulario en la card «Tu hoja de cálculo»**

Justo después del `<input type="file" id="xlsx-file-input" …>` (línea ~75), insertar:

```js
        ${state.encExport ? `
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:10px">
          <p style="color:var(--text-2);font-size:13px">
            La copia cifrada (.bce) solo se abre desde BaseCero con esta contraseña.
            <strong>Si la olvidas, la copia es irrecuperable</strong> — no se guarda en ningún sitio.</p>
          <input type="password" id="enc-pass-1" style="${INPUT_STYLE}" placeholder="Contraseña (mín. ${MIN_PASSPHRASE} caracteres)">
          <input type="password" id="enc-pass-2" style="${INPUT_STYLE}" placeholder="Repite la contraseña">
          <div id="enc-error" class="banner-aviso red" style="display:none"></div>
          <div style="display:flex;gap:8px">
            <button type="button" id="btn-enc-cancel" style="${BTN_SECONDARY}flex:1" ${state.busy ? "disabled" : ""}>Cancelar</button>
            <button type="button" class="btn-primary" id="btn-enc-confirm" style="flex:1" ${state.busy ? "disabled" : ""}>Exportar cifrada</button>
          </div>
        </div>` : `
        <button type="button" id="btn-enc-export" style="${BTN_SECONDARY}margin-top:10px" ${state.busy ? "disabled" : ""}>Exportar copia cifrada (.bce)</button>`}
```

- [ ] **Step 3: Wiring del formulario**

En `wire()`:

```js
    const encBtn = container.querySelector("#btn-enc-export");
    if (encBtn) encBtn.onclick = () => { state.encExport = true; render(); };

    const encCancel = container.querySelector("#btn-enc-cancel");
    if (encCancel) encCancel.onclick = () => { state.encExport = false; render(); };

    const encConfirm = container.querySelector("#btn-enc-confirm");
    if (encConfirm) encConfirm.onclick = async () => {
      const p1 = container.querySelector("#enc-pass-1").value;
      const p2 = container.querySelector("#enc-pass-2").value;
      const errBox = container.querySelector("#enc-error");
      const fail = (msg) => { errBox.textContent = msg; errBox.style.display = "block"; };
      if (p1.length < MIN_PASSPHRASE) return fail(`Mínimo ${MIN_PASSPHRASE} caracteres.`);
      if (p1 !== p2) return fail("Las contraseñas no coinciden.");
      state.busy = true; render();
      try {
        const wb = rowsToWorkbook(window.XLSX, await dumpAllTables());
        const arr = window.XLSX.write(wb, { type: "array", bookType: "xlsx" });
        const enc = await encryptBackup(arr, p1);
        download(new Blob([enc], { type: "application/octet-stream" }), `basecero-cifrado-${hoyISO()}.bce`);
        state.encExport = false;
      } catch (e) {
        state.errors = [`No se pudo exportar: ${e.message}`];
      } finally {
        state.busy = false; render();
      }
    };
```

- [ ] **Step 4: Service worker**

En `app/sw.js`: cambiar `const CACHE = "bc-v12";` a `"bc-v13"` y añadir `"js/backup-crypto.js"` a la lista `SHELL` (junto a los demás `js/*.js`, p. ej. tras `"js/n26.js"`).

- [ ] **Step 5: Verificar**

Run: `node --test tests/app/`
Expected: PASS (la suite completa; esta task no añade tests propios porque los screens no tienen harness de DOM — la lógica cifrado está cubierta por Task 1).
Además: `node --check app/js/screens/ajustes.js && node --check app/sw.js` para descartar errores de sintaxis.

- [ ] **Step 6: Commit**

```bash
git add app/js/screens/ajustes.js app/sw.js
git commit -m "feat(app): optional passphrase-encrypted backup export from settings"
```

---

### Task 3: Import con detección de copia cifrada + README

**Files:**
- Modify: `app/js/screens/ajustes.js` (input de import, detección por magic, formulario de contraseña, refactor del parseo)
- Modify: `README.md` (mención de la copia cifrada en la sección de backups/privacidad)

**Interfaces:**
- Consumes (de Task 1): `isEncryptedBackup(buf)`, `decryptBackup(buf, passphrase)`, `WrongPassphraseError`, `BackupFormatError`. (De Task 2: el import de `../backup-crypto.js` ya existe en `ajustes.js` — amplíalo.)
- Produces: al importar un `.bce` válido con su contraseña, el flujo desemboca EXACTAMENTE en el mismo camino que un `.xlsx` en claro (validación → aviso de reemplazo → copia pre-import → `replaceAll` → reload).

- [ ] **Step 1: Ampliar import y estado**

```js
import { encryptBackup, decryptBackup, isEncryptedBackup, WrongPassphraseError, MIN_PASSPHRASE } from "../backup-crypto.js";
```

Estado inicial: añadir `encImport: null` (guardará `{ buf }` con el ArrayBuffer cifrado pendiente de contraseña):

```js
const state = { errors: null, pending: null, busy: false, n26Result: null, n26Error: null, encExport: false, encImport: null };
```

- [ ] **Step 2: Refactor — extraer el parseo del import a una función**

Dentro de `renderAjustes` (antes de `render()`), extraer del handler `#xlsx-file-input.onchange` actual la parte que va desde `const wb = window.XLSX.read(buf, …)` hasta el `state.pending = …`, a:

```js
  async function processImportBuffer(buf) {
    // buf: ArrayBuffer|Uint8Array con un .xlsx EN CLARO (ya descifrado si venía cifrado)
    const wb = window.XLSX.read(buf, { type: "array" });
    const { data, errors: parseErrors } = workbookToRows(window.XLSX, wb);
    const errors = [...parseErrors, ...validateImport(data)];
    if (errors.length) {
      state.errors = errors; state.pending = null;
      return;
    }
    const currentDump = await dumpAllTables();
    state.errors = null;
    // dumpAllTables trae TODAS las filas (incluidas las soft-deleted, necesario para el
    // backup JSON completo) — el aviso de "movimientos actuales" antes de un reemplazo
    // destructivo debe contar solo las visibles, si no infla la cifra con lo ya borrado.
    const activeCount = currentDump.transactions.filter((t) => !t.deleted).length;
    state.pending = { data, currentDump, currentCount: activeCount };
  }
```

Y el handler del input queda:

```js
    container.querySelector("#xlsx-file-input").onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = ""; // permite re-seleccionar el MISMO fichero (p.ej. tras corregirlo y reintentar)
      if (!file) return;
      state.busy = true; render();
      try {
        const buf = await file.arrayBuffer();
        if (isEncryptedBackup(buf)) {
          state.errors = null; state.pending = null; state.encImport = { buf };
        } else {
          state.encImport = null;
          await processImportBuffer(buf);
        }
      } catch (err) {
        state.errors = [`No se pudo leer el archivo: ${err.message}`]; state.pending = null;
      } finally {
        state.busy = false; render();
      }
    };
```

- [ ] **Step 3: Aceptar `.bce` y pintar el formulario de contraseña**

En el HTML: `accept=".xlsx"` del `#xlsx-file-input` pasa a `accept=".xlsx,.bce"`, y el texto de la card («Exporta todos tus datos…») añade al final: `La copia cifrada (.bce) también se importa desde aquí.`

Debajo del bloque `${state.errors ? …}` existente, añadir:

```js
        ${state.encImport ? `
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
          <p style="color:var(--text-2);font-size:13px">Esta copia está cifrada. Escribe su contraseña para continuar.</p>
          <input type="password" id="dec-pass" style="${INPUT_STYLE}" placeholder="Contraseña de la copia">
          <div id="dec-error" class="banner-aviso red" style="display:none"></div>
          <div style="display:flex;gap:8px">
            <button type="button" id="btn-dec-cancel" style="${BTN_SECONDARY}flex:1" ${state.busy ? "disabled" : ""}>Cancelar</button>
            <button type="button" class="btn-primary" id="btn-dec-confirm" style="flex:1" ${state.busy ? "disabled" : ""}>Descifrar</button>
          </div>
        </div>` : ""}
```

(`INPUT_STYLE` existe desde Task 2.)

- [ ] **Step 4: Wiring del descifrado**

En `wire()`:

```js
    const decCancel = container.querySelector("#btn-dec-cancel");
    if (decCancel) decCancel.onclick = () => { state.encImport = null; render(); };

    const decConfirm = container.querySelector("#btn-dec-confirm");
    if (decConfirm) decConfirm.onclick = async () => {
      const pass = container.querySelector("#dec-pass").value;
      const errBox = container.querySelector("#dec-error");
      state.busy = true; render();
      try {
        const plain = await decryptBackup(state.encImport.buf, pass);
        state.encImport = null;
        await processImportBuffer(plain);
      } catch (err) {
        if (err instanceof WrongPassphraseError) {
          // El formulario sigue abierto para reintentar; el error va inline, sin re-render
          // (un render() vaciaría el input).
          state.busy = false; render();
          const box = container.querySelector("#dec-error");
          box.textContent = "Contraseña incorrecta o archivo dañado.";
          box.style.display = "block";
          return;
        }
        // Error estructural (BackupFormatError) u otro: se cierra el formulario y va al banner normal.
        state.errors = [err.message]; state.encImport = null;
      } finally {
        if (state.busy) { state.busy = false; render(); }
      }
    };
```

Nota: en el camino `WrongPassphraseError` se hace `render()` ANTES de escribir en `#dec-error` porque el `render()` reconstruye el DOM (el div de error recién pintado está vacío y oculto); por eso se re-consulta `#dec-error` tras el `render()`. El `finally` no debe volver a renderizar en ese camino (por eso el `return` pone `state.busy = false` él mismo).

- [ ] **Step 5: README**

En `README.md`, localizar la sección que describe el export/backup (habla del `.xlsx` y de la copia de emergencia) y añadir una línea/frase del estilo:

```markdown
También puedes exportar una **copia cifrada** (`.bce`, AES-256-GCM con contraseña): se descifra solo desde BaseCero al importarla, y si olvidas la contraseña no hay forma de recuperarla — no se guarda en ningún sitio.
```

Adáptala al tono/estructura real de la sección (léela primero); si el README lista formatos o botones, actualiza esa lista.

- [ ] **Step 6: Verificar**

Run: `node --test tests/app/`
Expected: PASS completo.
Además: `node --check app/js/screens/ajustes.js`.

- [ ] **Step 7: Commit**

```bash
git add app/js/screens/ajustes.js README.md
git commit -m "feat(app): detect and decrypt encrypted backups on import"
```

---

## Self-review del plan (hecha al escribirlo)

- Cobertura del BACKLOG §P1: export cifrado opcional con passphrase (Task 1+2), import que lo detecta y pide la clave (Task 3), diseño tomado de Bito y adaptado a PWA (research doc), backup en claro intacto (constraint global + ningún cambio en los botones existentes). ✓
- Tipos/firmas consistentes entre tasks (`encryptBackup`/`decryptBackup`/`isEncryptedBackup`/`MIN_PASSPHRASE`, contenedor de 37 bytes en tests y módulo). ✓
- Sin placeholders: todo el código está en el plan. ✓
- Seguridad (checklist por feature del WORKFLOW): sin secretos en código/tests (contraseñas de test son literales inocuos), input validado en el boundary (cabecera hostil acotada), sin nuevas superficies de red (todo local), la passphrase no se persiste. ✓
