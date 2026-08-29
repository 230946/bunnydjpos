const router  = require('express').Router();
const { v4: uuid } = require('uuid');
const { pool } = require('../db');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { crearNotificacion } = require('../lib/notificar');

router.use(authMiddleware);

function sumarDias(fechaStr, dias) {
  const d = new Date(fechaStr + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// GET /semana?desde=YYYY-MM-DD — devuelve las asignaciones de esa fecha + 6 días.
// Admin ve las de todos; empleado solo las suyas.
router.get('/semana', async (req, res) => {
  try {
    const desde = req.query.desde;
    if (!desde) return res.status(400).json({ error: 'desde es requerido (YYYY-MM-DD)' });
    const hasta = sumarDias(desde, 6);

    const esAdmin = req.user.rol === 'admin';
    const params = [desde, hasta];
    let filtroUsuario = '';
    if (!esAdmin) { filtroUsuario = ' AND h.usuario_id = ?'; params.push(req.user.id); }

    const { rows } = await pool.query(`
      SELECT h.usuario_id, u.nombre AS usuario_nombre, h.fecha, h.turno_id,
             h.pausa_tipo, h.pausa_inicio, h.pausa_fin,
             t.nombre AS turno_nombre, t.hora_inicio, t.hora_fin, t.color
      FROM horario_asignado h
      JOIN usuarios u ON u.id = h.usuario_id
      LEFT JOIN turnos t ON t.id = h.turno_id
      WHERE h.fecha BETWEEN ? AND ?${filtroUsuario}
      ORDER BY h.fecha, u.nombre
    `, params);
    res.json({ desde, hasta, asignaciones: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PAUSA_TIPOS = ['almuerzo', 'cena'];

// POST /asignar { usuario_id, fecha, turno_id|null, pausa_tipo|null, pausa_inicio|null, pausa_fin|null }
router.post('/asignar', requireAdmin, async (req, res) => {
  try {
    const { usuario_id, fecha, turno_id } = req.body;
    if (!usuario_id || !fecha) return res.status(400).json({ error: 'usuario_id y fecha son requeridos' });

    const pausa_tipo = PAUSA_TIPOS.includes(req.body.pausa_tipo) ? req.body.pausa_tipo : null;
    const pausa_inicio = pausa_tipo ? (req.body.pausa_inicio || null) : null;
    const pausa_fin = pausa_tipo ? (req.body.pausa_fin || null) : null;

    await pool.query(`
      INSERT INTO horario_asignado (id, usuario_id, fecha, turno_id, pausa_tipo, pausa_inicio, pausa_fin)
      VALUES (?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE turno_id = VALUES(turno_id), pausa_tipo = VALUES(pausa_tipo),
        pausa_inicio = VALUES(pausa_inicio), pausa_fin = VALUES(pausa_fin), actualizado = NOW()
    `, [uuid(), usuario_id, fecha, turno_id || null, pausa_tipo, pausa_inicio, pausa_fin]);

    let mensaje = `Tu turno del ${fecha} fue asignado a "Libre"`;
    if (turno_id) {
      const { rows: t } = await pool.query(`SELECT nombre FROM turnos WHERE id=?`, [turno_id]);
      if (t[0]) mensaje = `Tu turno del ${fecha} fue asignado a "${t[0].nombre}"`;
    }
    if (pausa_tipo && pausa_inicio && pausa_fin) {
      mensaje += ` · ${pausa_tipo} ${pausa_inicio.slice(0,5)}–${pausa_fin.slice(0,5)}`;
    }
    await crearNotificacion(usuario_id, mensaje);

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /duplicar-semana { desde, hacia } — copia las asignaciones de la semana
// que empieza en `desde` hacia la semana que empieza en `hacia` (soporta la
// rotación manual: el admin arma una semana base y la reutiliza/ajusta).
router.post('/duplicar-semana', requireAdmin, async (req, res) => {
  try {
    const { desde, hacia } = req.body;
    if (!desde || !hacia) return res.status(400).json({ error: 'desde y hacia son requeridos' });
    const hasta = sumarDias(desde, 6);
    const diffDias = Math.round((new Date(hacia + 'T12:00:00') - new Date(desde + 'T12:00:00')) / 86400000);

    const { rows: origen } = await pool.query(
      `SELECT usuario_id, fecha, turno_id, pausa_tipo, pausa_inicio, pausa_fin FROM horario_asignado WHERE fecha BETWEEN ? AND ?`,
      [desde, hasta]
    );

    const usuariosAfectados = new Set();
    for (const fila of origen) {
      const nuevaFecha = sumarDias(fila.fecha.toISOString ? fila.fecha.toISOString().slice(0,10) : fila.fecha, diffDias);
      await pool.query(`
        INSERT INTO horario_asignado (id, usuario_id, fecha, turno_id, pausa_tipo, pausa_inicio, pausa_fin)
        VALUES (?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE turno_id = VALUES(turno_id), pausa_tipo = VALUES(pausa_tipo),
          pausa_inicio = VALUES(pausa_inicio), pausa_fin = VALUES(pausa_fin), actualizado = NOW()
      `, [uuid(), fila.usuario_id, nuevaFecha, fila.turno_id, fila.pausa_tipo, fila.pausa_inicio, fila.pausa_fin]);
      usuariosAfectados.add(fila.usuario_id);
    }

    for (const usuario_id of usuariosAfectados) {
      await crearNotificacion(usuario_id, `Se publicó tu horario de la semana del ${hacia}`);
    }

    res.json({ ok: true, filas_copiadas: origen.length, empleados_notificados: usuariosAfectados.size });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
