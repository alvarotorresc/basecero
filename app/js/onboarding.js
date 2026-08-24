import { openFirstPeriod } from "./repo.js";
import { hoyISO } from "./format.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

// "agosto de 2026" (Intl es-ES) -> "Agosto 2026"
function nombrePorDefecto() {
  const raw = new Date().toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  const sinDe = raw.replace(" de ", " ");
  return sinDe.charAt(0).toUpperCase() + sinDe.slice(1);
}

/** Pantalla completa (no modal) para abrir el primer periodo.
 *  Resuelve la promesa cuando el periodo ha sido creado. */
export function showOnboarding(container) {
  return new Promise((resolve) => {
    container.innerHTML = `
      <div class="screen-header">
        <h1>Abre tu primer periodo</h1>
        <p>Tu mes empieza cuando tú lo digas — normalmente, el día que cobras.</p>
      </div>

      <div style="display:flex; flex-direction:column; gap:12px;">
        <label class="field field-stack">
          <span class="field-label">Nombre del periodo</span>
          <input type="text" id="ob-name" value="${nombrePorDefecto()}">
        </label>

        <label class="field field-stack">
          <span class="field-label">Empieza el</span>
          <input type="date" id="ob-date" value="${hoyISO()}">
        </label>

        <label class="field field-stack">
          <span class="field-label">% de los gastos compartidos que pagas tú</span>
          <input type="number" id="ob-pct" min="0" max="100" value="50">
        </label>
        <p style="font-size:11px; color:var(--text-3); margin-top:-6px;">Sara pagará el resto.</p>
      </div>

      <div id="ob-error" class="banner-aviso red" style="display:none; margin-top:14px;"></div>

      <button class="btn-primary" id="ob-submit" style="margin-top:20px;">Abrir periodo</button>
    `;

    const btn = container.querySelector("#ob-submit");
    const errorBox = container.querySelector("#ob-error");
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = "Abriendo…";
      errorBox.style.display = "none";
      try {
        const name = container.querySelector("#ob-name").value.trim() || nombrePorDefecto();
        const startDate = container.querySelector("#ob-date").value || hoyISO();
        const pctRaw = Number(container.querySelector("#ob-pct").value);
        const sharePct = Number.isFinite(pctRaw) ? Math.min(100, Math.max(0, pctRaw)) : 50;
        await openFirstPeriod({ name, startDate, sharePct });
        resolve();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "Abrir periodo";
        errorBox.innerHTML = escHtml("No se pudo abrir el periodo: " + e.message);
        errorBox.style.display = "flex";
      }
    };
  });
}
