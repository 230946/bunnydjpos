/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * sesion.js — mantiene la sesión abierta en el celular.
 *
 * Las páginas guardan el token en sessionStorage, que el celular pierde cuando
 * descarta la pestaña en segundo plano o se cierra el navegador. Este script:
 *  - Copia a localStorage cada clave de sesión que una página guarda o borra
 *    en sessionStorage (sin tocar el código de cada página).
 *  - Al abrir la página, si sessionStorage llegó vacío, la restaura desde esa
 *    copia, siempre que el token no esté vencido y sea del negocio de ?n=.
 * Debe cargarse antes que cualquier otro script (incluido ambito.js).
 * "Salir" sigue cerrando la sesión: borrar la clave borra también la copia.
 */
(function () {
  // Cada grupo: la primera clave es el token, las demás lo acompañan.
  const GRUPOS = [
    ['bdj_adm_token'],
    ['bdj_bar_token'],
    ['bdj_cocina_token'],
    ['bdj_pos_bar_token'],
    ['bdj_pos_token'],
    ['bdj_token'],
    ['sop_adm_token'],
    ['mini_pos_tok', 'mini_pos_nombre', 'mini_pos_rol'],
    ['pel_token', 'pel_nombre', 'pel_rol', 'pel_negocio_id', 'pel_permisos', 'pel_superadmin'],
    ['pos_pel_token', 'pos_pel_user', 'pos_pel_rol'],
  ];
  // La copia es por pantalla: admin-restaurante y admin-minimercado usan la
  // misma clave y no deben heredarse la sesión entre sí. login.html y
  // portal.html no cargan este script: la pantalla de destino respalda la
  // sesión al abrir (ver "Sesiones abiertas antes…" más abajo).
  const pagina = location.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  const PREFIJO = 'djs:' + pagina + ':';
  const CLAVES = new Set(GRUPOS.flat());

  let ss, ls;
  try { ss = window.sessionStorage; ls = window.localStorage; ss.length; ls.length; } catch { return; }

  function datosToken(t) {
    try { return JSON.parse(decodeURIComponent(escape(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); }
    catch { return null; }
  }
  const proto = Storage.prototype;
  const setOrig = proto.setItem, removeOrig = proto.removeItem, clearOrig = proto.clear;
  const lsSet = (k, v) => { try { setOrig.call(ls, PREFIJO + k, v); } catch {} };
  const lsDel = k => { try { removeOrig.call(ls, PREFIJO + k); } catch {} };

  // ── Restaurar ────────────────────────────────────────────────
  const n = new URLSearchParams(location.search).get('n') || '';
  const ahora = Date.now() / 1000;
  for (const [tk, ...resto] of GRUPOS) {
    const guardado = ls.getItem(PREFIJO + tk);
    if (!guardado) continue;
    const p = datosToken(guardado);
    if (p && p.exp && p.exp < ahora) {            // vencido: se descarta
      [tk, ...resto].forEach(lsDel);
      continue;
    }
    if (ss.getItem(tk)) continue;                 // esta pestaña ya tiene sesión
    // Solo se restaura en el negocio del token (el superadmin entra a todos).
    if (n && p && p.negocio_id && p.negocio_id !== n && !p.es_superadmin) continue;
    for (const k of [tk, ...resto]) {
      const v = ls.getItem(PREFIJO + k);
      if (v !== null) setOrig.call(ss, k, v);
    }
  }
  // Sesión que trae la pestaña (login.html, portal.html, otra pestaña) o
  // abierta antes de existir este script: se respalda ya.
  // Lo que tiene la pestaña manda sobre la copia (puede ser otro usuario).
  for (const grupo of GRUPOS) {
    if (ss.getItem(grupo[0]) === null) continue;
    for (const k of grupo) {
      const v = ss.getItem(k);
      if (v === null) lsDel(k); else lsSet(k, v);
    }
  }

  // ── Reflejar cambios de sessionStorage en la copia ─────────────
  proto.setItem = function (k, v) {
    setOrig.call(this, k, v);
    if (this === ss && CLAVES.has(String(k))) lsSet(String(k), String(v));
  };
  proto.removeItem = function (k) {
    removeOrig.call(this, k);
    if (this === ss && CLAVES.has(String(k))) lsDel(String(k));
  };
  proto.clear = function () {
    clearOrig.call(this);
    if (this === ss) CLAVES.forEach(lsDel);
  };
})();
