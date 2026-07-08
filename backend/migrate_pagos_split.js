/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mysql = require('mysql2/promise');
const cfg = { host: process.env.DB_HOST||'127.0.0.1', port: parseInt(process.env.DB_PORT||'3306'), user: process.env.DB_USER||'root', password: process.env.DB_PASS||'', database: process.env.DB_NAME||'bunnydjpos' };

(async () => {
  const con = await mysql.createConnection(cfg);
  const [cols] = await con.execute('SHOW COLUMNS FROM ventas');
  const existentes = new Set(cols.map(c => c.Field));

  const nuevas = [
    { nombre: 'monto_efectivo', ddl: 'DECIMAL(10,2) NOT NULL DEFAULT 0' },
    { nombre: 'monto_tarjeta',  ddl: 'DECIMAL(10,2) NOT NULL DEFAULT 0' },
    { nombre: 'monto_nequi',    ddl: 'DECIMAL(10,2) NOT NULL DEFAULT 0' },
  ];

  for (const col of nuevas) {
    if (existentes.has(col.nombre)) {
      console.log(`  [OK]  ${col.nombre} — ya existe`);
    } else {
      await con.execute(`ALTER TABLE ventas ADD COLUMN ${col.nombre} ${col.ddl}`);
      console.log(`  [ADD] ${col.nombre} — agregada`);
    }
  }

  // Backfill: ventas existentes con metodo_pago simple
  await con.execute(`UPDATE ventas SET monto_efectivo=total WHERE metodo_pago='efectivo' AND monto_efectivo=0`);
  await con.execute(`UPDATE ventas SET monto_tarjeta=total  WHERE metodo_pago='tarjeta'  AND monto_tarjeta=0`);
  await con.execute(`UPDATE ventas SET monto_nequi=total    WHERE metodo_pago='nequi'    AND monto_nequi=0`);
  console.log('  [OK]  Backfill completado');

  await con.end();
  console.log('\n✅ Migración pagos_split lista.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
