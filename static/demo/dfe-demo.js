(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmtFecha = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");
  const fmtCuit = (c) => (/^\d{11}$/.test(c) ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);
  const URGENCIA = { alta: ["Alta", "bad"], media: ["Media", "warn"], baja: ["Baja", "ok"], sin_clasificar: ["Sin clasificar", "muted"] };
  const ORDEN = { alta: 0, media: 1, baja: 2, sin_clasificar: 3 };
  const TIPO = {
    intimacion: "Intimación", requerimiento: "Requerimiento", sumario: "Sumario o multa", diferencias: "Aviso de diferencias",
    cambio_estado: "Cambio de estado", informativo: "Informativo", sin_clasificar: "Sin clasificar",
  };
  const ERROR = { delegacion_faltante: "Falta la delegación del servicio", certificado: "Certificado vencido o inválido", servicio_caido: "Servicio de ARCA no disponible", otro: "Error al consultar" };
  let data = null;
  let loaded = false;

  const nombreDe = (cuit) => (data.clientes.find((c) => c.cuit === cuit) || {}).nombre || fmtCuit(cuit);

  function limiteTexto(c) {
    if (!c.fecha_limite) return "—";
    const d = c.dias_para_limite;
    const cuando = d == null ? "" : d < 0 ? "vencida" : d === 0 ? "hoy" : `en ${d} día${d === 1 ? "" : "s"}`;
    return `${fmtFecha(c.fecha_limite)}${cuando ? `<span class="mt-sub">${cuando}</span>` : ""}`;
  }

  function ordenadas() {
    return [...data.comunicaciones].sort((a, b) =>
      (a.vista - b.vista) || (ORDEN[a.urgencia] - ORDEN[b.urgencia]) || String(a.fecha_limite).localeCompare(String(b.fecha_limite)));
  }

  function render() {
    const items = ordenadas();
    const urgentes = items.filter((c) => !c.vista && c.urgencia === "alta");
    $("dfeAlerts").hidden = urgentes.length === 0;
    $("dfeAlertList").innerHTML = urgentes.map((c) => `<li class="mt-alert mt-critico dfe-alert">
      <div><strong>${esc(nombreDe(c.cuit))}</strong><span class="mt-cuit">${esc(fmtCuit(c.cuit))}</span>
      <p>${esc(c.asunto)} · fecha límite ${fmtFecha(c.fecha_limite)}</p></div>
      <button class="button button-quiet" data-visto="${esc(c.id)}" type="button">Marcar como visto</button></li>`).join("");

    $("dfeFooter").textContent = `${items.length} comunicaciones de muestra · ${items.filter((c) => !c.vista).length} sin ver`;
    $("dfeRows").innerHTML = items.map((c) => {
      const [etiqueta, tono] = URGENCIA[c.urgencia] || [c.urgencia, "muted"];
      const accion = c.vista ? '<span class="mt-sub">Vista</span>'
        : `<button class="button button-quiet" data-visto="${esc(c.id)}" type="button">Marcar como visto</button>`;
      return `<tr class="${c.vista ? "dfe-vista" : ""}">
        <td><span class="mt-name">${esc(nombreDe(c.cuit))}</span><span class="mt-doc">${esc(fmtCuit(c.cuit))}</span></td>
        <td>${esc(c.asunto)}<span class="mt-sub">${esc(c.organismo)}${c.con_adjunto ? " · con adjunto" : ""}</span></td>
        <td>${fmtFecha(c.publicada)}</td><td>${limiteTexto(c)}</td>
        <td>${esc(TIPO[c.tipo] || c.tipo)}</td>
        <td><span class="mt-state ${tono}">${esc(etiqueta)}</span></td><td>${accion}</td></tr>`;
    }).join("");

    $("dfeClientesFooter").textContent = `${data.clientes.length} clientes de muestra`;
    $("dfeClientes").innerHTML = data.clientes.map((cl) => {
      const propias = data.comunicaciones.filter((c) => c.cuit === cl.cuit);
      const sinVer = propias.filter((c) => !c.vista).length;
      const urg = propias.filter((c) => !c.vista && c.urgencia === "alta").length;
      const estado = cl.error ? `<span class="mt-state bad" title="${esc(cl.error.mensaje)}">${esc(ERROR[cl.error.tipo] || ERROR.otro)}</span>`
        : '<span class="mt-state ok">Al día</span>';
      const ultima = cl.ultima_consulta ? cl.ultima_consulta.replace("T", " ").slice(0, 16) : "—";
      return `<tr><td><span class="mt-name">${esc(cl.nombre)}</span><span class="mt-doc">${esc(fmtCuit(cl.cuit))}</span></td>
        <td>${esc(ultima)}</td><td class="amount-cell">${sinVer}</td><td class="amount-cell">${urg}</td><td>${estado}</td></tr>`;
    }).join("");
  }

  async function load() {
    try {
      const r = await fetch("/api/demo/dfe");
      if (!r.ok) throw new Error(`Error HTTP ${r.status}`);
      data = await r.json();
      $("dfeMsg").textContent = `Datos de muestra al ${fmtFecha(data.fecha_muestra)}. En la versión real se consulta ARCA y solo se detecta: nada se abre ni se marca como leído.`;
      render();
      loaded = true;
    } catch (e) {
      $("dfeMsg").textContent = `No se pudo cargar la demo: ${e.message}`;
    }
  }

  $("dfe").addEventListener("click", (event) => {
    const boton = event.target.closest("[data-visto]");
    if (!boton || !data) return;
    const c = data.comunicaciones.find((x) => x.id === boton.dataset.visto);
    if (c) { c.vista = true; render(); }
  });

  function route() {
    const on = location.hash === "#dfe";
    $("dfe").hidden = !on;
    if (on && !loaded) load();
  }

  window.addEventListener("hashchange", route);
  route();
})();
