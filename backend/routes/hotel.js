/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * routes/hotel.js — Módulo Hotel (habitaciones + reservas por fecha)
 */
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { pool } = require('../db');
const { authMiddleware, requirePermiso } = require('../middleware/auth');

const localDateTime = (tz = 'America/Bogota') => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
};
const localDate = (tz = 'America/Bogota') => localDateTime(tz).slice(0, 10);

// ── Auto-migración ──────────────────────────────────────────────
async function _ddl(sql) {
  try { await pool.query(sql); } catch (e) { console.error('hotel DDL:', e.message); }
}
(async () => {
  await _ddl(`CREATE TABLE IF NOT EXISTS htl_habitaciones (
    id            VARCHAR(36)   PRIMARY KEY,
    negocio_id    VARCHAR(36)   NOT NULL,
    numero        VARCHAR(20)   NOT NULL,
    tipo          VARCHAR(60)   DEFAULT 'Sencilla',
    capacidad     INT           NOT NULL DEFAULT 2,
    precio_noche  DECIMAL(10,2) NOT NULL DEFAULT 0,
    estado        ENUM('Disponible','Ocupada','Limpieza','Mantenimiento') NOT NULL DEFAULT 'Disponible',
    descripcion   TEXT,
    activo        TINYINT(1)    NOT NULL DEFAULT 1,
    creado        DATETIME      DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_htl_hab_neg (negocio_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await _ddl(`CREATE TABLE IF NOT EXISTS htl_reservas (
    id             VARCHAR(36)   PRIMARY KEY,
    negocio_id     VARCHAR(36)   NOT NULL,
    habitacion_id  VARCHAR(36)   NOT NULL,
    cliente_nombre VARCHAR(150)  NOT NULL,
    cliente_tel    VARCHAR(30),
    cliente_doc    VARCHAR(30),
    huespedes      INT           NOT NULL DEFAULT 1,
    fecha_checkin  DATE          NOT NULL,
    fecha_checkout DATE          NOT NULL,
    precio_noche   DECIMAL(10,2) NOT NULL DEFAULT 0,
    noches         INT           NOT NULL DEFAULT 1,
    total          DECIMAL(10,2) NOT NULL DEFAULT 0,
    estado         ENUM('Pendiente','Confirmada','EnCasa','Finalizada','Cancelada') NOT NULL DEFAULT 'Pendiente',
    notas          TEXT,
    creado         DATETIME      DEFAULT CURRENT_TIMESTAMP,
    actualizado    DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_htl_res_neg (negocio_id),
    INDEX idx_htl_res_hab (habitacion_id),
    INDEX idx_htl_res_fechas (fecha_checkin, fecha_checkout)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await _ddl(`ALTER TABLE htl_reservas ADD COLUMN monto_pagado DECIMAL(10,2) NOT NULL DEFAULT 0`);

  await _ddl(`CREATE TABLE IF NOT EXISTS htl_pagos (
    id          VARCHAR(36)   PRIMARY KEY,
    negocio_id  VARCHAR(36)   NOT NULL,
    reserva_id  VARCHAR(36)   NOT NULL,
    monto       DECIMAL(10,2) NOT NULL,
    metodo      ENUM('Efectivo','Transferencia','Tarjeta') NOT NULL DEFAULT 'Efectivo',
    notas       VARCHAR(255),
    creado      DATETIME      DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_htl_pagos_neg (negocio_id),
    INDEX idx_htl_pagos_res (reserva_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Catálogo de servicios/cargos extra (minibar, lavandería, parqueadero...)
  await _ddl(`CREATE TABLE IF NOT EXISTS htl_servicios (
    id          VARCHAR(36)   PRIMARY KEY,
    negocio_id  VARCHAR(36)   NOT NULL,
    nombre      VARCHAR(120)  NOT NULL,
    precio      DECIMAL(10,2) NOT NULL DEFAULT 0,
    activo      TINYINT(1)    NOT NULL DEFAULT 1,
    creado      DATETIME      DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_htl_serv_neg (negocio_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Cargos aplicados a la cuenta de una reserva (suman al total a cobrar)
  await _ddl(`CREATE TABLE IF NOT EXISTS htl_reserva_cargos (
    id          VARCHAR(36)   PRIMARY KEY,
    negocio_id  VARCHAR(36)   NOT NULL,
    reserva_id  VARCHAR(36)   NOT NULL,
    servicio_id VARCHAR(36),
    nombre      VARCHAR(120)  NOT NULL,
    precio      DECIMAL(10,2) NOT NULL DEFAULT 0,
    cantidad    INT           NOT NULL DEFAULT 1,
    subtotal    DECIMAL(10,2) NOT NULL DEFAULT 0,
    creado      DATETIME      DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_htl_carg_neg (negocio_id),
    INDEX idx_htl_carg_res (reserva_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
})();

// ════════════════════════════════════════════════════════════════
// BOOKING PÚBLICO — el huésped reserva sin necesidad de login
// (debe ir ANTES de router.use(authMiddleware) para quedar público)
// ════════════════════════════════════════════════════════════════
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

router.get('/booking/:negocioId/disponibilidad', async (req, res) => {
  try {
    const { negocioId } = req.params;
    const { checkin, checkout } = req.query;
    if (!checkin || !checkout) return res.status(400).json({ error: 'checkin y checkout requeridos' });
    if (checkout <= checkin) return res.status(400).json({ error: 'La fecha de salida debe ser posterior a la de entrada' });
    const { rows: habs } = await pool.query(
      `SELECT id, numero, tipo, capacidad, precio_noche, descripcion FROM htl_habitaciones WHERE negocio_id=? AND activo=1 ORDER BY numero`,
      [negocioId]
    );
    const disponibles = [];
    for (const h of habs) {
      if (await _habitacionDisponible(negocioId, h.id, checkin, checkout)) disponibles.push(h);
    }
    res.json(disponibles);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/booking/:negocioId/reservar', async (req, res) => {
  try {
    const { negocioId } = req.params;
    const { habitacionId, checkin, checkout, clienteNombre, clienteTelefono, clienteDoc, huespedes, notas } = req.body;
    if (!habitacionId || !clienteNombre || !checkin || !checkout)
      return res.status(400).json({ error: 'Datos incompletos' });
    if (checkout <= checkin) return res.status(400).json({ error: 'La fecha de salida debe ser posterior a la de entrada' });
    const telDigits = String(clienteTelefono || '').replace(/\D/g, '');
    if (telDigits.length < 7 || telDigits.length > 15)
      return res.status(400).json({ error: 'Ingresa un número de teléfono válido' });
    const { rows: ng } = await pool.query(`SELECT id FROM negocios WHERE id=? AND activo=1 LIMIT 1`, [negocioId]);
    if (!ng[0]) return res.status(404).json({ error: 'Negocio no encontrado' });

    const { rows: habR } = await pool.query(
      `SELECT precio_noche FROM htl_habitaciones WHERE id=? AND negocio_id=? AND activo=1`,
      [habitacionId, negocioId]
    );
    if (!habR[0]) return res.status(404).json({ error: 'Habitación no encontrada' });

    const disponible = await _habitacionDisponible(negocioId, habitacionId, checkin, checkout);
    if (!disponible) return res.status(409).json({ error: 'Esa habitación ya no está disponible para esas fechas. Elige otra.' });

    const precioNoche = parseFloat(habR[0].precio_noche) || 0;
    const noches = Math.round((new Date(checkout) - new Date(checkin)) / 86400000);
    const total = precioNoche * noches;

    const id = uuid();
    await pool.query(
      `INSERT INTO htl_reservas (id,negocio_id,habitacion_id,cliente_nombre,cliente_tel,cliente_doc,huespedes,fecha_checkin,fecha_checkout,precio_noche,noches,total,notas)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, negocioId, habitacionId, clienteNombre, clienteTelefono || null, clienteDoc || null,
       parseInt(huespedes) || 1, checkin, checkout, precioNoche, noches, total, notas || null]
    );
    res.status(201).json({ id, noches, total, mensaje: '¡Reserva creada! Te esperamos.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.use(authMiddleware);
const nid = req => req.user.negocio_id;

// Una habitación está ocupada en un rango si tiene una reserva activa
// (no Cancelada/Finalizada) cuyo rango de fechas se cruza con el pedido.
async function _habitacionDisponible(negocioId, habitacionId, checkin, checkout, excluirReservaId) {
  const { rows } = await pool.query(
    `SELECT id FROM htl_reservas
     WHERE negocio_id=? AND habitacion_id=? AND estado NOT IN ('Cancelada','Finalizada')
       AND fecha_checkin < ? AND fecha_checkout > ?
       ${excluirReservaId ? 'AND id<>?' : ''}
     LIMIT 1`,
    excluirReservaId ? [negocioId, habitacionId, checkout, checkin, excluirReservaId] : [negocioId, habitacionId, checkout, checkin]
  );
  return !rows[0];
}

// ════════════════════════════════════════════════════════════════
// HABITACIONES
// ════════════════════════════════════════════════════════════════
router.get('/habitaciones', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM htl_habitaciones WHERE negocio_id=? AND activo=1 ORDER BY numero`, [nid(req)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/habitaciones', async (req, res) => {
  try {
    const { numero, tipo, capacidad, precio_noche, descripcion } = req.body;
    if (!numero) return res.status(400).json({ error: 'El número de habitación es obligatorio' });
    const id = uuid();
    await pool.query(
      `INSERT INTO htl_habitaciones (id,negocio_id,numero,tipo,capacidad,precio_noche,descripcion)
       VALUES (?,?,?,?,?,?,?)`,
      [id, nid(req), numero, tipo || 'Sencilla', parseInt(capacidad) || 2, parseFloat(precio_noche) || 0, descripcion || null]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/habitaciones/:id', async (req, res) => {
  try {
    const { numero, tipo, capacidad, precio_noche, descripcion } = req.body;
    await pool.query(
      `UPDATE htl_habitaciones SET numero=?,tipo=?,capacidad=?,precio_noche=?,descripcion=?
       WHERE id=? AND negocio_id=?`,
      [numero, tipo || 'Sencilla', parseInt(capacidad) || 2, parseFloat(precio_noche) || 0, descripcion || null, req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Estado manual (ej. Limpieza / Mantenimiento) — el estado "Ocupada" real
// se deduce de las reservas EnCasa, no se fuerza a mano.
router.patch('/habitaciones/:id/estado', async (req, res) => {
  try {
    const { estado } = req.body;
    if (!['Disponible','Limpieza','Mantenimiento'].includes(estado)) {
      return res.status(400).json({ error: 'Estado no permitido' });
    }
    await pool.query(`UPDATE htl_habitaciones SET estado=? WHERE id=? AND negocio_id=?`, [estado, req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/habitaciones/:id', async (req, res) => {
  try {
    await pool.query(`UPDATE htl_habitaciones SET activo=0 WHERE id=? AND negocio_id=?`, [req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// RESERVAS
// ════════════════════════════════════════════════════════════════

// Lista reservas que tocan el rango [desde,hasta] — por defecto, hoy y
// los próximos 30 días, útil para el calendario/tablero de habitaciones.
router.get('/reservas', async (req, res) => {
  try {
    const desde = req.query.desde || localDate();
    const hasta = req.query.hasta || (() => {
      const d = new Date(desde + 'T12:00:00'); d.setDate(d.getDate() + 30);
      return d.toISOString().slice(0, 10);
    })();
    const { rows } = await pool.query(
      `SELECT r.*, h.numero AS habitacion_numero, h.tipo AS habitacion_tipo
       FROM htl_reservas r
       JOIN htl_habitaciones h ON h.id = r.habitacion_id
       WHERE r.negocio_id=? AND r.fecha_checkin < ? AND r.fecha_checkout > ?
       ORDER BY r.fecha_checkin`,
      [nid(req), hasta, desde]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/reservas', async (req, res) => {
  try {
    const { habitacion_id, cliente_nombre, cliente_tel, cliente_doc, huespedes, fecha_checkin, fecha_checkout, notas } = req.body;
    if (!habitacion_id || !cliente_nombre || !fecha_checkin || !fecha_checkout) {
      return res.status(400).json({ error: 'Habitación, cliente y fechas son obligatorios' });
    }
    if (fecha_checkout <= fecha_checkin) {
      return res.status(400).json({ error: 'La fecha de salida debe ser posterior a la de entrada' });
    }
    const disponible = await _habitacionDisponible(nid(req), habitacion_id, fecha_checkin, fecha_checkout);
    if (!disponible) return res.status(409).json({ error: 'La habitación ya tiene una reserva que se cruza con esas fechas' });

    const { rows: habR } = await pool.query(`SELECT precio_noche FROM htl_habitaciones WHERE id=? AND negocio_id=?`, [habitacion_id, nid(req)]);
    if (!habR[0]) return res.status(404).json({ error: 'Habitación no encontrada' });
    const precioNoche = parseFloat(habR[0].precio_noche) || 0;
    const noches = Math.round((new Date(fecha_checkout) - new Date(fecha_checkin)) / 86400000);
    const total = precioNoche * noches;

    const id = uuid();
    await pool.query(
      `INSERT INTO htl_reservas (id,negocio_id,habitacion_id,cliente_nombre,cliente_tel,cliente_doc,huespedes,fecha_checkin,fecha_checkout,precio_noche,noches,total,notas)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, nid(req), habitacion_id, cliente_nombre, cliente_tel || null, cliente_doc || null, parseInt(huespedes) || 1, fecha_checkin, fecha_checkout, precioNoche, noches, total, notas || null]
    );
    res.status(201).json({ id, noches, total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Edita fechas/habitación/datos de una reserva ya creada (ej. el huésped
// extiende su estadía). No se permite sobre reservas Finalizada/Cancelada,
// ni reducir el total por debajo de lo ya cobrado (habría que reembolsar
// primero).
router.put('/reservas/:id', async (req, res) => {
  try {
    const { habitacion_id, cliente_nombre, cliente_tel, cliente_doc, huespedes, fecha_checkin, fecha_checkout, notas } = req.body;
    if (!habitacion_id || !cliente_nombre || !fecha_checkin || !fecha_checkout) {
      return res.status(400).json({ error: 'Habitación, cliente y fechas son obligatorios' });
    }
    if (fecha_checkout <= fecha_checkin) {
      return res.status(400).json({ error: 'La fecha de salida debe ser posterior a la de entrada' });
    }
    const { rows: cur } = await pool.query(
      `SELECT estado, monto_pagado FROM htl_reservas WHERE id=? AND negocio_id=?`,
      [req.params.id, nid(req)]
    );
    if (!cur[0]) return res.status(404).json({ error: 'Reserva no encontrada' });
    if (['Finalizada', 'Cancelada'].includes(cur[0].estado)) {
      return res.status(400).json({ error: 'No se puede editar una reserva finalizada o cancelada' });
    }

    const disponible = await _habitacionDisponible(nid(req), habitacion_id, fecha_checkin, fecha_checkout, req.params.id);
    if (!disponible) return res.status(409).json({ error: 'La habitación ya tiene una reserva que se cruza con esas fechas' });

    const { rows: habR } = await pool.query(`SELECT precio_noche FROM htl_habitaciones WHERE id=? AND negocio_id=?`, [habitacion_id, nid(req)]);
    if (!habR[0]) return res.status(404).json({ error: 'Habitación no encontrada' });
    const precioNoche = parseFloat(habR[0].precio_noche) || 0;
    const noches = Math.round((new Date(fecha_checkout) - new Date(fecha_checkin)) / 86400000);
    const total = precioNoche * noches;

    if (parseFloat(cur[0].monto_pagado) > total + 0.01) {
      return res.status(400).json({
        error: `El nuevo total (${total.toFixed(2)}) es menor al monto ya pagado (${parseFloat(cur[0].monto_pagado).toFixed(2)}). Registra un reembolso antes de editar.`
      });
    }

    await pool.query(
      `UPDATE htl_reservas SET habitacion_id=?,cliente_nombre=?,cliente_tel=?,cliente_doc=?,huespedes=?,
       fecha_checkin=?,fecha_checkout=?,precio_noche=?,noches=?,total=?,notas=?
       WHERE id=? AND negocio_id=?`,
      [habitacion_id, cliente_nombre, cliente_tel || null, cliente_doc || null, parseInt(huespedes) || 1,
       fecha_checkin, fecha_checkout, precioNoche, noches, total, notas || null, req.params.id, nid(req)]
    );
    res.json({ ok: true, noches, total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/reservas/:id/estado', async (req, res) => {
  try {
    const { estado } = req.body;
    if (!['Pendiente','Confirmada','EnCasa','Finalizada','Cancelada'].includes(estado)) {
      return res.status(400).json({ error: 'Estado no permitido' });
    }
    const { rows } = await pool.query(`SELECT habitacion_id FROM htl_reservas WHERE id=? AND negocio_id=?`, [req.params.id, nid(req)]);
    if (!rows[0]) return res.status(404).json({ error: 'Reserva no encontrada' });

    await pool.query(`UPDATE htl_reservas SET estado=? WHERE id=? AND negocio_id=?`, [estado, req.params.id, nid(req)]);

    // Reflejar el check-in/check-out en el estado visible de la habitación.
    if (estado === 'EnCasa') {
      await pool.query(`UPDATE htl_habitaciones SET estado='Ocupada' WHERE id=? AND negocio_id=?`, [rows[0].habitacion_id, nid(req)]);
    } else if (estado === 'Finalizada') {
      await pool.query(`UPDATE htl_habitaciones SET estado='Limpieza' WHERE id=? AND negocio_id=?`, [rows[0].habitacion_id, nid(req)]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/reservas/:id', async (req, res) => {
  try {
    await pool.query(`UPDATE htl_reservas SET estado='Cancelada' WHERE id=? AND negocio_id=?`, [req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// PAGOS — cobro parcial o total de una reserva (check-in/check-out)
// ════════════════════════════════════════════════════════════════
router.get('/reservas/:id/pagos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM htl_pagos WHERE reserva_id=? AND negocio_id=? ORDER BY creado`,
      [req.params.id, nid(req)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/reservas/:id/pagos', async (req, res) => {
  try {
    const { monto, metodo, notas } = req.body;
    const montoNum = parseFloat(monto);
    if (!montoNum || montoNum <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a cero' });
    if (!['Efectivo','Transferencia','Tarjeta'].includes(metodo)) return res.status(400).json({ error: 'Método de pago no válido' });

    const { rows } = await pool.query(
      `SELECT total, monto_pagado, estado FROM htl_reservas WHERE id=? AND negocio_id=?`,
      [req.params.id, nid(req)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Reserva no encontrada' });
    if (rows[0].estado === 'Cancelada') return res.status(400).json({ error: 'No se puede cobrar una reserva cancelada' });

    const saldo = parseFloat(rows[0].total) - parseFloat(rows[0].monto_pagado);
    if (montoNum > saldo + 0.01) return res.status(400).json({ error: `El monto excede el saldo pendiente (${saldo.toFixed(2)})` });

    const id = uuid();
    await pool.query(
      `INSERT INTO htl_pagos (id,negocio_id,reserva_id,monto,metodo,notas) VALUES (?,?,?,?,?,?)`,
      [id, nid(req), req.params.id, montoNum, metodo, notas || null]
    );
    await pool.query(`UPDATE htl_reservas SET monto_pagado = monto_pagado + ? WHERE id=? AND negocio_id=?`, [montoNum, req.params.id, nid(req)]);
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// SERVICIOS — catálogo de cargos extra (minibar, lavandería, etc.)
// ════════════════════════════════════════════════════════════════
router.get('/servicios', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM htl_servicios WHERE negocio_id=? AND activo=1 ORDER BY nombre`, [nid(req)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/servicios', requirePermiso('inventario'), async (req, res) => {
  try {
    const { nombre, precio } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const id = uuid();
    await pool.query(
      `INSERT INTO htl_servicios (id,negocio_id,nombre,precio) VALUES (?,?,?,?)`,
      [id, nid(req), nombre, parseFloat(precio) || 0]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/servicios/:id', requirePermiso('inventario'), async (req, res) => {
  try {
    const { nombre, precio } = req.body;
    await pool.query(
      `UPDATE htl_servicios SET nombre=?, precio=? WHERE id=? AND negocio_id=?`,
      [nombre, parseFloat(precio) || 0, req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/servicios/:id', requirePermiso('inventario'), async (req, res) => {
  try {
    await pool.query(`UPDATE htl_servicios SET activo=0 WHERE id=? AND negocio_id=?`, [req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// CARGOS — servicios extra aplicados a la cuenta de una reserva
// (suman al total de la reserva, igual que si fuera una noche más)
// ════════════════════════════════════════════════════════════════
router.get('/reservas/:id/cargos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM htl_reserva_cargos WHERE reserva_id=? AND negocio_id=? ORDER BY creado`,
      [req.params.id, nid(req)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/reservas/:id/cargos', async (req, res) => {
  try {
    const { servicio_id, nombre, precio, cantidad } = req.body;
    const cant = parseInt(cantidad) || 1;
    let _nombre = nombre, _precio = parseFloat(precio);
    if (servicio_id) {
      const { rows: sv } = await pool.query(
        `SELECT nombre, precio FROM htl_servicios WHERE id=? AND negocio_id=? AND activo=1`,
        [servicio_id, nid(req)]
      );
      if (!sv[0]) return res.status(404).json({ error: 'Servicio no encontrado' });
      _nombre = sv[0].nombre; _precio = parseFloat(sv[0].precio);
    }
    if (!_nombre || !(_precio >= 0)) return res.status(400).json({ error: 'Nombre y precio son obligatorios' });

    const { rows: resv } = await pool.query(
      `SELECT estado FROM htl_reservas WHERE id=? AND negocio_id=?`, [req.params.id, nid(req)]
    );
    if (!resv[0]) return res.status(404).json({ error: 'Reserva no encontrada' });
    if (['Finalizada', 'Cancelada'].includes(resv[0].estado)) {
      return res.status(400).json({ error: 'No se pueden agregar cargos a una reserva finalizada o cancelada' });
    }

    const subtotal = _precio * cant;
    const id = uuid();
    await pool.query(
      `INSERT INTO htl_reserva_cargos (id,negocio_id,reserva_id,servicio_id,nombre,precio,cantidad,subtotal)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, nid(req), req.params.id, servicio_id || null, _nombre, _precio, cant, subtotal]
    );
    await pool.query(`UPDATE htl_reservas SET total = total + ? WHERE id=? AND negocio_id=?`, [subtotal, req.params.id, nid(req)]);
    res.status(201).json({ id, subtotal });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/reservas/:id/cargos/:cargoId', async (req, res) => {
  try {
    const { rows: cargo } = await pool.query(
      `SELECT subtotal FROM htl_reserva_cargos WHERE id=? AND reserva_id=? AND negocio_id=?`,
      [req.params.cargoId, req.params.id, nid(req)]
    );
    if (!cargo[0]) return res.status(404).json({ error: 'Cargo no encontrado' });

    const { rows: resv } = await pool.query(
      `SELECT total, monto_pagado FROM htl_reservas WHERE id=? AND negocio_id=?`, [req.params.id, nid(req)]
    );
    const nuevoTotal = parseFloat(resv[0].total) - parseFloat(cargo[0].subtotal);
    if (nuevoTotal < parseFloat(resv[0].monto_pagado) - 0.01) {
      return res.status(400).json({ error: 'No se puede quitar: el total quedaría por debajo de lo ya pagado' });
    }

    await pool.query(`DELETE FROM htl_reserva_cargos WHERE id=? AND negocio_id=?`, [req.params.cargoId, nid(req)]);
    await pool.query(`UPDATE htl_reservas SET total = total - ? WHERE id=? AND negocio_id=?`, [cargo[0].subtotal, req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// REPORTES — ingresos/gastos por rango de fechas
// ════════════════════════════════════════════════════════════════
router.get('/reportes', requirePermiso('reportes'), async (req, res) => {
  try {
    const desde = req.query.desde || localDate();
    const hasta = req.query.hasta || desde;
    const [ingresos, pagosDetalle, reservasRango, gastos] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(monto),0) AS total, COUNT(*) AS cantidad
         FROM htl_pagos WHERE negocio_id=? AND DATE(creado) BETWEEN ? AND ?`,
        [nid(req), desde, hasta]
      ),
      pool.query(
        `SELECT p.*, r.cliente_nombre, h.numero AS habitacion_numero
         FROM htl_pagos p
         JOIN htl_reservas r ON r.id = p.reserva_id
         JOIN htl_habitaciones h ON h.id = r.habitacion_id
         WHERE p.negocio_id=? AND DATE(p.creado) BETWEEN ? AND ?
         ORDER BY p.creado DESC`,
        [nid(req), desde, hasta]
      ),
      pool.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN estado='Cancelada' THEN 1 ELSE 0 END) AS canceladas,
                SUM(CASE WHEN fecha_checkin BETWEEN ? AND ? THEN 1 ELSE 0 END) AS checkins
         FROM htl_reservas WHERE negocio_id=? AND fecha_checkin BETWEEN ? AND ?`,
        [desde, hasta, nid(req), desde, hasta]
      ),
      pool.query(
        `SELECT COALESCE(SUM(monto),0) AS total FROM gastos WHERE negocio_id=? AND fecha BETWEEN ? AND ?`,
        [nid(req), desde, hasta]
      ),
    ]);
    const totalIngresos = parseFloat(ingresos.rows[0].total) || 0;
    const totalGastos = parseFloat(gastos.rows[0].total) || 0;
    res.json({
      desde, hasta,
      ingresos: { total: totalIngresos, cantidad_pagos: parseInt(ingresos.rows[0].cantidad) || 0 },
      gastos: { total: totalGastos },
      utilidad: totalIngresos - totalGastos,
      reservas: reservasRango.rows[0],
      pagos: pagosDetalle.rows,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Resumen para el tablero del día ───────────────────────────────
router.get('/resumen', async (req, res) => {
  try {
    const hoy = localDate();
    const [{ rows: checkins }, { rows: checkouts }, { rows: enCasa }, { rows: totalHab }, { rows: cobrado }] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS n FROM htl_reservas WHERE negocio_id=? AND fecha_checkin=? AND estado IN ('Pendiente','Confirmada')`, [nid(req), hoy]),
      pool.query(`SELECT COUNT(*) AS n FROM htl_reservas WHERE negocio_id=? AND fecha_checkout=? AND estado='EnCasa'`, [nid(req), hoy]),
      pool.query(`SELECT COUNT(*) AS n FROM htl_reservas WHERE negocio_id=? AND estado='EnCasa'`, [nid(req)]),
      pool.query(`SELECT COUNT(*) AS n FROM htl_habitaciones WHERE negocio_id=? AND activo=1`, [nid(req)]),
      pool.query(`SELECT COALESCE(SUM(monto),0) AS s FROM htl_pagos WHERE negocio_id=? AND DATE(creado)=?`, [nid(req), hoy]),
    ]);
    res.json({
      checkinsHoy: parseInt(checkins[0]?.n || 0),
      checkoutsHoy: parseInt(checkouts[0]?.n || 0),
      habitacionesOcupadas: parseInt(enCasa[0]?.n || 0),
      totalHabitaciones: parseInt(totalHab[0]?.n || 0),
      cobradoHoy: parseFloat(cobrado[0]?.s || 0),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
