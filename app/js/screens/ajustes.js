import { dumpAllTables, replaceAll, exportAllJson, getOpenPeriod } from "../repo.js";
import { rowsToWorkbook, workbookToRows, validateImport } from "../xlsx.js";
import { hoyISO, fmtDiaCorto } from "../format.js";
import { renderPeriodoNuevo } from "./periodo-nuevo.js";

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

const BTN_SECONDARY = "background:transparent;color:var(--text);border:1px solid var(--border);"
  + "border-radius:var(--radius-sm);padding:16px;width:100%;font:600 16px var(--font-ui);cursor:pointer;";

function download(blob, filename) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: filename });
  a.click(); URL.revokeObjectURL(a.href);
}

function downloadXlsx(dump, filename) {
  const wb = rowsToWorkbook(window.XLSX, dump);
  const arr = window.XLSX.write(wb, { type: "array", bookType: "xlsx" });
  download(new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}

function periodoCardHtml(period) {
  if (!period) return "";
  // start_date puede quedar en el futuro (se puede abrir el periodo unos días antes de que
  // empiece): en ese caso no hay "días transcurridos" que mostrar, así que se omite ese tramo
  // en vez de enseñar un número negativo.
  const dias = Math.floor((new Date(hoyISO() + "T12:00:00") - new Date(period.start_date + "T12:00:00")) / 86400000) + 1;
  const diasTxt = dias >= 1 ? ` · ${dias} día${dias === 1 ? "" : "s"}` : "";
  return `
  <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:12px">
    <div class="section-title">Periodo</div>
    <div class="card" style="display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div style="display:flex;flex-direction:column;gap:3px">
          <div style="font-size:15px;font-weight:700">${escHtml(period.name)}</div>
          <div style="font-size:11px;color:var(--text-3)">
            Abierto el ${fmtDiaCorto(period.start_date)}${diasTxt} · reparto ${period.my_share_pct} / ${100 - period.my_share_pct}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;background:#1b1e21;border-radius:10px;padding:6px 9px;flex-shrink:0">
          <div style="width:7px;height:7px;border-radius:4px;background:var(--green)"></div>
          <div style="font-size:11px;font-weight:600;color:var(--text-2)">Abierto</div>
        </div>
      </div>
      <button type="button" class="btn-primary" id="btn-cerrar-periodo">Cerrar periodo y abrir el siguiente</button>
      <div style="font-size:11px;color:var(--text-3);line-height:1.5">
        Al cerrar fijarás la fecha final y elegirás el reparto con Sara del periodo nuevo. Ábrelo el día que entre la nómina.
      </div>
    </div>
  </div>`;
}

/** Pantalla de Ajustes: export/import de la hoja .xlsx (motor de fase 2), cierre del periodo
 *  abierto (asistente unificado de Task 8) y copia JSON de emergencia. */
export async function renderAjustes(container) {
  let openPeriod = null;
  try { openPeriod = await getOpenPeriod(); } catch { openPeriod = null; }

  const state = { errors: null, pending: null, busy: false };

  function render() {
    container.innerHTML = `
      <header class="screen-header"><h1>Ajustes</h1></header>

      <div class="card" style="margin-bottom:12px">
        <p style="font-weight:600;margin-bottom:4px">Tu hoja de cálculo</p>
        <p style="color:var(--text-2);font-size:13px;margin-bottom:14px">
          Exporta todos tus datos a un .xlsx editable en LibreOffice/Sheets, o importa una hoja para sustituir
          los datos actuales.</p>
        <button type="button" class="btn-primary" id="btn-xlsx-export" ${state.busy ? "disabled" : ""}>Exportar hoja (.xlsx)</button>
        <button type="button" id="btn-xlsx-import" style="${BTN_SECONDARY}margin-top:10px" ${state.busy ? "disabled" : ""}>Importar hoja (.xlsx)</button>
        <input type="file" id="xlsx-file-input" accept=".xlsx" style="display:none">

        ${state.errors ? `
        <div class="banner-aviso red" style="margin-top:12px;max-height:200px;overflow-y:auto;display:block">
          ${state.errors.slice(0, 10).map((e) => `<p>${escHtml(e)}</p>`).join("")}
          ${state.errors.length > 10 ? `<p>y ${state.errors.length - 10} más</p>` : ""}
        </div>` : ""}

        ${state.pending ? `
        <div class="banner-aviso" style="margin-top:12px;display:block">
          <p>Esto reemplaza TODOS los datos de la app (${state.pending.currentCount} movimientos actuales).
          Se descargará una copia antes.</p>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button type="button" id="btn-import-cancel" style="${BTN_SECONDARY}flex:1" ${state.busy ? "disabled" : ""}>Cancelar</button>
          <button type="button" class="btn-primary" id="btn-import-confirm" style="flex:1" ${state.busy ? "disabled" : ""}>Reemplazar</button>
        </div>` : ""}
      </div>

      ${periodoCardHtml(openPeriod)}

      <div class="card">
        <p style="font-weight:600;margin-bottom:4px">Copia de emergencia</p>
        <p style="color:var(--text-2);font-size:13px;margin-bottom:14px">
          🔒 Tus datos viven solo en este dispositivo. Sin cuentas, sin nube.</p>
        <button type="button" id="btn-json-export" style="${BTN_SECONDARY}">Exportar copia de seguridad (JSON)</button>
      </div>
    `;
    wire();
  }

  function wire() {
    container.querySelector("#btn-xlsx-export").onclick = async () => {
      state.busy = true; render();
      try {
        downloadXlsx(await dumpAllTables(), `basecero-${hoyISO()}.xlsx`);
      } catch (e) {
        state.errors = [`No se pudo exportar: ${e.message}`];
      } finally {
        state.busy = false; render();
      }
    };

    container.querySelector("#btn-xlsx-import").onclick = () => {
      container.querySelector("#xlsx-file-input").click();
    };

    const cerrarBtn = container.querySelector("#btn-cerrar-periodo");
    if (cerrarBtn) cerrarBtn.onclick = () => {
      document.body.classList.add("onboarding");
      renderPeriodoNuevo(container, {
        mode: "next",
        onDone: () => {
          document.body.classList.remove("onboarding");
          renderAjustes(container);
        },
      });
    };

    container.querySelector("#xlsx-file-input").onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      state.busy = true; render();
      try {
        const buf = await file.arrayBuffer();
        const wb = window.XLSX.read(buf, { type: "array" });
        const { data, errors: parseErrors } = workbookToRows(window.XLSX, wb);
        const errors = [...parseErrors, ...validateImport(data)];
        if (errors.length) {
          state.errors = errors; state.pending = null;
          return;
        }
        const currentDump = await dumpAllTables();
        state.errors = null;
        state.pending = { data, currentDump, currentCount: currentDump.transactions.length };
      } catch (err) {
        state.errors = [`No se pudo leer el archivo: ${err.message}`]; state.pending = null;
      } finally {
        state.busy = false; render();
      }
    };

    if (state.pending) {
      container.querySelector("#btn-import-cancel").onclick = () => {
        state.pending = null; render();
      };
      container.querySelector("#btn-import-confirm").onclick = async () => {
        state.busy = true; render();
        try {
          downloadXlsx(state.pending.currentDump, `basecero-backup-${hoyISO()}.xlsx`);
          await replaceAll(state.pending.data);
          location.reload();
        } catch (err) {
          state.busy = false;
          state.errors = [`No se pudo reemplazar: ${err.message}`]; state.pending = null;
          render();
        }
      };
    }

    container.querySelector("#btn-json-export").onclick = async () => {
      const data = await exportAllJson();
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
      download(blob, `basecero-backup-${hoyISO()}.json`);
    };
  }

  render();
}
