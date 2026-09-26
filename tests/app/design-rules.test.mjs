// Reglas de diseño del sistema B (design/DESIGN.md §5, §7, §8, §11 y §13) comprobadas solas.
// Cubre las casillas K1 (C13), K3 (C1), K4 (C2), K6 (C7), K9 (escala de letra) y K10 (radios) del
// checklist de PR, más foco, emoji, estilos en línea y el «atrás».
//
// Escanea el TEXTO de app/app/css/*.css (salvo tokens.css) y de app/app/js/**/*.js, plantillas
// incluidas: el naranja y los estilos en línea viven sobre todo en los template strings de las
// pantallas. Son regex, no un parser de CSS: reglas simples, y cada excepción cita su línea de DESIGN.
//
// PENDIENTES: ficheros aún sin migrar, que las reglas se saltan (desviación «Ficheros de la lista
// PENDIENTES», DESIGN §Desviaciones, se retira en la PR-99). La lista SOLO ENCOGE: si un fichero de
// la lista ya cumple todas las reglas, el último test falla hasta que se saca de ella.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ES as es } from "../../app/app/js/i18n/es.js";
import { EN as en } from "../../app/app/js/i18n/en.js";

const APP = fileURLToPath(new URL("../../app/app/", import.meta.url));

export const PENDIENTES = new Set([
  // Las 15 pantallas (cada S* saca las suyas). Una por línea para que las uniones no choquen.
  "js/screens/categorias.js",
  "js/screens/etiquetas.js",
  "js/screens/movimiento-detalle.js", // S5 lo separa de movimientos.js; la S6 lo migra
  "js/screens/onboarding.js",
  "js/screens/periodo-nuevo.js",
  "js/screens/recurrentes.js",
  "js/screens/suscripciones.js",
  // Módulos con plantilla o paleta propia, que migran con su pantalla o con su PR de fundación.
  "css/app.css",         // estilos «Neto»; cada PR de fundación y cada S* le quita lo suyo
  // Ficheros que otras PRs de fundación reescriben en paralelo con esta; salen al integrarlas
  // (el test de «ya cumple» obliga a sacarlos).
]);

// ---------- lectura ----------

function listar(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "vendor" ? [] : listar(p);
    return [p];
  });
}
const FICHEROS = [
  ...listar(APP + "css").filter((f) => f.endsWith(".css") && !f.endsWith("/tokens.css")),
  ...listar(APP + "js").filter((f) => f.endsWith(".js")),
].map((abs) => ({ rel: relative(APP, abs), text: readFileSync(abs, "utf8") }));

// legacy.css es su propia desviación (DESIGN §Desviaciones: alias var() de «Neto», se retira en la
// PR-99): sus alias leen --accent por diseño. Solo pasa por C13; legacy.test.mjs ata sus valores.
const SOLO_C13 = new Set(["css/legacy.css"]);

const sinComentariosCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Reglas CSS {sel, decls:[{prop, value}]}. La regex coge solo los bloques más internos, así que
 *  las reglas dentro de @media salen con su selector limpio. No es un parser: basta para el repo. */
export function reglasCss(css) {
  const out = [];
  for (const m of sinComentariosCss(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    const decls = m[2].split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(":");
      return i < 0 ? { prop: d, value: "" } : { prop: d.slice(0, i).trim().toLowerCase(), value: d.slice(i + 1).trim() };
    });
    out.push({ sel, decls });
  }
  return out;
}
const selectores = (sel) => sel.split(",").map((s) => s.trim());

/** Contenidos de style="…" y style='…' de un fichero JS (plantillas incluidas). */
export function estilosEnLinea(js) {
  return [...js.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => m[1] ?? m[2]);
}

// ---------- reglas: cada una devuelve una lista de mensajes ----------

// R-C13 · DESIGN §5 C13, la regex literal. Única excepción registrada: PDFLib.rgb( (§Desviaciones,
// informe-pdf.js, D-impl-3).
const C13 = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;
export function rC13(rel, text) {
  return text.split("\n").flatMap((l, i) =>
    C13.test(l.replaceAll("PDFLib.rgb(", "")) ? [`${rel}:${i + 1} color literal: ${l.trim().slice(0, 90)}`] : []);
}

