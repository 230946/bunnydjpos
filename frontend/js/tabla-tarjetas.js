/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * tabla-tarjetas.js — en el celular muestra una tabla como tarjetas.
 *
 * Basta con marcar el <tbody> de la tabla:
 *   <tbody id="fact-tbody" data-tarjetas data-tt-valor="Total"></tbody>
 * - La primera columna es el título de la tarjeta. Con data-tt-icono, la
 *   primera columna es una foto o emoji que va junto al título (la segunda).
 * - data-tt-valor: título de la columna que va en grande a la derecha.
 * - data-tt-titulo: título de la columna que encabeza la tarjeta (si no es la primera).
 * - data-tt-sin-acciones: la tabla no tiene columna de botones al final.
 * - Si la tabla tiene campos editables (input/select), se deja como tabla,
 *   salvo los marcados con data-tt-ok (actúan solos con su onchange).
 * - La última columna (botones) va abajo.
 * - Las demás columnas se muestran con su título; las vacías ("—") se omiten.
 * Las tarjetas se rehacen solas cada vez que la página cambia las filas, y
 * también funciona con tablas que la página crea después de cargar.
 */
(function () {
  const ANCHO = 700;
  const CSS = `
.tt-grid{display:none;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-top:4px}
.tt-card{--ok:#0B8457;--okl:#E1F5EE;--tx:#102A24;--tx2:#5b6e67;--bo:rgba(11,132,87,.35);--rj:#A32D2D;--rjl:#FCEBEB;
  background:var(--okl);border:1.5px solid var(--bo);border-radius:12px;padding:12px 12px 10px;color:var(--tx);font-family:inherit;text-align:left}
@media(prefers-color-scheme:dark){.tt-card{--okl:#0f2a20;--tx:#eef3f0;--tx2:#a7b8b1;--bo:rgba(93,202,165,.4);--rjl:#2e1414;--rj:#F09595}}
.tt-card.anulada{background:var(--rjl);border-color:var(--rj);opacity:.8}
.tt-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:6px}
.tt-tit{font-size:15px;font-weight:800;min-width:0;word-break:break-word;display:flex;align-items:center;gap:10px}
.tt-ico{flex:none;font-size:26px;line-height:1;display:flex}
.tt-ico img{width:44px!important;height:44px!important;border-radius:8px;object-fit:cover}
.tt-val{font-size:20px;font-weight:800;color:var(--ok);flex:none;text-align:right}
.tt-card.anulada .tt-val{color:var(--rj)}
.tt-filas{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:12.5px}
.tt-filas dt{color:var(--tx2);margin:0}
.tt-filas dd{margin:0;text-align:right;color:var(--tx);min-width:0;word-break:break-word}
.tt-acc{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.tt-acc .btn,.tt-acc button{flex:1 1 auto;width:auto!important;justify-content:center;padding:9px 10px!important;font-size:13px!important}
.tt-acc select{flex:1 1 100%;width:100%!important;min-height:40px;padding:8px 10px!important;font-size:13px!important;border-radius:8px}
.tt-acc .badge{align-self:center}
.tt-acc .icon-btn{background:rgba(255,255,255,.75);border:1px solid var(--bo);border-radius:8px;font-size:16px!important;min-height:40px}
@media(prefers-color-scheme:dark){.tt-acc .icon-btn{background:rgba(0,0,0,.2)}}
.tt-vacio{grid-column:1/-1;text-align:center;color:#5b6e67;padding:22px 8px}
@media(max-width:${ANCHO}px){.tt-grid{display:grid}.tt-oculta{display:none!important}
  .card:has(.tt-oculta) > .card-header{flex-wrap:wrap;gap:8px}
  .card:has(.tt-oculta) .card-header-actions,.card:has(.tt-oculta) .card-header > div{width:100%}
  .card:has(.tt-oculta) .card-header input{flex:1 1 130px;min-width:0;width:auto!important}}`;

  function prepararCss() {
    if (document.getElementById('tt-css')) return;
    const st = document.createElement('style');
    st.id = 'tt-css';
    st.textContent = CSS;
    document.head.append(st);
  }

  function pintar(tbody, grid, envoltura) {
    // Una tabla con campos editables se deja como tabla: copiarlos a la
    // tarjeta los desconectaría de la página.
    // Un campo marcado con data-tt-ok actúa solo (p. ej. un select con
    // onchange="accion(id,this.value)"), así que sí puede ir en la tarjeta.
    const conCampos = !!tbody.querySelector('input:not([data-tt-ok]),select:not([data-tt-ok]),textarea:not([data-tt-ok])');
    envoltura.classList.toggle('tt-oculta', !conCampos);
    grid.style.display = conCampos ? 'none' : '';
    if (conCampos) return;
    const tabla = tbody.closest('table');
    const titulos = tabla?.tHead ? [...tabla.tHead.rows[0].cells].map(th => th.textContent.trim()) : [];
    const idx = nombre => titulos.findIndex(t => t.toLowerCase() === String(nombre).toLowerCase());
    const colValor = idx(tbody.dataset.ttValor || 'total');
    const conIcono = 'ttIcono' in tbody.dataset;
    const colTit = tbody.dataset.ttTitulo && idx(tbody.dataset.ttTitulo) >= 0 ? idx(tbody.dataset.ttTitulo) : (conIcono ? 1 : 0);
    const sinAcciones = 'ttSinAcciones' in tbody.dataset;
    const filas = [...tbody.rows];
    if (!filas.length) { grid.innerHTML = ''; return; }
    grid.innerHTML = filas.map(tr => {
      const celdas = [...tr.cells];
      if (celdas.length === 1) return `<div class="tt-vacio">${celdas[0].innerHTML}</div>`; // "Sin resultados"
      const ult = sinAcciones ? -1 : celdas.length - 1;
      const filasHtml = celdas.map((td, i) => {
        if (i === colTit || (conIcono && i === 0) || i === ult || i === colValor) return '';
        const txt = td.textContent.trim();
        if (!txt || txt === '—' || txt === '-') return '';
        return `<dt>${titulos[i] || ''}</dt><dd>${td.innerHTML}</dd>`;
      }).join('');
      const anulada = /ANULADA/.test(tr.textContent);
      return `<div class="tt-card${anulada ? ' anulada' : ''}">
        <div class="tt-top"><div class="tt-tit">${conIcono ? `<span class="tt-ico">${celdas[0].innerHTML}</span>` : ''}<span>${celdas[colTit]?.innerHTML ?? ''}</span></div>${colValor >= 0 && colValor !== colTit && celdas[colValor] ? `<div class="tt-val">${celdas[colValor].innerHTML}</div>` : ''}</div>
        ${filasHtml ? `<dl class="tt-filas">${filasHtml}</dl>` : ''}
        ${ult >= 0 && (celdas[ult].textContent.trim() || celdas[ult].querySelector('button,a')) ? `<div class="tt-acc">${celdas[ult].innerHTML}</div>` : ''}
      </div>`;
    }).join('');
  }

  function activar(tbody) {
    if (tbody._tt) return;
    tbody._tt = true;
    prepararCss();
    const tabla = tbody.closest('table');
    const envoltura = tabla.closest('.table-wrap,.tbl-wrap') || tabla;
    envoltura.classList.add('tt-oculta');
    const grid = document.createElement('div');
    grid.className = 'tt-grid';
    envoltura.after(grid);
    let pendiente = false;
    const programar = () => { if (pendiente) return; pendiente = true; requestAnimationFrame(() => { pendiente = false; pintar(tbody, grid, envoltura); }); };
    new MutationObserver(programar).observe(tbody, { childList: true, subtree: true, characterData: true });
    pintar(tbody, grid, envoltura);
  }

  function buscar(raiz) { (raiz.querySelectorAll ? raiz.querySelectorAll('tbody[data-tarjetas]') : []).forEach(activar); }

  function iniciar() {
    buscar(document);
    // Tablas que la página crea después (por ejemplo, al cambiar de sección)
    new MutationObserver(cambios => {
      for (const c of cambios) for (const n of c.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches?.('tbody[data-tarjetas]')) activar(n); else buscar(n);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
