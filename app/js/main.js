import { initDb } from "./db.js";
import { getOpenPeriod, getMetaAll } from "./repo.js";
import { initFormat } from "./format.js";
import { showOnboarding } from "./onboarding.js";
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
  try {
    const { storage } = await initDb();
    if (storage === "locked") {
      // Otra pestaña o la PWA instalada ya tienen la base abierta (opfs-sahpool
      // es de instancia única): recuperable cerrando la otra y reintentando.
      const aviso = document.createElement("div");
      aviso.className = "banner-aviso red";
      aviso.textContent = "⚠ BaseCero ya está abierta en otra pestaña o ventana. Ciérrala y reintenta; mientras tanto, lo que hagas aquí NO se guardará. ";
      const btn = document.createElement("button");
      btn.textContent = "Reintentar";
      btn.style.cssText = "margin-left:8px;padding:4px 12px;border-radius:8px;border:1px solid currentColor;background:none;color:inherit;font:inherit;cursor:pointer";
      btn.onclick = () => location.reload();
      aviso.appendChild(btn);
      document.body.prepend(aviso);
    } else if (storage === "memory") {
      const aviso = document.createElement("div");
      aviso.className = "banner-aviso";
      aviso.textContent = "⚠ Este navegador no soporta almacenamiento persistente: tus datos NO se guardarán al cerrar.";
      document.body.prepend(aviso);
    }
    try { await navigator.storage?.persist?.(); } catch {}
    try {
      const meta = await getMetaAll();
      initFormat(meta);
      document.documentElement.lang = (meta.locale || "es-ES").split("-")[0];
    } catch {} // si meta no se puede leer, la app arranca con es-ES/EUR
    if (!(await getOpenPeriod())) await showOnboarding(screen);
    nav("inicio");
  } catch (err) {
    console.error(err);
    const aviso = document.createElement("div");
    aviso.className = "banner-aviso red";
    aviso.textContent = "⚠ BaseCero no ha podido arrancar: " + (err?.message || err) + ". Recarga la página.";
    document.body.prepend(aviso);
  }
}

document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => nav(b.dataset.tab)));
document.getElementById("btn-registro").onclick = () => renderRegistro(screen, () => nav("inicio"));
boot();
