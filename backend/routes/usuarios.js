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

const localDate = (tz = 'America/Bogota') =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const _addDays = (dateStr, days) => {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Registra un nuevo contrato cuando cambian los términos de pago del empleado,
// cerrando el vigente — así la nómina de meses pasados no cambia si hoy se edita el sueldo.
async function _historizarContrato(negocioId, usuarioId, sueldoBase, tarifaHora, multiplicadorHoraExtra) {
  const sb = parseFloat(sueldoBase) || 0;
  const vh = parseFloat(tarifaHora) || 0;
  const mult = parseFloat(multiplicadorHoraExtra) || 1.5;
  if (!sb && !vh) return;
  const tipo = sb && vh ? 'mixto' : (sb ? 'fijo' : 'por_horas');
  const { rows: actual } = await pool.query(
    `SELECT id, tipo, salario_base, valor_hora, multiplicador_hora_extra FROM contratos WHERE usuario_id=${ph(1)} AND fecha_fin IS NULL ORDER BY fecha_inicio DESC LIMIT 1`,
    [usuarioId]
  );
  const vigente = actual[0];
  if (vigente && parseFloat(vigente.salario_base) === sb && parseFloat(vigente.valor_hora) === vh
      && parseFloat(vigente.multiplicador_hora_extra) === mult && vigente.tipo === tipo) return;
  const hoy = localDate();
  if (vigente) {
    await pool.query(`UPDATE contratos SET fecha_fin=${ph(1)} WHERE id=${ph(2)}`, [_addDays(hoy, -1), vigente.id]);
  }
  await pool.query(
    `INSERT INTO contratos (id, negocio_id, usuario_id, tipo, salario_base, valor_hora, multiplicador_hora_extra, fecha_inicio)
     VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)})`,
    [uuid(), negocioId, usuarioId, tipo, sb, vh, mult, hoy]
  );
}

// ── Migración automática de columnas salariales ──────────────────
;(async () => {
  const cols = [
    `ALTER TABLE usuarios ADD COLUMN sueldo_base   DECIMAL(12,2) DEFAULT NULL`,
    `ALTER TABLE usuarios ADD COLUMN tarifa_hora    DECIMAL(10,2) DEFAULT NULL`,
    `ALTER TABLE usuarios ADD COLUMN comision_pct   DECIMAL(5,2)  DEFAULT NULL`,
    `ALTER TABLE usuarios ADD COLUMN documento      VARCHAR(30)   DEFAULT NULL`,
    `ALTER TABLE usuarios ADD COLUMN fecha_nacimiento DATE DEFAULT NULL`,
    `ALTER TABLE usuarios ADD COLUMN direccion       VARCHAR(200)  DEFAULT NULL`,
    `ALTER TABLE usuarios ADD COLUMN telefono        VARCHAR(30)   DEFAULT NULL`,
    `ALTER TABLE usuarios ADD COLUMN cargo           VARCHAR(100)  DEFAULT NULL`,
    `ALTER TABLE usuarios ADD COLUMN fecha_inicio    DATE DEFAULT NULL`,
    `ALTER TABLE usuarios ADD COLUMN tipo_contrato   VARCHAR(50)   DEFAULT NULL`,
    `ALTER TABLE usuarios ADD COLUMN contacto_emergencia_nombre   VARCHAR(150) DEFAULT NULL`,
    `ALTER TABLE usuarios ADD COLUMN contacto_emergencia_telefono VARCHAR(30)  DEFAULT NULL`,
    `ALTER TABLE usuarios ADD COLUMN multiplicador_hora_extra DECIMAL(4,2) NOT NULL DEFAULT 1.50`,
  ];
  for (const sql of cols) {
    try { await pool.query(sql, [], { silent: true }); } catch {}
  }
})();

// ── Nómina: bonificaciones y descuentos por empleado y período ───
;(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS nomina_ajustes (
      id          VARCHAR(36)   PRIMARY KEY,
      negocio_id  VARCHAR(36)   NOT NULL,
      usuario_id  VARCHAR(36)   NOT NULL,
      periodo     VARCHAR(7)    NOT NULL,
      tipo        ENUM('bonificacion','descuento') NOT NULL,
      concepto    VARCHAR(150)  NOT NULL,
      monto       DECIMAL(12,2) NOT NULL,
      creado      DATETIME      DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_nomina_neg_periodo (negocio_id, periodo),
      INDEX idx_nomina_usuario (usuario_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  } catch (e) { console.error('nomina_ajustes DDL:', e.message); }
})();

// ── Nómina fase 2: contratos historizados + cierre de período ────
;(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS contratos (
      id            VARCHAR(36)   PRIMARY KEY,
      negocio_id    VARCHAR(36)   NOT NULL,
      usuario_id    VARCHAR(36)   NOT NULL,
      tipo          VARCHAR(20)   NOT NULL DEFAULT 'mixto',
      salario_base  DECIMAL(12,2) NOT NULL DEFAULT 0,
      valor_hora    DECIMAL(10,2) NOT NULL DEFAULT 0,
      multiplicador_hora_extra DECIMAL(4,2) NOT NULL DEFAULT 1.50,
      fecha_inicio  DATE          NOT NULL,
      fecha_fin     DATE          DEFAULT NULL,
      creado        DATETIME      DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_contratos_usuario (usuario_id, fecha_fin)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    try { await pool.query(`ALTER TABLE contratos ADD COLUMN multiplicador_hora_extra DECIMAL(4,2) NOT NULL DEFAULT 1.50`, [], { silent: true }); } catch {}

    await pool.query(`CREATE TABLE IF NOT EXISTS periodos_nomina (
      id          VARCHAR(36)   PRIMARY KEY,
      negocio_id  VARCHAR(36)   NOT NULL,
      periodo     VARCHAR(7)    NOT NULL,
      estado      ENUM('abierto','calculado','aprobado','pagado') NOT NULL DEFAULT 'abierto',
      calculado   DATETIME      DEFAULT NULL,
      aprobado    DATETIME      DEFAULT NULL,
      pagado      DATETIME      DEFAULT NULL,
      creado      DATETIME      DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_periodo (negocio_id, periodo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await pool.query(`CREATE TABLE IF NOT EXISTS nomina_detalle (
      id                  VARCHAR(36)   PRIMARY KEY,
      periodo_id          VARCHAR(36)   NOT NULL,
      negocio_id          VARCHAR(36)   NOT NULL,
      usuario_id          VARCHAR(36)   NOT NULL,
      contrato_id         VARCHAR(36)   DEFAULT NULL,
      horas_trabajadas    DECIMAL(8,2)  NOT NULL DEFAULT 0,
      horas_extra         DECIMAL(8,2)  NOT NULL DEFAULT 0,
      sueldo_base         DECIMAL(12,2) NOT NULL DEFAULT 0,
      tarifa_hora         DECIMAL(10,2) NOT NULL DEFAULT 0,
      pago_horas          DECIMAL(12,2) NOT NULL DEFAULT 0,
      bonificaciones      DECIMAL(12,2) NOT NULL DEFAULT 0,
      total_deducciones   DECIMAL(12,2) NOT NULL DEFAULT 0,
      neto_pagar          DECIMAL(12,2) NOT NULL DEFAULT 0,
      aprobado            TINYINT(1)    NOT NULL DEFAULT 0,
      creado              DATETIME      DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_detalle (periodo_id, usuario_id),
      INDEX idx_detalle_usuario (usuario_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await pool.query(`CREATE TABLE IF NOT EXISTS comprobante_pago (
      id                  VARCHAR(36) PRIMARY KEY,
      nomina_detalle_id   VARCHAR(36) NOT NULL UNIQUE,
      generado            DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // Por si la tabla nomina_detalle ya existía de una versión anterior sin esta columna.
    try { await pool.query(`ALTER TABLE nomina_detalle ADD COLUMN tarifa_hora DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER sueldo_base`, [], { silent: true }); } catch {}
    try { await pool.query(`ALTER TABLE nomina_detalle ADD COLUMN horas_extra DECIMAL(8,2) NOT NULL DEFAULT 0 AFTER horas_trabajadas`, [], { silent: true }); } catch {}
  } catch (e) { console.error('nomina fase 2 DDL:', e.message); }
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
             u.avatar_url, u.creado, u.numero_empleado, u.documento, u.sueldo_base, u.tarifa_hora, u.comision_pct, u.multiplicador_hora_extra,
             u.fecha_nacimiento, u.direccion, u.telefono, u.cargo, u.fecha_inicio, u.tipo_contrato,
             u.contacto_emergencia_nombre, u.contacto_emergencia_telefono,
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
             u.avatar_url, u.creado, u.numero_empleado, u.documento, u.sueldo_base, u.tarifa_hora, u.comision_pct, u.multiplicador_hora_extra,
             u.fecha_nacimiento, u.direccion, u.telefono, u.cargo, u.fecha_inicio, u.tipo_contrato,
             u.contacto_emergencia_nombre, u.contacto_emergencia_telefono,
             r.nombre AS rol_nombre
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
    const {
      nombre, email, username, password, rol_id, sueldo_base, tarifa_hora, documento,
      fecha_nacimiento, direccion, telefono, cargo, fecha_inicio, tipo_contrato,
      contacto_emergencia_nombre, contacto_emergencia_telefono, multiplicador_hora_extra,
    } = req.body;
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
      `INSERT INTO usuarios (id, negocio_id, rol_id, nombre, email, username, password_hash, numero_empleado, sueldo_base, tarifa_hora, documento,
       fecha_nacimiento, direccion, telefono, cargo, fecha_inicio, tipo_contrato, contacto_emergencia_nombre, contacto_emergencia_telefono, multiplicador_hora_extra)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},${ph(9)},${ph(10)},${ph(11)},
       ${ph(12)},${ph(13)},${ph(14)},${ph(15)},${ph(16)},${ph(17)},${ph(18)},${ph(19)},${ph(20)})`,
      [id, req.user.negocio_id, rol_id||null, nombre, email||null, username||null, hash, numero_empleado, sueldo_base||null, tarifa_hora||null, documento?String(documento).trim():null,
       fecha_nacimiento||null, direccion||null, telefono||null, cargo||null, fecha_inicio||null, tipo_contrato||null, contacto_emergencia_nombre||null, contacto_emergencia_telefono||null,
       multiplicador_hora_extra||1.5]
    );
    await _historizarContrato(req.user.negocio_id, id, sueldo_base, tarifa_hora, multiplicador_hora_extra);
    res.status(201).json({ id, numero_empleado });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/usuarios/:id', async (req, res) => {
  try {
    const {
      nombre, email, username, rol_id, activo, sueldo_base, tarifa_hora, comision_pct, documento,
      fecha_nacimiento, direccion, telefono, cargo, fecha_inicio, tipo_contrato,
      contacto_emergencia_nombre, contacto_emergencia_telefono, multiplicador_hora_extra,
    } = req.body;
    await pool.query(
      `UPDATE usuarios SET nombre=${ph(1)},email=${ph(2)},username=${ph(3)},rol_id=${ph(4)},activo=${ph(5)},
       sueldo_base=${ph(6)},tarifa_hora=${ph(7)},comision_pct=${ph(8)},documento=${ph(9)},
       fecha_nacimiento=${ph(10)},direccion=${ph(11)},telefono=${ph(12)},cargo=${ph(13)},fecha_inicio=${ph(14)},tipo_contrato=${ph(15)},
       contacto_emergencia_nombre=${ph(16)},contacto_emergencia_telefono=${ph(17)},multiplicador_hora_extra=${ph(18)},actualizado=NOW()
       WHERE id=${ph(19)} AND negocio_id=${ph(20)}`,
      [nombre, email, username, rol_id, activo,
       sueldo_base||null, tarifa_hora||null, comision_pct||null, documento?String(documento).trim():null,
       fecha_nacimiento||null, direccion||null, telefono||null, cargo||null, fecha_inicio||null, tipo_contrato||null,
       contacto_emergencia_nombre||null, contacto_emergencia_telefono||null, multiplicador_hora_extra||1.5,
       req.params.id, req.user.negocio_id]
    );
    await _historizarContrato(req.user.negocio_id, req.params.id, sueldo_base, tarifa_hora, multiplicador_hora_extra);
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
    // Un turno pertenece a un empleado de peluquería (pel_empleados, vía
    // empleado_pel_id) O a un usuario de restaurante/minimercado (usuarios,
    // vía usuario_id) — nunca ambos. LEFT JOIN a los dos y COALESCE del
    // nombre cubre los dos casos en una sola consulta, sin depender de que
    // una consulta "falle" para intentar la otra (antes ambas "tenían
    // éxito" con 0 filas y la segunda nunca se ejecutaba).
    const { rows } = await pool.query(
      `SELECT h.*, COALESCE(e.nombre, u.nombre) AS usuario_nombre,
              e.sueldo_base, e.tarifa_hora, e.pct_comision AS comision_pct,
              e.tipo_comision, e.monto_comision
       FROM horarios h
       LEFT JOIN pel_empleados e ON e.id = h.empleado_pel_id
       LEFT JOIN usuarios u ON u.id = h.usuario_id
       WHERE h.negocio_id=${ph(1)} AND h.activo=1
       ORDER BY usuario_nombre, h.dia_semana`,
      [req.user.negocio_id]
    );
    rows.forEach(r => { r.fecha = _fechaYMD(r.fecha); });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/horarios', requirePermiso('horarios'), async (req, res) => {
  try {
    const { usuario_id, dia_semana, hora_entrada, hora_salida, fecha, es_libre } = req.body;
    if (!usuario_id) return res.status(400).json({ error: 'Selecciona un empleado' });
    if (dia_semana === undefined || dia_semana === null || dia_semana === '')
      return res.status(400).json({ error: 'Selecciona el día de la semana' });
    if (!es_libre && (!hora_entrada || !hora_salida))
      return res.status(400).json({ error: 'Indica hora de entrada y salida, o marca el día como libre' });

    // El id que llega puede ser de pel_empleados (peluquería) o de usuarios
    // (restaurante/minimercado) — se guarda en la columna que corresponda,
    // nunca en la otra, para que el GET los pueda encontrar de vuelta.
    const { rows: pelRows } = await pool.query(
      `SELECT id FROM pel_empleados WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [usuario_id, req.user.negocio_id]
    );
    const esEmpleadoPel = pelRows.length > 0;
    const id = uuid();
    // fecha = NULL → horario semanal recurrente; fecha = 'YYYY-MM-DD' → excepción de un solo día
    if (esEmpleadoPel) {
      await pool.query(
        `INSERT INTO horarios (id,empleado_pel_id,negocio_id,dia_semana,hora_entrada,hora_salida,fecha,es_libre)
         VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)})`,
        [id, usuario_id, req.user.negocio_id, dia_semana,
         es_libre ? null : hora_entrada, es_libre ? null : hora_salida,
         fecha || null, es_libre ? 1 : 0]
      );
    } else {
      await pool.query(
        `INSERT INTO horarios (id,usuario_id,negocio_id,dia_semana,hora_entrada,hora_salida,fecha,es_libre)
         VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)})`,
        [id, usuario_id, req.user.negocio_id, dia_semana,
         es_libre ? null : hora_entrada, es_libre ? null : hora_salida,
         fecha || null, es_libre ? 1 : 0]
      );
    }
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

// Asistencia real: fichaje de entrada/salida del empleado (ver
// routes/turno.js), no el login/logout al panel admin — filas de
// `horarios` con fecha=un día concreto (no la plantilla semanal, que
// tiene fecha=NULL). hora_salida NULL = todavía en turno.
router.get('/asistencia', requirePermiso('personal'), async (req, res) => {
  try {
    const { desde, hasta, usuario_id } = req.query;
    let sql = `
      SELECT h.id, h.fecha,
             CONCAT(h.fecha,' ',h.hora_entrada) AS entrada,
             CASE WHEN h.hora_salida IS NOT NULL THEN CONCAT(h.fecha,' ',h.hora_salida) ELSE NULL END AS salida,
             u.nombre AS usuario_nombre
      FROM horarios h
      JOIN usuarios u ON u.id = h.usuario_id
      WHERE h.negocio_id=${ph(1)} AND h.activo=1 AND h.fecha IS NOT NULL AND h.hora_entrada IS NOT NULL
    `;
    const params = [req.user.negocio_id];
    if (desde) { params.push(desde); sql += ` AND h.fecha >= ${ph(params.length)}`; }
    if (hasta) { params.push(hasta); sql += ` AND h.fecha <= ${ph(params.length)}`; }
    if (usuario_id) { params.push(usuario_id); sql += ` AND h.usuario_id = ${ph(params.length)}`; }
    sql += ' ORDER BY h.fecha DESC, h.hora_entrada DESC LIMIT 200';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/asistencia', requirePermiso('personal'), async (req, res) => {
  try {
    // Rango de fechas obligatorio: `horarios` es la misma tabla que usa Nómina
    // para las horas trabajadas, así que borrar sin acotar fecha borraría
    // también fichaje de períodos ya calculados/abiertos fuera del rango visible.
    const { desde, hasta } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'Indica un rango de fechas (desde y hasta) para borrar' });
    await pool.query(
      `UPDATE horarios SET activo=0 WHERE negocio_id=${ph(1)} AND fecha IS NOT NULL AND hora_entrada IS NOT NULL AND fecha BETWEEN ${ph(2)} AND ${ph(3)}`,
      [req.user.negocio_id, desde, hasta]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// NÓMINA — sueldo base + horas trabajadas (fichaje real) +
// bonificaciones - descuentos, por período (mes).
// ════════════════════════════════════════════════════════════════

function _rangoPeriodo(periodo) {
  const [y, m] = periodo.split('-').map(Number);
  return { desde: `${periodo}-01`, hasta: new Date(y, m, 0).toISOString().slice(0, 10) };
}

// Calcula la nómina "en vivo" (sin congelar) para un período — usada mientras
// el período sigue 'abierto' y también como base al cerrarlo (calcular).
async function _calcularNominaViva(negocioId, periodo) {
  const { desde, hasta } = _rangoPeriodo(periodo);

  const { rows: empleados } = await pool.query(
    `SELECT id, nombre, numero_empleado, sueldo_base, tarifa_hora, multiplicador_hora_extra FROM usuarios
     WHERE negocio_id=${ph(1)} AND activo=1 ORDER BY nombre`,
    [negocioId]
  );

  // Minutos trabajados por día (sin agrupar) — así se puede topar cada día a 8h
  // (480 min) antes de sumar, en vez de sumar todo el período de una vez.
  const { rows: fichajeRows } = await pool.query(
    `SELECT usuario_id, TIMESTAMPDIFF(MINUTE, CONCAT(fecha,' ',hora_entrada), CONCAT(fecha,' ',hora_salida)) AS minutos
     FROM horarios
     WHERE negocio_id=${ph(1)} AND fecha BETWEEN ${ph(2)} AND ${ph(3)}
       AND hora_entrada IS NOT NULL AND hora_salida IS NOT NULL AND activo=1`,
    [negocioId, desde, hasta]
  );
  const TOPE_DIARIO_MIN = 480; // 8 horas
  const horasMap = new Map(); // usuario_id -> { normales, extra } en minutos
  fichajeRows.forEach(f => {
    const minutosDia = parseFloat(f.minutos) || 0;
    const normalesDia = Math.min(minutosDia, TOPE_DIARIO_MIN);
    const extraDia = Math.max(0, minutosDia - TOPE_DIARIO_MIN);
    if (!horasMap.has(f.usuario_id)) horasMap.set(f.usuario_id, { normales: 0, extra: 0 });
    const acc = horasMap.get(f.usuario_id);
    acc.normales += normalesDia;
    acc.extra += extraDia;
  });

  const { rows: ajustes } = await pool.query(
    `SELECT usuario_id, tipo, SUM(monto) AS total FROM nomina_ajustes
     WHERE negocio_id=${ph(1)} AND periodo=${ph(2)} GROUP BY usuario_id, tipo`,
    [negocioId, periodo]
  );
  const bonosMap = new Map(), descMap = new Map();
  ajustes.forEach(a => {
    (a.tipo === 'bonificacion' ? bonosMap : descMap).set(a.usuario_id, parseFloat(a.total) || 0);
  });

  // Contrato vigente al cierre del período (para congelar con las condiciones
  // que aplicaban en ese momento, no las que tenga el empleado hoy).
  const { rows: contratosRows } = await pool.query(
    `SELECT c1.* FROM contratos c1
     WHERE c1.negocio_id=${ph(1)} AND c1.fecha_inicio<=${ph(2)} AND (c1.fecha_fin IS NULL OR c1.fecha_fin>=${ph(3)})`,
    [negocioId, hasta, hasta]
  );
  const contratoMap = new Map(contratosRows.map(c => [c.usuario_id, c]));

  return empleados.map(e => {
    const contrato = contratoMap.get(e.id);
    const minutos = horasMap.get(e.id) || { normales: 0, extra: 0 };
    const horasNormales = minutos.normales / 60;
    const horasExtra = minutos.extra / 60;
    const tarifaHora = contrato ? parseFloat(contrato.valor_hora) || 0 : parseFloat(e.tarifa_hora) || 0;
    const sueldoBase = contrato ? parseFloat(contrato.salario_base) || 0 : parseFloat(e.sueldo_base) || 0;
    const multiplicador = contrato ? parseFloat(contrato.multiplicador_hora_extra) || 1.5 : parseFloat(e.multiplicador_hora_extra) || 1.5;
    const pagoHoras = (horasNormales * tarifaHora) + (horasExtra * tarifaHora * multiplicador);
    const bonificaciones = bonosMap.get(e.id) || 0;
    const descuentos = descMap.get(e.id) || 0;
    const total = sueldoBase + pagoHoras + bonificaciones - descuentos;
    return {
      usuario_id: e.id, nombre: e.nombre, numero_empleado: e.numero_empleado, contrato_id: contrato ? contrato.id : null,
      sueldo_base: sueldoBase, tarifa_hora: tarifaHora, multiplicador_hora_extra: multiplicador,
      horas_trabajadas: Math.round((horasNormales + horasExtra) * 100) / 100, horas_extra: Math.round(horasExtra * 100) / 100,
      pago_horas: Math.round(pagoHoras),
      bonificaciones, descuentos, total: Math.round(total),
    };
  });
}

async function _getOrCreatePeriodo(negocioId, periodo) {
  const { rows } = await pool.query(
    `SELECT * FROM periodos_nomina WHERE negocio_id=${ph(1)} AND periodo=${ph(2)} LIMIT 1`,
    [negocioId, periodo]
  );
  if (rows[0]) return rows[0];
  const id = uuid();
  await pool.query(
    `INSERT INTO periodos_nomina (id, negocio_id, periodo) VALUES (${ph(1)},${ph(2)},${ph(3)})`,
    [id, negocioId, periodo]
  );
  return { id, negocio_id: negocioId, periodo, estado: 'abierto' };
}

router.get('/nomina', requirePermiso('personal'), async (req, res) => {
  try {
    const { periodo } = req.query; // 'YYYY-MM'
    if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'Indica el período (YYYY-MM)' });

    const { rows: periodoRows } = await pool.query(
      `SELECT * FROM periodos_nomina WHERE negocio_id=${ph(1)} AND periodo=${ph(2)} LIMIT 1`,
      [req.user.negocio_id, periodo]
    );
    const periodoRow = periodoRows[0];

    if (!periodoRow || periodoRow.estado === 'abierto') {
      const filas = await _calcularNominaViva(req.user.negocio_id, periodo);
      return res.json({ estado: 'abierto', periodo_id: periodoRow ? periodoRow.id : null, filas });
    }

    const { rows: filas } = await pool.query(
      `SELECT d.id, d.usuario_id, u.nombre, u.numero_empleado, d.sueldo_base, d.tarifa_hora, d.horas_trabajadas, d.horas_extra,
              d.pago_horas, d.bonificaciones, d.total_deducciones AS descuentos, d.neto_pagar AS total, d.aprobado,
              (c.id IS NOT NULL) AS tiene_comprobante
       FROM nomina_detalle d
       JOIN usuarios u ON u.id = d.usuario_id
       LEFT JOIN comprobante_pago c ON c.nomina_detalle_id = d.id
       WHERE d.periodo_id=${ph(1)} ORDER BY u.nombre`,
      [periodoRow.id]
    );
    res.json({ estado: periodoRow.estado, periodo_id: periodoRow.id, filas });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Vista previa del desprendible mientras el período sigue 'abierto' — mismos
// datos que la tabla en vivo, sin necesitar haber cerrado el período todavía.
router.get('/nomina/preview/:usuarioId', requirePermiso('personal'), async (req, res) => {
  try {
    const { periodo } = req.query;
    if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'Indica el período (YYYY-MM)' });

    const filas = await _calcularNominaViva(req.user.negocio_id, periodo);
    const fila = filas.find(f => f.usuario_id === req.params.usuarioId);
    if (!fila) return res.status(404).json({ error: 'Empleado no encontrado' });

    const { rows: uRows } = await pool.query(
      `SELECT documento, cargo, fecha_inicio AS fecha_ingreso, tipo_contrato FROM usuarios WHERE id=${ph(1)} AND negocio_id=${ph(2)} LIMIT 1`,
      [req.params.usuarioId, req.user.negocio_id]
    );
    const { rows: nRows } = await pool.query(
      `SELECT nombre AS negocio_nombre, nit AS negocio_nit, direccion AS negocio_direccion, ciudad AS negocio_ciudad FROM negocios WHERE id=${ph(1)} LIMIT 1`,
      [req.user.negocio_id]
    );

    res.json({
      usuario_id: fila.usuario_id, nombre: fila.nombre, numero_empleado: fila.numero_empleado,
      sueldo_base: fila.sueldo_base, tarifa_hora: fila.tarifa_hora, horas_trabajadas: fila.horas_trabajadas, horas_extra: fila.horas_extra,
      pago_horas: fila.pago_horas, bonificaciones: fila.bonificaciones, total_deducciones: fila.descuentos,
      neto_pagar: fila.total, periodo, periodo_estado: 'abierto', fecha_pagado: null,
      ...(uRows[0] || {}), ...(nRows[0] || {}),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/nomina/periodos/:periodo/calcular', requirePermiso('personal'), async (req, res) => {
  try {
    const { periodo } = req.params;
    if (!/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'Período no válido' });
    const periodoRow = await _getOrCreatePeriodo(req.user.negocio_id, periodo);
    if (periodoRow.estado !== 'abierto') return res.status(400).json({ error: 'Este período ya fue cerrado' });

    const filas = await _calcularNominaViva(req.user.negocio_id, periodo);
    for (const f of filas) {
      await pool.query(
        `INSERT INTO nomina_detalle (id, periodo_id, negocio_id, usuario_id, contrato_id, horas_trabajadas, horas_extra, sueldo_base, tarifa_hora, pago_horas, bonificaciones, total_deducciones, neto_pagar)
         VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},${ph(9)},${ph(10)},${ph(11)},${ph(12)},${ph(13)})
         ON DUPLICATE KEY UPDATE horas_trabajadas=VALUES(horas_trabajadas), horas_extra=VALUES(horas_extra), sueldo_base=VALUES(sueldo_base), tarifa_hora=VALUES(tarifa_hora), pago_horas=VALUES(pago_horas), bonificaciones=VALUES(bonificaciones), total_deducciones=VALUES(total_deducciones), neto_pagar=VALUES(neto_pagar)`,
        [uuid(), periodoRow.id, req.user.negocio_id, f.usuario_id, f.contrato_id, f.horas_trabajadas, f.horas_extra, f.sueldo_base, f.tarifa_hora, f.pago_horas, f.bonificaciones, f.descuentos, f.total]
      );
    }
    await pool.query(`UPDATE periodos_nomina SET estado='calculado', calculado=NOW() WHERE id=${ph(1)}`, [periodoRow.id]);
    res.json({ ok: true, estado: 'calculado' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/nomina/periodos/:periodo/aprobar', requirePermiso('personal'), async (req, res) => {
  try {
    const { periodo } = req.params;
    const { rows } = await pool.query(
      `SELECT * FROM periodos_nomina WHERE negocio_id=${ph(1)} AND periodo=${ph(2)} LIMIT 1`,
      [req.user.negocio_id, periodo]
    );
    const periodoRow = rows[0];
    if (!periodoRow || periodoRow.estado !== 'calculado') return res.status(400).json({ error: 'Primero debes calcular el período' });
    await pool.query(`UPDATE nomina_detalle SET aprobado=1 WHERE periodo_id=${ph(1)}`, [periodoRow.id]);
    await pool.query(`UPDATE periodos_nomina SET estado='aprobado', aprobado=NOW() WHERE id=${ph(1)}`, [periodoRow.id]);
    res.json({ ok: true, estado: 'aprobado' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Deshace el cálculo — solo mientras el período sigue en 'calculado' (aún no
// se generaron gastos ni comprobantes), para poder recalcular tras corregir
// datos de un empleado.
router.post('/nomina/periodos/:periodo/reabrir', requirePermiso('personal'), async (req, res) => {
  try {
    const { periodo } = req.params;
    const { rows } = await pool.query(
      `SELECT * FROM periodos_nomina WHERE negocio_id=${ph(1)} AND periodo=${ph(2)} LIMIT 1`,
      [req.user.negocio_id, periodo]
    );
    const periodoRow = rows[0];
    if (!periodoRow || periodoRow.estado !== 'calculado') return res.status(400).json({ error: 'Solo se puede reabrir un período que esté en estado calculado' });
    await pool.query(`DELETE FROM nomina_detalle WHERE periodo_id=${ph(1)}`, [periodoRow.id]);
    await pool.query(`UPDATE periodos_nomina SET estado='abierto', calculado=NULL WHERE id=${ph(1)}`, [periodoRow.id]);
    res.json({ ok: true, estado: 'abierto' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/nomina/detalle/:id/aprobar', requirePermiso('personal'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*, p.estado AS periodo_estado FROM nomina_detalle d
       JOIN periodos_nomina p ON p.id = d.periodo_id
       WHERE d.id=${ph(1)} AND d.negocio_id=${ph(2)} LIMIT 1`,
      [req.params.id, req.user.negocio_id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Registro no encontrado' });
    if (rows[0].periodo_estado !== 'calculado') return res.status(400).json({ error: 'El período no está en estado calculado' });
    await pool.query(`UPDATE nomina_detalle SET aprobado=1 WHERE id=${ph(1)}`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/nomina/periodos/:periodo/pagar', requirePermiso('personal'), async (req, res) => {
  try {
    const { periodo } = req.params;
    const { rows } = await pool.query(
      `SELECT * FROM periodos_nomina WHERE negocio_id=${ph(1)} AND periodo=${ph(2)} LIMIT 1`,
      [req.user.negocio_id, periodo]
    );
    const periodoRow = rows[0];
    if (!periodoRow || periodoRow.estado !== 'aprobado') return res.status(400).json({ error: 'Primero debes aprobar el período' });

    const { rows: detalle } = await pool.query(
      `SELECT d.*, u.nombre FROM nomina_detalle d JOIN usuarios u ON u.id=d.usuario_id WHERE d.periodo_id=${ph(1)}`,
      [periodoRow.id]
    );

    let { rows: catRows } = await pool.query(
      `SELECT id FROM gasto_categorias WHERE negocio_id=${ph(1)} AND nombre='Nómina' LIMIT 1`,
      [req.user.negocio_id]
    );
    let categoriaId = catRows[0] ? catRows[0].id : null;
    if (!categoriaId) {
      categoriaId = uuid();
      await pool.query(
        `INSERT INTO gasto_categorias (id, negocio_id, nombre, color) VALUES (${ph(1)},${ph(2)},'Nómina','#0B8457')`,
        [categoriaId, req.user.negocio_id]
      );
    }
    // Si un intento anterior se interrumpió a la mitad (ej. el servidor se
    // reinició), el comprobante ya generado marca qué empleados ya recibieron
    // su gasto — se saltan para no duplicarlo al reintentar "Marcar como pagado".
    let yaComprobadosSet = new Set();
    if (detalle.length) {
      const { rows: yaComprobados } = await pool.query(
        `SELECT nomina_detalle_id FROM comprobante_pago WHERE nomina_detalle_id IN (${detalle.map((_, i) => ph(i + 1)).join(',')})`,
        detalle.map(d => d.id)
      );
      yaComprobadosSet = new Set(yaComprobados.map(r => r.nomina_detalle_id));
    }

    const hoy = localDate();
    for (const d of detalle) {
      if (yaComprobadosSet.has(d.id)) continue;
      await pool.query(
        `INSERT INTO comprobante_pago (id, nomina_detalle_id) VALUES (${ph(1)},${ph(2)})`,
        [uuid(), d.id]
      );
      await pool.query(
        `INSERT INTO gastos (id, negocio_id, categoria_id, descripcion, monto, metodo_pago, fecha)
         VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},'transferencia',${ph(6)})`,
        [uuid(), req.user.negocio_id, categoriaId, `Nómina ${d.nombre} — ${periodo}`, d.neto_pagar, hoy]
      );
    }
    await pool.query(`UPDATE periodos_nomina SET estado='pagado', pagado=NOW() WHERE id=${ph(1)}`, [periodoRow.id]);
    res.json({ ok: true, estado: 'pagado' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/nomina/detalle/:id/comprobante', requirePermiso('personal'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*, u.nombre, u.numero_empleado, u.documento, u.cargo, u.fecha_inicio AS fecha_ingreso, u.tipo_contrato,
              p.periodo, p.estado AS periodo_estado, p.pagado AS fecha_pagado,
              n.nombre AS negocio_nombre, n.nit AS negocio_nit, n.direccion AS negocio_direccion, n.ciudad AS negocio_ciudad
       FROM nomina_detalle d
       JOIN usuarios u ON u.id = d.usuario_id
       JOIN periodos_nomina p ON p.id = d.periodo_id
       JOIN negocios n ON n.id = d.negocio_id
       WHERE d.id=${ph(1)} AND d.negocio_id=${ph(2)} LIMIT 1`,
      [req.params.id, req.user.negocio_id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Comprobante no encontrado' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/nomina/ajustes', requirePermiso('personal'), async (req, res) => {
  try {
    const { usuario_id, periodo } = req.query;
    let sql = `SELECT * FROM nomina_ajustes WHERE negocio_id=${ph(1)}`;
    const params = [req.user.negocio_id];
    if (usuario_id) { params.push(usuario_id); sql += ` AND usuario_id=${ph(params.length)}`; }
    if (periodo) { params.push(periodo); sql += ` AND periodo=${ph(params.length)}`; }
    sql += ' ORDER BY creado DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/nomina/ajustes', requirePermiso('personal'), async (req, res) => {
  try {
    const { usuario_id, periodo, tipo, concepto, monto } = req.body;
    if (!usuario_id || !periodo || !tipo || !concepto) return res.status(400).json({ error: 'Faltan datos' });
    if (!['bonificacion', 'descuento'].includes(tipo)) return res.status(400).json({ error: 'Tipo no válido' });
    const montoNum = parseFloat(monto);
    if (!montoNum || montoNum <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a cero' });

    const { rows: periodoRows } = await pool.query(
      `SELECT estado FROM periodos_nomina WHERE negocio_id=${ph(1)} AND periodo=${ph(2)} LIMIT 1`,
      [req.user.negocio_id, periodo]
    );
    if (periodoRows[0] && periodoRows[0].estado !== 'abierto') return res.status(400).json({ error: 'Este período ya fue cerrado, no se pueden agregar ajustes' });

    const id = uuid();
    await pool.query(
      `INSERT INTO nomina_ajustes (id,negocio_id,usuario_id,periodo,tipo,concepto,monto)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)})`,
      [id, req.user.negocio_id, usuario_id, periodo, tipo, concepto.trim(), montoNum]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/nomina/ajustes/:id', requirePermiso('personal'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM nomina_ajustes WHERE id=${ph(1)} AND negocio_id=${ph(2)}`, [req.params.id, req.user.negocio_id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
