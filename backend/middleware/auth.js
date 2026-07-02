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
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
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
