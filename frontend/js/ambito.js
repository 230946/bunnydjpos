/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * ambito.js — separa las cajas (POS) de los paneles administrativos.
 *
 * Uso: <script src="/js/ambito.js" data-ambito="pos" data-claves="bdj_pos_token"
 *        data-otro="/admin-restaurante.html"></script>
 * antes de los scripts de la página.
 *  - data-otro: pantalla del mismo negocio a la que lleva el botón que se
 *    agrega debajo del ingreso (en la caja, "Panel administrativo").
 *  - Le agrega { ambito } a cada POST /api/auth/login: el servidor rechaza a
 *    un administrador en una caja y al resto del personal en un panel.
 *  - Si al abrir la página hay guardada una sesión que no corresponde (por
 *    ejemplo de antes de esta regla), la borra para que pida ingresar de nuevo.
 * Administrador = superadmin o rol con permiso "personal".
 */
(function () {
  const script = document.currentScript;
  const ambito = script?.dataset.ambito;
  if (ambito !== 'pos' && ambito !== 'admin') return;
  const claves = (script.dataset.claves || '').split(',').map(s => s.trim()).filter(Boolean);

  function datosToken(t) {
    try { return JSON.parse(decodeURIComponent(escape(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); }
    catch { return null; }
  }
  function esAdmin(u) {
    let p = u.permisos;
    try { if (typeof p === 'string') p = JSON.parse(p); } catch { p = {}; }
    return !!u.es_superadmin || !!(p && p.personal);
  }

  let aviso = null;
  for (const k of claves) {
    let t = null;
    try { t = sessionStorage.getItem(k); } catch {}
    if (!t) continue;
    const u = datosToken(t);
    if (!u || u.fin) continue;
    if (ambito === 'pos' ? esAdmin(u) : !esAdmin(u)) {
      try { sessionStorage.removeItem(k); } catch {}
      aviso = ambito === 'pos'
        ? 'Se cerró la sesión: los administradores no ingresan a la caja.'
        : 'Se cerró la sesión: esta cuenta no tiene acceso al panel administrativo.';
    }
  }
  if (aviso) {
    const mostrar = () => {
      const d = document.createElement('div');
      d.textContent = aviso;
      d.setAttribute('role', 'alert');
      d.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483001;max-width:calc(100% - 32px);background:#FCEBEB;color:#A32D2D;border:1px solid #f0b4b4;border-radius:8px;padding:10px 14px;font:600 13px -apple-system,"Segoe UI",Arial,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.15)';
      document.body.append(d);
      setTimeout(() => d.remove(), 7000);
    };
    if (document.body) mostrar(); else document.addEventListener('DOMContentLoaded', mostrar);
  }

  // Botón para ir a la otra pantalla del mismo negocio (data-otro), debajo del
  // formulario de ingreso: en la caja lleva al panel y en el panel a la caja.
  const otro = script.dataset.otro;
  let botonOtro = null;
  if (otro) {
    const ponerBoton = () => {
      const card = document.querySelector('#login-screen .login-card');
      if (!card || card.querySelector('.amb-otro')) return;
      if (!document.getElementById('amb-css')) {
        const st = document.createElement('style');
        st.id = 'amb-css';
        st.textContent = `.amb-otro{margin-top:16px;padding-top:14px;border-top:1px solid rgba(0,0,0,.1);text-align:center}
.amb-otro p{font-size:12px;color:#6b7c76;margin:0 0 8px}
.amb-otro a{display:block;padding:11px;border-radius:8px;border:1.5px solid #0B8457;color:#0B8457;font-weight:700;font-size:14px;text-decoration:none;font-family:inherit;transition:background .15s,color .15s}
.amb-otro a:hover,.amb-otro a.destacar{background:#0B8457;color:#fff}
.amb-otro a.destacar{animation:amb-pulso 1s ease 2}
@keyframes amb-pulso{50%{transform:scale(1.03)}}
@media(prefers-color-scheme:dark){.amb-otro{border-top-color:rgba(255,255,255,.15)}.amb-otro p{color:#a0a09a}}`;
        document.head.append(st);
      }
      const caja = document.createElement('div');
      caja.className = 'amb-otro';
      const p = document.createElement('p');
      p.textContent = ambito === 'pos' ? '¿Eres administrador?' : '¿Eres mesero o cajero?';
      botonOtro = document.createElement('a');
      botonOtro.href = otro + location.search;
      botonOtro.textContent = ambito === 'pos' ? '⚙️ Panel administrativo' : '🛒 Ir a la caja (POS)';
      caja.append(p, botonOtro);
      card.append(caja);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ponerBoton); else ponerBoton();
  }

  const fetchAnterior = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    let esLogin = false;
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const destino = new URL(url, location.href);
      if (/\/api\/auth\/login$/.test(destino.pathname) && init && typeof init.body === 'string') {
        const body = JSON.parse(init.body);
        if (body && typeof body === 'object') { init = { ...init, body: JSON.stringify({ ...body, ambito }) }; esLogin = true; }
      }
    } catch {}
    const r = await fetchAnterior(input, init);
    // Si la cuenta es de la otra pantalla, se resalta el botón que lleva allá.
    if (esLogin && r.status === 403 && botonOtro) {
      r.clone().json().then(d => {
        if (!d || !d.otro_ambito) return;
        botonOtro.classList.remove('destacar'); void botonOtro.offsetWidth; botonOtro.classList.add('destacar');
        botonOtro.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }).catch(() => {});
    }
    return r;
  };
})();
