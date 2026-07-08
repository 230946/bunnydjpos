/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * middleware/auth.js
 * Verifica el JWT en cada request protegido
 */
const jwt = require('jsonwebtoken');
const { pool } = require('../db');

async function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, email, negocio_id, rol_id, es_superadmin, permisos }
    req.user.moneda = 'COP';
    req.user.zona_horaria = 'America/Bogota';
    if (payload.negocio_id) {
      try {
        const { rows } = await pool.query(
          `SELECT moneda, zona_horaria FROM negocios WHERE id=? LIMIT 1`,
          [payload.negocio_id]
        );
        if (rows[0]) {
          req.user.moneda = rows[0].moneda || 'COP';
          req.user.zona_horaria = rows[0].zona_horaria || 'America/Bogota';
        }
      } catch { /* negocio sin fila / columnas aún no migradas: se mantienen los defaults */ }
    }
    next();
  } catch (e) {
    // Solo un JWT realmente inválido/expirado debe dar 401. Cualquier otro
    // error (ej. de la consulta a negocios, que ya tiene su propio try/catch
    // pero por si acaso) se reporta como 500 en vez de disfrazarse de sesión
    // inválida — así no se cierra sesión al usuario por un error que no es suyo.
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError' || e.name === 'NotBeforeError') {
      let claims = null;
      try { claims = jwt.decode(token); } catch {}
      console.error(
        `[authMiddleware] ${e.name}: ${e.message} | ruta=${req.method} ${req.originalUrl} | ` +
        `ahora=${Math.floor(Date.now()/1000)} | exp=${claims?.exp} | iat=${claims?.iat} | ` +
        `usuario=${claims?.id||'?'} negocio=${claims?.negocio_id||'?'}`
      );
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
    console.error('[authMiddleware] Error inesperado (no de JWT):', e.message, e.stack);
    return res.status(500).json({ error: 'Error interno de autenticación' });
  }
}

function superadminOnly(req, res, next) {
  if (!req.user?.es_superadmin) return res.status(403).json({ error: 'Solo superadmin' });
  next();
}

function requirePermiso(clave) {
  return (req, res, next) => {
    if (req.user?.es_superadmin) return next();
    const permisos = req.user?.permisos || {};
    const claves = Array.isArray(clave) ? clave : [clave];
    if (!claves.some(c => permisos[c])) return res.status(403).json({ error: `Sin permiso: ${claves[0]}` });
    next();
  };
}

// Solo administradores (superadmin o rol con permiso 'personal')
function requireAdmin(req, res, next) {
  if (req.user?.es_superadmin) return next();
  if (req.user?.permisos?.personal) return next();
  return res.status(403).json({ error: 'Solo administradores pueden realizar esta acción' });
}

module.exports = { authMiddleware, superadminOnly, requirePermiso, requireAdmin };
