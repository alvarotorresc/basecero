// STUB mínimo — pantallas de fases posteriores aún no implementadas.
export function renderProximamente(container, titulo) {
  container.innerHTML = `
    <div class="screen-header">
      <h1>${titulo}</h1>
      <p>Próximamente.</p>
    </div>
  `;
}

export function renderAjustes(container) {
  renderProximamente(container, "Ajustes");
}
