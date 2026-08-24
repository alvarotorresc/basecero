import { initDb } from "./db.js";
import { getOpenPeriod } from "./repo.js";
import { showOnboarding } from "./onboarding.js";
import { renderInicio } from "./screens/inicio.js";
import { renderRegistro } from "./screens/registro.js";
import { renderMovimientos } from "./screens/movimientos.js";
import { renderProximamente } from "./screens/placeholder.js";
import { renderAjustes } from "./screens/ajustes.js";

const screen = document.getElementById("screen");
const RUTAS = {
  inicio: () => renderInicio(screen),
  movimientos: () => renderMovimientos(screen),
  patrimonio: () => renderProximamente(screen, "Patrimonio"),
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
    if (storage === "memory") {
      const aviso = document.createElement("div");
      aviso.className = "banner-aviso";
      aviso.textContent = "⚠ Este navegador no soporta almacenamiento persistente: tus datos NO se guardarán al cerrar.";
      document.body.prepend(aviso);
    }
    try { await navigator.storage?.persist?.(); } catch {}
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
