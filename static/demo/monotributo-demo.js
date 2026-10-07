(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (v) => (v != null && Number.isFinite(Number(v))
    ? new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(v) : "—");
  const fmtFecha = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");
  const fmtCuit = (c) => (/^\d{11}$/.test(c) ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);
  const ORDEN = "ABCDEFGHIJK";
  const ESTADOS = {
    ok: ["En regla", "ok"], cercano: ["Cerca del tope", "warn"], excedido: ["Supera el tope", "bad"],
    sin_facturacion: ["Falta facturación", "muted"], sin_datos: ["Sin consultar", "muted"],
  };
  let loaded = false;

  function renderPeriodo(p) {
    const hasta = p.hasta < p.corte ? `${fmtFecha(p.hasta)} (fecha de muestra)` : fmtFecha(p.corte);
    $("mtPeriodo").innerHTML = `<span class="mt-period-label">PERÍODO DE CONTROL</span>
      <strong>${fmtFecha(p.desde)} al ${hasta}</strong>
      <span>Corte el ${fmtFecha(p.corte)} · próxima recategorización: ${esc(p.recategorizacion)}</span>`;
  }

  function renderAlertas(alertas) {
    $("mtAlerts").hidden = alertas.length === 0;
    $("mtAlertList").innerHTML = alertas.map((a) => `<li class="mt-alert mt-${esc(a.nivel)}">
      <div><strong>${esc(a.nombre)}</strong><span class="mt-cuit">${esc(fmtCuit(a.cuit))}</span><p>${esc(a.mensaje)}</p></div></li>`).join("");
  }


  function renderMc(mc) {
    const el = $("mtMc");
    if (!mc) { el.hidden = true; return; }
    el.hidden = false;
    const etiqueta = '<span class="mt-period-label">MIS COMPROBANTES</span>';
    if (!mc.disponible) {
      el.innerHTML = `${etiqueta}<strong>No conectado</strong><span>Definí AFIP_SCRAPER_DB en el .env con la base del scraper para sumar los emitidos en línea y analizar compras y gastos.</span>`;
      return;
    }
    if (!mc.con_datos) {
      el.innerHTML = `${etiqueta}<strong>Sin datos</strong><span>El scraper todavía no sincronizó comprobantes de este CUIT.</span>`;
      return;
    }
    const n = (x) => (x ? x.cantidad : 0);
    el.innerHTML = `${etiqueta}<strong>${n(mc.emitidos)} emitidos · ${n(mc.recibidos)} recibidos</strong>
      <span>Última sincronización: ${fmtFecha((mc.ultima_actualizacion || "").slice(0, 10))} · datos desde ${fmtFecha(mc.datos_desde)}</span>`;
  }

  function celdaCompras(c) {
    if (!c.compras) return "—";
    const r = c.compras.relacion;
    const alta = r != null && r >= c.compras.porcentaje_referencia;
    return `${money(c.compras.periodo)}<span class="mt-sub ${alta ? "mt-warn" : ""}">${r == null ? "sin facturación para comparar" : Math.round(r * 100) + "% de la facturación"}</span>`;
  }

  function subFacturacion(c) {
    if (c.facturacion_periodo == null) return "";
    const enLinea = c.facturacion_en_linea > 0 ? ` · incluye ${money(c.facturacion_en_linea)} de Comprobantes en línea` : "";
    const sync = c.sincronizado_el ? `<span class="mt-sub">Sincronizado ${fmtFecha(c.sincronizado_el)}</span>` : "";
    return `<span class="mt-sub">${esc(c.origen_facturacion)}${enLinea}</span>${sync}`;
  }

  function renderFilas(items) {
    $("mtFooter").textContent = `${items.length} CUIT de muestra`;
    $("mtRows").innerHTML = items.map((c) => {
      const [label, tone] = ESTADOS[c.estado] || [c.estado, "muted"];
      const pct = c.uso == null ? null : Math.round(c.uso * 100);
      const bar = pct == null ? "—" : `<div class="mt-bar ${tone}"><i style="width:${Math.min(pct, 100)}%"></i></div><span class="mt-pct">${pct}%</span>`;
      const sube = c.categoria_corresponde && ORDEN.indexOf(c.categoria_corresponde) > ORDEN.indexOf(c.categoria_padron);
      const baja = c.categoria_corresponde && ORDEN.indexOf(c.categoria_corresponde) < ORDEN.indexOf(c.categoria_padron);
      const corresponde = c.categoria_corresponde
        ? `<span class="mt-cat ${sube ? "diff" : baja ? "lower" : ""}">${esc(c.categoria_corresponde)}</span>` : "—";
      return `<tr>
        <td><span class="mt-name">${esc(c.nombre)}</span><span class="mt-doc">${esc(fmtCuit(c.cuit))}</span>
          <span class="mt-sub">${esc(c.actividad)} (según padrón)</span></td>
        <td><span class="mt-cat">${esc(c.categoria_padron)}</span></td>
        <td class="amount-cell">${money(c.tope)}</td>
        <td class="amount-cell">${money(c.facturacion_periodo)}${subFacturacion(c)}</td>
        <td class="amount-cell">${celdaCompras(c)}</td>
        <td class="mt-use">${bar}</td>
        <td>${corresponde}</td>
        <td><span class="mt-state ${tone}">${esc(label)}</span></td></tr>`;
    }).join("");
  }

  async function load() {
    try {
      const r = await fetch("/api/demo/monotributo");
      if (!r.ok) throw new Error(`Error HTTP ${r.status}`);
      const d = await r.json();
      $("mtEscalaMsg").textContent = `Escala de muestra vigente desde ${fmtFecha(d.escala.vigencia)}. En la versión real se lee de ARCA y una persona la aprueba antes de usarla.`;
      renderPeriodo(d.periodo);
      renderMc(d.mis_comprobantes);
      renderAlertas(d.alertas);
      renderFilas(d.contribuyentes);
      loaded = true;
    } catch (e) {
      $("mtEscalaMsg").textContent = `No se pudo cargar la demo: ${e.message}`;
    }
  }

  function route() {
    const mono = location.hash === "#monotributo";
    const dfe = location.hash === "#dfe";
    $("monotributo").hidden = !mono;
    $("history").hidden = mono || dfe;
    const destino = mono ? "#monotributo" : dfe ? "#dfe" : "#history";
    document.querySelectorAll(".sidebar .nav-item").forEach((a) => {
      const active = a.getAttribute("href") === destino;
      a.classList.toggle("active", active);
      if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    if (mono && !loaded) load();
  }

  window.addEventListener("hashchange", route);
  route();
})();
