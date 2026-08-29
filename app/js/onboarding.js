// Puertas de entrada a pantalla completa antes de la app (sin chrome: body.onboarding
// oculta tabbar y fab, y neutraliza nav() — ver main.js y app.css).
import { renderOnboarding } from "./screens/onboarding.js";
import { renderPeriodoNuevo } from "./screens/periodo-nuevo.js";

/** Onboarding de primera ejecución (PR F): 4 pasos que desembocan en el primer periodo.
 *  Solo para BDs sin ningún periodo (gate en main.js con needsOnboarding). */
export function showOnboarding(container) {
  return new Promise((resolve) => {
    document.body.classList.add("onboarding");
    renderOnboarding(container, {
      onDone: () => { document.body.classList.remove("onboarding"); resolve(); },
    });
  });
}

/** BD con periodos pero ninguno abierto (p. ej. una copia importada con todo cerrado):
 *  directo al asistente de periodo, sin bienvenida — el comportamiento previo a la PR F. */
export function showFirstPeriod(container) {
  return new Promise((resolve) => {
    document.body.classList.add("onboarding");
    renderPeriodoNuevo(container, {
      mode: "first",
      onDone: () => { document.body.classList.remove("onboarding"); resolve(); },
    });
  });
}
