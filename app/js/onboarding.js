import { renderPeriodoNuevo } from "./screens/periodo-nuevo.js";

/** Pantalla completa (no modal) para abrir el primer periodo: delega en el asistente unificado
 *  de Task 8 (modo 'first', sin periodo previo que cerrar) y oculta el chrome de la app
 *  (tab bar + FAB, ver app.css `body.onboarding`) mientras dura. Resuelve la promesa cuando
 *  el periodo ha sido creado. */
export function showOnboarding(container) {
  return new Promise((resolve) => {
    document.body.classList.add("onboarding");
    renderPeriodoNuevo(container, {
      mode: "first",
      onDone: () => {
        document.body.classList.remove("onboarding");
        resolve();
      },
    });
  });
}
