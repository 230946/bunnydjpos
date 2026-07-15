/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * routes/turno.js — Fichaje real de entrada/salida para empleados de
 * restaurante y minimercado, usando `usuarios.documento` (número de
 * documento/cédula) como identificador — mismo criterio que ya usa
 * peluquería con `pel_empleados.cedula`.
 *
 * Sin JWT a propósito: el empleado que ficha no tiene usuario/contraseña
 * completos, solo su número de empleado.
 *
 * Reutiliza la misma tabla `horarios` que ya usa el CRUD de turnos
 * programados (ver backend/routes/usuarios.js) — una fila con
 * fecha=hoy es el fichaje real del día; fecha=NULL es la plantilla
 * semanal recurrente. hora_salida queda NULL mientras el turno sigue
 * activo, así el panel de Asistencia sabe distinguir "en turno" de
 * "turno finalizado" sin ambigüedad.
 */
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { pool, ph } = require('../db');

const localDateTime = (tz = 'America/Bogota') => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
};

// GET /api/turno/:negocioId?documento=X — estado del turno de hoy
router.get('/:negocioId', async (req, res) => {
  try {
    const documento = req.query.documento ? String(req.query.documento).trim() : null;
    if (!documento) return res.status(400).json({ error: 'Ingresa tu número de documento' });

    const { rows: userR } = await pool.query(
      `SELECT id, nombre FROM usuarios WHERE negocio_id=${ph(1)} AND TRIM(documento)=${ph(2)} AND activo=1 LIMIT 1`,
      [req.params.negocioId, documento]
    );
    if (!userR[0]) return res.status(404).json({ error: 'No se encontró ningún empleado con ese documento' });

    const [fechaHoy] = localDateTime().split(' ');
    const { rows: turnoR } = await pool.query(
      `SELECT hora_entrada, hora_salida FROM horarios
       WHERE usuario_id=${ph(1)} AND negocio_id=${ph(2)} AND fecha=${ph(3)} AND activo=1 LIMIT 1`,
      [userR[0].id, req.params.negocioId, fechaHoy]
    );
    res.json({ nombre: userR[0].nombre, turnoHoy: turnoR[0] || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/turno/:negocioId/historial-pago?documento=X — pagos ya pagados del empleado
router.get('/:negocioId/historial-pago', async (req, res) => {
  try {
    const documento = req.query.documento ? String(req.query.documento).trim() : null;
    if (!documento) return res.status(400).json({ error: 'Ingresa tu número de documento' });

    const { rows: userR } = await pool.query(
      `SELECT id FROM usuarios WHERE negocio_id=${ph(1)} AND TRIM(documento)=${ph(2)} AND activo=1 LIMIT 1`,
      [req.params.negocioId, documento]
    );
    if (!userR[0]) return res.status(404).json({ error: 'No se encontró ningún empleado con ese documento' });

    const { rows } = await pool.query(
      `SELECT p.periodo, d.neto_pagar, p.pagado AS fecha_pagado
       FROM nomina_detalle d
       JOIN periodos_nomina p ON p.id = d.periodo_id
       WHERE d.usuario_id=${ph(1)} AND d.negocio_id=${ph(2)} AND p.estado='pagado'
       ORDER BY p.periodo DESC LIMIT 24`,
      [userR[0].id, req.params.negocioId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/turno/:negocioId  { documento, accion: 'iniciar'|'finalizar' }
router.post('/:negocioId', async (req, res) => {
  try {
    const documento = req.body.documento ? String(req.body.documento).trim() : null;
    const { accion } = req.body;
    if (!documento || !accion) return res.status(400).json({ error: 'Faltan datos' });
    if (!['iniciar', 'finalizar'].includes(accion)) return res.status(400).json({ error: 'Acción no válida' });

    const { rows: userR } = await pool.query(
      `SELECT id, nombre FROM usuarios WHERE negocio_id=${ph(1)} AND TRIM(documento)=${ph(2)} AND activo=1 LIMIT 1`,
      [req.params.negocioId, documento]
    );
    if (!userR[0]) return res.status(404).json({ error: 'No se encontró ningún empleado con ese documento' });
    const usuarioId = userR[0].id;

    const [fechaHoy, horaHoy] = localDateTime().split(' ');
    const diaSemana = new Date(fechaHoy + 'T12:00:00').getDay();

    const { rows: ex } = await pool.query(
      `SELECT id, hora_entrada, hora_salida FROM horarios
       WHERE usuario_id=${ph(1)} AND negocio_id=${ph(2)} AND fecha=${ph(3)} AND activo=1 LIMIT 1`,
      [usuarioId, req.params.negocioId, fechaHoy]
    );

    if (accion === 'iniciar') {
      if (ex[0] && ex[0].hora_entrada && !ex[0].hora_salida)
        return res.status(400).json({ error: 'Ya tienes un turno en curso hoy' });

      // Si el admin programó un horario para este día, no dejar iniciar antes de esa hora.
      const { rows: plantillaR } = await pool.query(
        `SELECT hora_entrada, es_libre FROM horarios
         WHERE usuario_id=${ph(1)} AND negocio_id=${ph(2)} AND dia_semana=${ph(3)} AND fecha IS NULL AND activo=1 LIMIT 1`,
        [usuarioId, req.params.negocioId, diaSemana]
      );
      const plantilla = plantillaR[0];
      if (plantilla && !plantilla.es_libre && plantilla.hora_entrada && horaHoy < plantilla.hora_entrada) {
        return res.status(400).json({ error: `Aún no puedes iniciar turno — tu horario programado empieza a las ${plantilla.hora_entrada.slice(0,5)}` });
      }

      if (ex[0]) {
        await pool.query(`UPDATE horarios SET hora_entrada=${ph(1)}, hora_salida=NULL WHERE id=${ph(2)}`, [horaHoy, ex[0].id]);
      } else {
        await pool.query(
          `INSERT INTO horarios (id,usuario_id,negocio_id,dia_semana,hora_entrada,fecha,activo)
           VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},1)`,
          [uuid(), usuarioId, req.params.negocioId, diaSemana, horaHoy, fechaHoy]
        );
      }
    } else {
      if (!ex[0] || !ex[0].hora_entrada) return res.status(400).json({ error: 'No has iniciado turno hoy' });
      if (ex[0].hora_salida) return res.status(400).json({ error: 'Ya finalizaste tu turno hoy' });
      await pool.query(`UPDATE horarios SET hora_salida=${ph(1)} WHERE id=${ph(2)}`, [horaHoy, ex[0].id]);
    }
    res.json({ ok: true, nombre: userR[0].nombre });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
