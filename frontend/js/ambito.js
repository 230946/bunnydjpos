/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * ambito.js — separa las cajas (POS) de los paneles administrativos.
 *
 * Uso: <script src="/js/ambito.js" data-ambito="pos" data-claves="bdj_pos_token"></script>
 * antes de los scripts de la página.
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

  const fetchAnterior = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const destino = new URL(url, location.href);
      if (/\/api\/auth\/login$/.test(destino.pathname) && init && typeof init.body === 'string') {
        const body = JSON.parse(init.body);
        if (body && typeof body === 'object') init = { ...init, body: JSON.stringify({ ...body, ambito }) };
      }
    } catch {}
    return fetchAnterior(input, init);
  };
})();
