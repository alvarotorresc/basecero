// El repertorio de §3 es una tabla de paths: si uno se desvía, el icono deja de ser el del
// sistema y nadie lo nota mirando la pantalla. Estos asserts son la tabla, escrita en código.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ICON_PATHS, icon } from "../../app/app/js/icons.js";

test("icons: los paths críticos son los de SISTEMA.md §3, verbatim", () => {
  assert.equal(ICON_PATHS.back, '<path d="M15 5 8 12l7 7"/>');
  assert.equal(ICON_PATHS.close, '<path d="M6 6l12 12M18 6 6 18"/>');
  assert.equal(ICON_PATHS.plus, '<path d="M12 5v14M5 12h14"/>');
  assert.equal(ICON_PATHS.check, '<path d="M5 12.5 10 17.5 19 7"/>');
  assert.equal(ICON_PATHS.filter, '<path d="M4 6h16l-6.2 7.2V19l-3.6-2v-3.8z"/>');
  assert.equal(ICON_PATHS.trendUp, '<path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/>');
  assert.equal(ICON_PATHS.trendDown, '<path d="M12 5v13M6.5 12.5 12 18l5.5-5.5"/>');
  assert.equal(ICON_PATHS.chevronRight, '<path d="M9.5 5 16 12l-6.5 7"/>');
  assert.equal(ICON_PATHS.chevronDown, '<path d="M5 9.5 12 16l7-6.5"/>');
  assert.equal(ICON_PATHS.trash, '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>');
  assert.equal(ICON_PATHS.download, '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15"/>');
});

test("icons: el repertorio cubre todo lo que emite la app", () => {
  for (const name of ["back", "close", "chevronRight", "chevronDown", "plus", "minus", "check",
    "warn", "tag", "calendar", "download", "trash", "pencil", "repeat", "filter", "lock",
    "trendUp", "trendDown", "camera", "mic", "drag", "file", "transfer"]) {
    assert.ok(ICON_PATHS[name], `falta el icono ${name}`);
  }
});

test("icons: ningún path es el «atrás» que NO está en el repertorio", () => {
  // M19 12H5M12 19l-7-7 7-7 es la flecha con línea horizontal que hoy usan 11 ficheros y que
  // §3 no lista. Si vuelve a colarse, este test lo caza.
  for (const d of Object.values(ICON_PATHS)) assert.ok(!d.includes("M19 12H5"));
});

test("icon(): SVG del sistema — viewBox, fill none, stroke 1.75, aria-hidden", () => {
  const svg = icon("back");
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.match(svg, /fill="none"/);
  assert.match(svg, /stroke="currentColor"/);
  assert.match(svg, /stroke-width="1.75"/);
  assert.match(svg, /stroke-linecap="round"/);
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /width="20" height="20"/);
});

test("icon(): tamaño, grosor y color se pueden forzar donde el artboard los fuerza", () => {
  assert.match(icon("check", { size: 16, width: 2.6, stroke: "#14180B" }),
    /width="16" height="16".*stroke="#14180B".*stroke-width="2.6"/s);
});

test("icon(): un nombre inexistente devuelve cadena vacía y no lanza", () => {
  assert.equal(icon("noExiste"), "");
});
