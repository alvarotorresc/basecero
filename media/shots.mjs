// ===== Capturas de la app =====
//
// Orden de uso: shots -> compose -> web (ver media/README.md).
//
// Por idioma: base limpia, se importan los datos de demo (demo.mjs) desde la Bienvenida y se
// recorren las escenas de SCENES con el reloj parado en NOW. Una sola pestaña por idioma: la base
// (OPFS, opfs-sahpool) es de instancia única y una segunda pestaña la vería bloqueada. El tema se
// cambia escribiendo bc-theme en localStorage y recargando, como hace la app.
//
// Salida (media/out/):
//   shots/{es,en}/NN-*.png   galería, 1080×2340
//   cover-mobile-{es,en}.png Inicio en móvil, 1080×2340
//   cover-{es,en}.png        la app en una ventana de escritorio, 1600×1000
//
// Flags: --lang es|en  solo ese idioma · --only <prefijo>  solo esas escenas

import { join } from "node:path";
import { loadPlaywright, startServer, addFreeze, guards, writeOut, OUT } from "./lib.mjs";
import { demoWorkbook } from "./demo.mjs";

// Viernes 18 de septiembre de 2026, 21:00 en Madrid: el día del último movimiento del fixture (el
// paso a la hucha), así ninguna lista enseña movimientos futuros. Día 18 del periodo de septiembre:
// la semana tiene gasto casi todos los días y la línea del periodo ya cuenta más de medio mes.
const NOW = "2026-09-18T21:00:00+02:00";

const MOBILE = { viewport: { width: 390, height: 845 }, deviceScaleFactor: 1080 / 390, isMobile: true, hasTouch: true };
// La app es de una columna (máx. 480 px): una ventana de 1120×700 la deja legible en el marco
// estrecho de la web y la captura sale a 1600×1000.
const DESKTOP = { viewport: { width: 1120, height: 700 }, deviceScaleFactor: 1600 / 1120 };

// ---------- Navegación dentro de la app ----------
const tab = (name) => async (page) => { await page.click(`.tab[data-tab="${name}"]`); };
const fromInicio = (sel) => async (page) => { await tab("inicio")(page); await page.click(sel); };

async function registro(page, lang) {
  await tab("inicio")(page);
  await page.click("#btn-registro");
  await page.waitForSelector("#reg-raw");
  await page.fill("#reg-raw", lang === "en" ? "3.40" : "3,40");
  const merchant = await page.$("#reg-merchant");
  if (merchant) await merchant.fill(lang === "en" ? "Corner café" : "Café de la esquina");
  // Restauración -> Bares y cafés
  await page.click('[data-root="cat-restauracion"], [data-cat="cat-restauracion"]').catch(() => {});
  const sub = await page.$('[data-cat="cat-restauracion-bares"]');
  if (sub) await sub.click();
  await page.evaluate(() => document.activeElement?.blur());
}

// file: ruta relativa a OUT, sin idioma ni extensión cuando lleva sufijo (cover).
export const SCENES = [
  { file: "shots/{lang}/01-inicio", theme: "light", go: tab("inicio") },
  { file: "shots/{lang}/02-registro", theme: "light", go: registro },
  { file: "shots/{lang}/03-movimientos", theme: "dark", go: tab("movimientos") },
  { file: "shots/{lang}/04-gasto-categoria", theme: "light", go: fromInicio("#inicio-categoria") },
  { file: "shots/{lang}/05-patrimonio", theme: "dark", go: tab("patrimonio") },
  { file: "shots/{lang}/06-informe", theme: "light", go: fromInicio("#inicio-informe-link") },
  { file: "cover-mobile-{lang}", theme: "light", go: tab("inicio") },
  { file: "cover-{lang}", theme: "light", go: tab("inicio"), desktop: true },
];

