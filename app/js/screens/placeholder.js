import { exportAllJson } from "../repo.js";
import { hoyISO } from "../format.js";

export function renderProximamente(container, titulo) {
  container.innerHTML = `<header class="screen-header"><h1>${titulo}</h1></header>
    <div class="card" style="text-align:center;color:var(--text-2)">
      <p style="font-size:32px">🚧</p><p>Llega en la fase 2.</p></div>`;
}

export function renderAjustes(container) {
  container.innerHTML = `<header class="screen-header"><h1>Ajustes</h1></header>
    <div class="card" style="margin-bottom:12px">
      <p>🔒 <strong>Tus datos viven solo en este dispositivo.</strong></p>
      <p style="color:var(--text-2);font-size:14px;margin-top:6px">
        Sin cuentas, sin nube. Haz copias con el export mientras llega el export .xlsx de la fase 2.</p></div>
    <button class="btn-primary" id="btn-export">Exportar copia de seguridad (JSON)</button>`;
  container.querySelector("#btn-export").onclick = async () => {
    const data = await exportAllJson();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"),
      { href: URL.createObjectURL(blob), download: `basecero-backup-${hoyISO()}.json` });
    a.click(); URL.revokeObjectURL(a.href);
  };
}
