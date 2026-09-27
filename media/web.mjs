// ===== Copias web y hoja de contacto =====
//
// Orden de uso: shots -> compose -> web. Parte de los PNG de media/out/ y escribe:
//   app/img/shots/{es,en}/NN-*.webp, app/img/cover-*.webp, cover-mobile-*.webp, promo-*.webp
//   app/img/og-{es,en}.png            (el og va en PNG: no todas las redes leen webp)
//   media/.cache/hoja-contacto.jpg    (todo junto para revisar: 1200 px de ancho, < 1,5 MB)
//
// El webp lo codifica el propio Chromium (canvas.toBlob), sin dependencias nuevas. La galería se
// reduce a 780 px de ancho para la web (la fuente a 1080 queda en media/out/ para la ficha).

import { readFile, writeFile, mkdir, copyFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadPlaywright, startServer, OUT, WEB_IMG, MEDIA } from "./lib.mjs";

const LANGS = ["es", "en"];
const SHOTS = ["01-inicio", "02-registro", "03-movimientos", "04-gasto-categoria", "05-patrimonio", "06-informe"];
const QUALITY = 0.86;

// [fuente en media/out, destino en app/img, ancho de salida]
const JOBS = [];
for (const l of LANGS) {
  for (const s of SHOTS) JOBS.push([`shots/${l}/${s}.png`, `shots/${l}/${s}.webp`, 780]);
  JOBS.push([`cover-${l}.png`, `cover-${l}.webp`, 1600]);
  JOBS.push([`cover-mobile-${l}.png`, `cover-mobile-${l}.webp`, 780]);
  JOBS.push([`promo-${l}.png`, `promo-${l}.webp`, 1920]);
}

async function toWebp(page, pngPath, width) {
  const b64 = (await readFile(pngPath)).toString("base64");
  const out = await page.evaluate(async ({ b64, width, q }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const w = Math.min(width, img.naturalWidth);
    const h = Math.round(img.naturalHeight * (w / img.naturalWidth));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((r) => c.toBlob(r, "image/webp", q));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, { b64, width, q: QUALITY });
  return Buffer.from(out, "base64");
}

const SHEET_W = 1200;
const SHEET_MAX = 1.5 * 1024 * 1024;

function sheetHtml() {
  const cell = (src, label, span = 1) => `<figure style="grid-column:span ${span}"><img src="/media/out/${src}"><figcaption>${label}</figcaption></figure>`;
  const rows = [];
  for (const l of LANGS) {
    rows.push(`<h2>${l.toUpperCase()} · galería (1080×2340)</h2><div class="g6">${SHOTS.map((s) => cell(`shots/${l}/${s}.png`, s)).join("")}</div>`);
  }
  for (const l of LANGS) {
    rows.push(`<h2>${l.toUpperCase()} · cover 1600×1000 · cover-mobile 1080×2340 · promo 1920×1080 · og 1200×630</h2>
      <div class="gx">${cell(`cover-${l}.png`, `cover-${l}`)}${cell(`cover-mobile-${l}.png`, `cover-mobile-${l}`)}${cell(`promo-${l}.png`, `promo-${l}`)}${cell(`og-${l}.png`, `og-${l}`)}</div>`);
  }
  rows.push(`<h2>icon-512</h2><div class="gi">${cell("icon-512.png", "icon-512")}</div>`);
  return `<!doctype html><html><head><meta charset="utf-8">
  <link rel="stylesheet" href="/app/vendor/fonts/fonts.css"><link rel="stylesheet" href="/app/css/tokens.css">
  <style>
    body{margin:0;padding:24px;width:${SHEET_W - 48}px;background:#F8F7F4;color:#1D1E20;font:500 13px var(--font-body)}
    h2{font:600 13px var(--font-mono);margin:18px 0 8px;color:#55565A}
    figure{margin:0} img{display:block;width:100%;border-radius:6px;box-shadow:0 0 0 1px #C6C3BC}
    figcaption{font:500 11px var(--font-mono);margin-top:4px;color:#55565A}
    .g6{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}
    .gx{display:grid;grid-template-columns:1.6fr .46fr 1.78fr 1.9fr;gap:10px;align-items:start}
    .gi{width:96px}
  </style></head><body>${rows.join("")}</body></html>`;
}

async function main() {
  const { chromium } = await loadPlaywright();
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(server.url + "/media/templates/frame.css");
    for (const [src, dst, width] of JOBS) {
      const buf = await toWebp(page, join(OUT, src), width);
      const path = join(WEB_IMG, dst);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, buf);
      console.log(`OK    app/img/${dst}  ${(buf.length / 1024).toFixed(0)} KB`);
    }
    for (const l of LANGS) {
      await copyFile(join(OUT, `og-${l}.png`), join(WEB_IMG, `og-${l}.png`));
      console.log(`OK    app/img/og-${l}.png`);
    }

    // Hoja de contacto
    const sheetPath = join(MEDIA, ".cache", "hoja-contacto.html");
    await mkdir(dirname(sheetPath), { recursive: true });
    await writeFile(sheetPath, sheetHtml());
    const sp = await browser.newPage({ viewport: { width: SHEET_W, height: 800 }, deviceScaleFactor: 1 });
    await sp.goto(server.url + "/media/.cache/hoja-contacto.html");
    await sp.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    await sp.evaluate(() => document.fonts.ready);
    const jpg = join(MEDIA, ".cache", "hoja-contacto.jpg");
    let q = 85;
    for (;;) {
      await sp.screenshot({ path: jpg, type: "jpeg", quality: q, fullPage: true });
      if ((await stat(jpg)).size < SHEET_MAX || q <= 50) break;
      q -= 10;
    }
    const size = (await stat(jpg)).size;
    if (size >= SHEET_MAX) throw new Error(`hoja de contacto de ${size} B (> 1,5 MB)`);
    console.log(`OK    media/.cache/hoja-contacto.jpg  ${(size / 1024).toFixed(0)} KB (q${q})`);
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
