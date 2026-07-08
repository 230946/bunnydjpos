/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * Agrega columnas: descripcion, margen, es_paquete, cantidad_paquete
 * a la tabla inventario.
 * Ejecutar: node backend/migrate_inventario_campos.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const conn_cfg = {
  host:     process.env.DB_HOST || '127.0.0.1',
  port:     parseInt(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'bunnydjpos',
};

const columns = [
  { name: 'descripcion',      def: 'TEXT NULL' },
  { name: 'margen',           def: 'DECIMAL(6,2) NULL COMMENT "Margen ganancia %"' },
  { name: 'es_paquete',       def: 'TINYINT(1) NOT NULL DEFAULT 0' },
  { name: 'cantidad_paquete', def: 'INT NULL COMMENT "Unidades por paquete"' },
];

(async () => {
  const con = await mysql.createConnection(conn_cfg);
  for (const col of columns) {
    const [rows] = await con.execute(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME='inventario' AND COLUMN_NAME=?`,
      [conn_cfg.database, col.name]
    );
    if (rows.length) {
      console.log(`  ⏭  '${col.name}' ya existe`);
    } else {
      await con.execute(`ALTER TABLE inventario ADD COLUMN ${col.name} ${col.def}`);
      console.log(`  ✅ '${col.name}' agregada`);
    }
  }
  await con.end();
  console.log('Migración completada.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
