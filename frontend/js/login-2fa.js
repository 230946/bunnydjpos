/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * login-2fa.js — segundo paso del login de administradores.
 * Cuando /api/auth/login pide el código, muestra la ventana, lo verifica y
 * entrega a la página la misma respuesta { token, user } de siempre: así
 * ninguna pantalla de login necesita cambiar.
 */
(function () {
  if (window.__login2fa) return;
  window.__login2fa = true;
  const fetchOriginal = window.fetch.bind(window);

  const CSS = `
  .l2fa-bg{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:-apple-system,"Segoe UI",Arial,sans-serif}
  .l2fa{--f:#fff;--t:#102A24;--t2:#4a6058;--b:rgba(0,0,0,.18);--g:#0B8457;--e:#A32D2D;--el:#FCEBEB;background:var(--f);color:var(--t);border-radius:12px;padding:22px;width:100%;max-width:380px;max-height:92vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.3)}
  @media(prefers-color-scheme:dark){.l2fa{--f:#1e1e1c;--t:#f0efe8;--t2:#a0a09a;--b:rgba(255,255,255,.22);--el:#3a1010;--e:#f09595}}
  .l2fa h2{font-size:18px;margin:0 0 6px}
  .l2fa p{font-size:13px;color:var(--t2);margin:0 0 12px;line-height:1.45}
  .l2fa ol{font-size:13px;color:var(--t2);margin:0 0 12px;padding-left:18px;line-height:1.5}
  .l2fa .qr{display:block;margin:0 auto 8px;width:200px;height:200px;background:#fff;border-radius:8px;padding:6px}
  .l2fa .sec{font-family:ui-monospace,Consolas,monospace;font-size:12px;word-break:break-all;text-align:center;color:var(--t2);margin-bottom:12px}
  .l2fa input{width:100%;box-sizing:border-box;font-size:26px;letter-spacing:.2em;text-align:center;padding:10px;border:1px solid var(--b);border-radius:8px;background:var(--f);color:var(--t);font-family:inherit}
  .l2fa .err{background:var(--el);color:var(--e);font-size:13px;padding:8px 10px;border-radius:8px;margin-top:10px}
  .l2fa .acc{display:flex;gap:8px;margin-top:14px}
  .l2fa button{flex:1;padding:11px;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;border:1px solid var(--b);background:transparent;color:var(--t)}
  .l2fa button.p{background:var(--g);border-color:var(--g);color:#fff}
  .l2fa button:disabled{opacity:.6;cursor:wait}
  .l2fa .cod{display:grid;grid-template-columns:1fr 1fr;gap:6px;font-family:ui-monospace,Consolas,monospace;font-size:15px;text-align:center;margin:8px 0 12px}
  .l2fa .cod span{border:1px dashed var(--b);border-radius:6px;padding:6px}
  .l2fa .alt{background:none;border:none;color:var(--g);font-weight:600;font-size:12.5px;padding:6px 0 0;flex:none;text-decoration:underline}`;

  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    Object.assign(e, attrs || {});
    if (html != null) e.innerHTML = html;
    return e;
  }

  function respuesta(status, body) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }

  function mostrarCodigosRespaldo(caja, codigos) {
    return new Promise((resolve) => {
      caja.innerHTML = '';
      caja.append(
        el('h2', { textContent: 'Guarda tus códigos de emergencia' }),
        el('p', { textContent: 'Si pierdes el celular, cada uno sirve una sola vez en lugar del código de la app. Imprímelos o guárdalos fuera del celular. No se vuelven a mostrar.' }),
      );
      const g = el('div', { className: 'cod' });
      codigos.forEach(c => g.append(el('span', { textContent: c })));
      caja.append(g);
      const acc = el('div', { className: 'acc' });
      const copiar = el('button', { type: 'button', textContent: 'Copiar' });
      copiar.onclick = () => navigator.clipboard?.writeText(codigos.join('\n')).then(() => { copiar.textContent = '✓ Copiados'; }).catch(() => {});
      const listo = el('button', { type: 'button', className: 'p', textContent: 'Ya los guardé' });
      listo.onclick = resolve;
      acc.append(copiar, listo);
      caja.append(acc);
      listo.focus();
    });
  }

  function dialogo(urlLogin, datos) {
    return new Promise((resolve) => {
      if (!document.getElementById('l2fa-css')) document.head.append(el('style', { id: 'l2fa-css', textContent: CSS }));
      const fondo = el('div', { className: 'l2fa-bg' });
      const caja = el('div', { className: 'l2fa', role: 'dialog' });
      caja.setAttribute('aria-modal', 'true');
      fondo.append(caja);
      const cerrar = (r) => { fondo.remove(); resolve(r); };

      caja.append(el('h2', { textContent: datos.configurar ? 'Protege tu cuenta' : 'Código de verificación' }));
      if (datos.configurar) {
        caja.append(el('ol', {}, '<li>Instala <b>Google Authenticator</b> o <b>Microsoft Authenticator</b> en tu celular.</li><li>En la app toca <b>+</b> y escanea este código.</li><li>Escribe los 6 números que aparecen.</li>'));
        caja.append(el('img', { className: 'qr', src: datos.qr, alt: 'Código QR para la app autenticadora' }));
        caja.append(el('div', { className: 'sec', textContent: 'O escribe esta clave: ' + datos.secreto }));
      } else {
        caja.append(el('p', { textContent: 'Escribe los 6 números que muestra tu app autenticadora.' }));
      }
      const form = el('form');
      const input = el('input', { inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 9, placeholder: '000000' });
      input.setAttribute('aria-label', 'Código de verificación');
      const err = el('div', { className: 'err', hidden: true });
      const acc = el('div', { className: 'acc' });
      const cancelar = el('button', { type: 'button', textContent: 'Cancelar' });
      const enviar = el('button', { type: 'submit', className: 'p', textContent: 'Verificar' });
      acc.append(cancelar, enviar);
      form.append(input, err, acc);
      if (!datos.configurar) {
        const alt = el('button', { type: 'button', className: 'alt', textContent: 'Perdí el celular: usar un código de emergencia' });
        alt.onclick = () => { input.inputMode = 'text'; input.placeholder = 'XXXX-XXXX'; input.style.letterSpacing = '.08em'; input.value = ''; input.focus(); alt.remove(); };
        form.append(alt);
      }
      caja.append(form);
      document.body.append(fondo);
      input.focus();

      cancelar.onclick = () => cerrar(respuesta(401, { error: 'Inicio de sesión cancelado' }));
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const codigo = input.value.trim();
        if (!codigo) return;
        enviar.disabled = true; err.hidden = true;
        try {
          const r = await fetchOriginal(urlLogin.replace(/\/auth\/login(\?.*)?$/, '/auth/2fa'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ desafio: datos.desafio, codigo }),
          });
          const d = await r.json().catch(() => ({}));
          if (r.ok) {
            const { codigos_respaldo, ...sesion } = d;
            if (codigos_respaldo) await mostrarCodigosRespaldo(caja, codigos_respaldo);
            return cerrar(respuesta(200, sesion));
          }
          if (d.reiniciar) return cerrar(respuesta(401, { error: d.error }));
          err.textContent = d.error || 'No se pudo verificar el código.';
          err.hidden = false; input.select();
        } catch (e) {
          err.textContent = 'No hay conexión. Intenta de nuevo.'; err.hidden = false;
        } finally {
          enviar.disabled = false;
        }
      };
    });
  }

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const r = await fetchOriginal(input, init);
    let destino;
    try { destino = new URL(url, location.href); } catch { return r; }
    if (!/\/api\/auth\/login$/.test(destino.pathname) || !r.ok) return r;
    let d;
    try { d = await r.clone().json(); } catch { return r; }
    if (!d || !d.requiere_2fa) return r;
    return dialogo(destino.href, d);
  };
})();
