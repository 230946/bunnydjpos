// Carga ventas atrasadas de un bar (una línea «Cerveza» por el total del día)
// y las suma a la caja de ese día, como hace DJPOS al cobrar un fiado atrasado.
//
// Uso (desde la carpeta backend del servidor):
//   node scripts/cargar-ventas-bar.js "Nombre del bar"            -> solo muestra lo que haría
//   node scripts/cargar-ventas-bar.js "Nombre del bar" --aplicar  -> lo graba
//
// Reparto por método de pago: edita efectivo / nequi / tarjeta de cada día.
// La suma de los tres debe dar el total del día.
const { pool, ph } = require('../db.js');
const { v4: uuid } = (() => { try { return require('uuid'); } catch { return { v4: () => require('crypto').randomUUID() }; } })();

const DIAS = [
  { fecha: '2026-11-11', total: 425000, efectivo: 425000, nequi: 0, tarjeta: 0 },
  { fecha: '2026-11-12', total: 315000, efectivo: 315000, nequi: 0, tarjeta: 0 },
  { fecha: '2026-11-13', total: 431000, efectivo: 431000, nequi: 0, tarjeta: 0 },
  { fecha: '2026-11-14', total: 611000, efectivo: 611000, nequi: 0, tarjeta: 0 },
];
const HORA = '22:00:00'; // hora local (Bogotá) con la que queda registrada cada venta

(async () => {
  const nombre = process.argv[2];
  const aplicar = process.argv.includes('--aplicar');
  if (!nombre) throw new Error('Falta el nombre del bar: node scripts/cargar-ventas-bar.js "Nombre" [--aplicar]');

  for (const d of DIAS)
    if (d.efectivo + d.nequi + d.tarjeta !== d.total)
      throw new Error(`${d.fecha}: efectivo+nequi+tarjeta no suma ${d.total}`);

  const { rows: negs } = await pool.query(
    `SELECT id, nombre, tipo FROM negocios WHERE nombre LIKE ${ph(1)}`, [`%${nombre}%`]);
  if (negs.length !== 1) {
    console.table(negs);
    throw new Error(negs.length ? 'Hay varios negocios con ese nombre; sé más específico.' : 'No encontré ese negocio.');
  }
  const neg = negs[0];
  console.log(`Negocio: ${neg.nombre} (${neg.id})  ${aplicar ? '— APLICANDO' : '— prueba, no se graba nada'}\n`);

  const { rows: cnt } = await pool.query(`SELECT COUNT(*) AS n FROM ventas WHERE negocio_id=${ph(1)}`, [neg.id]);
  let consecutivo = +cnt[0].n || 0;

  for (const d of DIAS) {
    const factura = `MAN-${d.fecha.replace(/-/g, '')}`;
    const { rows: ya } = await pool.query(
      `SELECT id FROM ventas WHERE negocio_id=${ph(1)} AND numero_factura=${ph(2)}`, [neg.id, factura]);
    if (ya.length) { console.log(`${d.fecha}: ya existe ${factura}, lo salto.`); continue; }

    const { rows: cajas } = await pool.query(
      `SELECT id, estado, total_ventas, usuario_id FROM cajas WHERE negocio_id=${ph(1)} AND fecha=${ph(2)}`, [neg.id, d.fecha]);
    const caja = cajas[0];
    console.log(`${d.fecha}: venta ${factura} por $${d.total.toLocaleString('es-CO')} ` +
      `(ef ${d.efectivo}, nequi ${d.nequi}, tarj ${d.tarjeta}) → ` +
      (caja ? `caja ${caja.estado}, ventas ${caja.total_ventas} → ${+caja.total_ventas + d.total}`
            : 'SIN CAJA ese día: la venta queda en reportes pero no en el cuadre de caja'));
    if (!aplicar) continue;

    const metodo = d.efectivo === d.total ? 'efectivo' : d.nequi === d.total ? 'nequi' : d.tarjeta === d.total ? 'tarjeta' : 'mixto';
    const items = JSON.stringify([{ item_id: null, nombre: 'Cerveza', precio: d.total, qty: 1 }]);
    consecutivo++;
    await pool.query(
      `INSERT INTO ventas (id,negocio_id,tipo,cliente_nombre,items,subtotal,descuento,iva,total,
        metodo_pago,recibido,cambio,numero_factura,cajero_id,estado,
        monto_efectivo,monto_tarjeta,monto_nequi,creado)
       VALUES (${ph(1)},${ph(2)},'bar','Venta registrada a mano',${ph(3)},${ph(4)},0,0,${ph(5)},
        ${ph(6)},${ph(7)},0,${ph(8)},${ph(9)},'pagada',${ph(10)},${ph(11)},${ph(12)},${ph(13)})`,
      [uuid(), neg.id, items, d.total, d.total, metodo, d.total, factura, caja?.usuario_id || null,
       d.efectivo, d.tarjeta, d.nequi, `${d.fecha} ${HORA}`]);
    if (caja)
      await pool.query(
        `UPDATE cajas SET total_ventas=total_ventas+${ph(1)}, total_efectivo=total_efectivo+${ph(2)},
           total_tarjeta=total_tarjeta+${ph(3)}, total_nequi=total_nequi+${ph(4)} WHERE id=${ph(5)}`,
        [d.total, d.efectivo, d.tarjeta, d.nequi, caja.id]);
  }
  console.log(aplicar ? '\nListo.' : '\nNada grabado. Repite con --aplicar para grabarlo.');
  process.exit(0);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
