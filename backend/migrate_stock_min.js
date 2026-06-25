/**
 * migrate_stock_min.js
 * Agrega stock_min a menu_items si no existe.
 * Ejecutar una sola vez: node backend/migrate_stock_min.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('./db');

async function run() {
  const col = await pool.query(`
    SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='menu_items' AND COLUMN_NAME='stock_min'
  `);
  if (+col.rows[0].n > 0) {
    console.log('✅ stock_min ya existe en menu_items — nada que hacer');
  } else {
    await pool.query(`ALTER TABLE menu_items ADD COLUMN stock_min INT NOT NULL DEFAULT 0 AFTER stock`);
    console.log('✅ Columna stock_min agregada a menu_items');
  }
  process.exit(0);
}

run().catch(e => { console.error('Error:', e.message); process.exit(1); });
