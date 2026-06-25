/**
 * Agrega columna 'numero_empleado' a la tabla usuarios.
 * Es un número secuencial por negocio asignado al crear el empleado.
 * Ejecutar: node backend/migrate_empleado_numero.js
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

  const [rows] = await con.execute(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='usuarios' AND COLUMN_NAME='numero_empleado'`,
    [conn_cfg.database]
  );

  if (rows.length) {
    console.log("  ⏭  columna 'numero_empleado' ya existe");
  } else {
    await con.execute(
      `ALTER TABLE usuarios ADD COLUMN numero_empleado INT DEFAULT NULL
       COMMENT 'ID secuencial por negocio'`
    );
    console.log("  ✅ columna 'numero_empleado' agregada");

    // Asignar números a los empleados existentes ordenados por fecha de creación
    const [usuarios] = await con.execute(
      `SELECT id, negocio_id FROM usuarios ORDER BY negocio_id, creado`
    );
    const contadores = {};
    for (const u of usuarios) {
      const nid = u.negocio_id;
      contadores[nid] = (contadores[nid] || 0) + 1;
      await con.execute(
        `UPDATE usuarios SET numero_empleado=? WHERE id=?`,
        [contadores[nid], u.id]
      );
    }
    console.log(`  ✅ ${usuarios.length} empleados numerados`);
  }

  await con.end();
  console.log('Migración completada.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
