// theme.js es puro: recibe el almacenamiento, el document y el MediaQueryList por parámetro (patrón
// de modal.js/toast.js) para probarlo en Node con dobles. Los casos de lectura son los mismos que
// evalúa index-theme.test.mjs sobre el script en línea del <head>.
import { test } from "node:test";
import assert from "node:assert/strict";
import { THEME_KEY, readPref, writePref, resolveTheme, applyTheme, getStorage, systemDarkQuery } from "../../app/app/js/theme.js";
import { THEME_CASES } from "./fixtures/theme-cases.mjs";

function fakeStorage({ stored = null, throws = false } = {}) {
  const data = new Map(stored === null ? [] : [[THEME_KEY, stored]]);
  return {
    data,
    getItem(k) { if (throws) throw new Error("SecurityError"); return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { if (throws) throw new Error("QuotaExceededError"); data.set(k, String(v)); },
  };
}

// --bg por tema, como lo devolvería getComputedStyle (con el espacio inicial que deja el parser).
function fakeDoc({ bg = { light: " #E3E1DC", dark: " #161719" }, meta = true } = {}) {
  const attrs = {};
  const root = {
    setAttribute(k, v) { attrs[k] = String(v); },
    removeAttribute(k) { delete attrs[k]; },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
  };
  const metaEl = { content: "#E3E1DC", setAttribute(k, v) { this[k] = v; } };
  return {
    attrs, metaEl, documentElement: root,
    querySelector: (sel) => (meta && sel === 'meta[name="theme-color"]' ? metaEl : null),
    defaultView: {
      getComputedStyle: (el) => ({
        getPropertyValue: (name) => (el === root && name === "--bg" ? bg[attrs["data-theme"] ?? "light"] : ""),
      }),
    },
  };
}

function fakeMql(matches) {
  const listeners = [];
  return {
    matches, listeners,
    addEventListener(type, fn) { if (type === "change") listeners.push(fn); },
    removeEventListener(type, fn) { const i = listeners.indexOf(fn); if (type === "change" && i >= 0) listeners.splice(i, 1); },
    fire(m) { this.matches = m; for (const fn of [...listeners]) fn({ matches: m }); },
  };
}

test("THEME_KEY es bc-theme", () => {
  assert.equal(THEME_KEY, "bc-theme");
});

test("resolveTheme: los 3 valores × modo del sistema, y lo desconocido cuenta como sistema", () => {
  assert.equal(resolveTheme("light", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("dark", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("sepia", true), "dark");
});

for (const c of THEME_CASES) {
  test(`readPref + resolveTheme: ${c.name}`, () => {
    const pref = readPref(fakeStorage(c));
    assert.ok(["light", "dark", "system"].includes(pref));
    assert.equal(resolveTheme(pref, c.prefersDark), c.dark ? "dark" : "light");
  });
}

test("readPref: lo que no es light/dark/system, o no hay storage, es system", () => {
  assert.equal(readPref(fakeStorage({ stored: "sepia" })), "system");
  assert.equal(readPref(fakeStorage({ throws: true })), "system");
  assert.equal(readPref(null), "system");
});

test("writePref: guarda bajo bc-theme y un storage que lanza no rompe nada", () => {
  const s = fakeStorage();
  assert.equal(writePref(s, "dark"), true);
  assert.equal(s.data.get("bc-theme"), "dark");
  assert.equal(writePref(fakeStorage({ throws: true }), "dark"), false);
  assert.equal(writePref(null, "dark"), false);
});

test("writePref: un valor desconocido se guarda como system", () => {
  const s = fakeStorage();
  writePref(s, "sepia");
  assert.equal(s.data.get("bc-theme"), "system");
});

test("getStorage: devuelve localStorage, o null si el propio acceso lanza", () => {
  const ls = fakeStorage();
  assert.equal(getStorage({ localStorage: ls }), ls);
  const bloqueado = { get localStorage() { throw new Error("SecurityError"); } };
  assert.equal(getStorage(bloqueado), null);
  assert.equal(readPref(getStorage(bloqueado)), "system");
});

test("applyTheme: oscuro pone data-theme=dark y theme-color con el --bg oscuro", () => {
  const doc = fakeDoc();
  assert.equal(applyTheme(doc, "dark", fakeMql(false)), "dark");
  assert.equal(doc.attrs["data-theme"], "dark");
  assert.equal(doc.metaEl.content, "#161719");
});

test("applyTheme: claro quita data-theme y theme-color vuelve al --bg claro", () => {
  const doc = fakeDoc();
  applyTheme(doc, "dark", fakeMql(false));
  assert.equal(applyTheme(doc, "light", fakeMql(true)), "light");
  assert.equal(doc.documentElement.getAttribute("data-theme"), null);
  assert.equal(doc.metaEl.content, "#E3E1DC");
});

test("applyTheme: sistema sigue al MediaQueryList", () => {
  const doc = fakeDoc();
  assert.equal(applyTheme(doc, "system", fakeMql(true)), "dark");
  assert.equal(doc.attrs["data-theme"], "dark");
});

test("applyTheme: escucha change SOLO con sistema, y cambia en caliente", () => {
  const doc = fakeDoc();
  const mql = fakeMql(false);
  applyTheme(doc, "system", mql);
  assert.equal(mql.listeners.length, 1);
  mql.fire(true);
  assert.equal(doc.attrs["data-theme"], "dark");
  assert.equal(doc.metaEl.content, "#161719");
  mql.fire(false);
  assert.equal(doc.attrs["data-theme"], undefined);
  assert.equal(doc.metaEl.content, "#E3E1DC");
});

test("applyTheme: al dejar sistema se suelta el listener y el SO ya no manda", () => {
  const doc = fakeDoc();
  const mql = fakeMql(false);
  applyTheme(doc, "system", mql);
  applyTheme(doc, "light", mql);
  assert.equal(mql.listeners.length, 0);
  mql.fire(true);
  assert.equal(doc.attrs["data-theme"], undefined);
});

test("applyTheme: sistema dos veces no acumula listeners, ni con otro MediaQueryList", () => {
  const doc = fakeDoc();
  const a = fakeMql(false);
  const b = fakeMql(false);
  applyTheme(doc, "system", a);
  applyTheme(doc, "system", a);
  assert.equal(a.listeners.length, 1);
  applyTheme(doc, "system", b);
  assert.equal(a.listeners.length, 0);
  assert.equal(b.listeners.length, 1);
});

test("applyTheme: sin --bg calculado (CSS aún sin aplicar) no vacía theme-color", () => {
  const doc = fakeDoc({ bg: { light: "", dark: "  " } });
  applyTheme(doc, "dark", fakeMql(false));
  assert.equal(doc.metaEl.content, "#E3E1DC");
});

test("applyTheme: sin <meta name=theme-color> ni matchMedia no lanza", () => {
  const doc = fakeDoc({ meta: false });
  assert.equal(applyTheme(doc, "system", null), "light");
  assert.equal(applyTheme(doc, "dark", null), "dark");
});

test("systemDarkQuery: pide prefers-color-scheme: dark, o null si no hay matchMedia", () => {
  const q = [];
  const mql = systemDarkQuery({ matchMedia: (s) => { q.push(s); return { matches: true }; } });
  assert.deepEqual(q, ["(prefers-color-scheme: dark)"]);
  assert.equal(mql.matches, true);
  assert.equal(systemDarkQuery({}), null);
});
