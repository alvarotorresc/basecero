import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FAMILIES,
  ROOT_FAMILY,
  POOL_TO_FAMILY,
  LEGACY_COLORS,
  LEGACY_EMOJI,
  emojiKey,
  familyForCategory,
  iconForCategory,
  famClass,
  colorForCategory,
  initCategoryStyle,
  parseStyle,
  hashIndex,
  rootOf,
} from "../../app/app/js/category-colors.js";
import { CAT_ICONS } from "../../app/app/js/icons.js";

// Reset del estado module-level entre tests para que no se filtren overrides.
beforeEach(() => {
  initCategoryStyle({});
});

// byId envuelto en un Proxy que cuenta lecturas y lanza tras un umbral: un rootOf sin guard de
// ciclo entra en bucle infinito sobre un byId cíclico y colgaría el runner; este wrapper convierte
// ese cuelgue en un throw determinista.
function withLookupLimit(byId, limit = 10000) {
  let gets = 0;
  return new Proxy(byId, {
    get(target, prop) {
      gets++;
      if (gets > limit) {
        throw new Error(`rootOf: más de ${limit} lecturas de byId — posible bucle infinito sin guard de ciclo`);
      }
      return target[prop];
    },
  });
}

test("category-colors: rootOf termina sobre un auto-ciclo (parent_id === id propio) sin colgarse", () => {
  const byId = withLookupLimit({ a: { id: "a", parent_id: "a" } });
  assert.equal(rootOf("a", byId), "a");
});

test("category-colors: rootOf termina sobre un ciclo A↔B sin colgarse", () => {
  const byId = withLookupLimit({ a: { id: "a", parent_id: "b" }, b: { id: "b", parent_id: "a" } });
  const result = rootOf("a", byId);
  assert.ok(result === "a" || result === "b");
});

test("category-colors: hashIndex es estable para un conjunto fijo de ids (mismo djb2, 12 ranuras)", () => {
  assert.equal(hashIndex("cat-mascotas"), 3);
  assert.equal(hashIndex("cat-viajes"), 4);
  assert.equal(hashIndex("cat-foo"), 0);
});

// ---- Familias ------------------------------------------------------------------------------

test("FAMILIES: las 12 claves, en el orden del plan", () => {
  assert.deepEqual(FAMILIES, ["casa", "ali", "res", "tra", "coc", "sal", "sus", "oci", "rop", "reg", "imp", "otr"]);
});

const SEED_BYID = {
  "cat-casa": { id: "cat-casa", parent_id: "", flow: "expense" },
  "cat-alimentacion": { id: "cat-alimentacion", parent_id: "", flow: "expense" },
  "cat-restauracion": { id: "cat-restauracion", parent_id: "", flow: "expense" },
  "cat-transporte": { id: "cat-transporte", parent_id: "", flow: "expense" },
  "cat-coche": { id: "cat-coche", parent_id: "", flow: "expense" },
  "cat-salud": { id: "cat-salud", parent_id: "", flow: "expense" },
  "cat-suscripciones": { id: "cat-suscripciones", parent_id: "", flow: "expense" },
  "cat-ocio": { id: "cat-ocio", parent_id: "", flow: "expense" },
  "cat-ropa": { id: "cat-ropa", parent_id: "", flow: "expense" },
  "cat-regalos": { id: "cat-regalos", parent_id: "", flow: "expense" },
  "cat-impuestos": { id: "cat-impuestos", parent_id: "", flow: "expense" },
  "cat-otros": { id: "cat-otros", parent_id: "", flow: "expense" },
  "cat-nomina": { id: "cat-nomina", parent_id: "", flow: "income" },
  "cat-puntuales": { id: "cat-puntuales", parent_id: "", flow: "income" },
  "cat-intereses": { id: "cat-intereses", parent_id: "", flow: "income" },
  "cat-casa-luz": { id: "cat-casa-luz", parent_id: "cat-casa", flow: "expense" },
  "cat-salud-gimnasio": { id: "cat-salud-gimnasio", parent_id: "cat-salud", flow: "expense" },
};

