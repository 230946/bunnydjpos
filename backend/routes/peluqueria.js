/**
 * routes/peluqueria.js — Módulo Peluquería / Estética completo
 */
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { pool, ph } = require('../db');
const { authMiddleware } = require('../middleware/auth');

// ── Ruta pública: portal del empleado (sin auth) ─────────────────
router.get('/portal-empleado/:id', async (req, res) => {
  try {
    const empId = String(req.params.id);
    const cedulaIngresada = req.query.cedula ? String(req.query.cedula).trim() : null;

    const { rows: empR } = await pool.query(
      `SELECT id, negocio_id, nombre, apellido, cedula, cargo, especialidad
       FROM pel_empleados WHERE BINARY id=? AND activo=1 LIMIT 1`, [empId]
    );
    if (!empR[0]) return res.status(404).json({ error: 'Empleado no encontrado' });

    // Sin cédula → solo indicar que existe y pedir auth
    if (!cedulaIngresada) {
      return res.status(401).json({ requiresAuth: true, nombre: empR[0].nombre });
    }
    // Cédula incorrecta
    if (!empR[0].cedula || empR[0].cedula.trim() !== cedulaIngresada) {
      return res.status(403).json({ error: 'Cédula incorrecta' });
    }
    const e = empR[0];

    const DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const { rows: horarios } = await pool.query(
      `SELECT dia_semana, hora_entrada, hora_salida FROM horarios
       WHERE BINARY empleado_pel_id=? AND activo=1
         AND (fecha IS NULL OR fecha >= CURDATE())
       ORDER BY dia_semana`, [e.id]
    );

    const { rows: citasHoy } = await pool.query(
      `SELECT c.id, c.fecha_hora, c.duracion_min, c.estado, c.notas,
              COALESCE(
                (SELECT GROUP_CONCAT(cd.nombre ORDER BY cd.id SEPARATOR ' · ')
                 FROM pel_cita_detalle cd WHERE cd.cita_id=c.id),
                s.nombre
              ) AS servicio_nombre,
              COALESCE(cl.nombre, c.cliente_nombre)   AS cliente_nombre,
              COALESCE(cl.apellido, '')                AS cliente_apellido
       FROM pel_citas c
       LEFT JOIN pel_servicios s ON BINARY s.id = BINARY c.servicio_id
       LEFT JOIN pel_clientes cl ON BINARY cl.id = BINARY c.cliente_id
       WHERE (BINARY c.empleado_id=? OR BINARY c.empleado_nombre=?)
         AND DATE(c.fecha_hora)=CURDATE()
         AND c.estado NOT IN ('Cancelada','NoAsistio')
       ORDER BY c.fecha_hora`, [e.id, e.nombre]
    );

    const { rows: proximas } = await pool.query(
      `SELECT c.id, c.fecha_hora, c.duracion_min, c.estado, c.notas,
              COALESCE(
                (SELECT GROUP_CONCAT(cd.nombre ORDER BY cd.id SEPARATOR ' · ')
                 FROM pel_cita_detalle cd WHERE cd.cita_id=c.id),
                s.nombre
              ) AS servicio_nombre,
              COALESCE(cl.nombre, c.cliente_nombre)   AS cliente_nombre,
              COALESCE(cl.apellido, '')                AS cliente_apellido
       FROM pel_citas c
       LEFT JOIN pel_servicios s ON BINARY s.id = BINARY c.servicio_id
       LEFT JOIN pel_clientes cl ON BINARY cl.id = BINARY c.cliente_id
       WHERE (BINARY c.empleado_id=? OR BINARY c.empleado_nombre=?)
         AND DATE(c.fecha_hora)>CURDATE()
         AND DATE(c.fecha_hora)<=DATE_ADD(CURDATE(), INTERVAL 7 DAY)
         AND c.estado NOT IN ('Cancelada','NoAsistio')
       ORDER BY c.fecha_hora LIMIT 30`, [e.id, e.nombre]
    );

    res.json({
      empleado: { ...e, dias: DIAS },
      horarios: horarios.map(h => ({ ...h, dia_nombre: DIAS[h.dia_semana] || h.dia_semana })),
      citasHoy: citasHoy.map(c => ({ ...c, fecha_hora: toISO(c.fecha_hora) })),
      proximas: proximas.map(c => ({ ...c, fecha_hora: toISO(c.fecha_hora) })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Ruta pública: portal del empleado por negocio + cédula ────────
router.get('/portal-negocio/:negocio_id', async (req, res) => {
  try {
    const negocioId = String(req.params.negocio_id);
    const cedulaIngresada = req.query.cedula ? String(req.query.cedula).trim() : null;

    if (!cedulaIngresada) {
      return res.status(401).json({ requiresAuth: true });
    }

    const { rows: empR } = await pool.query(
      `SELECT id, negocio_id, nombre, apellido, cedula, cargo, especialidad
       FROM pel_empleados WHERE negocio_id=? AND TRIM(cedula)=TRIM(?) AND activo=1 LIMIT 1`,
      [negocioId, cedulaIngresada]
    );
    if (!empR[0]) return res.status(403).json({ error: 'Cédula no encontrada. Verifica el código de negocio y tu número de cédula.' });
    const e = empR[0];

    const DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const { rows: horarios } = await pool.query(
      `SELECT dia_semana, hora_entrada, hora_salida FROM horarios
       WHERE BINARY empleado_pel_id=? AND activo=1
         AND (fecha IS NULL OR fecha >= CURDATE())
       ORDER BY dia_semana`, [e.id]
    );
    const { rows: citasHoy } = await pool.query(
      `SELECT c.id, c.fecha_hora, c.duracion_min, c.estado, c.notas,
              COALESCE(
                (SELECT GROUP_CONCAT(cd.nombre ORDER BY cd.id SEPARATOR ' · ')
                 FROM pel_cita_detalle cd WHERE cd.cita_id=c.id),
                s.nombre
              ) AS servicio_nombre,
              COALESCE(cl.nombre, c.cliente_nombre)   AS cliente_nombre,
              COALESCE(cl.apellido, '')                AS cliente_apellido
       FROM pel_citas c
       LEFT JOIN pel_servicios s ON BINARY s.id = BINARY c.servicio_id
       LEFT JOIN pel_clientes cl ON BINARY cl.id = BINARY c.cliente_id
       WHERE (BINARY c.empleado_id=? OR BINARY c.empleado_nombre=?)
         AND DATE(c.fecha_hora)=CURDATE()
         AND c.estado NOT IN ('Cancelada','NoAsistio')
       ORDER BY c.fecha_hora`, [e.id, e.nombre]
    );
    const { rows: proximas } = await pool.query(
      `SELECT c.id, c.fecha_hora, c.duracion_min, c.estado, c.notas,
              COALESCE(
                (SELECT GROUP_CONCAT(cd.nombre ORDER BY cd.id SEPARATOR ' · ')
                 FROM pel_cita_detalle cd WHERE cd.cita_id=c.id),
                s.nombre
              ) AS servicio_nombre,
              COALESCE(cl.nombre, c.cliente_nombre)   AS cliente_nombre,
              COALESCE(cl.apellido, '')                AS cliente_apellido
       FROM pel_citas c
       LEFT JOIN pel_servicios s ON BINARY s.id = BINARY c.servicio_id
       LEFT JOIN pel_clientes cl ON BINARY cl.id = BINARY c.cliente_id
       WHERE (BINARY c.empleado_id=? OR BINARY c.empleado_nombre=?)
         AND DATE(c.fecha_hora)>CURDATE()
         AND DATE(c.fecha_hora)<=DATE_ADD(CURDATE(), INTERVAL 7 DAY)
         AND c.estado NOT IN ('Cancelada','NoAsistio')
       ORDER BY c.fecha_hora LIMIT 30`, [e.id, e.nombre]
    );
    res.json({
      empleado: { ...e, dias: DIAS },
      horarios: horarios.map(h => ({ ...h, dia_nombre: DIAS[h.dia_semana] || h.dia_semana })),
      citasHoy: citasHoy.map(c => ({ ...c, fecha_hora: toISO(c.fecha_hora) })),
      proximas: proximas.map(c => ({ ...c, fecha_hora: toISO(c.fecha_hora) })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RUTAS PÚBLICAS: PORTAL DE RESERVAS ───────────────────────────

function calcSlots(horario, citas, dur) {
  const parseMin = t => { const [h,m]=(t||'08:00').split(':').map(Number); return h*60+m; };
  const minEntrada = parseMin(horario.hora_entrada);
  const minSalida  = parseMin(horario.hora_salida);
  const bloqueados = new Set();
  for (const c of citas) {
    const d = new Date(String(c.fecha_hora).replace(' ','T'));
    const start = d.getHours()*60 + d.getMinutes();
    const end   = start + (parseInt(c.duracion_min)||30);
    for (let m = start; m < end; m += 30) bloqueados.add(m);
  }
  const slots = [];
  for (let m = minEntrada; m + dur <= minSalida; m += 30) {
    let ok = true;
    for (let b = m; b < m + dur; b += 30) { if (bloqueados.has(b)){ok=false;break;} }
    if (ok) {
      slots.push(`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`);
    }
  }
  return slots;
}

router.get('/booking/:negocioId/info', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT nombre, telefono, direccion, ciudad, email, logo_url FROM negocios WHERE id=? AND activo=1 LIMIT 1`,
      [req.params.negocioId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Negocio no encontrado' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/booking/:negocioId/servicios', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, descripcion, precio, duracion_min FROM pel_servicios
       WHERE negocio_id=? AND activo=1 ORDER BY nombre`,
      [req.params.negocioId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/booking/:negocioId/empleados', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, apellido, cargo, especialidad FROM pel_empleados
       WHERE negocio_id=? AND activo=1 ORDER BY nombre`,
      [req.params.negocioId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/booking/:negocioId/disponibilidad', async (req, res) => {
  try {
    const { negocioId } = req.params;
    const { fecha, empleadoId, duracion = 30 } = req.query;
    if (!fecha) return res.status(400).json({ error: 'fecha requerida' });
    const dur = parseInt(duracion) || 30;
    const dia = new Date(fecha + 'T12:00:00').getDay();

    if (empleadoId) {
      const { rows: hors } = await pool.query(
        `SELECT h.hora_entrada, h.hora_salida, e.nombre, e.apellido
         FROM horarios h JOIN pel_empleados e ON e.id=h.empleado_pel_id
         WHERE h.empleado_pel_id=? AND h.dia_semana=? AND h.activo=1 LIMIT 1`,
        [empleadoId, dia]
      );
      if (!hors[0]) return res.json({ slots: [] });
      const { rows: citas } = await pool.query(
        `SELECT fecha_hora, duracion_min FROM pel_citas
         WHERE empleado_id=? AND DATE(fecha_hora)=? AND estado NOT IN ('Cancelada','NoAsistio')`,
        [empleadoId, fecha]
      );
      const empNombre = `${hors[0].nombre||''} ${hors[0].apellido||''}`.trim();
      const slots = calcSlots(hors[0], citas, dur).map(hora => ({
        hora, empleados: [{ id: empleadoId, nombre: empNombre }]
      }));
      return res.json({ slots });
    }

    // Cualquier empleado: filtrar por negocio via pel_empleados (horarios.negocio_id puede ser NULL)
    const { rows: hors } = await pool.query(
      `SELECT h.hora_entrada, h.hora_salida, h.empleado_pel_id, e.nombre, e.apellido
       FROM horarios h JOIN pel_empleados e ON e.id=h.empleado_pel_id
       WHERE e.negocio_id=? AND h.dia_semana=? AND h.activo=1 AND e.activo=1`,
      [negocioId, dia]
    );
    if (!hors.length) return res.json({ slots: [] });
    const slotMap = new Map();
    for (const h of hors) {
      const { rows: citas } = await pool.query(
        `SELECT fecha_hora, duracion_min FROM pel_citas
         WHERE empleado_id=? AND DATE(fecha_hora)=? AND estado NOT IN ('Cancelada','NoAsistio')`,
        [h.empleado_pel_id, fecha]
      );
      const empNombre = `${h.nombre||''} ${h.apellido||''}`.trim();
      for (const s of calcSlots(h, citas, dur)) {
        if (!slotMap.has(s)) slotMap.set(s, []);
        slotMap.get(s).push({ id: h.empleado_pel_id, nombre: empNombre });
      }
    }
    const slots = [...slotMap.entries()]
      .sort((a,b) => a[0].localeCompare(b[0]))
      .map(([hora, empleados]) => ({ hora, empleados }));
    res.json({ slots });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/booking/:negocioId/reservar', async (req, res) => {
  try {
    const { negocioId } = req.params;
    const { clienteNombre, clienteTelefono, servicios = [], empleadoId, fechaHora, notas } = req.body;
    if (!clienteNombre || !fechaHora || !servicios.length)
      return res.status(400).json({ error: 'Datos incompletos' });
    const { rows: ng } = await pool.query(
      `SELECT id FROM negocios WHERE id=? AND activo=1 LIMIT 1`, [negocioId]
    );
    if (!ng[0]) return res.status(404).json({ error: 'Negocio no encontrado' });
    const fh = String(fechaHora).replace('T',' ').replace('Z','').split('.')[0];
    const totalPrecio   = servicios.reduce((a,s) => a + parseFloat(s.precio||0), 0);
    const duracionTotal = servicios.reduce((a,s) => a + parseInt(s.duracion_min||30), 0) || 30;
    const id = uuid();
    let empNombre = null;
    if (empleadoId) {
      const { rows: er } = await pool.query(
        `SELECT nombre FROM pel_empleados WHERE id=? AND negocio_id=? AND activo=1 LIMIT 1`,
        [empleadoId, negocioId]
      );
      if (!er[0]) return res.status(404).json({ error: 'Empleado no encontrado' });
      empNombre = er[0].nombre;
    }
    await pool.query(
      `INSERT INTO pel_citas (id,negocio_id,cliente_nombre,cliente_tel,empleado_id,empleado_nombre,
       precio,fecha_hora,duracion_min,notas,estado) VALUES (?,?,?,?,?,?,?,?,?,?,'Pendiente')`,
      [id, negocioId, clienteNombre, clienteTelefono||null, empleadoId||null, empNombre,
       totalPrecio, fh, duracionTotal, notas||null]
    );
    for (const s of servicios) {
      await pool.query(
        `INSERT INTO pel_cita_detalle (id,cita_id,servicio_id,nombre,precio) VALUES (?,?,?,?,?)`,
        [uuid(), id, s.id||null, s.nombre, parseFloat(s.precio||0)]
      );
    }
    res.status(201).json({ id, mensaje: '¡Reserva creada! Te esperamos.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.use(authMiddleware);
const nid = req => req.user.negocio_id;

const toISO = v => {
  if (!v) return null;
  if (v instanceof Date) {
    const pad = n => String(n).padStart(2,'0');
    return `${v.getFullYear()}-${pad(v.getMonth()+1)}-${pad(v.getDate())}T${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  }
  return String(v).replace(' ', 'T');
};
const localDate = () => {
  const d = new Date(Date.now() - 5*60*60*1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
};
const localDateTime = () => {
  const d = new Date(Date.now() - 5*60*60*1000);
  const p = n => String(n).padStart(2,'0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
};

// ── Auto-migración ────────────────────────────────────────────────
async function _ddl(sql) {
  try { await pool.query(sql); } catch (e) { console.error('pel DDL:', e.message); }
}

(async () => {
  // Categorías de servicio
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_categorias_servicio (
    id          VARCHAR(36)  PRIMARY KEY,
    negocio_id  VARCHAR(36)  NOT NULL,
    nombre      VARCHAR(80)  NOT NULL,
    INDEX idx_neg (negocio_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Servicios
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_servicios (
    id            VARCHAR(36)    PRIMARY KEY,
    negocio_id    VARCHAR(36)    NOT NULL,
    categoria_id  VARCHAR(36)    NULL,
    nombre        VARCHAR(120)   NOT NULL,
    descripcion   TEXT,
    precio        DECIMAL(12,2)  NOT NULL DEFAULT 0,
    duracion_min  INT            NOT NULL DEFAULT 30,
    activo        TINYINT(1)     NOT NULL DEFAULT 1,
    creado        DATETIME       DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_neg (negocio_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Empleados
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_empleados (
    id              VARCHAR(36)   PRIMARY KEY,
    negocio_id      VARCHAR(36)   NOT NULL,
    nombre          VARCHAR(120)  NOT NULL,
    apellido        VARCHAR(100),
    cargo           VARCHAR(50),
    especialidad    VARCHAR(100),
    telefono        VARCHAR(30),
    email           VARCHAR(150),
    tipo_comision   ENUM('porcentaje','fijo','ninguna') NOT NULL DEFAULT 'ninguna',
    pct_comision    DECIMAL(5,2)  NOT NULL DEFAULT 0,
    monto_comision  DECIMAL(10,2) NOT NULL DEFAULT 0,
    activo          TINYINT(1)    NOT NULL DEFAULT 1,
    creado          DATETIME      DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_neg (negocio_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Comisiones config por empleado/servicio
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_comisiones_config (
    id           VARCHAR(36)  PRIMARY KEY,
    negocio_id   VARCHAR(36)  NOT NULL,
    empleado_id  VARCHAR(36)  NOT NULL,
    servicio_id  VARCHAR(36)  NULL,
    pct_comision DECIMAL(5,2) NOT NULL DEFAULT 0,
    INDEX idx_neg_emp (negocio_id, empleado_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Clientes
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_clientes (
    id               VARCHAR(36)  PRIMARY KEY,
    negocio_id       VARCHAR(36)  NOT NULL,
    nombre           VARCHAR(100) NOT NULL,
    apellido         VARCHAR(100),
    telefono         VARCHAR(30),
    email            VARCHAR(150),
    fecha_nacimiento DATE         NULL,
    notas            TEXT,
    activo           TINYINT(1)   NOT NULL DEFAULT 1,
    creado           DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_neg (negocio_id),
    INDEX idx_tel (telefono),
    INDEX idx_nombre (nombre)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Citas
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_citas (
    id              VARCHAR(36)   PRIMARY KEY,
    negocio_id      VARCHAR(36)   NOT NULL,
    cliente_id      VARCHAR(36)   NULL,
    cliente_nombre  VARCHAR(120)  NOT NULL,
    cliente_tel     VARCHAR(30),
    empleado_id     VARCHAR(36)   NULL,
    empleado_nombre VARCHAR(80),
    fecha_hora      DATETIME      NOT NULL,
    duracion_min    INT           NOT NULL DEFAULT 30,
    estado          VARCHAR(20)   NOT NULL DEFAULT 'Pendiente',
    notas           TEXT,
    venta_id        VARCHAR(36)   NULL,
    precio          DECIMAL(12,2) NOT NULL DEFAULT 0,
    metodo_pago     VARCHAR(30),
    servicio_id     VARCHAR(36)   NULL,
    servicio_nombre VARCHAR(120),
    creado          DATETIME      DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_neg_fecha (negocio_id, fecha_hora),
    INDEX idx_neg_estado (negocio_id, estado)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Detalle de cita (multi-servicio)
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_cita_detalle (
    id          VARCHAR(36)   PRIMARY KEY,
    cita_id     VARCHAR(36)   NOT NULL,
    servicio_id VARCHAR(36)   NOT NULL,
    nombre      VARCHAR(120)  NOT NULL,
    precio      DECIMAL(12,2) NOT NULL DEFAULT 0,
    INDEX idx_cita (cita_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Cajas
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_cajas (
    id                 VARCHAR(36)    PRIMARY KEY,
    negocio_id         VARCHAR(36)    NOT NULL,
    usuario_apertura   VARCHAR(36)    NOT NULL,
    usuario_cierre     VARCHAR(36)    NULL,
    fecha_apertura     DATETIME       NOT NULL,
    fecha_cierre       DATETIME       NULL,
    monto_inicial      DECIMAL(12,2)  NOT NULL DEFAULT 0,
    monto_final_real   DECIMAL(12,2)  NULL,
    monto_final_calc   DECIMAL(12,2)  NULL,
    diferencia         DECIMAL(12,2)  NULL,
    estado             ENUM('abierta','cerrada') NOT NULL DEFAULT 'abierta',
    observaciones      TEXT,
    INDEX idx_neg_estado (negocio_id, estado)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Movimientos de caja (gastos, retiros, aportes)
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_movimientos_caja (
    id          VARCHAR(36)   PRIMARY KEY,
    negocio_id  VARCHAR(36)   NOT NULL,
    caja_id     VARCHAR(36)   NOT NULL,
    tipo        ENUM('ingreso','egreso') NOT NULL,
    concepto    VARCHAR(150)  NOT NULL,
    monto       DECIMAL(12,2) NOT NULL,
    usuario_id  VARCHAR(36)   NULL,
    creado      DATETIME      DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_caja (caja_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Ventas
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_ventas (
    id           VARCHAR(36)   PRIMARY KEY,
    negocio_id   VARCHAR(36)   NOT NULL,
    caja_id      VARCHAR(36)   NULL,
    cliente_id   VARCHAR(36)   NULL,
    empleado_id  VARCHAR(36)   NULL,
    usuario_id   VARCHAR(36)   NULL,
    fecha        DATETIME      DEFAULT CURRENT_TIMESTAMP,
    subtotal     DECIMAL(12,2) NOT NULL DEFAULT 0,
    descuento    DECIMAL(12,2) NOT NULL DEFAULT 0,
    total        DECIMAL(12,2) NOT NULL DEFAULT 0,
    estado       ENUM('completada','anulada') NOT NULL DEFAULT 'completada',
    notas        TEXT,
    INDEX idx_neg_fecha (negocio_id, fecha)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Detalle de venta
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_venta_detalle (
    id                  VARCHAR(36)   PRIMARY KEY,
    venta_id            VARCHAR(36)   NOT NULL,
    tipo_item           ENUM('servicio','producto','paquete') NOT NULL DEFAULT 'servicio',
    ref_id              VARCHAR(36)   NULL,
    empleado_id         VARCHAR(36)   NULL,
    cliente_paquete_id  VARCHAR(36)   NULL,
    descripcion         VARCHAR(150)  NOT NULL,
    cantidad            DECIMAL(10,2) NOT NULL DEFAULT 1,
    precio_unitario     DECIMAL(12,2) NOT NULL,
    descuento           DECIMAL(12,2) NOT NULL DEFAULT 0,
    subtotal            DECIMAL(12,2) NOT NULL,
    INDEX idx_venta (venta_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Pagos de venta (múltiples métodos)
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_venta_pagos (
    id          VARCHAR(36)   PRIMARY KEY,
    venta_id    VARCHAR(36)   NOT NULL,
    metodo      VARCHAR(50)   NOT NULL DEFAULT 'Efectivo',
    monto       DECIMAL(12,2) NOT NULL,
    referencia  VARCHAR(100),
    INDEX idx_venta (venta_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Comisiones generadas
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_comision_detalle (
    id               VARCHAR(36)   PRIMARY KEY,
    negocio_id       VARCHAR(36)   NOT NULL,
    venta_detalle_id VARCHAR(36)   NOT NULL,
    empleado_id      VARCHAR(36)   NOT NULL,
    base_calculo     DECIMAL(12,2) NOT NULL,
    pct_aplicado     DECIMAL(5,2)  NULL,
    monto_comision   DECIMAL(12,2) NOT NULL,
    estado           ENUM('pendiente','pagada') NOT NULL DEFAULT 'pendiente',
    fecha_pago       DATETIME      NULL,
    INDEX idx_neg_emp_estado (negocio_id, empleado_id, estado)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Proveedores
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_proveedores (
    id         VARCHAR(36)   PRIMARY KEY,
    negocio_id VARCHAR(36)   NOT NULL,
    nombre     VARCHAR(150)  NOT NULL,
    telefono   VARCHAR(30),
    email      VARCHAR(150),
    activo     TINYINT(1)    NOT NULL DEFAULT 1,
    creado     DATETIME      DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_neg (negocio_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Categorías de producto
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_categorias_producto (
    id         VARCHAR(36)  PRIMARY KEY,
    negocio_id VARCHAR(36)  NOT NULL,
    nombre     VARCHAR(80)  NOT NULL,
    INDEX idx_neg (negocio_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Productos
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_productos (
    id             VARCHAR(36)   PRIMARY KEY,
    negocio_id     VARCHAR(36)   NOT NULL,
    categoria_id   VARCHAR(36)   NULL,
    proveedor_id   VARCHAR(36)   NULL,
    sku            VARCHAR(50),
    nombre         VARCHAR(150)  NOT NULL,
    descripcion    VARCHAR(255),
    precio_costo   DECIMAL(12,2) NOT NULL DEFAULT 0,
    precio_venta   DECIMAL(12,2) NOT NULL DEFAULT 0,
    stock_actual   INT           NOT NULL DEFAULT 0,
    stock_minimo   INT           NOT NULL DEFAULT 0,
    unidad         VARCHAR(20)   NOT NULL DEFAULT 'unidad',
    activo         TINYINT(1)    NOT NULL DEFAULT 1,
    creado         DATETIME      DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_neg (negocio_id),
    INDEX idx_nombre (nombre)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Movimientos de inventario de productos
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_movimientos_inv (
    id          VARCHAR(36)   PRIMARY KEY,
    negocio_id  VARCHAR(36)   NOT NULL,
    producto_id VARCHAR(36)   NOT NULL,
    tipo        ENUM('entrada','salida_venta','ajuste','devolucion','merma') NOT NULL,
    cantidad    INT           NOT NULL,
    referencia_id VARCHAR(36) NULL,
    motivo      VARCHAR(255),
    usuario_id  VARCHAR(36)   NULL,
    creado      DATETIME      DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_neg_prod (negocio_id, producto_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Paquetes / membresías
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_paquetes (
    id             VARCHAR(36)   PRIMARY KEY,
    negocio_id     VARCHAR(36)   NOT NULL,
    nombre         VARCHAR(120)  NOT NULL,
    descripcion    VARCHAR(255),
    precio         DECIMAL(12,2) NOT NULL DEFAULT 0,
    tipo           ENUM('sesiones','tiempo_ilimitado') NOT NULL DEFAULT 'sesiones',
    vigencia_dias  INT           NOT NULL DEFAULT 30,
    activo         TINYINT(1)    NOT NULL DEFAULT 1,
    creado         DATETIME      DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_neg (negocio_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Servicios dentro de un paquete
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_paquete_servicios (
    id                VARCHAR(36) PRIMARY KEY,
    paquete_id        VARCHAR(36) NOT NULL,
    servicio_id       VARCHAR(36) NOT NULL,
    cantidad_incluida INT         NOT NULL DEFAULT 1,
    INDEX idx_paquete (paquete_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Paquetes comprados por clientes
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_cliente_paquetes (
    id                VARCHAR(36)  PRIMARY KEY,
    negocio_id        VARCHAR(36)  NOT NULL,
    cliente_id        VARCHAR(36)  NOT NULL,
    paquete_id        VARCHAR(36)  NOT NULL,
    venta_id          VARCHAR(36)  NULL,
    fecha_compra      DATETIME     DEFAULT CURRENT_TIMESTAMP,
    fecha_vencimiento DATE         NOT NULL,
    estado            ENUM('activo','agotado','vencido','cancelado') NOT NULL DEFAULT 'activo',
    INDEX idx_neg_cli (negocio_id, cliente_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Saldo de sesiones por servicio en cada paquete del cliente
  await _ddl(`CREATE TABLE IF NOT EXISTS pel_cliente_paquete_saldo (
    id                 VARCHAR(36) PRIMARY KEY,
    cliente_paquete_id VARCHAR(36) NOT NULL,
    servicio_id        VARCHAR(36) NOT NULL,
    cantidad_total     INT         NOT NULL DEFAULT 0,
    cantidad_usada     INT         NOT NULL DEFAULT 0,
    INDEX idx_cp (cliente_paquete_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Columnas nuevas en tablas existentes (ALTER IF NOT EXISTS pattern)
  for (const col of [
    `ALTER TABLE pel_empleados ADD COLUMN apellido VARCHAR(100) AFTER nombre`,
    `ALTER TABLE pel_empleados ADD COLUMN cargo VARCHAR(50) AFTER apellido`,
    `ALTER TABLE pel_empleados ADD COLUMN email VARCHAR(150) AFTER telefono`,
    `ALTER TABLE pel_empleados ADD COLUMN tipo_comision ENUM('porcentaje','fijo','ninguna') NOT NULL DEFAULT 'ninguna' AFTER email`,
    `ALTER TABLE pel_empleados ADD COLUMN pct_comision DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER tipo_comision`,
    `ALTER TABLE pel_empleados ADD COLUMN monto_comision DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER pct_comision`,
    `ALTER TABLE pel_empleados ADD COLUMN sueldo_base  DECIMAL(12,2) DEFAULT NULL`,
    `ALTER TABLE pel_empleados ADD COLUMN tarifa_hora  DECIMAL(10,2) DEFAULT NULL`,
    `ALTER TABLE pel_empleados ADD COLUMN cedula VARCHAR(30) NULL AFTER apellido`,
    `ALTER TABLE pel_servicios ADD COLUMN categoria_id VARCHAR(36) NULL AFTER negocio_id`,
    `ALTER TABLE pel_servicios ADD COLUMN duracion_min INT NOT NULL DEFAULT 30`,
    `ALTER TABLE pel_servicios ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1`,
    `ALTER TABLE pel_citas ADD COLUMN cliente_id VARCHAR(36) NULL AFTER negocio_id`,
    `ALTER TABLE pel_citas ADD COLUMN duracion_min INT NOT NULL DEFAULT 30 AFTER fecha_hora`,
    `ALTER TABLE pel_citas ADD COLUMN venta_id VARCHAR(36) NULL AFTER notas`,
  ]) {
    try { await pool.query(col, [], { silent: true }); } catch (_) { /* columna ya existe */ }
  }
})();

// ════════════════════════════════════════════════════════════════
// CATEGORÍAS DE SERVICIO
// ════════════════════════════════════════════════════════════════

router.get('/categorias-servicio', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pel_categorias_servicio WHERE negocio_id=? ORDER BY nombre`, [nid(req)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/categorias-servicio', async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const id = uuid();
    await pool.query(
      `INSERT INTO pel_categorias_servicio (id,negocio_id,nombre) VALUES (?,?,?)`,
      [id, nid(req), nombre]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/categorias-servicio/:id', async (req, res) => {
  try {
    const { nombre } = req.body;
    await pool.query(
      `UPDATE pel_categorias_servicio SET nombre=? WHERE id=? AND negocio_id=?`,
      [nombre, req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/categorias-servicio/:id', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM pel_categorias_servicio WHERE id=? AND negocio_id=?`,
      [req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// SERVICIOS
// ════════════════════════════════════════════════════════════════

router.get('/servicios', async (req, res) => {
  const { soloActivos } = req.query;
  // Intentar con JOIN primero; si falla, caer a query simple
  const attempts = [
    `SELECT s.*, c.nombre AS categoria_nombre FROM pel_servicios s LEFT JOIN pel_categorias_servicio c ON c.id=s.categoria_id WHERE s.negocio_id=? ORDER BY s.nombre`,
    `SELECT * FROM pel_servicios WHERE negocio_id=? ORDER BY nombre`,
  ];
  for (const sql of attempts) {
    try {
      const { rows } = await pool.query(sql, [nid(req)]);
      let result = rows.map(r => ({ ...r, categoria_nombre: r.categoria_nombre || null }));
      if (soloActivos === 'true' && result.length > 0 && 'activo' in result[0]) {
        result = result.filter(r => r.activo);
      }
      return res.json(result);
    } catch (e) {
      console.error('[GET /servicios] attempt failed:', e.message);
    }
  }
  res.status(500).json({ error: 'No se pudo obtener servicios' });
});

router.post('/servicios', async (req, res) => {
  try {
    const { nombre, descripcion, precio, duracionMinutos, categoriaId } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const id = uuid();
    await pool.query(
      `INSERT INTO pel_servicios (id,negocio_id,categoria_id,nombre,descripcion,precio,duracion_min)
       VALUES (?,?,?,?,?,?,?)`,
      [id, nid(req), categoriaId||null, nombre, descripcion||null, precio||0, duracionMinutos||30]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/servicios/:id', async (req, res) => {
  try {
    const { nombre, descripcion, precio, duracionMinutos, categoriaId } = req.body;
    await pool.query(
      `UPDATE pel_servicios SET nombre=?,descripcion=?,precio=?,duracion_min=?,categoria_id=?
       WHERE id=? AND negocio_id=?`,
      [nombre, descripcion||null, precio||0, duracionMinutos||30, categoriaId||null, req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/servicios/:id/toggle', async (req, res) => {
  try {
    await pool.query(
      `UPDATE pel_servicios SET activo = NOT activo WHERE id=? AND negocio_id=?`,
      [req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// EMPLEADOS
// ════════════════════════════════════════════════════════════════

router.get('/empleados', async (req, res) => {
  try {
    const soloActivos = req.query.soloActivos === 'true';
    let sql = `SELECT * FROM pel_empleados WHERE negocio_id=?`;
    if (soloActivos) sql += ' AND activo=1';
    sql += ' ORDER BY nombre';
    const { rows } = await pool.query(sql, [nid(req)]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/empleados', async (req, res) => {
  try {
    const { nombre, apellido, cedula, cargo, especialidad, telefono, email, tipoComision, pctComision, montoComision } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const id = uuid();
    await pool.query(
      `INSERT INTO pel_empleados (id,negocio_id,nombre,apellido,cedula,cargo,especialidad,telefono,email,tipo_comision,pct_comision,monto_comision)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, nid(req), nombre, apellido||null, cedula||null, cargo||null, especialidad||null, telefono||null, email||null,
       tipoComision||'ninguna', pctComision||0, montoComision||0]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/empleados/:id', async (req, res) => {
  try {
    const { nombre, apellido, cedula, cargo, especialidad, telefono, email, tipoComision, pctComision, montoComision, sueldoBase, tarifaHora } = req.body;
    await pool.query(
      `UPDATE pel_empleados SET nombre=?,apellido=?,cedula=?,cargo=?,especialidad=?,telefono=?,email=?,
       tipo_comision=?,pct_comision=?,monto_comision=?,sueldo_base=?,tarifa_hora=?
       WHERE id=? AND negocio_id=?`,
      [nombre, apellido||null, cedula||null, cargo||null, especialidad||null, telefono||null, email||null,
       tipoComision||'ninguna', pctComision||0, montoComision||0,
       sueldoBase||null, tarifaHora||null, req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/empleados/:id/comision', async (req, res) => {
  try {
    const { tipoComision, pctComision, montoComision } = req.body;
    await pool.query(
      `UPDATE pel_empleados SET tipo_comision=?,pct_comision=?,monto_comision=? WHERE id=? AND negocio_id=?`,
      [tipoComision||'ninguna', pctComision||0, montoComision||0, req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/empleados/:id/toggle', async (req, res) => {
  try {
    await pool.query(
      `UPDATE pel_empleados SET activo = NOT activo WHERE id=? AND negocio_id=?`,
      [req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// HORARIOS DE EMPLEADOS (desde POS peluquería)
// ════════════════════════════════════════════════════════════════

router.get('/horarios-empleado/:empleadoId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, dia_semana, hora_entrada, hora_salida FROM horarios
       WHERE empleado_pel_id=? AND negocio_id=? AND activo=1
       ORDER BY dia_semana`,
      [req.params.empleadoId, nid(req)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/horarios-empleado', async (req, res) => {
  try {
    const { empleadoId, diaSemana, horaEntrada, horaSalida } = req.body;
    if (!empleadoId) return res.status(400).json({ error: 'empleadoId requerido' });
    // Desactivar el existente para ese día/empleado
    await pool.query(
      `UPDATE horarios SET activo=0 WHERE empleado_pel_id=? AND negocio_id=? AND dia_semana=? AND activo=1`,
      [empleadoId, nid(req), diaSemana]
    );
    if (horaEntrada && horaSalida) {
      const id = uuid();
      await pool.query(
        `INSERT INTO horarios (id,empleado_pel_id,negocio_id,dia_semana,hora_entrada,hora_salida)
         VALUES (?,?,?,?,?,?)`,
        [id, empleadoId, nid(req), diaSemana, horaEntrada, horaSalida]
      );
      return res.status(201).json({ id });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// COMISIONES CONFIG
// ════════════════════════════════════════════════════════════════

router.get('/comisiones-config/:empleadoId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cc.*, s.nombre AS servicio_nombre
       FROM pel_comisiones_config cc
       LEFT JOIN pel_servicios s ON s.id = cc.servicio_id
       WHERE cc.negocio_id=? AND cc.empleado_id=?`,
      [nid(req), req.params.empleadoId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/comisiones-config', async (req, res) => {
  try {
    const { empleadoId, servicioId, pctComision } = req.body;
    if (!empleadoId) return res.status(400).json({ error: 'empleadoId requerido' });
    // Upsert: eliminar anterior si existe misma combinación
    await pool.query(
      `DELETE FROM pel_comisiones_config WHERE negocio_id=? AND empleado_id=? AND servicio_id<=>?`,
      [nid(req), empleadoId, servicioId||null]
    );
    const id = uuid();
    await pool.query(
      `INSERT INTO pel_comisiones_config (id,negocio_id,empleado_id,servicio_id,pct_comision)
       VALUES (?,?,?,?,?)`,
      [id, nid(req), empleadoId, servicioId||null, pctComision||0]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/comisiones-config/:id', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM pel_comisiones_config WHERE id=? AND negocio_id=?`,
      [req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// CLIENTES
// ════════════════════════════════════════════════════════════════

router.get('/clientes', async (req, res) => {
  try {
    const { busqueda, pagina = 1, tamPagina = 30 } = req.query;
    const lim = Math.min(parseInt(tamPagina)||30, 100);
    const off = (Math.max(parseInt(pagina)||1,1)-1)*lim;
    let where = `WHERE c.negocio_id=? AND c.activo=1`;
    const params = [nid(req)];
    if (busqueda) {
      const b = `%${busqueda}%`;
      where += ` AND (c.nombre LIKE ? OR c.apellido LIKE ? OR c.telefono LIKE ?)`;
      params.push(b, b, b);
    }
    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*) AS total FROM pel_clientes c ${where}`, params
    );
    const { rows } = await pool.query(
      `SELECT c.*,
         COUNT(v.id) AS total_visitas,
         MAX(v.fecha) AS ultima_visita,
         COALESCE(SUM(v.total),0) AS gasto_total
       FROM pel_clientes c
       LEFT JOIN pel_ventas v ON v.cliente_id=c.id AND v.negocio_id=c.negocio_id AND v.estado='completada'
       ${where} GROUP BY c.id ORDER BY c.nombre LIMIT ${lim} OFFSET ${off}`,
      params
    );
    res.json({ items: rows, totalCount: parseInt(cnt[0]?.total||0), hasNextPage: off+rows.length < parseInt(cnt[0]?.total||0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/clientes/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pel_clientes WHERE id=? AND negocio_id=?`, [req.params.id, nid(req)]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/clientes', async (req, res) => {
  try {
    const { nombre, apellido, telefono, email, fechaNacimiento, notas } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const id = uuid();
    await pool.query(
      `INSERT INTO pel_clientes (id,negocio_id,nombre,apellido,telefono,email,fecha_nacimiento,notas)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, nid(req), nombre, apellido||null, telefono||null, email||null, fechaNacimiento||null, notas||null]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/clientes/:id', async (req, res) => {
  try {
    const { nombre, apellido, telefono, email, fechaNacimiento, notas } = req.body;
    await pool.query(
      `UPDATE pel_clientes SET nombre=?,apellido=?,telefono=?,email=?,fecha_nacimiento=?,notas=?
       WHERE id=? AND negocio_id=?`,
      [nombre, apellido||null, telefono||null, email||null, fechaNacimiento||null, notas||null, req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/clientes/:id/toggle', async (req, res) => {
  try {
    await pool.query(
      `UPDATE pel_clientes SET activo = NOT activo WHERE id=? AND negocio_id=?`,
      [req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Historial de visitas de un cliente
router.get('/clientes/:id/historial', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT v.*, GROUP_CONCAT(d.descripcion SEPARATOR ', ') AS servicios
       FROM pel_ventas v
       LEFT JOIN pel_venta_detalle d ON d.venta_id=v.id
       WHERE v.negocio_id=? AND v.cliente_id=? AND v.estado='completada'
       GROUP BY v.id ORDER BY v.fecha DESC LIMIT 50`,
      [nid(req), req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// CITAS
// ════════════════════════════════════════════════════════════════

router.get('/citas', async (req, res) => {
  try {
    const { desde, hasta, estado, sinAsignar, pagina = 1, tamPagina = 30 } = req.query;
    const lim = Math.min(parseInt(tamPagina)||30, 100);
    const off = (Math.max(parseInt(pagina)||1,1)-1)*lim;
    let where = `WHERE c.negocio_id=?`;
    const params = [nid(req)];
    if (desde) { params.push(desde.replace('T',' ').split('.')[0]); where += ` AND c.fecha_hora>=?`; }
    if (hasta) { params.push(hasta.replace('T',' ').split('.')[0]); where += ` AND c.fecha_hora<=?`; }
    if (estado) { params.push(estado); where += ` AND c.estado=?`; }
    if (sinAsignar === 'true') { where += ` AND c.empleado_id IS NULL`; }

    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*) AS total FROM pel_citas c ${where}`, params
    );
    const { rows } = await pool.query(
      `SELECT c.* FROM pel_citas c ${where} ORDER BY c.fecha_hora ASC LIMIT ${lim} OFFSET ${off}`,
      params
    );

    // Cargar detalle de servicios por cita
    const citaIds = rows.map(r => r.id);
    let detalles = [];
    if (citaIds.length) {
      const inPh = citaIds.map((_,i)=>`?`).join(',');
      const { rows: dRows } = await pool.query(
        `SELECT * FROM pel_cita_detalle WHERE cita_id IN (${inPh})`, citaIds
      );
      detalles = dRows;
    }

    const items = rows.map(r => ({
      ...r,
      fechaHora: toISO(r.fecha_hora),
      clienteNombre: r.cliente_nombre,
      clienteTelefono: r.cliente_tel,
      empleadoNombre: r.empleado_nombre,
      servicios: detalles.filter(d => d.cita_id === r.id),
    }));
    res.json({ items, totalCount: parseInt(cnt[0]?.total||0), hasNextPage: off+items.length < parseInt(cnt[0]?.total||0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/citas/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pel_citas WHERE id=? AND negocio_id=?`, [req.params.id, nid(req)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Cita no encontrada' });
    const { rows: det } = await pool.query(
      `SELECT * FROM pel_cita_detalle WHERE cita_id=?`, [req.params.id]
    );
    const r = rows[0];
    res.json({ ...r, fechaHora: toISO(r.fecha_hora), clienteNombre: r.cliente_nombre, servicios: det });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/citas', async (req, res) => {
  try {
    const { clienteNombre, clienteTelefono, clienteId, servicios = [], empleadoId, empleadoNombre, fechaHora, notas } = req.body;
    if (!clienteNombre || !fechaHora) return res.status(400).json({ error: 'Cliente y hora requeridos' });
    const fh = String(fechaHora).replace('T',' ').replace('Z','').split('.')[0];
    const totalPrecio = servicios.reduce((a, s) => a + parseFloat(s.precio||0), 0);
    const duracionTotal = servicios.reduce((a, s) => a + parseInt(s.duracion_min||30), 0) || 30;
    const id = uuid();
    // Nombre del empleado si solo tenemos ID
    let empNombre = empleadoNombre || null;
    if (empleadoId && !empNombre) {
      const { rows: er } = await pool.query(`SELECT nombre FROM pel_empleados WHERE id=?`, [empleadoId]);
      empNombre = er[0]?.nombre || null;
    }
    await pool.query(
      `INSERT INTO pel_citas (id,negocio_id,cliente_id,cliente_nombre,cliente_tel,empleado_id,empleado_nombre,
       precio,fecha_hora,duracion_min,notas)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, nid(req), clienteId||null, clienteNombre, clienteTelefono||null,
       empleadoId||null, empNombre, totalPrecio, fh, duracionTotal, notas||null]
    );
    // Insertar detalle de servicios
    for (const s of servicios) {
      await pool.query(
        `INSERT INTO pel_cita_detalle (id,cita_id,servicio_id,nombre,precio) VALUES (?,?,?,?,?)`,
        [uuid(), id, s.id||null, s.nombre, parseFloat(s.precio||0)]
      );
    }
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/citas/:id', async (req, res) => {
  try {
    const { clienteNombre, clienteTelefono, clienteId, servicios = [], empleadoId, empleadoNombre, fechaHora, notas } = req.body;
    const fh = String(fechaHora).replace('T',' ').replace('Z','').split('.')[0];
    const totalPrecio = servicios.reduce((a, s) => a + parseFloat(s.precio||0), 0);
    const duracionTotal = servicios.reduce((a, s) => a + parseInt(s.duracion_min||30), 0) || 30;
    let empNombre = empleadoNombre || null;
    if (empleadoId && !empNombre) {
      const { rows: er } = await pool.query(`SELECT nombre FROM pel_empleados WHERE id=?`, [empleadoId]);
      empNombre = er[0]?.nombre || null;
    }
    await pool.query(
      `UPDATE pel_citas SET cliente_id=?,cliente_nombre=?,cliente_tel=?,empleado_id=?,empleado_nombre=?,
       precio=?,fecha_hora=?,duracion_min=?,notas=? WHERE id=? AND negocio_id=?`,
      [clienteId||null, clienteNombre, clienteTelefono||null, empleadoId||null, empNombre,
       totalPrecio, fh, duracionTotal, notas||null, req.params.id, nid(req)]
    );
    await pool.query(`DELETE FROM pel_cita_detalle WHERE cita_id=?`, [req.params.id]);
    for (const s of servicios) {
      await pool.query(
        `INSERT INTO pel_cita_detalle (id,cita_id,servicio_id,nombre,precio) VALUES (?,?,?,?,?)`,
        [uuid(), req.params.id, s.id||null, s.nombre, parseFloat(s.precio||0)]
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/citas/:id/empleado', async (req, res) => {
  try {
    const { empleadoId } = req.body;
    let empNombre = null;
    if (empleadoId) {
      const { rows } = await pool.query(
        `SELECT nombre FROM pel_empleados WHERE id=? AND negocio_id=? AND activo=1`,
        [empleadoId, nid(req)]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Empleado no encontrado' });
      empNombre = rows[0].nombre;
    }
    await pool.query(
      `UPDATE pel_citas SET empleado_id=?, empleado_nombre=? WHERE id=? AND negocio_id=?`,
      [empleadoId||null, empNombre, req.params.id, nid(req)]
    );
    res.json({ ok: true, empleadoNombre: empNombre });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/citas/:id/estado', async (req, res) => {
  try {
    const { estado } = req.body;
    const estados = ['Pendiente','Confirmada','EnProceso','Completada','Cancelada','NoAsistio'];
    if (!estados.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
    await pool.query(
      `UPDATE pel_citas SET estado=? WHERE id=? AND negocio_id=?`,
      [estado, req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Completar cita → genera venta automáticamente
router.patch('/citas/:id/completar', async (req, res) => {
  try {
    const { metodoPago = 'Efectivo', descuento = 0, pagos = [] } = req.body;
    const { rows: cr } = await pool.query(
      `SELECT c.*, n.negocio_id FROM pel_citas c JOIN pel_citas n ON n.id=c.id WHERE c.id=? AND c.negocio_id=?`,
      [req.params.id, nid(req)]
    );
    // simplificado: obtener la cita directamente
    const { rows: citas } = await pool.query(
      `SELECT * FROM pel_citas WHERE id=? AND negocio_id=?`, [req.params.id, nid(req)]
    );
    if (!citas.length) return res.status(404).json({ error: 'Cita no encontrada' });
    const cita = citas[0];
    const { rows: det } = await pool.query(
      `SELECT * FROM pel_cita_detalle WHERE cita_id=?`, [req.params.id]
    );

    // Obtener caja activa
    const { rows: cajaRows } = await pool.query(
      `SELECT id FROM pel_cajas WHERE negocio_id=? AND estado='abierta' ORDER BY fecha_apertura DESC LIMIT 1`,
      [nid(req)]
    );
    const cajaId = cajaRows[0]?.id || null;

    const subtotal = parseFloat(cita.precio || 0);
    const desc = parseFloat(descuento || 0);
    const total = subtotal - desc;

    const ventaId = uuid();
    await pool.query(
      `INSERT INTO pel_ventas (id,negocio_id,caja_id,cliente_id,empleado_id,subtotal,descuento,total,fecha)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [ventaId, nid(req), cajaId, cita.cliente_id||null, cita.empleado_id||null, subtotal, desc, total, localDateTime()]
    );

    // Insertar pagos
    const pagosReales = pagos.length ? pagos : [{ metodo: metodoPago, monto: total }];
    for (const p of pagosReales) {
      await pool.query(
        `INSERT INTO pel_venta_pagos (id,venta_id,metodo,monto) VALUES (?,?,?,?)`,
        [uuid(), ventaId, p.metodo||metodoPago, parseFloat(p.monto||0)]
      );
    }

    // Insertar detalle de venta y calcular comisiones
    for (const d of det) {
      const detId = uuid();
      const subDet = parseFloat(d.precio||0);
      await pool.query(
        `INSERT INTO pel_venta_detalle (id,venta_id,tipo_item,ref_id,empleado_id,descripcion,cantidad,precio_unitario,descuento,subtotal)
         VALUES (?,?,'servicio',?,?,?,1,?,0,?)`,
        [detId, ventaId, d.servicio_id||null, cita.empleado_id||null, d.nombre, subDet, subDet]
      );

      // Calcular comisión si el empleado tiene configuración
      if (cita.empleado_id) {
        const { rows: emp } = await pool.query(
          `SELECT tipo_comision,pct_comision,monto_comision FROM pel_empleados WHERE id=?`, [cita.empleado_id]
        );
        if (emp.length) {
          // Buscar config específica por servicio
          const { rows: cfg } = await pool.query(
            `SELECT pct_comision FROM pel_comisiones_config
             WHERE negocio_id=? AND empleado_id=? AND (servicio_id=? OR servicio_id IS NULL)
             ORDER BY servicio_id DESC LIMIT 1`,
            [nid(req), cita.empleado_id, d.servicio_id||null]
          );
          const e = emp[0];
          let montoComision = 0;
          let pctAplicado = null;
          if (cfg.length) {
            pctAplicado = parseFloat(cfg[0].pct_comision);
            montoComision = subDet * pctAplicado / 100;
          } else if (e.tipo_comision === 'porcentaje') {
            pctAplicado = parseFloat(e.pct_comision);
            montoComision = subDet * pctAplicado / 100;
          } else if (e.tipo_comision === 'fijo') {
            montoComision = parseFloat(e.monto_comision);
          }
          if (montoComision > 0) {
            await pool.query(
              `INSERT INTO pel_comision_detalle (id,negocio_id,venta_detalle_id,empleado_id,base_calculo,pct_aplicado,monto_comision)
               VALUES (?,?,?,?,?,?,?)`,
              [uuid(), nid(req), detId, cita.empleado_id, subDet, pctAplicado, montoComision]
            );
          }
        }
      }
    }

    // Actualizar cita
    await pool.query(
      `UPDATE pel_citas SET estado='Completada', metodo_pago=?, venta_id=? WHERE id=?`,
      [metodoPago, ventaId, req.params.id]
    );

    res.json({ ok: true, ventaId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// VENTAS (POS directo sin cita previa)
// ════════════════════════════════════════════════════════════════

router.post('/ventas', async (req, res) => {
  try {
    const { clienteId, empleadoId, fecha, items = [], pagos = [], descuento = 0, notas } = req.body;
    if (!items.length) return res.status(400).json({ error: 'Se requiere al menos un ítem' });

    const { rows: cajaRows } = await pool.query(
      `SELECT id FROM pel_cajas WHERE negocio_id=? AND estado='abierta' ORDER BY fecha_apertura DESC LIMIT 1`,
      [nid(req)]
    );
    const cajaId = cajaRows[0]?.id || null;
    const subtotal = items.reduce((a, i) => a + parseFloat(i.precio||0)*parseFloat(i.cantidad||1), 0);
    const desc = parseFloat(descuento||0);
    const total = subtotal - desc;
    const fechaVenta = fecha ? String(fecha).replace('T',' ').replace('Z','').split('.')[0] : localDateTime();

    const ventaId = uuid();
    await pool.query(
      `INSERT INTO pel_ventas (id,negocio_id,caja_id,cliente_id,empleado_id,subtotal,descuento,total,notas,fecha)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [ventaId, nid(req), cajaId, clienteId||null, empleadoId||null, subtotal, desc, total, notas||null, fechaVenta]
    );

    for (const p of (pagos.length ? pagos : [{ metodo: 'Efectivo', monto: total }])) {
      await pool.query(
        `INSERT INTO pel_venta_pagos (id,venta_id,metodo,monto) VALUES (?,?,?,?)`,
        [uuid(), ventaId, p.metodo||'Efectivo', parseFloat(p.monto||0)]
      );
    }

    for (const item of items) {
      const detId = uuid();
      const subDet = parseFloat(item.precio||0)*parseFloat(item.cantidad||1) - parseFloat(item.descuento||0);
      const empItem = item.empleadoId || empleadoId || null;
      await pool.query(
        `INSERT INTO pel_venta_detalle (id,venta_id,tipo_item,ref_id,empleado_id,cliente_paquete_id,descripcion,cantidad,precio_unitario,descuento,subtotal)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [detId, ventaId, item.tipo||'servicio', item.refId||null, empItem,
         item.clientePaqueteId||null, item.descripcion||item.nombre, item.cantidad||1,
         item.precio||0, item.descuento||0, subDet]
      );

      // Descontar stock si es producto
      if (item.tipo === 'producto' && item.refId) {
        await pool.query(
          `UPDATE pel_productos SET stock_actual = stock_actual - ? WHERE id=? AND negocio_id=?`,
          [parseInt(item.cantidad||1), item.refId, nid(req)]
        );
        await pool.query(
          `INSERT INTO pel_movimientos_inv (id,negocio_id,producto_id,tipo,cantidad,referencia_id,motivo)
           VALUES (?,?,?,'salida_venta',?,?,'Venta POS')`,
          [uuid(), nid(req), item.refId, parseInt(item.cantidad||1), ventaId]
        );
      }

      // Canjear sesión de paquete si aplica
      if (item.clientePaqueteId && item.tipo === 'paquete') {
        await pool.query(
          `UPDATE pel_cliente_paquete_saldo SET cantidad_usada = cantidad_usada + 1
           WHERE cliente_paquete_id=? AND servicio_id=?`,
          [item.clientePaqueteId, item.refId||null]
        );
        // Revisar si el paquete se agotó
        const { rows: saldos } = await pool.query(
          `SELECT cantidad_total, cantidad_usada FROM pel_cliente_paquete_saldo WHERE cliente_paquete_id=?`,
          [item.clientePaqueteId]
        );
        const agotado = saldos.every(s => parseInt(s.cantidad_usada) >= parseInt(s.cantidad_total));
        if (agotado) {
          await pool.query(
            `UPDATE pel_cliente_paquetes SET estado='agotado' WHERE id=?`, [item.clientePaqueteId]
          );
        }
      }

      // Comisión
      if (empItem) {
        const { rows: empR } = await pool.query(
          `SELECT tipo_comision,pct_comision,monto_comision FROM pel_empleados WHERE id=?`, [empItem]
        );
        if (empR.length && item.tipo !== 'paquete') {
          const { rows: cfg } = await pool.query(
            `SELECT pct_comision FROM pel_comisiones_config
             WHERE negocio_id=? AND empleado_id=? AND (servicio_id=? OR servicio_id IS NULL)
             ORDER BY servicio_id DESC LIMIT 1`,
            [nid(req), empItem, item.refId||null]
          );
          const e = empR[0];
          let montoComision = 0; let pctAplicado = null;
          if (cfg.length) { pctAplicado = parseFloat(cfg[0].pct_comision); montoComision = subDet * pctAplicado / 100; }
          else if (e.tipo_comision === 'porcentaje') { pctAplicado = parseFloat(e.pct_comision); montoComision = subDet * pctAplicado / 100; }
          else if (e.tipo_comision === 'fijo') { montoComision = parseFloat(e.monto_comision); }
          if (montoComision > 0) {
            await pool.query(
              `INSERT INTO pel_comision_detalle (id,negocio_id,venta_detalle_id,empleado_id,base_calculo,pct_aplicado,monto_comision)
               VALUES (?,?,?,?,?,?,?)`,
              [uuid(), nid(req), detId, empItem, subDet, pctAplicado, montoComision]
            );
          }
        }
      }
    }

    res.status(201).json({ id: ventaId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/ventas', async (req, res) => {
  try {
    const { desde, hasta, pagina = 1, tamPagina = 30 } = req.query;
    const lim = Math.min(parseInt(tamPagina)||30, 100);
    const off = (Math.max(parseInt(pagina)||1,1)-1)*lim;
    let where = `WHERE v.negocio_id=? AND v.estado='completada'`;
    const params = [nid(req)];
    if (desde) { params.push(desde); where += ` AND DATE(v.fecha)>=?`; }
    if (hasta) { params.push(hasta); where += ` AND DATE(v.fecha)<=?`; }
    const { rows: cnt } = await pool.query(`SELECT COUNT(*) AS total FROM pel_ventas v ${where}`, params);
    const { rows } = await pool.query(
      `SELECT v.*, c.nombre AS cliente_nombre, e.nombre AS empleado_nombre_rel
       FROM pel_ventas v
       LEFT JOIN pel_clientes c ON c.id=v.cliente_id
       LEFT JOIN pel_empleados e ON e.id=v.empleado_id
       ${where} ORDER BY v.fecha DESC LIMIT ${lim} OFFSET ${off}`, params
    );
    res.json({ items: rows.map(r=>({...r,fecha:toISO(r.fecha)})), totalCount: parseInt(cnt[0]?.total||0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/ventas-empleado-hoy', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT empleado_id, SUM(total) AS total_ventas
       FROM pel_ventas
       WHERE negocio_id=? AND DATE(fecha)=CURDATE() AND empleado_id IS NOT NULL
       GROUP BY empleado_id`,
      [nid(req)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/ventas/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pel_ventas WHERE id=? AND negocio_id=?`, [req.params.id, nid(req)]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrada' });
    const { rows: det } = await pool.query(`SELECT * FROM pel_venta_detalle WHERE venta_id=?`, [req.params.id]);
    const { rows: pags } = await pool.query(`SELECT * FROM pel_venta_pagos WHERE venta_id=?`, [req.params.id]);
    res.json({ ...rows[0], detalle: det, pagos: pags });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/ventas/:id/anular', async (req, res) => {
  try {
    await pool.query(
      `UPDATE pel_ventas SET estado='anulada' WHERE id=? AND negocio_id=?`,
      [req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// CAJAS
// ════════════════════════════════════════════════════════════════

router.get('/cajas/actual', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pel_cajas WHERE negocio_id=? AND estado='abierta' ORDER BY fecha_apertura DESC LIMIT 1`,
      [nid(req)]
    );
    res.json(rows[0] || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/cajas/abrir', async (req, res) => {
  try {
    const { montoInicial = 0 } = req.body;
    // Verificar que no haya una caja abierta
    const { rows: abierta } = await pool.query(
      `SELECT id FROM pel_cajas WHERE negocio_id=? AND estado='abierta'`, [nid(req)]
    );
    if (abierta.length) return res.status(400).json({ error: 'Ya hay una caja abierta' });
    const id = uuid();
    await pool.query(
      `INSERT INTO pel_cajas (id,negocio_id,usuario_apertura,fecha_apertura,monto_inicial)
       VALUES (?,?,?,NOW(),?)`,
      [id, nid(req), req.user.id||req.user.sub||'', parseFloat(montoInicial)]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/cajas/cerrar', async (req, res) => {
  try {
    const { montoFinalReal, observaciones } = req.body;
    const { rows: cajaRows } = await pool.query(
      `SELECT * FROM pel_cajas WHERE negocio_id=? AND estado='abierta' ORDER BY fecha_apertura DESC LIMIT 1`,
      [nid(req)]
    );
    if (!cajaRows.length) return res.status(400).json({ error: 'No hay caja abierta' });
    const caja = cajaRows[0];

    // Calcular total de ventas en efectivo durante esta caja
    const { rows: totales } = await pool.query(
      `SELECT COALESCE(SUM(p.monto),0) AS total_efectivo
       FROM pel_ventas v
       JOIN pel_venta_pagos p ON p.venta_id=v.id
       WHERE v.negocio_id=? AND v.caja_id=? AND v.estado='completada' AND p.metodo='Efectivo'`,
      [nid(req), caja.id]
    );
    const { rows: movRows } = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN tipo='ingreso' THEN monto ELSE -monto END),0) AS neto_movimientos
       FROM pel_movimientos_caja WHERE caja_id=?`,
      [caja.id]
    );

    const mFinalCalc = parseFloat(caja.monto_inicial||0)
      + parseFloat(totales[0]?.total_efectivo||0)
      + parseFloat(movRows[0]?.neto_movimientos||0);
    const mFinalReal = parseFloat(montoFinalReal||0);
    const diferencia = mFinalReal - mFinalCalc;

    await pool.query(
      `UPDATE pel_cajas SET estado='cerrada',fecha_cierre=NOW(),usuario_cierre=?,
       monto_final_real=?,monto_final_calc=?,diferencia=?,observaciones=? WHERE id=?`,
      [req.user.id||req.user.sub||'', mFinalReal, mFinalCalc, diferencia, observaciones||null, caja.id]
    );
    res.json({ ok: true, mFinalCalc, mFinalReal, diferencia });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/cajas/movimiento', async (req, res) => {
  try {
    const { tipo, concepto, monto } = req.body;
    if (!tipo || !concepto || !monto) return res.status(400).json({ error: 'tipo, concepto y monto requeridos' });
    const { rows: cajaRows } = await pool.query(
      `SELECT id FROM pel_cajas WHERE negocio_id=? AND estado='abierta' ORDER BY fecha_apertura DESC LIMIT 1`,
      [nid(req)]
    );
    if (!cajaRows.length) return res.status(400).json({ error: 'No hay caja abierta' });
    const id = uuid();
    await pool.query(
      `INSERT INTO pel_movimientos_caja (id,negocio_id,caja_id,tipo,concepto,monto,usuario_id)
       VALUES (?,?,?,?,?,?,?)`,
      [id, nid(req), cajaRows[0].id, tipo, concepto, parseFloat(monto), req.user.id||req.user.sub||null]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/cajas/historial', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pel_cajas WHERE negocio_id=? ORDER BY fecha_apertura DESC LIMIT 30`,
      [nid(req)]
    );
    res.json(rows.map(r => ({ ...r, fecha_apertura: toISO(r.fecha_apertura), fecha_cierre: toISO(r.fecha_cierre) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// COMISIONES
// ════════════════════════════════════════════════════════════════

router.get('/comisiones', async (req, res) => {
  try {
    const { desde, hasta, empleadoId, estado } = req.query;
    let where = `WHERE cd.negocio_id=?`;
    const params = [nid(req)];
    if (desde) { params.push(desde); where += ` AND DATE(v.fecha)>=?`; }
    if (hasta) { params.push(hasta); where += ` AND DATE(v.fecha)<=?`; }
    if (empleadoId) { params.push(empleadoId); where += ` AND cd.empleado_id=?`; }
    if (estado) { params.push(estado); where += ` AND cd.estado=?`; }

    const { rows } = await pool.query(
      `SELECT cd.*, e.nombre AS empleado_nombre, d.descripcion AS servicio_desc, v.fecha AS venta_fecha
       FROM pel_comision_detalle cd
       JOIN pel_empleados e ON e.id=cd.empleado_id
       JOIN pel_venta_detalle d ON d.id=cd.venta_detalle_id
       JOIN pel_ventas v ON v.id=d.venta_id
       ${where} ORDER BY v.fecha DESC`, params
    );
    res.json(rows.map(r => ({ ...r, venta_fecha: toISO(r.venta_fecha) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/comisiones/:id/pagar', async (req, res) => {
  try {
    await pool.query(
      `UPDATE pel_comision_detalle SET estado='pagada', fecha_pago=NOW() WHERE id=? AND negocio_id=?`,
      [req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Marcar todas las comisiones de un empleado como pagadas
router.patch('/comisiones/empleado/:empleadoId/pagar-todas', async (req, res) => {
  try {
    await pool.query(
      `UPDATE pel_comision_detalle SET estado='pagada', fecha_pago=NOW()
       WHERE negocio_id=? AND empleado_id=? AND estado='pendiente'`,
      [nid(req), req.params.empleadoId]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Recalcular/crear comisiones usando la tasa actual del empleado
router.post('/comisiones/recalcular', async (req, res) => {
  try {
    const { empleadoId, desde, hasta } = req.body;
    if (!empleadoId) return res.status(400).json({ error: 'empleadoId requerido' });

    const { rows: empR } = await pool.query(
      `SELECT tipo_comision, pct_comision, monto_comision FROM pel_empleados WHERE id=? AND negocio_id=?`,
      [empleadoId, nid(req)]
    );
    if (!empR.length) return res.status(404).json({ error: 'Empleado no encontrado' });
    const emp = empR[0];
    if (emp.tipo_comision === 'ninguna') return res.json({ ok: true, actualizadas: 0, msg: 'Empleado sin comisión configurada' });

    // Todos los items de venta del empleado en el rango
    let where = `WHERE d.empleado_id=? AND v.negocio_id=?`;
    const params = [empleadoId, nid(req)];
    if (desde) { params.push(desde); where += ` AND DATE(v.fecha)>=?`; }
    if (hasta) { params.push(hasta); where += ` AND DATE(v.fecha)<=?`; }

    const { rows: items } = await pool.query(
      `SELECT d.id AS det_id, d.subtotal
       FROM pel_venta_detalle d
       JOIN pel_ventas v ON v.id=d.venta_id
       ${where}`, params
    );

    let actualizadas = 0;
    for (const item of items) {
      const base = parseFloat(item.subtotal) || 0;
      let monto = 0, pct = null;
      if (emp.tipo_comision === 'porcentaje') { pct = parseFloat(emp.pct_comision); monto = base * pct / 100; }
      else if (emp.tipo_comision === 'fijo') { monto = parseFloat(emp.monto_comision); }

      // Actualizar si existe, crear si no
      const { rows: existe } = await pool.query(
        `SELECT id FROM pel_comision_detalle WHERE venta_detalle_id=? AND empleado_id=?`,
        [item.det_id, empleadoId]
      );
      if (existe.length) {
        await pool.query(
          `UPDATE pel_comision_detalle SET monto_comision=?, pct_aplicado=?, base_calculo=? WHERE id=?`,
          [monto, pct, base, existe[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO pel_comision_detalle (id,negocio_id,venta_detalle_id,empleado_id,base_calculo,pct_aplicado,monto_comision)
           VALUES (?,?,?,?,?,?,?)`,
          [uuid(), nid(req), item.det_id, empleadoId, base, pct, monto]
        );
      }
      actualizadas++;
    }
    res.json({ ok: true, actualizadas });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// PROVEEDORES
// ════════════════════════════════════════════════════════════════

router.get('/proveedores', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pel_proveedores WHERE negocio_id=? ORDER BY nombre`, [nid(req)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/proveedores', async (req, res) => {
  try {
    const { nombre, telefono, email } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const id = uuid();
    await pool.query(
      `INSERT INTO pel_proveedores (id,negocio_id,nombre,telefono,email) VALUES (?,?,?,?,?)`,
      [id, nid(req), nombre, telefono||null, email||null]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/proveedores/:id', async (req, res) => {
  try {
    const { nombre, telefono, email, activo } = req.body;
    await pool.query(
      `UPDATE pel_proveedores SET nombre=?,telefono=?,email=?,activo=? WHERE id=? AND negocio_id=?`,
      [nombre, telefono||null, email||null, activo!==undefined?activo:1, req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// CATEGORÍAS DE PRODUCTO
// ════════════════════════════════════════════════════════════════

router.get('/categorias-producto', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pel_categorias_producto WHERE negocio_id=? ORDER BY nombre`, [nid(req)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/categorias-producto', async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const id = uuid();
    await pool.query(
      `INSERT INTO pel_categorias_producto (id,negocio_id,nombre) VALUES (?,?,?)`,
      [id, nid(req), nombre]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/categorias-producto/:id', async (req, res) => {
  try {
    const { nombre } = req.body;
    await pool.query(
      `UPDATE pel_categorias_producto SET nombre=? WHERE id=? AND negocio_id=?`,
      [nombre, req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/categorias-producto/:id', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM pel_categorias_producto WHERE id=? AND negocio_id=?`,
      [req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// PRODUCTOS
// ════════════════════════════════════════════════════════════════

// Migración: mover productos de inventario (modulo='peluqueria') a pel_productos
;(async () => {
  try {
    const { rows } = await pool.query("SELECT * FROM inventario WHERE modulo='peluqueria'", [], { silent: true });
    for (const p of rows) {
      const { rows: ex } = await pool.query(
        'SELECT id FROM pel_productos WHERE negocio_id=? AND nombre=? LIMIT 1', [p.negocio_id, p.nombre]
      );
      if (ex.length) continue;
      await pool.query(
        `INSERT INTO pel_productos (id,negocio_id,sku,nombre,descripcion,precio_costo,precio_venta,stock_actual,stock_minimo,unidad,activo)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [require('crypto').randomUUID(), p.negocio_id, p.codigo||null, p.nombre, p.descripcion||null,
         parseFloat(p.costo||0), parseFloat(p.precio_venta||0),
         parseInt(p.stock||0), parseInt(p.stock_min||0), p.unidad||'unidad', p.activo?1:0]
      );
      console.log('[inv-migración] Producto migrado:', p.nombre);
    }
  } catch (_) {}
})();

router.get('/productos', async (req, res) => {
  try {
    const { soloActivos, alertaStock } = req.query;
    let sql = `SELECT p.*, c.nombre AS categoria_nombre, pr.nombre AS proveedor_nombre
               FROM pel_productos p
               LEFT JOIN pel_categorias_producto c ON c.id=p.categoria_id
               LEFT JOIN pel_proveedores pr ON pr.id=p.proveedor_id
               WHERE p.negocio_id=?`;
    const params = [nid(req)];
    if (soloActivos === 'true') sql += ` AND p.activo=1`;
    if (alertaStock === 'true') sql += ` AND p.stock_actual <= p.stock_minimo`;
    sql += ' ORDER BY p.nombre';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/productos', async (req, res) => {
  try {
    const { nombre, descripcion, sku, categoriaId, proveedorId, precioCosto, precioVenta, stockActual, stockMinimo, unidad } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const id = uuid();
    await pool.query(
      `INSERT INTO pel_productos (id,negocio_id,categoria_id,proveedor_id,sku,nombre,descripcion,precio_costo,precio_venta,stock_actual,stock_minimo,unidad)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, nid(req), categoriaId||null, proveedorId||null, sku||null, nombre, descripcion||null,
       precioCosto||0, precioVenta||0, stockActual||0, stockMinimo||0, unidad||'unidad']
    );
    if (parseInt(stockActual||0) > 0) {
      await pool.query(
        `INSERT INTO pel_movimientos_inv (id,negocio_id,producto_id,tipo,cantidad,motivo)
         VALUES (?,?,?,'entrada',?,'Stock inicial')`,
        [uuid(), nid(req), id, parseInt(stockActual)]
      );
    }
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/productos/:id', async (req, res) => {
  try {
    const { nombre, descripcion, sku, categoriaId, proveedorId, precioCosto, precioVenta, stockMinimo, unidad } = req.body;
    await pool.query(
      `UPDATE pel_productos SET nombre=?,descripcion=?,sku=?,categoria_id=?,proveedor_id=?,
       precio_costo=?,precio_venta=?,stock_minimo=?,unidad=? WHERE id=? AND negocio_id=?`,
      [nombre, descripcion||null, sku||null, categoriaId||null, proveedorId||null,
       precioCosto||0, precioVenta||0, stockMinimo||0, unidad||'unidad', req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/productos/:id/toggle', async (req, res) => {
  try {
    await pool.query(
      `UPDATE pel_productos SET activo = NOT activo WHERE id=? AND negocio_id=?`,
      [req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/productos/:id/movimiento', async (req, res) => {
  try {
    const { tipo, cantidad, motivo } = req.body;
    if (!tipo || !cantidad) return res.status(400).json({ error: 'tipo y cantidad requeridos' });
    const cant = parseInt(cantidad);
    const delta = tipo === 'entrada' || tipo === 'devolucion' ? cant : -cant;
    await pool.query(
      `UPDATE pel_productos SET stock_actual = stock_actual + ? WHERE id=? AND negocio_id=?`,
      [delta, req.params.id, nid(req)]
    );
    const id = uuid();
    await pool.query(
      `INSERT INTO pel_movimientos_inv (id,negocio_id,producto_id,tipo,cantidad,motivo,usuario_id)
       VALUES (?,?,?,?,?,?,?)`,
      [id, nid(req), req.params.id, tipo, cant, motivo||null, req.user.id||req.user.sub||null]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/productos/:id/movimientos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pel_movimientos_inv WHERE negocio_id=? AND producto_id=? ORDER BY creado DESC LIMIT 50`,
      [nid(req), req.params.id]
    );
    res.json(rows.map(r => ({ ...r, creado: toISO(r.creado) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// PAQUETES / MEMBRESÍAS
// ════════════════════════════════════════════════════════════════

router.get('/paquetes', async (req, res) => {
  try {
    const { soloActivos } = req.query;
    let sql = `SELECT * FROM pel_paquetes WHERE negocio_id=?`;
    if (soloActivos === 'true') sql += ' AND activo=1';
    sql += ' ORDER BY nombre';
    const { rows } = await pool.query(sql, [nid(req)]);
    // Cargar servicios de cada paquete
    for (const p of rows) {
      const { rows: svcs } = await pool.query(
        `SELECT ps.*, s.nombre AS servicio_nombre, s.precio AS servicio_precio
         FROM pel_paquete_servicios ps
         JOIN pel_servicios s ON s.id=ps.servicio_id
         WHERE ps.paquete_id=?`,
        [p.id]
      );
      p.servicios = svcs;
    }
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/paquetes', async (req, res) => {
  try {
    const { nombre, descripcion, precio, tipo, vigenciaDias, servicios = [] } = req.body;
    if (!nombre || !precio) return res.status(400).json({ error: 'Nombre y precio requeridos' });
    const id = uuid();
    await pool.query(
      `INSERT INTO pel_paquetes (id,negocio_id,nombre,descripcion,precio,tipo,vigencia_dias)
       VALUES (?,?,?,?,?,?,?)`,
      [id, nid(req), nombre, descripcion||null, precio, tipo||'sesiones', vigenciaDias||30]
    );
    for (const s of servicios) {
      await pool.query(
        `INSERT INTO pel_paquete_servicios (id,paquete_id,servicio_id,cantidad_incluida) VALUES (?,?,?,?)`,
        [uuid(), id, s.servicioId, s.cantidadIncluida||1]
      );
    }
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/paquetes/:id', async (req, res) => {
  try {
    const { nombre, descripcion, precio, tipo, vigenciaDias, servicios = [] } = req.body;
    await pool.query(
      `UPDATE pel_paquetes SET nombre=?,descripcion=?,precio=?,tipo=?,vigencia_dias=? WHERE id=? AND negocio_id=?`,
      [nombre, descripcion||null, precio, tipo||'sesiones', vigenciaDias||30, req.params.id, nid(req)]
    );
    await pool.query(`DELETE FROM pel_paquete_servicios WHERE paquete_id=?`, [req.params.id]);
    for (const s of servicios) {
      await pool.query(
        `INSERT INTO pel_paquete_servicios (id,paquete_id,servicio_id,cantidad_incluida) VALUES (?,?,?,?)`,
        [uuid(), req.params.id, s.servicioId, s.cantidadIncluida||1]
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/paquetes/:id/toggle', async (req, res) => {
  try {
    await pool.query(
      `UPDATE pel_paquetes SET activo = NOT activo WHERE id=? AND negocio_id=?`,
      [req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Paquetes activos de un cliente
router.get('/clientes/:id/paquetes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cp.*, p.nombre AS paquete_nombre, p.tipo AS paquete_tipo
       FROM pel_cliente_paquetes cp
       JOIN pel_paquetes p ON p.id=cp.paquete_id
       WHERE cp.negocio_id=? AND cp.cliente_id=?
       ORDER BY cp.fecha_compra DESC`,
      [nid(req), req.params.id]
    );
    // Actualizar vencidos
    const hoy = localDate();
    for (const cp of rows) {
      if (cp.estado === 'activo' && cp.fecha_vencimiento < hoy) {
        await pool.query(`UPDATE pel_cliente_paquetes SET estado='vencido' WHERE id=?`, [cp.id]);
        cp.estado = 'vencido';
      }
    }
    // Cargar saldos
    for (const cp of rows) {
      const { rows: saldos } = await pool.query(
        `SELECT cps.*, s.nombre AS servicio_nombre
         FROM pel_cliente_paquete_saldo cps
         JOIN pel_servicios s ON s.id=cps.servicio_id
         WHERE cps.cliente_paquete_id=?`,
        [cp.id]
      );
      cp.saldos = saldos;
    }
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Comprar paquete para cliente (sin vincular a venta)
router.post('/clientes/:id/paquetes', async (req, res) => {
  try {
    const { paqueteId, ventaId } = req.body;
    if (!paqueteId) return res.status(400).json({ error: 'paqueteId requerido' });
    const { rows: paqRows } = await pool.query(
      `SELECT * FROM pel_paquetes WHERE id=? AND negocio_id=?`, [paqueteId, nid(req)]
    );
    if (!paqRows.length) return res.status(404).json({ error: 'Paquete no encontrado' });
    const paq = paqRows[0];
    const { rows: svcs } = await pool.query(
      `SELECT * FROM pel_paquete_servicios WHERE paquete_id=?`, [paqueteId]
    );
    const hoy = new Date(Date.now() - 5*60*60*1000);
    const vencimiento = new Date(hoy.getTime() + paq.vigencia_dias * 86400000);
    const vencStr = `${vencimiento.getUTCFullYear()}-${String(vencimiento.getUTCMonth()+1).padStart(2,'0')}-${String(vencimiento.getUTCDate()).padStart(2,'0')}`;
    const cpId = uuid();
    await pool.query(
      `INSERT INTO pel_cliente_paquetes (id,negocio_id,cliente_id,paquete_id,venta_id,fecha_vencimiento)
       VALUES (?,?,?,?,?,?)`,
      [cpId, nid(req), req.params.id, paqueteId, ventaId||null, vencStr]
    );
    // Crear saldos iniciales por servicio
    for (const s of svcs) {
      await pool.query(
        `INSERT INTO pel_cliente_paquete_saldo (id,cliente_paquete_id,servicio_id,cantidad_total,cantidad_usada)
         VALUES (?,?,?,?,0)`,
        [uuid(), cpId, s.servicio_id, paq.tipo==='tiempo_ilimitado' ? 9999 : s.cantidad_incluida]
      );
    }
    res.status(201).json({ id: cpId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════

router.get('/dashboard', async (req, res) => {
  try {
    const hoy = localDate();
    const [citasHoy, proximas, ingresosMes, stockAlerta, cajaActual] = await Promise.all([
      pool.query(
        `SELECT
         SUM(CASE WHEN estado!='Cancelada' THEN 1 ELSE 0 END) AS total,
         SUM(CASE WHEN estado='Completada' THEN 1 ELSE 0 END) AS completadas,
         SUM(CASE WHEN estado='Cancelada' THEN 1 ELSE 0 END) AS canceladas,
         SUM(CASE WHEN estado IN('Pendiente','Confirmada','EnProceso') THEN 1 ELSE 0 END) AS pendientes
         FROM pel_citas WHERE negocio_id=? AND DATE(fecha_hora)=?`,
        [nid(req), hoy]
      ),
      pool.query(
        `SELECT c.id, c.fecha_hora, c.estado,
                COALESCE(cl.nombre, c.cliente_nombre, '') AS clienteNombre,
                COALESCE(s.nombre, '') AS servicioNombre,
                COALESCE(e.nombre, c.empleado_nombre, '') AS empleadoNombre
         FROM pel_citas c
         LEFT JOIN pel_clientes cl ON cl.id = c.cliente_id
         LEFT JOIN pel_servicios s ON s.id = c.servicio_id
         LEFT JOIN pel_empleados e ON e.id = c.empleado_id
         WHERE c.negocio_id=? AND DATE(c.fecha_hora)=?
         AND c.estado NOT IN('Completada','Cancelada','NoAsistio') ORDER BY c.fecha_hora LIMIT 10`,
        [nid(req), hoy]
      ),
      pool.query(
        `SELECT COALESCE(SUM(total),0) AS total FROM pel_ventas
         WHERE negocio_id=? AND estado='completada'
         AND DATE(fecha) BETWEEN DATE_FORMAT(NOW(),'%Y-%m-01') AND ?`,
        [nid(req), hoy]
      ),
      pool.query(
        `SELECT id, nombre, stock_actual, stock_minimo FROM pel_productos
         WHERE negocio_id=? AND activo=1 AND stock_actual <= stock_minimo ORDER BY stock_actual LIMIT 5`,
        [nid(req)]
      ),
      pool.query(
        `SELECT * FROM pel_cajas WHERE negocio_id=? AND estado='abierta' ORDER BY fecha_apertura DESC LIMIT 1`,
        [nid(req)]
      ),
    ]);

    // Ingresos de hoy desde ventas
    const { rows: ingresosHoyRows } = await pool.query(
      `SELECT COALESCE(SUM(total),0) AS total FROM pel_ventas
       WHERE negocio_id=? AND estado='completada' AND DATE(fecha)=?`,
      [nid(req), hoy]
    );

    const stats = citasHoy.rows[0] || {};
    res.json({
      citasHoy: parseInt(stats.total||0),
      completadasHoy: parseInt(stats.completadas||0),
      canceladasHoy: parseInt(stats.canceladas||0),
      pendientesHoy: parseInt(stats.pendientes||0),
      ingresosHoy: parseFloat(ingresosHoyRows[0]?.total||0),
      ingresosMes: parseFloat(ingresosMes.rows[0]?.total||0),
      proximasCitas: proximas.rows.map(r=>({...r,fechaHora:toISO(r.fecha_hora)})),
      stockAlertas: stockAlerta.rows,
      cajaAbierta: cajaActual.rows[0] || null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// REPORTES
// ════════════════════════════════════════════════════════════════

router.get('/reportes/resumen', async (req, res) => {
  try {
    const d = req.query.desde || localDate();
    const h = req.query.hasta  || d;
    const nid_ = nid(req);

    const [ventasR, pagosR, gastosR, cajasR, citasR] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS pedidos, COALESCE(SUM(total),0) AS total_ventas
         FROM pel_ventas WHERE negocio_id=? AND estado='completada' AND DATE(fecha) BETWEEN ? AND ?`,
        [nid_, d, h]
      ),
      pool.query(
        `SELECT p.metodo, COALESCE(SUM(p.monto),0) AS total
         FROM pel_venta_pagos p
         JOIN pel_ventas v ON v.id=p.venta_id
         WHERE v.negocio_id=? AND v.estado='completada' AND DATE(v.fecha) BETWEEN ? AND ?
         GROUP BY p.metodo`,
        [nid_, d, h]
      ),
      pool.query(
        `SELECT COALESCE(SUM(monto),0) AS total_gastos FROM gastos
         WHERE negocio_id=? AND fecha BETWEEN ? AND ?`,
        [nid_, d, h]
      ),
      pool.query(
        `SELECT c.id, c.estado, c.fecha_apertura, c.fecha_cierre,
                c.monto_inicial, c.monto_final_real, c.monto_final_calc,
                u.nombre AS usuario_nombre,
                COALESCE((SELECT SUM(v.total) FROM pel_ventas v WHERE v.caja_id=c.id AND v.estado='completada'),0) AS total_ventas,
                COALESCE((SELECT SUM(m.monto) FROM pel_movimientos_caja m WHERE m.caja_id=c.id AND m.tipo='egreso'),0) AS total_gastos
         FROM pel_cajas c
         LEFT JOIN usuarios u ON u.id=c.usuario_apertura
         WHERE c.negocio_id=? AND DATE(c.fecha_apertura) BETWEEN ? AND ?
         ORDER BY c.fecha_apertura DESC LIMIT 20`,
        [nid_, d, h]
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM pel_citas
         WHERE negocio_id=? AND DATE(fecha_hora) BETWEEN ? AND ? AND estado!='Cancelada'`,
        [nid_, d, h]
      ),
    ]);

    const pagosMap = { Efectivo: 0, Tarjeta: 0, Nequi: 0 };
    for (const p of pagosR.rows) {
      const k = p.metodo ? p.metodo.charAt(0).toUpperCase() + p.metodo.slice(1).toLowerCase() : 'Efectivo';
      if (k in pagosMap) pagosMap[k] += parseFloat(p.total || 0);
      else pagosMap['Efectivo'] += parseFloat(p.total || 0);
    }

    const tv = parseFloat(ventasR.rows[0]?.total_ventas || 0);
    const tg = parseFloat(gastosR.rows[0]?.total_gastos || 0);

    res.json({
      ventas: {
        pedidos: parseInt(ventasR.rows[0]?.pedidos || 0),
        total_ventas: tv,
        efectivo: pagosMap.Efectivo,
        tarjeta: pagosMap.Tarjeta,
        nequi: pagosMap.Nequi,
        citas: parseInt(citasR.rows[0]?.total || 0),
      },
      gastos: { total_gastos: tg },
      cajas: cajasR.rows.map(c => ({
        ...c,
        fecha: toISO(c.fecha_apertura),
      })),
      utilidad: tv - tg,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/reportes/top-servicios', async (req, res) => {
  try {
    const d = req.query.desde || localDate();
    const h = req.query.hasta  || d;
    const { rows } = await pool.query(
      `SELECT d.descripcion AS nombre,
              SUM(d.cantidad) AS vendidos,
              COALESCE(SUM(d.subtotal),0) AS total
       FROM pel_venta_detalle d
       JOIN pel_ventas v ON v.id=d.venta_id
       WHERE v.negocio_id=? AND v.estado='completada' AND DATE(v.fecha) BETWEEN ? AND ?
       GROUP BY d.descripcion ORDER BY vendidos DESC LIMIT 10`,
      [nid(req), d, h]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/reportes/ventas-por-hora', async (req, res) => {
  try {
    const d = req.query.desde || localDate();
    const h = req.query.hasta  || d;
    const { rows } = await pool.query(
      `SELECT HOUR(fecha) AS hora, COUNT(*) AS pedidos, COALESCE(SUM(total),0) AS total
       FROM pel_ventas WHERE negocio_id=? AND estado='completada' AND DATE(fecha) BETWEEN ? AND ?
       GROUP BY hora ORDER BY hora`,
      [nid(req), d, h]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/reportes/servicios-por-empleado', async (req, res) => {
  try {
    const d = req.query.desde || localDate();
    const h = req.query.hasta  || d;
    const { rows } = await pool.query(
      `SELECT
         v.empleado_id,
         COALESCE(MIN(e.nombre), 'Sin asignar') AS empleado_nombre,
         COUNT(DISTINCT v.id)            AS ventas,
         COUNT(det.id)                   AS servicios,
         COALESCE(SUM(v.total), 0)       AS total,
         GROUP_CONCAT(DISTINCT det.descripcion SEPARATOR ', ') AS detalle_servicios
       FROM pel_ventas v
       LEFT JOIN pel_venta_detalle det ON det.venta_id = v.id
       LEFT JOIN pel_empleados e ON e.id = v.empleado_id
       WHERE v.negocio_id=? AND v.estado='completada' AND DATE(v.fecha) BETWEEN ? AND ?
       GROUP BY v.empleado_id
       ORDER BY total DESC`,
      [nid(req), d, h]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// CAJA DEL DÍA (resumen)
// ════════════════════════════════════════════════════════════════

router.get('/caja', async (req, res) => {
  try {
    const fecha = req.query.fecha || localDate();
    const { rows: ventas } = await pool.query(
      `SELECT v.id, c.nombre AS clienteNombre, e.nombre AS empleadoNombre,
       v.total AS precio, v.fecha AS fechaHora, v.descuento
       FROM pel_ventas v
       LEFT JOIN pel_clientes c ON c.id=v.cliente_id
       LEFT JOIN pel_empleados e ON e.id=v.empleado_id
       WHERE v.negocio_id=? AND DATE(v.fecha)=? AND v.estado='completada'
       ORDER BY v.fecha`,
      [nid(req), fecha]
    );
    // Obtener pagos por método
    const ventaIds = ventas.map(v => v.id);
    let porMetodo = [];
    if (ventaIds.length) {
      const inPh = ventaIds.map(()=>'?').join(',');
      const { rows: pagos } = await pool.query(
        `SELECT metodo, SUM(monto) AS monto FROM pel_venta_pagos WHERE venta_id IN (${inPh}) GROUP BY metodo`,
        ventaIds
      );
      porMetodo = pagos;
    }
    // Movimientos de caja del día
    const { rows: movs } = await pool.query(
      `SELECT mc.* FROM pel_movimientos_caja mc
       JOIN pel_cajas ca ON ca.id=mc.caja_id
       WHERE mc.negocio_id=? AND DATE(mc.creado)=?
       ORDER BY mc.creado`,
      [nid(req), fecha]
    );

    const total = ventas.reduce((s, v) => s + parseFloat(v.precio||0), 0);
    const items = ventas.map(v => ({ ...v, fechaHora: toISO(v.fechaHora) }));
    res.json({ citas: items, total, porMetodo, movimientos: movs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── AUTO-CANCELAR CITAS NO ATENDIDAS ─────────────────────────────
async function autoCancelarCitasPasadas() {
  try {
    // Marcar como NoAsistio las citas de HOY cuya hora ya terminó
    const { rows: marcadas } = await pool.query(
      `UPDATE pel_citas SET estado='NoAsistio'
       WHERE estado IN ('Pendiente','Confirmada')
       AND DATE_ADD(fecha_hora, INTERVAL duracion_min MINUTE) < NOW()`
    );
    if (marcadas.affectedRows > 0)
      console.log(`[auto-cancel] ${marcadas.affectedRows} cita(s) marcadas como NoAsistio`);

    // Eliminar de la BD las NoAsistio de días anteriores
    const { rows: ids } = await pool.query(
      `SELECT id FROM pel_citas WHERE estado='NoAsistio' AND DATE(fecha_hora) < CURDATE()`
    );
    if (ids.length) {
      const citaIds = ids.map(r => r.id);
      const ph = citaIds.map(() => '?').join(',');
      await pool.query(`DELETE FROM pel_cita_detalle WHERE cita_id IN (${ph})`, citaIds);
      const { rows: del } = await pool.query(`DELETE FROM pel_citas WHERE id IN (${ph})`, citaIds);
      console.log(`[auto-cancel] ${del.affectedRows} cita(s) NoAsistio eliminadas de días anteriores`);
    }
  } catch (e) { console.error('[auto-cancel]', e.message); }
}
autoCancelarCitasPasadas();
setInterval(autoCancelarCitasPasadas, 5 * 60 * 1000);

module.exports = router;
