/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * Agrega columnas faltantes a la tabla inventario:
 * descripcion, margen, es_paquete, cantidad_paquete, modulo
 * Ejecutar: node migrate_inventario_columns.js  (desde la carpeta backend/)
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

async function columnExists(con, table, column) {
  const [rows] = await con.execute(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [cfg.database, table, column]
  );
  return rows.length > 0;
}

(async () => {
  const con = await mysql.createConnection(cfg);

  const columns = [
    { name: 'descripcion',      def: 'VARCHAR(500) DEFAULT NULL'              },
    { name: 'margen',           def: 'DECIMAL(5,2) DEFAULT NULL'              },
    { name: 'es_paquete',       def: 'TINYINT(1) NOT NULL DEFAULT 0'          },
    { name: 'cantidad_paquete', def: 'DECIMAL(12,3) DEFAULT NULL'             },
    { name: 'modulo',           def: "VARCHAR(50) NOT NULL DEFAULT 'restaurante'" },
  ];

  for (const col of columns) {
    if (await columnExists(con, 'inventario', col.name)) {
      console.log(`  ⏭  columna '${col.name}' ya existe`);
    } else {
      await con.execute(`ALTER TABLE inventario ADD COLUMN ${col.name} ${col.def}`);
      console.log(`  ✅ columna '${col.name}' agregada`);
    }
  }

  await con.end();
  console.log('Migración completada.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
