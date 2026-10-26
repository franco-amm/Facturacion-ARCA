(() => {
  "use strict";
  // Fake door: no hay envío real ni llamadas externas. Solo muestra cómo sería el aviso.
  const LISTAS = { mtAlertList: "mt", dfeAlertList: "dfe" };
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

  function mensaje(tipo, nombre, detalle) {
    if (tipo === "mt") {
      return `Hola, te escribimos del Estudio. Sobre ${nombre}: ${detalle}\n\nTe recomendamos revisar la facturación del período antes de emitir nuevos comprobantes. Cualquier duda, respondé este mensaje.`;
    }
    return `Hola, te escribimos del Estudio. Hay una comunicación urgente en el Domicilio Fiscal Electrónico de ${nombre}: ${detalle}\n\nLa estamos revisando. Te avisamos los próximos pasos.`;
  }

  let overlay;
  function modal() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "wa-overlay"; overlay.hidden = true;
    overlay.innerHTML = `<div class="wa-modal" role="dialog" aria-modal="true" aria-label="Aviso por WhatsApp">
      <div class="wa-head"><h3>Aviso por WhatsApp</h3><button class="mt-close" type="button" data-wa-cerrar aria-label="Cerrar">✕</button></div>
      <div class="wa-body"><p class="wa-to"></p><div class="wa-chat"><div class="wa-bubble"></div></div>
        <p class="wa-note">Vista previa de una función en desarrollo. Todavía no se envía ningún mensaje real.</p>
        <p class="wa-thanks" hidden>Anotado. Nos sirve para priorizar esta función.</p>
        <div class="wa-actions"><button class="button button-quiet" type="button" data-wa-cerrar>Cerrar</button>
        <button class="button" type="button" data-wa-quiero>Quiero esta función</button></div></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest("[data-wa-cerrar]")) overlay.hidden = true;
      if (e.target.closest("[data-wa-quiero]")) {
        overlay.querySelector(".wa-thanks").hidden = false;
        try { localStorage.setItem("wa_fakedoor_interes", String(Date.now())); } catch (_) {}
      }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") overlay.hidden = true; });
    return overlay;
  }

  function abrir(tipo, li) {
    const nombre = txt(li.querySelector("strong"));
    const detalle = txt(li.querySelector("p"));
    const o = modal();
    o.querySelector(".wa-to").textContent = `Para: contacto de ${nombre} (número de ejemplo)`;
    o.querySelector(".wa-bubble").textContent = mensaje(tipo, nombre, detalle);
    o.querySelector(".wa-thanks").hidden = true;
    o.hidden = false;
  }

  function abrirAviso(tipo, nombre, detalle) {
    const o = modal();
    o.querySelector(".wa-to").textContent = `Para: contacto de ${nombre} (número de ejemplo)`;
    o.querySelector(".wa-bubble").textContent = mensaje(tipo, nombre, detalle);
    o.querySelector(".wa-thanks").hidden = true;
    o.hidden = false;
  }
  window.WaFakedoor = { abrirAviso };

  function inyectar(ul, tipo) {
    ul.querySelectorAll("li.mt-alert:not(.wa-has)").forEach((li) => {
      li.classList.add("wa-has");
      const b = document.createElement("button");
      b.type = "button"; b.className = "wa-btn"; b.textContent = "Notificar por WhatsApp";
      b.addEventListener("click", () => abrir(tipo, li));
      const cierre = li.querySelector(".mt-close");
      li.insertBefore(b, cierre || null);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    Object.entries(LISTAS).forEach(([id, tipo]) => {
      const ul = document.getElementById(id);
      if (!ul) return;
      inyectar(ul, tipo);
      new MutationObserver(() => inyectar(ul, tipo)).observe(ul, { childList: true });
    });
  });
})();
