/**
 * Crea la tabla menu_item_recetas para productos compuestos (hamburguesas, etc.)
 * Ejecutar: node migrate_recetas.js  (desde la carpeta backend/)
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
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='menu_item_recetas'`,
    [cfg.database]
  );

  if (rows.length) {
    console.log("  ⏭  tabla 'menu_item_recetas' ya existe");
  } else {
    await con.execute(`
      CREATE TABLE menu_item_recetas (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        menu_item_id VARCHAR(36)    NOT NULL,
        negocio_id   VARCHAR(36)    NOT NULL,
        inventario_id VARCHAR(36)   NOT NULL,
        cantidad     DECIMAL(12,3)  NOT NULL DEFAULT 1,
        FOREIGN KEY (menu_item_id)  REFERENCES menu_items(id)  ON DELETE CASCADE,
        FOREIGN KEY (negocio_id)    REFERENCES negocios(id)    ON DELETE CASCADE,
        FOREIGN KEY (inventario_id) REFERENCES inventario(id)  ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("  ✅ tabla 'menu_item_recetas' creada");
  }

  await con.end();
  console.log('Migración completada.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
