/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * middleware/cuentas.js
 * Reglas de cuentas protegidas: la clave de un administrador (superadmin o rol
 * con permiso "personal") solo la puede cambiar el usuario maestro, o el propio
 * administrador sabiendo la actual (POST /auth/cambiar-password).
 */
const { pool } = require('../db');

const MSG_SOLO_MAESTRO = 'Solo el usuario maestro puede hacer este cambio en una cuenta de administrador.';

function permisoPersonal(permisos) {
  try {
    const p = typeof permisos === 'string' ? JSON.parse(permisos) : permisos;
    return !!p?.personal;
  } catch {
    return false;
  }
}

function esCuentaAdmin(cuenta) {
  return !!cuenta.es_superadmin || permisoPersonal(cuenta.permisos);
}

async function cargarCuenta(id) {
  const { rows } = await pool.query(
    `SELECT u.id, u.negocio_id, u.rol_id, u.nombre, u.email, u.es_superadmin, u.es_maestro, r.permisos
     FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id
     WHERE u.id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

// Se consulta siempre en la base de datos, no en el token.
async function esMaestro(usuarioId) {
  return !!(await cargarCuenta(usuarioId))?.es_maestro;
}

async function maestroOnly(req, res, next) {
  try {
    if (await esMaestro(req.user?.id)) return next();
    res.status(403).json({ error: 'Solo el usuario maestro puede hacer esto' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
}

module.exports = { MSG_SOLO_MAESTRO, permisoPersonal, esCuentaAdmin, cargarCuenta, esMaestro, maestroOnly };