test("familyForCategory: las 12 raíces sembradas de gasto tienen su familia fija", () => {
  const expected = {
    "cat-casa": "casa", "cat-alimentacion": "ali", "cat-restauracion": "res", "cat-transporte": "tra",
    "cat-coche": "coc", "cat-salud": "sal", "cat-suscripciones": "sus", "cat-ocio": "oci",
    "cat-ropa": "rop", "cat-regalos": "reg", "cat-impuestos": "imp", "cat-otros": "otr",
  };
  for (const [id, fam] of Object.entries(expected)) {
    assert.equal(familyForCategory(id, SEED_BYID), fam, id);
    assert.equal(ROOT_FAMILY[id], fam, `ROOT_FAMILY[${id}]`);
  }
});

test("familyForCategory: una subcategoría hereda la familia de su raíz, nunca tiene la suya (§6)", () => {
  assert.equal(familyForCategory("cat-casa-luz", SEED_BYID), "casa");
  assert.equal(familyForCategory("cat-salud-gimnasio", SEED_BYID), "sal");
  initCategoryStyle({ "cat-casa-luz": { fam: "oci" } }); // override en una hija: se ignora
  assert.equal(familyForCategory("cat-casa-luz", SEED_BYID), "casa");
});

test("familyForCategory: los ingresos devuelven null (C9), por flow o por ser seed de ingreso", () => {
  for (const id of ["cat-nomina", "cat-puntuales", "cat-intereses"]) assert.equal(familyForCategory(id, SEED_BYID), null, id);
  // Sin flow en byId (datos parciales): los seeds de ingreso siguen siendo ingreso.
  assert.equal(familyForCategory("cat-nomina", { "cat-nomina": { id: "cat-nomina", parent_id: "" } }), null);
  // Ingreso de usuario: flow manda.
  const byId = { "cat-freelance": { id: "cat-freelance", parent_id: "", flow: "income" },
    "cat-freelance-x": { id: "cat-freelance-x", parent_id: "cat-freelance", flow: "income" } };
  assert.equal(familyForCategory("cat-freelance", byId), null);
  assert.equal(familyForCategory("cat-freelance-x", byId), null);
  // Un override no convierte un ingreso en familia.
  initCategoryStyle({ "cat-freelance": { fam: "ali" } });
  assert.equal(familyForCategory("cat-freelance", byId), null);
});

test("familyForCategory: \"\" (sin categoría) devuelve null — se pinta neutra en --well", () => {
  assert.equal(familyForCategory("", SEED_BYID), null);
  assert.equal(familyForCategory("", {}), null);
});

test("familyForCategory: una raíz de usuario sin override cae a FAMILIES[hashIndex(root)], estable", () => {
  const byId = { "cat-mascotas": { id: "cat-mascotas", parent_id: "", flow: "expense" } };
  // Literal a propósito: hashIndex("cat-mascotas") = 3 → FAMILIES[3] = "tra".
  assert.equal(familyForCategory("cat-mascotas", byId), "tra");
  assert.equal(familyForCategory("cat-mascotas", byId), FAMILIES[hashIndex("cat-mascotas")]);
});

test("familyForCategory: precedencia override > ROOT_FAMILY > hash", () => {
  initCategoryStyle({ "cat-casa": { fam: "oci" }, "cat-mascotas": { fam: "rop" } });
  const byId = { ...SEED_BYID, "cat-mascotas": { id: "cat-mascotas", parent_id: "", flow: "expense" } };
  assert.equal(familyForCategory("cat-casa", byId), "oci");
  assert.equal(familyForCategory("cat-casa-luz", byId), "oci", "la hija sigue al override de su raíz");
  assert.equal(familyForCategory("cat-mascotas", byId), "rop");
});

test("famClass: fam-<clave>; null o clave desconocida da cadena vacía", () => {
  assert.equal(famClass("casa"), "fam-casa");
  assert.equal(famClass("otr"), "fam-otr");
  assert.equal(famClass(null), "");
  assert.equal(famClass("nope"), "");
});

// ---- Iconos -------------------------------------------------------------------------------

