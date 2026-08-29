const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { pool } = require('../db');

router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

    const { rows } = await pool.query(
      `SELECT * FROM usuarios WHERE (email=? OR username=?) AND activo=1 LIMIT 1`,
      [login, login]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const token = jwt.sign(
      { id: user.id, nombre: user.nombre, rol: user.rol },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({
      token,
      user: { id: user.id, nombre: user.nombre, rol: user.rol, cargo: user.cargo }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
