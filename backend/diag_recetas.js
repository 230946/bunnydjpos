/**
 * Diagnóstico de recetas: muestra qué items del menú tienen receta
 * y qué porciones calcula el motor.
 * Ejecutar: node diag_recetas.js  (desde la carpeta backend/)
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

  // 1. Recetas registradas
  console.log('\n=== RECETAS EN BD ===');
  const [recetas] = await con.execute(`
    SELECT mir.id, mir.menu_item_id, mir.inventario_id, mir.cantidad,
           mi.nombre AS menu_nombre,
           inv.id AS inv_real_id, inv.nombre AS inv_nombre, inv.stock, inv.unidad, inv.activo
    FROM menu_item_recetas mir
    LEFT JOIN menu_items mi  ON mi.id  = mir.menu_item_id
    LEFT JOIN inventario inv ON inv.id = mir.inventario_id
    ORDER BY mi.nombre
  `);
  if (!recetas.length) { console.log('  Sin recetas en la BD.'); }
  for (const r of recetas) {
    const match = r.inv_real_id ? '✅' : '❌ NO COINCIDE';
    console.log(`  [${r.menu_nombre}] → ingrediente: ${r.inv_nombre || '(null)'} ${match}`);
    console.log(`      inventario_id en receta: ${r.inventario_id}`);
    console.log(`      inv.id real:             ${r.inv_real_id || 'NO ENCONTRADO'}`);
    console.log(`      cantidad: ${r.cantidad}  |  stock: ${r.stock}  |  activo: ${r.activo}`);
    if (r.inv_real_id && r.cantidad > 0) {
      const porciones = Math.floor(r.stock / r.cantidad);
      console.log(`      → porciones calculadas: ${porciones}`);
    } else if (r.cantidad == 0 || r.cantidad == null) {
      console.log(`      ⚠️  cantidad es 0 o null → FLOOR(stock/0) = NULL`);
    }
  }

  // 2. Calcular receta_porciones tal como lo hace el POS
  console.log('\n=== PORCIONES CALCULADAS POR EL POS ===');
  const [porciones] = await con.execute(`
    SELECT mi.nombre,
           (SELECT COUNT(*) FROM menu_item_recetas r WHERE r.menu_item_id = mi.id) AS receta_count,
           (SELECT FLOOR(MIN(inv2.stock / r2.cantidad))
            FROM menu_item_recetas r2
            JOIN inventario inv2 ON inv2.id = r2.inventario_id
            WHERE r2.menu_item_id = mi.id) AS receta_porciones
    FROM menu_items mi
    WHERE (SELECT COUNT(*) FROM menu_item_recetas r WHERE r.menu_item_id = mi.id) > 0
  `);
  for (const p of porciones) {
    console.log(`  ${p.nombre}: receta_count=${p.receta_count}, receta_porciones=${p.receta_porciones}`);
  }

  await con.end();
  console.log('\n✅ Diagnóstico completado.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