// R-C1 · DESIGN §5 C1: naranja solo en el primario y lo seleccionado. En JS, nunca (va por clase).
// En CSS, la regla que lee --accent/--accent-text/--ring-sel tiene un selector de la lista blanca, y
// --focus (que es naranja) solo se lee en :focus-visible (§11).
const C1_BLANCA = [/\.btn-primary\b/, /\.tab-add\b/, /\.tab\[aria-current/, /\[aria-selected="?true"?\]/,
  /\[aria-pressed="?true"?\]/, /:checked\b/, /::selection\b/];
// §5 C1: el :checked que pinta naranja es de chip, día o baldosa.
const C1_CHECKED = /chip|day|dia|tile|baldosa/i;
export function rC1(rel, text) {
  if (rel.endsWith(".js")) {
    return text.includes("var(--accent") ? [`${rel}: lee var(--accent…) en JS; el naranja va por clase`] : [];
  }
  const errs = [];
  for (const { sel, decls } of reglasCss(text)) {
    const v = decls.map((d) => d.value).join(";");
    if (/var\(--(accent|ring-sel)\b/.test(v)) {
      for (const s of selectores(sel)) {
        const ok = C1_BLANCA.some((re) => re.test(s)) && (!/:checked\b/.test(s) || C1_CHECKED.test(s));
        if (!ok) errs.push(`${rel}: «${s}» lee --accent/--ring-sel fuera de primario o seleccionado`);
      }
    }
    if (/var\(--focus\)/.test(v)) {
      for (const s of selectores(sel)) {
        if (!/:focus-visible\b/.test(s)) errs.push(`${rel}: «${s}» lee --focus fuera de :focus-visible`);
      }
    }
  }
  return errs;
}

// R-C2 · DESIGN §5 C2: ámbar solo en la cifra principal del Display, su línea y el «hoy». Más el
// LED en espera (DESIGN §9 LED: «espera» solo en el Display; inventario-B LED/I-19 y el token
// --led-glow-wait: su punto es ámbar). Es un punto de 8 dentro del Display, no una cifra.
const C2_BLANCA = /\.disp-value\b|\.disp-chart-line\b|\.disp-today\b|\.led-wait\b/;
export function rC2(rel, text) {
  if (rel.endsWith(".js")) return text.includes("--disp-text") ? [`${rel}: --disp-text en JS`] : [];
  const errs = [];
  for (const { sel, decls } of reglasCss(text)) {
    if (!decls.some((d) => d.value.includes("var(--disp-text)"))) continue;
    for (const s of selectores(sel)) if (!C2_BLANCA.test(s)) errs.push(`${rel}: «${s}» lee --disp-text`);
  }
  return errs;
}

// R-C7 · DESIGN §5 C7: las cifras van en tinta, nunca en color de familia.
const C7_FAM = /var\(--(f-[a-z]+-[xbt]|fx|fb|ft)\)/;
export function rC7(rel, text) {
  if (!rel.endsWith(".css")) return [];
  return reglasCss(text).flatMap(({ sel, decls }) =>
    /num|amount|value/i.test(sel) && decls.some((d) => C7_FAM.test(d.value))
      ? [`${rel}: «${sel}» pinta una cifra con color de familia`] : []);
}

// R-FS · DESIGN §7: escala de cuerpo --fs-*, Display --disp-xl/l/m y el 16 (--fs-input) solo en inputs.
const TAM = /var\(--(fs-(12|13|14|15|17|20|24)|disp-(xl|l|m))\)/;
const TAM_INPUT = /var\(--fs-input\)/;
const LITERAL = /(^|[\s/])\d*\.?\d+(px|rem|em|pt|%|vw|vh)\b/;
export function rFS(rel, text) {
  if (!rel.endsWith(".css")) return [];
  const errs = [];
  for (const { sel, decls } of reglasCss(text)) {
    for (const { prop, value } of decls) {
      if (prop !== "font-size" && prop !== "font") continue;
      if (value === "inherit") continue;
      const input = TAM_INPUT.test(value);
      if (input && !selectores(sel).every((s) => /input|select|textarea/.test(s))) {
        errs.push(`${rel}: «${sel}» usa --fs-input fuera de input/select/textarea`);
        continue;
      }
      const soloVar = value.replace(/var\([^)]*\)/g, "");
      if ((!TAM.test(value) && !input) || LITERAL.test(soloVar)) errs.push(`${rel}: «${sel}» ${prop}: ${value}`);
    }
  }
  return errs;
}

// R-RAD · DESIGN §8: radios solo de --radius*. Constantes de componente con nombre del inventario
// (§9): la casilla, radio 7, y la muestra de 10 del chip de filtro, radio 3.
const RAD_TOKEN = /^var\(--radius(-xs|-lg|-xl|-pill)?\)$/;
const RAD_NOMBRADO = [{ v: "7px", sel: /casilla|checkbox|check-box/ }, { v: "3px", sel: /muestra|swatch/ }];
export function rRAD(rel, text) {
  if (!rel.endsWith(".css")) return [];
  const errs = [];
  for (const { sel, decls } of reglasCss(text)) {
    for (const { prop, value } of decls) {
      if (!/^border(-[a-z]+)*-radius$/.test(prop)) continue;
      const partes = value.replace(/\s*\/\s*/g, " ").split(/\s+(?![^(]*\))/);
      for (const p of partes) {
        if (p === "0" || p === "inherit" || RAD_TOKEN.test(p)) continue;
        if (RAD_NOMBRADO.some((n) => n.v === p && n.sel.test(sel))) continue;
        errs.push(`${rel}: «${sel}» ${prop}: ${value}`);
      }
    }
  }
  return errs;
}

// R-FOCUS · DESIGN §11: nunca outline:none sin sustituto visible en el mismo fichero.
export function rFOCUS(rel, text) {
  if (!/outline\s*:\s*(none|0)\b/.test(text)) return [];
  const sustituto = reglasCss(text).some(({ sel, decls }) =>
    /:focus-visible/.test(sel) && decls.some((d) => d.prop === "outline" && d.value.includes("var(--focus)")));
  return sustituto ? [] : [`${rel}: outline:none sin :focus-visible con var(--focus)`];
}

// R-EMOJI · DESIGN §6: cero emoji en la UI (iconos SVG de trazo).
const EMOJI = /\p{Extended_Pictographic}/u;
export function rEMOJI(rel, text) {
  return text.split("\n").flatMap((l, i) => (EMOJI.test(l) ? [`${rel}:${i + 1} emoji: ${l.trim().slice(0, 60)}`] : []));
}

// R-INLINE · plan §4 punto 2: en línea solo geometría dinámica (propiedades personalizadas, width,
// height, flex-basis). Lo demás va a su sección de screens.css o a components.css.
const INLINE_OK = /^(--[a-zA-Z0-9-]+|width|height|flex-basis)$/;
export function rINLINE(rel, text) {
  if (!rel.endsWith(".js")) return [];
  const errs = [];
  for (const s of estilosEnLinea(text)) {
    for (const d of s.split(";").map((x) => x.trim()).filter(Boolean)) {
      const i = d.indexOf(":");
      const prop = i < 0 ? d : d.slice(0, i).trim();
      if (!INLINE_OK.test(prop)) errs.push(`${rel}: style="${s.slice(0, 60)}" (${prop})`);
    }
  }
  return errs;
}

// R-BACK · DESIGN §11: el atrás lleva aria-label «Atrás», es decir t("common.back").
// Se reconoce por id o clase con «back» en la etiqueta del botón.
export function rBACK(rel, text) {
  if (!rel.endsWith(".js")) return [];
  const errs = [];
  for (const m of text.matchAll(/(<button\b[^>]*>)([\s\S]*?)<\/button>/g)) {
    const [, tag, cuerpo] = m;
    const esAtras = /\b(id|class)="[^"]*\bback\b/.test(tag) || cuerpo.includes('icon("back"');
    if (!esAtras) continue;
    if (!/aria-label="\$\{(escAttr\()?t\("common\.back"\)\)?\}"/.test(tag)) errs.push(`${rel}: atrás sin aria-label t("common.back"): ${tag.slice(0, 90)}`);
  }
  return errs;
}

