/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * Agrega columna 'modulo' a la tabla inventario.
 * Valores: 'restaurante' | 'minimercado'
 * Ejecutar: node backend/migrate_inventario_modulo.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const conn_cfg = {
  host:     process.env.DB_HOST || '127.0.0.1',
  port:     parseInt(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'bunnydjpos',
};

(async () => {
  const con = await mysql.createConnection(conn_cfg);
  const [rows] = await con.execute(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='inventario' AND COLUMN_NAME='modulo'`,
    [conn_cfg.database]
  );
  if (rows.length) {
    console.log("  ⏭  columna 'modulo' ya existe");
  } else {
    await con.execute(
      `ALTER TABLE inventario ADD COLUMN modulo VARCHAR(30) NOT NULL DEFAULT 'restaurante'
       COMMENT 'restaurante | minimercado'`
    );
    console.log("  ✅ columna 'modulo' agregada (default: restaurante)");
  }
  await con.end();
  console.log('Migración completada.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
