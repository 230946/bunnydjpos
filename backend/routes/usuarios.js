/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * routes/usuarios.js
 * Gestión de personal y roles dentro de un negocio
 */
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { pool, ph, dbType } = require('../db');
const { authMiddleware, requirePermiso } = require('../middleware/auth');

router.use(authMiddleware);

// ── Migración automática de columnas salariales ──────────────────
;(async () => {
  const cols = [
    `ALTER TABLE usuarios ADD COLUMN sueldo_base   DECIMAL(12,2) DEFAULT NULL`,
    `ALTER TABLE usuarios ADD COLUMN tarifa_hora    DECIMAL(10,2) DEFAULT NULL`,
    `ALTER TABLE usuarios ADD COLUMN comision_pct   DECIMAL(5,2)  DEFAULT NULL`,
  ];
  for (const sql of cols) {
    try { await pool.query(sql, [], { silent: true }); } catch {}
  }
})();

// ════════════════════════════════════════════════════════════════
// ROLES
// ════════════════════════════════════════════════════════════════

router.get('/roles', async (req, res) => {
  try {
    const nid = req.user.negocio_id;
    const { rows } = await pool.query(
      `SELECT r.*, (SELECT COUNT(*) FROM usuarios u WHERE u.rol_id = r.id) AS total_usuarios
       FROM roles r WHERE r.negocio_id=${ph(1)} ORDER BY r.creado`,
      [nid]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/roles', requirePermiso('personal'), async (req, res) => {
  try {
    const { nombre, descripcion, permisos } = req.body;
    const id = uuid();
    await pool.query(
      `INSERT INTO roles (id,negocio_id,nombre,descripcion,permisos)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)})`,
      [id, req.user.negocio_id, nombre, descripcion||'', JSON.stringify(permisos||{})]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/roles/:id', requirePermiso('personal'), async (req, res) => {
  try {
    const { nombre, descripcion, permisos } = req.body;
    await pool.query(
      `UPDATE roles SET nombre=${ph(1)}, descripcion=${ph(2)}, permisos=${ph(3)} WHERE id=${ph(4)} AND negocio_id=${ph(5)}`,
      [nombre, descripcion, JSON.stringify(permisos||{}), req.params.id, req.user.negocio_id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/roles/:id', requirePermiso('personal'), async (req, res) => {
  try {
    // No permitir eliminar un rol que esté asignado a usuarios
    const { rows } = await pool.query(`SELECT COUNT(*) AS cnt FROM usuarios WHERE rol_id=${ph(1)} AND negocio_id=${ph(2)}`,[req.params.id, req.user.negocio_id]);
    const cnt = parseInt(rows[0].cnt || rows[0].COUNT || 0, 10);
    if (cnt > 0) return res.status(400).json({ error: 'No se puede eliminar rol asignado a usuarios' });

    await pool.query(`DELETE FROM roles WHERE id=${ph(1)} AND negocio_id=${ph(2)} AND es_sistema=0`,
      [req.params.id, req.user.negocio_id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Asignar múltiples usuarios a un rol (bulk)
// user_ids = lista de ids que DEBEN tener este rol; el resto pierde el rol si lo tenía
router.post('/roles/:id/usuarios', requirePermiso('personal'), async (req, res) => {
  try {
    const roleId = req.params.id;
    const { user_ids } = req.body;
    if (!Array.isArray(user_ids)) return res.status(400).json({ error: 'user_ids debe ser un array' });

    // Verificar que el rol pertenece al negocio
    const roleCheck = await pool.query(`SELECT id FROM roles WHERE id=${ph(1)} AND negocio_id=${ph(2)} LIMIT 1`, [roleId, req.user.negocio_id]);
    if (!roleCheck.rows[0]) return res.status(404).json({ error: 'Rol no encontrado' });

    // 1. Quitar el rol a quienes lo tenían y ya no están en la lista
    if (user_ids.length > 0) {
      if (dbType === 'pg') {
        const placeholders = user_ids.map((_, i) => `$${i + 3}`).join(',');
        await pool.query(
          `UPDATE usuarios SET rol_id=NULL WHERE negocio_id=$1 AND rol_id=$2 AND id NOT IN (${placeholders})`,
          [req.user.negocio_id, roleId, ...user_ids]
        );
      } else {
        const placeholders = user_ids.map(() => '?').join(',');
        await pool.query(
          `UPDATE usuarios SET rol_id=NULL WHERE negocio_id=? AND rol_id=? AND id NOT IN (${placeholders})`,
          [req.user.negocio_id, roleId, ...user_ids]
        );
      }
    } else {
      // Lista vacía: quitar el rol a todos
      await pool.query(
        `UPDATE usuarios SET rol_id=NULL WHERE negocio_id=${ph(1)} AND rol_id=${ph(2)}`,
        [req.user.negocio_id, roleId]
      );
    }

    // 2. Asignar el rol a los marcados
    if (user_ids.length > 0) {
      if (dbType === 'pg') {
        const placeholders = user_ids.map((_, i) => `$${i + 2}`).join(',');
        await pool.query(
          `UPDATE usuarios SET rol_id=$1 WHERE id IN (${placeholders}) AND negocio_id=$${user_ids.length + 2}`,
          [roleId, ...user_ids, req.user.negocio_id]
        );
      } else {
        const placeholders = user_ids.map(() => '?').join(',');
        await pool.query(
          `UPDATE usuarios SET rol_id=? WHERE id IN (${placeholders}) AND negocio_id=?`,
          [roleId, ...user_ids, req.user.negocio_id]
        );
      }
    }

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// USUARIOS / PERSONAL
// ════════════════════════════════════════════════════════════════

router.get('/usuarios', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.nombre, u.email, u.username, u.rol_id, u.activo,
             u.avatar_url, u.creado, u.numero_empleado, u.sueldo_base, u.tarifa_hora, u.comision_pct,
             r.nombre AS rol_nombre
      FROM usuarios u
      LEFT JOIN roles r ON r.id = u.rol_id
      WHERE u.negocio_id=${ph(1)} ORDER BY u.nombre
    `, [req.user.negocio_id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/usuarios/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.nombre, u.email, u.username, u.rol_id, u.activo,
             u.avatar_url, u.creado, u.sueldo_base, u.tarifa_hora, u.comision_pct, r.nombre AS rol_nombre
      FROM usuarios u
      LEFT JOIN roles r ON r.id = u.rol_id
      WHERE u.id=${ph(1)} AND u.negocio_id=${ph(2)}
      LIMIT 1
    `, [req.params.id, req.user.negocio_id]);
    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/usuarios', requirePermiso('personal'), async (req, res) => {
  try {
    const { nombre, email, username, password, rol_id } = req.body;
    if (!nombre || !password) return res.status(400).json({ error: 'nombre y password requeridos' });
    const hash = await bcrypt.hash(password, 12);
    const id = uuid();
    // Calcular siguiente número de empleado para este negocio
    const { rows: maxRow } = await pool.query(
      `SELECT COALESCE(MAX(numero_empleado), 0) + 1 AS siguiente FROM usuarios WHERE negocio_id=${ph(1)}`,
      [req.user.negocio_id]
    );
    const numero_empleado = maxRow[0].siguiente || 1;
    await pool.query(
      `INSERT INTO usuarios (id, negocio_id, rol_id, nombre, email, username, password_hash, numero_empleado)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)})`,
      [id, req.user.negocio_id, rol_id||null, nombre, email||null, username||null, hash, numero_empleado]
    );
    res.status(201).json({ id, numero_empleado });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/usuarios/:id', async (req, res) => {
  try {
    const { nombre, email, username, rol_id, activo, sueldo_base, tarifa_hora, comision_pct } = req.body;
    await pool.query(
      `UPDATE usuarios SET nombre=${ph(1)},email=${ph(2)},username=${ph(3)},rol_id=${ph(4)},activo=${ph(5)},
       sueldo_base=${ph(6)},tarifa_hora=${ph(7)},comision_pct=${ph(8)},actualizado=NOW()
       WHERE id=${ph(9)} AND negocio_id=${ph(10)}`,
      [nombre, email, username, rol_id, activo,
       sueldo_base||null, tarifa_hora||null, comision_pct||null,
       req.params.id, req.user.negocio_id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/usuarios/:id/password', async (req, res) => {
  try {
    const hash = await bcrypt.hash(req.body.password, 12);
    await pool.query(`UPDATE usuarios SET password_hash=${ph(1)} WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
      [hash, req.params.id, req.user.negocio_id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// HORARIOS
// ════════════════════════════════════════════════════════════════

// Migración: liberar usuario_id de FK+NOT NULL y agregar empleado_pel_id
;(async () => {
  // Cada paso en su propio try-catch para que un fallo no detenga los siguientes
  try {
    const { rows: fks } = await pool.query(`
      SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='horarios'
      AND COLUMN_NAME='usuario_id' AND REFERENCED_TABLE_NAME='usuarios' LIMIT 1
    `);
    if (fks[0]) {
      try { await pool.query(`ALTER TABLE horarios DROP FOREIGN KEY \`${fks[0].CONSTRAINT_NAME}\``); } catch {}
    }
  } catch {}
  try { await pool.query(`ALTER TABLE horarios MODIFY COLUMN usuario_id VARCHAR(36) NULL`); } catch {}
  try { await pool.query(`ALTER TABLE horarios ADD COLUMN empleado_pel_id VARCHAR(36) NULL`); } catch {}
  try { await pool.query(`ALTER TABLE horarios ADD COLUMN fecha DATE NULL`); } catch {}
  try { await pool.query(`ALTER TABLE horarios ADD COLUMN es_libre TINYINT(1) NOT NULL DEFAULT 0`); } catch {}
  try { await pool.query(`ALTER TABLE horarios MODIFY COLUMN hora_entrada TIME NULL`); } catch {}
  try { await pool.query(`ALTER TABLE horarios MODIFY COLUMN hora_salida TIME NULL`); } catch {}
})();

// DATE se serializa como Date JS; forzar YYYY-MM-DD local para evitar el
// corrimiento de día que produce JSON.stringify()->toISOString() (UTC).
const _fechaYMD = v => {
  if (!v) return null;
  if (v instanceof Date) {
    const pad = n => String(n).padStart(2,'0');
    return `${v.getFullYear()}-${pad(v.getMonth()+1)}-${pad(v.getDate())}`;
  }
  return String(v).slice(0,10);
};
router.get('/horarios', async (req, res) => {
  try {
    // Intentar con JOIN a pel_empleados (nuevo sistema)
    const queries = [
      `SELECT h.*, e.nombre AS usuario_nombre,
              e.sueldo_base, e.tarifa_hora, e.pct_comision AS comision_pct,
              e.tipo_comision, e.monto_comision, h.empleado_pel_id
       FROM horarios h
       JOIN pel_empleados e ON e.id = h.empleado_pel_id
       WHERE h.negocio_id=${ph(1)} AND h.activo=1 AND h.empleado_pel_id IS NOT NULL
       ORDER BY e.nombre, h.dia_semana`,
      // Fallback: si la columna empleado_pel_id aún no existe, usar usuario_id
      `SELECT h.*, u.nombre AS usuario_nombre
       FROM horarios h
       JOIN usuarios u ON u.id = h.usuario_id
       WHERE h.negocio_id=${ph(1)} AND h.activo=1
       ORDER BY h.usuario_id, h.dia_semana`,
    ];
    for (const sql of queries) {
      try {
        const { rows } = await pool.query(sql, [req.user.negocio_id]);
        rows.forEach(r => { r.fecha = _fechaYMD(r.fecha); });
        return res.json(rows);
      } catch (_) {}
    }
    res.json([]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/horarios', requirePermiso('horarios'), async (req, res) => {
  try {
    const { usuario_id, dia_semana, hora_entrada, hora_salida, fecha, es_libre } = req.body;
    const id = uuid();
    // fecha = NULL → horario semanal recurrente; fecha = 'YYYY-MM-DD' → excepción de un solo día
    await pool.query(
      `INSERT INTO horarios (id,empleado_pel_id,negocio_id,dia_semana,hora_entrada,hora_salida,fecha,es_libre)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)})`,
      [id, usuario_id, req.user.negocio_id, dia_semana,
       es_libre ? null : hora_entrada, es_libre ? null : hora_salida,
       fecha || null, es_libre ? 1 : 0]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/horarios/:id', requirePermiso('horarios'), async (req, res) => {
  try {
    await pool.query(`UPDATE horarios SET activo=0 WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, req.user.negocio_id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// ASISTENCIA
// ════════════════════════════════════════════════════════════════

router.get('/asistencia', requirePermiso('personal'), async (req, res) => {
  try {
    const { desde, hasta, usuario_id } = req.query;
    let sql = `
      SELECT a.*, u.nombre AS usuario_nombre
      FROM asistencia a JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.negocio_id=${ph(1)}
    `;
    const params = [req.user.negocio_id];
    if (desde) { params.push(desde); sql += ` AND DATE(a.entrada) >= ${ph(params.length)}`; }
    if (hasta) { params.push(hasta); sql += ` AND DATE(a.entrada) <= ${ph(params.length)}`; }
    if (usuario_id) { params.push(usuario_id); sql += ` AND a.usuario_id = ${ph(params.length)}`; }
    sql += ' ORDER BY a.entrada DESC LIMIT 200';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/asistencia', requirePermiso('personal'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM asistencia WHERE negocio_id=${ph(1)}`, [req.user.negocio_id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
