/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * comprobantes.js — revisión mensual de los comprobantes de pago
 * (Nequi / transferencia). El administrador compara cada cobro con el extracto
 * y lo marca como confirmado. Uso: Comprobantes.abrir(api, { ruta })
 * donde api(ruta, opciones) es la función de la página que llama a /api y
 * ruta es la base de las rutas (por defecto /admin/comprobantes; Peluquería
 * usa /peluqueria/comprobantes).
 */
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pesos = n => '$' + Math.round(+n || 0).toLocaleString('es-CO');
  const zona = () => (typeof NEG_ZONA === 'string' && NEG_ZONA) || 'America/Bogota';
  const fecha = d => new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: zona() });
  const CSS = `
.cmp-bg{position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:12px;font-family:-apple-system,"Segoe UI",Arial,sans-serif}
.cmp{--f:#fff;--f2:#f3f7f5;--t:#102A24;--t2:#5b6e67;--b:rgba(0,0,0,.14);--ok:#0B8457;--okl:#E1F5EE;--am:#BA7517;--aml:#FAEEDA;--rj:#A32D2D;--rjl:#FCEBEB;
  background:var(--f);color:var(--t);border-radius:14px;width:100%;max-width:880px;max-height:94vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.3)}
@media(prefers-color-scheme:dark){.cmp{--f:#1c1c1a;--f2:#262624;--t:#eef3f0;--t2:#a7b8b1;--b:rgba(255,255,255,.18);--okl:#0f2a20;--aml:#2e2310;--rjl:#2e1414;--ok:#1D9E75;--am:#EF9F27;--rj:#F09595}}
.cmp-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:16px 18px 10px;border-bottom:1px solid var(--b)}
.cmp-head h3{margin:0;font-size:18px;flex:1;min-width:180px}
.cmp-head input{padding:8px 10px;border:1px solid var(--b);border-radius:8px;background:var(--f);color:var(--t);font:inherit}
.cmp-x{border:none;background:transparent;color:var(--t2);font-size:22px;cursor:pointer;padding:2px 8px}
.cmp-res{display:flex;gap:8px;flex-wrap:wrap;padding:12px 18px 0}
.cmp-chip{background:var(--f2);border-radius:10px;padding:8px 12px;font-size:12px;color:var(--t2)}
.cmp-chip b{display:block;font-size:17px;color:var(--t)}
.cmp-chip.ok b{color:var(--ok)} .cmp-chip.am b{color:var(--am)} .cmp-chip.rj b{color:var(--rj)}
.cmp-tabs{display:flex;gap:6px;padding:12px 18px;flex-wrap:wrap}
.cmp-tabs button{border:1px solid var(--b);background:transparent;color:var(--t);border-radius:20px;padding:6px 14px;font:600 13px inherit;font-family:inherit;cursor:pointer}
.cmp-tabs button.on{background:var(--ok);border-color:var(--ok);color:#fff}
.cmp-list{overflow-y:auto;padding:0 18px 18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.cmp-it{border:1.5px solid var(--b);border-radius:12px;padding:10px;display:flex;gap:10px;background:var(--f)}
.cmp-it.ok{border-color:var(--ok);background:var(--okl)}
.cmp-it.sin{border-color:var(--rj);background:var(--rjl)}
.cmp-foto{width:78px;height:96px;flex:none;border-radius:8px;object-fit:cover;cursor:zoom-in;border:1px solid var(--b);background:#fff}
.cmp-nofoto{width:78px;height:96px;flex:none;border-radius:8px;border:1px dashed var(--rj);color:var(--rj);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;text-align:center;padding:4px}
.cmp-info{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--t2)}
.cmp-info .m{font-size:18px;font-weight:800;color:var(--t)}
.cmp-info .f{font-weight:700;color:var(--t)}
.cmp-acc{margin-top:auto;padding-top:6px}
.cmp-acc button{width:100%;padding:9px;border-radius:8px;font:700 13px inherit;font-family:inherit;cursor:pointer;border:1px solid var(--ok);background:var(--ok);color:#fff}
.cmp-acc button.des{background:transparent;color:var(--t2);border-color:var(--b);font-weight:600}
.cmp-okt{color:var(--ok);font-weight:700}
.cmp-vacio{grid-column:1/-1;text-align:center;color:var(--t2);padding:30px 10px}
.cmp-zoom{position:fixed;inset:0;z-index:2001;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:16px;cursor:zoom-out}
.cmp-zoom img{max-width:100%;max-height:100%;border-radius:8px}`;

  let estado = null;

  function resumen(ventas) {
    const con = ventas.filter(v => v.evidencia_pago_url), ok = ventas.filter(v => v.evidencia_confirmada_en);
    const monto = v => +v.monto_nequi > 0 ? +v.monto_nequi : +v.total;
    return {
      total: ventas.length, valor: ventas.reduce((a, v) => a + monto(v), 0),
      ok: ok.length, valorOk: ok.reduce((a, v) => a + monto(v), 0),
      pend: ventas.filter(v => !v.evidencia_confirmada_en).length,
      sinFoto: ventas.length - con.length, monto,
    };
  }

  function pintar() {
    const { caja, ventas, filtro } = estado;
    const r = resumen(ventas);
    caja.querySelector('.cmp-res').innerHTML = `
      <div class="cmp-chip"><b>${r.total}</b>cobros · ${pesos(r.valor)}</div>
      <div class="cmp-chip ok"><b>${r.ok}</b>confirmados · ${pesos(r.valorOk)}</div>
      <div class="cmp-chip am"><b>${r.pend}</b>por revisar</div>
      <div class="cmp-chip rj"><b>${r.sinFoto}</b>sin foto</div>`;
    caja.querySelectorAll('.cmp-tabs button').forEach(b => b.classList.toggle('on', b.dataset.f === filtro));
    const lista = ventas.filter(v => filtro === 'todos' ? true : filtro === 'ok' ? v.evidencia_confirmada_en : filtro === 'sin' ? !v.evidencia_pago_url : !v.evidencia_confirmada_en);
    const el = caja.querySelector('.cmp-list');
    if (!lista.length) {
      el.innerHTML = `<div class="cmp-vacio">${ventas.length ? (filtro === 'pend' ? '✓ No hay comprobantes por revisar este mes.' : 'Nada en esta vista.') : 'No hubo cobros por Nequi o transferencia este mes.'}</div>`;
      return;
    }
    el.innerHTML = lista.map(v => {
      const ok = !!v.evidencia_confirmada_en;
      const clase = ok ? 'ok' : (!v.evidencia_pago_url ? 'sin' : '');
      const metodo = v.metodo_pago === 'mixto' ? `Mixto (Nequi ${pesos(v.monto_nequi)} de ${pesos(v.total)})` : v.metodo_pago === 'transferencia' ? 'Transferencia' : 'Nequi';
      return `<div class="cmp-it ${clase}">
        ${v.evidencia_pago_url ? `<img class="cmp-foto" src="${esc(v.evidencia_pago_url)}" alt="Comprobante" data-zoom="${esc(v.evidencia_pago_url)}">` : '<div class="cmp-nofoto">Sin foto</div>'}
        <div class="cmp-info">
          <span class="m">${pesos(r.monto(v))}</span>
          <span class="f">${esc(v.numero_factura || '—')} · ${fecha(v.creado)}</span>
          <span>${esc(metodo)}</span>
          <span>${esc(v.cliente_nombre || (v.mesa_num ? 'Mesa ' + v.mesa_num : 'Mostrador'))} · Cajero: ${esc(v.cajero_nombre || '—')}</span>
          ${ok ? `<span class="cmp-okt">✓ Confirmado${v.confirmada_por_nombre ? ' por ' + esc(v.confirmada_por_nombre) : ''} · ${fecha(v.evidencia_confirmada_en)}</span>` : ''}
          <div class="cmp-acc">${ok
            ? `<button type="button" class="des" data-id="${esc(v.id)}" data-c="0">Deshacer confirmación</button>`
            : `<button type="button" data-id="${esc(v.id)}" data-c="1">✓ Confirmar — está en el extracto</button>`}</div>
        </div>
      </div>`;
    }).join('');
  }

  async function cargar() {
    const { caja, api, mes } = estado;
    caja.querySelector('.cmp-list').innerHTML = '<div class="cmp-vacio">Cargando…</div>';
    try {
      const d = await api(`${estado.ruta}?mes=${encodeURIComponent(mes)}`);
      estado.ventas = d.ventas || [];
      pintar();
    } catch (e) {
      caja.querySelector('.cmp-list').innerHTML = `<div class="cmp-vacio">No se pudieron cargar: ${esc(e.message)}</div>`;
    }
  }

  function abrir(api, opts = {}) {
    if (!document.getElementById('cmp-css')) {
      const st = document.createElement('style'); st.id = 'cmp-css'; st.textContent = CSS; document.head.append(st);
    }
    document.querySelector('.cmp-bg')?.remove();
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: zona(), year: 'numeric', month: '2-digit' }).format(new Date());
    const fondo = document.createElement('div');
    fondo.className = 'cmp-bg';
    fondo.innerHTML = `<div class="cmp" role="dialog" aria-modal="true" aria-label="Comprobantes de pago">
      <div class="cmp-head"><h3>📸 Comprobantes de pago</h3>
        <input type="month" value="${hoy}" max="${hoy}" aria-label="Mes">
        <button type="button" class="cmp-x" aria-label="Cerrar">✕</button></div>
      <div class="cmp-res"></div>
      <div class="cmp-tabs">
        <button type="button" data-f="pend">Por revisar</button><button type="button" data-f="ok">Confirmados</button>
        <button type="button" data-f="sin">Sin foto</button><button type="button" data-f="todos">Todos</button></div>
      <div class="cmp-list"></div></div>`;
    document.body.append(fondo);
    const caja = fondo.querySelector('.cmp');
    estado = { caja, api, mes: hoy, filtro: 'pend', ventas: [], ruta: opts.ruta || '/admin/comprobantes' };
    const cerrar = () => { fondo.remove(); estado = null; };
    fondo.querySelector('.cmp-x').onclick = cerrar;
    fondo.addEventListener('click', e => { if (e.target === fondo) cerrar(); });
    fondo.querySelector('input[type=month]').onchange = e => { if (e.target.value) { estado.mes = e.target.value; cargar(); } };
    fondo.querySelector('.cmp-tabs').onclick = e => { const f = e.target.dataset?.f; if (f) { estado.filtro = f; pintar(); } };
    fondo.querySelector('.cmp-list').onclick = async e => {
      const z = e.target.dataset?.zoom;
      if (z) {
        const zm = document.createElement('div'); zm.className = 'cmp-zoom';
        zm.innerHTML = `<img src="${esc(z)}" alt="Comprobante del pago">`;
        zm.onclick = () => zm.remove(); document.body.append(zm); return;
      }
      const b = e.target.closest('button[data-id]'); if (!b) return;
      b.disabled = true;
      try {
        await api(`${estado.ruta}/${encodeURIComponent(b.dataset.id)}/confirmar`, { method: 'PUT', body: JSON.stringify({ confirmado: b.dataset.c === '1' }) });
        await cargar();
      } catch (err) { b.disabled = false; alert('No se pudo guardar: ' + err.message); }
    };
    cargar();
  }

  window.Comprobantes = { abrir };
})();
