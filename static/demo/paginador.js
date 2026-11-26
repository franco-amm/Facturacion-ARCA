// Paginador compartido de los listados (app y demo): muestra de a 25 filas con «‹ Anterior · Página x de y · Siguiente ›».
// Uso: const pag = Paginador.crear(elementoTabla, { alCambiar: render, etiqueta: "Paginación de …" });
//      en el render: const visibles = pag.cortar(items);   al cambiar filtros o búsqueda: pag.reiniciar();
(function () {
  const POR_PAGINA = 25;

  function crear(ancla, { porPagina = POR_PAGINA, etiqueta = "Paginación", alCambiar } = {}) {
    let pagina = 1;
    const nav = document.createElement("nav");
    nav.className = "pager";
    nav.hidden = true;
    nav.setAttribute("aria-label", etiqueta);
    nav.innerHTML = '<button class="button button-quiet" type="button" data-pag="-1">‹ Anterior</button>'
      + '<span class="pager-texto"></span>'
      + '<button class="button button-quiet" type="button" data-pag="1">Siguiente ›</button>';
    ancla.insertAdjacentElement("afterend", nav);
    nav.addEventListener("click", (event) => {
      const boton = event.target.closest("[data-pag]");
      if (!boton || boton.disabled) return;
      pagina += Number(boton.dataset.pag);
      if (alCambiar) alCambiar();
    });

    return {
      cortar(items) {
        const total = items.length;
        const paginas = Math.max(1, Math.ceil(total / porPagina));
        pagina = Math.min(Math.max(1, pagina), paginas);
        const desde = (pagina - 1) * porPagina;
        nav.hidden = paginas <= 1;
        nav.querySelector(".pager-texto").textContent =
          `Página ${pagina} de ${paginas} · ${desde + 1}–${Math.min(desde + porPagina, total)} de ${total}`;
        nav.querySelector('[data-pag="-1"]').disabled = pagina <= 1;
        nav.querySelector('[data-pag="1"]').disabled = pagina >= paginas;
        return items.slice(desde, desde + porPagina);
      },
      reiniciar() { pagina = 1; },
    };
  }

  window.Paginador = { crear, POR_PAGINA };
})();
