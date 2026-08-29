const router  = require('express').Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM notificaciones WHERE usuario_id=? ORDER BY creado DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/leida', async (req, res) => {
  try {
    await pool.query(
      `UPDATE notificaciones SET leido=1 WHERE id=? AND usuario_id=?`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/leer-todas', async (req, res) => {
  try {
    await pool.query(`UPDATE notificaciones SET leido=1 WHERE usuario_id=?`, [req.user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
