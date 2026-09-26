// Tabla compartida por theme.test.mjs (js/theme.js) y index-theme.test.mjs (el script en línea del
// <head>): las dos copias de la lógica de tema tienen que dar lo mismo en los mismos casos.
// stored: lo que hay en localStorage bajo "bc-theme" (null = nada) · throws: el acceso al
// almacenamiento lanza (modo privado, cookies bloqueadas) · prefersDark: el modo del sistema.
export const THEME_CASES = [
  { name: "claro guardado, sistema claro", stored: "light", prefersDark: false, dark: false },
  { name: "claro guardado, sistema oscuro", stored: "light", prefersDark: true, dark: false },
  { name: "oscuro guardado, sistema claro", stored: "dark", prefersDark: false, dark: true },
  { name: "oscuro guardado, sistema oscuro", stored: "dark", prefersDark: true, dark: true },
  { name: "sistema guardado, sistema claro", stored: "system", prefersDark: false, dark: false },
  { name: "sistema guardado, sistema oscuro", stored: "system", prefersDark: true, dark: true },
  { name: "nada guardado, sistema oscuro", stored: null, prefersDark: true, dark: true },
  { name: "valor basura, sistema oscuro", stored: "sepia", prefersDark: true, dark: true },
  { name: "storage que lanza, sistema oscuro", throws: true, prefersDark: true, dark: true },
  { name: "storage que lanza, sistema claro", throws: true, prefersDark: false, dark: false },
];
