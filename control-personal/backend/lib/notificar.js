const { v4: uuid } = require('uuid');
const { pool } = require('../db');

async function crearNotificacion(usuario_id, mensaje) {
  if (!usuario_id) return;
  await pool.query(
    `INSERT INTO notificaciones (id, usuario_id, mensaje) VALUES (?, ?, ?)`,
    [uuid(), usuario_id, mensaje]
  );
}

module.exports = { crearNotificacion };
