/**
 * Agrega columna 'unidad_compra' a inventario
 * Permite definir la unidad de compra (ej: kg, litro, caja) con su factor de conversión
 * Ejecutar: node migrate_unidad_compra.js  (desde la carpeta backend/)
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const cfg = {
  host:     process.env.DB_HOST || '127.0.0.1',
  port:     parseInt(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'bunnydjpos',
};

(async () => {
  const con = await mysql.createConnection(cfg);
  const [rows] = await con.execute(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='inventario' AND COLUMN_NAME='unidad_compra'`,
    [cfg.database]
  );
  if (rows.length) {
    console.log("  ⏭  columna 'unidad_compra' ya existe");
  } else {
    await con.execute(`ALTER TABLE inventario ADD COLUMN unidad_compra VARCHAR(30) DEFAULT NULL AFTER unidad`);
    console.log("  ✅ columna 'unidad_compra' agregada");
  }
  await con.end();
  console.log('Migración completada.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
