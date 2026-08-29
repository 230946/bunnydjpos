/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * Convierte menu_categorias.modulo de ENUM('pos','minimercado','bar') a
 * VARCHAR(30), igual que inventario.modulo y ventas.tipo — para que un
 * nuevo tipo de negocio (ej. 'ferreteria') no necesite otra migración de
 * esquema solo para poder usar este campo.
 * Ejecutar: node backend/migrate_menu_categorias_modulo_varchar.js
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
    `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='menu_categorias' AND COLUMN_NAME='modulo'`,
    [conn_cfg.database]
  );
  if (!rows.length) {
    console.log("  ⏭  columna 'modulo' no existe en menu_categorias, nada que hacer");
  } else if (rows[0].DATA_TYPE !== 'enum') {
    console.log(`  ⏭  columna 'modulo' ya es ${rows[0].DATA_TYPE}, no es ENUM`);
  } else {
    await con.execute(
      `ALTER TABLE menu_categorias MODIFY COLUMN modulo VARCHAR(30) DEFAULT NULL
       COMMENT 'NULL=todos | restaurante | minimercado | bar | ferreteria | ...'`
    );
    console.log("  ✅ menu_categorias.modulo convertida de ENUM a VARCHAR(30)");
  }
  await con.end();
  console.log('Migración completada.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
