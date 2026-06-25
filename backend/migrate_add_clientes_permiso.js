/**
 * Agrega el permiso "clientes" a todos los roles existentes que ya tengan otros permisos.
 * Ejecutar: node migrate_add_clientes_permiso.js  (desde la carpeta backend/)
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
  const [rows] = await con.execute(`SELECT id, nombre, negocio_id, permisos FROM roles`);

  console.log(`Roles encontrados: ${rows.length}`);
  for (const row of rows) {
    let p = {};
    try { p = typeof row.permisos === 'string' ? JSON.parse(row.permisos) : (row.permisos || {}); } catch {}
    if (p.clientes) { console.log(`  [OK]  ${row.nombre} — ya tiene clientes`); continue; }
    p.clientes = true;
    await con.execute('UPDATE roles SET permisos = ? WHERE id = ?', [JSON.stringify(p), row.id]);
    console.log(`  [UPD] ${row.nombre} — permiso clientes agregado`);
  }

  await con.end();
  console.log('\n✅ Listo. Vuelve a iniciar sesión para que el token se actualice.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
