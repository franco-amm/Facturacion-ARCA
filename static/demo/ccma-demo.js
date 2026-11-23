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
    // Desplegable, como en la app.
    const ordenados = [...data.clientes].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    $("ccmaList").innerHTML = ordenados.map((c) => {
      const n = c.saldos.filter((s) => s.estado === "deudor").length;
      const estado = n ? `${n} período${n === 1 ? "" : "s"} deudor${n === 1 ? "" : "es"}` : "al día";
      return `<option value="${esc(c.cuit)}"${c.cuit === seleccion ? " selected" : ""}>${esc(c.nombre)} · ${esc(fmtCuit(c.cuit))} · ${esc(estado)}</option>`;
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
      const partes = ["saldo_arca", "saldo_iibb", "saldo_municipal"].map((k) => `<td class="amount-cell ccma-parte ${clase(s[k])}">${money(s[k])}</td>`).join("");
      return `<tr><td>${cliente}</td><td>${fmtPeriodo(s.periodo)}</td>${partes}
        <td class="amount-cell ccma-total ${clase(s.saldo_acumulado)}">${money(s.saldo_acumulado)}</td><td><span class="mt-state ${tono}">${esc(t)}</span></td></tr>`;
    }).join("");
    $("ccmaFooter").textContent = `${d.saldos.length} períodos · datos de muestra · Ingresos Brutos y Municipalidad según ARCA (Monotributo Unificado)`;
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
      $("ccmaList").innerHTML = `<option>No se pudo cargar la demo: ${esc(e.message)}</option>`;
    }
  }

  $("ccmaList").addEventListener("change", (event) => {
    if (!data || !event.target.value) return;
    seleccion = event.target.value;
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
