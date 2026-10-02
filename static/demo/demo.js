const TYPE_LABELS = { 11: "Factura C", 12: "Nota de Débito C", 13: "Nota de Crédito C" };
const ui = Object.fromEntries([
  "issuerName", "issuerCuit", "pointOfSale", "totalCount", "demoMessage",
  "filterForm", "fromDate", "toDate", "searchInput", "resultSummary",
  "visibleCount", "invoiceRows", "tableWrap", "tableState", "footerCount",
  "csvButton", "xlsxButton", "reloadDemo", "detailDialog", "detailTitle",
  "detailContent", "closeDialog",
].map((id) => [id, document.getElementById(id)]));

let dataset = null;
let filteredInvoices = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("es-AR").format(parsed);
}

function formatMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(amount) : "—";
}

function selectedTypes() {
  return [...document.querySelectorAll('input[name="types"]:checked')].map((input) => Number(input.value));
}

function paramsForExport() {
  const params = new URLSearchParams({ from_date: ui.fromDate.value, to_date: ui.toDate.value });
  selectedTypes().forEach((type) => params.append("types", String(type)));
  return params;
}

async function loadDataset() {
  const response = await fetch("/assets/demo-data.json", { cache: "no-store" });
  if (!response.ok) throw new Error("No se pudo cargar el conjunto de muestra.");
  dataset = await response.json();
  ui.issuerName.textContent = dataset.issuer.name;
  ui.issuerCuit.textContent = dataset.issuer.cuit;
  ui.pointOfSale.textContent = dataset.issuer.punto_venta;
  ui.totalCount.textContent = new Intl.NumberFormat("es-AR").format(dataset.invoices.length);
  ui.demoMessage.textContent = `${dataset.invoices.length} registros ficticios · sin conexión a ARCA`;
  renderInvoices();
}

function renderInvoices() {
  if (!dataset) return;
  const start = ui.fromDate.value;
  const end = ui.toDate.value;
  const types = selectedTypes();
  const term = ui.searchInput.value.trim().toLocaleLowerCase("es-AR");
  filteredInvoices = dataset.invoices.filter((invoice) => {
    const matchesFilter = invoice.Fecha >= start && invoice.Fecha <= end && types.includes(Number(invoice.TipoComprobante));
    const matchesSearch = !term || [invoice.Receptor, invoice.DocNro, invoice.Numero, invoice.CAE, invoice.TipoDescripcion]
      .some((value) => String(value || "").toLocaleLowerCase("es-AR").includes(term));
    return matchesFilter && matchesSearch;
  });

  const count = filteredInvoices.length;
  ui.visibleCount.textContent = `${count} ${count === 1 ? "comprobante" : "comprobantes"}`;
  ui.footerCount.textContent = `${count} ${count === 1 ? "resultado" : "resultados"}`;
  ui.resultSummary.textContent = `${count} registros de muestra en el período seleccionado`;
  ui.csvButton.disabled = count === 0;
  ui.xlsxButton.disabled = count === 0;

  if (!count) {
    ui.invoiceRows.replaceChildren();
    ui.tableState.innerHTML = `<strong>Sin comprobantes en este período</strong><p>Prueba otro intervalo de fechas o modifica los tipos seleccionados.</p>`;
    ui.tableState.hidden = false;
    ui.tableWrap.classList.add("is-empty");
    return;
  }

  ui.tableState.hidden = true;
  ui.tableWrap.classList.remove("is-empty");
  ui.invoiceRows.replaceChildren(...filteredInvoices.map((invoice) => {
    const type = String(invoice.TipoComprobante);
    const number = String(invoice.Numero).padStart(8, "0");
    const point = String(invoice.PuntoVenta).padStart(5, "0");
    const row = document.createElement("tr");
    row.innerHTML = [
      `<td><button class="invoice-link" type="button" data-detail="${escapeHtml(type)}:${escapeHtml(invoice.Numero)}"><span class="invoice-kind">C</span><span>${escapeHtml(point)}-${escapeHtml(number)}<small class="invoice-subnumber">${escapeHtml(invoice.TipoDescripcion)}</small></span></button></td>`,
      `<td>${escapeHtml(formatDate(invoice.Fecha))}</td>`,
      `<td><span class="recipient-name">${escapeHtml(invoice.Receptor)}</span></td>`,
      `<td class="amount-cell">${escapeHtml(formatMoney(invoice.ImpTotal))}</td>`,
      `<td><span class="cae-value demo-cae">${escapeHtml(invoice.CAE)}</span></td>`,
      `<td><span class="status-badge">Autorizado · demo</span></td>`,
      `<td><button class="detail-button" type="button" data-detail="${escapeHtml(type)}:${escapeHtml(invoice.Numero)}">Ver</button></td>`,
    ].join("");
    return row;
  }));
}

