import { initDb } from "./db.js";
import { getOpenPeriod, getMetaAll, listPeriods } from "./repo.js";
import { initFormat } from "./format.js";
import { initI18nFromNavigator, initI18n, activeLang, t } from "./i18n/index.js";
import { initCategoryStyle, parseStyle } from "./category-colors.js";
import { showOnboarding, showFirstPeriod } from "./onboarding.js";
import { needsOnboarding } from "./onboarding-steps.js";
import { renderInicio } from "./screens/inicio.js";
import { renderRegistro } from "./screens/registro.js";
import { renderMovimientos } from "./screens/movimientos.js";
import { renderPatrimonio } from "./screens/patrimonio.js";
import { renderAjustes } from "./screens/ajustes.js";
import { pushBack, goBack, clearBack, resetBack } from "./back.js";
import { userMessage } from "./errors.js";

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
  // Cambiar de pestaña descarta las subpantallas abiertas (y sus entradas de historial). Además,
  // Inicio es la raíz de la app: desde cualquier OTRA pestaña, el gesto «atrás» del sistema tiene
  // que volver a Inicio, no cerrar la aplicación — así que la pestaña deja una entrada de
  // historial con «volver a Inicio» como callback, en la misma pila que las subpantallas.
  if (tab === "inicio") clearBack();
  else resetBack(() => nav("inicio"));
  document.querySelectorAll(".tab").forEach((b) => {
    const isActive = b.dataset.tab === tab;
    b.classList.toggle("active", isActive);
    if (isActive) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  RUTAS[tab]();
}

// Se llama en boot y de nuevo tras el onboarding, donde el usuario puede haber cambiado el idioma:
// el tabbar y el FAB están ocultos durante el asistente, así que sin este segundo rotulado
// quedarían con el idioma del arranque durante toda la sesión.
function relabelChrome() {
  document.querySelectorAll(".tab").forEach((b) => { b.lastChild.textContent = " " + t("main.tabs." + b.dataset.tab); });
  document.getElementById("btn-registro").setAttribute("aria-label", t("main.fab"));
  document.querySelector(".tabbar").setAttribute("aria-label", t("main.tabsNav"));
}

async function boot() {
  initI18nFromNavigator();
  try {
    // seedLang: en una BD virgen meta.lang aún no existe (se lee más abajo, tras getMetaAll), así
    // que la mejor señal disponible para sembrar las categorías en el idioma correcto es la del
    // navegador — initI18nFromNavigator() ya la resolvió justo arriba, así que activeLang() aquí
    // SIEMPRE devuelve esa resolución (nunca meta.lang, que en una BD nueva no existe todavía).
    const { storage } = await initDb({ seedLang: activeLang() });
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
      relabelChrome();
    } catch {} // si meta no se puede leer, la app arranca con es-ES/EUR
    if (needsOnboarding(await listPeriods())) { await showOnboarding(screen); relabelChrome(); }
    else if (!(await getOpenPeriod())) await showFirstPeriod(screen);
    nav("inicio");
  } catch (err) {
    console.error(err);
    const aviso = document.createElement("div");
    aviso.className = "banner-aviso red";
    aviso.textContent = t("main.banner.boot_failed", { error: userMessage(err) });
    document.body.prepend(aviso);
  }
}

document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => nav(b.dataset.tab)));
document.getElementById("btn-registro").onclick = () => {
  pushBack(() => nav("inicio"));
  renderRegistro(screen, goBack);
};
boot();
