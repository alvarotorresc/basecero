import { test } from "node:test";
import assert from "node:assert/strict";
import { colorForCategory, textColorForCategory } from "../../app/js/category-colors.js";

test("category-colors: paleta validada de 12 colores + tintes de texto", () => {
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

  // Las 12 raíces devuelven su color exacto
  for (const [catId, expectedColor] of Object.entries(expectedColors)) {
    assert.equal(
      colorForCategory(catId, byId),
      expectedColor,
      `${catId} debe ser ${expectedColor}`
    );
  }

  // Una hija hereda el color de su raíz
  assert.equal(
    colorForCategory("cat-casa-luz", byId),
    "#4F94E9",
    "cat-casa-luz debe heredar el color de cat-casa"
  );

  // id desconocido devuelve DEFAULT_COLOR
  const defaultColor = "#9A99A6";
  assert.equal(
    colorForCategory("cat-desconocida", byId),
    defaultColor,
    "id desconocida debe devolver DEFAULT_COLOR"
  );

  // cat-otros cae a DEFAULT_COLOR (no está en ROOT_COLORS)
  assert.equal(
    colorForCategory("cat-otros", byId),
    defaultColor,
    "cat-otros debe devolver DEFAULT_COLOR"
  );

  // textColorForCategory: las 12 raíces devuelven su variante aclarada
  for (const [catId, expectedTextColor] of Object.entries(expectedTextColors)) {
    assert.equal(
      textColorForCategory(catId, byId),
      expectedTextColor,
      `${catId} debe tener texto ${expectedTextColor}`
    );
  }

  // Una hija hereda el tinte de texto de su raíz
  assert.equal(
    textColorForCategory("cat-casa-luz", byId),
    "#6FA8F0",
    "cat-casa-luz debe heredar el tinte de texto de cat-casa"
  );

  // id desconocido devuelve DEFAULT_COLOR
  assert.equal(
    textColorForCategory("cat-desconocida", byId),
    defaultColor,
    "id desconocida debe devolver DEFAULT_COLOR para textColorForCategory"
  );
});
