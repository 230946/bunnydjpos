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
const crypto  = require('crypto');
const { v4: uuid } = require('uuid');
const { pool, ph } = require('../db');
const { authMiddleware, bloqueoFueraDeTurno } = require('../middleware/auth');
const { limitePorIp, crearLimiteLogin } = require('../middleware/limites');
const { esCuentaAdmin, cargarCuenta } = require('../middleware/cuentas');
const { enviarEnlaceRecuperacion, enviarAvisoClaveCambiada } = require('../mailer');

const totp = require('../totp');
const QRCode = require('qrcode');

const limiteLogin = crearLimiteLogin();

// ── Sesión y verificación en dos pasos ──────────────────────────
async function emitirSesion(req, user, negocioPedido) {
  let permisos = {};
  try { permisos = typeof user.permisos === 'string' ? JSON.parse(user.permisos) : (user.permisos || {}); } catch {}
  const payload = {
    id:            user.id,
    nombre:        user.nombre,
    email:         user.email,
    negocio_id:    user.negocio_id || (user.es_superadmin && negocioPedido ? negocioPedido : null),
    rol_id:        user.rol_id,
    rol_nombre:    user.rol_nombre,
    es_superadmin: user.es_superadmin,
    permisos,
    tv:            user.token_version || 0,
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '8h' });
  await pool.query(
    `INSERT INTO sesiones (id, usuario_id, token_hash, ip, expira)
     VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)}, DATE_ADD(NOW(), INTERVAL 8 HOUR))`,
    [uuid(), user.id, token.slice(-20), req.ip]
  );
  return { token, user: payload };
}

async function buscarUsuarioSesion(id) {
  const { rows } = await pool.query(
    `SELECT u.*, r.permisos, r.nombre AS rol_nombre FROM usuarios u
     LEFT JOIN roles r ON r.id = u.rol_id WHERE u.id=? AND u.activo=1 LIMIT 1`, [id]);
  return rows[0] || null;
}

const hashRespaldo = (c) => crypto.createHash('sha256').update(String(c).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
function generarRespaldo() {
  const alf = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 10 }, () => {
    const b = crypto.randomBytes(8);
    const s = Array.from(b, x => alf[x % alf.length]).join('');
    return s.slice(0, 4) + '-' + s.slice(4);
  });
}

const _intentosDesafio = new Map(); // jti → intentos fallidos
const MAX_INTENTOS_DESAFIO = 5;

// ── POST /api/auth/login ─────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { login, password, negocio_id } = req.body;
    if (typeof login !== 'string' || typeof password !== 'string' || !login || !password) {
      return res.status(400).json({ error: 'login y password requeridos' });
    }
    if (!limiteLogin.registrar(req, login)) return res.status(429).json({ error: limiteLogin.MSG });

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
    limiteLogin.exito(req, login);

    let permisos = {};
    try { permisos = typeof user.permisos === 'string' ? JSON.parse(user.permisos) : (user.permisos || {}); } catch {}

    const bloqueo = await bloqueoFueraDeTurno({ negocio_id: user.negocio_id, es_superadmin: user.es_superadmin, permisos });
    if (bloqueo) return res.status(403).json({ error: bloqueo });

    // Administradores y superadmins: segundo paso con el código de la app.
    if (user.es_superadmin || permisos.personal) {
      let secreto = user.totp_secret;
      if (!user.totp_activo && !secreto) {
        secreto = totp.generarSecreto();
        await pool.query(`UPDATE usuarios SET totp_secret=? WHERE id=? AND totp_activo=0`, [secreto, user.id]);
      }
      const desafio = jwt.sign(
        { fin: '2fa', sub: user.id, nid: negocio_id || null, jti: crypto.randomUUID() },
        process.env.JWT_SECRET, { expiresIn: '10m' }
      );
      const r = { requiere_2fa: true, configurar: !user.totp_activo, desafio };
      if (!user.totp_activo) {
        const url = totp.urlOtpauth(secreto, user.email || user.username || user.nombre);
        r.qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });
        r.secreto = secreto;
      }
      return res.json(r);
    }

    res.json(await emitirSesion(req, user, negocio_id));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── POST /api/auth/2fa ─ segundo paso del login de administradores
