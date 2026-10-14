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
  const CATALOGO_GRANOS = { "19": "Maíz", "23": "Soja" };

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

  function renderFilas(items) {
    $("grdFooter").textContent = `${items.length} liquidaci${items.length === 1 ? "ón" : "ones"} de muestra`;
    $("grdRows").innerHTML = items
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

  async function load() {
    try {
      const r = await fetch("/api/demo/granos");
      if (!r.ok) throw new Error(`Error HTTP ${r.status}`);
      const d = await r.json();
      liquidaciones = d.liquidaciones || [];
      $("grdMsg").textContent = `${liquidaciones.length} liquidaciones de muestra · WSLPG (sin conexión a ARCA)`;
      renderFilas(liquidaciones);
      loaded = true;
    } catch (e) {
      $("grdMsg").textContent = `No se pudo cargar la demo: ${e.message}`;
    }
  }

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
