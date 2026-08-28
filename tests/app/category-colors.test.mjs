import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  colorForCategory,
  textColorForCategory,
  iconForCategory,
  initCategoryStyle,
  parseStyle,
  hashIndex,
  POOL,
  CURATED_ICONS,
} from "../../app/js/category-colors.js";

const DEFAULT_COLOR = "#9A99A6";

const POOL_TEXT = {
  "#629D3B": "#7FB554", "#6B61C2": "#8A82D6", "#A09600": "#BDB32A", "#9153AB": "#AB74C4",
  "#15AC7D": "#3DC299", "#986603": "#B2802A", "#12A7A7": "#3FBDBD", "#B45018": "#D97742",
  "#00A1CB": "#3FB7DC", "#AA4985": "#C4699F", "#4F94E9": "#6FA8F0", "#B64656": "#CD6472",
};

// Reset del estado module-level entre tests para que no se filtren overrides.
beforeEach(() => {
  initCategoryStyle({});
});

test("category-colors: paridad de seeds — sin overrides, las 14 raíces + iconos rinden los valores actuales", () => {
  const byId = {
    "cat-casa": { id: "cat-casa", parent_id: "" },
    "cat-alimentacion": { id: "cat-alimentacion", parent_id: "" },
    "cat-restauracion": { id: "cat-restauracion", parent_id: "" },
    "cat-transporte": { id: "cat-transporte", parent_id: "" },
    "cat-coche": { id: "cat-coche", parent_id: "" },
    "cat-salud": { id: "cat-salud", parent_id: "" },
    "cat-suscripciones": { id: "cat-suscripciones", parent_id: "" },
    "cat-ocio": { id: "cat-ocio", parent_id: "" },
    "cat-ropa": { id: "cat-ropa", parent_id: "" },
    "cat-regalos": { id: "cat-regalos", parent_id: "" },
    "cat-impuestos": { id: "cat-impuestos", parent_id: "" },
    "cat-nomina": { id: "cat-nomina", parent_id: "" },
    "cat-puntuales": { id: "cat-puntuales", parent_id: "" },
    "cat-intereses": { id: "cat-intereses", parent_id: "" },
    "cat-casa-luz": { id: "cat-casa-luz", parent_id: "cat-casa" },
    "cat-otros": { id: "cat-otros", parent_id: "" },
  };

  const expectedColors = {
    "cat-casa": "#4F94E9",
    "cat-alimentacion": "#629D3B",
    "cat-restauracion": "#B45018",
    "cat-transporte": "#00A1CB",
    "cat-coche": "#986603",
    "cat-salud": "#12A7A7",
    "cat-suscripciones": "#9153AB",
    "cat-ocio": "#6B61C2",
    "cat-ropa": "#B64656",
    "cat-regalos": "#AA4985",
    "cat-impuestos": "#A09600",
    "cat-nomina": "#15AC7D",
    "cat-puntuales": "#15AC7D",
    "cat-intereses": "#15AC7D",
  };

  const expectedTextColors = {
    "cat-casa": "#6FA8F0",
    "cat-alimentacion": "#7FB554",
    "cat-restauracion": "#D97742",
    "cat-transporte": "#3FB7DC",
    "cat-coche": "#B2802A",
    "cat-salud": "#3FBDBD",
    "cat-suscripciones": "#AB74C4",
    "cat-ocio": "#8A82D6",
    "cat-ropa": "#CD6472",
    "cat-regalos": "#C4699F",
    "cat-impuestos": "#BDB32A",
    "cat-nomina": "#3DC299",
    "cat-puntuales": "#3DC299",
    "cat-intereses": "#3DC299",
  };

  const expectedIcons = {
    "cat-casa": "🏠", "cat-alimentacion": "🛒", "cat-restauracion": "🍽️", "cat-transporte": "🚌",
    "cat-coche": "🚗", "cat-salud": "❤️‍🩹", "cat-suscripciones": "📺", "cat-ocio": "🎉",
    "cat-ropa": "👕", "cat-regalos": "🎁", "cat-impuestos": "🧾", "cat-otros": "▫️",
    "cat-nomina": "💶", "cat-puntuales": "💶", "cat-intereses": "💶",
  };

  // Las 14 raíces devuelven su color/tinte/icono exactos (sin initCategoryStyle, o con {}).
  for (const [catId, expectedColor] of Object.entries(expectedColors)) {
    assert.equal(colorForCategory(catId, byId), expectedColor, `${catId} debe ser ${expectedColor}`);
  }
  for (const [catId, expectedTextColor] of Object.entries(expectedTextColors)) {
    assert.equal(textColorForCategory(catId, byId), expectedTextColor, `${catId} debe tener texto ${expectedTextColor}`);
  }
  for (const [catId, expectedIcon] of Object.entries(expectedIcons)) {
    assert.equal(iconForCategory(catId, byId), expectedIcon, `${catId} debe tener icono ${expectedIcon}`);
  }

  // Una hija hereda color/tinte/icono de su raíz
  assert.equal(colorForCategory("cat-casa-luz", byId), "#4F94E9", "cat-casa-luz debe heredar el color de cat-casa");
  assert.equal(textColorForCategory("cat-casa-luz", byId), "#6FA8F0", "cat-casa-luz debe heredar el tinte de texto de cat-casa");
  assert.equal(iconForCategory("cat-casa-luz", byId), "🏠", "cat-casa-luz debe heredar el icono de cat-casa");

  // cat-otros cae a DEFAULT_COLOR (no está en ROOT_COLORS ni en el hash: NEUTRAL_IDS lo intercepta)
  assert.equal(colorForCategory("cat-otros", byId), DEFAULT_COLOR, "cat-otros debe devolver DEFAULT_COLOR");
  assert.equal(textColorForCategory("cat-otros", byId), DEFAULT_COLOR, "cat-otros debe devolver DEFAULT_COLOR para textColorForCategory");

  // CURATED_ICONS: los 8 iconos ofrecidos en el selector de icono
  assert.equal(CURATED_ICONS.length, 8, "CURATED_ICONS debe tener 8 entradas");
});

