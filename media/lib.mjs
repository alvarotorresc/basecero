// ===== Librería común de media/ =====
//
// Imágenes de producto de BaseCero (galería, portadas, promo, og) hechas con Playwright contra la
// app servida en local. No toca la app: solo la sirve y la fotografía.
//
//   loadPlaywright() -- Playwright del repo o, si no está instalado aquí, el de PLAYWRIGHT_FROM.
//   startServer()    -- servidor estático propio: app/ en la raíz (como en Vercel) y media/ en /media/.
//   guards()         -- las guardas de una captura antes de escribirla.

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, basename } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(AQUI, "..");
export const APP_ROOT = join(REPO_ROOT, "app");
export const MEDIA = AQUI;
export const OUT = join(AQUI, "out");
export const WEB_IMG = join(APP_ROOT, "img");

// ---------- Playwright ----------
// Primero el paquete normal (si alguien hace `npm i playwright` en el repo o en media/); si no,
// el node_modules que diga PLAYWRIGHT_FROM (por defecto, el del checkout principal de BaseCero).
export async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const from = process.env.PLAYWRIGHT_FROM
      ?? join(process.env.HOME ?? "", "Documents/apps/BaseCero/node_modules");
    const req = createRequire(join(from, "noop.js"));
    return req("playwright");
  }
}

// ---------- Servidor estático ----------
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm", ".woff2": "font/woff2", ".svg": "image/svg+xml",
  ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon", ".jpg": "image/jpeg",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".txt": "text/plain",
};

async function resolveFile(root, urlPath) {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, "");
  if (rel.startsWith("..")) return null;
  let p = join(root, rel);
  try {
    const s = await stat(p);
    // trailingSlash: true en vercel.json: /app/ sirve app/index.html
    if (s.isDirectory()) p = join(p, "index.html");
    await stat(p);
    return p;
  } catch {
    return null;
  }
}

export async function startServer(port = 8093) {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const file = path.startsWith("/media/")
      ? await resolveFile(MEDIA, path.slice("/media/".length))
      : await resolveFile(APP_ROOT, path);
    if (!file) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(await readFile(file));
  });
  await new Promise((ok, ko) => { server.once("error", ko); server.listen(port, "127.0.0.1", ok); });
  return {
    url: `http://localhost:${port}`,
    stop: () => new Promise((ok) => server.close(ok)),
  };
}

// ---------- Congelar movimiento ----------
// La app respeta prefers-reduced-motion, pero esto lleva cualquier animación a su fotograma final
// y quita el blur de la barra de pestañas, que da dos resultados distintos entre capturas.
export const FREEZE_CSS = `
*, *::before, *::after {
  animation-delay: -1ms !important; animation-duration: 1ms !important;
  animation-iteration-count: 1 !important; transition-duration: 0s !important;
  transition-delay: 0s !important; scroll-behavior: auto !important; caret-color: transparent !important;
}
.tabbar { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
`;

export async function addFreeze(context) {
  await context.addInitScript((css) => {
    const put = () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", put, { once: true });
    else put();
  }, FREEZE_CSS);
}

// ---------- Guardas ----------
export function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function falla(name, guarda) {
  throw new Error(`${name}: guarda «${guarda}» no ha pasado`);
}

// Marcas de texto que no pueden aparecer en una captura EN (interfaz a medio traducir).
const ES_MARKERS = /\b(Inicio|Movimientos|Patrimonio|Ajustes|Ahorras|Gasto por categoría|Semana|Guardar)\b/;
const EN_MARKERS = /\b(Home|Transactions|Net worth|Settings)\b/;

export async function guards(page, name, { width, height, theme, lang }) {
  const sk = await page.evaluate(() => document.querySelectorAll(".skeleton, .skeleton-stack").length);
  if (sk) falla(name, "sin-esqueletos");
  const dark = await page.evaluate(() => document.documentElement.getAttribute("data-theme") === "dark");
  if (dark !== (theme === "dark")) falla(name, "tema");
  const text = await page.evaluate(() => document.body.innerText);
  if (/undefined|NaN|\[object/.test(text)) falla(name, "texto-roto");
  if (lang === "en" && ES_MARKERS.test(text)) falla(name, `idioma (${text.match(ES_MARKERS)[0]})`);
  if (lang === "es" && EN_MARKERS.test(text)) falla(name, `idioma (${text.match(EN_MARKERS)[0]})`);
  const err = await page.evaluate(() => document.querySelectorAll(".banner-aviso.is-error").length);
  if (err) falla(name, "sin-aviso-de-error");

  const a = await page.screenshot();
  const b = await page.screenshot();
  const h = (x) => createHash("sha256").update(x).digest("hex");
  if (h(a) !== h(b)) falla(name, "hash-estable");
  const s = pngSize(a);
  if (s.width !== width || s.height !== height) falla(name, `dimensiones ${s.width}x${s.height}`);
  return a;
}

export async function writeOut(path, buf) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf);
  return basename(path);
}
