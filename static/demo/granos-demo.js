(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmtFecha = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");
  const fmtCuit = (cuit) => {
    const t = String(cuit ?? "");
    return /^\d{11}$/.test(t) ? `${t.slice(0, 2)}-${t.slice(2, 10)}-${t.slice(10)}` : (cuit ?? "—");
  };
  const num = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
  const dinero = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
  // Solo códigos confirmados contra datos reales de producción -- no se adivinan los demás.
  const CATALOGO_GRANOS = { "19": "Maíz", "22": "Sorgo Granífero", "23": "Soja" };

  let liquidaciones = [];
  let loaded = false;

  function tablaDetalle(filas, columnas) {
    if (!filas.length) return "";
    const head = columnas.map(([, etiqueta]) => `<th scope="col">${esc(etiqueta)}</th>`).join("");
    const body = filas
      .map((fila) => `<tr>${columnas.map(([clave]) => `<td>${esc(fila[clave] ?? "—")}</td>`).join("")}</tr>`)
      .join("");
    return `<table class="gr-detail-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  const POR_PAGINA = 10;
  let pagina = 1;

  // ---- Fechas del filtro: campo de texto flexible + calendario. El <input type="date"> nativo no entrega
  // valor hasta tener día, mes y año completos; acá basta con «dd/mm» (se asume el año actual), «dd/mm/aa»,
  // «dd/mm/aaaa» o solo dígitos («0104», «010426», «01042026»).
  function parseFecha(texto) {
    const t = String(texto || "").trim();
    if (!t) return "";
    let partes = t.match(/^(\d{1,2})[\/\-. ](\d{1,2})(?:[\/\-. ](\d{2}|\d{4}))?$/);
    if (!partes && /^\d+$/.test(t) && [4, 6, 8].includes(t.length)) partes = [t, t.slice(0, 2), t.slice(2, 4), t.slice(4)];
    if (!partes) return null;
    const dia = Number(partes[1]), mes = Number(partes[2]);
    let anio = partes[3] ? Number(partes[3]) : new Date().getFullYear();
    if (partes[3] && partes[3].length === 2) anio += 2000;
    const f = new Date(anio, mes - 1, dia);
    if (f.getFullYear() !== anio || f.getMonth() !== mes - 1 || f.getDate() !== dia) return null;
    return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  }

  function fechaIso(id) { return $(id).dataset.iso || ""; }

  function fijarFecha(id, iso) {
    const campo = $(id);
    campo.dataset.iso = iso;
    const [a, m, d] = iso ? iso.split("-") : [];
    campo.value = iso ? `${d}/${m}/${a}` : "";
    campo.classList.remove("is-invalid");
  }

  function enlazarFecha(id, alCambiar) {
    const campo = $(id), nativo = $(`${id}Nativo`), boton = campo.parentElement.querySelector(".date-pick");
    let pausa = null;
    const aplicar = (normalizar) => {
      clearTimeout(pausa);
      const iso = parseFecha(campo.value);
      if (iso === null) { campo.classList.add("is-invalid"); return; }  // incompleta o inválida: se conserva el filtro anterior
      const cambio = iso !== fechaIso(id);
      if (normalizar) fijarFecha(id, iso); else { campo.dataset.iso = iso; campo.classList.remove("is-invalid"); }
      if (cambio) alCambiar();
    };
    campo.addEventListener("input", () => { clearTimeout(pausa); pausa = setTimeout(() => aplicar(false), 450); });
    campo.addEventListener("change", () => aplicar(true));  // Enter o salir del campo: filtra ya y deja dd/mm/aaaa
    boton.addEventListener("click", () => {
      nativo.value = fechaIso(id);
      try { nativo.showPicker(); } catch (e) { nativo.focus(); nativo.click(); }
    });
    nativo.addEventListener("change", () => { fijarFecha(id, nativo.value); alCambiar(); });
  }

  // Filtro por fecha (inclusivo) sobre el listado cargado; las exportaciones usan el mismo rango.
  function filtradas() {
    const desde = fechaIso("grdDesde"), hasta = fechaIso("grdHasta");
    return liquidaciones.filter((f) => {
      const dia = String(f.fecha_liquidacion || "").slice(0, 10);
      return (!desde || dia >= desde) && (!hasta || dia <= hasta);
    });
  }

  function paramsFechas() {
    const q = new URLSearchParams();
    if (fechaIso("grdDesde")) q.set("desde", fechaIso("grdDesde"));
    if (fechaIso("grdHasta")) q.set("hasta", fechaIso("grdHasta"));
    const texto = q.toString();
    return texto ? `?${texto}` : "";
  }

  function actualizarExportacion() {
    const bd = $("grdPlantilla").value === "bd";
    $("grdCopiar").hidden = !bd;
    $("grdExportar").href = (bd ? "/api/demo/granos/bd-liquidaciones.xlsx" : "/api/demo/granos/liquidaciones.xlsx") + paramsFechas();
  }

  function aviso(texto, advertencia = false) {
    $("grdAviso").textContent = texto;
    $("grdAviso").classList.toggle("warn", advertencia);
    $("grdAviso").hidden = !texto;
  }

  function renderFilas(items) {
    actualizarExportacion();
    const paginas = Math.max(1, Math.ceil(items.length / POR_PAGINA));
    pagina = Math.min(Math.max(1, pagina), paginas);
    const desde = (pagina - 1) * POR_PAGINA;
    const totalNeto = items.reduce((s, f) => s + (f.total_neto_a_pagar || 0), 0);
    $("grdPager").hidden = paginas <= 1;
    $("grdPagina").textContent = `Página ${pagina} de ${paginas} · ${desde + 1}–${Math.min(desde + POR_PAGINA, items.length)} de ${items.length}`;
    $("grdPrev").disabled = pagina <= 1;
    $("grdNext").disabled = pagina >= paginas;
    $("grdFooter").textContent = `${items.length} liquidaci${items.length === 1 ? "ón" : "ones"} de muestra · neto a pagar ${dinero.format(totalNeto)}${paginas > 1 ? " (total de todas las páginas)" : ""}`;
    $("grdRows").innerHTML = items
      .slice(desde, desde + POR_PAGINA)
      .map((f) => `<tr>
        <td>${fmtFecha(f.fecha_liquidacion)}</td>
        <td>${esc(f.coe)}</td>
        <td>${esc(f.pto_emision ?? "—")} / ${esc(f.nro_orden ?? "—")}</td>
        <td>${esc(fmtCuit(f.cuit_comprador || "—"))}</td>
        <td>${esc(CATALOGO_GRANOS[String(f.cod_grano)] || f.cod_grano || "—")}<span class="mt-sub">campaña ${esc(f.campania ?? "—")}</span></td>
        <td class="amount-cell">${f.peso_neto == null ? "—" : num.format(f.peso_neto)}</td>
        <td class="amount-cell">${f.total_neto_a_pagar == null ? "—" : dinero.format(f.total_neto_a_pagar)}</td>
        <td><button class="detail-button" type="button" data-detalle="${esc(f.coe)}">Ver</button></td>
      </tr>`)
      .join("");
  }

  function abrirDetalle(coe) {
    const fila = liquidaciones.find((f) => String(f.coe) === String(coe));
    if (!fila) return;
    const detalle = fila.detalle || {};
    const liq = detalle.liquidacion || {};
    const auth = detalle.autorizacion || {};

    $("detailTitle").textContent = `Liquidación de muestra · COE ${fila.coe}`;

    const campos = [
      ["Fecha", fmtFecha(fila.fecha_liquidacion)],
      ["Pto. emisión / Orden", `${fila.pto_emision ?? "—"} / ${fila.nro_orden ?? "—"}`],
      ["Contrato", liq.numeroContrato || auth.numeroContrato || "—"],
      ["Comprador", fmtCuit(fila.cuit_comprador || "—")],
      ["Vendedor", fmtCuit(liq.cuitVendedor || "—")],
      ["Corredor", liq.actuaCorredor === "S" ? `${fmtCuit(liq.cuitCorredor || "—")} · comisión ${liq.comisionCorredor ?? "—"}%` : "No actuó"],
      ["Grano", `${CATALOGO_GRANOS[String(fila.cod_grano)] || "cód. " + (fila.cod_grano ?? "—")}`],
      ["Campaña", liq.campaniaPPal || fila.campania || "—"],
      ["Puerto", `${liq.codPuerto ?? "—"} · ${liq.desPuertoLocalidad ?? "—"}`],
      ["Grado entregado", `${liq.codGradoEnt ?? "—"} (factor ${liq.factorEnt ?? "—"}, valor ${liq.valGradoEnt ?? "—"})`],
      ["Precio ref. / Tn", liq.precioRefTn == null ? "—" : dinero.format(liq.precioRefTn)],
      ["Precio operación", auth.precioOperacion == null ? "—" : dinero.format(auth.precioOperacion)],
      ["Flete / Tn", liq.precioFleteTn == null ? "—" : dinero.format(liq.precioFleteTn)],
      ["Peso neto (Kg)", fila.peso_neto == null ? "—" : num.format(fila.peso_neto)],
      ["Estado", auth.estado || "—"],
    ];

    const totales = [
      ["Subtotal", fila.sub_total],
      ["IVA", fila.importe_iva],
      ["Total deducciones", fila.total_deduccion],
      ["Total retenciones", auth.totalRetencion],
      ["Total retenciones AFIP", auth.totalRetencionAfip],
      ["Total otras retenciones", auth.totalOtrasRetenciones],
      ["Neto a pagar", fila.total_neto_a_pagar],
      ["IVA RG 4310/18", fila.total_iva_rg4310_18],
      ["Pago según condición", fila.total_pago_segun_condicion],
    ].map(([label, valor]) => [label, valor == null ? "—" : dinero.format(valor)]);

    const deducciones = ((auth.deducciones || {}).deduccionReturn || []).map((d) => ({
      concepto: (d.deduccion || {}).codigoConcepto ?? "—",
      detalle: (d.deduccion || {}).detalleAclaratorio ?? "—",
      base: (d.deduccion || {}).baseCalculo == null ? "—" : dinero.format(d.deduccion.baseCalculo),
      iva: d.importeIva == null ? "—" : dinero.format(d.importeIva),
      importe: d.importeDeduccion == null ? "—" : dinero.format(d.importeDeduccion),
    }));

    const retenciones = ((auth.retenciones || {}).retencionReturn || []).map((r) => ({
      concepto: (r.retencion || {}).codigoConcepto ?? "—",
      detalle: (r.retencion || {}).detalleAclaratorio ?? "—",
      base: (r.retencion || {}).baseCalculo == null ? "—" : dinero.format(r.retencion.baseCalculo),
      alicuota: (r.retencion || {}).alicuota == null ? "—" : `${r.retencion.alicuota}%`,
      importe: r.importeRetencion == null ? "—" : dinero.format(r.importeRetencion),
      certificado: (r.retencion || {}).nroCertificadoRetencion || "—",
    }));

    const certificados = ((liq.certificados || {}).certificado || []).map((c) => ({
      tipo: c.tipoCertificadoDeposito ?? "—",
      numero: c.nroCertificadoDeposito ?? "—",
      peso: c.pesoNeto == null ? "—" : num.format(c.pesoNeto),
      pesoTotal: c.pesoNetoTotalCertificado == null ? "—" : num.format(c.pesoNetoTotalCertificado),
      campania: c.campania ?? "—",
      cierre: fmtFecha(c.fechaCierre),
    }));

    $("detailContent").innerHTML = `
      <div class="detail-grid">${campos.map(([label, value]) => `<div class="detail-field"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("")}</div>
      <div class="dialog-associated">
        <h3>Totales</h3>
        <div class="detail-grid">${totales.map(([label, value]) => `<div class="detail-field"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("")}</div>
        ${deducciones.length ? `<h3>Deducciones</h3>${tablaDetalle(deducciones, [["concepto", "Concepto"], ["detalle", "Detalle"], ["base", "Base"], ["iva", "IVA"], ["importe", "Importe"]])}` : "<h3>Deducciones</h3><p>Sin deducciones en esta liquidación de muestra.</p>"}
        ${retenciones.length ? `<h3>Retenciones</h3>${tablaDetalle(retenciones, [["concepto", "Concepto"], ["detalle", "Detalle"], ["base", "Base"], ["alicuota", "Alíc."], ["importe", "Importe"], ["certificado", "Certificado"]])}` : "<h3>Retenciones</h3><p>Sin retenciones en esta liquidación de muestra.</p>"}
        ${certificados.length ? `<h3>Certificados de depósito</h3>${tablaDetalle(certificados, [["tipo", "Tipo"], ["numero", "N.º"], ["peso", "Peso neto"], ["pesoTotal", "Peso total"], ["campania", "Campaña"], ["cierre", "Cierre"]])}` : ""}
        ${liq.datosAdicionales ? `<h3>Datos adicionales</h3><p>${esc(liq.datosAdicionales)}</p>` : ""}
      </div>`;

    $("detailDialog").showModal();
  }

  // ---- Certificados con saldo y CTG (datos de muestra; en la app real se consultan a ARCA y se guardan).
  let certificados = [];
  let ctgs = [];
  let certDetalles = {};
  const nombreGrano = (cod) => (cod ? CATALOGO_GRANOS[String(cod)] || `Grano ${cod}` : "—");
  const nombreTipo = (tipo) => (tipo === "P" ? "P · Planta" : tipo || "—");

  function renderCert() {
    const grano = $("grdCertGrano").value, camp = $("grdCertCampania").value, solo = $("grdCertSoloSaldo").checked;
    const filas = certificados.filter((c) => (!grano || c.cod_grano === grano) && (!camp || c.campania === camp) && (!solo || c.con_saldo));
    $("grdCertRows").innerHTML = filas.map((c) => `<tr>
      <td>${esc(c.coe)}</td><td>${esc(nombreTipo(c.tipo_certificado))}</td><td>${esc(nombreGrano(c.cod_grano))}</td><td>${esc(c.campania)}</td>
      <td>${esc(fmtCuit(c.cuit_depositante))}</td><td>${esc(fmtCuit(c.cuit_depositario))}</td><td>${c.nro_planta ?? "—"}</td>
      <td class="amount-cell">${num.format(c.kilos_disponibles || 0)}</td>
      <td>${c.con_saldo ? '<span class="gr-estado-cert">Con saldo</span>' : '<span class="gr-estado-cert sin">Sin saldo</span>'}</td>
      <td><button class="detail-button" type="button" data-cert-detalle="${esc(c.coe)}">Ver</button></td></tr>`).join("");
    $("grdCertEmpty").hidden = filas.length > 0;
    const con = filas.filter((c) => c.con_saldo);
    $("grdCertFooter").textContent = `${filas.length} certificado${filas.length === 1 ? "" : "s"} · ${con.length} con saldo (${num.format(con.reduce((t, c) => t + c.kilos_disponibles, 0))} kg disponibles)`;
  }

  function renderCtg() {
    const grano = $("grdCtgGrano").value, camp = $("grdCtgCampania").value;
    const filas = ctgs.filter((c) => (!grano || c.cod_grano === grano) && (!camp || c.campania === camp));
    $("grdCtgRows").innerHTML = filas.map((c) => `<tr>
      <td>${fmtFecha(c.fecha_confirmacion)}</td><td>${esc(c.nro_ctg)}</td><td>${esc(c.nro_carta_porte)}</td><td>${esc(c.tipo_ctg)}</td>
      <td>${esc(nombreGrano(c.cod_grano))}</td><td>${esc(c.campania)}</td><td>${c.nro_planta ?? "—"}</td>
      <td class="amount-cell">${num.format(c.kilos_confirmados || 0)}</td><td>${esc(fmtCuit(c.cuit_remitente_comercial))}</td></tr>`).join("");
    $("grdCtgEmpty").hidden = filas.length > 0;
    $("grdCtgFooter").textContent = `${filas.length} CTG · ${num.format(filas.reduce((t, c) => t + c.kilos_confirmados, 0))} kg confirmados`;
  }

  // ---- Detalle de un certificado (respuesta de cgConsultarXCoe). Muestra solo lo que ARCA trajo.
  const lista = (x) => (Array.isArray(x) ? x : x ? [x] : []);
  const vacio = (v) => v == null || v === "";
  const kilos = (v) => (vacio(v) ? null : `${num.format(v)} kg`);
  const pesos = (v) => (vacio(v) ? null : dinero.format(v));
  const campoHtml = ([label, valor]) => `<div class="detail-field"><span>${esc(label)}</span><strong>${esc(valor)}</strong></div>`;
  const seccionHtml = (titulo, pares) => {
    const con = pares.filter(([, v]) => !vacio(v));
    return con.length ? `<h3>${esc(titulo)}</h3><div class="detail-grid">${con.map(campoHtml).join("")}</div>` : "";
  };

  function htmlDetalleCertificado(d) {
    const auth = d.autorizacion || {}, cab = d.cabecera || {}, prim = d.primaria || {}, ret = d.retiroTransferencia || {};
    const pre = d.preexistente || {}, planta = auth.planta || {}, pr = auth.pesosResumen || {}, sv = auth.serviciosResumen || {};
    const cal = prim.calidad || {};
    const grano = cab.codGrano ?? null;
    const generales = [
      ["Estado", auth.estado || "—"],
      ["Fecha de certificación", fmtFecha(auth.fechaCertificacion)],
      ["Tipo", nombreTipo(cab.tipoCertificado)],
      ["Pto. emisión / Orden", `${auth.ptoEmision ?? cab.ptoEmision ?? "—"} / ${auth.nroOrden ?? cab.nroOrden ?? "—"}`],
      ["Grano", grano == null ? "—" : nombreGrano(grano)],
      ["Campaña", cab.campania || "—"],
      ["Titular del grano", cab.titularGrano || "—"],
      ["Depositante", cab.cuitDepositante ? fmtCuit(cab.cuitDepositante) : "—"],
      ["Depositario", d.cuitDepositario ? fmtCuit(d.cuitDepositario) : "—"],
      ["Corredor", cab.cuitCorredor ? fmtCuit(cab.cuitCorredor) : "—"],
      ["Planta", planta.nroPlanta == null && d.nroPlanta == null ? "—" : `${planta.nroPlanta ?? d.nroPlanta}${planta.razonSocialTitularPlanta ? " · " + planta.razonSocialTitularPlanta : ""}`],
      ["CUIT titular de planta", planta.cuitTitularPlanta ? fmtCuit(planta.cuitTitularPlanta) : "—"],
      ["Kilos disponibles", kilos(d.kilosDisponible) || "—"],
    ];
    const ctg = lista(prim.ctg).map((c) => ({
      ctg: c.nroCTG ?? "—", carta: c.nroCartaDePorte ?? "—", peso: kilos(c.pesoNetoConfirmadoDefinitivo) || "—",
      humedad: vacio(c.porcentajeSecadoHumedad) ? "—" : `${c.porcentajeSecadoHumedad}%`, impSec: pesos(c.importeSecado) || "—",
      mermaSec: kilos(c.pesoNetoMermaSecado) || "—", tarSec: pesos(c.tarifaSecado) || "—",
      impZar: pesos(c.importeZarandeo) || "—", mermaZar: kilos(c.pesoNetoMermaZarandeo) || "—", tarZar: pesos(c.tarifaZarandeo) || "—",
    }));
    const ferro = lista(prim.cartaPorteFerroviaria).map((c) => ({
      carta: c.nroCartaPorte ?? "—", peso: kilos(c.pesoNetoConfirmadoDefinitivo) || "—",
      humedad: vacio(c.porcentajeSecadoHumedad) ? "—" : `${c.porcentajeSecadoHumedad}%`, impSec: pesos(c.importeSecado) || "—",
      mermaSec: kilos(c.pesoNetoMermaSecado) || "—", tarSec: pesos(c.tarifaSecado) || "—",
      impZar: pesos(c.importeZarandeo) || "—", mermaZar: kilos(c.pesoNetoMermaZarandeo) || "—", tarZar: pesos(c.tarifaZarandeo) || "—",
    }));
    const colsCtg = [["humedad", "% secado"], ["impSec", "Imp. secado"], ["mermaSec", "Merma secado"], ["tarSec", "Tarifa secado"], ["impZar", "Imp. zarandeo"], ["mermaZar", "Merma zarandeo"], ["tarZar", "Tarifa zarandeo"]];
    const rubros = lista(cal.detalleMuestraAnalisis).map((r) => ({
      rubro: r.descripcionRubro ?? "—", tipo: r.tipoRubro ?? "—", pct: vacio(r.porcentaje) ? "—" : `${r.porcentaje}%`, valor: r.valor ?? "—",
    }));
    return `
      <div class="detail-grid">${generales.map(campoHtml).join("")}</div>
      <div class="dialog-associated">
        ${seccionHtml("Pesos", [["Peso bruto", kilos(pr.pesoBrutoCertificado)], ["Merma volátil", kilos(pr.pesoMermaVolatil)], ["Merma por secado", kilos(pr.pesoMermaSecado)], ["Merma por zarandeo", kilos(pr.pesoMermaZarandeo)], ["Peso neto", kilos(pr.pesoNetoCertificado)]])}
        ${seccionHtml("Servicios", [["Secado", pesos(sv.servicioSecado)], ["Zarandeo", pesos(sv.servicioZarandeo)], ["Otros", pesos(sv.servicioOtros)], ["Gastos generales", pesos(sv.servicioGastosGenerales)], ["IVA", pesos(sv.importeIVA)], ["Total", pesos(sv.servicioTotal)]])}
        ${ctg.length ? `<h3>CTG</h3>${tablaDetalle(ctg, [["ctg", "CTG"], ["carta", "Carta de porte"], ["peso", "Peso neto confirmado"], ...colsCtg])}` : ""}
        ${ferro.length ? `<h3>Cartas de porte ferroviarias</h3>${tablaDetalle(ferro, [["carta", "Carta de porte"], ["peso", "Peso neto confirmado"], ...colsCtg])}` : ""}
        ${seccionHtml("Calidad", [["Análisis de muestra", cal.analisisMuestra], ["Nº de boletín", cal.nroBoletin], ["Grado", cal.codGrado], ["Valor de grado", cal.valorGrado], ["Contenido proteico", cal.valorContProteico], ["Factor", cal.valorFactor]])}
        ${rubros.length ? `<h3>Rubros de la muestra</h3>${tablaDetalle(rubros, [["rubro", "Rubro"], ["tipo", "Tipo"], ["pct", "%"], ["valor", "Valor"]])}` : ""}
        ${seccionHtml("Servicios facturados", [["Almacenaje", pesos(prim.montoAlmacenaje)], ["Acarreo", pesos(prim.montoAcarreo)], ["Gastos generales", pesos(prim.montoGastosGenerales)], ["Zarandeo", pesos(prim.montoZarandeo)], ["Secado", pesos(prim.montoSecado)], ["Secado de %", vacio(prim.porcentajeSecadoDe) ? null : `${prim.porcentajeSecadoDe}%`], ["Secado a %", vacio(prim.porcentajeSecadoA) ? null : `${prim.porcentajeSecadoA}%`], ["Por cada punto de exceso", pesos(prim.montoPorCadaPuntoExceso)], ["Otros", pesos(prim.montoOtros ?? prim.serviciosOtros)], ["Forma de pago", prim.serviciosFormaDePago], ["Conceptos no gravados", pesos(prim.serviciosConceptosNoGravados)], ["Percepciones IVA", pesos(prim.serviciosPercepcionesIVA)], ["Otras percepciones", pesos(prim.serviciosOtrasPercepciones)], ["Merma volátil", kilos(prim.pesoNetoMermaVolatil)]])}
        ${seccionHtml("Retiro / transferencia", [["COE certificado de depósito", ret.certificadoDeposito?.coeCertificadoDeposito], ["Peso neto", kilos(ret.certificadoDeposito?.pesoNeto)], ["CUIT receptor", ret.cuitReceptor ? fmtCuit(ret.cuitReceptor) : null], ["Carta de porte a utilizar", ret.nroCartaPorteAUtilizar], ["CTG", ret.nroCTG], ["Causa judicial", ret.descripcionCausaJudicial]])}
        ${seccionHtml("Certificado preexistente", [["Planta", pre.nroPlanta], ["Tipo", pre.tipoCertificadoDepositoPreexistente], ["N.º", pre.nroCertificadoDepositoPreexistente], ["CAC", pre.cacCertificadoDepositoPreexistente], ["Emisión", pre.fechaEmisionCertificadoDepositoPreexistente ? fmtFecha(pre.fechaEmisionCertificadoDepositoPreexistente) : null], ["Peso neto", kilos(pre.pesoNeto)]])}
        ${cab.datosAdicionales ? `<h3>Datos adicionales</h3><p>${esc(cab.datosAdicionales)}</p>` : ""}
      </div>`;
  }

  function abrirDetalleCertificado(coe) {
    const detalle = (certDetalles || {})[coe];
    $("detailTitle").textContent = `Certificado de muestra · COE ${coe}`;
    $("detailContent").innerHTML = detalle
      ? htmlDetalleCertificado(detalle) + '<div class="gr-detalle-pie"><span>Datos de muestra: en la app real el detalle se trae de ARCA y queda guardado.</span></div>'
      : "<p>Este certificado de muestra no tiene detalle.</p>";
    $("detailDialog").showModal();
  }

  function setVista(vista) {
    $("grdLiqVista").hidden = vista !== "liq";
    $("grdCertVista").hidden = vista !== "cert";
    $("grdCtgVista").hidden = vista !== "ctg";
    document.querySelectorAll("#granos .gr-vista").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.vista === vista);
      b.setAttribute("aria-pressed", String(b.dataset.vista === vista));
    });
  }
  document.querySelectorAll("#granos .gr-vista").forEach((b) => b.addEventListener("click", () => setVista(b.dataset.vista)));
  ["grdCertGrano", "grdCertCampania", "grdCertSoloSaldo"].forEach((id) => $(id).addEventListener("change", renderCert));
  $("grdCertRows").addEventListener("click", (event) => {
    const cert = event.target.closest("[data-cert-detalle]");
    if (cert) abrirDetalleCertificado(cert.dataset.certDetalle);
  });
  ["grdCtgGrano", "grdCtgCampania"].forEach((id) => $(id).addEventListener("change", renderCtg));

  async function load() {
    try {
      const r = await fetch("/api/demo/granos");
      if (!r.ok) throw new Error(`Error HTTP ${r.status}`);
      const d = await r.json();
      liquidaciones = d.liquidaciones || [];
      certificados = d.certificados || [];
      ctgs = d.ctg || [];
      certDetalles = d.certificado_detalles || {};
      renderCert();
      renderCtg();
      $("grdMsg").textContent = `${liquidaciones.length} liquidaciones de muestra · WSLPG (sin conexión a ARCA)`;
      renderFilas(filtradas());
      loaded = true;
    } catch (e) {
      $("grdMsg").textContent = `No se pudo cargar la demo: ${e.message}`;
    }
  }

  $("grdPrev").addEventListener("click", () => { pagina -= 1; renderFilas(filtradas()); });
  $("grdNext").addEventListener("click", () => { pagina += 1; renderFilas(filtradas()); });

  // Las fechas filtran al tipearlas (con o sin año) y al elegirlas en el calendario; la plantilla solo cambia.
  const aplicarFiltros = () => { pagina = 1; aviso(""); renderFilas(filtradas()); };
  enlazarFecha("grdDesde", aplicarFiltros);
  enlazarFecha("grdHasta", aplicarFiltros);
  $("grdPlantilla").addEventListener("change", aplicarFiltros);
  // El enlace de descarga se arma al hacer clic, así toma las fechas aunque el filtro aún no se haya repintado.
  $("grdExportar").addEventListener("click", actualizarExportacion);
  $("grdLimpiar").addEventListener("click", () => {
    fijarFecha("grdDesde", ""); fijarFecha("grdHasta", ""); aplicarFiltros();
  });

  // Copia la plantilla «BD Liquidaciones» como texto tabulado. Se pasa una promesa a ClipboardItem
  // para que Safari acepte la copia aunque el texto llegue después del clic (fetch).
  $("grdCopiar").addEventListener("click", async (event) => {
    const boton = event.currentTarget;
    boton.disabled = true;
    aviso("");
    let r;
    try {
      const respuesta = fetch(`/api/demo/granos/bd-liquidaciones${paramsFechas()}`).then((x) => {
        if (!x.ok) throw new Error(`Error HTTP ${x.status}`);
        return x.json();
      });
      if (navigator.clipboard && window.ClipboardItem) {
        const blob = respuesta.then((d) => { r = d; return new Blob([d.texto], { type: "text/plain" }); });
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      } else {
        r = await respuesta;
        await navigator.clipboard.writeText(r.texto);
      }
      if (!r.filas) aviso("No hay liquidaciones en ese rango.", true);
      else aviso(`${r.filas} fila${r.filas === 1 ? "" : "s"} copiada${r.filas === 1 ? "" : "s"}: pegalas en la columna A de la primera fila libre de tu planilla.${r.avisos.length ? ` · ${r.avisos.length} aviso(s): ${r.avisos.join(" · ")}` : ""}`, r.avisos.length > 0);
    } catch (e) {
      aviso("No se pudo copiar al portapapeles. Usá «Descargar xlsx» con la misma plantilla.", true);
    } finally {
      boton.disabled = false;
    }
  });

  $("grdRows").addEventListener("click", (event) => {
    const boton = event.target.closest("[data-detalle]");
    if (boton) abrirDetalle(boton.dataset.detalle);
  });

  function route() {
    const on = location.hash === "#granos";
    $("granos").hidden = !on;
    if (on && !loaded) load();
  }

  window.addEventListener("hashchange", route);
  route();
})();
