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

  // Estado de lectura que informa ARCA (distinto de "visto", la marca local del estudio).
  function etiquetaArca(c) {
    const t = String(c.estado_arca || "").toLowerCase();
    if (!t) return "";
    if (/no le[ií]d|sin leer|pendiente/.test(t)) return '<span class="mt-state warn" title="ARCA la informa sin leer">Sin leer en ARCA</span>';
    if (/le[ií]d/.test(t)) return '<span class="mt-state muted" title="ARCA la informa leída (por alguien con acceso o de oficio). No implica que el estudio la haya visto.">Leída en ARCA</span>';
    return "";
  }

  function leidaEnArca(c) {
    const t = String(c.estado_arca || "").toLowerCase();
    if (/no le[ií]d|sin leer|pendiente/.test(t)) return false;
    if (/le[ií]d/.test(t)) return true;
    return null;
  }

  function render() {
    const items = ordenadas();
    const urgentes = items.filter((c) => !c.vista && c.urgencia === "alta");
    $("dfeAlerts").hidden = urgentes.length === 0;
    $("dfeAlertList").innerHTML = urgentes.map((c) => `<li class="mt-alert mt-critico dfe-alert">
      <div><strong>${esc(nombreDe(c.cuit))}</strong><span class="mt-cuit">${esc(fmtCuit(c.cuit))}</span>
      <p>${esc(c.asunto)} · fecha límite ${fmtFecha(c.fecha_limite)} ${etiquetaArca(c)}</p></div>
      <button class="mt-close" data-visto="${esc(c.id)}" type="button" title="Cerrar este aviso" aria-label="Cerrar aviso">✕</button></li>`).join("");

    $("dfeFooter").textContent = `${items.length} comunicaciones de muestra · ${items.filter((c) => leidaEnArca(c) === false).length} sin leer en ARCA`;
    $("dfeRows").innerHTML = items.map((c) => {
      const [etiqueta, tono] = URGENCIA[c.urgencia] || [c.urgencia, "muted"];
      const l = leidaEnArca(c);
      const accion = l === false ? `<button class="button button-quiet" data-leer="${esc(c.id)}" type="button">Marcar como leído</button>`
        : l === true ? `<button class="button button-quiet" data-contenido="${esc(c.id)}" type="button">Ver contenido</button>`
        : '<span class="mt-sub">—</span>';
      return `<tr class="${c.vista ? "dfe-vista" : ""}">
        <td><span class="mt-name">${esc(nombreDe(c.cuit))}</span><span class="mt-doc">${esc(fmtCuit(c.cuit))}</span></td>
        <td>${esc(c.asunto)}<span class="mt-sub">${esc(c.organismo)}${c.con_adjunto ? " · con adjunto" : ""} ${etiquetaArca(c)}</span></td>
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
      $("dfeMsg").textContent = `Datos de muestra al ${fmtFecha(data.fecha_muestra)}. Consultar solo detecta; abrir una comunicación («Marcar como leído» o «Ver contenido») es una acción aparte. Aquí todo es simulado.`;
      render();
      loaded = true;
    } catch (e) {
      $("dfeMsg").textContent = `No se pudo cargar la demo: ${e.message}`;
    }
  }

  $("dfeDialogClose").addEventListener("click", () => $("dfeDialog").close());

  $("dfe").addEventListener("click", (event) => {
    if (!data) return;
    const buscar = (id) => data.comunicaciones.find((x) => x.id === id);
    const visto = event.target.closest("[data-visto]");
    const leer = event.target.closest("[data-leer]");
    const ver = event.target.closest("[data-contenido]");
    if (visto) {
      const c = buscar(visto.dataset.visto);
      if (c) { c.vista = true; render(); }
    } else if (leer) {
      if (!window.confirm("En la versión real, marcar como leída avisa a ARCA que abriste la comunicación: puede darla por notificada y empezar a correr los plazos. Aquí es solo una simulación. ¿Continuar?")) return;
      const c = buscar(leer.dataset.leer);
      if (c) { c.estado_arca = "Comunicación Leída"; render(); }
    } else if (ver) {
      const c = buscar(ver.dataset.contenido);
      if (!c) return;
      $("dfeDialogTitle").textContent = c.asunto;
      $("dfeDialogBody").innerHTML = `<pre class="dfe-mensaje">${esc(c.contenido_demo)}</pre><p class="mt-detail-note">Contenido ficticio. En la versión real se muestra el texto y los adjuntos que devuelve ARCA, sin guardarlos.</p>`;
      $("dfeDialog").showModal();
    }
  });

  function route() {
    const on = location.hash === "#dfe";
    $("dfe").hidden = !on;
    if (on && !loaded) load();
  }

  window.addEventListener("hashchange", route);
  route();
})();
