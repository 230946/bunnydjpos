/**
 * routes/clientes.js
 * Gestión de clientes por negocio.
 * - Buscar / crear: cualquier usuario autenticado (para uso desde el POS)
 * - Listar / editar / desactivar: requiere permiso 'clientes' (admin)
 */
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { pool, ph } = require('../db');
const { authMiddleware, requirePermiso, requireAdmin } = require('../middleware/auth');

router.use(authMiddleware);

// Buscar clientes (POS y admin)
router.get('/clientes/buscar', async (req, res) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    const { rows } = await pool.query(
      `SELECT id, nombre, telefono, email, documento, direccion, departamento, ciudad
       FROM clientes
       WHERE negocio_id=${ph(1)} AND activo=1
         AND (nombre LIKE ${ph(2)} OR telefono LIKE ${ph(3)} OR documento LIKE ${ph(4)})
       ORDER BY nombre LIMIT 10`,
      [req.user.negocio_id, q, q, q]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Obtener uno (POS y admin — necesario para validar completitud antes de facturar)
router.get('/clientes/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, telefono, email, documento, direccion FROM clientes
       WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, req.user.negocio_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Listar todos (solo admin)
router.get('/clientes', requirePermiso('clientes'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM clientes WHERE negocio_id=${ph(1)} ORDER BY nombre`,
      [req.user.negocio_id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Crear (POS y admin)
router.post('/clientes', async (req, res) => {
  try {
    const { nombre, telefono, email, documento, direccion, notas, departamento, ciudad } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const id = uuid();
    await pool.query(
      `INSERT INTO clientes (id, negocio_id, nombre, telefono, email, documento, direccion, notas, departamento, ciudad)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},${ph(9)},${ph(10)})`,
      [id, req.user.negocio_id, nombre, telefono||null, email||null,
       documento||null, direccion||null, notas||null, departamento||null, ciudad||null]
    );
    res.status(201).json({ id, nombre, telefono: telefono||null, email: email||null, documento: documento||null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Actualizar (solo administrador)
router.put('/clientes/:id', requireAdmin, async (req, res) => {
  try {
    const { nombre, telefono, email, documento, direccion, notas, activo, departamento, ciudad } = req.body;
    await pool.query(
      `UPDATE clientes SET nombre=${ph(1)}, telefono=${ph(2)}, email=${ph(3)},
       documento=${ph(4)}, direccion=${ph(5)}, notas=${ph(6)}, activo=${ph(7)},
       departamento=${ph(8)}, ciudad=${ph(9)}
       WHERE id=${ph(10)} AND negocio_id=${ph(11)}`,
      [nombre, telefono||null, email||null, documento||null, direccion||null, notas||null,
       activo !== undefined ? activo : 1, departamento||null, ciudad||null,
       req.params.id, req.user.negocio_id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Eliminar / desactivar (solo administrador)
router.delete('/clientes/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query(
      `UPDATE clientes SET activo=0 WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, req.user.negocio_id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
