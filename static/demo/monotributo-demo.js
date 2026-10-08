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

  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const fmtMes = (ym) => `${MESES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
  const expandidos = new Set();

  function detalleCierre(f) {
    if (!f) return '<p class="mt-detail-note">Todavía no hay una ventana cerrada con datos automáticos de este CUIT.</p>';
    const rel = f.relacion_compras == null ? "—" : `${Math.round(f.relacion_compras * 100)}%`;
    const uso = f.uso == null ? "—" : `${Math.round(f.uso * 100)}%`;
    const estado = (ESTADOS[f.estado] || [f.estado])[0];
    return `<dl class="mt-snap">
      <div><dt>Ventana cerrada</dt><dd>${fmtFecha(f.desde)} al ${fmtFecha(f.corte)} · recategorización de ${esc(f.recategorizacion)}</dd></div>
      <div><dt>Facturación</dt><dd>${money(f.facturacion)} <span class="mt-sub">${esc(f.origen)}</span></dd></div>
      <div><dt>Compras y gastos</dt><dd>${money(f.compras)} <span class="mt-sub">${rel} de la facturación</span></dd></div>
      <div><dt>Categoría y tope</dt><dd>${f.categoria ? esc(f.categoria) : "—"} · ${money(f.tope)} <span class="mt-sub">uso ${uso} · ${esc(estado)}${f.categoria_corresponde ? " · correspondía " + esc(f.categoria_corresponde) : ""}</span></dd></div>
      <div><dt>Escala aplicada</dt><dd>vigente desde ${esc(f.escala_vigencia || "—")} <span class="mt-sub">${f.provisoria ? "Foto provisoria: se actualiza hasta que cambie la ventana" : f.tardia ? "Calculada después del cierre, con la escala vigente en ese momento" : "Foto fija al cierre"}</span></dd></div>
    </dl>`;
  }

  function detalleMensual(m) {
    if (!m) return '<p class="mt-detail-note">Sin comprobantes automáticos para desglosar por mes.</p>';
    const a = m.ventanas.activa, b = m.ventanas.alterna;
    const marca = (f, k) => (f.cuenta_para.includes(k) ? '<span class="mt-check" aria-label="cuenta">●</span>' : '<span class="mt-dash">·</span>');
    const filas = m.meses.map((f) => `<tr>
        <td>${esc(fmtMes(f.mes))}</td>
        <td class="amount-cell">${f.futuro ? "—" : money(f.facturacion)}</td>
        <td class="amount-cell">${f.futuro ? "—" : money(f.compras)}</td>
        <td class="mt-mark">${marca(f, "activa")}</td>
        <td class="mt-mark">${marca(f, "alterna")}</td></tr>`).join("");
    const total = (v, etiqueta) => `<tr class="mt-total"><td>${esc(etiqueta)}</td>
        <td class="amount-cell">${money(v.facturacion)}</td><td class="amount-cell">${money(v.compras)}</td><td colspan="2" class="mt-sub">${fmtFecha(v.desde)} al ${fmtFecha(v.corte)}</td></tr>`;
    return `<table class="mt-month-table">
      <thead><tr><th>Mes</th><th class="amount-cell">Facturación</th><th class="amount-cell">Compras</th>
        <th class="mt-mark">Recat. ${esc(a.recategorizacion)}</th><th class="mt-mark">Recat. ${esc(b.recategorizacion)}</th></tr></thead>
      <tbody>${filas}</tbody>
      <tfoot>${total(m.ventanas.activa, "Total " + a.recategorizacion)}${total(m.ventanas.alterna, "Acumulado " + b.recategorizacion)}</tfoot>
    </table>`;
  }

  function filaDetalle(c) {
    return `<tr class="mt-detail-row"><td colspan="9"><div class="mt-detail">
      <section><h3>Cierre anterior</h3>${detalleCierre(c.cierre_anterior)}</section>
      <section><h3>Mes a mes</h3>${detalleMensual(c.mensual)}</section>
    </div></td></tr>`;
  }

  let ultimos = [];

  function renderFilas(items) {
    ultimos = items;
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
        <td><span class="mt-state ${tone}">${esc(label)}</span></td>
        <td class="mt-actions"><button class="button button-quiet" data-detalle="${esc(c.cuit)}" type="button" aria-expanded="${expandidos.has(c.cuit)}">${expandidos.has(c.cuit) ? "Ocultar" : "Detalle"}</button></td>
      </tr>${expandidos.has(c.cuit) ? filaDetalle(c) : ""}`;
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

  $("mtRows").addEventListener("click", (event) => {
    const boton = event.target.closest("[data-detalle]");
    if (!boton) return;
    const cuit = boton.dataset.detalle;
    if (expandidos.has(cuit)) expandidos.delete(cuit); else expandidos.add(cuit);
    renderFilas(ultimos);
  });

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