function openDetail(invoice) {
  const type = String(invoice.TipoComprobante);
  const point = String(invoice.PuntoVenta).padStart(5, "0");
  const number = String(invoice.Numero).padStart(8, "0");
  ui.detailTitle.textContent = `${TYPE_LABELS[type] || "Comprobante"} · ${point}-${number}`;
  const fields = [
    ["Fecha de emisión", formatDate(invoice.Fecha)],
    ["Tipo", invoice.TipoDescripcion],
    ["Receptor", invoice.Receptor],
    ["Documento", invoice.DocNro],
    ["Importe total", formatMoney(invoice.ImpTotal)],
    ["Neto", formatMoney(invoice.ImpNeto)],
    ["CAE de muestra", invoice.CAE],
    ["Vencimiento de muestra", formatDate(`${invoice.CAEFchVto.slice(0, 4)}-${invoice.CAEFchVto.slice(4, 6)}-${invoice.CAEFchVto.slice(6, 8)}`)],
  ];
  const associated = (invoice.CbtesAsoc || []).map((item) => `${TYPE_LABELS[item.Tipo] || item.Tipo} · PV ${item.PtoVta} · N.º ${item.Nro}`).join("; ") || "Sin comprobantes asociados";
  ui.detailContent.innerHTML = `<div class="detail-grid">${fields.map(([label, value]) => `<div class="detail-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div><div class="dialog-associated"><h3>Comprobantes asociados</h3><p>${escapeHtml(associated)}</p><h3 class="observation-heading">Observaciones</h3><p>${escapeHtml(invoice.Observaciones || "Datos de ejemplo")}</p></div>`;
  ui.detailDialog.showModal();
}

function exportFile(extension) {
  window.location.assign(`/api/demo/export.${extension}?${paramsForExport()}`);
}

function bindEvents() {
  ui.filterForm.addEventListener("submit", (event) => { event.preventDefault(); renderInvoices(); });
  ui.searchInput.addEventListener("input", renderInvoices);
  ui.reloadDemo.addEventListener("click", loadDataset);
  ui.csvButton.addEventListener("click", () => exportFile("csv"));
  ui.xlsxButton.addEventListener("click", () => exportFile("xlsx"));
  ui.closeDialog.addEventListener("click", () => ui.detailDialog.close());
  ui.detailDialog.addEventListener("click", (event) => { if (event.target === ui.detailDialog) ui.detailDialog.close(); });
  ui.invoiceRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-detail]");
    if (!button) return;
    const [type, number] = button.dataset.detail.split(":");
    const invoice = dataset.invoices.find((item) => String(item.TipoComprobante) === type && String(item.Numero) === number);
    if (invoice) openDetail(invoice);
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      ui.searchInput.focus();
    }
  });
}

function setDefaultDates() {
  const now = new Date();
  ui.fromDate.value = localDate(new Date(now.getFullYear(), now.getMonth(), 1));
  ui.toDate.value = localDate(now);
}

bindEvents();
setDefaultDates();
loadDataset().catch((error) => {
  ui.resultSummary.textContent = error.message;
  ui.tableState.innerHTML = `<strong>No se pudo cargar la demo</strong><p>${escapeHtml(error.message)}</p>`;
  ui.tableState.hidden = false;
});