test("iconForCategory: devuelve una clave de icono, no un emoji", () => {
  for (const id of Object.keys(SEED_BYID)) {
    const key = iconForCategory(id, SEED_BYID);
    assert.match(key, /^[a-z]+$/, `${id} → ${key}`);
  }
  assert.equal(iconForCategory("cat-casa", SEED_BYID), "casa");
  assert.equal(iconForCategory("cat-otros", SEED_BYID), "otr");
  assert.equal(iconForCategory("cat-casa-luz", SEED_BYID), "casa");
  assert.ok(CAT_ICONS[iconForCategory("cat-coche", SEED_BYID)]);
});

test("iconForCategory: ingresos → income; sin categoría → otr", () => {
  assert.equal(iconForCategory("cat-nomina", SEED_BYID), "income");
  assert.equal(iconForCategory("", SEED_BYID), "otr");
});

test("iconForCategory: override > icono de la raíz sembrada > icono de su familia", () => {
  const byId = { ...SEED_BYID, "cat-mascotas": { id: "cat-mascotas", parent_id: "", flow: "expense" } };
  assert.equal(iconForCategory("cat-mascotas", byId), "tra", "sin override: el icono de su familia hasheada");
  initCategoryStyle({ "cat-mascotas": { icon: "huella" }, "cat-casa": { fam: "oci" } });
  assert.equal(iconForCategory("cat-mascotas", byId), "huella");
  assert.equal(iconForCategory("cat-casa", byId), "casa", "cambiar la familia de Casa no le cambia el icono");
});

// ---- Compatibilidad del category_style antiguo (§6) -----------------------------------------

test("compat: POOL_TO_FAMILY es total sobre las 12 ranuras v2 y cada destino es una familia", () => {
  assert.equal(Object.keys(POOL_TO_FAMILY).length, 12);
  for (const [hex, fam] of Object.entries(POOL_TO_FAMILY)) {
    assert.match(hex, /^[0-9a-f]{6}$/, "hex en minúsculas y sin almohadilla");
    assert.ok(FAMILIES.includes(fam), `${hex} → ${fam}`);
  }
});

test("compat: cada hex de v1 y de v2 da una familia válida", () => {
  assert.equal(Object.keys(LEGACY_COLORS).length, 12);
  for (const [v1, v2] of Object.entries(LEGACY_COLORS)) {
    assert.ok(POOL_TO_FAMILY[v2], `${v1} → ${v2} sin familia`);
    const parsed = parseStyle(JSON.stringify({ "cat-x": { color: `#${v1.toUpperCase()}` } }));
    assert.deepEqual(parsed, { "cat-x": { fam: POOL_TO_FAMILY[v2] } }, v1);
  }
  for (const v2 of Object.keys(POOL_TO_FAMILY)) {
    const parsed = parseStyle(JSON.stringify({ "cat-x": { color: `#${v2.toUpperCase()}` } }));
    assert.deepEqual(parsed, { "cat-x": { fam: POOL_TO_FAMILY[v2] } }, v2);
  }
});

test("compat: tabla hex → familia fijada (la que ve Álvaro en la PR)", () => {
  assert.deepEqual(POOL_TO_FAMILY, {
    "6bcb3e": "ali", "8b7cf6": "sus", "c4b72f": "imp", "c264d9": "rop", "22c58b": "ali", "e8a93b": "casa",
    "2bd9c9": "sal", "ff7a45": "reg", "2fc4e0": "sal", "de5fa8": "oci", "5b9bff": "tra", "e85f72": "reg",
  });
});

// Emojis de v2 escritos aquí en claro (los tests no pasan por R-EMOJI); en category-colors.js
// viven como secuencias de code points.
const OLD_CATEGORY_ICONS = ["🏠", "🛒", "🍽️", "🚌", "🚗", "❤️‍🩹", "📺", "🎉", "👕", "🎁", "🧾", "▫️", "💶"];
const OLD_CURATED_ICONS = ["🐾", "🎓", "✈️", "👶", "💻", "🎮", "🌱", "📦"];

test("compat: cada emoji de CATEGORY_ICONS y CURATED_ICONS tiene entrada y da una clave válida", () => {
  for (const e of [...OLD_CATEGORY_ICONS, ...OLD_CURATED_ICONS]) {
    const k = emojiKey(e);
    assert.ok(k in LEGACY_EMOJI, `${e} (${k}) sin entrada en LEGACY_EMOJI`);
    const target = LEGACY_EMOJI[k];
    assert.ok(Object.hasOwn(CAT_ICONS, target), `${e} → ${target}`);
  }
});

