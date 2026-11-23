/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * radio.js — radio por internet flotante para los POS.
 *
 * Botón 📻 abajo a la izquierda que abre un panel con emisoras de Colombia
 * (directorio público Radio Browser, sin clave), búsqueda, géneros, favoritas,
 * emisora propia por enlace y volumen. Solo usa streams https, porque las
 * páginas de DJMPOS van por https y el navegador bloquea audio http.
 * Recuerda en este equipo la última emisora, el volumen y las favoritas.
 * Para usarla basta con incluir <script src="/js/radio.js" defer></script>.
 */
(function () {
  if (window.__djmRadio) return;
  window.__djmRadio = true;

  const SERVIDORES = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'fi1.api.radio-browser.info'];
  const GENEROS = ['salsa', 'vallenato', 'reggaeton', 'baladas', 'crossover', 'rock', 'noticias'];
  const CLAVE = 'djm_radio';

  const guardado = (() => { try { return JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch { return {}; } })();
  const estado = {
    volumen: typeof guardado.volumen === 'number' ? guardado.volumen : 0.7,
    ultima: guardado.ultima || null,         // {id,nombre,url,logo}
    favoritas: Array.isArray(guardado.favoritas) ? guardado.favoritas : [],
    lista: [], filtro: '', genero: '', verFavoritas: false,
  };
  const guardar = () => {
    try { localStorage.setItem(CLAVE, JSON.stringify({ volumen: estado.volumen, ultima: estado.ultima, favoritas: estado.favoritas })); } catch {}
  };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const corto = n => String(n || '').replace(/\s*[-–(].*$/, '').trim() || n;

  // ── Estilos ───────────────────────────────────────────────────────────
  const css = document.createElement('style');
  css.textContent = `
  .djr-btn{position:fixed;left:14px;bottom:14px;z-index:9990;width:48px;height:48px;border-radius:50%;border:none;
    background:#0B8457;color:#fff;font-size:22px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center}
  .djr-btn.sonando{animation:djrPulso 1.6s infinite}
  .djr-eq{display:none;align-items:flex-end;gap:3px;height:20px}
  .djr-eq i{display:block;width:4px;border-radius:2px;background:#fff;height:30%;animation:djrEq .9s ease-in-out infinite}
  .djr-eq i:nth-child(2){animation-duration:.7s;animation-delay:-.3s}
  .djr-eq i:nth-child(3){animation-duration:1.1s;animation-delay:-.5s}
  .djr-eq i:nth-child(4){animation-duration:.8s;animation-delay:-.2s}
  @keyframes djrEq{0%,100%{height:25%}50%{height:100%}}
  .djr-btn.sonando .djr-eq{display:flex}
  .djr-btn.sonando .djr-emoji{display:none}
  .djr-cab .djr-eq{display:inline-flex;height:12px;gap:2px;margin-right:6px;vertical-align:middle}
  .djr-cab .djr-eq i{width:3px}
  .djr-panel:not(.sonando) .djr-cab .djr-eq{display:none}
  @media (prefers-reduced-motion:reduce){.djr-eq i{animation:none;height:60%}.djr-btn.sonando{animation:none}}
  @keyframes djrPulso{0%,100%{box-shadow:0 0 0 0 rgba(11,132,87,.5)}50%{box-shadow:0 0 0 9px rgba(11,132,87,0)}}
  .djr-panel{position:fixed;left:14px;bottom:72px;z-index:9991;width:340px;max-width:calc(100vw - 28px);max-height:min(560px,calc(100vh - 100px));
    background:#fff;color:#111827;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.35);display:none;flex-direction:column;overflow:hidden;
    font:14px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .djr-panel.abierto{display:flex}
  .djr-cab{padding:12px 14px;background:#1f2937;color:#fff;display:flex;align-items:center;gap:10px}
  .djr-cab img,.djr-cab .djr-ico{width:40px;height:40px;border-radius:8px;object-fit:cover;background:#374151;flex:none;display:flex;align-items:center;justify-content:center;font-size:20px}
  .djr-actual{flex:1;min-width:0}
  .djr-actual b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .djr-actual small{opacity:.75}
  .djr-play{width:42px;height:42px;border-radius:50%;border:none;background:#0B8457;color:#fff;font-size:18px;cursor:pointer;flex:none}
  .djr-play:disabled{background:#4b5563;cursor:default}
  .djr-vol{display:flex;align-items:center;gap:8px;padding:8px 14px;background:#111827;color:#fff}
  .djr-vol input{flex:1;accent-color:#0B8457}
  .djr-buscar{padding:10px 14px 6px;display:flex;gap:6px}
  .djr-buscar input{flex:1;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font:inherit;min-width:0}
  .djr-chips{padding:0 14px 8px;display:flex;gap:6px;flex-wrap:wrap}
  .djr-chip{border:1px solid #d1d5db;background:#fff;border-radius:999px;padding:3px 10px;font-size:12px;cursor:pointer;color:#374151}
  .djr-chip.on{background:#1f2937;border-color:#1f2937;color:#fff}
  .djr-lista{overflow-y:auto;flex:1;border-top:1px solid #e5e7eb}
  .djr-item{display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;border-bottom:1px solid #f3f4f6}
  .djr-item:hover{background:#f9fafb}
  .djr-item.activa{background:#ecfdf5}
  .djr-item img,.djr-item .djr-ico{width:32px;height:32px;border-radius:6px;object-fit:cover;background:#e5e7eb;flex:none;display:flex;align-items:center;justify-content:center}
  .djr-item .djr-txt{flex:1;min-width:0}
  .djr-item .djr-txt b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .djr-item .djr-txt small{color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
  .djr-fav{border:none;background:none;font-size:18px;cursor:pointer;color:#d1d5db;padding:4px}
  .djr-fav.on{color:#f59e0b}
  .djr-msg{padding:18px 14px;color:#6b7280;text-align:center}
  .djr-pie{padding:8px 14px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;display:flex;justify-content:space-between;gap:8px}
  .djr-pie button{border:none;background:none;color:#2563eb;cursor:pointer;font:inherit;padding:0}
  @media print{.djr-btn,.djr-panel{display:none!important}}`;
  document.head.appendChild(css);

  // ── Estructura ────────────────────────────────────────────────────────
  const btn = document.createElement('button');
  btn.className = 'djr-btn'; btn.type = 'button'; btn.title = 'Radio';
  const EQ = '<span class="djr-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';
  btn.innerHTML = '<span class="djr-emoji">📻</span>' + EQ;
  const panel = document.createElement('div');
  panel.className = 'djr-panel';
  panel.innerHTML = `
    <div class="djr-cab">
      <div class="djr-ico" data-r="logo">📻</div>
      <div class="djr-actual"><b data-r="nombre">Elige una emisora</b><span class="djr-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span><small data-r="estado">Radio por internet</small></div>
      <button class="djr-play" data-r="play" type="button" disabled>▶</button>
    </div>
    <div class="djr-vol"><span>🔈</span><input data-r="vol" type="range" min="0" max="1" step="0.05"><span>🔊</span></div>
    <div class="djr-buscar"><input data-r="q" type="search" placeholder="Buscar emisora…"></div>
    <div class="djr-chips" data-r="chips"></div>
    <div class="djr-lista" data-r="lista"><div class="djr-msg">Cargando emisoras…</div></div>
    <div class="djr-pie"><button type="button" data-r="propia">+ Emisora por enlace</button><span>Radio Browser</span></div>`;
  const $ = k => panel.querySelector(`[data-r="${k}"]`);

  const montar = () => { document.body.appendChild(btn); document.body.appendChild(panel); };
  if (document.body) montar(); else document.addEventListener('DOMContentLoaded', montar);

  const audio = new Audio();
  audio.preload = 'none';
  audio.volume = estado.volumen;
  $('vol').value = estado.volumen;

  // ── Reproducción ──────────────────────────────────────────────────────
  let sonando = false;
  function pintarCabecera(txt) {
    const e = estado.ultima;
    $('nombre').textContent = e ? corto(e.nombre) : 'Elige una emisora';
    $('estado').textContent = txt || (e ? (sonando ? 'En vivo' : 'En pausa') : 'Radio por internet');
    const logo = $('logo');
    logo.outerHTML = e && e.logo
      ? `<img data-r="logo" src="${esc(e.logo)}" alt="" onerror="this.outerHTML='<div class=&quot;djr-ico&quot; data-r=&quot;logo&quot;>📻</div>'">`
      : '<div class="djr-ico" data-r="logo">📻</div>';
    $('play').disabled = !e;
    $('play').textContent = sonando ? '⏸' : '▶';
    btn.classList.toggle('sonando', sonando);
    panel.classList.toggle('sonando', sonando);
    btn.title = sonando && e ? `Sonando: ${corto(e.nombre)}` : 'Radio';
  }

  function tocar(emisora) {
    if (emisora) { estado.ultima = emisora; guardar(); }
    const e = estado.ultima;
    if (!e) return;
    audio.src = e.url.replace(/^http:\/\//i, 'https://');
    pintarCabecera('Conectando…');
    audio.play().catch(() => {});
    pintarLista();
  }
  function parar() {
    audio.pause();
    audio.removeAttribute('src'); audio.load();   // corta la descarga del stream
    sonando = false; pintarCabecera();
  }

  audio.addEventListener('playing', () => { sonando = true; pintarCabecera(); });
  audio.addEventListener('waiting', () => { if (sonando) pintarCabecera('Cargando…'); });
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src')) return;
    sonando = false; pintarCabecera('No se pudo conectar, prueba otra emisora');
  });

  $('play').onclick = () => (sonando ? parar() : tocar());
  $('vol').oninput = ev => { estado.volumen = +ev.target.value; audio.volume = estado.volumen; guardar(); };

  // ── Emisoras ──────────────────────────────────────────────────────────
  const aEmisora = s => ({ id: s.stationuuid, nombre: s.name.trim(), url: s.url_resolved || s.url, logo: s.favicon || '', tags: s.tags || '' });

  async function api(ruta) {
    for (const srv of SERVIDORES) {
      try {
        const r = await fetch(`https://${srv}/json/${ruta}`);
        if (r.ok) return await r.json();
      } catch {}
    }
    throw new Error('sin servidor');
  }

  let pedido = 0;
  async function cargar() {
    const mio = ++pedido;
    $('lista').innerHTML = '<div class="djr-msg">Cargando emisoras…</div>';
    const p = new URLSearchParams({ hidebroken: 'true', is_https: 'true', order: 'votes', reverse: 'true', limit: '80' });
    if (estado.filtro) p.set('name', estado.filtro); else p.set('countrycode', 'CO');
    if (estado.genero) p.set('tag', estado.genero);
    try {
      const datos = await api(`stations/search?${p}`);
      if (mio !== pedido) return;
      const vistas = new Set();
      estado.lista = datos
        .filter(s => !s.hls && !/\.m3u8|type=master/i.test(s.url_resolved || ''))   // HLS no suena en todos los navegadores
        .map(aEmisora)
        .filter(e => { const k = e.nombre.toLowerCase(); if (vistas.has(k)) return false; vistas.add(k); return true; });
    } catch {
      if (mio !== pedido) return;
      estado.lista = [];
      $('lista').innerHTML = '<div class="djr-msg">No se pudo cargar el listado. Revisa el internet.</div>';
      return;
    }
    pintarLista();
  }

  function pintarLista() {
    const lista = estado.verFavoritas ? estado.favoritas : estado.lista;
    if (!lista.length) {
      $('lista').innerHTML = `<div class="djr-msg">${estado.verFavoritas ? 'Aún no tienes favoritas. Toca ☆ en una emisora.' : 'No hay emisoras con ese filtro.'}</div>`;
      return;
    }
    const actual = estado.ultima && estado.ultima.id;
    const favs = new Set(estado.favoritas.map(f => f.id));
    $('lista').innerHTML = lista.map((e, i) => `
      <div class="djr-item${e.id === actual ? ' activa' : ''}" data-i="${i}">
        ${e.logo ? `<img src="${esc(e.logo)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<div class="djr-ico">📻</div>'}
        <div class="djr-txt"><b>${esc(corto(e.nombre))}</b><small>${esc(e.tags.split(',').slice(0, 3).join(' · ') || e.nombre)}</small></div>
        <button class="djr-fav${favs.has(e.id) ? ' on' : ''}" data-fav="${i}" type="button" title="Favorita">${favs.has(e.id) ? '★' : '☆'}</button>
      </div>`).join('');
  }

  $('lista').onclick = ev => {
    const lista = estado.verFavoritas ? estado.favoritas : estado.lista;
    const f = ev.target.closest('[data-fav]');
    if (f) {
      const e = lista[+f.dataset.fav];
      const ya = estado.favoritas.findIndex(x => x.id === e.id);
      if (ya >= 0) estado.favoritas.splice(ya, 1);
      else estado.favoritas.push({ id: e.id, nombre: e.nombre, url: e.url, logo: e.logo, tags: e.tags });
      guardar(); pintarLista();
      return;
    }
    const it = ev.target.closest('[data-i]');
    if (it) tocar(lista[+it.dataset.i]);
  };

  function pintarChips() {
    const chip = (k, txt, on) => `<button class="djr-chip${on ? ' on' : ''}" data-chip="${k}" type="button">${txt}</button>`;
    $('chips').innerHTML =
      chip('*fav', '★ Favoritas', estado.verFavoritas) +
      chip('', 'Todas', !estado.verFavoritas && !estado.genero) +
      GENEROS.map(g => chip(g, g[0].toUpperCase() + g.slice(1), !estado.verFavoritas && estado.genero === g)).join('');
  }
  $('chips').onclick = ev => {
    const c = ev.target.closest('[data-chip]');
    if (!c) return;
    const k = c.dataset.chip;
    if (k === '*fav') { estado.verFavoritas = true; pintarChips(); pintarLista(); return; }
    estado.verFavoritas = false; estado.genero = k; pintarChips(); cargar();
  };

  let tBuscar;
  $('q').oninput = ev => {
    clearTimeout(tBuscar);
    tBuscar = setTimeout(() => { estado.filtro = ev.target.value.trim(); estado.verFavoritas = false; pintarChips(); cargar(); }, 350);
  };

  $('propia').onclick = () => {
    const url = (prompt('Pega el enlace del stream (debe empezar por https://):') || '').trim();
    if (!url) return;
    if (!/^https:\/\//i.test(url)) { alert('El enlace debe empezar por https:// para que suene en DJMPOS.'); return; }
    const nombre = (prompt('¿Cómo se llama la emisora?') || '').trim() || 'Mi emisora';
    const e = { id: 'propia-' + Date.now(), nombre, url, logo: '', tags: 'propia' };
    estado.favoritas.push(e); guardar();
    estado.verFavoritas = true; pintarChips();
    tocar(e);
  };

  // ── Abrir / cerrar ────────────────────────────────────────────────────
  let cargado = false;
  btn.onclick = () => {
    const abrir = !panel.classList.contains('abierto');
    panel.classList.toggle('abierto', abrir);
    if (abrir && !cargado) { cargado = true; pintarChips(); cargar(); }
  };
  document.addEventListener('click', ev => {
    // composedPath: la lista se vuelve a pintar al tocar, y el elemento tocado ya no está en el panel.
    const ruta = ev.composedPath();
    if (panel.classList.contains('abierto') && !ruta.includes(panel) && !ruta.includes(btn)) panel.classList.remove('abierto');
  });

  pintarCabecera();
})();
