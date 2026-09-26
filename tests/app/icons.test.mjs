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
    "trendUp", "trendDown", "camera", "mic", "drag", "file", "transfer",
    // Filas de Ajustes (S4, B-Ajustes)
    "people", "split", "periodNext", "theme", "bolt", "currency", "format", "globe", "screen",
    "grid", "table", "bank", "chart"]) {
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

// ---- Iconos de categoría (PR-04): 12 de familia + 6 del selector de B-Categorias-Nueva ----------
import { CAT_ICONS, catIcon } from "../../app/app/js/icons.js";

test("CAT_ICONS: los 12 de familia, los 6 del selector y los 6 de Lucide, en ese orden", () => {
  assert.deepEqual(Object.keys(CAT_ICONS), [
    "casa", "ali", "res", "tra", "coc", "sal", "sus", "oci", "rop", "reg", "imp", "otr",
    "huella", "hoja", "libro", "nota", "avion", "estrella",
    "billete", "bebe", "portatil", "mando", "paquete", "birrete",
  ]);
});

test("CAT_ICONS: los 6 de Lucide (ISC) se copian tal cual de lucide-static 1.48.0", () => {
  assert.equal(CAT_ICONS.billete, '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>');
  assert.equal(CAT_ICONS.birrete, '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>');
  for (const k of ["billete", "bebe", "portatil", "mando", "paquete", "birrete"]) assert.match(CAT_ICONS[k], /^<(path|rect|line|circle|polyline)/, k);
});

test("catIcon(): una clave heredada de Object.prototype no se toma por icono", () => {
  for (const k of ["toString", "constructor", "__proto__", "hasOwnProperty"]) assert.equal(catIcon(k), catIcon("otr"), k);
});

test("CAT_ICONS: los d se copian tal cual de B-Gasto y B-Categorias-Nueva", () => {
  assert.equal(CAT_ICONS.casa, '<path d="M4 11l8-6.5 8 6.5v8.5a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>');
  assert.equal(CAT_ICONS.sal, '<path d="M3 12h4l2-4 3 8 2-4h7"/>');
  assert.equal(CAT_ICONS.otr, '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>');
  assert.equal(CAT_ICONS.hoja, '<path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14zM5 19l7-7"/>');
  assert.equal(CAT_ICONS.estrella, '<path d="M12 4l2.5 5.2 5.5.7-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.5-.7z"/>');
});

test("catIcon(): SVG de trazo con currentColor; income y tag también se resuelven", () => {
  const svg = catIcon("casa");
  assert.match(svg, /^<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"/);
  assert.match(svg, /aria-hidden="true"/);
  assert.match(catIcon("oci", { size: 14, cls: "x" }), /width="14" height="14".*class="x"/s);
  assert.match(catIcon("income"), /M12 19V5M6 11l6-6 6 6/);
  assert.match(catIcon("tag"), /M3.5 12.5V4.5h8l9 9-8 8z/);
});

test("catIcon(): con label deja de ser decorativo (role img + aria-label escapado)", () => {
  const svg = catIcon("libro", { label: 'Li"bro' });
  assert.match(svg, /role="img" aria-label="Li&quot;bro"/);
  assert.doesNotMatch(svg, /aria-hidden/);
});

test("catIcon(): una clave desconocida devuelve el icono de Otros, no rompe la fila", () => {
  assert.equal(catIcon("noExiste"), catIcon("otr"));
});