test("compat: los emojis con equivalente se traducen; los que no, se descartan y cae al icono de la familia", () => {
  assert.deepEqual(parseStyle(JSON.stringify({ "cat-x": { icon: "🐾" } })), { "cat-x": { icon: "huella" } });
  assert.deepEqual(parseStyle(JSON.stringify({ "cat-x": { icon: "🏠" } })), { "cat-x": { icon: "casa" } });
  assert.deepEqual(parseStyle(JSON.stringify({ "cat-x": { icon: "❤️‍🩹" } })), { "cat-x": { icon: "sal" } });
  assert.deepEqual(parseStyle(JSON.stringify({ "cat-x": { icon: "🎮" } })), { "cat-x": { icon: "mando" } });
  // Sin equivalente (un emoji que nunca estuvo en las listas): se descarta y cae a su familia.
  assert.deepEqual(parseStyle(JSON.stringify({ "cat-x": { icon: "🦄" } })), {});
  const byId = { "cat-x": { id: "cat-x", parent_id: "", flow: "expense" } };
  initCategoryStyle(parseStyle(JSON.stringify({ "cat-x": { color: "#E85F72", icon: "🦄" } })));
  assert.equal(familyForCategory("cat-x", byId), "reg");
  assert.equal(iconForCategory("cat-x", byId), "reg", "sin equivalente: icono de su familia");
});

test("compat: el formato nuevo {fam, icon} pasa intacto; si trae color y fam, manda fam", () => {
  const input = { "cat-casa": { fam: "oci", icon: "estrella" } };
  assert.deepEqual(parseStyle(JSON.stringify(input)), input);
  assert.deepEqual(parseStyle(JSON.stringify({ "cat-casa": { fam: "sal", color: "#5B9BFF" } })), { "cat-casa": { fam: "sal" } });
});

test("saneo: color o fam fuera de lista se descarta; el icono válido de la misma entrada se conserva", () => {
  assert.deepEqual(parseStyle(JSON.stringify({ "cat-casa": { color: "#123456", icon: "libro" } })), { "cat-casa": { icon: "libro" } });
  assert.deepEqual(parseStyle(JSON.stringify({ "cat-casa": { fam: "<script>", icon: "libro" } })), { "cat-casa": { icon: "libro" } });
  assert.deepEqual(parseStyle(JSON.stringify({ "cat-casa": { fam: "ali", icon: "<img onerror=x>" } })), { "cat-casa": { fam: "ali" } });
  assert.deepEqual(parseStyle(JSON.stringify({ "cat-casa": { icon: "income" } })), {}, "income no es un icono elegible");
});

test("saneo: un array o un valor no objeto se descarta entero → {}", () => {
  assert.deepEqual(parseStyle(JSON.stringify([{ fam: "ali" }])), {});
  initCategoryStyle([{ fam: "ali" }]);
  assert.equal(familyForCategory("cat-casa", SEED_BYID), "casa");
});

test("saneo: la clave __proto__ se ignora sin contaminar Object.prototype", () => {
  const malicious = JSON.parse('{"__proto__":{"fam":"ali","polluted":true},"cat-casa":{"fam":"oci"}}');
  initCategoryStyle(malicious);
  assert.equal(({}).polluted, undefined);
  assert.equal(({}).fam, undefined);
  assert.equal(familyForCategory("cat-casa", SEED_BYID), "oci");
});

test("parseStyle: try/catch seguro de JSON.parse", () => {
  assert.deepEqual(parseStyle(undefined), {});
  assert.deepEqual(parseStyle(null), {});
  assert.deepEqual(parseStyle(""), {});
  assert.deepEqual(parseStyle("no es json"), {});
  assert.deepEqual(parseStyle("{}"), {});
});

test("initCategoryStyle(undefined) no rompe — vuelve a {}", () => {
  initCategoryStyle({ "cat-casa": { fam: "oci" } });
  initCategoryStyle(undefined);
  assert.equal(familyForCategory("cat-casa", SEED_BYID), "casa");
});

// ---- Puente para las pantallas que aún no están migradas (PENDIENTES) ----------------------

