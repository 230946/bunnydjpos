/**
 * Agrega columna 'inventario_id' a menu_items para vincular
 * cada producto del menú a un artículo del inventario del admin.
 * Ejecutar: node migrate_menu_inventario.js  (desde la carpeta backend/)
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
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='menu_items' AND COLUMN_NAME='inventario_id'`,
    [cfg.database]
  );

  if (rows.length) {
    console.log("  ⏭  columna 'inventario_id' ya existe en menu_items");
  } else {
    await con.execute(
      `ALTER TABLE menu_items
       ADD COLUMN inventario_id VARCHAR(36) DEFAULT NULL,
       ADD CONSTRAINT fk_menu_inventario
         FOREIGN KEY (inventario_id) REFERENCES inventario(id) ON DELETE SET NULL`
    );
    console.log("  ✅ columna 'inventario_id' agregada a menu_items");
  }

  await con.end();
  console.log('Migración completada.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
