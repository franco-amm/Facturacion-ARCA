(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const TIPO = { 80: "CUIT", 86: "CUIL", 96: "DNI" };
  const pesos = (n) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
  const fmtFecha = (iso) => iso.split("-").reverse().join("/");
  let data = null, loaded = false, filas = [], historial = [], proximo = 0;

  // Importe «478.110,00» o «478110,5» → número (la coma es el decimal, como en la app real).
  const leerImporte = (t) => { const n = Number(String(t).replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };

  function validar(f) {
    const errores = [], avisos = [];
    const largo = f.documento.length;
    if (!(f.importe > 0)) errores.push("El importe debe ser mayor que cero.");
    if ((f.doc_tipo === 96) !== (largo === 8)) errores.push("El tipo de documento no coincide con el número.");
    if (f.importe_anterior && f.importe !== f.importe_anterior) avisos.push(`El importe cambió respecto del mes anterior (${pesos(f.importe_anterior)}).`);
    return { errores, avisos };
  }

  function render() {
    $("emdRows").innerHTML = filas.map((f, i) => {
      const v = f.validacion;
      const estado = f.emitida ? `<span class="status-badge">Autorizada</span><span class="mt-sub">${esc(f.numero)}</span>`
        : v ? (v.errores.length ? `<span class="em-error">${v.errores.map(esc).join("<br>")}</span>` : `<span class="status-badge">Válida</span>${v.avisos.map((a) => `<span class="em-aviso">${esc(a)}</span>`).join("")}`)
        : '<span class="mt-sub">Sin validar</span>';
      return `<tr>
        <td><input type="checkbox" data-sel="${i}" ${f.sel ? "checked" : ""} ${f.emitida ? "disabled" : ""} aria-label="Incluir ${esc(f.nombre)}"></td>
        <td><strong>${esc(f.nombre)}</strong><span class="invoice-subnumber">${esc(f.concepto)}</span></td>
        <td>${esc(f.receptor)}<span class="invoice-subnumber">${TIPO[f.doc_tipo]}: ${esc(f.documento)}</span></td>
        <td>${fmtFecha(f.vence)}</td>
        <td class="amount-cell">${f.emitida ? pesos(f.importe) : `<input class="em-importe" data-imp="${i}" value="${f.importe.toLocaleString("es-AR", { minimumFractionDigits: 2 })}" inputmode="decimal" aria-label="Importe de ${esc(f.nombre)}">`}</td>
        <td>${estado}</td>
        <td>${f.emitida ? '<a href="/assets/factura-demo.pdf" target="_blank" rel="noopener">PDF de ejemplo</a>' : ""}</td></tr>`;
    }).join("");
    const elegidas = filas.filter((f) => f.sel && !f.emitida);
    $("emdValidar").disabled = !elegidas.length;
    $("emdEmitir").disabled = !elegidas.length || elegidas.some((f) => !f.validacion || f.validacion.errores.length);
    $("emdResumen").textContent = `${elegidas.length} seleccionada${elegidas.length === 1 ? "" : "s"} · total ${pesos(elegidas.reduce((s, f) => s + f.importe, 0))}`;
    $("emdHistorial").innerHTML = historial.map((h) => `<tr><td>${fmtFecha(h.fecha)}</td><td>Factura C</td><td>${esc(h.receptor)}</td>
      <td>${String(data.emisor.punto_venta).padStart(5, "0")}-${String(h.numero).padStart(8, "0")}</td><td class="amount-cell">${pesos(h.importe)}</td>
      <td class="cae-value demo-cae">${esc(h.cae)}</td><td><a href="/assets/factura-demo.pdf" target="_blank" rel="noopener">PDF</a></td></tr>`).join("");
    $("emdHistorialVacio").hidden = historial.length > 0;
  }

  $("emdRows").addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.sel !== undefined) filas[+t.dataset.sel].sel = t.checked;
    if (t.dataset.imp !== undefined) { const f = filas[+t.dataset.imp]; f.importe = leerImporte(t.value); f.validacion = null; }
    render();
  });
  $("emdValidar").addEventListener("click", () => { filas.filter((f) => f.sel && !f.emitida).forEach((f) => { f.validacion = validar(f); }); render(); });

  $("emdEmitir").addEventListener("click", () => {
    const elegidas = filas.filter((f) => f.sel && !f.emitida);
    $("emdConfirmaTexto").textContent = `Vas a emitir ${elegidas.length} factura${elegidas.length === 1 ? "" : "s"} por ${pesos(elegidas.reduce((s, f) => s + f.importe, 0))}. Escribí la cantidad para confirmar:`;
    $("emdCantidad").value = ""; $("emdConfirmaOk").disabled = true; $("emdDialog").showModal();
  });
  $("emdCantidad").addEventListener("input", () => { $("emdConfirmaOk").disabled = Number($("emdCantidad").value) !== filas.filter((f) => f.sel && !f.emitida).length; });
  $("emdConfirmaCancel").addEventListener("click", () => $("emdDialog").close());
  $("emdConfirmaOk").addEventListener("click", () => {
    $("emdDialog").close();
    filas.filter((f) => f.sel && !f.emitida && f.validacion && !f.validacion.errores.length).forEach((f) => {
      f.emitida = true; f.numero = ++proximo;
      historial.unshift({ fecha: "2026-10-05", receptor: f.receptor, numero: f.numero, importe: f.importe, cae: "DEMO" + String(86400000000000 + f.numero * 7919).slice(0, 14) });
    });
    $("emdMsg").textContent = "Emisión simulada: no se envió nada a ARCA. Los números y CAE son ficticios y se pierden al recargar.";
    render();
  });
  $("emdReiniciar").addEventListener("click", () => { iniciar(); });

  function iniciar() {
    proximo = data.emisor.ultimo_numero; historial = [];
    filas = data.plantillas.map((p) => ({ ...p, sel: true, validacion: null, emitida: false }));
    $("emdMsg").textContent = `Emisor ficticio ${data.emisor.nombre} · punto de venta ${data.emisor.punto_venta} · lote de ${fmtFecha(data.mes + "-01").slice(3)}.`;
    render();
  }

  async function load() {
    loaded = true;
    try { data = await (await fetch("/api/demo/emitir")).json(); iniciar(); }
    catch (e) { loaded = false; $("emdMsg").textContent = "No se pudo cargar la demo de emisión."; }
  }
  function route() { const on = location.hash === "#emitir"; $("emitir").hidden = !on; if (on && !loaded) load(); }
  window.addEventListener("hashchange", route);
  route();
})();
