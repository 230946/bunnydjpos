const router  = require('express').Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { registrarFichaje, hoyStr } = require('../lib/fichar');

router.use(authMiddleware);

// Las pausas (almuerzo/cena) solo se registran físicamente en el kiosco de QR
// (/api/kiosco/marcar) — desde el portal el empleado solo puede marcar su
// entrada y salida del día, para que la pausa quede ligada a estar presente
// frente al kiosco y no a un simple toque en el celular.
router.post('/marcar', async (req, res) => {
  try {
    const { accion } = req.body;
    if (!['entrada', 'salida'].includes(accion)) {
      return res.status(400).json({ error: "Desde el portal solo puedes marcar entrada o salida. Las pausas se registran en el kiosco." });
    }
    const resultado = await registrarFichaje(req.user.id, accion);
    res.json({ ok: true, ...resultado });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// GET /hoy — estado del fichaje de hoy del usuario autenticado
router.get('/hoy', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM fichajes WHERE usuario_id=? AND fecha=?`, [req.user.id, hoyStr()]
    );
    res.json(rows[0] || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /historial?usuario_id&desde&hasta — admin ve todos, empleado solo lo suyo
router.get('/historial', async (req, res) => {
  try {
    const esAdmin = req.user.rol === 'admin';
    const hasta = req.query.hasta || hoyStr();
    const d = new Date((req.query.desde || hasta) + 'T12:00:00');
    const desde = req.query.desde || (() => { d.setDate(d.getDate() - 30); return d.toISOString().slice(0,10); })();

    const params = [desde, hasta];
    let filtroUsuario = '';
    if (esAdmin && req.query.usuario_id) { filtroUsuario = ' AND f.usuario_id=?'; params.push(req.query.usuario_id); }
    else if (!esAdmin) { filtroUsuario = ' AND f.usuario_id=?'; params.push(req.user.id); }

    const { rows } = await pool.query(`
      SELECT f.*, u.nombre AS usuario_nombre, t.nombre AS turno_nombre
      FROM fichajes f
      JOIN usuarios u ON u.id = f.usuario_id
      LEFT JOIN turnos t ON t.id = f.turno_id
      WHERE f.fecha BETWEEN ? AND ?${filtroUsuario}
      ORDER BY f.fecha DESC, u.nombre
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
