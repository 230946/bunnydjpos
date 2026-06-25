/**
 * Agrega tabla 'clientes' y columna 'cliente_id' a ventas.
 * Ejecutar: node migrate_clientes.js  (desde la carpeta backend/)
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

  // 1. Crear tabla clientes
  const [tablaEx] = await con.execute(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='clientes'`,
    [cfg.database]
  );
  if (tablaEx.length) {
    console.log("  ⏭  tabla 'clientes' ya existe");
  } else {
    await con.execute(`
      CREATE TABLE clientes (
        id          VARCHAR(36)  NOT NULL PRIMARY KEY,
        negocio_id  VARCHAR(36)  NOT NULL,
        nombre      VARCHAR(120) NOT NULL,
        telefono    VARCHAR(30)  DEFAULT NULL,
        email       VARCHAR(120) DEFAULT NULL,
        documento   VARCHAR(30)  DEFAULT NULL,
        direccion   VARCHAR(200) DEFAULT NULL,
        notas       TEXT         DEFAULT NULL,
        activo      TINYINT(1)   NOT NULL DEFAULT 1,
        creado      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        actualizado TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE,
        INDEX idx_clientes_negocio (negocio_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("  ✅ tabla 'clientes' creada");
  }

  // 2. Agregar cliente_id a ventas
  const [colEx] = await con.execute(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='ventas' AND COLUMN_NAME='cliente_id'`,
    [cfg.database]
  );
  if (colEx.length) {
    console.log("  ⏭  columna 'cliente_id' en ventas ya existe");
  } else {
    await con.execute(
      `ALTER TABLE ventas ADD COLUMN cliente_id VARCHAR(36) DEFAULT NULL`
    );
    console.log("  ✅ columna 'cliente_id' agregada a ventas");
  }

  await con.end();
  console.log('Migración completada.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