function parseArgs(argv) {
  const a = { lang: null, only: null, out: OUT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--lang") a.lang = argv[++i];
    else if (argv[i] === "--only") a.only = argv[++i];
    else if (argv[i] === "--out") a.out = argv[++i];
  }
  return a;
}

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => !document.querySelector(".skeleton, .skeleton-stack"));
  await page.evaluate(async () => {
    await document.fonts.ready;
    const need = ["700 40px Unbounded", "400 16px 'Instrument Sans'", "500 16px 'IBM Plex Mono'"];
    if (!need.every((f) => document.fonts.check(f))) throw new Error("fuentes sin cargar");
  });
  // Sin avisos flotantes (el «Importado» de la Bienvenida, por ejemplo).
  await page.evaluate(() => document.querySelectorAll(".toast, [role=status].toast").forEach((n) => n.remove()));
  await page.evaluate(() => { document.getElementById("screen")?.scrollTo?.(0, 0); window.scrollTo(0, 0); });
  await page.mouse.move(0, 0).catch(() => {});
  await page.waitForTimeout(250);
}

async function openSession(browser, server, lang, device) {
  const context = await browser.newContext({
    ...device, serviceWorkers: "block", timezoneId: "Europe/Madrid",
    locale: lang === "en" ? "en-GB" : "es-ES", reducedMotion: "reduce", colorScheme: "light",
  });
  await addFreeze(context);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error(`  [${lang}] pageerror: ${e.message}`));
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(server.url + "/app/");

  // Base limpia (contexto nuevo = OPFS vacío): Bienvenida -> Importar.
  await page.click("#onb-import-link");
  await page.setInputFiles("#onb-imp-file", await demoWorkbook(lang));
  await page.click("#onb-imp-go:not([disabled])");
  await page.waitForSelector(".tabbar .tab", { state: "visible" });

  await setTheme(page, "light");
  await settle(page);
  if (lang === "en") {
    // Cambiar el idioma como lo haría alguien: Ajustes -> Idioma. La app retraduce las categorías.
    await page.click('.tab[data-tab="ajustes"]');
    await page.waitForSelector("#pref-lang", { state: "attached" });
    await page.selectOption("#pref-lang", "en");
    await page.waitForFunction(() => document.querySelector('.tab[data-tab="inicio"] .tab-label')?.textContent === "Home");
  }
  return { context, page };
}

async function setTheme(page, theme) {
  await page.evaluate((th) => localStorage.setItem("bc-theme", th), theme);
  await page.reload();
  await page.waitForSelector(".tabbar .tab", { state: "visible" });
  if (await page.$("#onb-import-link")) throw new Error("la base se ha perdido al recargar");
}

async function main() {
  const { lang, only, out } = parseArgs(process.argv.slice(2));
  const langs = lang ? [lang] : ["es", "en"];
  const scenes = only ? SCENES.filter((s) => s.file.includes(only)) : SCENES;
  const { chromium } = await loadPlaywright();
  const server = await startServer();
  const browser = await chromium.launch();
  const fallos = [];
  try {
    for (const l of langs) {
      for (const desktop of [false, true]) {
        const group = scenes.filter((s) => !!s.desktop === desktop);
        if (!group.length) continue;
        const { context, page } = await openSession(browser, server, l, desktop ? DESKTOP : MOBILE);
        try {
          for (const s of group) {
            const name = s.file.replace("{lang}", l);
            try {
              // Cada escena parte de Inicio recién cargado, sin subpantallas abiertas de la anterior.
              await setTheme(page, s.theme);
              await settle(page);
              await s.go(page, l);
              await settle(page);
              const size = desktop ? { width: 1600, height: 1000 } : { width: 1080, height: 2340 };
              const buf = await guards(page, name, { ...size, theme: s.theme, lang: l });
              await writeOut(join(out, `${name}.png`), buf);
              console.log(`OK    ${name}`);
            } catch (e) {
              fallos.push(name);
              console.error(`FALLO ${name}: ${e.message.split("\n")[0]}`);
            }
          }
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    await server.stop();
  }
  if (fallos.length) { console.error(`\n${fallos.length} con fallo: ${fallos.join(", ")}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