router.post('/2fa', limitePorIp(30, 15 * 60 * 1000), async (req, res) => {
  try {
    const { desafio, codigo } = req.body || {};
    if (typeof desafio !== 'string' || typeof codigo !== 'string') return res.status(400).json({ error: 'Falta el código' });
    let d;
    try { d = jwt.verify(desafio, process.env.JWT_SECRET); } catch { d = null; }
    if (!d || d.fin !== '2fa' || !d.jti) {
      return res.status(401).json({ error: 'El tiempo para escribir el código terminó. Ingresa de nuevo.', reiniciar: true });
    }
    if ((_intentosDesafio.get(d.jti) || 0) >= MAX_INTENTOS_DESAFIO) {
      return res.status(401).json({ error: 'Demasiados códigos incorrectos. Ingresa de nuevo.', reiniciar: true });
    }
    const user = await buscarUsuarioSesion(d.sub);
    if (!user || !user.totp_secret) return res.status(401).json({ error: 'Ingresa de nuevo.', reiniciar: true });

    const limpio = codigo.replace(/\s/g, '');
    let ok = false;
    const paso = totp.verificar(user.totp_secret, limpio, user.totp_ultimo_paso);
    if (paso !== null) {
      // Condición en el UPDATE: el mismo código no sirve dos veces, ni en paralelo.
      const { rows } = await pool.query(
        `UPDATE usuarios SET totp_ultimo_paso=? WHERE id=? AND (totp_ultimo_paso IS NULL OR totp_ultimo_paso < ?)`,
        [paso, user.id, paso]
      );
      ok = rows.affectedRows === 1;
    } else if (user.totp_activo && /^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(limpio)) {
      const { rows } = await pool.query(
        `UPDATE totp_respaldo SET usado=NOW() WHERE usuario_id=? AND code_hash=? AND usado IS NULL`,
        [user.id, hashRespaldo(limpio)]
      );
      ok = rows.affectedRows === 1;
    }
    if (!ok) {
      _intentosDesafio.set(d.jti, (_intentosDesafio.get(d.jti) || 0) + 1);
      if (_intentosDesafio.size > 10000) _intentosDesafio.clear();
      return res.status(400).json({ error: 'Código incorrecto o vencido. Escribe el que muestra ahora la app.' });
    }
    _intentosDesafio.set(d.jti, MAX_INTENTOS_DESAFIO); // el desafío no vuelve a servir

    let codigos_respaldo;
    if (!user.totp_activo) {
      codigos_respaldo = generarRespaldo();
      await pool.transaction(async (q) => {
        await q(`UPDATE usuarios SET totp_activo=1 WHERE id=?`, [user.id]);
        await q(`DELETE FROM totp_respaldo WHERE usuario_id=?`, [user.id]);
        for (const c of codigos_respaldo) {
          await q(`INSERT INTO totp_respaldo (id, usuario_id, code_hash) VALUES (?,?,?)`, [uuid(), user.id, hashRespaldo(c)]);
        }
      });
    }
    const sesion = await emitirSesion(req, user, d.nid);
    res.json(codigos_respaldo ? { ...sesion, codigos_respaldo } : sesion);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── Recuperación de contraseña por enlace de un solo uso ─────────
const RESET_MINUTOS = 30;
const RESET_MAX_POR_HORA = 3;
const MSG_RECUPERACION = 'Si la cuenta existe y puede recuperarse por correo, enviamos un enlace que vence en 30 minutos. Si no te llega, pide ayuda a tu administrador; las cuentas de administrador las restablece el usuario maestro.';
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function procesarRecuperacion(login) {
  const { rows } = await pool.query(
    `SELECT id, email, nombre FROM usuarios WHERE (email = ? OR username = ?) AND activo=1 LIMIT 1`,
    [login, login]
  );
  const user = rows[0];
  if (!user?.email) return;
  // Las claves de administradores solo las cambia el usuario maestro.
  const cuenta = await cargarCuenta(user.id);
  if (esCuentaAdmin(cuenta) && !cuenta.es_maestro) return;

  await pool.query(`DELETE FROM password_resets WHERE expira < DATE_SUB(NOW(), INTERVAL 1 DAY)`);
  const { rows: recientes } = await pool.query(
    `SELECT COUNT(*) AS n FROM password_resets WHERE usuario_id=? AND creado > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
    [user.id]
  );
  if (+recientes[0].n >= RESET_MAX_POR_HORA) return;

  // Solo se guarda el hash: quien lea la base de datos no puede usar los enlaces.
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(`UPDATE password_resets SET usado=NOW() WHERE usuario_id=? AND usado IS NULL`, [user.id]);
  await pool.query(
    `INSERT INTO password_resets (token_hash, usuario_id, expira) VALUES (?,?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [hashToken(token), user.id, RESET_MINUTOS]
  );
  await enviarEnlaceRecuperacion({ to: user.email, nombre: user.nombre, token, minutos: RESET_MINUTOS });
}

// POST /api/auth/forgot-password
router.post('/forgot-password', limitePorIp(10, 15 * 60 * 1000), (req, res) => {
  const login = req.body?.login;
  if (typeof login !== 'string' || !login.trim()) return res.status(400).json({ error: 'Usuario o email requerido' });
  // Se responde antes de buscar la cuenta: ni el mensaje ni el tiempo de
  // respuesta revelan si existe o si el correo se pudo enviar.
  res.json({ ok: true, message: MSG_RECUPERACION });
  procesarRecuperacion(login.trim()).catch(e => console.error('Error en recuperación de contraseña:', e.message));
});

async function resetVigente(token) {
  if (typeof token !== 'string' || !token) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.nombre FROM password_resets pr
     JOIN usuarios u ON u.id = pr.usuario_id
     WHERE pr.token_hash=? AND pr.usado IS NULL AND pr.expira > NOW() AND u.activo=1`,
    [hashToken(token)]
  );
  if (!rows[0]) return null;
  // Enlaces pedidos antes de que la cuenta pasara a ser de administrador.
  const cuenta = await cargarCuenta(rows[0].id);
  if (esCuentaAdmin(cuenta) && !cuenta.es_maestro) return null;
  return rows[0];
}

const MSG_ENLACE_INVALIDO = 'Este enlace ya se usó o venció. Solicita uno nuevo.';

// POST /api/auth/reset-password/validar — la página lo usa para avisar antes de
// pedir la clave. Es POST para que un antivirus de correo que abra el enlace
// no pueda tocar nada.
router.post('/reset-password/validar', limitePorIp(30, 15 * 60 * 1000), async (req, res) => {
  try {
    res.json({ valido: !!(await resetVigente(req.body?.token)) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', limitePorIp(30, 15 * 60 * 1000), async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }
    // bcrypt ignora lo que pase de 72 bytes
    if (Buffer.byteLength(password) > 72) return res.status(400).json({ error: 'La contraseña es demasiado larga' });
    if (!(await resetVigente(token))) return res.status(400).json({ error: MSG_ENLACE_INVALIDO });

    const hash = await bcrypt.hash(password, 12);
    // FOR UPDATE: de dos envíos simultáneos con el mismo enlace, solo pasa uno.
    const user = await pool.transaction(async (q) => {
      const filas = await q(
        `SELECT u.id, u.email, u.nombre FROM password_resets pr
         JOIN usuarios u ON u.id = pr.usuario_id
         WHERE pr.token_hash=? AND pr.usado IS NULL AND pr.expira > NOW() AND u.activo=1 FOR UPDATE`,
        [hashToken(token)]
      );
      if (!filas[0]) return null;
      await q(`UPDATE password_resets SET usado=NOW() WHERE usuario_id=? AND usado IS NULL`, [filas[0].id]);
      await q(`UPDATE usuarios SET password_hash=?, token_version=token_version+1, actualizado=NOW() WHERE id=?`, [hash, filas[0].id]);
      return filas[0];
    });
    if (!user) return res.status(400).json({ error: MSG_ENLACE_INVALIDO });

    res.json({ ok: true });
    enviarAvisoClaveCambiada({ to: user.email, nombre: user.nombre })
      .catch(e => console.error('No se pudo enviar el aviso de cambio de contraseña:', e.message));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── POST /api/auth/logout ────────────────────────────────────────
router.post('/logout', authMiddleware, async (req, res) => {
  res.json({ ok: true });
});

// ── GET /api/auth/me ─────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.username, u.negocio_id, u.rol_id,
              u.avatar_url, u.es_superadmin, u.es_maestro, r.nombre AS rol_nombre, r.permisos
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
    await pool.query(`UPDATE usuarios SET password_hash=${ph(1)}, token_version=token_version+1, actualizado=NOW() WHERE id=${ph(2)}`, [hash, req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
