(() => {
  "use strict";
  // Configuraciones (demo): alta de clientes y servicios por cliente, todo simulado en el navegador (no se guarda nada).
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmtCuit = (c) => (/^\d{11}$/.test(c) ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);
  const fmtFecha = (iso) => {
    if (!iso) return "nunca";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
  };
  const MC_ERROR = { clave_incorrecta: "ARCA rechazó la clave", segundo_factor: "pide un segundo factor", portal: "el portal falló; se reintenta esta noche", otro: "error al sincronizar" };
  const SERVICIOS = [["comprobantes", "Comprobantes"], ["monotributo", "Monotributo"], ["domicilio_fiscal", "Domicilio fiscal"], ["ccma", "CCMA"]];
  let clientes = [];
  let loaded = false;
  let toastTimer = null;

  function toast(texto) {
    const el = $("cfgToast");
    el.textContent = texto;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 5200);
  }

  function estado(c) {
    switch (c.estado) {
      case "ok": return ['<span class="cfg-estado ok">Sincronizado</span>', `Última: ${fmtFecha(c.ultima_sincronizacion)}`];
      case "sincronizando": return ['<span class="cfg-estado warn">Sincronizando…</span>', "Puede tardar unos minutos"];
      case "bloqueado": return ['<span class="cfg-estado bad">Clave rechazada</span>', "Cargá la clave correcta para reactivarlo"];
      case "error": return ['<span class="cfg-estado bad">Con error</span>', `${MC_ERROR[c.error_tipo] || MC_ERROR.otro} · ${fmtFecha(c.ultima_sincronizacion)}`];
      default: return ['<span class="cfg-estado muted">Sin sincronizar</span>', "Se sincroniza esta noche, o usá «Sincronizar ahora»"];
    }
  }

  function render() {
    const lista = $("cfgMcList");
    if (!clientes.length) {
      lista.innerHTML = '<p class="emisor-note">Todavía no hay clientes. Agregá el primero con su CUIT.</p>';
      return;
    }
    lista.innerHTML = clientes.map((c) => {
      const [etiqueta, detalle] = estado(c);
      const ocupado = c.estado === "sincronizando";
      return `<div class="cfg-cliente-row">
        <div><strong>${esc(c.nombre || fmtCuit(c.cuit))}</strong> <span class="emisor-cuit">${esc(fmtCuit(c.cuit))}</span><br>
          ${etiqueta} <small class="gr-estado">${esc(detalle)} · ${c.emitidos} emitidos · ${c.recibidos} recibidos</small></div>
        <div class="cfg-cliente-actions">
          <button class="button button-secondary" data-sync="${esc(c.cuit)}" type="button"${ocupado || c.estado === "bloqueado" ? " disabled" : ""}>Sincronizar ahora</button>
          <button class="button button-quiet" data-clave="${esc(c.cuit)}" type="button">Cambiar clave</button>
          <button class="cfg-remove" data-del="${esc(c.cuit)}" type="button" aria-label="Quitar ${esc(c.cuit)}"${ocupado ? " disabled" : ""}>×</button>
        </div>
        <div class="cfg-servicios" role="group" aria-label="Servicios de ${esc(fmtCuit(c.cuit))}">
          <span class="cfg-servicios-label">Servicios</span>
          ${SERVICIOS.map(([clave, nombre]) => `<label class="cfg-servicio"><input type="checkbox" data-servicio="${clave}" data-cuit="${esc(c.cuit)}"${c.servicios[clave] === false ? "" : " checked"}${ocupado ? " disabled" : ""}> ${nombre}</label>`).join("")}
        </div>
      </div>`;
    }).join("");
  }

  async function load() {
    try {
      const r = await fetch("/assets/configuraciones-demo.json", { cache: "no-store" });
      if (!r.ok) throw new Error(`Error HTTP ${r.status}`);
      clientes = (await r.json()).clientes;
      loaded = true;
      render();
    } catch (e) {
      $("cfgMcList").innerHTML = `<p class="emisor-note">No se pudo cargar la demo: ${esc(e.message)}</p>`;
    }
  }

  $("cfgMcAddToggle").addEventListener("click", () => {
    const abrir = $("cfgMcForm").hidden;
    $("cfgMcForm").hidden = !abrir;
    $("cfgMcAddToggle").setAttribute("aria-expanded", String(abrir));
    if (abrir) $("cfgMcCuit").focus();
  });

  $("cfgMcForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const cuit = $("cfgMcCuit").value.replace(/\D/g, "");
    if (cuit.length !== 11) { toast("El CUIT debe tener 11 dígitos."); return; }
    const existente = clientes.find((c) => c.cuit === cuit);
    if (existente) {
      existente.estado = "sin_sincronizar";
      toast("Clave actualizada (simulado). Podés volver a sincronizarlo.");
    } else {
      clientes.push({ cuit, nombre: "Cliente nuevo (demo)", estado: "sin_sincronizar", ultima_sincronizacion: null, emitidos: 0, recibidos: 0,
        servicios: { comprobantes: true, monotributo: true, domicilio_fiscal: true, ccma: true } });
      toast("Cliente agregado (simulado). En la versión real se sincroniza esta noche, o con «Sincronizar ahora». Recordá que debe delegar Domicilio fiscal en ARCA.");
    }
    event.target.reset();
    $("cfgMcForm").hidden = true;
    $("cfgMcAddToggle").setAttribute("aria-expanded", "false");
    render();
  });

  $("cfgMcList").addEventListener("click", (event) => {
    const sync = event.target.closest("[data-sync]");
    const clave = event.target.closest("[data-clave]");
    const quitar = event.target.closest("[data-del]");
    if (sync) {
      const c = clientes.find((x) => x.cuit === sync.dataset.sync);
      if (!c) return;
      c.estado = "sincronizando";
      render();
      toast("Sincronización simulada: no se conecta a ARCA.");
      setTimeout(() => { c.estado = "ok"; c.ultima_sincronizacion = new Date().toISOString(); render(); }, 2200);
    } else if (clave) {
      $("cfgMcForm").hidden = false;
      $("cfgMcAddToggle").setAttribute("aria-expanded", "true");
      $("cfgMcCuit").value = clave.dataset.clave;
      $("cfgMcCuit").focus();
    } else if (quitar && window.confirm("¿Quitar este cliente? (simulado: solo cambia esta pantalla)")) {
      clientes = clientes.filter((x) => x.cuit !== quitar.dataset.del);
      toast("Cliente quitado (simulado).");
      render();
    }
  });

  // Encender o apagar un servicio de un cliente (en la versión real, apagarlo deja de consultarlo y de generar sus avisos).
  $("cfgMcList").addEventListener("change", (event) => {
    const caja = event.target.closest("[data-servicio]");
    if (!caja) return;
    const c = clientes.find((x) => x.cuit === caja.dataset.cuit);
    const nombre = (SERVICIOS.find(([clave]) => clave === caja.dataset.servicio) || [])[1] || caja.dataset.servicio;
    if (!c) return;
    if (!caja.checked && !window.confirm(`¿Apagar ${nombre} para este cliente?\n\nEn la versión real deja de consultarse y sus avisos dejan de generarse en la Central de Notificaciones. Aquí es solo una simulación.`)) {
      caja.checked = true;
      return;
    }
    c.servicios[caja.dataset.servicio] = caja.checked;
    toast(caja.checked ? `${nombre} encendido (simulado).` : `${nombre} apagado (simulado). Sus datos se conservan ocultos.`);
  });

  function route() {
    const on = location.hash === "#configuraciones";
    $("configuraciones").hidden = !on;
    if (on && !loaded) load();
  }

  window.addEventListener("hashchange", route);
  route();
})();
