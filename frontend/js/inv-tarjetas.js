/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * inv-tarjetas.js — inventario en tarjetas para el celular.
 *
 * En pantallas angostas la tabla de inventario se oculta y se muestran
 * tarjetas (verde = bien, amarillo = bajo stock, rojo = agotado) con botones
 * grandes para sumar o restar stock. Cada panel le pasa sus propios datos:
 *
 *   invTarjetas.render('inv-cards', items, { ocultar: '#panel-inventario .table-wrap' })
 *   item = { nombre, sub, stock, minimo, estado: 'ok'|'bajo'|'agotado',
 *            precios: [['Compra', '$1.500'], ...],
 *            acciones: [{ txt, tipo: 'entrada'|'salida'|'editar'|'borrar', fn: "js()" }] }
 */
(function () {
  const ANCHO = 700;
  const CSS = `
.invc-grid{display:none;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;margin-top:4px}
.invc{--ok:#0B8457;--okd:#085041;--okl:#E1F5EE;--ba:#BA7517;--bal:#FAEEDA;--ag:#A32D2D;--agl:#FCEBEB;--tx:#102A24;--tx2:#5b6e67;--fo:#fff;--bo:rgba(0,0,0,.18);
  background:var(--okl);border:1.5px solid var(--ok);border-radius:12px;padding:12px;color:var(--tx);font-family:inherit;text-align:left}
@media(prefers-color-scheme:dark){.invc{--okl:#0f2a20;--bal:#2e2310;--agl:#2e1414;--tx:#eef3f0;--tx2:#a7b8b1;--fo:#1c1c1a;--bo:rgba(255,255,255,.2);--okd:#5DCAA5;--ba:#EF9F27;--ag:#F09595}}
.invc.bajo{background:var(--bal);border-color:var(--ba)}
.invc.agotado{background:var(--agl);border-color:var(--ag)}
.invc-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.invc-nom{font-size:15px;font-weight:800;line-height:1.25;word-break:break-word}
.invc-sub{font-size:11.5px;color:var(--tx2);margin-top:2px}
.invc-st{text-align:right;flex:none}
.invc-st b{display:block;font-size:28px;line-height:1.05;color:var(--okd)}
.invc.bajo .invc-st b{color:var(--ba)}
.invc.agotado .invc-st b{color:var(--ag)}
.invc-st span{font-size:11px;color:var(--tx2)}
.invc-pr{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--tx2);margin:10px 0}
.invc-pr b{color:var(--tx)}
.invc-acc{display:flex;gap:6px}
.invc-acc button{font-family:inherit;font-size:14px;font-weight:700;border-radius:8px;cursor:pointer;padding:11px 6px;border:1px solid var(--bo);background:var(--fo);color:var(--tx);width:auto!important;margin:0}
.invc-acc .ent{flex:1;background:var(--ok);border-color:var(--ok);color:#fff}
.invc-acc .sal{flex:1}
.invc-acc .ico{flex:none;padding:0 12px;font-size:16px}
.invc-acc .bor{color:var(--ag)}
.invc-vacio{color:#5b6e67;text-align:center;padding:24px;grid-column:1/-1}
@media(max-width:${ANCHO}px){.invc-grid{display:grid}
  #panel-inventario .card-header{flex-wrap:wrap;gap:8px}
  #panel-inventario .card-header-actions{flex-wrap:wrap;gap:6px}}`;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ocultos = new Set();

  function prepararCss(ocultar) {
    if (!document.getElementById('invc-css')) {
      const st = document.createElement('style');
      st.id = 'invc-css';
      st.textContent = CSS;
      document.head.append(st);
    }
    if (ocultar && !ocultos.has(ocultar)) {
      ocultos.add(ocultar);
      const st = document.createElement('style');
      st.textContent = `@media(max-width:${ANCHO}px){${ocultar}{display:none!important}}`;
      document.head.append(st);
    }
  }

  const ETIQUETA = { entrada: '<b style="font-size:18px;line-height:1">+</b>&nbsp;Entrada', salida: '<b style="font-size:18px;line-height:1">−</b>&nbsp;Salida', editar: '✏️', borrar: '🗑️' };
  const CLASE = { entrada: 'ent', salida: 'sal', editar: 'ico', borrar: 'ico bor' };
  const TITULO = { editar: 'Editar', borrar: 'Borrar' };

  function render(contenedor, items, opts = {}) {
    const el = typeof contenedor === 'string' ? document.getElementById(contenedor) : contenedor;
    if (!el) return;
    prepararCss(opts.ocultar);
    el.classList.add('invc-grid');
    if (!items.length) { el.innerHTML = `<div class="invc-vacio">${esc(opts.vacio || 'Sin artículos')}</div>`; return; }
    el.innerHTML = items.map(i => {
      const estado = i.estado === 'agotado' ? 'agotado' : i.estado === 'bajo' ? 'bajo' : '';
      const leyenda = estado === 'agotado' ? 'Agotado' : estado === 'bajo' ? 'Bajo stock' : 'en stock';
      return `<div class="invc ${estado}">
        <div class="invc-top">
          <div style="min-width:0"><div class="invc-nom">${esc(i.nombre)}</div>${i.sub ? `<div class="invc-sub">${esc(i.sub)}</div>` : ''}</div>
          <div class="invc-st"><b>${esc(i.stock)}</b><span>${leyenda}${i.minimo != null && i.minimo !== '' ? ' · mín ' + esc(i.minimo) : ''}</span></div>
        </div>
        ${(i.precios || []).length ? `<div class="invc-pr">${i.precios.map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join('')}</div>` : '<div style="height:10px"></div>'}
        <div class="invc-acc">${(i.acciones || []).map(a =>
          `<button type="button" class="${CLASE[a.tipo] || 'sal'}" ${TITULO[a.tipo] ? `title="${TITULO[a.tipo]}" aria-label="${TITULO[a.tipo]}"` : ''} onclick="${esc(a.fn)}">${a.txt ? esc(a.txt) : ETIQUETA[a.tipo]}</button>`).join('')}</div>
      </div>`;
    }).join('');
  }

  window.invTarjetas = { render };
})();
