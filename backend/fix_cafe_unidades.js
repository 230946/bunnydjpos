/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * Corrige la unidad base de "Cafe" de "kg" a "g"
 * y "Leche en Bolsa" si su unidad base está mal.
 * Ejecutar: node fix_cafe_unidades.js
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

  // Ver el estado actual de los artículos con empaque
  const [rows] = await con.execute(
    `SELECT id, nombre, unidad, unidad_compra, cantidad_paquete, stock
     FROM inventario WHERE unidad_compra IS NOT NULL AND unidad_compra != ''`
  );

  console.log('\n=== ARTÍCULOS CON EMPAQUE ===');
  for (const r of rows) {
    console.log(`  ${r.nombre}: unidad="${r.unidad}", unidad_compra="${r.unidad_compra}", factor=${r.cantidad_paquete}, stock_bd=${r.stock}`);
  }

  // Correcciones manuales:
  const fixes = [
    { nombre: 'Cafe',              unidad_nueva: 'g'        },
    { nombre: 'Pan Hamburguesa',   unidad_nueva: 'unidades' },
    { nombre: 'Salchichas',        unidad_nueva: 'unidades' },
    { nombre: 'Carne Hamburguesa', unidad_nueva: 'unidades' },
  ];

  // Aplicar fixes si los hay
  for (const fix of fixes) {
    const [r] = await con.execute(`SELECT id, unidad FROM inventario WHERE nombre=?`, [fix.nombre]);
    if (r[0]) {
      await con.execute(`UPDATE inventario SET unidad=? WHERE id=?`, [fix.unidad_nueva, r[0].id]);
      console.log(`  ✅ ${fix.nombre}: unidad actualizada de "${r[0].unidad}" → "${fix.unidad_nueva}"`);
    }
  }

  await con.end();
  console.log('\n✅ Listo.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
