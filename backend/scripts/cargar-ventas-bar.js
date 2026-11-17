// Completa las ventas de días pasados de un bar: carga una venta «Cerveza» por
// lo que falta para llegar al total real de cada día y la suma a la caja de ese
// día. Si el día no tiene caja, crea una caja ya cerrada con esa venta.
//
// Uso (desde la carpeta backend del servidor):
//   node scripts/cargar-ventas-bar.js "Nombre del bar"            -> solo muestra lo que haría
//   node scripts/cargar-ventas-bar.js "Nombre del bar" --aplicar  -> lo graba
//
// total  = total real del día (referencia)
// cargar = lo que falta registrar; efectivo + nequi + tarjeta debe sumar «cargar»
const { pool, ph } = require('../db.js');
const crypto = require('crypto');

const DIAS = [
  { fecha: '2026-11-11', total: 425000, cargar: 117900, efectivo: 117900, nequi: 0, tarjeta: 0 },
  { fecha: '2026-11-12', total: 315000, cargar: 219000, efectivo: 219000, nequi: 0, tarjeta: 0 },
  { fecha: '2026-11-13', total: 431000, cargar: 431000, efectivo: 431000, nequi: 0, tarjeta: 0 },
  { fecha: '2026-11-14', total: 611000, cargar: 611000, efectivo: 611000, nequi: 0, tarjeta: 0 },
];
const HORA = '22:00:00'; // hora local (Bogotá) con la que queda registrada cada venta
const $ = n => '$' + Math.round(+n).toLocaleString('es-CO');

(async () => {
  const nombre = process.argv[2];
  const aplicar = process.argv.includes('--aplicar');
  if (!nombre) throw new Error('Falta el nombre del bar: node scripts/cargar-ventas-bar.js "Nombre" [--aplicar]');

  for (const d of DIAS)
    if (d.efectivo + d.nequi + d.tarjeta !== d.cargar)
      throw new Error(`${d.fecha}: efectivo+nequi+tarjeta no suma ${d.cargar}`);

  const { rows: negs } = await pool.query(
    `SELECT id, nombre FROM negocios WHERE nombre LIKE ${ph(1)}`, [`%${nombre}%`]);
  if (negs.length !== 1) {
    console.table(negs);
    throw new Error(negs.length ? 'Hay varios negocios con ese nombre; sé más específico.' : 'No encontré ese negocio.');
  }
  const neg = negs[0];
  console.log(`Negocio: ${neg.nombre} (${neg.id})  ${aplicar ? '— APLICANDO' : '— prueba, no se graba nada'}\n`);

  // Usuario al que se le asignan las cajas nuevas: el de la caja más reciente del bar.
  const { rows: ult } = await pool.query(
    `SELECT usuario_id FROM cajas WHERE negocio_id=${ph(1)} ORDER BY fecha DESC LIMIT 1`, [neg.id]);
  const usuarioCaja = ult[0]?.usuario_id || null;

  for (const d of DIAS) {
    const factura = `MAN-${d.fecha.replace(/-/g, '')}`;
    const { rows: ya } = await pool.query(
      `SELECT id FROM ventas WHERE negocio_id=${ph(1)} AND numero_factura=${ph(2)}`, [neg.id, factura]);
    if (ya.length) { console.log(`${d.fecha}: ya existe ${factura}, lo salto.`); continue; }

    const { rows: cajas } = await pool.query(
      `SELECT id, estado, total_ventas, usuario_id FROM cajas WHERE negocio_id=${ph(1)} AND fecha=${ph(2)}`, [neg.id, d.fecha]);
    const caja = cajas[0];
    const antes = caja ? +caja.total_ventas : 0;
    console.log(`${d.fecha}: venta ${factura} por ${$(d.cargar)} (ef ${d.efectivo}, nequi ${d.nequi}, tarj ${d.tarjeta}) → ` +
      (caja ? `caja ${caja.estado}: ${$(antes)} → ${$(antes + d.cargar)}`
            : `crea caja cerrada con ${$(d.cargar)}`) +
      (antes + d.cargar === d.total ? '  ✓ cuadra' : `  ⚠ no da el total ${$(d.total)}`));
    if (!aplicar) continue;

    const metodo = d.efectivo === d.cargar ? 'efectivo' : d.nequi === d.cargar ? 'nequi' : d.tarjeta === d.cargar ? 'tarjeta' : 'mixto';
    const items = JSON.stringify([{ item_id: null, nombre: 'Cerveza', precio: d.cargar, qty: 1 }]);
    const cajero = caja?.usuario_id || usuarioCaja;
    await pool.query(
      `INSERT INTO ventas (id,negocio_id,tipo,cliente_nombre,items,subtotal,descuento,iva,total,
        metodo_pago,recibido,cambio,numero_factura,cajero_id,estado,
        monto_efectivo,monto_tarjeta,monto_nequi,creado)
       VALUES (${ph(1)},${ph(2)},'bar','Venta registrada a mano',${ph(3)},${ph(4)},0,0,${ph(5)},
        ${ph(6)},${ph(7)},0,${ph(8)},${ph(9)},'pagada',${ph(10)},${ph(11)},${ph(12)},${ph(13)})`,
      [crypto.randomUUID(), neg.id, items, d.cargar, d.cargar, metodo, d.cargar, factura, cajero,
       d.efectivo, d.tarjeta, d.nequi, `${d.fecha} ${HORA}`]);

    if (caja) {
      await pool.query(
        `UPDATE cajas SET total_ventas=total_ventas+${ph(1)}, total_efectivo=total_efectivo+${ph(2)},
           total_tarjeta=total_tarjeta+${ph(3)}, total_nequi=total_nequi+${ph(4)} WHERE id=${ph(5)}`,
        [d.cargar, d.efectivo, d.tarjeta, d.nequi, caja.id]);
    } else {
      await pool.query(
        `INSERT INTO cajas (id,negocio_id,usuario_id,fecha,monto_apertura,monto_cierre,total_ventas,total_gastos,
           total_efectivo,total_tarjeta,total_nequi,estado,notas,apertura_en,cierre_en)
         VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},0,${ph(5)},${ph(6)},0,${ph(7)},${ph(8)},${ph(9)},
           'cerrada','Caja creada a mano para registrar ventas atrasadas',${ph(10)},${ph(11)})`,
        [crypto.randomUUID(), neg.id, usuarioCaja, d.fecha, d.efectivo, d.cargar,
         d.efectivo, d.tarjeta, d.nequi, `${d.fecha} 18:00:00`, `${d.fecha} 23:59:00`]);
    }
  }
  console.log(aplicar ? '\nListo.' : '\nNada grabado. Repite con --aplicar para grabarlo.');
  process.exit(0);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
