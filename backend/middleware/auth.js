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
    const bloqueo = await bloqueoFueraDeTurno(req.user).catch(() => null);
    if (bloqueo) return res.status(401).json({ error: bloqueo, fuera_de_turno: true });
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

// ── Meseros fuera de turno (solo negocios tipo bar) ──────────────────
// Una vez cerrada la caja del día, los usuarios sin permiso 'personal' no
// pueden entrar hasta la siguiente hora de inicio de turno
// (config_factura.horaInicioTurno, 14:00 por defecto). Si se reabre la caja
// el bloqueo se levanta. El cálculo se cachea 30 s por negocio; las rutas de
// caja limpian el caché al abrir/reabrir/cerrar.
const _cacheTurno = new Map(); // negocio_id → { hasta, reabre, tz }
function limpiarCacheTurno(negocioId) { _cacheTurno.delete(negocioId); }

async function _calcularReapertura(negocioId) {
  const { rows } = await pool.query(
    `SELECT n.tipo, n.zona_horaria, c.estado, c.cierre_en,
       (SELECT datos FROM config_factura WHERE negocio_id=n.id LIMIT 1) AS datos
     FROM negocios n
     LEFT JOIN cajas c ON c.id = (SELECT id FROM cajas WHERE negocio_id=n.id ORDER BY apertura_en DESC LIMIT 1)
     WHERE n.id=?`, [negocioId]);
  const r = rows[0];
  const tz = r?.zona_horaria || 'America/Bogota';
  if (!r || r.tipo !== 'bar' || r.estado !== 'cerrada' || !r.cierre_en) return { reabre: null, tz };
  let hora = '14:00';
  try {
    const d = typeof r.datos === 'string' ? JSON.parse(r.datos) : r.datos;
    if (d?.horaInicioTurno) hora = d.horaInicioTurno;
  } catch {}
  const cierre = new Date(r.cierre_en);
  const fCierre = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' }).format(cierre);
  const hCierre = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour:'2-digit', minute:'2-digit', hour12:false }).format(cierre);
  // Siguiente inicio de turno posterior al cierre (cierre de madrugada → ese
  // mismo día; cierre después de la hora de turno → al día siguiente)
  const fReabre = hCierre < hora ? fCierre
    : new Date(Date.parse(fCierre + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
  return { reabre: `${fReabre} ${hora}`, tz };
}

// Devuelve null si el usuario puede entrar, o el mensaje de bloqueo.
async function bloqueoFueraDeTurno(user) {
  if (!user?.negocio_id || user.es_superadmin || user.permisos?.personal) return null;
  let c = _cacheTurno.get(user.negocio_id);
  if (!c || c.hasta < Date.now()) {
    c = { hasta: Date.now() + 30000, ...(await _calcularReapertura(user.negocio_id)) };
    _cacheTurno.set(user.negocio_id, c);
  }
  if (!c.reabre) return null;
  const ahora = new Intl.DateTimeFormat('sv-SE', { timeZone: c.tz, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date());
  if (ahora >= c.reabre) return null;
  const [f, h] = c.reabre.split(' ');
  const [, m, d] = f.split('-');
  const [hh, mm] = h.split(':').map(Number);
  const hora12 = `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'a. m.' : 'p. m.'}`;
  return `La caja ya se cerró. Podrás ingresar desde el ${d}/${m} a las ${hora12}`;
}

module.exports = { authMiddleware, superadminOnly, requirePermiso, requireAdmin, bloqueoFueraDeTurno, limpiarCacheTurno };
