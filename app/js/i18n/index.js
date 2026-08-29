// i18n de BaseCero (v1.1): diccionarios planos por idioma con t(key, params).
// SIN imports de db/repo/DOM: puro, importable desde tests de Node y desde repo.js.
// t() NO escapa: los valores del diccionario son attribute-safe por contrato (test lo
// escanea) y los params llegan ya escapados por el llamante (criterio de todo el repo).
// Los meses/iniciales van en arrays fijos por idioma, no Intl: la deriva de ICU está
// documentada en repo.js (Node 22 da "sept" para septiembre con month:"short").
import { ES } from "./es.js";
import { EN } from "./en.js";

const DICTS = { es: ES, en: EN };
let lang = "es";

export const LANGS = [["es", "Español"], ["en", "English"]];
export const activeLang = () => lang;

const norm = (l) => (l === "en" || l === "es" ? l : null);

/** Antes de abrir la BD (banners de arranque): solo navigator. */
export function initI18nFromNavigator() {
  lang = norm(String(globalThis.navigator?.language ?? "").slice(0, 2)) ?? "es";
  return lang;
}

/** Con meta ya leída: meta.lang elegido manda; vacío → navigator; inválido → es. */
export function initI18n(meta) {
  lang = norm(meta?.lang) ?? initI18nFromNavigator();
  return lang;
}

const lookup = (dict, key) => key.split(".").reduce((o, k) => (o == null ? o : o[k]), dict);
const fill = (s, params) => s.replace(/\{(\w+)\}/g, (m, k) => (params && k in params ? String(params[k]) : m));

export function t(key, params) {
  const v = lookup(DICTS[lang], key) ?? lookup(DICTS.es, key);
  if (v == null) return key;
  if (typeof v === "string") return fill(v, params);
  return fill(params?.n === 1 ? v.one : v.other, params);
}

export const monthShort = (i) => t("i18n.months." + i);
export const weekdayInitial = (d) => t("i18n.weekdays." + d);
