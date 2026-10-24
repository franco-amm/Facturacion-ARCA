(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmtCuit = (c) => (/^\d{11}$/.test(c) ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);
  const fmtPeriodo = (p) => (p ? `${p.slice(5, 7)}/${p.slice(0, 4)}` : "—");
  const pesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
  const money = (n) => (n == null ? "—" : pesos.format(n));
  const clase = (n) => (n < 0 ? "ccma-saldo-neg" : n > 0 ? "ccma-saldo-pos" : "");
  const ESTADOS = { deudor: ["Deudor", "bad"], saldado: ["Saldado", "muted"], acreedor: ["Acreedor", "ok"] };
  let data = null;
  let seleccion = null;
  let loaded = false;

  function renderClientes() {
    $("ccmaList").innerHTML = data.clientes.map((c) => {
      const n = c.saldos.filter((s) => s.estado === "deudor").length;
      const estado = n ? `<span class="mt-state bad">${n} período${n === 1 ? "" : "s"} deudor${n === 1 ? "" : "es"}</span>` : '<span class="mt-state ok">Al día</span>';
      return `<div class="emisor-card${c.cuit === seleccion ? " is-selected" : ""}">
        <button class="emisor-select" data-cliente="${esc(c.cuit)}" type="button" role="option" aria-selected="${c.cuit === seleccion}">
          <strong>${esc(c.nombre)}</strong><span class="emisor-cuit">${esc(fmtCuit(c.cuit))}</span>${estado}
        </button></div>`;
    }).join("");
  }

  function renderDatos() {
    const d = data.clientes.find((c) => c.cuit === seleccion);
    $("ccmaDatos").hidden = !d;
    if (!d) return;
    const u = d.ultima_deuda;
    const cliente = `${esc(fmtCuit(d.cuit))} - ${esc(d.nombre)}`;
    $("ccmaDeudaBody").innerHTML = `<tr><td>${cliente}</td><td>${esc(u.fecha_calculo)}</td>
      <td>${fmtPeriodo(u.periodo_desde)} - ${fmtPeriodo(u.periodo_hasta)}</td>
      <td class="amount-cell">${money(u.total_deudor)}</td><td class="amount-cell">${money(u.total_acreedor)}</td>
      <td class="amount-cell ${clase(u.saldo_neto)}">${money(u.saldo_neto)}</td></tr>`;
    $("ccmaSaldosBody").innerHTML = [...d.saldos].reverse().map((s) => {
      const [t, tono] = ESTADOS[s.estado] || [s.estado, "muted"];
      return `<tr><td>${cliente}</td><td>${fmtPeriodo(s.periodo)}</td>
        <td class="amount-cell ${clase(s.saldo_acumulado)}">${money(s.saldo_acumulado)}</td><td><span class="mt-state ${tono}">${esc(t)}</span></td></tr>`;
    }).join("");
    $("ccmaFooter").textContent = `${d.saldos.length} períodos · datos de muestra`;
  }

  function render() { renderClientes(); renderDatos(); }

  async function load() {
    try {
      const r = await fetch("/api/demo/ccma");
      if (!r.ok) throw new Error(`Error HTTP ${r.status}`);
      data = await r.json();
      seleccion = data.clientes[0].cuit;
      loaded = true;
      render();
    } catch (e) {
      $("ccmaList").innerHTML = `<p class="emisor-note">No se pudo cargar la demo: ${esc(e.message)}</p>`;
    }
  }

  $("ccmaList").addEventListener("click", (event) => {
    const b = event.target.closest("[data-cliente]");
    if (!b || !data) return;
    seleccion = b.dataset.cliente;
    render();
  });
  $("ccmaSync").addEventListener("click", () => {
    const t = $("ccmaToast");
    t.textContent = "Demo: no se consulta ARCA. En la versión real se lee CCMA con la clave fiscal del cliente.";
    t.hidden = false;
    setTimeout(() => { t.hidden = true; }, 4500);
  });

  function route() {
    const on = location.hash === "#ccma";
    $("ccma").hidden = !on;
    if (on && !loaded) load();
  }
  window.addEventListener("hashchange", route);
  route();
})();
