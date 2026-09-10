// Las pantallas (app/app/js/screens/*.js) NO se ejecutan en Node: importan repo.js, que crea un
// Worker (new Worker(...)) para hablar con sqlite-wasm, y eso revienta fuera del navegador. Por
// eso ningún test de la suite puede hacer `import "../../app/app/js/screens/categorias.js"` y
// dejar que Node resuelva sus imports de verdad — la suite entera pasa en verde aunque una
// pantalla llame a un helper que nunca importó, y el error solo aparece en el navegador
// (ReferenceError en tiempo de ejecución, al pintar esa pantalla). Ocurrió de verdad:
// categorias.js llamaba a `subHeaderHtml({...})` sin `import { subHeaderHtml } from "../ui.js";`
// — 944 tests en verde, pantalla rota en producción.
//
// Este test NO ejecuta el código: escanea el TEXTO fuente (mismo enfoque que
// repo-i18n-guards.test.mjs) y comprueba, para cada helper compartido de la lista de abajo, que
// todo fichero que lo LLAME (`nombre(`) también lo DEFINA localmente o lo IMPORTE de su módulo de
// origen. Es una red de seguridad barata para un fallo que, si no, solo se ve a mano en el
// navegador — no sustituye probar la pantalla de verdad.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const JS_DIR = fileURLToPath(new URL("../../app/app/js/", import.meta.url));

// Alcance: solo los ficheros que de verdad corren como "pantalla" o módulo compartido de UI en el
// navegador. i18n/ tiene su propio guard (repo-i18n-guards.test.mjs) y sus diccionarios no son
// código que llame a estos helpers; db-worker.js corre dentro del Worker (nunca en el hilo de
// pantallas) y no usa ninguno de ellos — comprobado, cero matches — así que no aporta nada
// escanearlo aquí. sw.js vive fuera de app/app/js/ (en app/app/), fuera del alcance por
// construcción del recorrido de abajo.
function listScreenFiles() {
  const files = [];
  for (const entry of readdirSync(JS_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".js") && entry.name !== "db-worker.js") {
      files.push(entry.name);
    }
  }
  const screensDir = JS_DIR + "screens/";
  for (const entry of readdirSync(screensDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".js")) files.push("screens/" + entry.name);
  }
  return files;
}

// Helpers compartidos que una pantalla puede usar sin ser su dueña — los candidatos reales a "lo
// usa sin importarlo" porque viven en un módulo aparte y se usan por toda la app. escHtml/
// escAttr normalmente NO hace falta importarlos: cada pantalla suele declarar su propia copia
// local (mismo patrón en todo el código) — ahí el check de "lo define localmente" los deja pasar;
// solo fallarían si alguna pantalla los LLAMA sin tener ni su propia copia ni un import.
const HELPERS = [
  { name: "subHeaderHtml", from: "ui.js" },
  { name: "metaHtml", from: "ui.js" },
  { name: "icon", from: "icons.js" },
  { name: "moneyPartsHtml", from: "format.js" },
  { name: "fmtMoney", from: "format.js" },
  { name: "fmtDiaCorto", from: "format.js" },
  { name: "fmtDiaLargo", from: "format.js" },
  { name: "t", from: "i18n/index.js" },
  { name: "escHtml", from: "(local, por convención)" },
  { name: "escAttr", from: "(local, por convención)" },
];

// Quita comentarios de bloque y de línea ANTES de buscar llamadas: sin esto, un JSDoc que
// documenta la función mencionando `t()` o `icon(...)` cuenta como "uso" y da un falso positivo
// (le pasó de verdad a inicio-logic.js: su cabecera dice "...decide la clave de `t()`..." sin que
// el fichero llame a t() en ningún sitio real). Los imports/definiciones reales nunca viven dentro
// de un comentario, así que se buscan siempre sobre el fuente SIN tocar (`raw`), no sobre esta
// versión limpia.
function stripComments(src) {
  const noBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlockComments
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? "" : line))
    .join("\n");
}

// ¿El propio fichero declara `name` como función o variable A NIVEL DE MÓDULO (columna 0, no
// dentro de una función)? Cubre `function name(...)`/`export function name(...)` y
// `const name = ...`/`let name = ...` (incluida la forma exportada) — así ui.js/icons.js/
// format.js/i18n/index.js NUNCA se marcan como "usan sin importar" el helper que ELLOS MISMOS
// definen, y cada pantalla que copia su propio `const escHtml = ...`/`const escAttr = ...` al
// principio del fichero (patrón repetido en todo screens/) tampoco necesita importarlos.
//
// Anclado con `^`/`m`, a propósito: SIN anclar, un `const icon = iconForCategory(...)` indentado
// dentro de una función (variable de UNA fila con el icono/emoji de su categoría — patrón real en
// inicio.js, semana.js, suscripciones.js, registro.js, gasto-por-categoria.js y
// periodo-nuevo.js) también habría contado como "define `icon` localmente" y habría tapado TODO
// el fichero para ese helper — si esa pantalla alguna vez añade una llamada real a `icon(...)` de
// icons.js sin importarla, el guard sin anclar no lo vería. Anclado a columna 0 solo cuentan las
// declaraciones de nivel de módulo (la copia real de escHtml/escAttr, o el propio módulo dueño del
// helper), no una variable de una fila con el mismo nombre.
function definesLocally(rawSrc, name) {
  const asFunction = new RegExp(`^(?:export\\s+)?function\\s+${name}\\b`, "m");
  const asVariable = new RegExp(`^(?:export\\s+)?(?:const|let)\\s+${name}\\s*=`, "m");
  return asFunction.test(rawSrc) || asVariable.test(rawSrc);
}

// ¿Alguno de los bloques `import { ... } from "..."` del fichero trae `name`? `[^}]*` ya cruza
// saltos de línea sin flag especial (no es un `.`, es "cualquier cosa que no sea `}`"), así que
// cubre tanto un import en una sola línea como el multilínea de categorias.js.
function importsIt(rawSrc, name) {
  const importBlocks = [...rawSrc.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g)];
  const nameRe = new RegExp(`\\b${name}\\b`);
  return importBlocks.some((block) => nameRe.test(block[1]));
}

// ¿El fichero LLAMA a `name(...)` en código real (no en un comentario)? `\b` delante evita que
// "format(" cuente como uso de `t` (el carácter antes de la `t` de "forma-t-(" es una letra, no
// hay límite de palabra ahí) — es la misma protección de "límite de palabra" que pide la tarea
// para `t`, y de paso vale para el resto de la lista sin necesidad de un caso especial.
function callsIt(cleanSrc, name) {
  return new RegExp(`\\b${name}\\s*\\(`).test(cleanSrc);
}

test("ninguna pantalla usa un helper compartido sin importarlo (categorias.js llamaba a subHeaderHtml sin import)", () => {
  const offenders = [];
  for (const rel of listScreenFiles()) {
    const raw = readFileSync(JS_DIR + rel, "utf8");
    const clean = stripComments(raw);
    for (const { name } of HELPERS) {
      if (!callsIt(clean, name)) continue;
      if (definesLocally(raw, name)) continue;
      if (importsIt(raw, name)) continue;
      offenders.push(`${rel}: usa ${name} sin importarlo`);
    }
  }
  assert.deepEqual(offenders, []);
});
