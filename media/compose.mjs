// ===== Promo, social preview e icono =====
//
// Orden de uso: shots -> compose -> web. Necesita las capturas de shots.mjs en media/out/shots/.
// Renderiza las plantillas HTML de media/templates/ (textos de labels.json) y copia el icono.
//
// Salida (media/out/): promo-{es,en}.png 1920×1080 · og-{es,en}.png 1200×630 · icon-512.png

import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { loadPlaywright, startServer, pngSize, writeOut, MEDIA, OUT } from "./lib.mjs";

const PIECES = [
  { name: "promo", template: "promo.html", width: 1920, height: 1080 },
  { name: "og", template: "og.html", width: 1200, height: 630 },
];

async function render(page, url, { width, height }, out) {
  await page.goto(url);
  await page.evaluate(() => window.ready);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const need = ["700 40px Unbounded", "500 16px 'Instrument Sans'"];
    if (!need.every((f) => document.fonts.check(f))) throw new Error("fuentes sin cargar");
  });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  const text = await page.evaluate(() => document.body.innerText);
  if (!text.trim() || /undefined|null/.test(text)) throw new Error(`${out}: texto vacío o roto`);
  const buf = await page.screenshot();
  const s = pngSize(buf);
  if (s.width !== width || s.height !== height) throw new Error(`${out}: ${s.width}x${s.height}`);
  await writeOut(join(OUT, out), buf);
  console.log(`OK    ${out}`);
}

async function main() {
  const { chromium } = await loadPlaywright();
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    for (const p of PIECES) {
      const page = await browser.newPage({ viewport: { width: p.width, height: p.height }, deviceScaleFactor: 1 });
      for (const lang of ["es", "en"]) {
        await render(page, `${server.url}/media/templates/${p.template}?lang=${lang}`, p, `${p.name}-${lang}.png`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await server.stop();
  }
  // Icono de la ficha: el de marca a sangre, sin esquinas (las pone la web).
  await copyFile(join(MEDIA, "brand/basecero-icono-512.png"), join(OUT, "icon-512.png"));
  console.log("OK    icon-512.png");
}

main().catch((e) => { console.error(e); process.exit(1); });
