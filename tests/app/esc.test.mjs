// esc.js es el único módulo que puede definir escHtml/escAttr — hasta esta PR vivían copiados en
// 18 ficheros (16 pantallas + recibo.js + modal.js + ui.js), cada uno con su propia copia local
// (mismo patrón repetido, ver grep del historial de la PR chore/esc-html). Este test cubre el
// contrato del módulo: los cinco caracteres, null/undefined/números, idempotencia sobre texto
// llano. El escaneo de "ninguna copia local ha vuelto a aparecer" vive al final de este mismo
// fichero, añadido en el commit que termina de migrar las 16 pantallas — antes de eso fallaría
// contra copias que este commit todavía no ha tocado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { escHtml, escAttr } from "../../app/app/js/esc.js";

test("escHtml escapa los cinco caracteres especiales", () => {
  assert.equal(escHtml("&"), "&amp;");
  assert.equal(escHtml("<"), "&lt;");
  assert.equal(escHtml(">"), "&gt;");
  assert.equal(escHtml('"'), "&quot;");
  assert.equal(escHtml("'"), "&#39;");
  assert.equal(escHtml(`A&B <test> "x" 'y'`), "A&amp;B &lt;test&gt; &quot;x&quot; &#39;y&#39;");
});

test("escAttr escapa los cinco caracteres especiales (superconjunto seguro: sirve para atributos con comillas simples o dobles)", () => {
  assert.equal(escAttr("&"), "&amp;");
  assert.equal(escAttr("<"), "&lt;");
  assert.equal(escAttr(">"), "&gt;");
  assert.equal(escAttr('"'), "&quot;");
  assert.equal(escAttr("'"), "&#39;");
  assert.equal(escAttr(`A&B <test> "x" 'y'`), "A&amp;B &lt;test&gt; &quot;x&quot; &#39;y&#39;");
});

test("null/undefined se convierten en cadena vacía", () => {
  assert.equal(escHtml(null), "");
  assert.equal(escHtml(undefined), "");
  assert.equal(escAttr(null), "");
  assert.equal(escAttr(undefined), "");
});

test("los números se convierten en texto sin tocar", () => {
  assert.equal(escHtml(0), "0");
  assert.equal(escHtml(1234), "1234");
  assert.equal(escHtml(-4.5), "-4.5");
  assert.equal(escAttr(1234), "1234");
});

test("idempotente sobre texto sin caracteres especiales", () => {
  const texto = "Supermercado de la esquina 123";
  assert.equal(escHtml(texto), texto);
  assert.equal(escAttr(texto), texto);
});

// ---- escaneo: ninguna copia local fuera de esc.js -------------------------------------------

const JS_DIR = fileURLToPath(new URL("../../app/app/js/", import.meta.url));

function listAppJsFiles() {
  const files = [];
  function walk(dir, rel) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(dir + entry.name + "/", rel + entry.name + "/");
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        files.push(rel + entry.name);
      }
    }
  }
  walk(JS_DIR, "");
  return files;
}

// Mismo patrón que screen-imports.test.mjs#definesLocally: solo cuentan declaraciones de nivel de
// módulo (columna 0), función o const/let, con y sin `export`.
function definesLocally(src, name) {
  const asFunction = new RegExp(`^(?:export\\s+)?function\\s+${name}\\b`, "m");
  const asVariable = new RegExp(`^(?:export\\s+)?(?:const|let)\\s+${name}\\s*=`, "m");
  return asFunction.test(src) || asVariable.test(src);
}

test("ningún fichero de app/app/js, salvo esc.js, vuelve a definir escHtml/escAttr localmente", () => {
  const offenders = [];
  for (const rel of listAppJsFiles()) {
    if (rel === "esc.js") continue;
    const src = readFileSync(JS_DIR + rel, "utf8");
    for (const name of ["escHtml", "escAttr"]) {
      if (definesLocally(src, name)) offenders.push(`${rel}: define ${name} localmente`);
    }
  }
  assert.deepEqual(offenders, []);
});
