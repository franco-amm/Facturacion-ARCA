(() => {
  "use strict";

  // Central de Notificaciones: campana global (panel rápido), indicadores del menú y vista completa (#notificaciones).
  const $ = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmtFecha = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");
  const fmtCuit = (cuit) =>
    /^\d{11}$/.test(cuit) ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}` : cuit;

  const SEVERIDAD = { alta: ["Alta", "bad"], media: ["Media", "warn"], baja: ["Baja", "ok"] };
  const ESTADO = { nuevo: ["Nuevo", "warn"], visto: ["Visto", "muted"], resuelto: ["Resuelto", "ok"] };
  const INTERVALO_MS = 30000;       // lectura de fondo: solo lee lo ya guardado por cada servicio, no consulta a ARCA
  const AVISOS_EN_PANEL = 4;

  let resumen = null;                 // activos de toda la central, para la campana y el menú
  let datosVista = null;              // lo que muestra la vista completa con sus filtros
  let filtro = { servicio: "", estado: "activos", texto: "", desde: "", hasta: "" };
  const elegidos = new Map();         // grupos que el usuario abrió o cerró a mano en la vista completa (servicio → abierto)
  let toastTimer = null;

  function toast(message, isError = false) {
    const el = $("ntfToast");
    clearTimeout(toastTimer);
    el.textContent = message;
    el.classList.toggle("error", isError);
    el.hidden = false;
    toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 9000 : 5200);
  }

  // Demo: los avisos iniciales vienen de /api/demo/notificaciones; visto y resuelto viven en este navegador (sessionStorage).
  const CLAVE_ESTADO = "ntf_demo_estado";
  const ORDEN_SEVERIDAD = { alta: 0, media: 1, baja: 2 };
  let base = null;
  let estados = {};
  try { estados = JSON.parse(sessionStorage.getItem(CLAVE_ESTADO) || "{}"); } catch (_) { estados = {}; }
  const guardarEstados = () => { try { sessionStorage.setItem(CLAVE_ESTADO, JSON.stringify(estados)); } catch (_) { /* sin storage: queda en memoria */ } };

  async function cargarBase() {
    if (!base) {
      const respuesta = await fetch("/api/demo/notificaciones");
      if (!respuesta.ok) throw new Error(`Error HTTP ${respuesta.status}`);
      base = await respuesta.json();
    }
    return base;
  }

  function vistaLocal(todos, servicios, q) {
    const servicio = q.get("servicio") || "";
    const filtroEstado = q.get("estado") || "activos";
    const desde = q.get("desde") || "";
    const hasta = q.get("hasta") || "";
    const activos = todos.filter((a) => a.estado !== "resuelto");
    const nuevos = activos.filter((a) => a.estado === "nuevo");
    const pasa = (a) => {
      if (servicio && a.servicio !== servicio) return false;
      if (filtroEstado === "activos" ? a.estado === "resuelto" : a.estado !== filtroEstado) return false;
      const fecha = (a.fecha_hecho || a.detectado_el || "").slice(0, 10);
      if (desde && fecha && fecha < desde) return false;
      if (hasta && fecha && fecha > hasta) return false;
      return true;
    };
    const avisos = todos.filter(pasa).sort((x, y) => (y.fecha_hecho || "").localeCompare(x.fecha_hecho || ""));
    avisos.sort((x, y) => (ORDEN_SEVERIDAD[x.severidad] ?? 3) - (ORDEN_SEVERIDAD[y.severidad] ?? 3) || (x.estado !== "nuevo") - (y.estado !== "nuevo"));
    const por_servicio = {};
    Object.entries(servicios).forEach(([clave, etiqueta]) => {
      const propios = nuevos.filter((a) => a.servicio === clave);
      por_servicio[clave] = {
        etiqueta, nuevos: propios.length, activos: activos.filter((a) => a.servicio === clave).length,
        alta_nuevos: propios.filter((a) => a.severidad === "alta").length,
      };
    });
    return {
      avisos, servicios, errores: {}, ultima_actualizacion: base.ultima_actualizacion,
      conteo: { nuevos: nuevos.length, activos: activos.length, alta_nuevos: nuevos.filter((a) => a.severidad === "alta").length, por_servicio },
    };
  }

  async function api(url, options) {
    const datos = await cargarBase();
    const u = new URL(url, location.origin);
    const ruta = u.pathname.replace(/^\/notificaciones/, "");
    const metodo = ((options && options.method) || "GET").toUpperCase();
    const todos = datos.avisos.map((a) => ({ ...a, estado: estados[a.id] || a.estado }));
    if (metodo === "GET") return vistaLocal(todos, datos.servicios, u.searchParams);
    if (ruta === "/actualizar") return { nuevos: [], reabiertos: [], resueltos: [], errores: {} };
    if (ruta === "/lote") {
      const { accion, servicio } = JSON.parse(options.body);
      let n = 0;
      todos.forEach((a) => {
        if (a.servicio !== servicio) return;
        if (accion === "visto" && a.estado === "nuevo") { estados[a.id] = "visto"; n += 1; }
        if (accion === "resuelto" && a.estado !== "resuelto") { estados[a.id] = "resuelto"; n += 1; }
      });
      guardarEstados();
      return { status: "ok", actualizados: n };
    }
    const m = ruta.match(/^\/([^/]+)\/(visto|resuelto)$/);
    if (m) {
      const aviso = todos.find((a) => a.id === decodeURIComponent(m[1]));
      if (!aviso) throw new Error("Aviso inexistente");
      if (m[2] === "resuelto" || aviso.estado === "nuevo") estados[aviso.id] = m[2];
      guardarEstados();
      return { status: "ok", actualizados: 1 };
    }
    throw new Error("Acción no disponible en la demo");
  }

  const nombreDe = (a) => a.nombre || fmtCuit(a.cuit);
  const etiquetaSeveridad = (a) => {
    const par = SEVERIDAD[a.severidad];
    return par ? `<span class="mt-state ${par[1]}">${par[0]}</span>` : "";
  };

  // ------------------------------------------------------------------ Campana e indicadores del menú
  function renderCampana() {
    const c = resumen?.conteo;
    const nuevos = c?.nuevos || 0;
    const boton = $("ntfBell");
    const badge = $("ntfCount");
    badge.hidden = nuevos === 0;
    badge.textContent = nuevos > 99 ? "99+" : String(nuevos);
    badge.classList.toggle("ntf-alta", (c?.alta_nuevos || 0) > 0);
    boton.setAttribute("aria-label", nuevos ? `Notificaciones: ${nuevos} nueva${nuevos === 1 ? "" : "s"}` : "Notificaciones: sin avisos nuevos");
  }

  function renderMenu() {
    document.querySelectorAll("[data-ntf-servicio]").forEach((el) => {
      const s = resumen?.conteo?.por_servicio?.[el.dataset.ntfServicio];
      const n = s?.nuevos || 0;
      el.hidden = n === 0;
      el.textContent = String(n);
      el.classList.toggle("ntf-alta", (s?.alta_nuevos || 0) > 0);
      el.title = `${n} aviso${n === 1 ? "" : "s"} nuevo${n === 1 ? "" : "s"}: ver en Notificaciones`;
    });
  }

  function renderPanel() {
    const nuevos = (resumen?.avisos || []).filter((a) => a.estado === "nuevo");
    const etiquetas = resumen?.servicios || {};
    const grupos = Object.keys(etiquetas)
      .map((servicio) => [servicio, nuevos.filter((a) => a.servicio === servicio)])
      .filter(([, lista]) => lista.length);
    $("ntfPanelBody").innerHTML = grupos.length
      ? grupos.map(([servicio, lista]) => `
          <section class="ntf-grupo-rapido">
            <header><h3>${esc(etiquetas[servicio])} <span class="ntf-n">${lista.length}</span></h3>
              <button class="button button-quiet" type="button" data-lote="visto|${esc(servicio)}">Marcar vistos</button></header>
            <ul>${lista.slice(0, AVISOS_EN_PANEL).map((a) => `
              <li><button class="ntf-item" type="button" data-ir="${esc(a.id)}">
                <span class="ntf-item-top">${etiquetaSeveridad(a)}<strong>${esc(a.titulo)}</strong></span>
                <span class="ntf-item-sub">${esc(nombreDe(a))}${a.detalle ? ` · ${esc(a.detalle)}` : ""}</span>
              </button></li>`).join("")}
            </ul>
            ${lista.length > AVISOS_EN_PANEL
              ? `<button class="ntf-mas" type="button" data-abrir="${esc(servicio)}">y ${lista.length - AVISOS_EN_PANEL} más en ${esc(etiquetas[servicio])}</button>` : ""}
          </section>`).join("")
      : '<p class="ntf-vacio">No hay avisos nuevos.</p>';
  }

  async function cargarResumen() {
    try {
      resumen = await api("/notificaciones");
      renderCampana();
      renderMenu();
      if (!$("ntfPanel").hidden) renderPanel();
    } catch (error) {
      // La campana no debe molestar si el servidor no responde: queda con lo último que mostró.
    }
  }

  function abrirPanel(abrir) {
    $("ntfPanel").hidden = !abrir;
    $("ntfBell").setAttribute("aria-expanded", String(abrir));
    if (abrir) { renderPanel(); cargarResumen(); }
  }

  // ------------------------------------------------------------------ Vista completa
  function lecturaFiltros() {
    filtro = {
      servicio: $("ntfServicio").value, estado: $("ntfEstado").value,
      texto: $("ntfTexto").value.trim().toLowerCase(), desde: $("ntfDesde").value, hasta: $("ntfHasta").value,
    };
  }

  function escribirFiltros() {
    $("ntfServicio").value = filtro.servicio;
    $("ntfEstado").value = filtro.estado;
    $("ntfTexto").value = filtro.texto;
    $("ntfDesde").value = filtro.desde;
    $("ntfHasta").value = filtro.hasta;
  }

  // «Actualizado hace 3 min» mientras sea reciente; pasado un día, la fecha.
  function textoActualizado(iso) {
    const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (!Number.isFinite(minutos) || minutos < 0 || minutos >= 1440) return `actualizado ${fmtFecha(iso)} ${iso.slice(11, 16)}`;
    if (minutos < 1) return "actualizado recién";
    if (minutos < 60) return `actualizado hace ${minutos} min`;
    return `actualizado hace ${Math.floor(minutos / 60)} h`;
  }

  function renderCompleta() {
    const etiquetas = datosVista.servicios;
    const selector = $("ntfServicio");
    if (selector.options.length <= 1) {
      selector.innerHTML = '<option value="">Todos los servicios</option>'
        + Object.entries(etiquetas).map(([clave, nombre]) => `<option value="${esc(clave)}">${esc(nombre)}</option>`).join("");
      selector.value = filtro.servicio;
    }
    const texto = filtro.texto;
    const avisos = datosVista.avisos.filter((a) =>
      !texto || `${a.nombre} ${a.cuit} ${a.titulo} ${a.detalle}`.toLowerCase().includes(texto));
    const c = datosVista.conteo;
    $("ntfResumen").textContent = `${c.nuevos} nuevo${c.nuevos === 1 ? "" : "s"} · ${c.activos} activo${c.activos === 1 ? "" : "s"}`
      + (datosVista.ultima_actualizacion ? ` · ${textoActualizado(datosVista.ultima_actualizacion)}` : "");
    $("ntfVacio").hidden = avisos.length > 0;
    $("ntfGrupos").innerHTML = Object.keys(etiquetas)
      .map((servicio) => [servicio, avisos.filter((a) => a.servicio === servicio)])
      .filter(([, lista]) => lista.length)
      .map(([servicio, lista]) => {
        const cuits = new Set(lista.map((a) => a.cuit)).size;
        const nuevos = lista.filter((a) => a.estado === "nuevo").length;
        const abierto = elegidos.has(servicio) ? elegidos.get(servicio) : filtro.servicio === servicio;   // por defecto colapsados, salvo el servicio filtrado
        return `<details class="ntf-grupo" data-grupo="${esc(servicio)}" ${abierto ? "open" : ""}>
          <summary><strong>${esc(etiquetas[servicio])}</strong>
            <span>${cuits} CUIT${cuits === 1 ? "" : "s"} con novedades · ${lista.length} aviso${lista.length === 1 ? "" : "s"}${nuevos ? ` · <b>${nuevos} nuevo${nuevos === 1 ? "" : "s"}</b>` : ""}</span>
          <div class="ntf-lote">
            <button class="ntf-icon ntf-icon-lote" type="button" data-lote="visto|${esc(servicio)}" data-tip="Marcar todo como visto" aria-label="Marcar todo como visto">${SVG_VISTO}</button>
            <button class="ntf-icon ntf-icon-lote" type="button" data-lote="resuelto|${esc(servicio)}" data-tip="Resolver todo" aria-label="Resolver todo">${SVG_RESOLVER}</button>
          </div></summary>
          <div class="table-wrap"><table>
            <thead><tr><th>Cliente</th><th>Aviso</th><th>Fecha</th><th>Severidad</th><th>Estado</th><th></th></tr></thead>
            <tbody>${lista.map(filaAviso).join("")}</tbody></table></div>
        </details>`;
      }).join("");
  }

  const SVG_VISTO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const SVG_RESOLVER = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  const SVG_ORIGEN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>';

  function filaAviso(a) {
    const [etiqueta, tono] = ESTADO[a.estado] || [a.estado, "muted"];
    const icono = (attr, titulo, svg, extra = "") =>
      `<button class="ntf-icon" type="button" ${attr}="${esc(a.id)}" ${extra} data-tip="${titulo}" aria-label="${titulo}">${svg}</button>`;
    const SVG_WA = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.7-5.2A8.5 8.5 0 1 1 21 12z"/></svg>';
    const conWa = a.servicio === "dfe" || a.servicio === "monotributo";
    const wa = conWa ? icono("data-wa", "Notificar por WhatsApp", SVG_WA) : '<span class="ntf-icon ntf-hueco"></span>';
    const origen = icono("data-ir", "Ir al origen", SVG_ORIGEN, a.estado === "resuelto" ? 'data-solo-ir="1"' : "");
    const acciones = a.estado === "resuelto"
      ? `<span class="ntf-icon ntf-hueco"></span><span class="ntf-icon ntf-hueco"></span><span class="ntf-icon ntf-hueco"></span>${origen}`
      : `${a.estado === "nuevo" ? icono("data-visto", "Marcar como visto", SVG_VISTO) : '<span class="ntf-icon ntf-hueco"></span>'}
         ${icono("data-resolver", "Resolver", SVG_RESOLVER)}
         ${wa}
         ${origen}`;
    return `<tr class="ntf-${esc(a.estado)}">
      <td><span class="recipient-name">${esc(a.nombre || "Sin nombre")}</span><span class="recipient-doc">${esc(fmtCuit(a.cuit))}</span></td>
      <td>${esc(a.titulo)}${a.detalle ? `<span class="mt-sub">${esc(a.detalle)}</span>` : ""}</td>
      <td>${fmtFecha(a.fecha_hecho)}</td>
      <td>${etiquetaSeveridad(a) || '<span class="mt-sub">—</span>'}</td>
      <td><span class="mt-state ${tono}">${etiqueta}</span></td>
      <td class="mt-actions">${acciones}</td></tr>`;
  }

  function consulta() {
    const q = new URLSearchParams();
    if (filtro.servicio) q.set("servicio", filtro.servicio);
    if (filtro.estado) q.set("estado", filtro.estado);
    if (filtro.desde) q.set("desde", filtro.desde);
    if (filtro.hasta) q.set("hasta", filtro.hasta);
    const texto = q.toString();
    return texto ? `/notificaciones?${texto}` : "/notificaciones";
  }

  async function cargarVista(forzar = false) {
    try {
      if (forzar) await api("/notificaciones/actualizar", { method: "POST" });
      datosVista = await api(consulta());
      renderCompleta();
      const errores = Object.keys(datosVista.errores || {});
      if (errores.length) toast(`No se pudo leer: ${errores.join(", ")}. Los avisos de ese servicio quedan como estaban.`, true);
      if (forzar) { resumen = null; await cargarResumen(); }
    } catch (error) {
      toast(error.message, true);
    }
  }

  // ------------------------------------------------------------------ Acciones
  const buscar = (id) => [...(datosVista?.avisos || []), ...(resumen?.avisos || [])].find((a) => a.id === id);

  async function recargar() {
    await cargarResumen();
    if (location.hash === "#notificaciones") await cargarVista();
    if (!$("ntfPanel").hidden) renderPanel();
  }

  async function ir(id, soloIr) {
    const aviso = buscar(id);
    if (!aviso) return;
    if (!soloIr && aviso.estado === "nuevo") await api(`/notificaciones/${encodeURIComponent(id)}/visto`, { method: "POST" });
    abrirPanel(false);
    location.hash = `#${aviso.origen}`;
    cargarResumen();
  }

  async function accionLote(valor) {
    const [accion, servicio] = valor.split("|");
    if (accion === "resuelto" && !window.confirm("¿Resolver todos los avisos de este servicio? Podés consultarlos después en el historial (estado «Resuelto»).")) return;
    const r = await api("/notificaciones/lote", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion, servicio }),
    });
    toast(`${r.actualizados} aviso${r.actualizados === 1 ? "" : "s"} ${accion === "visto" ? "marcado" : "resuelto"}${r.actualizados === 1 ? "" : "s"}.`);
    await recargar();
  }

  async function con(boton, accion) {
    if (boton) boton.disabled = true;
    try { await accion(); } catch (error) { toast(error.message, true); } finally { if (boton) boton.disabled = false; }
  }

  function manejarClick(event) {
    const t = event.target;
    const ver = t.closest("[data-ir]");
    const visto = t.closest("[data-visto]");
    const resolver = t.closest("[data-resolver]");
    const lote = t.closest("[data-lote]");
    const abrirServicio = t.closest("[data-abrir]");
    const wa = t.closest("[data-wa]");
    if (wa) {
      const aviso = buscar(wa.dataset.wa);
      if (aviso && window.WaFakedoor) window.WaFakedoor.abrirAviso(aviso.servicio === "dfe" ? "dfe" : "mt", nombreDe(aviso), aviso.servicio === "dfe" ? aviso.titulo : aviso.detalle);
    } else if (ver) con(ver, () => ir(ver.dataset.ir, ver.dataset.soloIr === "1"));
    else if (visto) con(visto, async () => { await api(`/notificaciones/${encodeURIComponent(visto.dataset.visto)}/visto`, { method: "POST" }); await recargar(); });
    else if (resolver) con(resolver, async () => { await api(`/notificaciones/${encodeURIComponent(resolver.dataset.resolver)}/resuelto`, { method: "POST" }); await recargar(); });
    else if (lote) { event.preventDefault(); con(lote, () => accionLote(lote.dataset.lote)); }
    else if (abrirServicio) abrir(abrirServicio.dataset.abrir);
  }

  // ------------------------------------------------------------------ Navegación
  function abrir(servicio) {
    filtro = { servicio: servicio || "", estado: "activos", texto: "", desde: "", hasta: "" };
    abrirPanel(false);
    if (location.hash === "#notificaciones") route(); else location.hash = "#notificaciones";
  }
  window.Notificaciones = { abrir };

  function route() {
    const on = location.hash === "#notificaciones";
    $("notificaciones").hidden = !on;
    if (on) { escribirFiltros(); cargarVista(true); }
  }

  document.addEventListener("click", (event) => {
    if (!$("ntfPanel").hidden && !event.target.closest("#ntfPanel, #ntfBell")) abrirPanel(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("ntfPanel").hidden) { abrirPanel(false); $("ntfBell").focus(); }
  });
  $("ntfBell").addEventListener("click", () => abrirPanel($("ntfPanel").hidden));
  $("ntfVerTodo").addEventListener("click", () => abrir(""));
  $("ntfPanel").addEventListener("click", manejarClick);
  $("notificaciones").addEventListener("click", manejarClick);
  $("notificaciones").addEventListener("toggle", (event) => {
    const grupo = event.target.closest?.("[data-grupo]");
    if (!grupo) return;
    elegidos.set(grupo.dataset.grupo, grupo.open);
  }, true);
  document.querySelectorAll("[data-ntf-servicio]").forEach((el) => {
    const ir = (event) => { event.preventDefault(); event.stopPropagation(); abrir(el.dataset.ntfServicio); };
    el.addEventListener("click", ir);
    el.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") ir(event); });
  });
  ["ntfServicio", "ntfEstado", "ntfDesde", "ntfHasta"].forEach((id) =>
    $(id).addEventListener("change", () => { lecturaFiltros(); cargarVista(); }));
  $("ntfTexto").addEventListener("input", () => { lecturaFiltros(); if (datosVista) renderCompleta(); });

  window.addEventListener("hashchange", () => { route(); if (location.hash !== "#notificaciones") cargarResumen(); });

  // La Central se mantiene al día sola (no hay botón «Actualizar»):
  //  1. cuando otra pestaña termina una consulta o sincronización (cualquier pedido que modifica datos);
  //  2. al volver a la ventana; 3. cada INTERVALO_MS mientras la ventana está visible; 4. al entrar a #notificaciones.
  let pendienteRefresco = null;
  async function refrescar() {
    try { await api("/notificaciones/actualizar", { method: "POST" }); } catch (error) { /* la lectura normal sigue su curso */ }
    await cargarResumen();
    if (location.hash === "#notificaciones") await cargarVista();
  }
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async (entrada, opciones) => {
    const respuesta = await fetchOriginal(entrada, opciones);
    try {
      const metodo = String((opciones && opciones.method) || (entrada && entrada.method) || "GET").toUpperCase();
      const url = new URL(typeof entrada === "string" ? entrada : entrada.url, location.origin);
      if (metodo !== "GET" && url.origin === location.origin && !/\/notificaciones(\/|$)/.test(url.pathname)) {
        clearTimeout(pendienteRefresco);
        pendienteRefresco = setTimeout(refrescar, 1500);   // junta varios pedidos seguidos en una sola lectura
      }
    } catch (_) { /* un pedido raro no debe romper al resto de la app */ }
    return respuesta;
  };
  async function alDia() {
    await cargarResumen();
    if (location.hash === "#notificaciones") await cargarVista();   // también renueva el «actualizado hace…»
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") alDia(); });
  setInterval(() => { if (document.visibilityState === "visible") alDia(); }, INTERVALO_MS);
  cargarResumen();
  route();
})();
