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
  const HINT = {
    sin_facturacion: "No hay facturación para comparar contra el tope. Falta cargar el CUIT y su clave fiscal en Configuraciones → Clientes · Mis Comprobantes (o todavía no se sincronizó). También podés cargar el monto a mano.",
  };
  const NUM = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
  let loaded = false;

  function renderPeriodo(p) {
    const hasta = p.hasta < p.corte ? `${fmtFecha(p.hasta)} (fecha de muestra)` : fmtFecha(p.corte);
    $("mtPeriodo").innerHTML = `<span class="mt-period-label">PERÍODO DE CONTROL</span>
      <strong>${fmtFecha(p.desde)} al ${hasta}</strong>
      <span>Corte el ${fmtFecha(p.corte)} · próxima recategorización: ${esc(p.recategorizacion)}</span>`;
  }

  // Los avisos de Monotributo viven ahora en la Central de Notificaciones (campana).
  function renderAlertas() {}

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

  // ---- Parámetros de la escala: en la demo se calculan en el navegador y no se guardan.
  const PARAMS = [
    ["superficie", "Superficie afectada", "m²"],
    ["energia", "Energía eléctrica consumida", "kW anuales"],
    ["alquiler", "Alquileres devengados", "$ anuales"],
  ];
  const UMBRAL = 0.9;
  let datos = null;

  function categoriaPor(topes, valor) {
    return ORDEN.split("").find((l) => valor <= topes[l]) || null;
  }

  function recomputar(c, valores) {
    const topes = datos.escala_parametros;
    const cat = c.categoria_padron;
    const items = [];
    const nuevas = [];
    let peor = "ok", mayor = -1, mayorProy = -1, limitante = null, usoMax = null;
    const rango = { ok: 0, cercano: 1, excedido: 2 };
    PARAMS.forEach(([clave, nombre, unidad]) => {
      const valor = valores[clave];
      if (valor == null) return;
      const tope = topes[clave][cat];
      const uso = valor / tope;
      const requerida = categoriaPor(topes[clave], valor);
      const estado = uso > 1 ? "excedido" : uso >= UMBRAL ? "cercano" : "ok";
      items.push({ clave, nombre, unidad, valor, tope_actual: tope, uso, categoria_requerida: requerida, estado });
      if (rango[estado] > rango[peor]) peor = estado;
      if (usoMax == null || uso > usoMax) { usoMax = uso; limitante = clave; }
      mayor = Math.max(mayor, requerida ? ORDEN.indexOf(requerida) : ORDEN.length);
      const reqProy = categoriaPor(datos.escala_parametros_proy[clave], valor);   // con los topes proyectados (alquiler actualizado)
      mayorProy = Math.max(mayorProy, reqProy ? ORDEN.indexOf(reqProy) : ORDEN.length);
      if (estado === "excedido") nuevas.push({ tipo: "excede_parametro", nivel: "critico", mensaje: `${nombre} supera el tope de la categoría ${cat}: ${NUM.format(valor)} sobre ${NUM.format(tope)} ${unidad} (${Math.round(uso * 100)}%). Correspondería: ${requerida || "fuera de escala"}.` });
      if (estado === "cercano") nuevas.push({ tipo: "cerca_del_parametro", nivel: "aviso", mensaje: `${nombre} lleva usado el ${Math.round(uso * 100)}% del tope de la categoría ${cat}.` });
    });
    const base = c.base;
    c.parametros_manuales = items.length ? Object.fromEntries(PARAMS.map(([k]) => [k, valores[k] ?? null])) : null;
    c.parametros = items.length ? { cargados_el: new Date().toISOString(), items, limitante } : null;
    c.alertas = [...nuevas, ...base.alertas];
    c.estado = base.estado;
    c.categoria_corresponde = base.categoria_corresponde;
    c.categoria_proyectada = base.categoria_proyectada;
    c.uso_max = null;
    c.parametro_limitante = null;
    if (items.length) {
      if (rango[peor] > (rango[base.estado] ?? 0) || base.estado === "sin_facturacion" && peor !== "ok") c.estado = peor;
      c.uso_max = Math.max(base.uso ?? 0, usoMax);
      c.parametro_limitante = usoMax >= (base.uso ?? 0) ? limitante : null;
      if (base.categoria_corresponde) {
        const maxima = ORDEN.indexOf("K");
        let idx = Math.max(ORDEN.indexOf(base.categoria_corresponde), mayor);
        c.categoria_corresponde = idx >= ORDEN.length || idx > maxima ? null : ORDEN[idx];
      }
      if (base.categoria_proyectada) {
        const maxima = ORDEN.indexOf("K");
        const idxProy = Math.max(ORDEN.indexOf(base.categoria_proyectada), mayorProy);
        c.categoria_proyectada = idxProy >= ORDEN.length || idxProy > maxima ? null : ORDEN[idxProy];
      }
    }
    datos.alertas = datos.alertas.filter((a) => !(a.cuit === c.cuit && ["excede_parametro", "cerca_del_parametro"].includes(a.tipo)));
    nuevas.slice().reverse().forEach((a) => datos.alertas.unshift({ ...a, cuit: c.cuit, nombre: c.nombre }));
    renderAlertas(datos.alertas);
    renderFilas(datos.contribuyentes);
  }

  function seccionParametros(c) {
    const manual = c.parametros_manuales || {};
    const campos = PARAMS.map(([clave, etiqueta, unidad]) => `<label class="mt-param">
        <span>${esc(etiqueta)} <i class="mt-sub">(${esc(unidad)})</i></span>
        <input name="${clave}" inputmode="decimal" autocomplete="off" value="${manual[clave] != null ? esc(String(manual[clave]).replace(".", ",")) : ""}" placeholder="sin cargar">
      </label>`).join("");
    const p = c.parametros;
    const tabla = p
      ? `<table class="mt-month-table"><thead><tr><th>Parámetro</th><th class="amount-cell">Valor</th><th class="amount-cell">Tope cat. ${esc(c.categoria_padron)}</th><th class="amount-cell">Uso</th><th>Categoría</th></tr></thead><tbody>${p.items.map((i) => `<tr class="${i.estado === "excedido" ? "mt-bad" : ""}">
          <td>${esc(i.nombre)}</td><td class="amount-cell">${NUM.format(i.valor)}</td><td class="amount-cell">${NUM.format(i.tope_actual)}</td>
          <td class="amount-cell">${Math.round(i.uso * 100)}%</td><td>${esc(i.categoria_requerida || "Fuera de escala")}</td></tr>`).join("")}</tbody></table>
        <p class="mt-detail-note">La categoría que corresponde es la más alta entre la facturación y estos parámetros.</p>`
      : '<p class="mt-detail-note">Sin parámetros cargados: la categoría se calcula solo por facturación.</p>';
    return `<form class="mt-params" data-params="${esc(c.cuit)}">
        <div class="mt-param-fields">${campos}</div>
        <div class="mt-param-actions"><button class="button button-primary" type="submit">Guardar parámetros</button>
          <button class="button button-quiet" type="button" data-params-borrar="${esc(c.cuit)}">Borrar</button></div>
        <p class="mt-detail-note">Demo: probá cargar valores (por ejemplo, energía 7.000 kW). Se calcula en el navegador y no se guarda.</p>
      </form>${tabla}`;
  }

  function numero(texto) {
    const t = String(texto || "").trim().replace(/\./g, "").replace(",", ".");
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  }

  // Proyectada = ingreso promedio mensual (facturación / meses enteros del período) contra el límite
  // promedio mensual proyectado (tope anual proyectado de su categoría / 12).
  function detalleProyeccion(c) {
    if (c.ingreso_promedio_mensual == null) return '<p class="mt-detail-note">Sin facturación del período para calcular el promedio.</p>';
    const uso = c.limite_mensual_proyectado ? ` · ${Math.round((c.ingreso_promedio_mensual / c.limite_mensual_proyectado) * 100)}% del límite` : "";
    return `<dl class="mt-snap">
      <div><dt>Ingreso promedio mensual</dt><dd>${money(c.ingreso_promedio_mensual)} <span class="mt-sub">${money(c.facturacion_periodo)} ÷ ${esc(c.meses_promedio)} meses del período (el mes en curso cuenta entero)</span></dd></div>
      <div><dt>Límite promedio mensual proyectado</dt><dd>${money(c.limite_mensual_proyectado)} <span class="mt-sub">tope anual proyectado de la categoría ${esc(c.categoria_padron || "—")} ÷ 12${uso}</span></dd></div>
    </dl>`;
  }

  function filaDetalle(c) {
    return `<tr class="mt-detail-row"><td colspan="9"><div class="mt-detail">
      <div class="mt-detail-col">
        <section><h3>Cierre anterior</h3>${detalleCierre(c.cierre_anterior)}</section>
        <section><h3>Proyección · promedio mensual</h3>${detalleProyeccion(c)}</section>
      </div>
      <section><h3>Mes a mes</h3>${detalleMensual(c.mensual)}</section>
      <section class="mt-detail-wide"><h3>Parámetros de la escala · carga manual</h3>${seccionParametros(c)}</section>
    </div></td></tr>`;
  }

  let ultimos = [];

  function renderFilas(items) {
    ultimos = items;
    $("mtFooter").textContent = `${items.length} CUIT de muestra`;
    $("mtRows").innerHTML = items.map((c) => {
      const [label, tone] = ESTADOS[c.estado] || [c.estado, "muted"];
      const usoBarra = c.uso_max ?? c.uso;
      const pct = usoBarra == null ? null : Math.round(usoBarra * 100);
      const limita = c.parametro_limitante && c.parametros ? c.parametros.items.find((i) => i.clave === c.parametro_limitante) : null;
      const bar = pct == null ? "—" : `<div class="mt-bar ${tone}"><i style="width:${Math.min(pct, 100)}%"></i></div><span class="mt-pct">${pct}%</span>${limita ? `<span class="mt-sub">limita: ${esc(limita.nombre.toLowerCase())}</span>` : ""}`;
      const sube = c.categoria_proyectada && ORDEN.indexOf(c.categoria_proyectada) > ORDEN.indexOf(c.categoria_padron);
      const baja = c.categoria_proyectada && ORDEN.indexOf(c.categoria_proyectada) < ORDEN.indexOf(c.categoria_padron);
      const corresponde = c.categoria_proyectada
        ? `<span class="mt-cat ${sube ? "diff" : baja ? "lower" : ""}" title="${sube ? "Subiría con los topes proyectados" : baja ? "Bajaría con los topes proyectados" : "Se mantiene con los topes proyectados"}">${esc(c.categoria_proyectada)}</span>${sube ? '<span class="mt-trend" aria-hidden="true">↑</span>' : baja ? '<span class="mt-trend" aria-hidden="true">↓</span>' : ""}`
        : c.facturacion_periodo != null && c.categoria_padron ? '<span class="mt-sub">Fuera de escala</span>' : "—";
      return `<tr>
        <td><span class="mt-name">${esc(c.nombre)}</span><span class="mt-doc">${esc(fmtCuit(c.cuit))}</span>
          <span class="mt-sub">${esc(c.actividad)} (según padrón)</span></td>
        <td><span class="mt-cat">${esc(c.categoria_padron)}</span></td>
        <td class="amount-cell">${money(c.tope)}</td>
        <td class="amount-cell">${money(c.facturacion_periodo)}${subFacturacion(c)}</td>
        <td class="amount-cell">${celdaCompras(c)}</td>
        <td class="mt-use">${bar}</td>
        <td>${corresponde}</td>
        <td><span class="mt-state ${tone}"${HINT[c.estado] ? ` title="${esc(HINT[c.estado])}" style="cursor:help"` : ""}>${esc(label)}</span></td>
        <td class="mt-actions"><button class="button button-quiet" data-detalle="${esc(c.cuit)}" type="button" aria-expanded="${expandidos.has(c.cuit)}">${expandidos.has(c.cuit) ? "Ocultar" : "Detalle"}</button></td>
      </tr>${expandidos.has(c.cuit) ? filaDetalle(c) : ""}`;
    }).join("");
  }

  async function load() {
    try {
      const r = await fetch("/api/demo/monotributo");
      if (!r.ok) throw new Error(`Error HTTP ${r.status}`);
      const d = await r.json();
      datos = d;
      $("mtEscalaMsg").textContent = `Escala de muestra vigente desde ${fmtFecha(d.escala.vigencia)}. En la versión real se lee de ARCA y una persona la aprueba antes de usarla.`;
      renderPeriodo(d.periodo);
      $("mtThProy").innerHTML = `PROYECTADA<span class="mt-sub">a ${esc(fmtMes(d.proyeccion.actualizacion))} · ${esc(String(d.proyeccion.variacion_pct).replace(".", ","))}% est.</span>`;
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

  $("mtRows").addEventListener("submit", (event) => {
    const form = event.target.closest("[data-params]");
    if (!form) return;
    event.preventDefault();
    const valores = Object.fromEntries(PARAMS.map(([k]) => [k, numero(form.elements[k].value)]));
    if (Object.values(valores).some(Number.isNaN)) return;
    recomputar(datos.contribuyentes.find((x) => x.cuit === form.dataset.params), valores);
  });

  $("mtRows").addEventListener("click", (event) => {
    const borrar = event.target.closest("[data-params-borrar]");
    if (borrar) recomputar(datos.contribuyentes.find((x) => x.cuit === borrar.dataset.paramsBorrar), {});
  });

  // ---- Proyección de topes (escala vigente y próxima actualización). Datos de muestra.
  const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const mesLargo = (ym) => `${MESES_LARGO[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
  const pctFmt = (v) => `${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(v)}%`;

  function renderProyeccion(p) {
    const meses = p.meses.map((m) =>
      `<li class="${m.fuente === "INDEC" ? "" : "mt-proy-est"}"><span>${esc(fmtMes(m.mes))}</span><strong>${pctFmt(m.variacion_pct)}</strong><em>${esc(m.fuente)}</em></li>`).join("");
    const filas = Object.entries(p.categorias).map(([letra, c]) => `<tr>
      <th scope="row">${esc(letra)}</th>
      <td class="amount-cell">${money(c.actual)}<span class="mt-proy-next">Proy: ${money(c.proyectado)}</span></td>
      <td class="amount-cell">${money(c.actual / 12)}<span class="mt-proy-next">Proy: ${money(c.proyectado / 12)}</span></td></tr>`).join("");
    $("mtProyPanel").innerHTML = `
      <header class="mt-proy-head">
        <div><h3>Topes proyectados · actualización de ${esc(mesLargo(p.actualizacion))}</h3>
          <p>Escala vigente desde ${esc(p.vigencia)} y proyección de ARCA: el tope sube con el IPC acumulado de ${esc(fmtMes(p.semestre.desde))} a ${esc(fmtMes(p.semestre.hasta))}.</p></div>
        <div class="mt-proy-total"><span>Variación estimada</span><strong>${pctFmt(p.variacion_pct)}</strong></div>
      </header>
      <ul class="mt-proy-months" aria-label="IPC mensual del semestre">${meses}</ul>
      <div class="table-wrap mt-proy-wrap"><table class="mt-proy-table">
        <thead><tr><th scope="col">CAT.</th><th scope="col" class="amount-cell">INGRESOS BRUTOS <span class="mt-sub">(tope anual)</span></th><th scope="col" class="amount-cell">INGRESOS BRUTOS <span class="mt-sub">(tope mensual)</span></th></tr></thead>
        <tbody>${filas}</tbody></table></div>
      <p class="mt-detail-note">Estimación, no es un dato oficial de ARCA. En la versión real el IPC se lee de INDEC, los meses que faltan se completan con el REM del BCRA y se reemplazan solos cuando INDEC publica el dato.</p>`;
  }

  $("mtProyeccion").addEventListener("click", async (event) => {
    const boton = event.currentTarget;
    const panel = $("mtProyPanel");
    const mostrar = (abierto) => {
      panel.hidden = !abierto;
      $("monotributo").classList.toggle("mt-en-proy", abierto);   // la proyección reemplaza al seguimiento
      boton.setAttribute("aria-expanded", String(abierto));
      boton.textContent = abierto ? "Volver al seguimiento" : "Proyección";
    };
    if (!panel.hidden) return mostrar(false);
    boton.disabled = true;
    try {
      const r = await fetch("/api/demo/monotributo/proyeccion");
      if (!r.ok) throw new Error(`Error HTTP ${r.status}`);
      renderProyeccion(await r.json());
      mostrar(true);
    } catch (e) {
      $("mtEscalaMsg").textContent = `No se pudo cargar la proyección: ${e.message}`;
    } finally {
      boton.disabled = false;
    }
  });

  function route() {
    const mono = location.hash === "#monotributo";
    const dfe = location.hash === "#dfe";
    const granos = location.hash === "#granos";
    const emitir = location.hash === "#emitir";
    const ccma = location.hash === "#ccma";
    const resumen = location.hash === "#resumen";
    const ntf = location.hash === "#notificaciones";
    $("monotributo").hidden = !mono;
    $("history").hidden = mono || dfe || granos || emitir || ccma || resumen || ntf;
    const destino = mono ? "#monotributo" : dfe ? "#dfe" : granos ? "#granos" : emitir ? "#emitir" : ccma ? "#ccma" : resumen ? "#resumen" : ntf ? "#notificaciones" : "#history";
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
