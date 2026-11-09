/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * Cobro con Bold, común a todas las cajas (backend: routes/bold.js).
 *
 *   BoldPago.prepararSelect(selectMetodo, token)   agrega la opción si está activo
 *   await BoldPago.disponible(token)               para cajas con botones de método
 *   const pago = await BoldPago.cobrar({ token, monto, descripcion })
 *       → { id } cuando el pago quedó aprobado; null si el cajero lo cancela.
 *         Con ese id la caja registra la venta (metodo_pago:'bold', bold_pago_id).
 *   BoldPago.montarConfig(contenedor, token)       formulario de llaves del admin
 */
window.BoldPago = (function () {
  const BASE = window.location.origin + '/api/bold';
  const SEGUNDOS_ENTRE_CONSULTAS = 3;
  const MENSAJES = {
    RECHAZADA: 'El pago fue rechazado. Podés generar un cobro nuevo o usar otro método.',
    EXPIRADA: 'El cobro venció sin pagarse. Podés generar uno nuevo o usar otro método.',
    CANCELADA: 'El cobro fue cancelado.',
    ANULADA: 'Este pago fue anulado en Bold.',
    REVISAR: 'Bold reportó un monto distinto al cobrado. Revisalo en el panel de Bold antes de entregar el pedido.',
  };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pesos = n => '$' + Math.round(+n || 0).toLocaleString('es-CO');

  async function pedir(ruta, token, opciones = {}) {
    const r = await fetch(BASE + ruta, {
      ...opciones,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo conectar con el servidor');
    return d;
  }

  async function disponible(token) {
    try { return (await pedir('/estado', token)).activo; }
    catch (_) { return false; } // sin Bold se cobra con lo demás
  }

  async function prepararSelect(select, token) {
    const activo = await disponible(token);
    const opcion = select.querySelector('option[value="bold"]');
    if (!activo) {
      if (opcion) {
        if (select.value === 'bold') { select.value = 'efectivo'; select.dispatchEvent(new Event('change')); }
        opcion.remove();
      }
      return;
    }
    if (opcion) return;
    const nueva = document.createElement('option');
    nueva.value = 'bold';
    nueva.textContent = '📲 Bold (QR: tarjeta, PSE, Nequi)';
    select.insertBefore(nueva, select.querySelector('option[value="mixto"]'));
  }

  function crearVentana() {
    const fondo = document.createElement('div');
    fondo.id = 'bold-ventana';
    fondo.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:16px';
    fondo.innerHTML = `<div style="background:#fff;color:#1a1a1a;border-radius:14px;width:100%;max-width:360px;max-height:100%;overflow:auto;padding:20px;text-align:center;font-family:inherit">
      <div data-c="cuerpo"></div></div>`;
    document.body.appendChild(fondo);
    return { fondo, cuerpo: fondo.querySelector('[data-c="cuerpo"]') };
  }

  const BOTON = 'display:block;width:100%;padding:11px;margin-top:8px;border-radius:9px;font:inherit;font-weight:600;cursor:pointer;';
  const PRIMARIO = BOTON + 'border:none;background:#121e6c;color:#fff';
  const SECUNDARIO = BOTON + 'border:1px solid #ccc;background:#fff;color:#1a1a1a';

  function cobrar({ token, monto, descripcion }) {
    return new Promise(resolve => {
      const { fondo, cuerpo } = crearVentana();
      let temporizador = null;
      let terminado = false;
      const cerrar = valor => {
        if (terminado) return;
        terminado = true;
        clearTimeout(temporizador);
        fondo.remove();
        resolve(valor);
      };

      function mostrarError(texto) {
        cuerpo.innerHTML = `<h3 style="margin:0 0 8px">Bold</h3>
          <p style="font-size:14px;margin:0 0 8px">${esc(texto)}</p>
          <button data-a="otro" style="${PRIMARIO}">Generar otro cobro</button>
          <button data-a="salir" style="${SECUNDARIO}">Volver</button>`;
        cuerpo.querySelector('[data-a="otro"]').onclick = crearCobro;
        cuerpo.querySelector('[data-a="salir"]').onclick = () => cerrar(null);
      }

      function mostrarQr(pago) {
        cuerpo.innerHTML = `<h3 style="margin:0 0 2px">Escaneá para pagar</h3>
          <div style="font-size:26px;font-weight:700;margin-bottom:8px">${pesos(monto)}</div>
          ${pago.modo_pruebas ? '<div style="font-size:12px;font-weight:700;color:#b45309;margin-bottom:6px">MODO PRUEBAS: no es dinero real</div>' : ''}
          <img src="${esc(pago.qr)}" alt="QR de pago" style="width:100%;max-width:280px;display:block;margin:0 auto">
          <p data-c="estado" style="font-size:13px;color:#555;margin:8px 0 4px">Esperando el pago…</p>
          <p style="font-size:12px;color:#777;margin:0">Vence en ${pago.minutos} minutos</p>
          <button data-a="copiar" style="${SECUNDARIO}">Copiar link de pago</button>
          <button data-a="cancelar" style="${SECUNDARIO}">Cancelar</button>`;
        const estado = cuerpo.querySelector('[data-c="estado"]');

        cuerpo.querySelector('[data-a="copiar"]').onclick = async () => {
          try { await navigator.clipboard.writeText(pago.url); estado.textContent = 'Link copiado'; }
          catch (_) { window.prompt('Copiá el link de pago:', pago.url); }
        };
        cuerpo.querySelector('[data-a="cancelar"]').onclick = async () => {
          clearTimeout(temporizador);
          estado.textContent = 'Cancelando…';
          try {
            const r = await pedir(`/pagos/${pago.id}/cancelar`, token, { method: 'POST' });
            // El cliente alcanzó a pagar mientras se cancelaba: el pago vale
            if (r.estado === 'PAGADA') return cerrar({ id: r.id });
            if (r.estado === 'REVISAR') return mostrarError(MENSAJES.REVISAR);
            cerrar(null);
          } catch (e) {
            estado.textContent = e.message;
            temporizador = setTimeout(consultar, SEGUNDOS_ENTRE_CONSULTAS * 1000);
          }
        };

        async function consultar() {
          if (terminado) return;
          let r = null;
          try { r = await pedir(`/pagos/${pago.id}`, token); }
          catch (_) { /* conexión intermitente: se reintenta */ }
          if (terminado) return;
          if (r?.estado === 'PAGADA') return cerrar({ id: r.id });
          if (r && r.estado !== 'PENDIENTE') return mostrarError(MENSAJES[r.estado] || 'El cobro no se completó.');
          temporizador = setTimeout(consultar, SEGUNDOS_ENTRE_CONSULTAS * 1000);
        }
        temporizador = setTimeout(consultar, SEGUNDOS_ENTRE_CONSULTAS * 1000);
      }

      async function crearCobro() {
        cuerpo.innerHTML = '<p style="font-size:14px;margin:12px 0">Generando el cobro…</p>';
        try {
          mostrarQr(await pedir('/pagos', token, { method: 'POST', body: JSON.stringify({ monto, descripcion }) }));
        } catch (e) { mostrarError(e.message); }
      }

      // Un pago aprobado que no quedó en una venta (se canceló tarde, se cerró
      // la pestaña): se ofrece antes de cobrarle otra vez al cliente.
      function ofrecerSinUsar(p) {
        const hora = p.pagado_en ? new Date(p.pagado_en).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '';
        cuerpo.innerHTML = `<h3 style="margin:0 0 8px">Ya hay un pago aprobado</h3>
          <p style="font-size:14px;margin:0 0 8px">Bold aprobó ${pesos(p.monto)}${hora ? ` el ${esc(hora)}` : ''} y ese pago no quedó en ninguna venta. Si es de este cliente, usalo en vez de cobrarle de nuevo.</p>
          <button data-a="usar" style="${PRIMARIO}">Usar este pago</button>
          <button data-a="nuevo" style="${SECUNDARIO}">Es de otro cliente: cobrar de nuevo</button>
          <button data-a="salir" style="${SECUNDARIO}">Volver</button>`;
        cuerpo.querySelector('[data-a="usar"]').onclick = () => cerrar({ id: p.id });
        cuerpo.querySelector('[data-a="nuevo"]').onclick = crearCobro;
        cuerpo.querySelector('[data-a="salir"]').onclick = () => cerrar(null);
      }

      (async () => {
        cuerpo.innerHTML = '<p style="font-size:14px;margin:12px 0">Preparando el cobro…</p>';
        let sinUsar = [];
        try { sinUsar = await pedir(`/pagos/sin-usar?monto=${encodeURIComponent(monto)}`, token); }
        catch (_) { /* no impide cobrar */ }
        if (sinUsar[0]) ofrecerSinUsar(sinUsar[0]); else crearCobro();
      })();
    });
  }

  async function montarConfig(contenedor, token) {
    if (!contenedor) return;
    let c;
    try { c = await pedir('/config', token); }
    catch (e) { contenedor.innerHTML = `<p style="font-size:12px;color:var(--text2)">${esc(e.message)}</p>`; return; }
    contenedor.innerHTML = `
      <h3 style="margin-bottom:4px">📲 Cobros con Bold</h3>
      <p style="font-size:12px;color:var(--text2);margin-bottom:10px">La caja genera un QR por el valor exacto y registra la venta sola cuando Bold aprueba el pago. En el cierre de caja suma como tarjeta.</p>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:8px;cursor:pointer"><input type="checkbox" data-c="activo" style="width:auto" ${c.activo ? 'checked' : ''}> Ofrecer Bold en la caja</label>
      <div class="field"><label>Llave de identidad</label><input data-c="identidad" autocomplete="off" placeholder="${c.tiene_identidad ? 'Guardada: dejá en blanco para conservarla' : ''}"></div>
      <div class="field"><label>Llave secreta</label><input data-c="secreta" type="password" autocomplete="new-password" placeholder="${c.tiene_secreta ? 'Guardada: dejá en blanco para conservarla' : ''}"></div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:4px;cursor:pointer"><input type="checkbox" data-c="pruebas" style="width:auto" ${c.modo_pruebas ? 'checked' : ''}> Modo pruebas (llaves de prueba de Bold)</label>
      <p style="font-size:11px;color:var(--text2);margin-bottom:10px">Apagalo antes de cobrar de verdad: en pruebas los avisos de Bold no llevan una firma segura.</p>
      <div class="field"><label>URL del webhook (registrala en el panel de Bold)</label><input data-c="webhook" readonly value="${esc(c.webhook_url)}"></div>
      <button type="button" class="btn btn-primary btn-sm" data-c="guardar">Guardar Bold</button>
      <span data-c="msg" style="font-size:12px;margin-left:8px"></span>`;
    const campo = n => contenedor.querySelector(`[data-c="${n}"]`);
    campo('webhook').onclick = e => e.target.select();
    campo('guardar').onclick = async () => {
      campo('msg').textContent = 'Guardando…';
      try {
        await pedir('/config', token, {
          method: 'PUT',
          body: JSON.stringify({
            identity_key: campo('identidad').value,
            secret_key: campo('secreta').value,
            activo: campo('activo').checked,
            modo_pruebas: campo('pruebas').checked,
          }),
        });
        montarConfig(contenedor, token);
      } catch (e) { campo('msg').textContent = e.message; }
    };
  }

  return { disponible, prepararSelect, cobrar, montarConfig };
})();
