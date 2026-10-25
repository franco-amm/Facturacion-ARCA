(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmtCuit = (cuit) =>
    /^\d{11}$/.test(cuit) ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}` : cuit;
  const fmtFecha = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");
  const pesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
  const money = (n) => (n == null ? "—" : pesos.format(n));
  const pct = (uso) => (uso == null ? null : Math.round(uso * 1000) / 10);
  const fmtPct = (uso) => (uso == null ? "—" : `${pct(uso).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);

  const ESTADOS = {
    revisar: ["Revisar", "bad"],
    atencion: ["Atención", "warn"],
    al_dia: ["Al día", "ok"],
    sin_datos: ["Sin datos", "muted"],
  };
  const FILTROS = [
    ["todos", "Clientes", () => true],
    ["deuda", "Con deuda ARCA", (f) => f.deuda_arca > 0],
    ["uso_alto", "Utilización desde 85%", (f) => f.uso != null && f.uso >= 0.85,
      "Clientes cuya facturación del período de recategorización ya llegó al 85% o más del tope anual de su categoría actual. Están cerca de tener que subir de categoría o de superar el tope."],
    ["suben", "Suben de categoría", (f) => f.sube_categoria],
    ["sin_datos", "Sin datos", (f) => f.estado === "sin_datos"],
  ];

  let filas = [];
  let filtro = "todos";
  let busqueda = "";
  let detalle = null;   // CUIT abierto en la vista de detalle

  async function cargar() {
    const respuesta = await fetch("/api/demo/resumen/clientes");
    if (!respuesta.ok) throw new Error(`Error HTTP ${respuesta.status}`);
    filas = (await respuesta.json()).clientes;
    render();
  }

  function visibles() {
    const pasa = FILTROS.find(([id]) => id === filtro)[2];
    const q = busqueda.trim().toLowerCase();
    return filas.filter((f) => pasa(f) && (!q || `${f.nombre} ${f.cuit}`.toLowerCase().includes(q)));
  }

  function celdaSync(f) {
    const fact = f.sincronizado_el
      ? `<span class="${f.desactualizado ? "rs-viejo" : ""}" title="${f.desactualizado ? "Más de 3 días sin sincronizar" : "Última sincronización de Mis Comprobantes"}">${esc(fmtFecha(f.sincronizado_el))}</span>`
      : "—";
    const deuda = f.deuda_consultada_el ? esc(fmtFecha(f.deuda_consultada_el)) : "—";
    return `<span class="rs-fecha"><em>Facturación al</em> ${fact}</span>
      <span class="rs-fecha"><em>Deuda al</em> ${deuda}</span>${f.sincronizacion_error ? '<span class="mt-sub mt-warn">Último intento falló</span>' : ""}`;
  }

  function render() {
    $("rsFiltros").innerHTML = FILTROS.map(([id, label, pasa, ayuda]) =>
      `<button type="button" class="rs-filtro" data-filtro="${id}" aria-pressed="${id === filtro}"><strong>${filas.filter(pasa).length}</strong><span>${label}</span>${ayuda ? `<span class="rs-info" aria-hidden="true">i<span class="rs-tip">${esc(ayuda)}</span></span>` : ""}</button>`).join("");
    const items = visibles();
    $("rsEmpty").hidden = items.length > 0;
    if (!items.length) {
      $("rsEmpty").innerHTML = filas.length
        ? "<strong>Sin resultados</strong><p>Ningún cliente coincide con el filtro.</p>"
        : "<strong>Sin clientes</strong><p>Agregá CUIT en Monotributo para verlos acá.</p>";
    }
    $("rsFooter").textContent = `${items.length} de ${filas.length} clientes`;
    $("rsRows").innerHTML = items.map((f) => {
      const [label, tono] = ESTADOS[f.estado] || [f.estado, "muted"];
      const p = pct(f.uso);
      const barra = p == null ? "—"
        : `<div class="mt-bar ${f.uso >= 0.95 ? "bad" : f.uso >= 0.85 ? "warn" : ""}"><i style="width:${Math.min(p, 100)}%"></i></div><span class="mt-pct">${fmtPct(f.uso)}</span>`;
      const proy = f.sube_categoria ? `<span class="mt-trend" aria-hidden="true">→</span><span class="mt-cat diff" title="Subiría con el límite proyectado">${esc(f.categoria_proyectada)}</span>` : "";
      return `<tr>
        <td><span class="recipient-name">${esc(f.nombre || fmtCuit(f.cuit))}</span>${f.nombre ? `<span class="recipient-doc">${esc(fmtCuit(f.cuit))}</span>` : ""}</td>
        <td>${f.categoria ? `<span class="mt-cat">${esc(f.categoria)}</span>` : "—"}${proy}</td>
        <td class="mt-use">${barra}</td>
        <td class="amount-cell">${money(f.deuda_arca)}</td>
        <td>${celdaSync(f)}</td>
        <td><span class="mt-state ${tono}"${f.motivo ? ` title="${esc(f.motivo)}"` : ""}>${esc(label)}</span></td>
        <td class="mt-actions"><button class="button button-quiet" type="button" data-detalle="${esc(f.cuit)}" >Detalles</button></td>
      </tr>`;
    }).join("");
  }

  $("rsFiltros").addEventListener("click", (event) => {
    const boton = event.target.closest("[data-filtro]");
    if (!boton || event.target.closest(".rs-info")) return;   // el ícono de ayuda no cambia el filtro
    filtro = boton.dataset.filtro;
    render();
  });
  $("rsBuscar").addEventListener("input", (event) => { busqueda = event.target.value; render(); });
  $("rsRows").addEventListener("click", (event) => {
    const boton = event.target.closest("[data-detalle]");
    if (boton) abrirDetalle(boton.dataset.detalle);
  });
  $("rsDetalle").addEventListener("click", (event) => {
    if (event.target.closest("[data-volver]")) cerrarDetalle();
  });

  // ---- Vista de detalle -------------------------------------------------
  const mesCorto = (ym) => ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][Number(ym.slice(5, 7)) - 1];
  const compacto = (n) => new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 }).format(n);

  async function abrirDetalle(cuit) {
    detalle = cuit;
    $("rsLista").hidden = true;
    const panel = $("rsDetalle");
    panel.hidden = false;
    panel.innerHTML = '<p class="rs-cargando">Cargando…</p>';
    window.scrollTo(0, 0);
    try {
      const respuesta = await fetch(`/api/demo/resumen/clientes/${encodeURIComponent(cuit)}`);
      if (!respuesta.ok) throw new Error(`Error HTTP ${respuesta.status}`);
      const datos = await respuesta.json();
      if (detalle === cuit) panel.innerHTML = renderDetalle(datos);
    } catch (error) {
      panel.innerHTML = `<button class="button button-quiet" type="button" data-volver>← Volver</button><div class="table-state"><strong>No se pudo cargar el detalle</strong><p>${esc(error.message)}</p></div>`;
    }
  }

  function cerrarDetalle() {
    detalle = null;
    $("rsDetalle").hidden = true;
    $("rsLista").hidden = false;
    cargar().catch(() => {});
  }

  // Líneas de eje compartidas por los gráficos
  const W = 640, H = 220, M = { l: 52, r: 12, t: 14, b: 26 };
  function escalaY(max) {
    const tope = max > 0 ? max * 1.12 : 1;
    return { y: (v) => H - M.b - (v / tope) * (H - M.t - M.b), ticks: [0, 0.5, 1].map((k) => tope * k / 1.12) };
  }
  function ejes(max) {
    const { y, ticks } = escalaY(max);
    return ticks.map((t) => `<line x1="${M.l}" x2="${W - M.r}" y1="${y(t)}" y2="${y(t)}" class="rs-grid"/><text x="${M.l - 6}" y="${y(t) + 3}" text-anchor="end" class="rs-eje">${compacto(t)}</text>`).join("");
  }

  function graficoVentas(v) {
    const meses = v.meses;
    if (!meses.length) return '<p class="mt-sub">Sin facturación por mes sincronizada.</p>';
    const max = Math.max(...meses.map((m) => m.facturacion), v.limite_mensual || 0);
    const { y } = escalaY(max);
    const paso = (W - M.l - M.r) / Math.max(meses.length - 1, 1);
    const x = (i) => M.l + (meses.length === 1 ? (W - M.l - M.r) / 2 : i * paso);
    const linea = meses.map((m, i) => `${i ? "L" : "M"}${x(i)},${y(m.facturacion)}`).join(" ");
    const puntos = meses.map((m, i) => `<circle cx="${x(i)}" cy="${y(m.facturacion)}" r="3.5" class="rs-punto"><title>${esc(mesCorto(m.mes))}: ${esc(money(m.facturacion))}</title></circle>`).join("");
    const etiquetas = meses.map((m, i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="rs-eje">${mesCorto(m.mes)}</text>`).join("");
    const lim = v.limite_mensual ? `<line x1="${M.l}" x2="${W - M.r}" y1="${y(v.limite_mensual)}" y2="${y(v.limite_mensual)}" class="rs-limite"/><text x="${W - M.r}" y="${y(v.limite_mensual) - 5}" text-anchor="end" class="rs-limite-txt">Límite promedio ${esc(money(v.limite_mensual))}</text>` : "";
    return `<svg viewBox="0 0 ${W} ${H}" class="rs-svg" role="img" aria-label="Ventas por mes contra el límite promedio mensual">${ejes(max)}${lim}<path d="${linea}" class="rs-linea"/>${puntos}${etiquetas}</svg>`;
  }

  function graficoCompras(v) {
    if (!v.tiene_compras) return '<p class="mt-sub">Este cliente no tiene compras sincronizadas de Mis Comprobantes.</p>';
    const meses = v.meses;
    if (!meses.length) return '<p class="mt-sub">Sin datos por mes.</p>';
    const max = Math.max(...meses.map((m) => Math.max(m.facturacion, m.compras || 0)));
    const { y } = escalaY(max);
    const ancho = (W - M.l - M.r) / meses.length;
    const barras = meses.map((m, i) => {
      const x0 = M.l + i * ancho + ancho * 0.14, bw = ancho * 0.34;
      const alto = (val) => Math.max(0, H - M.b - y(val));
      return `<rect x="${x0}" y="${y(m.facturacion)}" width="${bw}" height="${alto(m.facturacion)}" class="rs-b-ventas"><title>Ventas ${esc(mesCorto(m.mes))}: ${esc(money(m.facturacion))}</title></rect>
        <rect x="${x0 + bw + 2}" y="${y(m.compras || 0)}" width="${bw}" height="${alto(m.compras || 0)}" class="rs-b-compras"><title>Compras ${esc(mesCorto(m.mes))}: ${esc(money(m.compras))}</title></rect>
        <text x="${M.l + i * ancho + ancho / 2}" y="${H - 8}" text-anchor="middle" class="rs-eje">${mesCorto(m.mes)}</text>`;
    }).join("");
    return `<svg viewBox="0 0 ${W} ${H}" class="rs-svg" role="img" aria-label="Ventas contra compras por mes">${ejes(max)}${barras}</svg>
      <div class="rs-leyenda"><i class="rs-b-ventas"></i>Ventas totales <i class="rs-b-compras"></i>Compras totales</div>`;
  }

  function graficoCategorias(r) {
    const cats = r.categorias;
    if (!cats.length) return '<p class="mt-sub">Sin escala vigente cargada.</p>';
    const max = Math.max(...cats.map((c) => c.limite_mensual_proyectado || c.limite_mensual), r.promedio_mensual || 0);
    const { y } = escalaY(max);
    const ancho = (W - M.l - M.r) / cats.length;
    const barras = cats.map((c, i) => {
      const val = c.limite_mensual_proyectado || c.limite_mensual;
      const x0 = M.l + i * ancho + ancho * 0.18, bw = ancho * 0.64;
      const clase = c.es_proyectada ? "rs-cat-proy" : c.es_actual ? "rs-cat-act" : "rs-cat";
      return `<rect x="${x0}" y="${y(val)}" width="${bw}" height="${H - M.b - y(val)}" class="${clase}"><title>${c.categoria}: ${esc(money(val))} por mes</title></rect>
        <text x="${x0 + bw / 2}" y="${H - 8}" text-anchor="middle" class="rs-eje ${c.es_actual || c.es_proyectada ? "rs-eje-fuerte" : ""}">${c.categoria}</text>`;
    }).join("");
    const prom = r.promedio_mensual != null ? `<line x1="${M.l}" x2="${W - M.r}" y1="${y(r.promedio_mensual)}" y2="${y(r.promedio_mensual)}" class="rs-limite"/><text x="${M.l + 4}" y="${y(r.promedio_mensual) - 5}" class="rs-limite-txt">Tu promedio ${esc(money(r.promedio_mensual))}</text>` : "";
    return `<svg viewBox="0 0 ${W} ${H}" class="rs-svg" role="img" aria-label="Límite mensual proyectado por categoría contra tu promedio">${ejes(max)}${barras}${prom}</svg>`;
  }

  function renderDetalle(d) {
    const c = d.cliente, u = d.utilizacion, e = d.estado, r = d.recategorizacion, deuda = d.deuda;
    const [estadoTxt, tono] = ESTADOS[e.estado] || [e.estado, "muted"];
    const p = pct(u.uso);
    const barra = p == null ? '<p class="mt-sub">Sin facturación sincronizada.</p>'
      : `<div class="mt-bar rs-bar-grande ${u.uso >= 0.95 ? "bad" : u.uso >= 0.85 ? "warn" : ""}"><i style="width:${Math.min(p, 100)}%"></i></div>`;
    const mantiene = r.categoria_proyectada == null ? "Sin datos suficientes" : r.sube_categoria ? `Subiría a ${r.categoria_proyectada}` : r.categoria_proyectada === r.categoria ? "Se mantiene" : `Bajaría a ${r.categoria_proyectada}`;
    const ipc = r.ipc ? `IPC ${r.ipc.variacion_pct.toLocaleString("es-AR")}%${r.ipc.estimativo ? " est." : ""}` : "";
    const saldos = deuda.saldos.length
      ? `<table class="rs-mini"><thead><tr><th>Período</th><th class="amount-cell">Saldo acumulado</th><th>Estado</th></tr></thead><tbody>${deuda.saldos.map((s) => `<tr><td>${esc(String(s.periodo).slice(5, 7))}/${esc(String(s.periodo).slice(0, 4))}</td><td class="amount-cell">${money(s.saldo_acumulado)}</td><td>${esc(s.estado)}</td></tr>`).join("")}</tbody></table>` : "";
    return `
      <button class="button button-quiet" type="button" data-volver>← Volver al listado</button>
      <header class="rs-cab">
        <div><h2>${esc(c.nombre || fmtCuit(c.cuit))}</h2><p>${esc(fmtCuit(c.cuit))}${c.actividad ? ` · ${esc(c.actividad)}` : ""}</p></div>
        <div>${c.categoria ? `<span class="mt-cat">${esc(c.categoria)}</span>` : ""} <span class="mt-state ${tono}">${esc(estadoTxt)}</span>${e.motivo ? `<p class="mt-sub">${esc(e.motivo)}</p>` : ""}</div>
      </header>
      <div class="rs-tarjetas">
        <article class="rs-tarjeta"><h3>Utilización del límite</h3><strong class="rs-grande">${fmtPct(u.uso)}</strong>${barra}
          <p>Facturado ${money(u.facturacion_periodo)} de ${money(u.tope)}</p>
          <p class="mt-sub">${u.margen != null ? (u.margen >= 0 ? `Podés facturar sin pasarte ${money(u.margen)}` : `Superás el tope por ${money(-u.margen)}`) : "—"}${u.origen_facturacion ? ` · ${esc(u.origen_facturacion)}` : ""}</p></article>
        <article class="rs-tarjeta"><h3>Deuda ARCA</h3><strong class="rs-grande">${money(deuda.monto)}</strong>
          <p class="mt-sub">${deuda.monto == null ? "Sin consultar CCMA" : `${deuda.periodos_deudores ?? 0} período(s) deudor(es) · consultada ${esc(fmtFecha(deuda.consultada_el))}`}</p></article>
        <article class="rs-tarjeta"><h3>Categoría proyectada</h3><strong class="rs-grande">${esc(r.categoria_proyectada || "—")}</strong>
          <p>${esc(mantiene)}</p><p class="mt-sub">Recategorización de ${esc(r.recategorizacion || "—")} ${ipc ? "· " + esc(ipc) : ""}</p></article>
      </div>
      <section class="rs-seccion"><h3>Ventas del período</h3>${graficoVentas(d.ventas)}</section>
      <section class="rs-seccion"><h3>Ventas vs compras</h3>${graficoCompras(d.ventas)}</section>
      <section class="rs-seccion"><h3>Proyección de recategorización</h3>
        <div class="rs-dos"><div>${graficoCategorias(r)}<p class="mt-sub">Límite mensual proyectado por categoría (tope anual ÷ 12).</p></div>
        <dl class="rs-lista">
          <div><dt>Ingreso promedio mensual</dt><dd>${money(r.promedio_mensual)}</dd></div>
          <div><dt>Límite promedio · actual</dt><dd>${money(r.limite_actual)}</dd></div>
          <div><dt>Límite promedio · proyectado</dt><dd>${money(r.limite_proyectado)}</dd></div>
          <div><dt>Tope anual · vigente / proyectado</dt><dd>${money(r.tope_anual)} / ${money(r.tope_anual_proyectado)}</dd></div>
          <div><dt>Meses del período</dt><dd>${d.ventas.meses_promedio}</dd></div>
        </dl></div></section>
      ${saldos ? `<section class="rs-seccion"><h3>Deuda por período (CCMA)</h3>${saldos}</section>` : ""}`;
  }

  function route() {
    const on = location.hash === "#resumen";
    $("resumen").hidden = !on;
    if (on && detalle) return;
    if (on) {
      cargar().catch((error) => {
        $("rsEmpty").hidden = false;
        $("rsEmpty").innerHTML = `<strong>No se pudo cargar el resumen</strong><p>${esc(error.message)}</p>`;
      });
    }
  }
  window.addEventListener("hashchange", route);
  route();
})();
