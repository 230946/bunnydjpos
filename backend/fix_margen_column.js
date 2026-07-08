/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mysql = require('mysql2/promise');
const cfg = { host: process.env.DB_HOST||'127.0.0.1', port: parseInt(process.env.DB_PORT||'3306'), user: process.env.DB_USER||'root', password: process.env.DB_PASS||'', database: process.env.DB_NAME||'bunnydjpos' };
mysql.createConnection(cfg).then(async con => {
  await con.execute('ALTER TABLE inventario MODIFY COLUMN margen DECIMAL(10,2) NULL');
  console.log('✅ Columna margen ampliada a DECIMAL(10,2) — soporta hasta 99.999.999,99%');
  await con.end();
}).catch(e => { console.error('Error:', e.message); process.exit(1); });
