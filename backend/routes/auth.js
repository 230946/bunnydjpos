/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * routes/auth.js
 * Login, logout, perfil y registro de asistencia
 */
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const { pool, ph } = require('../db');
const { authMiddleware } = require('../middleware/auth');

// ── POST /api/auth/login ─────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { login, password, negocio_id } = req.body;
    if (!login || !password) return res.status(400).json({ error: 'login y password requeridos' });

    // Buscar por email o username, aislado por negocio
    let sql = `SELECT u.*, r.permisos, r.nombre AS rol_nombre
       FROM usuarios u
       LEFT JOIN roles r ON r.id = u.rol_id
       WHERE (u.email = ${ph(1)} OR u.username = ${ph(2)}) AND u.activo=1`;
    const params = [login, login];

    if (negocio_id) {
      // Filtrar: solo usuarios de ese negocio O superadmins
      sql += ` AND (u.negocio_id = ${ph(3)} OR u.es_superadmin = 1)`;
      params.push(negocio_id);
    }
    sql += ' LIMIT 1';

    const { rows } = await pool.query(sql, params);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });

    // Doble verificación: usuario regular sin negocio_id en request debe tener negocio
    if (!user.es_superadmin && !user.negocio_id) {
      return res.status(401).json({ error: 'Usuario sin negocio asignado' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' });

    // Parsear permisos
    let permisos = {};
    try { permisos = typeof user.permisos === 'string' ? JSON.parse(user.permisos) : (user.permisos || {}); } catch {}

    const payload = {
      id:            user.id,
      nombre:        user.nombre,
      email:         user.email,
      negocio_id:    user.negocio_id || (user.es_superadmin && negocio_id ? negocio_id : null),
      rol_id:        user.rol_id,
      rol_nombre:    user.rol_nombre,
      es_superadmin: user.es_superadmin,
      permisos,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '8h' });

    // Guardar sesión
    await pool.query(
      `INSERT INTO sesiones (id, usuario_id, token_hash, ip, expira)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)}, DATE_ADD(NOW(), INTERVAL 8 HOUR))`,
      [uuid(), user.id, token.slice(-20), req.ip]
    );

    // Registrar entrada de asistencia (si tiene negocio)
    if (user.negocio_id) {
      await pool.query(
        `INSERT INTO asistencia (id, usuario_id, negocio_id) VALUES (${ph(1)},${ph(2)},${ph(3)})`,
        [uuid(), user.id, user.negocio_id]
      );
    }

    res.json({ token, user: payload });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── POST /api/auth/forgot-password ───────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { login } = req.body;
    if (!login) return res.status(400).json({ error: 'Usuario o email requerido' });

    const { rows } = await pool.query(
      `SELECT id, email, username FROM usuarios WHERE (email = ? OR username = ?) AND activo=1 LIMIT 1`,
      [login, login]
    );
    const user = rows[0];
    if (!user) return res.json({ ok: true, message: 'Si el usuario existe, se ha enviado la información de recuperación.' });

    const tempPassword = Math.random().toString(36).slice(2,10) + 'A1!';
    const password_hash = await bcrypt.hash(tempPassword, 12);
    await pool.query(`UPDATE usuarios SET password_hash=${ph(1)}, actualizado=NOW() WHERE id=${ph(2)}`, [password_hash, user.id]);

    res.json({ ok: true, message: 'Se generó una contraseña temporal.', tempPassword });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── POST /api/auth/logout ────────────────────────────────────────
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    // Registrar salida de asistencia
    if (req.user.negocio_id) {
      await pool.query(
        `UPDATE asistencia SET salida = NOW()
         WHERE usuario_id = ${ph(1)} AND negocio_id = ${ph(2)} AND salida IS NULL
         ORDER BY entrada DESC LIMIT 1`,
        [req.user.id, req.user.negocio_id]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.username, u.negocio_id, u.rol_id,
              u.avatar_url, u.es_superadmin, r.nombre AS rol_nombre, r.permisos
       FROM usuarios u
       LEFT JOIN roles r ON r.id = u.rol_id
       WHERE u.id = ${ph(1)}`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── POST /api/auth/cambiar-password ─────────────────────────────
router.post('/cambiar-password', authMiddleware, async (req, res) => {
  try {
    const { password_actual, password_nuevo } = req.body;
    const { rows } = await pool.query(`SELECT password_hash FROM usuarios WHERE id=${ph(1)}`, [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    const ok = await bcrypt.compare(password_actual, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    const hash = await bcrypt.hash(password_nuevo, 12);
    await pool.query(`UPDATE usuarios SET password_hash=${ph(1)}, actualizado=NOW() WHERE id=${ph(2)}`, [hash, req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
