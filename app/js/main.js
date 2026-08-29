import { initDb } from "./db.js";
import { getOpenPeriod, getMetaAll, listPeriods } from "./repo.js";
import { initFormat } from "./format.js";
import { initI18nFromNavigator, initI18n, t } from "./i18n/index.js";
import { initCategoryStyle, parseStyle } from "./category-colors.js";
import { showOnboarding, showFirstPeriod } from "./onboarding.js";
import { needsOnboarding } from "./onboarding-steps.js";
import { renderInicio } from "./screens/inicio.js";
import { renderRegistro } from "./screens/registro.js";
import { renderMovimientos } from "./screens/movimientos.js";
import { renderPatrimonio } from "./screens/patrimonio.js";
import { renderAjustes } from "./screens/ajustes.js";

const screen = document.getElementById("screen");
const RUTAS = {
  inicio: () => renderInicio(screen),
  movimientos: () => renderMovimientos(screen),
  patrimonio: () => renderPatrimonio(screen),
  ajustes: () => renderAjustes(screen),
};

export function nav(tab) {
  // Durante el asistente de Nuevo periodo (onboarding o cierre normal) el chrome está oculto
  // (ver app.css `body.onboarding`): ignora cualquier navegación mientras dure.
  if (document.body.classList.contains("onboarding")) return;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  RUTAS[tab]();
}

async function boot() {
  initI18nFromNavigator();
  try {
    const { storage } = await initDb();
    if (storage === "locked") {
      // Otra pestaña o la PWA instalada ya tienen la base abierta (opfs-sahpool
      // es de instancia única): recuperable cerrando la otra y reintentando.
      const aviso = document.createElement("div");
      aviso.className = "banner-aviso red";
      aviso.textContent = t("main.banner.locked");
      const btn = document.createElement("button");
      btn.textContent = t("common.retry");
      btn.style.cssText = "margin-left:8px;padding:4px 12px;border-radius:8px;border:1px solid currentColor;background:none;color:inherit;font:inherit;cursor:pointer";
      btn.onclick = () => location.reload();
      aviso.appendChild(btn);
      document.body.prepend(aviso);
    } else if (storage === "memory") {
      const aviso = document.createElement("div");
      aviso.className = "banner-aviso";
      aviso.textContent = t("main.banner.memory");
      document.body.prepend(aviso);
    }
    try { await navigator.storage?.persist?.(); } catch {}
    try {
      const meta = await getMetaAll();
      const uiLang = initI18n(meta);
      initFormat(meta);
      initCategoryStyle(parseStyle(meta.category_style));
      document.documentElement.lang = uiLang;
      document.querySelectorAll(".tab").forEach((b) => { b.lastChild.textContent = " " + t("main.tabs." + b.dataset.tab); });
      document.getElementById("btn-registro").setAttribute("aria-label", t("main.fab"));
    } catch {} // si meta no se puede leer, la app arranca con es-ES/EUR
    if (needsOnboarding(await listPeriods())) await showOnboarding(screen);
    else if (!(await getOpenPeriod())) await showFirstPeriod(screen);
    nav("inicio");
  } catch (err) {
    console.error(err);
    const aviso = document.createElement("div");
    aviso.className = "banner-aviso red";
    aviso.textContent = t("main.banner.boot_failed", { error: err?.message || err });
    document.body.prepend(aviso);
  }
}

document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => nav(b.dataset.tab)));
document.getElementById("btn-registro").onclick = () => renderRegistro(screen, () => nav("inicio"));
boot();
