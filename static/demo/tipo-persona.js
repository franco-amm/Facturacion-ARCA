// Ícono de persona física / jurídica delante del nombre de cada cliente, en todas las pestañas.
// Cada pestaña solo marca el nombre con data-persona="<CUIT>"; este script dibuja el ícono (también en lo que se
// agrega después, porque las tablas se re-dibujan). Se decide por el prefijo del CUIT: 20, 23, 24 y 27 son
// personas físicas; 30, 33 y 34, jurídicas. Cualquier otro prefijo queda sin ícono.
(() => {
  const SVG_FISICA = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
  const SVG_JURIDICA = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/></svg>';

  function tipoPersona(cuit) {
    const prefijo = String(cuit || "").replace(/\D/g, "").slice(0, 2);
    if (["20", "23", "24", "27"].includes(prefijo)) return "fisica";
    if (["30", "33", "34"].includes(prefijo)) return "juridica";
    return null;
  }

  function marcar(el) {
    if (el.dataset.personaOk) return;
    el.dataset.personaOk = "1";
    const tipo = tipoPersona(el.dataset.persona);
    if (!tipo) return;
    const titulo = tipo === "fisica" ? "Persona física" : "Persona jurídica";
    el.insertAdjacentHTML("afterbegin",
      `<span class="tp tp-${tipo}" role="img" title="${titulo}" aria-label="${titulo}">${tipo === "fisica" ? SVG_FISICA : SVG_JURIDICA}</span>`);
  }

  function recorrer(nodo) {
    if (nodo.nodeType !== 1) return;
    if (nodo.matches("[data-persona]")) marcar(nodo);
    nodo.querySelectorAll("[data-persona]:not([data-persona-ok])").forEach(marcar);
  }

  window.tipoPersona = tipoPersona;
  new MutationObserver((cambios) => cambios.forEach((c) => c.addedNodes.forEach(recorrer)))
    .observe(document.documentElement, { childList: true, subtree: true });
  if (document.body) recorrer(document.body);
})();