test("category-colors: id sin seed (no cat-otros) ya NO cae a DEFAULT_COLOR — se resuelve por hash sobre el pool", () => {
  const byId = { "cat-desconocida": { id: "cat-desconocida", parent_id: "" } };
  // hashIndex("cat-desconocida") calculado al implementar: 2 (literal, ver test de estabilidad más abajo)
  assert.equal(colorForCategory("cat-desconocida", byId), POOL[2], "cat-desconocida debe resolver por hash, no por DEFAULT_COLOR");
  assert.equal(textColorForCategory("cat-desconocida", byId), POOL_TEXT[POOL[2]], "cat-desconocida debe tener el tinte de texto del color hasheado");
});

test("category-colors: category_id='' (sin categorizar / transferencias) se queda en gris, no hashea", () => {
  // schema.sql: category_id TEXT NOT NULL DEFAULT '' — id real de "sin categorizar" que llega
  // sin guardar a colorForCategory/textColorForCategory en varios call sites (p.ej. inicio.js
  // txRowHtml, para transacciones importadas aún sin categorizar). Debe seguir gris como antes
  // del hash, no un color aleatorio del pool.
  const byId = {};
  assert.equal(colorForCategory("", byId), DEFAULT_COLOR, "category_id vacío debe seguir en DEFAULT_COLOR");
  assert.equal(textColorForCategory("", byId), DEFAULT_COLOR, "category_id vacío debe seguir en DEFAULT_COLOR para el texto");
});

test("category-colors: override de usuario tiene precedencia sobre seeds y aplica a las hijas", () => {
  initCategoryStyle({ "cat-casa": { color: "#B45018", icon: "🐾" } });

  const byId = {
    "cat-casa": { id: "cat-casa", parent_id: "" },
    "cat-casa-luz": { id: "cat-casa-luz", parent_id: "cat-casa" },
  };

  assert.equal(colorForCategory("cat-casa", byId), "#B45018", "cat-casa debe usar el color del override");
  assert.equal(iconForCategory("cat-casa", byId), "🐾", "cat-casa debe usar el icono del override");
  // El tinte de texto SIEMPRE sale del pool: POOL_TEXT del color elegido (que pertenece al pool)
  assert.equal(textColorForCategory("cat-casa", byId), "#D97742", "cat-casa debe tener el tinte de texto del color del pool elegido");

  // Las hijas heredan el override vía rootOf
  assert.equal(colorForCategory("cat-casa-luz", byId), "#B45018", "cat-casa-luz debe heredar el override de cat-casa");
  assert.equal(iconForCategory("cat-casa-luz", byId), "🐾", "cat-casa-luz debe heredar el icono del override de cat-casa");
  assert.equal(textColorForCategory("cat-casa-luz", byId), "#D97742", "cat-casa-luz debe heredar el tinte de texto del override de cat-casa");
});

test("category-colors: override con color corrupto (fuera del pool) cae a DEFAULT_COLOR en el texto", () => {
  initCategoryStyle({ "cat-casa": { color: "#123456" } });
  const byId = { "cat-casa": { id: "cat-casa", parent_id: "" } };
  assert.equal(colorForCategory("cat-casa", byId), "#123456", "colorForCategory respeta el override aunque no esté en el pool");
  assert.equal(textColorForCategory("cat-casa", byId), DEFAULT_COLOR, "textColorForCategory cae a DEFAULT_COLOR si el color no está en el pool");
});

test("category-colors: categoría nueva sin override (cat-mascotas) resuelve por hash — índice y color fijados, no recalculados", () => {
  const byId = { "cat-mascotas": { id: "cat-mascotas", parent_id: "" } };
  // hashIndex("cat-mascotas") calculado al implementar el algoritmo: 3 → POOL[3] = "#9153AB".
  // Ambos literales a propósito (no se llama a hashIndex ni se indexa POOL aquí) para que un
  // cambio de algoritmo O un reordenamiento de POOL ("orden fijo") rompan este test.
  assert.equal(colorForCategory("cat-mascotas", byId), "#9153AB", "cat-mascotas debe resolver a POOL[3] = #9153AB");
});

test("category-colors: hashIndex es estable para un conjunto fijo de ids", () => {
  assert.equal(hashIndex("cat-mascotas"), 3);
  assert.equal(hashIndex("cat-viajes"), 4);
  assert.equal(hashIndex("cat-foo"), 0);
});

test("category-colors: initCategoryStyle(undefined) no rompe — vuelve a {}", () => {
  initCategoryStyle({ "cat-casa": { color: "#B45018" } });
  initCategoryStyle(undefined);
  const byId = { "cat-casa": { id: "cat-casa", parent_id: "" } };
  assert.equal(colorForCategory("cat-casa", byId), "#4F94E9", "sin overrides, cat-casa debe volver a su color de seed");
});

test("category-colors: parseStyle hace try/catch seguro de JSON.parse", () => {
  assert.deepEqual(parseStyle(undefined), {});
  assert.deepEqual(parseStyle(null), {});
  assert.deepEqual(parseStyle(""), {});
  assert.deepEqual(parseStyle("no es json"), {});
  assert.deepEqual(parseStyle("{}"), {});
  assert.deepEqual(parseStyle('{"cat-casa":{"color":"#B45018"}}'), { "cat-casa": { color: "#B45018" } });
});
