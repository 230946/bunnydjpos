require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mysql = require('mysql2/promise');
const cfg = { host: process.env.DB_HOST||'127.0.0.1', port: parseInt(process.env.DB_PORT||'3306'), user: process.env.DB_USER||'root', password: process.env.DB_PASS||'', database: process.env.DB_NAME||'bunnydjpos' };

(async () => {
  const con = await mysql.createConnection(cfg);
  const [cols] = await con.execute('SHOW COLUMNS FROM clientes');
  const ex = new Set(cols.map(c => c.Field));
  const nuevas = [
    { nombre: 'departamento', ddl: "VARCHAR(80) NULL" },
    { nombre: 'ciudad',       ddl: "VARCHAR(80) NULL" },
  ];
  for (const col of nuevas) {
    if (ex.has(col.nombre)) console.log(`  [OK]  ${col.nombre} — ya existe`);
    else { await con.execute(`ALTER TABLE clientes ADD COLUMN ${col.nombre} ${col.ddl}`); console.log(`  [ADD] ${col.nombre} — agregada`); }
  }
  await con.end();
  console.log('\n✅ Listo.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
