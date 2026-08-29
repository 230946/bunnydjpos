/**
 * Crea (o resetea la contraseña de) el primer usuario admin.
 * Uso: node seed-admin.js <username> <password> ["Nombre completo"]
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { pool } = require('./db');

(async () => {
  const [,, username, password, nombre] = process.argv;
  if (!username || !password) {
    console.log('Uso: node seed-admin.js <username> <password> ["Nombre completo"]');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(`SELECT id FROM usuarios WHERE username=?`, [username]);
  if (rows[0]) {
    await pool.query(`UPDATE usuarios SET password_hash=?, rol='admin', activo=1 WHERE username=?`, [hash, username]);
    console.log(`Contraseña actualizada para admin existente: ${username}`);
  } else {
    await pool.query(
      `INSERT INTO usuarios (id, nombre, username, password_hash, rol) VALUES (?,?,?,?,'admin')`,
      [uuid(), nombre || username, username, hash]
    );
    console.log(`Admin creado: ${username}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
