/**
 * Agrega permiso 'inventario_borrar: true' a todos los roles
 * que ya tienen 'inventario: true'.
 * Ejecutar: node backend/migrate_inventario_borrar.js
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

(async () => {
  const con = await mysql.createConnection(conn_cfg);
  const [roles] = await con.execute('SELECT id, nombre, permisos FROM roles');
  let actualizados = 0;
  for (const rol of roles) {
    let p = {};
    try { p = typeof rol.permisos === 'string' ? JSON.parse(rol.permisos) : (rol.permisos || {}); } catch {}
    if (p.inventario) {
      p.inventario_borrar = true;
      await con.execute('UPDATE roles SET permisos=? WHERE id=?', [JSON.stringify(p), rol.id]);
      console.log(`  ✅ Rol "${rol.nombre}" → inventario_borrar: true`);
      actualizados++;
    }
  }
  await con.end();
  if (!actualizados) console.log('  ⚠️  Ningún rol tiene permiso "inventario". Otorga el permiso al rol admin primero.');
  else console.log(`\nListo. ${actualizados} rol(es) actualizado(s).`);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
