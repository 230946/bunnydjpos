/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * Agrega columnas faltantes a la tabla inventario:
 *   - margen DECIMAL(10,2)
 *   - es_paquete TINYINT(1)
 *   - cantidad_paquete INT
 *   - unidad_compra VARCHAR(60)
 *   - modulo VARCHAR(40)
 *   - descripcion TEXT
 * Ejecutar: node migrate_add_margen.js  (desde la carpeta backend/)
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

const columnas = [
  { nombre: 'margen',          ddl: 'DECIMAL(10,2) NULL' },
  { nombre: 'es_paquete',      ddl: 'TINYINT(1) NOT NULL DEFAULT 0' },
  { nombre: 'cantidad_paquete',ddl: 'INT NULL' },
  { nombre: 'unidad_compra',   ddl: 'VARCHAR(60) NULL' },
  { nombre: 'modulo',          ddl: "VARCHAR(40) NOT NULL DEFAULT 'restaurante'" },
  { nombre: 'descripcion',     ddl: 'TEXT NULL' },
];

(async () => {
  const con = await mysql.createConnection(cfg);

  // Consultar columnas existentes
  const [cols] = await con.execute(`SHOW COLUMNS FROM inventario`);
  const existentes = new Set(cols.map(c => c.Field));

  for (const col of columnas) {
    if (existentes.has(col.nombre)) {
      console.log(`  [OK]  ${col.nombre} — ya existe`);
    } else {
      await con.execute(`ALTER TABLE inventario ADD COLUMN ${col.nombre} ${col.ddl}`);
      console.log(`  [ADD] ${col.nombre} — columna agregada`);
    }
  }

  await con.end();
  console.log('\n✅ Migración completada.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