const REGLAS = { rC13, rC1, rC2, rC7, rFS, rRAD, rFOCUS, rEMOJI, rINLINE, rBACK };
const aplicables = (rel) => (SOLO_C13.has(rel) ? { rC13 } : REGLAS);
const migrados = FICHEROS.filter((f) => !PENDIENTES.has(f.rel));
const incumple = (regla) => migrados.flatMap((f) => (aplicables(f.rel)[regla] ? aplicables(f.rel)[regla](f.rel, f.text) : []));

// ---------- las reglas, sobre los ficheros migrados ----------

test("hay ficheros migrados que escanear, y los de las otras PRs de fundación entran solos", () => {
  assert.ok(migrados.length >= 30, `solo ${migrados.length}`);
  assert.ok(migrados.some((f) => f.rel === "css/components.css"));
  assert.ok(!FICHEROS.some((f) => f.rel === "css/tokens.css" || f.rel.startsWith("vendor")));
});
test("R-C13: ningún hex ni rgb( fuera de tokens.css (salvo PDFLib.rgb()", () => assert.deepEqual(incumple("rC13"), []));
test("R-C1: naranja solo en primario y seleccionado; nada de var(--accent en JS", () => assert.deepEqual(incumple("rC1"), []));
test("R-C2: --disp-text solo en .disp-value, .disp-chart-line y .disp-today", () => assert.deepEqual(incumple("rC2"), []));
test("R-C7: ninguna cifra (num|amount|value) en -x/-b/-t de familia", () => assert.deepEqual(incumple("rC7"), []));
test("R-FS: font-size/font solo de la escala; --fs-input solo en inputs", () => assert.deepEqual(incumple("rFS"), []));
test("R-RAD: border-radius solo de --radius* (casilla 7, muestra 3)", () => assert.deepEqual(incumple("rRAD"), []));
test("R-FOCUS: ningún outline:none sin :focus-visible con var(--focus)", () => assert.deepEqual(incumple("rFOCUS"), []));
test("R-EMOJI: cero emoji en los ficheros migrados", () => assert.deepEqual(incumple("rEMOJI"), []));
test("R-EMOJI: cero emoji en los valores de i18n (es y en)", () => {
  const valores = (o) => Object.values(o).flatMap((v) => (typeof v === "string" ? [v] : valores(v)));
  for (const [lang, dic] of [["es", es], ["en", en]]) {
    assert.deepEqual(valores(dic).filter((v) => EMOJI.test(v)), [], lang);
  }
});
test("R-INLINE: style=\"…\" solo con geometría dinámica", () => assert.deepEqual(incumple("rINLINE"), []));
test("R-BACK: el atrás lleva aria-label t(\"common.back\") y vale «Atrás»", () => {
  assert.equal(es.common.back, "Atrás");
  assert.deepEqual(incumple("rBACK"), []);
});

