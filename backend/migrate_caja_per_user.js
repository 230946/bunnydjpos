/**
 * Cambia la restricción UNIQUE de cajas de (negocio_id, fecha)
 * a (negocio_id, fecha, usuario_id) para permitir una caja por usuario por día.
 * Ejecutar: node backend/migrate_caja_per_user.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
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

  // Buscar el nombre del índice UNIQUE actual sobre (negocio_id, fecha)
  const [indexes] = await con.execute(
    `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='cajas' AND CONSTRAINT_TYPE='UNIQUE'`,
    [conn_cfg.database]
  );

  for (const idx of indexes) {
    const name = idx.CONSTRAINT_NAME || idx.constraint_name;
    // Eliminar solo el índice que NO sea el nuevo (por si la migración ya corrió)
    if (name && name !== 'uq_caja_usuario') {
      console.log(`  🗑  Eliminando índice único '${name}'...`);
      await con.execute(`ALTER TABLE cajas DROP INDEX \`${name}\``);
    }
  }

  // Verificar si el nuevo índice ya existe
  const [nuevoIdx] = await con.execute(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='cajas' AND CONSTRAINT_NAME='uq_caja_usuario'`,
    [conn_cfg.database]
  );

  if (nuevoIdx.length) {
    console.log("  ⏭  Índice 'uq_caja_usuario' ya existe");
  } else {
    await con.execute(
      `ALTER TABLE cajas ADD UNIQUE KEY uq_caja_usuario (negocio_id, fecha, usuario_id)`
    );
    console.log("  ✅ Índice único (negocio_id, fecha, usuario_id) creado");
  }

  await con.end();
  console.log('Migración completada.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
