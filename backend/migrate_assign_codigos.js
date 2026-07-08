/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * Asigna códigos COD-001, COD-002... a todos los artículos de inventario.
 * - Los que ya tienen código conservan su número (si no hay duplicado).
 * - Los NULL reciben el siguiente consecutivo disponible.
 * - Los duplicados se corrigen con nuevos números.
 * Ejecutar: node migrate_assign_codigos.js  (desde la carpeta backend/)
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

  // Traer todos los artículos ordenados: los que ya tienen COD primero (por número), luego los NULL (por nombre)
  const [rows] = await con.execute(`
    SELECT id, nombre, codigo
    FROM inventario
    ORDER BY
      CASE WHEN codigo IS NOT NULL AND codigo REGEXP '^COD-[0-9]+$' THEN 0 ELSE 1 END,
      CASE WHEN codigo IS NOT NULL AND codigo REGEXP '^COD-[0-9]+$'
           THEN CAST(SUBSTRING(codigo, 5) AS UNSIGNED) END ASC,
      nombre ASC
  `);

  console.log(`Total artículos: ${rows.length}`);

  let counter = 1;
  const usados = new Set();

  for (const row of rows) {
    // Intentar respetar el número actual si es válido y no está duplicado
    let num = null;
    if (row.codigo && /^COD-\d+$/.test(row.codigo)) {
      const n = parseInt(row.codigo.replace('COD-', ''), 10);
      if (!usados.has(n)) {
        num = n;
      }
    }
    if (num === null) {
      // Buscar el próximo número libre
      while (usados.has(counter)) counter++;
      num = counter;
      counter++;
    }
    usados.add(num);
    const nuevoCodigo = `COD-${String(num).padStart(3, '0')}`;
    await con.execute('UPDATE inventario SET codigo = ? WHERE id = ?', [nuevoCodigo, row.id]);
    console.log(`  ${row.nombre.padEnd(30)} ${row.codigo || '(NULL)'} → ${nuevoCodigo}`);
  }

  await con.end();
  console.log('\n✅ Códigos asignados correctamente.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
