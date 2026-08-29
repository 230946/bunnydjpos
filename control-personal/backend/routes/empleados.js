const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const QRCode  = require('qrcode');
const { v4: uuid } = require('uuid');
const { pool } = require('../db');
const { authMiddleware, requireAdmin } = require('../middleware/auth');

router.use(authMiddleware, requireAdmin);

router.get('/', async (_, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, documento, email, username, rol, cargo, activo, creado FROM usuarios ORDER BY nombre`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { nombre, documento, email, username, password, rol, cargo } = req.body;
    if (!nombre || !username || !password) {
      return res.status(400).json({ error: 'nombre, username y password son requeridos' });
    }
    const id = uuid();
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO usuarios (id, nombre, documento, codigo_qr, email, username, password_hash, rol, cargo)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, nombre, documento || null, uuid(), email || null, username, hash, rol === 'admin' ? 'admin' : 'empleado', cargo || null]
    );
    res.status(201).json({ id });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email o username ya registrado' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { nombre, documento, email, username, rol, cargo, activo, password } = req.body;
    await pool.query(
      `UPDATE usuarios SET nombre=?, documento=?, email=?, username=?, rol=?, cargo=?, activo=? WHERE id=?`,
      [nombre, documento || null, email || null, username, rol === 'admin' ? 'admin' : 'empleado', cargo || null, activo ? 1 : 0, req.params.id]
    );
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      await pool.query(`UPDATE usuarios SET password_hash=? WHERE id=?`, [hash, req.params.id]);
    }
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email o username ya registrado' });
    res.status(500).json({ error: e.message });
  }
});

// Imagen QR (PNG en data URL) para imprimir/mostrar el carné del empleado.
// El QR codifica su codigo_qr, no su documento, para que no se pueda falsificar
// conociendo la cédula de la persona.
router.get('/:id/qr', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT nombre, codigo_qr FROM usuarios WHERE id=?`, [req.params.id]);
    const u = rows[0];
    if (!u) return res.status(404).json({ error: 'Empleado no encontrado' });
    let codigo_qr = u.codigo_qr;
    if (!codigo_qr) {
      codigo_qr = uuid();
      await pool.query(`UPDATE usuarios SET codigo_qr=? WHERE id=?`, [codigo_qr, req.params.id]);
    }
    const dataUrl = await QRCode.toDataURL(codigo_qr, { width: 300, margin: 2 });
    res.json({ nombre: u.nombre, dataUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query(`UPDATE usuarios SET activo=0 WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