test("colorForCategory: devuelve var() de la familia, nunca un hex", () => {
  assert.equal(colorForCategory("cat-casa", SEED_BYID), "var(--f-casa-b)");
  assert.equal(colorForCategory("cat-casa-luz", SEED_BYID), "var(--f-casa-b)");
  // Neutro del puente: --idle, el gris que las pantallas viejas mezclan al 16 % para el tinte (el
  // --well de C9 es el fondo de la ficha nueva, no un color para mezclar).
  assert.equal(colorForCategory("", SEED_BYID), "var(--idle)");
  assert.equal(colorForCategory("cat-nomina", SEED_BYID), "var(--idle)");
});

// ---- C13 en el propio módulo -----------------------------------------------------------------

test("C13: category-colors.js no lleva ningún hex con almohadilla ni rgba(, ni emoji", () => {
  const src = readFileSync(new URL("../../app/app/js/category-colors.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  assert.doesNotMatch(src, /\p{Extended_Pictographic}/u);
  for (const name of ["ROOT_COLORS", "TEXT_COLORS", "DEFAULT_COLOR", "POOL_TEXT"]) assert.ok(!src.includes(name), name);
});

test("CAT_ICON_KEYS coincide con las claves de icons.js#CAT_ICONS (sin dependencia entre módulos)", async () => {
  const { CAT_ICON_KEYS } = await import("../../app/app/js/category-colors.js");
  assert.deepEqual(CAT_ICON_KEYS, Object.keys(CAT_ICONS));
});

// ---- .fam-* en components.css (C6): los componentes solo leen --ft/--fb/--fx ----------------

test("components.css: una regla .fam-<k> por familia que expone --ft/--fb/--fx desde sus tokens", () => {
  const css = readFileSync(new URL("../../app/app/css/components.css", import.meta.url), "utf8");
  const tokens = readFileSync(new URL("../../app/app/css/tokens.css", import.meta.url), "utf8");
  for (const k of FAMILIES) {
    const m = css.match(new RegExp(`\\.fam-${k}\\s*\\{([^}]*)\\}`));
    assert.ok(m, `falta .fam-${k}`);
    const body = m[1].replace(/\s+/g, "").replace(/;$/, "");
    assert.equal(body, `--ft:var(--f-${k}-t);--fb:var(--f-${k}-b);--fx:var(--f-${k}-x)`, k);
    for (const p of ["t", "b", "x"]) assert.ok(tokens.includes(`--f-${k}-${p}:`), `tokens.css sin --f-${k}-${p}`);
  }
  assert.equal([...css.matchAll(/\.fam-[a-z]+\s*\{/g)].length, 12, "ni una familia de más");
});

test("compat: tabla emoji → icono fijada (Lucide para los que no tenían equivalente)", () => {
  const expect = {
    "🏠": "casa", "🛒": "ali", "🍽️": "res", "🚌": "tra", "🚗": "coc", "❤️‍🩹": "sal", "📺": "sus", "🎉": "oci",
    "👕": "rop", "🎁": "reg", "🧾": "imp", "▫️": "otr", "💶": "billete",
    "🐾": "huella", "🎓": "birrete", "✈️": "avion", "👶": "bebe", "💻": "portatil", "🎮": "mando", "🌱": "hoja", "📦": "paquete",
  };
  for (const [e, key] of Object.entries(expect)) assert.equal(LEGACY_EMOJI[emojiKey(e)], key, e);
});

test("búsquedas por clave: nombres heredados de Object.prototype no se toman por datos", () => {
  const byId = {
    toString: { id: "toString", parent_id: "", flow: "expense" },
    constructor: { id: "constructor", parent_id: "", flow: "expense" },
  };
  for (const id of ["toString", "constructor"]) {
    assert.ok(FAMILIES.includes(familyForCategory(id, byId)), `${id} → ${familyForCategory(id, byId)}`);
    assert.ok(Object.hasOwn(CAT_ICONS, iconForCategory(id, byId)), `${id} → ${iconForCategory(id, byId)}`);
  }
  assert.deepEqual(parseStyle(JSON.stringify({ "cat-x": { icon: "toString", fam: "constructor", color: "#toString" } })), {});
  assert.equal(emojiKey("toString") in LEGACY_EMOJI, false);
});
