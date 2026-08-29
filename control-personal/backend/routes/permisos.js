const router  = require('express').Router();
const { v4: uuid } = require('uuid');
const { pool } = require('../db');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { crearNotificacion } = require('../lib/notificar');

router.use(authMiddleware);

const TIPOS = ['vacaciones', 'personal', 'enfermedad', 'otro'];

router.post('/', async (req, res) => {
  try {
    const { tipo, fecha_inicio, fecha_fin, motivo } = req.body;
    if (!fecha_inicio || !fecha_fin) return res.status(400).json({ error: 'fecha_inicio y fecha_fin son requeridos' });
    const id = uuid();
    await pool.query(
      `INSERT INTO solicitudes_permiso (id, usuario_id, tipo, fecha_inicio, fecha_fin, motivo)
       VALUES (?,?,?,?,?,?)`,
      [id, req.user.id, TIPOS.includes(tipo) ? tipo : 'personal', fecha_inicio, fecha_fin, motivo || null]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin ve todas (opcionalmente filtradas por estado); empleado solo las suyas.
router.get('/', async (req, res) => {
  try {
    const esAdmin = req.user.rol === 'admin';
    const params = [];
    let where = '1=1';
    if (!esAdmin) { where += ' AND s.usuario_id=?'; params.push(req.user.id); }
    if (esAdmin && req.query.estado) { where += ' AND s.estado=?'; params.push(req.query.estado); }

    const { rows } = await pool.query(`
      SELECT s.*, u.nombre AS usuario_nombre, r.nombre AS respondido_por_nombre
      FROM solicitudes_permiso s
      JOIN usuarios u ON u.id = s.usuario_id
      LEFT JOIN usuarios r ON r.id = s.respondido_por
      WHERE ${where}
      ORDER BY s.creado DESC
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { estado, notas_admin } = req.body;
    if (!['aprobado', 'rechazado'].includes(estado)) {
      return res.status(400).json({ error: "estado debe ser 'aprobado' o 'rechazado'" });
    }
    await pool.query(
      `UPDATE solicitudes_permiso SET estado=?, notas_admin=?, respondido_por=?, respondido_en=NOW() WHERE id=?`,
      [estado, notas_admin || null, req.user.id, req.params.id]
    );
    const { rows } = await pool.query(`SELECT usuario_id, fecha_inicio, fecha_fin FROM solicitudes_permiso WHERE id=?`, [req.params.id]);
    if (rows[0]) {
      const s = rows[0];
      const label = estado === 'aprobado' ? 'aprobada' : 'rechazada';
      const fi = new Date(s.fecha_inicio).toISOString().slice(0, 10);
      const ff = new Date(s.fecha_fin).toISOString().slice(0, 10);
      await crearNotificacion(s.usuario_id, `Tu solicitud de permiso (${fi} a ${ff}) fue ${label}`);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
