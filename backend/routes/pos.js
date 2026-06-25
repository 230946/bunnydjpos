/**
 * routes/pos.js
 * POS: Mesas · Menú · Comandas · Cobro · Ventas
 */
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { pool, ph } = require('../db');
const { authMiddleware, requirePermiso } = require('../middleware/auth');
const multer  = require('multer');
const path    = require('path');

router.use(authMiddleware);
const nid = req => req.user.negocio_id;
const localDate = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

// Multer para fotos de menú
const storage = multer.diskStorage({
  destination: process.env.UPLOADS_DIR || './uploads',
  filename: (_, file, cb) => cb(null, uuid() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ════════════════════════════════════════════════════════════════
// MESAS
// ════════════════════════════════════════════════════════════════

router.get('/mesas', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.*, me.ocupada, me.pedido, me.actualizado AS estado_at,
             u.nombre AS mesero_nombre
      FROM mesas m
      LEFT JOIN mesa_estado me ON me.mesa_id = m.id
      LEFT JOIN usuarios u ON u.id = me.mesero_id
      WHERE m.negocio_id=${ph(1)} AND m.activa=1
      ORDER BY m.numero
    `, [nid(req)]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/mesas', requirePermiso('pos_mesas'), async (req, res) => {
  try {
    const { numero, nombre, capacidad, zona } = req.body;
    const id = uuid();
    await pool.query(
      `INSERT INTO mesas (id,negocio_id,numero,nombre,capacidad,zona)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)})`,
      [id, nid(req), numero, nombre||`Mesa ${numero}`, capacidad||4, zona||null]
    );
    await pool.query(
      `INSERT INTO mesa_estado (mesa_id, pedido) VALUES (${ph(1)}, '[]')`, [id]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/mesas/:id', requirePermiso('pos_mesas'), async (req, res) => {
  try {
    const { numero, nombre, capacidad, zona, activa } = req.body;
    await pool.query(
      `UPDATE mesas SET numero=${ph(1)},nombre=${ph(2)},capacidad=${ph(3)},
       zona=${ph(4)},activa=${ph(5)} WHERE id=${ph(6)} AND negocio_id=${ph(7)}`,
      [numero, nombre, capacidad, zona, activa!==false, req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/mesas/:id', requirePermiso('pos_mesas'), async (req, res) => {
  try {
    await pool.query(`UPDATE mesas SET activa=0 WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Actualizar pedido de una mesa
router.put('/mesas/:id/pedido', async (req, res) => {
  try {
    const { pedido, ocupada } = req.body;
    await pool.query(`
      INSERT INTO mesa_estado (mesa_id, ocupada, pedido, mesero_id, actualizado)
      VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},NOW())
      ON DUPLICATE KEY UPDATE ocupada=VALUES(ocupada), pedido=VALUES(pedido), mesero_id=VALUES(mesero_id), actualizado=NOW()
    `, [req.params.id, ocupada||false, JSON.stringify(pedido||[]), req.user.id]);
    // Broadcast WebSocket
    req.app.locals.broadcast?.(nid(req), 'mesa_actualizada', { mesa_id: req.params.id, ocupada, pedido });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Limpiar mesa al cobrar
router.post('/mesas/:id/liberar', async (req, res) => {
  try {
    await pool.query(`
      UPDATE mesa_estado SET ocupada=0, pedido='[]', actualizado=NOW()
      WHERE mesa_id=${ph(1)}
    `, [req.params.id]);
    await pool.query(`
      UPDATE comandas SET estado='entregado', actualizado=NOW()
      WHERE mesa_id=${ph(1)} AND negocio_id=${ph(2)} AND estado != 'entregado'
    `, [req.params.id, nid(req)]);
    req.app.locals.broadcast?.(nid(req), 'mesa_liberada', { mesa_id: req.params.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// MENÚ — CATEGORÍAS
// ════════════════════════════════════════════════════════════════

router.get('/menu/categorias', async (req, res) => {
  try {
    const { modulo } = req.query;
    let sql = `SELECT * FROM menu_categorias WHERE negocio_id=${ph(1)} AND activa=1`;
    const params = [nid(req)];
    if (modulo) { sql += ` AND (modulo IS NULL OR modulo=${ph(2)})`; params.push(modulo); }
    sql += ' ORDER BY orden, nombre';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/menu/categorias', requirePermiso(['pos_menu','personal']), async (req, res) => {
  try {
    const { nombre, descripcion, icono, orden, modulo } = req.body;
    const id = uuid();
    await pool.query(
      `INSERT INTO menu_categorias (id,negocio_id,nombre,descripcion,icono,orden,modulo)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)})`,
      [id, nid(req), nombre, descripcion||null, icono||null, orden||0, modulo||null]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/menu/categorias/:id', requirePermiso(['pos_menu','personal']), async (req, res) => {
  try {
    const { nombre, descripcion, icono, orden, activa, modulo } = req.body;
    await pool.query(
      `UPDATE menu_categorias SET nombre=${ph(1)},descripcion=${ph(2)},icono=${ph(3)},
       orden=${ph(4)},activa=${ph(5)},modulo=${ph(6)} WHERE id=${ph(7)} AND negocio_id=${ph(8)}`,
      [nombre, descripcion, icono, orden||0, activa!==false, modulo||null, req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/menu/categorias/:id', requirePermiso(['pos_menu','personal']), async (req, res) => {
  try {
    await pool.query(`UPDATE menu_categorias SET activa=0 WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// MENÚ — ARTÍCULOS
// ════════════════════════════════════════════════════════════════

router.get('/menu/items', async (req, res) => {
  try {
    const { categoria_id, disponible, modulo } = req.query;
    let sql = `
      SELECT mi.*, mc.nombre AS categoria_nombre, mc.modulo AS categoria_modulo,
             inv.stock AS inv_stock, inv.nombre AS inv_nombre,
             (SELECT COUNT(*) FROM menu_item_recetas r WHERE r.menu_item_id = mi.id) AS receta_count,
             (SELECT FLOOR(MIN(inv2.stock / r2.cantidad))
              FROM menu_item_recetas r2
              JOIN inventario inv2 ON inv2.id = r2.inventario_id
              WHERE r2.menu_item_id = mi.id) AS receta_porciones
      FROM menu_items mi
      LEFT JOIN menu_categorias mc ON mc.id = mi.categoria_id
      LEFT JOIN inventario inv ON inv.id = mi.inventario_id
      WHERE mi.negocio_id=${ph(1)}
    `;
    const params = [nid(req)];
    if (categoria_id) { params.push(categoria_id); sql += ` AND mi.categoria_id=${ph(params.length)}`; }
    if (disponible !== undefined) { params.push(disponible === 'true'); sql += ` AND mi.disponible=${ph(params.length)}`; }
    if (modulo) { sql += ` AND (mc.modulo IS NULL OR mc.modulo=${ph(params.length + 1)})`; params.push(modulo); }
    sql += ' ORDER BY mi.orden, mi.nombre';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Alertas de stock bajo (debe ir ANTES de /:id para no ser capturado)
router.get('/menu/items/alertas', async (req, res) => {
  try {
    const { modulo } = req.query;
    let sql = `
      SELECT mi.id, mi.nombre, mi.stock, mi.stock_min, mc.nombre AS categoria_nombre
      FROM menu_items mi
      LEFT JOIN menu_categorias mc ON mc.id = mi.categoria_id
      WHERE mi.negocio_id=${ph(1)} AND mi.disponible=1 AND mi.stock IS NOT NULL AND mi.stock_min > 0 AND mi.stock < mi.stock_min
    `;
    const params = [nid(req)];
    if (modulo) { sql += ` AND (mc.modulo IS NULL OR mc.modulo=${ph(2)})`; params.push(modulo); }
    sql += ' ORDER BY mi.stock ASC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/menu/items/:id', requirePermiso(['pos_menu','personal']), async (req, res) => {
  try {
    const sql = `
      SELECT mi.*, mc.nombre AS categoria_nombre
      FROM menu_items mi
      LEFT JOIN menu_categorias mc ON mc.id = mi.categoria_id
      WHERE mi.id=${ph(1)} AND mi.negocio_id=${ph(2)}
    `;
    const { rows } = await pool.query(sql, [req.params.id, nid(req)]);
    if (!rows.length) return res.status(404).json({ error: 'Artículo no encontrado' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/menu/items', requirePermiso(['pos_menu','personal']), async (req, res) => {
  try {
    const { nombre, descripcion, precio, categoria_id, emoji, disponible, tiempo_prep, orden, inventario_id } = req.body;
    const id = uuid();
    await pool.query(
      `INSERT INTO menu_items (id,negocio_id,categoria_id,nombre,descripcion,precio,emoji,disponible,tiempo_prep,orden,inventario_id)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},${ph(9)},${ph(10)},${ph(11)})`,
      [id, nid(req), categoria_id||null, nombre, descripcion||null, precio, emoji||'🍽️',
       disponible!==false, tiempo_prep||15, orden||0, inventario_id||null]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/menu/items/:id', requirePermiso(['pos_menu','personal']), async (req, res) => {
  try {
    const { nombre, descripcion, precio, categoria_id, emoji, disponible, tiempo_prep, orden, stock_min, inventario_id } = req.body;
    await pool.query(
      `UPDATE menu_items SET nombre=${ph(1)},descripcion=${ph(2)},precio=${ph(3)},
       categoria_id=${ph(4)},emoji=${ph(5)},disponible=${ph(6)},tiempo_prep=${ph(7)},orden=${ph(8)},stock_min=${ph(9)},
       inventario_id=${ph(10)}
       WHERE id=${ph(11)} AND negocio_id=${ph(12)}`,
      [nombre, descripcion, precio, categoria_id||null, emoji||'🍽️',
       disponible!==false, tiempo_prep||15, orden||0, stock_min||0,
       inventario_id||null, req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ajuste manual de stock (entrada/salida)
router.post('/menu/items/:id/ajustar-stock', requirePermiso(['pos_menu','personal']), async (req, res) => {
  try {
    const { tipo, cantidad, nota } = req.body;
    if (!['entrada','salida'].includes(tipo)) return res.status(400).json({ error: 'tipo debe ser entrada o salida' });
    const cant = Math.abs(+cantidad || 0);
    if (cant <= 0) return res.status(400).json({ error: 'cantidad debe ser mayor a 0' });
    const delta = tipo === 'entrada' ? cant : -cant;
    const { rows } = await pool.query(
      `SELECT stock FROM menu_items WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, nid(req)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    const stockActual = rows[0].stock ?? 0;
    const nuevoStock = Math.max(0, stockActual + delta);
    await pool.query(
      `UPDATE menu_items SET stock=${ph(1)} WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
      [nuevoStock, req.params.id, nid(req)]
    );
    res.json({ ok: true, stock_antes: stockActual, stock_despues: nuevoStock, tipo, cantidad: cant, nota });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Subir foto de artículo de menú
router.post('/menu/items/:id/foto', upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const url = `/uploads/${req.file.filename}`;
    await pool.query(`UPDATE menu_items SET foto_url=${ph(1)} WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
      [url, req.params.id, nid(req)]);
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/menu/items/:id', requirePermiso(['pos_menu','personal']), async (req, res) => {
  try {
    await pool.query(`DELETE FROM menu_items WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// RECETAS DE PRODUCTOS COMPUESTOS
// ════════════════════════════════════════════════════════════════

router.get('/menu/items/:id/receta', requirePermiso(['pos_menu','personal']), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.inventario_id, r.cantidad, inv.nombre AS ingrediente_nombre, inv.unidad, inv.stock
       FROM menu_item_recetas r
       JOIN inventario inv ON inv.id = r.inventario_id
       WHERE r.menu_item_id=${ph(1)} AND r.negocio_id=${ph(2)}
       ORDER BY inv.nombre`,
      [req.params.id, nid(req)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/menu/items/:id/receta', requirePermiso(['pos_menu','personal']), async (req, res) => {
  try {
    const { inventario_id, cantidad } = req.body;
    if (!inventario_id || !cantidad) return res.status(400).json({ error: 'inventario_id y cantidad requeridos' });
    // Si ya existe ese ingrediente en la receta, actualiza la cantidad
    const { rows: exist } = await pool.query(
      `SELECT id FROM menu_item_recetas WHERE menu_item_id=${ph(1)} AND inventario_id=${ph(2)} AND negocio_id=${ph(3)}`,
      [req.params.id, inventario_id, nid(req)]
    );
    if (exist[0]) {
      await pool.query(
        `UPDATE menu_item_recetas SET cantidad=${ph(1)} WHERE id=${ph(2)}`,
        [cantidad, exist[0].id]
      );
      return res.json({ ok: true, id: exist[0].id, actualizado: true });
    }
    const { rows: ins } = await pool.query(
      `INSERT INTO menu_item_recetas (menu_item_id, negocio_id, inventario_id, cantidad)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)})`,
      [req.params.id, nid(req), inventario_id, cantidad]
    );
    res.status(201).json({ ok: true, id: ins.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/menu/items/:id/receta/:rid', requirePermiso(['pos_menu','personal']), async (req, res) => {
  try {
    const { cantidad } = req.body;
    if (!cantidad) return res.status(400).json({ error: 'cantidad requerida' });
    await pool.query(
      `UPDATE menu_item_recetas SET cantidad=${ph(1)} WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
      [cantidad, req.params.rid, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/menu/items/:id/receta/:rid', requirePermiso(['pos_menu','personal']), async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM menu_item_recetas WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.rid, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// COMANDAS (COCINA)
// ════════════════════════════════════════════════════════════════

router.get('/comandas', async (req, res) => {
  try {
    const { estado } = req.query;
    let sql = `
      SELECT c.*, u.nombre AS mesero_nombre
      FROM comandas c LEFT JOIN usuarios u ON u.id = c.mesero_id
      WHERE c.negocio_id=${ph(1)} AND c.estado != 'entregado'
    `;
    const params = [nid(req)];
    if (estado) { params.push(estado); sql += ` AND c.estado=${ph(params.length)}`; }
    sql += ' ORDER BY c.prioridad DESC, c.creado ASC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/comandas', async (req, res) => {
  try {
    const { mesa_id, mesa_num, mesa_nombre, items, notas, prioridad } = req.body;
    const id = uuid();
    await pool.query(
      `INSERT INTO comandas (id,negocio_id,mesa_id,mesa_num,mesa_nombre,mesero_id,items,notas,prioridad)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},${ph(9)})`,
      [id, nid(req), mesa_id||null, mesa_num, mesa_nombre||`Mesa ${mesa_num}`,
       req.user.id, JSON.stringify(items||[]), notas||null, prioridad||0]
    );
    const comanda = { id, mesa_num, mesa_nombre, items, notas, estado: 'nuevo', creado: new Date() };
    req.app.locals.broadcast?.(nid(req), 'nueva_comanda', comanda);
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/comandas/:id/estado', async (req, res) => {
  try {
    const { estado } = req.body;
    await pool.query(
      `UPDATE comandas SET estado=${ph(1)}, actualizado=NOW() WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
      [estado, req.params.id, nid(req)]
    );
    req.app.locals.broadcast?.(nid(req), 'comanda_actualizada', { id: req.params.id, estado });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// VENTAS / COBRO
// ════════════════════════════════════════════════════════════════

router.post('/ventas', async (req, res) => {
  try {
    const { mesa_id, mesa_num, tipo='pos', items, subtotal, iva, total,
            metodo_pago, recibido, cambio, cliente_nombre, cliente_id, descuento,
            monto_efectivo=0, monto_tarjeta=0, monto_nequi=0 } = req.body;

    // Generar número de factura
    const { rows: cfg } = await pool.query(
      `SELECT datos FROM config_factura WHERE negocio_id=${ph(1)}`, [nid(req)]
    );
    let prefijo = 'FAC-', consec = 1;
    if (cfg[0]) {
      const d = typeof cfg[0].datos === 'string' ? JSON.parse(cfg[0].datos) : cfg[0].datos;
      prefijo = d.prefijo || 'FAC-';
      consec  = d.consecutivo || 1;
    }
    const numero_factura = `${prefijo}${String(consec).padStart(4,'0')}`;

    // Verificar stock antes de procesar
    for (const item of (items || [])) {
      if (!item.item_id) continue;
      const qty = item.qty || 1;

      // Verificar ingredientes de receta primero
      const { rows: receta } = await pool.query(
        `SELECT r.cantidad, inv.stock, inv.nombre AS inv_nombre
         FROM menu_item_recetas r
         JOIN inventario inv ON inv.id = r.inventario_id
         WHERE r.menu_item_id=${ph(1)} AND r.negocio_id=${ph(2)}`,
        [item.item_id, nid(req)]
      );
      if (receta.length > 0) {
        for (const ing of receta) {
          const needed = ing.cantidad * qty;
          if (ing.stock < needed)
            return res.status(400).json({
              error: ing.stock <= 0
                ? `Ingrediente "${ing.inv_nombre}" agotado para "${item.nombre}"`
                : `Stock insuficiente de "${ing.inv_nombre}" para "${item.nombre}". Disponible: ${ing.stock}, necesario: ${needed}`,
              tipo: 'stock_insuficiente', nombre: ing.inv_nombre, stock_disponible: ing.stock
            });
        }
        continue; // receta verificada, pasar al siguiente item
      }

      // Sin receta: verificar vínculo directo a inventario o stock de menu_items
      const { rows: sr } = await pool.query(
        `SELECT mi.nombre, mi.stock, mi.inventario_id,
                inv.stock AS inv_stock, inv.nombre AS inv_nombre
         FROM menu_items mi
         LEFT JOIN inventario inv ON inv.id = mi.inventario_id
         WHERE mi.id=${ph(1)} AND mi.negocio_id=${ph(2)} LIMIT 1`,
        [item.item_id, nid(req)]
      );
      if (!sr[0]) return res.status(400).json({ error: `Producto no encontrado: ${item.nombre}`, tipo: 'sin_producto' });
      const { nombre, stock, inventario_id, inv_stock, inv_nombre } = sr[0];
      if (inventario_id) {
        if (inv_stock !== null && inv_stock < qty)
          return res.status(400).json({
            error: inv_stock <= 0 ? `"${inv_nombre}" está agotado` : `Stock insuficiente para "${inv_nombre}". Disponible: ${inv_stock}`,
            tipo: 'stock_insuficiente', nombre: inv_nombre, stock_disponible: inv_stock
          });
      } else if (stock !== null && stock < qty) {
        return res.status(400).json({
          error: stock <= 0 ? `"${nombre}" está agotado` : `Stock insuficiente para "${nombre}". Disponible: ${stock}`,
          tipo: 'stock_insuficiente', nombre, stock_disponible: stock
        });
      }
    }

    // Incrementar consecutivo
    if (cfg[0]) {
      const d = typeof cfg[0].datos === 'string' ? JSON.parse(cfg[0].datos) : cfg[0].datos;
      d.consecutivo = consec + 1;
      await pool.query(`UPDATE config_factura SET datos=${ph(1)} WHERE negocio_id=${ph(2)}`,
        [JSON.stringify(d), nid(req)]);
    }

    // Auto-crear cliente si viene nombre pero no ID
    let resolvedClienteId = cliente_id || null;
    if (cliente_nombre && !resolvedClienteId) {
      const { rows: cExist } = await pool.query(
        `SELECT id FROM clientes WHERE negocio_id=${ph(1)} AND LOWER(TRIM(nombre))=LOWER(TRIM(${ph(2)})) AND activo=1 LIMIT 1`,
        [nid(req), cliente_nombre]
      );
      if (cExist[0]) {
        resolvedClienteId = cExist[0].id;
      } else {
        const cId = uuid();
        await pool.query(
          `INSERT INTO clientes (id,negocio_id,nombre) VALUES (${ph(1)},${ph(2)},${ph(3)})`,
          [cId, nid(req), cliente_nombre]
        );
        resolvedClienteId = cId;
      }
    }

    const id = uuid();
    await pool.query(
      `INSERT INTO ventas (id,negocio_id,tipo,mesa_id,mesa_num,cliente_nombre,cliente_id,items,
       subtotal,descuento,iva,total,metodo_pago,recibido,cambio,numero_factura,cajero_id,mesero_id,
       monto_efectivo,monto_tarjeta,monto_nequi)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},
       ${ph(8)},${ph(9)},${ph(10)},${ph(11)},${ph(12)},${ph(13)},${ph(14)},${ph(15)},${ph(16)},${ph(17)},${ph(18)},
       ${ph(19)},${ph(20)},${ph(21)})`,
      [id, nid(req), tipo, mesa_id||null, mesa_num, cliente_nombre||null, resolvedClienteId,
       JSON.stringify(items||[]), subtotal, descuento||0, iva, total,
       metodo_pago, recibido||0, cambio||0, numero_factura, req.user.id, req.user.id,
       monto_efectivo||0, monto_tarjeta||0, monto_nequi||0]
    );

    // Insertar items para estadísticas
    for (const item of (items||[])) {
      await pool.query(
        `INSERT INTO venta_items (venta_id,negocio_id,inventario_id,nombre,cantidad,precio_unit,subtotal_item)
         VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)})`,
        [id, nid(req), item.inventario_id||null, item.nombre, item.qty||item.cantidad||1,
         item.precio||item.precio_unit, (item.qty||1)*(item.precio||0)]
      );
      // Descontar stock según receta o vínculo directo
      if (item.item_id) {
        const qty = item.qty || 1;
        // Receta: descontar cada ingrediente
        const { rows: receta } = await pool.query(
          `SELECT inventario_id, cantidad FROM menu_item_recetas WHERE menu_item_id=${ph(1)} AND negocio_id=${ph(2)}`,
          [item.item_id, nid(req)]
        );
        if (receta.length > 0) {
          for (const ing of receta) {
            await pool.query(
              `UPDATE inventario SET stock=GREATEST(0, stock-${ph(1)}), actualizado=NOW() WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
              [ing.cantidad * qty, ing.inventario_id, nid(req)]
            );
          }
        } else {
          // Sin receta: vínculo directo a inventario o stock de menu_items
          const { rows: mi } = await pool.query(
            `SELECT inventario_id FROM menu_items WHERE id=${ph(1)} AND negocio_id=${ph(2)} LIMIT 1`,
            [item.item_id, nid(req)]
          );
          const invId = mi[0]?.inventario_id;
          if (invId) {
            await pool.query(
              `UPDATE inventario SET stock=GREATEST(0, stock-${ph(1)}), actualizado=NOW() WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
              [qty, invId, nid(req)]
            );
          } else {
            await pool.query(
              `UPDATE menu_items SET stock=GREATEST(0, stock-${ph(1)}) WHERE id=${ph(2)} AND negocio_id=${ph(3)} AND stock IS NOT NULL`,
              [qty, item.item_id, nid(req)]
            );
          }
        }
      } else if (item.inventario_id) {
        await pool.query(
          `UPDATE inventario SET stock=GREATEST(0,stock-${ph(1)}), actualizado=NOW() WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
          [item.qty||1, item.inventario_id, nid(req)]
        );
      }
    }

    // Actualizar la caja del cajero que procesa el pago
    await pool.query(`
      UPDATE cajas SET total_ventas=total_ventas+${ph(1)},
        total_efectivo=total_efectivo+(CASE WHEN ${ph(2)}='efectivo' THEN ${ph(3)} ELSE 0 END),
        total_tarjeta=total_tarjeta+(CASE WHEN ${ph(4)}='tarjeta'   THEN ${ph(5)} ELSE 0 END),
        total_nequi=total_nequi+(CASE WHEN ${ph(6)}='nequi'         THEN ${ph(7)} ELSE 0 END)
      WHERE negocio_id=${ph(8)} AND usuario_id=${ph(9)} AND estado='abierta' AND fecha=CURRENT_DATE
    `, [total, metodo_pago, total, metodo_pago, total, metodo_pago, total, nid(req), req.user.id]);

    res.status(201).json({ id, numero_factura });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/ventas', async (req, res) => {
  try {
    const { desde, hasta, tipo } = req.query;
    const d = desde || localDate();
    const h = hasta  || d;
    let sql = `SELECT * FROM ventas WHERE negocio_id=${ph(1)} AND DATE(creado) BETWEEN ${ph(2)} AND ${ph(3)}`;
    const params = [nid(req), d, h];
    if (tipo) { params.push(tipo); sql += ` AND tipo=${ph(params.length)}`; }
    sql += ' ORDER BY creado DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Top platos / bebidas (soporta filtro ?tipo=bar para top del bar)
router.get('/ventas/top-platos', async (req, res) => {
  try {
    const { desde, hasta, metodo_pago, tipo } = req.query;
    const d = desde || localDate();
    const h = hasta  || d;
    let sql = `
      SELECT vi.nombre, CAST(SUM(vi.cantidad) AS UNSIGNED) AS vendidos, SUM(vi.subtotal_item) AS total
      FROM venta_items vi
      JOIN ventas v ON v.id = vi.venta_id
      WHERE vi.negocio_id=${ph(1)} AND DATE(vi.creado) BETWEEN ${ph(2)} AND ${ph(3)}`;
    const params = [nid(req), d, h];
    if (tipo)        { params.push(tipo);        sql += ` AND v.tipo=${ph(params.length)}`; }
    if (metodo_pago) { params.push(metodo_pago); sql += ` AND v.metodo_pago=${ph(params.length)}`; }
    sql += ' GROUP BY vi.nombre ORDER BY vendidos DESC LIMIT 15';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