test("screens.css: una sección sembrada por fichero de js/screens/, en su orden", () => {
  const pantallas = readdirSync(APP + "js/screens").filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3)).sort();
  const css = readFileSync(APP + "css/screens.css", "utf8");
  const abren = [...css.matchAll(/\/\* === pantalla: ([a-z-]+) === \*\//g)].map((m) => m[1]);
  const cierran = [...css.matchAll(/\/\* === fin: ([a-z-]+) === \*\//g)].map((m) => m[1]);
  assert.deepEqual(abren, pantallas);
  assert.deepEqual(cierran, pantallas);
});

// ---------- los detectores, sobre casos sintéticos (para que un falso verde no pase) ----------

test("detectores: cazan lo que prohíben y dejan pasar lo permitido", () => {
  assert.equal(rC13("x.js", "// antes #1b1e21\nconst a = 1;").length, 1);
  assert.equal(rC13("x.js", "#acc-name").length, 1, "los ids #acc-* son falsos positivos reales: se renombran");
  assert.equal(rC13("x.js", "PDFLib.rgb(r, g, b)").length, 0);
  assert.equal(rC13("x.css", "a{color:rgba(0,0,0,.1)}").length, 1);

  assert.equal(rC1("x.js", "`<b style=\"color:var(--accent)\">`").length, 1);
  assert.equal(rC1("x.css", ".btn-primary{background:var(--accent)}").length, 0);
  assert.equal(rC1("x.css", ".tab[aria-current=\"page\"]{color:var(--accent-text)}").length, 0);
  assert.equal(rC1("x.css", ".chip[aria-pressed=\"true\"]{background:var(--accent)}").length, 0);
  assert.equal(rC1("x.css", ".tile:checked{box-shadow:var(--ring-sel)}").length, 0);
  assert.equal(rC1("x.css", ".switch:checked{background:var(--accent)}").length, 1, "el interruptor va en tinta (F-04)");
  assert.equal(rC1("x.css", ".link{color:var(--accent)}").length, 1);
  assert.equal(rC1("x.css", "@media (x){.btn-primary,.h2{color:var(--accent)}}").length, 1);
  assert.equal(rC1("x.css", "button:focus-visible{outline:var(--focus)}").length, 0);
  assert.equal(rC1("x.css", ".a:hover{outline:var(--focus)}").length, 1);

  assert.equal(rC2("x.css", ".disp-value{color:var(--disp-text)}").length, 0);
  assert.equal(rC2("x.css", ".disp-foot{color:var(--disp-text)}").length, 1);
  assert.equal(rC2("x.css", ".led-wait .led-dot{background:var(--disp-text)}").length, 0);
  assert.equal(rC2("x.css", ".led-ok .led-dot{background:var(--disp-text)}").length, 1);

  assert.equal(rC7("x.css", ".row-amount{color:var(--fx)}").length, 1);
  assert.equal(rC7("x.css", ".row-sub{color:var(--fx)}").length, 0);
  assert.equal(rC7("x.css", ".num{color:var(--f-casa-x)}").length, 1);

  assert.equal(rFS("x.css", ".a{font-size:var(--fs-15)}").length, 0);
  assert.equal(rFS("x.css", ".a{font:700 var(--fs-17)/1.2 var(--font-body)}").length, 0);
  assert.equal(rFS("x.css", ".a{font-size:18px}").length, 1);
  assert.equal(rFS("x.css", ".a{font:600 15px var(--font-body)}").length, 1);
  assert.equal(rFS("x.css", ".a{font-size:var(--fs-input)}").length, 1);
  assert.equal(rFS("x.css", ".campo input{font-size:var(--fs-input)}").length, 0);
  assert.equal(rFS("x.css", ".d{font-size:var(--disp-xl)}").length, 0);
  assert.equal(rFS("x.css", "button{font:inherit}").length, 0);

  assert.equal(rRAD("x.css", ".a{border-radius:var(--radius-lg)}").length, 0);
  assert.equal(rRAD("x.css", ".a{border-radius:var(--radius-xl) var(--radius-xl) 0 0}").length, 0);
  assert.equal(rRAD("x.css", ".a{border-radius:8px}").length, 1);
  assert.equal(rRAD("x.css", ".casilla{border-radius:7px}").length, 0);
  assert.equal(rRAD("x.css", ".chip{border-radius:7px}").length, 1);
  assert.equal(rRAD("x.css", ".muestra{border-top-left-radius:3px}").length, 0);

  assert.equal(rFOCUS("x.css", "button{outline:none}").length, 1);
  assert.equal(rFOCUS("x.css", "button{outline:none}button:focus-visible{outline:var(--focus)}").length, 0);

  assert.equal(rEMOJI("x.js", "const a = \"🐾\";").length, 1);
  assert.equal(rEMOJI("x.js", "const a = \"Hoy → mañana · 12 €\";").length, 0);

  assert.equal(rINLINE("x.js", "`<div style=\"width:${p}%; --cat:${c}\"></div>`").length, 0);
  assert.equal(rINLINE("x.js", "`<div style=\"display:none\"></div>`").length, 1);
  assert.equal(rINLINE("x.js", "`<div style=\"flex-basis:40%; font-size:18px\"></div>`").length, 1);

  assert.equal(rBACK("x.js", "`<button type=\"button\" id=\"mov-back\" aria-label=\"${escAttr(t(\"common.back\"))}\"></button>`").length, 0);
  assert.equal(rBACK("x.js", "`<button type=\"button\" id=\"mov-back\" aria-label=\"${t(\"common.goBack\")}\"></button>`").length, 1);
  assert.equal(rBACK("x.js", "`<button id=\"${escAttr(id)}\" aria-label=\"${t(\"common.goBack\")}\">${icon(\"back\")}</button>`").length, 1);

});

// ---------- la lista PENDIENTES solo encoge ----------

test("PENDIENTES: cada entrada existe y está dentro del escaneo", () => {
  const rels = new Set(FICHEROS.map((f) => f.rel));
  for (const p of PENDIENTES) {
    assert.ok(existsSync(APP + p), `${p} no existe: se sacó o se renombró, quítalo de PENDIENTES`);
    assert.ok(rels.has(p), `${p} no se escanea`);
  }
});

test("PENDIENTES: ningún fichero de la lista cumple ya todas las reglas (si cumple, sácalo)", () => {
  const yaCumplen = FICHEROS.filter((f) => PENDIENTES.has(f.rel))
    .filter((f) => Object.values(REGLAS).every((r) => r(f.rel, f.text).length === 0)).map((f) => f.rel);
  assert.deepEqual(yaCumplen, [], "ya cumplen todas las reglas de diseño: sácalos de PENDIENTES");
});
