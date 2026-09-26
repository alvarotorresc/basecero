/** Tema de la app (DESIGN.md §3): claro = sin atributo en <html>, oscuro = data-theme="dark".
 *  La preferencia es "light" | "dark" | "system" (por defecto) y vive en localStorage, no en la BD:
 *  el script en línea del <head> la lee antes de que carguen el CSS y los módulos, para que no
 *  haya destello de tema. Ese script NO puede importar este módulo, así que duplica readPref y
 *  resolveTheme; index-theme.test.mjs lo evalúa con la misma tabla de casos que theme.test.mjs.
 *
 *  Todo entra por parámetro (almacenamiento, document, MediaQueryList), como modal.js y toast.js,
 *  para probarlo en Node con dobles. */

export const THEME_KEY = "bc-theme";
export const THEME_PREFS = ["light", "dark", "system"];

const normalize = (v) => (THEME_PREFS.includes(v) ? v : "system");

/** El acceso a `localStorage` puede lanzar por sí solo (cookies bloqueadas): null en ese caso. */
export function getStorage(win) {
  try { return win.localStorage; } catch { return null; }
}

export function readPref(storage) {
  try { return normalize(storage.getItem(THEME_KEY)); } catch { return "system"; }
}

/** true si se guardó. Si el almacenamiento falla, el tema elegido vale para esta sesión y al
 *  recargar se aplica Sistema. */
export function writePref(storage, v) {
  try { storage.setItem(THEME_KEY, normalize(v)); return true; } catch { return false; }
}

export function resolveTheme(pref, prefersDark) {
  const p = normalize(pref);
  if (p === "system") return prefersDark ? "dark" : "light";
  return p;
}

function paint(doc, theme) {
  const root = doc.documentElement;
  if (theme === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
  // La barra de estado toma el --bg del tema activo. Sin CSS aplicado todavía, getPropertyValue da
  // "": entonces se deja el theme-color que haya en vez de vaciarlo.
  const meta = doc.querySelector('meta[name="theme-color"]');
  const bg = doc.defaultView.getComputedStyle(root).getPropertyValue("--bg").trim();
  if (meta && bg) meta.setAttribute("content", bg);
}

// Un listener de "change" por document como mucho: se suelta en cada applyTheme y solo se vuelve a
// poner con "system", así elegir Claro u Oscuro deja de seguir al sistema operativo.
const watchers = new WeakMap();

// Safari < 14 solo tiene addListener/removeListener en MediaQueryList.
const listen = (mql, fn) => (typeof mql.addEventListener === "function"
  ? mql.addEventListener("change", fn) : mql.addListener(fn));
const unlisten = (mql, fn) => (typeof mql.removeEventListener === "function"
  ? mql.removeEventListener("change", fn) : mql.removeListener(fn));

/** Aplica la preferencia y devuelve el tema resuelto ("light" | "dark"). `mql` es
 *  matchMedia("(prefers-color-scheme: dark)"), o null si el navegador no lo tiene. */
export function applyTheme(doc, pref, mql) {
  const prev = watchers.get(doc);
  if (prev) {
    unlisten(prev.mql, prev.onChange);
    watchers.delete(doc);
  }
  const theme = resolveTheme(pref, Boolean(mql?.matches));
  paint(doc, theme);
  if (normalize(pref) === "system" && mql) {
    const onChange = (e) => paint(doc, e.matches ? "dark" : "light");
    listen(mql, onChange);
    watchers.set(doc, { mql, onChange });
  }
  return theme;
}

/** matchMedia del modo oscuro del sistema, o null si el navegador no lo tiene. */
export function systemDarkQuery(win) {
  return typeof win.matchMedia === "function" ? win.matchMedia("(prefers-color-scheme: dark)") : null;
}
