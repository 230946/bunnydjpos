const router  = require('express').Router();
const { v4: uuid } = require('uuid');
const { pool } = require('../db');
const { authMiddleware, requireAdmin } = require('../middleware/auth');

router.use(authMiddleware);

// Cualquier usuario autenticado puede LEER el catálogo (lo necesita el
// empleado para ver a qué turno corresponde su horario asignado).
router.get('/', async (_, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM turnos WHERE activo=1 ORDER BY hora_inicio`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { nombre, hora_inicio, hora_fin, color } = req.body;
    if (!nombre || !hora_inicio || !hora_fin) {
      return res.status(400).json({ error: 'nombre, hora_inicio y hora_fin son requeridos' });
    }
    const id = uuid();
    await pool.query(
      `INSERT INTO turnos (id, nombre, hora_inicio, hora_fin, color) VALUES (?,?,?,?,?)`,
      [id, nombre, hora_inicio, hora_fin, color || '#0B8457']
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { nombre, hora_inicio, hora_fin, color } = req.body;
    await pool.query(
      `UPDATE turnos SET nombre=?, hora_inicio=?, hora_fin=?, color=? WHERE id=?`,
      [nombre, hora_inicio, hora_fin, color || '#0B8457', req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query(`UPDATE turnos SET activo=0 WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
