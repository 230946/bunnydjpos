/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * elegir-foto.js — pide una imagen dejando escoger entre tomar una foto con
 * la cámara o elegir un archivo (galería, captura de pantalla, computador).
 *
 *   elegirFoto(file => { ... }, { titulo, texto })
 *
 * Solo imágenes JPG, PNG, WEBP o GIF: es lo que acepta el servidor.
 */
(function () {
  const TIPOS = 'image/jpeg,image/png,image/webp,image/gif';

  function inputOculto(conCamara) {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = TIPOS;
    if (conCamara) i.setAttribute('capture', 'environment');
    i.style.display = 'none';
    document.body.appendChild(i);
    return i;
  }

  function elegirFoto(alElegir, opts = {}) {
    document.getElementById('elegir-foto-bg')?.remove();
    const fondo = document.createElement('div');
    fondo.id = 'elegir-foto-bg';
    fondo.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center;padding:16px;font-family:-apple-system,"Segoe UI",Arial,sans-serif';
    const oscuro = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
    const c = oscuro ? { f: '#1e1e1c', t: '#f0efe8', t2: '#a0a09a', b: 'rgba(255,255,255,.2)' } : { f: '#fff', t: '#102A24', t2: '#4a6058', b: 'rgba(0,0,0,.18)' };
    const caja = document.createElement('div');
    caja.setAttribute('role', 'dialog');
    caja.setAttribute('aria-modal', 'true');
    caja.style.cssText = `background:${c.f};color:${c.t};border-radius:14px;padding:18px;width:100%;max-width:380px;box-shadow:0 10px 40px rgba(0,0,0,.3);margin-bottom:max(0px,env(safe-area-inset-bottom))`;
    const btn = (txt, principal) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = txt;
      b.style.cssText = `display:block;width:100%;padding:14px;margin-top:8px;border-radius:10px;font:700 15px inherit;font-family:inherit;cursor:pointer;` +
        (principal ? 'background:#0B8457;border:1px solid #0B8457;color:#fff' : `background:transparent;border:1px solid ${c.b};color:${c.t}`);
      return b;
    };
    const h = document.createElement('div');
    h.textContent = opts.titulo || 'Comprobante del pago';
    h.style.cssText = 'font-size:17px;font-weight:800;margin-bottom:4px';
    const p = document.createElement('div');
    p.textContent = opts.texto || 'Toma una foto del comprobante o elige una imagen guardada (por ejemplo, la captura de pantalla que te envió el cliente).';
    p.style.cssText = `font-size:13px;color:${c.t2};line-height:1.45;margin-bottom:6px`;
    const camara = btn('📷 Tomar foto', true);
    const archivo = btn('🖼️ Elegir archivo', false);
    const cancelar = btn('Cancelar', false);
    cancelar.style.border = 'none';
    caja.append(h, p, camara, archivo, cancelar);
    fondo.append(caja);
    document.body.append(fondo);
    const cerrar = () => fondo.remove();
    const abrir = conCamara => {
      cerrar();
      const i = inputOculto(conCamara);
      i.onchange = () => { const f = i.files[0]; i.remove(); if (f) alElegir(f); };
      i.click();
      // Si se cancela el selector, el navegador no siempre avisa: se limpia luego.
      setTimeout(() => { if (!i.files.length) i.remove(); }, 10 * 60 * 1000);
    };
    camara.onclick = () => abrir(true);
    archivo.onclick = () => abrir(false);
    cancelar.onclick = cerrar;
    fondo.onclick = e => { if (e.target === fondo) cerrar(); };
    camara.focus();
  }

  window.elegirFoto = elegirFoto;
})();
