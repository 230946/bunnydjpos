/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * vitrina-admin.js — ventana para configurar la Vitrina del negocio
 * (página pública tipo anuncio con los productos, /vitrina?n=…).
 *
 * Uso en un panel admin: <script src="/js/vitrina-admin.js"></script> y un
 * botón onclick="abrirVitrina(token)". Solo planes Plus y Premium.
 * Las promociones y recomendados salen de cada producto del menú.
 */
(function () {
  const CSS = `
.vt-bg{position:fixed;inset:0;z-index:2147483000;background:rgba(10,20,16,.55);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px 12px}
.vt{--ok:#0B8457;--tx:#102A24;--tx2:#5b6e67;--bo:rgba(16,42,36,.14);--bg:#fff;--bg2:#F3F8F5;
  background:var(--bg);color:var(--tx);width:100%;max-width:640px;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.35);font:14px/1.45 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;text-align:left}
@media(prefers-color-scheme:dark){.vt{--tx:#eef3f0;--tx2:#a7b8b1;--bo:rgba(255,255,255,.14);--bg:#14211c;--bg2:#1b2c25}}
.vt *{box-sizing:border-box}
.vt-h{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 18px;border-bottom:1px solid var(--bo)}
.vt-h h3{margin:0;font-size:17px}
.vt-x{border:0;background:transparent;color:var(--tx2);font-size:22px;cursor:pointer;line-height:1;padding:4px 8px}
.vt-b{padding:16px 18px;display:flex;flex-direction:column;gap:14px}
.vt-aviso{background:#FFF6E0;color:#7a4b00;border:1px solid #f0d28c;border-radius:10px;padding:10px 12px;font-size:13px}
@media(prefers-color-scheme:dark){.vt-aviso{background:#3a2c0c;color:#f4d68f;border-color:#6b5420}}
.vt-tip{background:var(--bg2);border-radius:10px;padding:10px 12px;font-size:12.5px;color:var(--tx2)}
.vt-sw{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--bg2);border-radius:12px;padding:12px 14px}
.vt-sw b{display:block}
.vt-sw small{color:var(--tx2)}
.vt-sw input{width:46px;height:26px;accent-color:var(--ok);flex:none}
.vt label.vt-l{display:block;font-size:12.5px;font-weight:700;margin-bottom:5px}
.vt input[type=text],.vt input[type=url]{width:100%;padding:10px 12px;border:1px solid var(--bo);border-radius:9px;background:var(--bg);color:var(--tx);font:inherit}
.vt input:focus{outline:2px solid rgba(11,132,87,.35);border-color:var(--ok)}
.vt-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:520px){.vt-2{grid-template-columns:1fr}}
.vt-est{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
@media(max-width:420px){.vt-est{grid-template-columns:1fr}}
.vt-est label{border:2px solid var(--bo);border-radius:12px;padding:8px;cursor:pointer;display:flex;flex-direction:column;gap:6px;font-size:12.5px}
.vt-est label:has(input:checked){border-color:var(--ok);box-shadow:0 0 0 3px rgba(11,132,87,.18)}
.vt-est input{position:absolute;opacity:0;pointer-events:none}
.vt-mu{height:58px;border-radius:8px;display:flex;flex-direction:column;justify-content:flex-end;padding:6px 8px;font-weight:800;font-size:12px}
.vt-ban{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.vt-ban-img{width:150px;height:84px;border-radius:10px;background:var(--bg2) center/cover no-repeat;border:1px dashed var(--bo);display:grid;place-items:center;color:var(--tx2);font-size:12px}
.vt-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:9px;padding:9px 14px;font:600 13px inherit;cursor:pointer;border:1px solid var(--bo);background:var(--bg);color:var(--tx);text-decoration:none}
.vt-btn.p{background:var(--ok);border-color:var(--ok);color:#fff}
.vt-btn:disabled{opacity:.55;cursor:not-allowed}
.vt-link{display:flex;gap:8px;flex-wrap:wrap}
.vt-link input{flex:1 1 220px}
.vt-qr{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.vt-qr-c{background:#fff;padding:8px;border-radius:10px;border:1px solid var(--bo)}
.vt-f{display:flex;justify-content:flex-end;gap:8px;padding:14px 18px;border-top:1px solid var(--bo)}
.vt-msg{font-size:12.5px;margin-right:auto;align-self:center}`;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = new URLSearchParams(location.search).get('n') || '';
  const api = (tk, ruta, opt = {}) => fetch('/api/vitrina/admin' + ruta + (n ? (ruta.includes('?') ? '&' : '?') + 'n=' + encodeURIComponent(n) : ''), {
    ...opt, headers: { Authorization: 'Bearer ' + tk, ...(opt.json ? { 'Content-Type': 'application/json' } : {}) },
    body: opt.json ? JSON.stringify(opt.json) : opt.body,
  }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Error'); return d; });

  function cargarQr() {
    if (window.QRCode) return Promise.resolve();
    return new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      s.onload = ok; s.onerror = mal; document.head.append(s);
    });
  }

  window.abrirVitrina = async function (token) {
    if (!document.getElementById('vt-css')) {
      const st = document.createElement('style'); st.id = 'vt-css'; st.textContent = CSS; document.head.append(st);
    }
    document.querySelector('.vt-bg')?.remove();
    const bg = document.createElement('div');
    bg.className = 'vt-bg';
    bg.innerHTML = '<div class="vt" role="dialog" aria-modal="true" aria-label="Vitrina"><div class="vt-h"><h3>🪟 Vitrina del negocio</h3><button class="vt-x" aria-label="Cerrar">×</button></div><div class="vt-b">Cargando…</div></div>';
    document.body.append(bg);
    const cerrar = () => { bg.remove(); document.removeEventListener('keydown', tecla); };
    const tecla = e => { if (e.key === 'Escape') cerrar(); };
    document.addEventListener('keydown', tecla);
    bg.addEventListener('click', e => { if (e.target === bg) cerrar(); });
    bg.querySelector('.vt-x').onclick = cerrar;

    let d;
    try { d = await api(token, ''); }
    catch (e) { bg.querySelector('.vt-b').textContent = 'No se pudo cargar: ' + e.message; return; }
    const c = d.config || {};
    const link = location.origin + d.url;
    const estilos = [
      ['elegante', 'Elegante', 'Negro y dorado', 'background:#0f0d0b;color:#d4af37;font-family:Georgia,serif'],
      ['promo', 'Promocional', 'Colores fuertes', 'background:#fff4d6;color:#d62828;border:2px solid #111'],
      ['claro', 'Claro', 'Limpio, con tu color', 'background:#f7f7f4;color:#0B8457;border:1px solid #ddd'],
    ];
    const box = bg.querySelector('.vt');
    box.querySelector('.vt-b').innerHTML = `
      ${d.plan_ok ? '' : `<div class="vt-aviso">La vitrina está incluida en los planes <b>Plus</b> y <b>Premium</b>. Tu plan actual no la incluye: puedes dejarla configurada y se publica cuando cambies de plan.</div>`}
      <label class="vt-sw"><span><b>Vitrina publicada</b><small>Cualquiera con el link puede verla.</small></span><input type="checkbox" id="vt-activo" ${c.activo ? 'checked' : ''} ${d.plan_ok ? '' : 'disabled'}></label>
      <div><span class="vt-l" style="font-size:12.5px;font-weight:700;display:block;margin-bottom:6px">Estilo</span><div class="vt-est">
        ${estilos.map(([v, t, s, css]) => `<label><input type="radio" name="vt-estilo" value="${v}" ${(c.estilo || 'claro') === v ? 'checked' : ''}><span class="vt-mu" style="${css}">${t}</span><small style="color:var(--tx2)">${s}</small></label>`).join('')}
      </div></div>
      <div><label class="vt-l" for="vt-eslogan">Eslogan</label><input type="text" id="vt-eslogan" maxlength="160" placeholder="Ej.: Las cervezas más frías del barrio" value="${esc(c.eslogan)}"></div>
      <div class="vt-2">
        <div><label class="vt-l" for="vt-horario">Horario</label><input type="text" id="vt-horario" maxlength="160" placeholder="Ej.: Jue a sáb, 5 p. m. a 2 a. m." value="${esc(c.horario)}"></div>
        <div><label class="vt-l" for="vt-wa">WhatsApp</label><input type="text" id="vt-wa" maxlength="30" inputmode="tel" placeholder="Si lo dejas vacío, se usa el teléfono del negocio" value="${esc(c.whatsapp)}"></div>
        <div><label class="vt-l" for="vt-ig">Instagram</label><input type="text" id="vt-ig" maxlength="120" placeholder="@tunegocio" value="${esc(c.instagram ? '@' + c.instagram : '')}"></div>
        <div><label class="vt-l" for="vt-fb">Facebook</label><input type="text" id="vt-fb" maxlength="200" placeholder="Usuario o link de la página" value="${esc(c.facebook)}"></div>
      </div>
      <div><span class="vt-l" style="font-size:12.5px;font-weight:700;display:block;margin-bottom:6px">Imagen de portada</span>
        <div class="vt-ban"><div class="vt-ban-img" id="vt-ban-img">${c.banner_url ? '' : 'Sin imagen'}</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <label class="vt-btn">📷 Subir imagen<input type="file" id="vt-ban-file" accept="image/jpeg,image/png,image/webp" hidden></label>
            <button class="vt-btn" id="vt-ban-quitar" ${c.banner_url ? '' : 'hidden'}>Quitar</button>
            <small style="color:var(--tx2)">Horizontal, de buena calidad (ej. 1600×900).</small>
          </div></div></div>
      <div><span class="vt-l" style="font-size:12.5px;font-weight:700;display:block;margin-bottom:6px">Link para compartir</span>
        <div class="vt-link"><input type="text" readonly value="${esc(link)}" id="vt-url"><button class="vt-btn" id="vt-copiar">Copiar</button><a class="vt-btn" href="${esc(link)}" target="_blank" rel="noopener">Ver ↗</a></div></div>
      <div class="vt-qr"><div class="vt-qr-c" id="vt-qr"></div><div style="display:flex;flex-direction:column;gap:6px"><small style="color:var(--tx2);max-width:30ch">Imprime el QR para la mesa, la vitrina física o la puerta del local.</small><button class="vt-btn" id="vt-qr-bajar">⬇️ Descargar QR</button></div></div>
      <div class="vt-tip">💡 Las <b>promociones</b> y los <b>recomendados</b> salen de cada producto del menú: actívale la promoción (precio y fechas) o márcalo como <b>⭐ Destacado</b>. Los productos agotados no se muestran.</div>`;
    box.insertAdjacentHTML('beforeend', '<div class="vt-f"><span class="vt-msg" id="vt-msg"></span><button class="vt-btn" id="vt-cancelar">Cerrar</button><button class="vt-btn p" id="vt-guardar">Guardar</button></div>');
    const $ = id => box.querySelector('#' + id);
    const msg = (t, ok) => { $('vt-msg').textContent = t; $('vt-msg').style.color = ok ? '#0B8457' : '#A32D2D'; };
    const banner = u => {
      const el = $('vt-ban-img');
      el.style.backgroundImage = u ? `url("${String(u).replace(/["\\]/g, '')}")` : '';
      el.textContent = u ? '' : 'Sin imagen';
      $('vt-ban-quitar').hidden = !u;
    };
    banner(c.banner_url);
    $('vt-cancelar').onclick = cerrar;

    $('vt-copiar').onclick = async () => {
      try { await navigator.clipboard.writeText(link); } catch { $('vt-url').select(); document.execCommand('copy'); }
      $('vt-copiar').textContent = 'Copiado ✓'; setTimeout(() => { $('vt-copiar').textContent = 'Copiar'; }, 1600);
    };
    cargarQr().then(() => {
      new window.QRCode($('vt-qr'), { text: link, width: 132, height: 132, correctLevel: window.QRCode.CorrectLevel.M });
    }).catch(() => { $('vt-qr').textContent = 'QR no disponible'; });
    $('vt-qr-bajar').onclick = () => {
      const cv = $('vt-qr').querySelector('canvas'), img = $('vt-qr').querySelector('img');
      const src = cv ? cv.toDataURL('image/png') : img?.src;
      if (!src) return;
      const a = document.createElement('a'); a.href = src; a.download = 'qr-vitrina.png'; a.click();
    };

    $('vt-ban-file').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const fd = new FormData(); fd.append('banner', f);
      msg('Subiendo imagen…', true);
      try { const r = await api(token, '/banner', { method: 'POST', body: fd }); banner(r.url); msg('Imagen guardada ✓', true); }
      catch (er) { msg(er.message); }
      e.target.value = '';
    };
    $('vt-ban-quitar').onclick = async () => {
      try { await api(token, '/banner', { method: 'DELETE' }); banner(null); msg('Imagen quitada', true); }
      catch (er) { msg(er.message); }
    };

    $('vt-guardar').onclick = async () => {
      const b = $('vt-guardar'); b.disabled = true;
      try {
        await api(token, '', { method: 'PUT', json: {
          activo: $('vt-activo').checked,
          estilo: box.querySelector('input[name=vt-estilo]:checked')?.value || 'claro',
          eslogan: $('vt-eslogan').value, horario: $('vt-horario').value, whatsapp: $('vt-wa').value,
          instagram: $('vt-ig').value, facebook: $('vt-fb').value,
        } });
        msg($('vt-activo').checked ? 'Guardado ✓ La vitrina está publicada.' : 'Guardado ✓ (sin publicar)', true);
      } catch (er) { msg(er.message); }
      b.disabled = false;
    };
  };
})();
