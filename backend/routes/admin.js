/**
 * routes/admin.js
 * Panel Administrativo: gastos, caja diaria, config factura, impresora
 */
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { pool, ph } = require('../db');
const { authMiddleware, requirePermiso } = require('../middleware/auth');
const { enviarFactura } = require('../mailer');

router.use(authMiddleware);
const nid = req => req.user.negocio_id;
const localDate = () => { const d = new Date(Date.now() - 5*60*60*1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`; };

// Todos los endpoints de admin requieren negocio_id en el token
router.use((req, res, next) => {
  if (!req.user.negocio_id) {
    return res.status(400).json({
      error: 'Tu usuario no tiene un negocio asignado. Pide al superadmin que te asigne uno.'
    });
  }
  next();
});

// ════════════════════════════════════════════════════════════════
// GASTOS
// ════════════════════════════════════════════════════════════════

// Categorías de gasto
router.get('/gastos/categorias', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM gasto_categorias WHERE negocio_id=${ph(1)} ORDER BY nombre`,
      [nid(req)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/gastos/categorias', requirePermiso('gastos'), async (req, res) => {
  try {
    const { nombre, color } = req.body;
    const id = uuid();
    await pool.query(
      `INSERT INTO gasto_categorias (id, negocio_id, nombre, color) VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)})`,
      [id, nid(req), nombre, color || '#378ADD']
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/gastos/categorias/:id', requirePermiso('gastos'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM gasto_categorias WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Gastos
router.get('/gastos', async (req, res) => {
  try {
    const { desde, hasta, categoria_id } = req.query;
    const d = desde || localDate();
    const h = hasta  || localDate();
    let sql = `
      SELECT g.*, gc.nombre AS categoria_nombre, gc.color AS categoria_color,
             u.nombre AS usuario_nombre
      FROM gastos g
      LEFT JOIN gasto_categorias gc ON gc.id = g.categoria_id
      LEFT JOIN usuarios u ON u.id = g.usuario_id
      WHERE g.negocio_id=${ph(1)} AND g.fecha BETWEEN ${ph(2)} AND ${ph(3)}
    `;
    const params = [nid(req), d, h];
    if (categoria_id) { params.push(categoria_id); sql += ` AND g.categoria_id=${ph(params.length)}`; }
    sql += ' ORDER BY g.creado DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/gastos', requirePermiso('gastos'), async (req, res) => {
  try {
    const { descripcion, monto, metodo_pago, categoria_id, fecha, comprobante } = req.body;
    if (!descripcion || !monto) return res.status(400).json({ error: 'descripcion y monto requeridos' });
    const id = uuid();
    await pool.query(
      `INSERT INTO gastos (id,negocio_id,usuario_id,categoria_id,descripcion,monto,metodo_pago,fecha,comprobante)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},${ph(9)})`,
      [id, nid(req), req.user.id, categoria_id||null, descripcion, monto,
       metodo_pago||'efectivo', fecha||localDate(), comprobante||null]
    );
    // Actualizar total_gastos de la caja del usuario que registra el gasto
    await pool.query(
      `UPDATE cajas SET total_gastos = total_gastos + ${ph(1)}
       WHERE negocio_id=${ph(2)} AND usuario_id=${ph(3)} AND estado='abierta' AND fecha=CURRENT_DATE`,
      [monto, nid(req), req.user.id]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/gastos/:id', requirePermiso('gastos'), async (req, res) => {
  try {
    const { descripcion, monto, metodo_pago, categoria_id, fecha } = req.body;
    await pool.query(
      `UPDATE gastos SET descripcion=${ph(1)},monto=${ph(2)},metodo_pago=${ph(3)},
       categoria_id=${ph(4)},fecha=${ph(5)} WHERE id=${ph(6)} AND negocio_id=${ph(7)}`,
      [descripcion, monto, metodo_pago, categoria_id||null, fecha, req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/gastos/:id', requirePermiso('gastos'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM gastos WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Resumen de gastos por categoría
router.get('/gastos/resumen', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const d = desde || localDate();
    const h = hasta  || d;
    const { rows } = await pool.query(`
      SELECT gc.nombre AS categoria, gc.color, SUM(g.monto) AS total, COUNT(*) AS cantidad
      FROM gastos g
      LEFT JOIN gasto_categorias gc ON gc.id = g.categoria_id
      WHERE g.negocio_id=${ph(1)} AND g.fecha BETWEEN ${ph(2)} AND ${ph(3)}
      GROUP BY gc.nombre, gc.color ORDER BY total DESC
    `, [nid(req), d, h]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// CAJA DIARIA
// ════════════════════════════════════════════════════════════════

router.get('/caja', async (req, res) => {
  try {
    const { fecha } = req.query;
    const f = fecha || localDate();
    // Cerrar cajas de días anteriores que quedaron abiertas
    if (!fecha) {
      await pool.query(
        `UPDATE cajas SET estado='cerrada', cierre_en=NOW()
         WHERE negocio_id=${ph(1)} AND usuario_id=${ph(2)} AND fecha<${ph(3)} AND estado='abierta'`,
        [nid(req), req.user.id, f]
      );
    }
    const { rows } = await pool.query(
      `SELECT c.*, u.nombre AS usuario_nombre
       FROM cajas c LEFT JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.negocio_id=${ph(1)} AND c.fecha=${ph(2)} AND c.usuario_id=${ph(3)}`,
      [nid(req), f, req.user.id]
    );
    res.json(rows[0] || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Resumen de todas las cajas del día (para panel admin)
router.get('/caja/resumen', async (req, res) => {
  try {
    const { fecha } = req.query;
    const f = fecha || localDate();
    const { rows } = await pool.query(
      `SELECT c.*, u.nombre AS usuario_nombre
       FROM cajas c LEFT JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.negocio_id=${ph(1)} AND c.fecha=${ph(2)}
       ORDER BY c.apertura_en`,
      [nid(req), f]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/caja/historial', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, u.nombre AS usuario_nombre
       FROM cajas c LEFT JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.negocio_id=${ph(1)} ORDER BY c.fecha DESC LIMIT 30`,
      [nid(req)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Abrir caja
router.post('/caja/abrir', async (req, res) => {
  try {
    const { monto_apertura } = req.body;
    const fecha = localDate();
    // Cerrar automáticamente cajas de días anteriores que quedaron abiertas
    await pool.query(
      `UPDATE cajas SET estado='cerrada', cierre_en=NOW()
       WHERE negocio_id=${ph(1)} AND usuario_id=${ph(2)} AND fecha<${ph(3)} AND estado='abierta'`,
      [nid(req), req.user.id, fecha]
    );
    // Verificar si ya hay caja para este usuario hoy
    const { rows: existe } = await pool.query(
      `SELECT id, estado FROM cajas WHERE negocio_id=${ph(1)} AND fecha=${ph(2)} AND usuario_id=${ph(3)}`,
      [nid(req), fecha, req.user.id]
    );
    if (existe.length) {
      if (existe[0].estado === 'abierta') return res.status(400).json({ error: 'Ya tienes una caja abierta hoy' });
      return res.status(400).json({ error: 'Ya tienes una caja para hoy. Usa "Reabrir" para continuar.' });
    }
    const id = uuid();
    await pool.query(
      `INSERT INTO cajas (id,negocio_id,usuario_id,fecha,monto_apertura)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)})`,
      [id, nid(req), req.user.id, fecha, monto_apertura || 0]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reabrir caja cerrada del mismo usuario (cambio de turno)
router.post('/caja/reabrir', async (req, res) => {
  try {
    const fecha = localDate();
    const { monto_apertura } = req.body || {};
    const { rows } = await pool.query(
      `SELECT id FROM cajas WHERE negocio_id=${ph(1)} AND fecha=${ph(2)} AND usuario_id=${ph(3)} AND estado='cerrada'`,
      [nid(req), fecha, req.user.id]
    );
    if (!rows.length) return res.status(400).json({ error: 'No tienes caja cerrada hoy para reabrir' });
    await pool.query(
      `UPDATE cajas SET estado='abierta', cierre_en=NULL, monto_cierre=NULL,
        monto_apertura=${ph(1)}
       WHERE negocio_id=${ph(2)} AND fecha=${ph(3)} AND usuario_id=${ph(4)} AND estado='cerrada'`,
      [monto_apertura || 0, nid(req), fecha, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cerrar caja
router.post('/caja/cerrar', async (req, res) => {
  try {
    const { monto_cierre, notas } = req.body;
    const fecha = localDate();
    // Solo ventas procesadas por este cajero
    const { rows: ventas } = await pool.query(`
      SELECT
        COALESCE(SUM(total),0) AS total_ventas,
        COALESCE(SUM(CASE WHEN monto_efectivo>0 THEN monto_efectivo WHEN metodo_pago='efectivo' THEN total ELSE 0 END),0) AS efectivo,
        COALESCE(SUM(CASE WHEN monto_tarjeta>0  THEN monto_tarjeta  WHEN metodo_pago='tarjeta'  THEN total ELSE 0 END),0) AS tarjeta,
        COALESCE(SUM(CASE WHEN monto_nequi>0    THEN monto_nequi    WHEN metodo_pago='nequi'    THEN total ELSE 0 END),0) AS nequi
      FROM ventas WHERE negocio_id=${ph(1)} AND DATE(creado)=${ph(2)} AND cajero_id=${ph(3)}
    `, [nid(req), fecha, req.user.id]);
    // Solo gastos registrados por este usuario
    const { rows: gastos } = await pool.query(
      `SELECT COALESCE(SUM(monto),0) AS total FROM gastos WHERE negocio_id=${ph(1)} AND fecha=${ph(2)} AND usuario_id=${ph(3)}`,
      [nid(req), fecha, req.user.id]
    );
    const v = ventas[0];
    await pool.query(`
      UPDATE cajas SET
        estado='cerrada', monto_cierre=${ph(1)}, notas=${ph(2)},
        total_ventas=${ph(3)}, total_gastos=${ph(4)},
        total_efectivo=${ph(5)}, total_tarjeta=${ph(6)}, total_nequi=${ph(7)},
        cierre_en=NOW()
      WHERE negocio_id=${ph(8)} AND fecha=${ph(9)} AND usuario_id=${ph(10)} AND estado='abierta'
    `, [monto_cierre||0, notas||'', v.total_ventas, gastos[0].total,
        v.efectivo, v.tarjeta, v.nequi, nid(req), fecha, req.user.id]);
    res.json({ ok: true, resumen: { ...v, total_gastos: gastos[0].total } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE FACTURA
// ════════════════════════════════════════════════════════════════

router.get('/config/factura', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT datos FROM config_factura WHERE negocio_id=${ph(1)}`, [nid(req)]
    );
    res.json(rows[0] ? (typeof rows[0].datos === 'string' ? JSON.parse(rows[0].datos) : rows[0].datos) : {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/config/factura', requirePermiso('personal'), async (req, res) => {
  try {
    await pool.query(`
      INSERT INTO config_factura (negocio_id, datos)
      VALUES (${ph(1)},${ph(2)})
      ON DUPLICATE KEY UPDATE datos=VALUES(datos), actualizado=NOW()
    `, [nid(req), JSON.stringify(req.body)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE IMPRESORA
// ════════════════════════════════════════════════════════════════

router.get('/config/impresora', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM config_impresora WHERE negocio_id=${ph(1)}`, [nid(req)]
    );
    res.json(rows[0] || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/config/impresora', requirePermiso('personal'), async (req, res) => {
  try {
    const { tipo, nombre, ancho_papel, ip_impresora, puerto, copias, imprimir_logo, imprimir_cocina } = req.body;
    await pool.query(`
      INSERT INTO config_impresora (negocio_id,tipo,nombre,ancho_papel,ip_impresora,puerto,copias,imprimir_logo,imprimir_cocina)
      VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},${ph(9)})
      ON DUPLICATE KEY UPDATE tipo=VALUES(tipo),nombre=VALUES(nombre),ancho_papel=VALUES(ancho_papel),ip_impresora=VALUES(ip_impresora),
        puerto=VALUES(puerto),copias=VALUES(copias),imprimir_logo=VALUES(imprimir_logo),imprimir_cocina=VALUES(imprimir_cocina),actualizado=NOW()
    `, [nid(req), tipo||'termica', nombre||'', ancho_papel||80, ip_impresora||null,
        puerto||9100, copias||1, imprimir_logo!==false, imprimir_cocina!==false]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// PROVEEDORES
// ════════════════════════════════════════════════════════════════

router.get('/proveedores', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM proveedores WHERE negocio_id=${ph(1)} AND activo=1 ORDER BY nombre`,
      [nid(req)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/proveedores', requirePermiso('proveedores'), async (req, res) => {
  try {
    const { nombre, nit, contacto, telefono, email, direccion, ciudad, notas } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const id = uuid();
    await pool.query(
      `INSERT INTO proveedores (id,negocio_id,nombre,nit,contacto,telefono,email,direccion,ciudad,notas)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},${ph(9)},${ph(10)})`,
      [id, nid(req), nombre, nit||null, contacto||null, telefono||null,
       email||null, direccion||null, ciudad||null, notas||null]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/proveedores/:id', requirePermiso('proveedores'), async (req, res) => {
  try {
    const { nombre, nit, contacto, telefono, email, direccion, ciudad, notas, activo } = req.body;
    await pool.query(
      `UPDATE proveedores SET nombre=${ph(1)},nit=${ph(2)},contacto=${ph(3)},telefono=${ph(4)},
       email=${ph(5)},direccion=${ph(6)},ciudad=${ph(7)},notas=${ph(8)},activo=${ph(9)}
       WHERE id=${ph(10)} AND negocio_id=${ph(11)}`,
      [nombre,nit,contacto,telefono,email,direccion,ciudad,notas,activo!==false,req.params.id,nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// PEDIDOS A PROVEEDOR
// ════════════════════════════════════════════════════════════════

router.get('/pedidos-proveedor', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT pp.*, p.nombre AS proveedor_nombre, u.nombre AS usuario_nombre
      FROM pedidos_proveedor pp
      JOIN proveedores p ON p.id = pp.proveedor_id
      LEFT JOIN usuarios u ON u.id = pp.usuario_id
      WHERE pp.negocio_id=${ph(1)} ORDER BY pp.creado DESC LIMIT 50
    `, [nid(req)]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/pedidos-proveedor', requirePermiso('proveedores'), async (req, res) => {
  try {
    const { proveedor_id, items, total, notas, fecha_entrega } = req.body;
    const id = uuid();
    await pool.query(
      `INSERT INTO pedidos_proveedor (id,negocio_id,proveedor_id,usuario_id,items,total,notas,fecha_entrega)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)})`,
      [id, nid(req), proveedor_id, req.user.id, JSON.stringify(items||[]),
       total||0, notas||null, fecha_entrega||null]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/pedidos-proveedor/:id/estado', requirePermiso('proveedores'), async (req, res) => {
  try {
    const { estado } = req.body;
    await pool.query(
      `UPDATE pedidos_proveedor SET estado=${ph(1)} WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
      [estado, req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// REPORTES ADMINISTRATIVOS
// ════════════════════════════════════════════════════════════════

router.get('/reportes/resumen', async (req, res) => {
  try {
    const { desde, hasta, tipo } = req.query;
    const d = desde || localDate();
    const h = hasta  || d;
    let vSql = `
        SELECT COUNT(v.id) AS pedidos,
               COALESCE(SUM(v.total),0) AS total_ventas,
               COALESCE(SUM(CASE WHEN v.monto_efectivo>0 THEN v.monto_efectivo WHEN v.metodo_pago='efectivo' THEN v.total ELSE 0 END),0) AS efectivo,
               COALESCE(SUM(CASE WHEN v.monto_tarjeta>0  THEN v.monto_tarjeta  WHEN v.metodo_pago='tarjeta'  THEN v.total ELSE 0 END),0) AS tarjeta,
               COALESCE(SUM(CASE WHEN v.monto_nequi>0    THEN v.monto_nequi    WHEN v.metodo_pago='nequi'    THEN v.total ELSE 0 END),0) AS nequi,
               COALESCE(SUM(vi_s.cant),0) AS total_items
        FROM (
          SELECT id, negocio_id, total, creado, tipo,
                 monto_efectivo, monto_tarjeta, monto_nequi, metodo_pago, id AS vid
          FROM ventas
          UNION ALL
          SELECT pv.id, pv.negocio_id, pv.total, pv.fecha AS creado, 'servicio' AS tipo,
                 0, 0, 0,
                 COALESCE((SELECT pc.metodo_pago FROM pel_citas pc WHERE pc.venta_id=pv.id AND pc.metodo_pago IS NOT NULL LIMIT 1),'efectivo'),
                 NULL AS vid
          FROM pel_ventas pv WHERE pv.estado='completada'
        ) v
        LEFT JOIN (SELECT venta_id, SUM(cantidad) AS cant FROM venta_items GROUP BY venta_id) vi_s ON vi_s.venta_id=v.vid
        WHERE v.negocio_id=${ph(1)} AND DATE(v.creado) BETWEEN ${ph(2)} AND ${ph(3)}`;
    const vParams = [nid(req), d, h];
    if (tipo) { vParams.push(tipo); vSql += ` AND v.tipo=${ph(vParams.length)}`; }
    const [ventas, gastos, cajas] = await Promise.all([
      pool.query(vSql, vParams),
      pool.query(`
        SELECT COALESCE(SUM(monto),0) AS total_gastos FROM gastos
        WHERE negocio_id=${ph(1)} AND fecha BETWEEN ${ph(2)} AND ${ph(3)}
      `, [nid(req), d, h]),
      pool.query(`
        SELECT c.*, u.nombre AS usuario_nombre
        FROM cajas c LEFT JOIN usuarios u ON u.id = c.usuario_id
        WHERE c.negocio_id=${ph(1)} AND c.fecha BETWEEN ${ph(2)} AND ${ph(3)}
        ORDER BY c.fecha DESC, c.apertura_en DESC
      `, [nid(req), d, h]),
    ]);
    res.json({
      ventas: ventas.rows[0],
      gastos: gastos.rows[0],
      cajas:  cajas.rows,
      utilidad: (ventas.rows[0].total_ventas || 0) - (gastos.rows[0].total_gastos || 0),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ventas por hora del día
router.get('/reportes/ventas-por-hora', async (req, res) => {
  try {
    const { desde, hasta, metodo_pago, tipo } = req.query;
    const d = desde || localDate();
    const h = hasta || d;
    let sql = `SELECT HOUR(v.creado) AS hora, COUNT(*) AS pedidos, COALESCE(SUM(v.total),0) AS total
               FROM (
                 SELECT negocio_id, total, creado, tipo, metodo_pago FROM ventas
                 UNION ALL
                 SELECT negocio_id, total, fecha AS creado, 'servicio', 'efectivo' FROM pel_ventas WHERE estado='completada'
               ) v
               WHERE v.negocio_id=${ph(1)} AND DATE(v.creado) BETWEEN ${ph(2)} AND ${ph(3)}`;
    const params = [nid(req), d, h];
    if (tipo)        { params.push(tipo);        sql += ` AND v.tipo=${ph(params.length)}`; }
    if (metodo_pago) { params.push(metodo_pago); sql += ` AND v.metodo_pago=${ph(params.length)}`; }
    sql += ' GROUP BY hora ORDER BY hora';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ventas por día (gráfica de tendencia últimos N días)
router.get('/reportes/ventas-por-dia', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const h = hasta || localDate();
    const d = desde || (() => {
      const dd = new Date(Date.now() - 5*60*60*1000);
      dd.setUTCDate(dd.getUTCDate() - 6);
      return `${dd.getUTCFullYear()}-${String(dd.getUTCMonth()+1).padStart(2,'0')}-${String(dd.getUTCDate()).padStart(2,'0')}`;
    })();
    const { rows } = await pool.query(
      `SELECT DATE_FORMAT(DATE(v.creado),'%Y-%m-%d') AS fecha, COUNT(*) AS pedidos, COALESCE(SUM(v.total),0) AS total
       FROM (
         SELECT negocio_id, total, creado FROM ventas
         UNION ALL
         SELECT negocio_id, total, fecha AS creado FROM pel_ventas WHERE estado='completada'
       ) v
       WHERE v.negocio_id=${ph(1)} AND DATE(v.creado) BETWEEN ${ph(2)} AND ${ph(3)}
       GROUP BY DATE_FORMAT(DATE(v.creado),'%Y-%m-%d') ORDER BY 1`,
      [nid(req), d, h]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Ventas recientes del período (últimas 30)
router.get('/ventas/recientes', async (req, res) => {
  try {
    const { tipo, desde, hasta } = req.query;
    const d = desde || localDate();
    const h = hasta  || d;
    let sql = `
      SELECT v.id, v.tipo, v.mesa_id, v.mesa_num,
             COALESCE(m.nombre, CONCAT('Mesa ', v.mesa_num)) AS lugar,
             v.total, v.metodo_pago, v.numero_factura, v.items, v.creado,
             u.nombre AS usuario_nombre
      FROM ventas v
      LEFT JOIN usuarios u ON u.id = v.cajero_id
      LEFT JOIN mesas m ON m.id = v.mesa_id
      WHERE v.negocio_id=${ph(1)} AND DATE(v.creado) BETWEEN ${ph(2)} AND ${ph(3)}
    `;
    const params = [nid(req), d, h];
    if (tipo) { params.push(tipo); sql += ` AND v.tipo=${ph(params.length)}`; }
    sql += ' ORDER BY v.creado DESC LIMIT 30';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Lista completa de ventas por período (para exportar)
router.get('/ventas', async (req, res) => {
  try {
    const { desde, hasta, metodo_pago } = req.query;
    const d = desde || localDate();
    const h = hasta  || d;
    let sql = `
      SELECT v.id, DATE_FORMAT(DATE(v.creado),'%Y-%m-%d') AS fecha,
             TIME_FORMAT(v.creado,'%H:%i') AS hora,
             COALESCE(m.nombre, CASE WHEN v.mesa_num IS NOT NULL THEN CONCAT('Mesa ',v.mesa_num) ELSE 'Mostrador' END) AS lugar,
             v.metodo_pago, v.total,
             v.monto_efectivo, v.monto_tarjeta, v.monto_nequi,
             COALESCE(v.cliente_nombre,'') AS cliente,
             u.nombre AS cajero,
             v.numero_factura
      FROM ventas v
      LEFT JOIN usuarios u ON u.id = v.cajero_id
      LEFT JOIN mesas m ON m.id = v.mesa_id
      WHERE v.negocio_id=${ph(1)} AND DATE(v.creado) BETWEEN ${ph(2)} AND ${ph(3)}`;
    const params = [nid(req), d, h];
    if(metodo_pago){ params.push(metodo_pago); sql += ` AND v.metodo_pago=${ph(params.length)}`; }
    sql += ' ORDER BY v.creado DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// SINCRONIZAR MENÚ → INVENTARIO
// ════════════════════════════════════════════════════════════════

router.post('/menu/sync-inventario', requirePermiso('inventario'), async (req, res) => {
  try {
    // Obtener todos los items del menú sin inventario_id
    const { rows: items } = await pool.query(
      `SELECT mi.id, mi.nombre, mc.modulo AS cat_modulo
       FROM menu_items mi
       LEFT JOIN menu_categorias mc ON mc.id = mi.categoria_id
       WHERE mi.negocio_id=${ph(1)} AND mi.inventario_id IS NULL AND mi.disponible=1`,
      [nid(req)]
    );

    let creados = 0;
    for (const item of items) {
      const invId = uuid();
      const modulo = item.cat_modulo || 'restaurante';
      await pool.query(
        `INSERT INTO inventario (id,negocio_id,nombre,categoria,stock,stock_min,unidad,costo,precio_venta,es_producto,modulo)
         VALUES (${ph(1)},${ph(2)},${ph(3)},'General',0,1,'unidades',0,0,0,${ph(4)})`,
        [invId, nid(req), item.nombre, modulo]
      );
      await pool.query(
        `UPDATE menu_items SET inventario_id=${ph(1)} WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
        [invId, item.id, nid(req)]
      );
      creados++;
    }
    res.json({ ok: true, creados, mensaje: `${creados} producto(s) importados al inventario` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Auto-vincular inventario → menú por coincidencia de nombre
router.post('/menu/auto-link-inventario', requirePermiso('inventario'), async (req, res) => {
  try {
    const nId = nid(req);
    // Menu items sin vínculo de inventario
    const { rows: items } = await pool.query(
      `SELECT id, nombre FROM menu_items WHERE negocio_id=${ph(1)} AND (inventario_id IS NULL OR inventario_id='')`,
      [nId]
    );
    // Todos los artículos de inventario activos
    const { rows: inv } = await pool.query(
      `SELECT id, nombre FROM inventario WHERE negocio_id=${ph(1)} AND activo=1`,
      [nId]
    );
    let vinculados = 0;
    for (const mi of items) {
      const match = inv.find(i =>
        i.nombre.toLowerCase().trim() === mi.nombre.toLowerCase().trim()
      );
      if (match) {
        await pool.query(
          `UPDATE menu_items SET inventario_id=${ph(1)} WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
          [match.id, mi.id, nId]
        );
        vinculados++;
      }
    }
    res.json({ ok: true, vinculados, mensaje: `${vinculados} ítem(s) del menú vinculados al inventario` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// FACTURAS
// ════════════════════════════════════════════════════════════════

router.get('/facturas', async (req, res) => {
  try {
    const { desde, hasta, q } = req.query;
    const d = desde || localDate();
    const h = hasta  || d;
    const params = [nid(req), d, h];
    let where = `v.negocio_id=${ph(1)} AND DATE(v.creado) BETWEEN ${ph(2)} AND ${ph(3)}`;
    if (q && q.trim()) {
      params.push(`%${q.trim()}%`);
      const n = params.length;
      where += ` AND (v.numero_factura LIKE ${ph(n)} OR v.cliente_nombre LIKE ${ph(n)})`;
    }
    const { rows } = await pool.query(`
      SELECT v.id, v.numero_factura, v.creado, v.mesa_num, v.cliente_nombre,
             v.metodo_pago, v.monto_efectivo, v.monto_tarjeta, v.monto_nequi,
             v.subtotal, v.iva, v.total, v.recibido, v.cambio,
             u.nombre AS cajero_nombre,
             c.telefono AS cliente_tel, c.documento AS cliente_doc,
             c.email AS cliente_email, c.direccion AS cliente_dir,
             c.departamento AS cliente_depto, c.ciudad AS cliente_ciudad
      FROM ventas v
      LEFT JOIN usuarios u ON u.id = v.cajero_id
      LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE ${where}
      ORDER BY v.creado DESC
      LIMIT 200
    `, params);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/facturas/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT v.*, u.nombre AS cajero_nombre,
             c.telefono AS cliente_tel, c.documento AS cliente_doc,
             c.email AS cliente_email, c.direccion AS cliente_dir,
             c.departamento AS cliente_depto, c.ciudad AS cliente_ciudad
      FROM ventas v
      LEFT JOIN usuarios u ON u.id = v.cajero_id
      LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE v.id=${ph(1)} AND v.negocio_id=${ph(2)}
    `, [req.params.id, nid(req)]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrada' });
    const v = rows[0];
    if (typeof v.items === 'string') { try { v.items = JSON.parse(v.items); } catch{ v.items = []; } }
    res.json(v);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/facturas/:id/email', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requerido' });

    // Cargar factura
    const { rows: vRows } = await pool.query(`
      SELECT v.*, u.nombre AS cajero_nombre,
             c.telefono AS cliente_tel, c.documento AS cliente_doc,
             c.email AS cliente_email, c.direccion AS cliente_dir,
             c.departamento AS cliente_depto, c.ciudad AS cliente_ciudad
      FROM ventas v
      LEFT JOIN usuarios u ON u.id = v.cajero_id
      LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE v.id=${ph(1)} AND v.negocio_id=${ph(2)}
    `, [req.params.id, nid(req)]);
    if (!vRows.length) return res.status(404).json({ error: 'Factura no encontrada' });
    const v = vRows[0];
    if (typeof v.items === 'string') { try { v.items = JSON.parse(v.items); } catch { v.items = []; } }

    // Cargar config de factura
    const { rows: cfRows } = await pool.query(
      `SELECT datos FROM config_factura WHERE negocio_id=${ph(1)}`, [nid(req)]
    );
    const cf = cfRows[0] ? (typeof cfRows[0].datos === 'string' ? JSON.parse(cfRows[0].datos) : cfRows[0].datos) : {};

    await enviarFactura({ to: email, v, cf });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
