/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * pwa.js — deja la pantalla instalable como app en el celular
 * ("Agregar a pantalla de inicio" / "Instalar app").
 *
 * Uso: <script src="/js/pwa.js" data-app="admin-restaurante"
 *        data-color="#0B8457" data-titulo="Admin"></script>
 *  - data-app: app de /api/manifest/:app (nombre, logo y color del negocio
 *    según ?n=). Reemplaza el <link rel="manifest"> estático si la página
 *    ya tenía uno.
 *  - Agrega las etiquetas que piden Android e iOS (si la página no las trae)
 *    y registra /pos-sw.js con el alcance de esta pantalla.
 */
(function () {
  const s = document.currentScript;
  if (!s) return;
  const app = s.dataset.app;
  const color = s.dataset.color || '#0B8457';
  const titulo = s.dataset.titulo || '';
  const q = new URLSearchParams(location.search);
  const n = q.get('n') || q.get('negocio') || '';

  function poner() {
    const head = document.head;
    const meta = (name, content) => {
      if (document.querySelector(`meta[name="${name}"]`)) return;
      const m = document.createElement('meta');
      m.name = name; m.content = content;
      head.append(m);
    };
    if (app) {
      let link = document.querySelector('link[rel="manifest"]');
      if (!link) { link = document.createElement('link'); link.rel = 'manifest'; head.append(link); }
      link.href = '/api/manifest/' + encodeURIComponent(app) + (n ? '?n=' + encodeURIComponent(n) : '');
    }
    meta('theme-color', color);
    meta('mobile-web-app-capable', 'yes');
    meta('apple-mobile-web-app-capable', 'yes');
    if (titulo) meta('apple-mobile-web-app-title', titulo);
    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      const l = document.createElement('link');
      l.rel = 'apple-touch-icon'; l.href = '/img/logo.png';
      head.append(l);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', poner); else poner();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/pos-sw.js', { scope: location.pathname }).catch(() => {});
    });
  }
})();
