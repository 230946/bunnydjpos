/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * QR de pago (Nequi / transferencia) y foto de comprobante, compartidos por las
 * cajas de Restaurante, Minimercado, Ferretería y Ropa.
 *
 *   PagoQr.mostrar(el, token, ['nequi'])     muestra los QR; con [] los oculta
 *   PagoQr.pedirEvidencia(file => ...)       abre la cámara; llamar desde el clic
 *   PagoQr.subirEvidencia(ventaId, file, token)
 *   PagoQr.verImagen(url, titulo)            pantalla completa; se cierra tocando
 *   PagoQr.montarConfig(contenedor, token)   QR y hora de turno, en el admin
 */
window.PagoQr = (function () {
  const API = window.location.origin + '/api';
  const TITULOS = { nequi: 'Nequi', transferencia: 'Transferencia' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function pedir(ruta, token, opciones = {}) {
    const r = await fetch(API + ruta, {
      ...opciones,
      headers: { ...(opciones.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${token}` },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo conectar con el servidor');
    return d;
  }

  // Configuraciones viejas guardaban el QR de Nequi en qrNequi
  function qrDe(cfg, tipo) {
    const q = cfg?.qrPago?.[tipo] || {};
    return { url: q.url || (tipo === 'nequi' ? cfg?.qrNequi : null) || null, texto: q.texto || '' };
  }

  function verImagen(url, titulo) {
    const fondo = document.createElement('div');
    fondo.style.cssText = 'position:fixed;inset:0;z-index:10001;background:#fff;color:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;gap:10px;font-weight:700;text-align:center;cursor:zoom-out';
    fondo.innerHTML = `<img src="${esc(url)}" alt="" style="max-width:100%;max-height:85%;object-fit:contain"><div>${esc(titulo || '')}</div>`;
    fondo.onclick = () => fondo.remove();
    document.body.appendChild(fondo);
  }

  let ultimaPeticion = 0;
  async function mostrar(el, token, tipos) {
    if (!el) return;
    const peticion = ++ultimaPeticion;
    if (!tipos.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'block';
    el.innerHTML = '';
    let cfg = {};
    try { cfg = await pedir('/admin/config/factura', token); } catch (_) { /* se muestra el aviso */ }
    if (peticion !== ultimaPeticion) return; // el cajero ya cambió de método
    const lista = tipos.map(t => ({ t, ...qrDe(cfg, t) })).filter(q => q.url);
    if (!lista.length) {
      el.innerHTML = '<p style="font-size:12px;color:var(--text2);text-align:center;margin:0 0 10px">No hay QR de pago configurado. El administrador lo sube en la configuración de la factura.</p>';
      return;
    }
    el.innerHTML = `<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin:0 0 10px">${lista.map((q, i) => `
      <div data-i="${i}" title="Tocá para agrandar" style="flex:1 1 130px;max-width:200px;text-align:center;cursor:zoom-in">
        <img src="${esc(q.url)}" alt="QR ${TITULOS[q.t]}" style="width:100%;aspect-ratio:1;object-fit:contain;background:#fff;border:1px solid var(--border2);border-radius:8px;padding:6px;box-sizing:border-box">
        <div style="font-size:12px;font-weight:700;margin-top:4px">${TITULOS[q.t]}</div>
        ${q.texto ? `<div style="font-size:11px;color:var(--text2)">${esc(q.texto)}</div>` : ''}
      </div>`).join('')}</div>`;
    el.querySelectorAll('[data-i]').forEach(n => {
      const q = lista[+n.dataset.i];
      n.onclick = () => verImagen(q.url, TITULOS[q.t] + (q.texto ? ` — ${q.texto}` : ''));
    });
  }

  // Control interno: comprueba que el QR mostrado sí se cobró. No devuelve
  // promesa porque el navegador no siempre avisa cuando se cancela la cámara.
  function pedirEvidencia(alCapturar) {
    let input = document.getElementById('pago-evidencia-input');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'pago-evidencia-input';
      input.accept = 'image/*';
      input.setAttribute('capture', 'environment');
      input.style.display = 'none';
      document.body.appendChild(input);
    }
    input.value = '';
    input.onchange = () => { if (input.files[0]) alCapturar(input.files[0]); };
    input.click();
  }

  // Un fallo aquí no debe tumbar un cobro que ya quedó registrado
  async function subirEvidencia(ventaId, file, token) {
    if (!file || !ventaId) return;
    const form = new FormData();
    form.append('foto', file);
    try { await pedir(`/pos/ventas/${ventaId}/evidencia`, token, { method: 'POST', body: form }); }
    catch (e) { console.warn('No se pudo subir el comprobante:', e.message); }
  }

  async function montarConfig(contenedor, token) {
    if (!contenedor) return;
    let cfg;
    try { cfg = await pedir('/admin/config/factura', token); }
    catch (e) { contenedor.innerHTML = `<p style="font-size:12px;color:var(--text2)">${esc(e.message)}</p>`; return; }

    const casilla = t => {
      const q = qrDe(cfg, t);
      return `<div class="field" style="flex:1 1 200px;min-width:0"><label>${TITULOS[t]}</label>
        <div data-subir="${t}" title="Clic para subir el QR" style="width:140px;height:140px;border:1.5px dashed var(--border2);border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;margin-bottom:6px;overflow:hidden;background:#fff">
          ${q.url ? `<img src="${esc(q.url)}" alt="QR ${TITULOS[t]}" style="width:100%;height:100%;object-fit:contain">` : '<span style="font-size:12px;color:#888;text-align:center;padding:6px">📷 Subir imagen del QR</span>'}
        </div>
        <input type="file" data-archivo="${t}" accept="image/jpeg,image/png,image/webp" style="display:none">
        ${q.url ? `<button type="button" class="btn btn-outline btn-sm" data-quitar="${t}" style="margin-bottom:6px">Quitar QR</button>` : ''}
        <input data-texto="${t}" placeholder="${t === 'nequi' ? 'Ej: Nequi 300 123 4567 — Juan' : 'Ej: Bancolombia ahorros 123-456789-00'}" value="${esc(q.texto)}">
      </div>`;
    };
    contenedor.innerHTML = `
      <h3 style="margin:0 0 4px">📱 QR de pago</h3>
      <p style="font-size:12px;color:var(--text2);margin:0 0 10px">Se muestra en la caja al cobrar por Nequi o transferencia, y el cajero toma foto del comprobante.</p>
      <div style="display:flex;gap:14px;flex-wrap:wrap">${casilla('nequi')}${casilla('transferencia')}</div>
      <div class="field" style="max-width:260px"><label>Hora de inicio del siguiente turno</label>
        <input data-c="hora" type="time" value="${esc(cfg.horaInicioTurno || '14:00')}">
        <p style="font-size:11px;color:var(--text2);margin:3px 0 0">Si a esta hora sigue abierta la caja de un día anterior, se bloquea vender hasta cerrarla.</p>
      </div>
      <button type="button" class="btn btn-primary btn-sm" data-c="guardar">Guardar QR y turno</button>
      <span data-c="msg" style="font-size:12px;margin-left:8px"></span>`;

    const msg = t => { contenedor.querySelector('[data-c="msg"]').textContent = t; };
    contenedor.querySelectorAll('[data-subir]').forEach(n => {
      n.onclick = () => contenedor.querySelector(`[data-archivo="${n.dataset.subir}"]`).click();
    });
    contenedor.querySelectorAll('[data-archivo]').forEach(input => {
      input.onchange = async () => {
        const f = input.files[0];
        if (!f) return;
        const form = new FormData();
        form.append('qr', f);
        msg('Subiendo…');
        try { await pedir(`/admin/config/qr-pago/${input.dataset.archivo}`, token, { method: 'POST', body: form }); montarConfig(contenedor, token); }
        catch (e) { msg(e.message); }
      };
    });
    contenedor.querySelectorAll('[data-quitar]').forEach(b => {
      b.onclick = async () => {
        if (!confirm('¿Quitar este QR de pago?')) return;
        try { await pedir(`/admin/config/qr-pago/${b.dataset.quitar}`, token, { method: 'DELETE' }); montarConfig(contenedor, token); }
        catch (e) { msg(e.message); }
      };
    });
    contenedor.querySelector('[data-c="guardar"]').onclick = async () => {
      msg('Guardando…');
      const qrPago = {};
      for (const t of Object.keys(TITULOS))
        qrPago[t] = { url: qrDe(cfg, t).url, texto: contenedor.querySelector(`[data-texto="${t}"]`).value.trim() };
      try {
        // El servidor combina esto con el resto de la configuración de factura
        await pedir('/admin/config/factura', token, {
          method: 'PUT',
          body: JSON.stringify({ qrPago, horaInicioTurno: contenedor.querySelector('[data-c="hora"]').value || '14:00' }),
        });
        msg('Guardado ✓');
      } catch (e) { msg(e.message); }
    };
  }

  return { mostrar, pedirEvidencia, subirEvidencia, verImagen, montarConfig };
})();
