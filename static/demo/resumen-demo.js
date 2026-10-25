(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmtCuit = (cuit) =>
    /^\d{11}$/.test(cuit) ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}` : cuit;
  const fmtFecha = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");
  const pesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 0 });
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

  // ---- Gráficos (HTML + SVG, con tooltip al pasar el mouse) ---------------
  const NUM = (n, d = 1) => n.toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtM = (n, d = 1) => (Math.abs(n) >= 1e6 ? `${NUM(n / 1e6, d)} M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)} mil` : String(Math.round(n)));
  const tip = (...lineas) => esc(lineas.join("|"));   // «título|línea|línea»

  // Escala con 4 marcas (3 tramos) que cubre [min, max]
  function escala(min, max) {
    const base = [1, 2, 2.5, 5];
    let rango = Math.max(max - min, max * 0.1, 1);
    let e = Math.pow(10, Math.floor(Math.log10(rango / 3)));
    for (let k = 0; k < 40; k++) {
      for (const m of base) {
        const paso = m * e, lo = Math.floor(min / paso) * paso;
        if (lo + 3 * paso >= max) return { lo, hi: lo + 3 * paso, marcas: [0, 1, 2, 3].map((i) => lo + i * paso) };
      }
      e *= 10;
    }
    return { lo: 0, hi: max, marcas: [0, max / 3, (2 * max) / 3, max] };
  }
  const pos = (v, esc_) => (1 - (v - esc_.lo) / (esc_.hi - esc_.lo)) * 100;   // % desde arriba

  function ejeY(esc_, alto) {
    const marcas = esc_.marcas.map((v) => `<span style="top:${pos(v, esc_)}%">${fmtM(v)}</span>`).join("");
    return `<div class="rs-yaxis" style="height:${alto}px">${marcas}</div>`;
  }
  function rejilla(esc_) {
    return esc_.marcas.map((v, i) => `<i class="rs-gl ${i === 0 ? "rs-gl-base" : ""}" style="top:${pos(v, esc_)}%"></i>`).join("");
  }
  const xMeses = (meses) => `<div class="rs-xaxis">${meses.map((m) => `<span>${mesCorto(m.mes)}</span>`).join("")}</div>`;

  function graficoVentas(v) {
    const meses = v.meses;
    if (!meses.length) return '<p class="mt-sub">Sin facturación por mes sincronizada.</p>';
    const vals = meses.map((m) => m.facturacion);
    const lim = v.limite_mensual;
    const todos = lim ? vals.concat([lim]) : vals;
    const sc = escala(Math.max(0, Math.min(...todos) * 0.8), Math.max(...todos));
    const n = meses.length, x = (i) => ((i + 0.5) / n) * 100;
    const puntos = vals.map((val, i) => `${x(i)},${pos(val, sc)}`);
    const linea = "M" + puntos.join(" L");
    const area = `${linea} L${x(n - 1)},100 L${x(0)},100 Z`;
    const columnas = meses.map((m, i) => {
      const sobre = lim != null && m.facturacion > lim;
      const color = sobre ? "#C2570C" : "#0E7C66";
      const detalle = lim != null ? `${sobre ? "Sobre" : "Bajo"} el límite promedio (${money(lim)})` : "";
      return `<div class="rs-col rs-col-linea" style="left:${(i / n) * 100}%;width:${100 / n}%" data-tip="${tip(mesLargoCorto(m.mes), `Ventas: ${money(m.facturacion)}`, detalle)}">
        <b class="rs-punto2 ${sobre ? "rs-sobre" : ""}" style="top:${pos(m.facturacion, sc)}%;--c:${color}"></b>
        ${n <= 12 ? `<em class="rs-valor" style="top:${pos(m.facturacion, sc)}%">${fmtM(m.facturacion, 2)}</em>` : ""}</div>`;
    }).join("");
    const limite = lim != null ? `<div class="rs-limite2" style="top:${pos(lim, sc)}%"></div>
      <div class="rs-limite-tag" style="top:${pos(lim, sc)}%">Límite prom. mensual <span>${money(lim)}</span></div>` : "";
    return `<div class="rs-chart">${ejeY(sc, 240)}<div class="rs-plotwrap"><div class="rs-plot" style="height:240px">${rejilla(sc)}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Ventas mensuales"><path d="${area}" class="rs-area"/><path d="${linea}" class="rs-linea2"/></svg>
      ${limite}${columnas}</div>${xMeses(meses)}</div></div>`;
  }

  function mesLargoCorto(ym) {
    const largos = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    return `${largos[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
  }

  function graficoCompras(v) {
    if (!v.tiene_compras) return '<p class="mt-sub">Este cliente no tiene compras sincronizadas de Mis Comprobantes.</p>';
    const meses = v.meses;
    if (!meses.length) return '<p class="mt-sub">Sin datos por mes.</p>';
    const max = Math.max(...meses.map((m) => Math.max(m.facturacion, m.compras || 0)), 1);
    const sc = escala(0, max), n = meses.length;
    const barras = meses.map((m, i) => {
      const r = m.facturacion > 0 && m.compras != null ? m.compras / m.facturacion : null;
      const h = (val) => Math.max(0, ((val - sc.lo) / (sc.hi - sc.lo)) * 100);
      return `<div class="rs-col rs-col-barras" style="left:${(i / n) * 100}%;width:${100 / n}%" data-tip="${tip(mesLargoCorto(m.mes), `Ventas: ${money(m.facturacion)}`, `Compras: ${money(m.compras)}`, r != null ? `Compras / ventas: ${Math.round(r * 100)}%` : "")}">
        <i class="rs-bv" style="height:${h(m.facturacion)}%"></i><i class="rs-bc" style="height:${h(m.compras || 0)}%"></i></div>`;
    }).join("");
    const chips = meses.map((m) => {
      const r = m.facturacion > 0 && m.compras != null ? m.compras / m.facturacion : null;
      const clase = r == null ? "" : r > 1 ? "rs-chip-rojo" : r >= 0.4 ? "rs-chip-ambar" : "rs-chip-verde";
      return `<span class="rs-chip ${clase}">${r == null ? "—" : Math.round(r * 100) + "%"}</span>`;
    }).join("");
    return `<div class="rs-chart">${ejeY(sc, 220)}<div class="rs-plotwrap"><div class="rs-plot" style="height:220px">${rejilla(sc)}${barras}</div>
      ${xMeses(meses)}<p class="rs-sub-eje">% compras sobre ventas</p><div class="rs-chips">${chips}</div></div></div>
      <div class="rs-leyenda"><i class="rs-b-ventas"></i>Ventas <i class="rs-b-compras"></i>Compras</div>`;
  }

  function graficoCategorias(r) {
    const cats = r.categorias;
    if (!cats.length) return '<p class="mt-sub">Sin escala vigente cargada.</p>';
    const val = (c) => c.limite_mensual_proyectado || c.limite_mensual;
    const max = Math.max(...cats.map(val), r.promedio_mensual || 0);
    const sc = escala(0, max), n = cats.length;
    const barras = cats.map((c) => {
      const h = ((val(c) - sc.lo) / (sc.hi - sc.lo)) * 100;
      const fondo = c.es_proyectada ? "#3341B8" : c.es_actual ? "#1F8A70" : "#C9D2DE";
      const marca = [c.es_actual ? "categoría actual" : "", c.es_proyectada ? "categoría proyectada" : ""].filter(Boolean).join(" · ");
      return `<div class="rs-cat-col" data-tip="${tip(`Categoría ${c.categoria}${marca ? " · " + marca : ""}`, `Límite mensual proyectado: ${money(val(c))}`, `Límite mensual vigente: ${money(c.limite_mensual)}`, `Tope anual proyectado: ${money(c.tope_anual_proyectado)}`)}">
        <span class="rs-cat-val">${fmtM(val(c), 2)}</span><i style="height:${h}%;background:${fondo}"></i></div>`;
    }).join("");
    const nombres = cats.map((c) => `<span class="${c.es_actual || c.es_proyectada ? "rs-cat-fuerte" : ""}">${esc(c.categoria)}</span>`).join("");
    const alt = (r.promedio_mensual - sc.lo) / (sc.hi - sc.lo) * 100;
    const prom = r.promedio_mensual != null ? `<div class="rs-prom" style="bottom:${alt}%"></div>` : "";
    return `<div class="rs-chart">${ejeY(sc, 260)}<div class="rs-plotwrap"><div class="rs-plot rs-plot-cats" style="height:260px">${rejilla(sc)}<div class="rs-cats" style="--n:${n}">${barras}</div>${prom}</div>
      <div class="rs-xaxis rs-xaxis-cats">${nombres}</div></div></div>
      <div class="rs-leyenda"><i style="background:#1F8A70"></i>Categoría actual <i style="background:#3341B8"></i>Categoría proyectada <i style="background:#C9D2DE"></i>Otras ${r.promedio_mensual != null ? `<i class="rs-l-prom"></i>Tu promedio mensual ${money(r.promedio_mensual)}` : ""}</div>`;
  }

  // Tooltip inmediato (sin el retraso del title nativo)
  const globo = document.createElement("div");
  globo.className = "rs-globo";
  globo.hidden = true;
  document.body.appendChild(globo);
  function mostrarGlobo(el, evento) {
    const lineas = (el.getAttribute("data-tip") || "").split("|").filter(Boolean);
    if (!lineas.length) return;
    globo.innerHTML = `<strong>${lineas[0].charAt(0).toUpperCase() + lineas[0].slice(1)}</strong>${lineas.slice(1).map((l) => `<span>${l}</span>`).join("")}`;
    globo.hidden = false;
    const w = globo.offsetWidth, h = globo.offsetHeight;
    let x = evento.clientX + 14, y = evento.clientY - h - 12;
    if (x + w > window.innerWidth - 8) x = evento.clientX - w - 14;
    if (y < 8) y = evento.clientY + 18;
    globo.style.left = `${Math.max(8, x)}px`;
    globo.style.top = `${y}px`;
  }
  $("rsDetalle").addEventListener("mousemove", (event) => {
    const el = event.target.closest("[data-tip]");
    if (el) mostrarGlobo(el, event); else globo.hidden = true;
  });
  $("rsDetalle").addEventListener("mouseleave", () => { globo.hidden = true; });

  function rangoMeses(meses) {
    if (!meses.length) return "";
    const corto = (ym) => `${mesLargoCorto(ym)}`;
    return `${corto(meses[0].mes)} – ${corto(meses[meses.length - 1].mes)} · ${meses.length} ${meses.length === 1 ? "mes" : "meses"}`;
  }

  function renderDetalle(d) {
    const c = d.cliente, u = d.utilizacion, e = d.estado, r = d.recategorizacion, deuda = d.deuda;
    const [estadoTxt, tono] = ESTADOS[e.estado] || [e.estado, "muted"];
    const p = pct(u.uso);
    const barra = p == null ? '<p class="mt-sub">Sin facturación sincronizada.</p>'
      : `<div class="mt-bar rs-bar-grande ${u.uso >= 0.95 ? "bad" : u.uso >= 0.85 ? "warn" : ""}"><i style="width:${Math.min(p, 100)}%"></i></div>`;
    const mantiene = r.categoria_proyectada == null ? "Sin datos suficientes" : r.sube_categoria ? `Subiría a ${r.categoria_proyectada}` : r.categoria_proyectada === r.categoria ? "Se mantiene" : `Bajaría a ${r.categoria_proyectada}`;
    const totVentas = d.ventas.meses.reduce((a, m) => a + (m.facturacion || 0), 0);
    const totCompras = d.ventas.meses.reduce((a, m) => a + (m.compras || 0), 0);
    const lim = d.ventas.limite_mensual, prom = d.ventas.promedio_mensual;
    const diferencia = lim != null && prom != null ? prom - lim : null;
    const porcDif = diferencia != null && lim ? (diferencia / lim) * 100 : 0;
    const sobreLimite = diferencia != null && diferencia > 0;
    const textoLimite = diferencia == null ? "" : sobreLimite ? `Tu promedio supera el límite en ${NUM(porcDif, 1)}%` : "Tu promedio está dentro del límite";
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
          ${u.facturacion_periodo != null ? `<p>Facturado ${money(u.facturacion_periodo)} de ${money(u.tope)}</p>` : `<p class="mt-sub">Tope de la categoría: ${money(u.tope)}</p>`}
          <p class="mt-sub">${u.margen != null ? (u.margen >= 0 ? `Podés facturar sin pasarte ${money(u.margen)}` : `Superás el tope por ${money(-u.margen)}`) : "—"}${u.origen_facturacion ? ` · ${esc(u.origen_facturacion)}` : ""}</p></article>
        <article class="rs-tarjeta"><h3>Deuda ARCA</h3><strong class="rs-grande">${money(deuda.monto)}</strong>
          <p class="mt-sub">${deuda.monto == null ? "Sin consultar CCMA" : `${deuda.periodos_deudores ?? 0} período(s) deudor(es) · consultada ${esc(fmtFecha(deuda.consultada_el))}`}</p></article>
        <article class="rs-tarjeta"><h3>Categoría proyectada</h3><strong class="rs-grande">${esc(r.categoria_proyectada || "—")}</strong>
          <p>${esc(mantiene)}</p><p class="mt-sub">Recategorización de ${esc(r.recategorizacion || "—")} ${ipc ? "· " + esc(ipc) : ""}</p></article>
      </div>
      <section class="rs-seccion">
        <header class="rs-seccion-cab"><h3>Detalle de ventas del período</h3><span>${esc(rangoMeses(d.ventas.meses))}</span></header>
        <div class="rs-fila">
          <article class="rs-panel rs-panel-grande">
            <div class="rs-panel-cab"><h4>Ventas por mes vs. límite de la categoría</h4><span class="${sobreLimite ? "rs-aviso" : ""}">${esc(textoLimite)}</span></div>
            <div class="rs-leyenda"><i class="rs-l-linea"></i>Ventas del mes <i class="rs-l-sobre"></i>Sobre el límite promedio <i class="rs-l-bajo"></i>Bajo el límite promedio <i class="rs-l-limite"></i>Límite promedio mensual</div>
            ${graficoVentas(d.ventas)}
          </article>
          <article class="rs-panel">
            <h4>Actividad del período</h4>
            <div class="rs-kv"><span>Ventas</span><strong>${d.ventas.meses.length ? money(totVentas) : "—"}</strong></div>
            ${d.ventas.tiene_compras ? `<div class="rs-kv"><span>Compras</span><strong>${money(totCompras)}</strong></div>
            <div class="rs-kv rs-kv-neto"><span>Neto</span><strong>${money(totVentas - totCompras)}</strong></div>` : '<p class="mt-sub">Sin compras sincronizadas.</p>'}
            <div class="rs-caja">
              <div class="rs-kv"><span>Promedio mensual de ventas</span><strong>${money(d.ventas.promedio_mensual)}</strong></div>
              <div class="rs-kv"><span>Límite promedio mensual</span><strong>${money(d.ventas.limite_mensual)}</strong></div>
              ${diferencia != null ? `<div class="rs-kv rs-kv-borde"><span>Diferencia</span><em class="rs-pill ${diferencia > 0 ? "rs-pill-ambar" : "rs-pill-verde"}">${diferencia > 0 ? "+" : "−"} ${money(Math.abs(diferencia))} · ${NUM(Math.abs(porcDif), 1)}% ${diferencia > 0 ? "sobre" : "bajo"} el límite</em></div>` : ""}
            </div>
          </article>
        </div>
      </section>
      <section class="rs-seccion">
        <header class="rs-seccion-cab"><h3>Ventas vs. compras</h3><span>Relación compras / ventas por mes</span></header>
        <article class="rs-panel rs-panel-ancho">${graficoCompras(d.ventas)}</article>
      </section>
      <section class="rs-seccion">
        <header class="rs-seccion-cab"><h3>Proyección de recategorización</h3><span>${ipc ? esc(ipc) + " · " : ""}límites estimados a ${esc(r.recategorizacion || "la próxima recategorización")}</span></header>
        <div class="rs-fila">
          <article class="rs-panel rs-panel-grande">
            <div class="rs-panel-cab"><h4>Tu ingreso promedio vs. límite mensual por categoría</h4></div>
            <p class="mt-sub">Barras: tope mensual proyectado de cada categoría. Línea: ingreso promedio mensual del período.</p>
            ${graficoCategorias(r)}
          </article>
          <article class="rs-panel">
            <h4>Categoría proyectada</h4>
            <div class="rs-proy"><strong>${esc(r.categoria_proyectada || "—")}</strong><span class="${r.sube_categoria ? "rs-aviso" : r.categoria_proyectada == null ? "rs-apagado" : ""}">${esc(mantiene)}</span></div>
            <dl class="rs-lista">
              <div><dt>Ingreso promedio mensual</dt><dd>${money(r.promedio_mensual)}</dd></div>
              <div><dt>Límite promedio · actual</dt><dd>${money(r.limite_actual)}</dd></div>
              <div><dt>Límite promedio · proyectado</dt><dd>${money(r.limite_proyectado)}</dd></div>
              <div><dt>Tope anual vigente</dt><dd>${money(r.tope_anual)}</dd></div>
              <div><dt>Tope anual proyectado</dt><dd>${money(r.tope_anual_proyectado)}</dd></div>
              <div><dt>Meses del período</dt><dd>${d.ventas.meses_promedio ?? "—"}</dd></div>
            </dl>
          </article>
        </div>
      </section>
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
