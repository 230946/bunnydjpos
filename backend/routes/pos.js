/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
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
const QRCode  = require('qrcode');

router.use(authMiddleware);
const nid = req => req.user.negocio_id;
const localDate = (tz = 'America/Bogota') => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());

// Para un solo día, resuelve la ventana real del día de negocio (según la
// apertura/cierre real de la caja) en vez de medianoche a medianoche, para
// que las ventas de una caja que sigue abierta pasada la medianoche no se
// mezclen entre "ayer" y "hoy".
async function ventanaDelDia(negocioId, fecha, zonaHoraria) {
  const { rows } = await pool.query(
    `SELECT apertura_en, cierre_en, estado FROM cajas WHERE negocio_id=${ph(1)} AND fecha=${ph(2)} ORDER BY apertura_en ASC LIMIT 1`,
    [negocioId, fecha]
  );
  const caja = rows[0];
  const medianoche = `${fecha} 00:00:00`;
  let inicio = caja ? caja.apertura_en : medianoche;
  if (!caja) {
    const { rows: previas } = await pool.query(
      `SELECT cierre_en, estado FROM cajas WHERE negocio_id=${ph(1)} AND fecha<${ph(2)} ORDER BY fecha DESC, apertura_en DESC LIMIT 1`,
      [negocioId, fecha]
    );
    const prev = previas[0];
    if (prev && prev.estado === 'abierta') inicio = new Date();
    else if (prev && prev.cierre_en && new Date(prev.cierre_en) > new Date(medianoche)) inicio = prev.cierre_en;
  }
  let fin;
  if (caja && caja.estado === 'cerrada') fin = caja.cierre_en;
  else if (fecha === localDate(zonaHoraria)) fin = new Date();
  else fin = `${fecha} 23:59:59`;
  return { inicio, fin };
}

// Suma cantidades de la misma referencia en vez de listarla repetida: los
// artículos del menú se identifican por item_id, los manuales (sin item_id)
// por nombre+precio, ya que dos "manuales" distintos pueden compartir nombre.
function mergeComandaItems(previos, nuevos) {
  const merged = (previos || []).map(i => ({ ...i }));
  for (const item of (nuevos || [])) {
    const existing = merged.find(m => item.item_id
      ? m.item_id === item.item_id
      : (!m.item_id && m.nombre === item.nombre && +m.precio === +item.precio));
    if (existing) existing.qty = (+existing.qty || 0) + (+item.qty || 1);
    else merged.push({ ...item });
  }
  return merged;
}

// Revisa que haya stock suficiente para los items con item_id (receta >
// vínculo directo a inventario > stock propio del artículo). Devuelve el
// objeto de error a responder (400) o null si todo está disponible.
async function verificarStockItems(items, negocioId) {
  for (const item of (items || [])) {
    if (!item.item_id) continue;
    const qty = item.qty || item.cantidad || 1;
    const { rows: receta } = await pool.query(
      `SELECT r.cantidad, inv.stock, inv.nombre AS inv_nombre
       FROM menu_item_recetas r
       JOIN inventario inv ON inv.id = r.inventario_id
       WHERE r.menu_item_id=${ph(1)} AND r.negocio_id=${ph(2)}`,
      [item.item_id, negocioId]
    );
    if (receta.length > 0) {
      for (const ing of receta) {
        const needed = ing.cantidad * qty;
        if (ing.stock < needed) {
          return {
            error: ing.stock <= 0
              ? `Ingrediente "${ing.inv_nombre}" agotado para "${item.nombre}"`
              : `Stock insuficiente de "${ing.inv_nombre}" para "${item.nombre}". Disponible: ${ing.stock}, necesario: ${needed}`,
            tipo: 'stock_insuficiente', nombre: ing.inv_nombre, stock_disponible: ing.stock
          };
        }
      }
      continue;
    }
    const { rows: sr } = await pool.query(
      `SELECT mi.nombre, mi.stock, mi.inventario_id,
              inv.stock AS inv_stock, inv.nombre AS inv_nombre
       FROM menu_items mi
       LEFT JOIN inventario inv ON inv.id = mi.inventario_id
       WHERE mi.id=${ph(1)} AND mi.negocio_id=${ph(2)} LIMIT 1`,
      [item.item_id, negocioId]
    );
    if (!sr[0]) return { error: `Producto no encontrado: ${item.nombre}`, tipo: 'sin_producto' };
    const { nombre, stock, inventario_id, inv_stock, inv_nombre } = sr[0];
    if (inventario_id) {
      if (inv_stock !== null && inv_stock < qty)
        return {
          error: inv_stock <= 0 ? `"${inv_nombre}" está agotado` : `Stock insuficiente para "${inv_nombre}". Disponible: ${inv_stock}`,
          tipo: 'stock_insuficiente', nombre: inv_nombre, stock_disponible: inv_stock
        };
    } else if (stock !== null && stock < qty) {
      return {
        error: stock <= 0 ? `"${nombre}" está agotado` : `Stock insuficiente para "${nombre}". Disponible: ${stock}`,
        tipo: 'stock_insuficiente', nombre, stock_disponible: stock
      };
    }
  }
  return null;
}

// Descuenta (signo=-1) o repone (signo=+1) stock para los items con item_id,
// con la misma cascada receta > vínculo directo a inventario > stock propio.
async function moverStockItems(items, negocioId, signo) {
  for (const item of (items || [])) {
    if (!item.item_id) continue;
    const base = item.qty || item.cantidad || 1;
    const { rows: receta } = await pool.query(
      `SELECT inventario_id, cantidad FROM menu_item_recetas WHERE menu_item_id=${ph(1)} AND negocio_id=${ph(2)}`,
      [item.item_id, negocioId]
    );
    if (receta.length > 0) {
      for (const ing of receta) {
        const delta = signo * ing.cantidad * base;
        await pool.query(
          `UPDATE inventario SET stock=GREATEST(0, stock+${ph(1)}), actualizado=NOW() WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
          [delta, ing.inventario_id, negocioId]
        );
      }
    } else {
      const { rows: mi } = await pool.query(
        `SELECT inventario_id FROM menu_items WHERE id=${ph(1)} AND negocio_id=${ph(2)} LIMIT 1`,
        [item.item_id, negocioId]
      );
      const invId = mi[0]?.inventario_id;
      const delta = signo * base;
      if (invId) {
        await pool.query(
          `UPDATE inventario SET stock=GREATEST(0, stock+${ph(1)}), actualizado=NOW() WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
          [delta, invId, negocioId]
        );
      } else {
        await pool.query(
          `UPDATE menu_items SET stock=GREATEST(0, stock+${ph(1)}) WHERE id=${ph(2)} AND negocio_id=${ph(3)} AND stock IS NOT NULL`,
          [delta, item.item_id, negocioId]
        );
      }
    }
  }
}

// Promo realmente vigente HOY (activa + precio + dentro del rango de fechas),
// evaluado en SQL con CURDATE() (no en JS) para evitar desajustes de
// timezone/Date con mysql2. `promo_activo` es solo el interruptor que puso
// el negocio; esto es si de verdad aplica ahora mismo.
const PROMO_VIGENTE_SQL = `
  (mi.promo_activo=1 AND mi.promo_precio IS NOT NULL
   AND (mi.promo_desde IS NULL OR mi.promo_desde<=CURDATE())
   AND (mi.promo_hasta IS NULL OR mi.promo_hasta>=CURDATE()))
`;
const PRECIO_EFECTIVO_SQL = `CASE WHEN ${PROMO_VIGENTE_SQL} THEN mi.promo_precio ELSE mi.precio END`;

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
      `INSERT INTO mesa_estado (mesa_id, pedido, sesion_token) VALUES (${ph(1)}, '[]', ${ph(2)})`, [id, uuid()]
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

// QR de autopedido para pegar en la mesa física — apunta a /menu?n=<negocio>&mesa=<id>
router.get('/mesas/:id/qr', requirePermiso('pos_mesas'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM mesas WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, nid(req)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Mesa no encontrada' });
    const url = `${req.protocol}://${req.get('host')}/menu?n=${nid(req)}&mesa=${req.params.id}`;
    const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 });
    res.json({ url, dataUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// QR de solo lectura: el cliente ve su cuenta actual (productos y total),
// sin poder agregar nada — distinto del QR de autopedido de arriba.
router.get('/mesas/:id/qr-cuenta', requirePermiso('pos_mesas'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM mesas WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, nid(req)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Mesa no encontrada' });
    const url = `${req.protocol}://${req.get('host')}/cuenta?n=${nid(req)}&mesa=${req.params.id}`;
    const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 });
    res.json({ url, dataUrl });
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

// Limpiar mesa al cobrar (o para liberarla manualmente si quedó desincronizada)
// Renueva sesion_token: invalida el QR/link que el cliente ya facturado
// pudiera tener todavía abierto, para que no pueda seguir pidiendo desde ahí
// sin volver a escanear el código físico de la mesa.
router.post('/mesas/:id/liberar', async (req, res) => {
  try {
    await pool.query(`
      INSERT INTO mesa_estado (mesa_id, ocupada, pedido, sesion_token, actualizado)
      VALUES (${ph(1)}, 0, '[]', ${ph(2)}, NOW())
      ON DUPLICATE KEY UPDATE ocupada=0, pedido='[]', sesion_token=VALUES(sesion_token), actualizado=NOW()
    `, [req.params.id, uuid()]);
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
             ${PROMO_VIGENTE_SQL} AS promo_vigente,
             ${PRECIO_EFECTIVO_SQL} AS precio_efectivo,
             inv.stock AS inv_stock, inv.stock_min AS inv_stock_min, inv.nombre AS inv_nombre,
             inv.codigo AS codigo, inv.codigo_barras AS codigo_barras,
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
    const { nombre, descripcion, precio, categoria_id, emoji, disponible, tiempo_prep, orden, inventario_id, stock, nombre_zh, descripcion_zh,
            promo_activo, promo_precio, promo_desde, promo_hasta, destacado, destacado_texto } = req.body;
    const id = uuid();
    const stockVal = (stock !== undefined && stock !== null && stock !== '') ? +stock : null;
    await pool.query(
      `INSERT INTO menu_items (id,negocio_id,categoria_id,nombre,descripcion,precio,emoji,disponible,tiempo_prep,orden,inventario_id,stock,nombre_zh,descripcion_zh,
       promo_activo,promo_precio,promo_desde,promo_hasta,destacado,destacado_texto)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},${ph(9)},${ph(10)},${ph(11)},${ph(12)},${ph(13)},${ph(14)},
       ${ph(15)},${ph(16)},${ph(17)},${ph(18)},${ph(19)},${ph(20)})`,
      [id, nid(req), categoria_id||null, nombre, descripcion||null, precio, emoji||'🍽️',
       disponible!==false, tiempo_prep||15, orden||0, inventario_id||null, stockVal,
       nombre_zh||null, descripcion_zh||null,
       !!promo_activo, promo_precio||null, promo_desde||null, promo_hasta||null,
       !!destacado, destacado_texto||null]
    );
    req.app.locals.broadcast?.(nid(req), 'inventario_actualizado', { id });
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/menu/items/:id', requirePermiso(['pos_menu','personal']), async (req, res) => {
  try {
    const { nombre, descripcion, precio, categoria_id, emoji, disponible, tiempo_prep, orden, stock_min, inventario_id, stock, nombre_zh, descripcion_zh,
            promo_activo, promo_precio, promo_desde, promo_hasta, destacado, destacado_texto } = req.body;
    const stockVal = (stock !== undefined && stock !== null && stock !== '') ? +stock : null;
    await pool.query(
      `UPDATE menu_items SET nombre=${ph(1)},descripcion=${ph(2)},precio=${ph(3)},
       categoria_id=${ph(4)},emoji=${ph(5)},disponible=${ph(6)},tiempo_prep=${ph(7)},orden=${ph(8)},stock_min=${ph(9)},
       inventario_id=${ph(10)},stock=${ph(11)},nombre_zh=${ph(12)},descripcion_zh=${ph(13)},
       promo_activo=${ph(14)},promo_precio=${ph(15)},promo_desde=${ph(16)},promo_hasta=${ph(17)},
       destacado=${ph(18)},destacado_texto=${ph(19)}
       WHERE id=${ph(20)} AND negocio_id=${ph(21)}`,
      [nombre, descripcion, precio, categoria_id||null, emoji||'🍽️',
       disponible!==false, tiempo_prep||15, orden||0, stock_min||0,
       inventario_id||null, stockVal, nombre_zh||null, descripcion_zh||null,
       !!promo_activo, promo_precio||null, promo_desde||null, promo_hasta||null,
       !!destacado, destacado_texto||null,
       req.params.id, nid(req)]
    );
    req.app.locals.broadcast?.(nid(req), 'inventario_actualizado', { id: req.params.id });
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
    req.app.locals.broadcast?.(nid(req), 'inventario_actualizado', { id: req.params.id });
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
    req.app.locals.broadcast?.(nid(req), 'inventario_actualizado', { id: req.params.id });
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

    // El stock se descuenta al pasar el pedido (no al cobrar), así que lo
    // que se verifica/descuenta acá es siempre lo que llega en este request
    // (`items`) — en una fusión eso es solo lo nuevo que se está agregando,
    // no el acumulado, para no descontar dos veces lo que ya se pasó antes.
    const stockError = await verificarStockItems(items, nid(req));
    if (stockError) return res.status(400).json(stockError);

    // Si la mesa ya tiene una comanda activa (no entregada), fusionar los
    // nuevos artículos ahí en vez de crear una tarjeta duplicada. Si la
    // cocina ya la estaba preparando (o ya la dio por lista), se marca
    // como "adición" para que la vean de inmediato.
    if (mesa_id) {
      const { rows: existentes } = await pool.query(
        `SELECT id, items, estado FROM comandas
         WHERE negocio_id=${ph(1)} AND mesa_id=${ph(2)} AND estado != 'entregado'
         ORDER BY creado DESC LIMIT 1`,
        [nid(req), mesa_id]
      );
      if (existentes[0]) {
        const actual = existentes[0];
        const itemsPrevios = typeof actual.items === 'string' ? JSON.parse(actual.items) : (actual.items || []);
        const itemsMerge = mergeComandaItems(itemsPrevios, items);
        const esAdicion = ['cocinando', 'listo'].includes(actual.estado);
        await pool.query(
          `UPDATE comandas SET items=${ph(1)}, es_adicion=${ph(2)}, actualizado=NOW() WHERE id=${ph(3)}`,
          [JSON.stringify(itemsMerge), esAdicion ? 1 : 0, actual.id]
        );
        await moverStockItems(items, nid(req), -1);
        const comanda = { id: actual.id, mesa_num, mesa_nombre, items: itemsMerge, notas, estado: actual.estado, es_adicion: esAdicion };
        req.app.locals.broadcast?.(nid(req), 'comanda_actualizada', comanda);
        return res.status(200).json({ id: actual.id, fusionada: true });
      }
    }

    const id = uuid();
    await pool.query(
      `INSERT INTO comandas (id,negocio_id,mesa_id,mesa_num,mesa_nombre,mesero_id,items,notas,prioridad)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},${ph(9)})`,
      [id, nid(req), mesa_id||null, mesa_num, mesa_nombre||`Mesa ${mesa_num}`,
       req.user.id, JSON.stringify(items||[]), notas||null, prioridad||0]
    );
    await moverStockItems(items, nid(req), -1);
    const comanda = { id, mesa_num, mesa_nombre, items, notas, estado: 'nuevo', creado: new Date() };
    req.app.locals.broadcast?.(nid(req), 'nueva_comanda', comanda);
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Quita/reduce artículos de la(s) comanda(s) activa(s) de una mesa (ej. el
// mesero borró del pedido algo que ya se había enviado a cocina porque el
// cliente ya no lo quiso). Simétrico al merge de POST /comandas.
router.put('/comandas/reducir', async (req, res) => {
  try {
    const { mesa_id, nombre, cantidad } = req.body;
    if (!mesa_id || !nombre || !cantidad) return res.status(400).json({ error: 'mesa_id, nombre y cantidad requeridos' });
    const { rows: activas } = await pool.query(
      `SELECT id, items FROM comandas WHERE negocio_id=${ph(1)} AND mesa_id=${ph(2)} AND estado != 'entregado' ORDER BY creado DESC`,
      [nid(req), mesa_id]
    );
    let restante = cantidad;
    const repuestos = [];
    for (const c of activas) {
      if (restante <= 0) break;
      let items = typeof c.items === 'string' ? JSON.parse(c.items) : (c.items || []);
      items = items.map(it => {
        if (restante > 0 && it.nombre === nombre) {
          const quitar = Math.min(it.qty, restante);
          restante -= quitar;
          repuestos.push({ item_id: it.item_id, nombre: it.nombre, qty: quitar });
          return { ...it, qty: it.qty - quitar };
        }
        return it;
      }).filter(it => it.qty > 0);
      if (!items.length) {
        await pool.query(`UPDATE comandas SET estado='entregado', actualizado=NOW() WHERE id=${ph(1)}`, [c.id]);
      } else {
        await pool.query(`UPDATE comandas SET items=${ph(1)}, actualizado=NOW() WHERE id=${ph(2)}`, [JSON.stringify(items), c.id]);
      }
    }
    // Lo que se quita de un pedido activo (no cobrado aún) nunca se consumió,
    // así que se repone al inventario (stock ya se había descontado al pasar
    // el pedido).
    await moverStockItems(repuestos, nid(req), 1);
    req.app.locals.broadcast?.(nid(req), 'comanda_actualizada', { mesa_id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/comandas/:id/estado', async (req, res) => {
  try {
    const { estado } = req.body;
    await pool.query(
      `UPDATE comandas SET estado=${ph(1)}, es_adicion=0, actualizado=NOW() WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
      [estado, req.params.id, nid(req)]
    );
    req.app.locals.broadcast?.(nid(req), 'comanda_actualizada', { id: req.params.id, estado });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Pago parcial (abono) de un pedido de mesa/barra: permite cobrar solo una
// parte del total ahora (ej. un cliente que se va antes que el resto del
// grupo) y dejar el saldo pendiente en el mismo pedido. El stock de los
// artículos no se toca acá — ya se descontó al pasar el pedido. Cuando el
// abono cubre lo que faltaba, el pedido se cierra y la mesa se libera igual
// que un cobro completo.
router.put('/comandas/:id/pago-parcial', async (req, res) => {
  try {
    const { monto, metodo_pago, descuento, monto_efectivo, monto_tarjeta, monto_nequi } = req.body;
    const montoAbono = +monto || 0;
    if (montoAbono <= 0) return res.status(400).json({ error: 'Monto inválido' });

    const { rows } = await pool.query(
      `SELECT * FROM comandas WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, nid(req)]
    );
    const c = rows[0];
    if (!c) return res.status(404).json({ error: 'Pedido no encontrado' });

    const items = typeof c.items === 'string' ? JSON.parse(c.items) : (c.items || []);
    const totalBruto = items.reduce((a, i) => a + (+i.precio || 0) * (+i.qty || 1), 0);
    const yaPagado = +c.pagado || 0;
    // Descuento por cliente (opcional, por artículo) que el cajero aplica al
    // momento de cobrar el abono — se acumula al descuento ya aplicado antes
    // en otros abonos de este mismo pedido.
    const descuentoNuevo = Math.max(0, +descuento || 0);
    const descuentoAcumulado = Math.min(totalBruto, (+c.descuento || 0) + descuentoNuevo);
    const total = totalBruto - descuentoAcumulado;
    const saldo = total - yaPagado;
    if (montoAbono > saldo + 0.01)
      return res.status(400).json({ error: `El monto supera el saldo pendiente (${saldo})`, tipo: 'monto_excede_saldo', saldo });

    // No se exige que la caja sea justo la de hoy: si quedó una abierta de
    // un día anterior sin cerrar, sigue siendo válida para operar con ella.
    const { rows: cajaAbierta } = await pool.query(
      `SELECT id FROM cajas WHERE negocio_id=${ph(1)} AND usuario_id=${ph(2)} AND estado='abierta'`,
      [nid(req), req.user.id]
    );
    if (!cajaAbierta.length) return res.status(400).json({ error: 'Abrí tu caja antes de registrar el pago' });

    const metodo = ['efectivo','tarjeta','nequi','mixto'].includes(metodo_pago) ? metodo_pago : 'efectivo';
    // En 'mixto' los montos por método vienen del cliente (igual que en
    // POST /ventas); en cualquier otro método, todo el abono va a ese único método.
    const _montoEf = metodo === 'mixto' ? (+monto_efectivo || 0) : (metodo === 'efectivo' ? montoAbono : 0);
    const _montoTa = metodo === 'mixto' ? (+monto_tarjeta || 0) : (metodo === 'tarjeta' ? montoAbono : 0);
    const _montoNe = metodo === 'mixto' ? (+monto_nequi || 0) : (metodo === 'nequi' ? montoAbono : 0);
    const ventaId = uuid();
    const { rows: cnt } = await pool.query(`SELECT COUNT(*) AS n FROM ventas WHERE negocio_id=${ph(1)}`, [nid(req)]);
    const numero_factura = `ABN-${String((+cnt[0].n || 0) + 1).padStart(4, '0')}`;
    const nombreAbono = `Abono — ${c.mesa_nombre || (c.mesa_num ? `Mesa ${c.mesa_num}` : 'Barra')}`;

    await pool.query(
      `INSERT INTO ventas (id,negocio_id,tipo,mesa_id,mesa_num,items,
       subtotal,descuento,iva,total,metodo_pago,recibido,cambio,numero_factura,cajero_id,mesero_id,
       monto_efectivo,monto_tarjeta,monto_nequi)
       VALUES (${ph(1)},${ph(2)},'bar',${ph(3)},${ph(4)},${ph(5)},
       ${ph(6)},0,0,${ph(7)},${ph(8)},${ph(9)},0,${ph(10)},${ph(11)},${ph(12)},
       ${ph(13)},${ph(14)},${ph(15)})`,
      [ventaId, nid(req), c.mesa_id, c.mesa_num,
       JSON.stringify([{ item_id: null, nombre: nombreAbono, emoji: '💰', precio: montoAbono, qty: 1 }]),
       montoAbono, montoAbono, metodo, montoAbono, numero_factura, req.user.id, req.user.id,
       _montoEf, _montoTa, _montoNe]
    );

    const nuevoPagado = yaPagado + montoAbono;
    const completado = nuevoPagado >= total - 0.01;
    await pool.query(`UPDATE comandas SET pagado=${ph(1)}, descuento=${ph(2)}, actualizado=NOW()${completado ? `, estado='entregado'` : ''} WHERE id=${ph(3)}`,
      [nuevoPagado, descuentoAcumulado, c.id]);

    await pool.query(`
      UPDATE cajas SET total_ventas=total_ventas+${ph(1)},
        total_efectivo=total_efectivo+${ph(2)},
        total_tarjeta=total_tarjeta+${ph(3)},
        total_nequi=total_nequi+${ph(4)}
      WHERE negocio_id=${ph(5)} AND usuario_id=${ph(6)} AND estado='abierta'
    `, [montoAbono, _montoEf, _montoTa, _montoNe, nid(req), req.user.id]);

    if (completado && c.mesa_id) {
      await pool.query(`
        INSERT INTO mesa_estado (mesa_id, ocupada, pedido, sesion_token, actualizado)
        VALUES (${ph(1)}, 0, '[]', ${ph(2)}, NOW())
        ON DUPLICATE KEY UPDATE ocupada=0, pedido='[]', sesion_token=VALUES(sesion_token), actualizado=NOW()
      `, [c.mesa_id, uuid()]);
      req.app.locals.broadcast?.(nid(req), 'mesa_liberada', { mesa_id: c.mesa_id });
    }
    req.app.locals.broadcast?.(nid(req), 'comanda_actualizada', { id: c.id, mesa_id: c.mesa_id });
    req.app.locals.broadcast?.(nid(req), 'caja_actualizada', {});

    res.json({ ok: true, venta_id: ventaId, numero_factura, saldo: Math.max(0, total - nuevoPagado), completado });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Borra un pedido que se envió por error — todavía no se cobró, pero el
// stock ya se había descontado al pasarlo, así que hay que reponerlo.
router.delete('/comandas/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT mesa_id, items FROM comandas WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, nid(req)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Pedido no encontrado' });
    const items = typeof rows[0].items === 'string' ? JSON.parse(rows[0].items) : (rows[0].items || []);
    await moverStockItems(items, nid(req), 1);
    await pool.query(`DELETE FROM comandas WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, nid(req)]);
    req.app.locals.broadcast?.(nid(req), 'comanda_actualizada', { id: req.params.id, eliminada: true });
    res.json({ ok: true, mesa_id: rows[0].mesa_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Marcar todas las comandas activas como entregadas (limpiar cocina)
// También libera las mesas que tenían esas comandas pendientes: si se limpia
// la cocina es porque esas cuentas se cancelaron (ej. el cliente no pidió
// nada), así que no deben quedar "ocupadas" sin nada real detrás.
router.put('/comandas/limpiar/todo', async (req, res) => {
  try {
    const { rows: afectadas } = await pool.query(
      `SELECT DISTINCT mesa_id FROM comandas WHERE negocio_id=${ph(1)} AND estado != 'entregado' AND mesa_id IS NOT NULL`,
      [nid(req)]
    );
    await pool.query(
      `UPDATE comandas SET estado='entregado', actualizado=NOW() WHERE negocio_id=${ph(1)} AND estado != 'entregado'`,
      [nid(req)]
    );
    for (const { mesa_id } of afectadas) {
      await pool.query(
        `UPDATE mesa_estado SET ocupada=0, pedido='[]', sesion_token=${ph(1)}, actualizado=NOW() WHERE mesa_id=${ph(2)}`,
        [uuid(), mesa_id]
      );
    }
    req.app.locals.broadcast?.(nid(req), 'cocina_limpiada', {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// PEDIDOS DE CLIENTE (autopedido por QR — quedan pendientes de aprobación)
// ════════════════════════════════════════════════════════════════

router.get('/pedidos-cliente/pendientes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pedidos_cliente WHERE negocio_id=${ph(1)} AND estado='pendiente_aprobacion' ORDER BY creado ASC`,
      [nid(req)]
    );
    rows.forEach(p => { if (typeof p.items === 'string') p.items = JSON.parse(p.items); });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Aprobar = exactamente lo que hace el mesero al enviar un pedido a cocina:
// se fusiona en la comanda activa de la mesa (o crea una) y se suma a la
// cuenta corriente de la mesa (mesa_estado.pedido) ya marcada como "enviada".
router.put('/pedidos-cliente/:id/aprobar', async (req, res) => {
  try {
    const { rows: pcRows } = await pool.query(
      `SELECT * FROM pedidos_cliente WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, nid(req)]
    );
    if (!pcRows.length) return res.status(404).json({ error: 'Pedido no encontrado' });
    const pc = pcRows[0];
    if (pc.estado !== 'pendiente_aprobacion') return res.status(400).json({ error: 'Este pedido ya fue procesado' });
    const itemsCliente = typeof pc.items === 'string' ? JSON.parse(pc.items) : pc.items;

    // 1) Comanda para cocina — misma lógica de fusión que POST /comandas
    const { rows: existentes } = await pool.query(
      `SELECT id, items, estado FROM comandas
       WHERE negocio_id=${ph(1)} AND mesa_id=${ph(2)} AND estado != 'entregado'
       ORDER BY creado DESC LIMIT 1`,
      [nid(req), pc.mesa_id]
    );
    const itemsComanda = itemsCliente.map(i => ({ nombre: i.nombre, nombre_zh: i.nombre_zh || null, qty: i.qty, emoji: i.emoji }));
    let comandaId;
    if (existentes[0]) {
      const actual = existentes[0];
      const itemsPrevios = typeof actual.items === 'string' ? JSON.parse(actual.items) : (actual.items || []);
      const itemsMerge = mergeComandaItems(itemsPrevios, itemsComanda);
      const esAdicion = ['cocinando', 'listo'].includes(actual.estado);
      await pool.query(
        `UPDATE comandas SET items=${ph(1)}, es_adicion=${ph(2)}, actualizado=NOW() WHERE id=${ph(3)}`,
        [JSON.stringify(itemsMerge), esAdicion ? 1 : 0, actual.id]
      );
      comandaId = actual.id;
      req.app.locals.broadcast?.(nid(req), 'comanda_actualizada', { id: actual.id, mesa_num: pc.mesa_num, mesa_nombre: pc.mesa_nombre, items: itemsMerge, estado: actual.estado, es_adicion: esAdicion });
    } else {
      comandaId = uuid();
      await pool.query(
        `INSERT INTO comandas (id,negocio_id,mesa_id,mesa_num,mesa_nombre,mesero_id,items)
         VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)})`,
        [comandaId, nid(req), pc.mesa_id, pc.mesa_num, pc.mesa_nombre, req.user.id, JSON.stringify(itemsComanda)]
      );
      req.app.locals.broadcast?.(nid(req), 'nueva_comanda', { id: comandaId, mesa_num: pc.mesa_num, mesa_nombre: pc.mesa_nombre, items: itemsComanda, estado: 'nuevo', creado: new Date() });
    }

    // 2) Cuenta corriente de la mesa — misma lógica que PUT /mesas/:id/pedido
    const { rows: meRows } = await pool.query(
      `SELECT pedido FROM mesa_estado WHERE mesa_id=${ph(1)}`, [pc.mesa_id]
    );
    let pedidoMesa = meRows.length ? (typeof meRows[0].pedido === 'string' ? JSON.parse(meRows[0].pedido || '[]') : (meRows[0].pedido || [])) : [];
    for (const i of itemsCliente) {
      const ex = pedidoMesa.find(p => p.id === i.item_id);
      if (ex) { ex.qty += i.qty; ex.enviado = (ex.enviado || 0) + i.qty; }
      else pedidoMesa.push({ id: i.item_id, nombre: i.nombre, nombre_zh: i.nombre_zh || null, emoji: i.emoji, precio: i.precio, qty: i.qty, enviado: i.qty });
    }
    await pool.query(`
      INSERT INTO mesa_estado (mesa_id, ocupada, pedido, mesero_id, actualizado)
      VALUES (${ph(1)},1,${ph(2)},${ph(3)},NOW())
      ON DUPLICATE KEY UPDATE ocupada=1, pedido=VALUES(pedido), mesero_id=VALUES(mesero_id), actualizado=NOW()
    `, [pc.mesa_id, JSON.stringify(pedidoMesa), req.user.id]);
    req.app.locals.broadcast?.(nid(req), 'mesa_actualizada', { mesa_id: pc.mesa_id, ocupada: true, pedido: pedidoMesa });

    await pool.query(
      `UPDATE pedidos_cliente SET estado='aprobado', comanda_id=${ph(1)}, actualizado=NOW() WHERE id=${ph(2)}`,
      [comandaId, pc.id]
    );
    req.app.locals.broadcast?.(nid(req), 'pedido_cliente_actualizado', { id: pc.id, estado: 'aprobado' });

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/pedidos-cliente/:id/rechazar', async (req, res) => {
  try {
    const { motivo } = req.body || {};
    const { rows } = await pool.query(
      `SELECT id FROM pedidos_cliente WHERE id=${ph(1)} AND negocio_id=${ph(2)} AND estado='pendiente_aprobacion'`,
      [req.params.id, nid(req)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Pedido no encontrado o ya procesado' });
    await pool.query(
      `UPDATE pedidos_cliente SET estado='rechazado', motivo_rechazo=${ph(1)}, actualizado=NOW() WHERE id=${ph(2)}`,
      [motivo || null, req.params.id]
    );
    req.app.locals.broadcast?.(nid(req), 'pedido_cliente_actualizado', { id: req.params.id, estado: 'rechazado', motivo: motivo || null });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// VENTAS / COBRO
// ════════════════════════════════════════════════════════════════

router.post('/ventas', async (req, res) => {
  try {
    const { mesa_id, mesa_num, tipo='pos', items, subtotal, iva=0, total,
            metodo_pago, recibido, cambio, cliente_nombre, cliente_id, descuento,
            monto_efectivo=0, monto_tarjeta=0, monto_nequi=0, dom_id, comanda_id } = req.body;

    // Si es cobro de un domicilio, evitar cobrarlo dos veces (p.ej. si el
    // domiciliario ya marcó "Entregado" y eso ya generó la venta, o si la
    // caja ya lo cobró antes).
    if (tipo === 'domicilio' && dom_id) {
      const { rows: domCheck } = await pool.query(
        `SELECT pago_estado, venta_id FROM domicilios_pedidos WHERE id=${ph(1)} AND negocio_id=${ph(2)} LIMIT 1`,
        [dom_id, nid(req)]
      );
      if (!domCheck[0]) return res.status(404).json({ error: 'Pedido de domicilio no encontrado' });
      if (domCheck[0].pago_estado === 'pagado' || domCheck[0].venta_id)
        return res.status(409).json({ error: 'Este domicilio ya fue cobrado' });
    }

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

    // Verificar stock antes de procesar — salvo que la venta venga de una
    // comanda (pedido de mesa/barra), caso en el que el stock ya se
    // verificó y descontó al pasar el pedido, no al cobrarlo.
    if (!comanda_id) {
      const stockError = await verificarStockItems(items, nid(req));
      if (stockError) return res.status(400).json(stockError);
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
       monto_efectivo,monto_tarjeta,monto_nequi,comanda_id)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},
       ${ph(8)},${ph(9)},${ph(10)},${ph(11)},${ph(12)},${ph(13)},${ph(14)},${ph(15)},${ph(16)},${ph(17)},${ph(18)},
       ${ph(19)},${ph(20)},${ph(21)},${ph(22)})`,
      [id, nid(req), tipo, mesa_id||null, mesa_num, cliente_nombre||null, resolvedClienteId,
       JSON.stringify(items||[]), subtotal, descuento||0, iva, total,
       metodo_pago, recibido||0, cambio||0, numero_factura, req.user.id, req.user.id,
       monto_efectivo||0, monto_tarjeta||0, monto_nequi||0, comanda_id||null]
    );

    // Insertar items para estadísticas
    for (const item of (items||[])) {
      await pool.query(
        `INSERT INTO venta_items (venta_id,negocio_id,inventario_id,nombre,cantidad,precio_unit,subtotal_item)
         VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)})`,
        [id, nid(req), item.inventario_id||null, item.nombre, item.qty||item.cantidad||1,
         item.precio||item.precio_unit||item.precio_unitario||0,
         (item.qty||item.cantidad||1)*(item.precio||item.precio_unit||item.precio_unitario||0)]
      );
      // Sin comanda_id: venta directa (ej. venta rápida sin pasar pedido),
      // descuenta acá. Con comanda_id el stock ya se descontó al pasar el
      // pedido — no volver a tocarlo.
      if (!comanda_id && !item.item_id && item.inventario_id) {
        await pool.query(
          `UPDATE inventario SET stock=GREATEST(0,stock-${ph(1)}), actualizado=NOW() WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
          [item.qty||1, item.inventario_id, nid(req)]
        );
      }
    }
    if (!comanda_id) await moverStockItems(items, nid(req), -1);

    // Actualizar la caja del cajero que procesa el pago.
    // Se usan los montos por método (ya calculados por el cliente, incluido
    // el caso 'mixto') en vez de un CASE sobre metodo_pago, que dejaba el
    // pago mixto sin sumar a ningún método aunque sí sumara a total_ventas.
    const _montoEf = metodo_pago === 'mixto' ? (monto_efectivo || 0) : (metodo_pago === 'efectivo' ? total : 0);
    const _montoTa = metodo_pago === 'mixto' ? (monto_tarjeta  || 0) : (metodo_pago === 'tarjeta'  ? total : 0);
    const _montoNe = metodo_pago === 'mixto' ? (monto_nequi    || 0) : (metodo_pago === 'nequi'    ? total : 0);
    await pool.query(`
      UPDATE cajas SET total_ventas=total_ventas+${ph(1)},
        total_efectivo=total_efectivo+${ph(2)},
        total_tarjeta=total_tarjeta+${ph(3)},
        total_nequi=total_nequi+${ph(4)}
      WHERE negocio_id=${ph(5)} AND usuario_id=${ph(6)} AND estado='abierta'
    `, [total, _montoEf, _montoTa, _montoNe, nid(req), req.user.id]);

    // Enlazar el pedido de domicilio con esta venta (cerrojo atómico:
    // solo si sigue pendiente, para que un cobro concurrente no duplique).
    if (tipo === 'domicilio' && dom_id) {
      const { rows: domUpd } = await pool.query(
        `UPDATE domicilios_pedidos SET pago_estado='pagado', venta_id=${ph(1)}
         WHERE id=${ph(2)} AND negocio_id=${ph(3)} AND pago_estado='pendiente' AND venta_id IS NULL`,
        [id, dom_id, nid(req)]
      );
      // Recién facturado (y ya "listo" desde cocina) es cuando el pedido
      // queda disponible para que un domiciliario lo tome — se avisa aquí,
      // no cuando cocina lo marca "listo" (ver PUT /domicilios/pedidos/:id).
      if (domUpd.affectedRows > 0) {
        const { rows: domInfo } = await pool.query(
          `SELECT cliente_nombre, cliente_dir, total, estado FROM domicilios_pedidos WHERE id=${ph(1)}`,
          [dom_id]
        );
        if (domInfo[0]?.estado === 'listo') {
          req.app.locals.broadcast?.(nid(req), 'pedido_listo_domicilio', {
            id: dom_id,
            cliente_nombre: domInfo[0].cliente_nombre,
            cliente_dir: domInfo[0].cliente_dir,
            total: domInfo[0].total,
          });
        }
      }
    }

    req.app.locals.broadcast?.(nid(req), 'caja_actualizada', {});
    res.status(201).json({ id, numero_factura });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// FIADOS — clientes con deuda (venta sin cobro, mesa se libera igual)
// ════════════════════════════════════════════════════════════════

router.post('/fiados', async (req, res) => {
  try {
    const { mesa_id, mesa_num, cliente_id, cliente_nombre, cliente_telefono, items, subtotal, descuento, total, comanda_id } = req.body;
    if (!cliente_id && (!cliente_nombre?.trim() || !cliente_telefono?.trim()))
      return res.status(400).json({ error: 'Nombre y teléfono del cliente son requeridos' });
    if (!items?.length) return res.status(400).json({ error: 'Sin artículos' });

    // Verificar stock antes de procesar — salvo que venga de una comanda,
    // cuyo stock ya se verificó/descontó al pasar el pedido.
    if (!comanda_id) {
      const stockError = await verificarStockItems(items, nid(req));
      if (stockError) return res.status(400).json(stockError);
    }

    // Cliente: si viene cliente_id (p.ej. al activar una nota existente en
    // la ficha de un cliente), se usa ese cliente directamente — sin exigir
    // teléfono. Si no, se busca por teléfono, luego por nombre, o se crea.
    let clienteId = null, nombreFinal, telefonoFinal;
    if (cliente_id) {
      const { rows: cEx } = await pool.query(
        `SELECT id, nombre, telefono FROM clientes WHERE id=${ph(1)} AND negocio_id=${ph(2)} AND activo=1`,
        [cliente_id, nid(req)]
      );
      if (!cEx[0]) return res.status(404).json({ error: 'Cliente no encontrado' });
      clienteId = cEx[0].id; nombreFinal = cEx[0].nombre; telefonoFinal = cEx[0].telefono || '';
    } else {
      const { rows: cTel } = await pool.query(
        `SELECT id FROM clientes WHERE negocio_id=${ph(1)} AND telefono=${ph(2)} AND activo=1 LIMIT 1`,
        [nid(req), cliente_telefono.trim()]
      );
      if (cTel[0]) {
        clienteId = cTel[0].id;
      } else {
        const { rows: cNom } = await pool.query(
          `SELECT id FROM clientes WHERE negocio_id=${ph(1)} AND LOWER(TRIM(nombre))=LOWER(TRIM(${ph(2)})) AND activo=1 LIMIT 1`,
          [nid(req), cliente_nombre]
        );
        if (cNom[0]) {
          clienteId = cNom[0].id;
          await pool.query(`UPDATE clientes SET telefono=${ph(1)} WHERE id=${ph(2)} AND (telefono IS NULL OR telefono='')`,
            [cliente_telefono.trim(), clienteId]);
        } else {
          clienteId = uuid();
          await pool.query(`INSERT INTO clientes (id,negocio_id,nombre,telefono) VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)})`,
            [clienteId, nid(req), cliente_nombre.trim(), cliente_telefono.trim()]);
        }
      }
      nombreFinal = cliente_nombre.trim(); telefonoFinal = cliente_telefono.trim();
    }

    // Descontar stock — salvo que venga de una comanda, cuyo stock ya se
    // descontó al pasar el pedido.
    if (!comanda_id) await moverStockItems(items, nid(req), -1);

    const id = uuid();
    await pool.query(
      `INSERT INTO fiados (id,negocio_id,cliente_id,cliente_nombre,cliente_telefono,mesa_id,mesa_num,items,subtotal,descuento,total,usuario_id)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},${ph(9)},${ph(10)},${ph(11)},${ph(12)})`,
      [id, nid(req), clienteId, nombreFinal, telefonoFinal, mesa_id||null, mesa_num||null,
       JSON.stringify(items), subtotal||0, descuento||0, total||0, req.user.id]
    );

    // Liberar la mesa (mismo efecto que /mesas/:id/liberar)
    if (mesa_id) {
      await pool.query(`
        INSERT INTO mesa_estado (mesa_id, ocupada, pedido, sesion_token, actualizado)
        VALUES (${ph(1)}, 0, '[]', ${ph(2)}, NOW())
        ON DUPLICATE KEY UPDATE ocupada=0, pedido='[]', sesion_token=VALUES(sesion_token), actualizado=NOW()
      `, [mesa_id, uuid()]);
      await pool.query(`
        UPDATE comandas SET estado='entregado', actualizado=NOW()
        WHERE mesa_id=${ph(1)} AND negocio_id=${ph(2)} AND estado != 'entregado'
      `, [mesa_id, nid(req)]);
      req.app.locals.broadcast?.(nid(req), 'mesa_liberada', { mesa_id });
    }

    req.app.locals.broadcast?.(nid(req), 'fiados_actualizado', { id });
    res.status(201).json({ id, cliente_id: clienteId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sumar un artículo más a una deuda ya abierta (cliente que sigue
// consumiendo sobre la misma cuenta) — descuenta stock como cualquier
// venta nueva y aumenta el total de la deuda existente.
router.put('/fiados/:id/agregar-item', async (req, res) => {
  try {
    const { item_id, nombre, precio, qty, emoji } = req.body;
    const cantidad = Math.max(1, +qty || 1);
    if (!nombre?.trim()) return res.status(400).json({ error: 'Falta el artículo' });

    const { rows } = await pool.query(`SELECT * FROM fiados WHERE id=${ph(1)} AND negocio_id=${ph(2)}`, [req.params.id, nid(req)]);
    const f = rows[0];
    if (!f) return res.status(404).json({ error: 'No encontrado' });
    if (f.estado === 'pagada') return res.status(400).json({ error: 'Esta deuda ya está pagada' });

    const nuevoItem = { item_id: item_id || null, nombre: nombre.trim(), emoji: emoji || null, precio: +precio || 0, qty: cantidad };
    if (item_id) {
      const stockError = await verificarStockItems([{ item_id, nombre, qty: cantidad }], nid(req));
      if (stockError) return res.status(400).json(stockError);
    }

    const items = typeof f.items === 'string' ? JSON.parse(f.items || '[]') : (f.items || []);
    const existente = item_id ? items.find(i => i.item_id === item_id) : null;
    if (existente) existente.qty = (+existente.qty || 0) + cantidad;
    else items.push(nuevoItem);

    if (item_id) await moverStockItems([{ item_id, qty: cantidad }], nid(req), -1);

    const nuevoSubtotal = items.reduce((a, i) => a + (+i.precio || 0) * (+i.qty || 1), 0);
    const nuevoTotal = Math.max(0, nuevoSubtotal - (+f.descuento || 0));
    await pool.query(
      `UPDATE fiados SET items=${ph(1)}, subtotal=${ph(2)}, total=${ph(3)} WHERE id=${ph(4)}`,
      [JSON.stringify(items), nuevoSubtotal, nuevoTotal, f.id]
    );
    req.app.locals.broadcast?.(nid(req), 'fiados_actualizado', { id: f.id });
    if (item_id) req.app.locals.broadcast?.(nid(req), 'inventario_actualizado', {});
    res.json({ ok: true, total: nuevoTotal, items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/fiados', async (req, res) => {
  try {
    const { estado } = req.query;
    let sql = `SELECT * FROM fiados WHERE negocio_id=${ph(1)}`;
    const params = [nid(req)];
    if (estado) { params.push(estado); sql += ` AND estado=${ph(params.length)}`; }
    sql += ' ORDER BY creado DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/fiados/:id/pagar', async (req, res) => {
  try {
    const { metodo_pago, monto, item_index, descuento } = req.body;
    const { rows } = await pool.query(`SELECT * FROM fiados WHERE id=${ph(1)} AND negocio_id=${ph(2)}`, [req.params.id, nid(req)]);
    const f = rows[0];
    if (!f) return res.status(404).json({ error: 'No encontrado' });
    if (f.estado === 'pagada') return res.status(400).json({ error: 'Ya está pagada' });

    const items = typeof f.items === 'string' ? JSON.parse(f.items || '[]') : (f.items || []);
    // Abono a un artículo puntual de la deuda (en vez de al total): se
    // paga exactamente lo que vale ese artículo y queda marcado como
    // pagado, para que no se vuelva a cobrar dos veces. No admite descuento
    // (el artículo se cobra por su precio exacto).
    let itemPagado = null;
    if (item_index != null) {
      itemPagado = items[item_index];
      if (!itemPagado) return res.status(400).json({ error: 'Artículo no encontrado en la deuda' });
      if (itemPagado.pagado) return res.status(400).json({ error: 'Ese artículo ya está pagado' });
    }

    // Descuento (monto fijo $) que el cajero aplica al abonar al total de la
    // deuda — se acumula al descuento ya aplicado antes (p.ej. en un abono
    // anterior de esta misma deuda).
    const subtotalBase = +f.subtotal || ((+f.total || 0) + (+f.descuento || 0));
    const descuentoNuevo = itemPagado ? 0 : Math.max(0, +descuento || 0);
    const descuentoAcumulado = Math.min(subtotalBase, (+f.descuento || 0) + descuentoNuevo);
    const total = subtotalBase - descuentoAcumulado;
    const yaPagado = +f.pagado_monto || 0;
    const saldo = total - yaPagado;
    // Sin "monto" se paga todo lo que falta (compatibilidad con el botón
    // simple de "Marcar pagada"); con "monto" es un abono parcial; con
    // "item_index" el monto lo define el propio artículo (tope: el saldo).
    const montoAbono = itemPagado
      ? Math.min(saldo, (+itemPagado.precio || 0) * (+itemPagado.qty || 1))
      : (monto != null ? +monto : saldo);
    if (!montoAbono || montoAbono <= 0) return res.status(400).json({ error: 'Monto inválido' });
    if (montoAbono > saldo + 0.01)
      return res.status(400).json({ error: `El monto supera el saldo pendiente (${saldo})`, tipo: 'monto_excede_saldo', saldo });

    // El pago de una deuda es una venta más: necesita caja abierta para
    // poder sumarse a los totales del día, igual que cualquier otro cobro.
    // No se exige que la caja sea justo la de hoy: si quedó una abierta de
    // un día anterior sin cerrar, sigue siendo válida para operar con ella.
    const { rows: cajaAbierta } = await pool.query(
      `SELECT id FROM cajas WHERE negocio_id=${ph(1)} AND usuario_id=${ph(2)} AND estado='abierta'`,
      [nid(req), req.user.id]
    );
    if (!cajaAbierta.length) return res.status(400).json({ error: 'Abrí tu caja antes de registrar el pago' });

    const metodo = ['efectivo','tarjeta','nequi'].includes(metodo_pago) ? metodo_pago : 'efectivo';
    const nuevoPagado = yaPagado + montoAbono;
    const completado = nuevoPagado >= total - 0.01;
    const ventaId = uuid();
    const prefijo = 'FIA-';
    const { rows: cnt } = await pool.query(`SELECT COUNT(*) AS n FROM ventas WHERE negocio_id=${ph(1)}`, [nid(req)]);
    const numero_factura = `${prefijo}${String((+cnt[0].n||0)+1).padStart(4,'0')}`;
    // La venta y la caja afectadas son las del día en que se hizo el fiado
    // (cuando el producto salió de verdad), no el día en que se termina de
    // cobrar — así el historial y los reportes de ese día quedan correctos.
    const fechaDeuda = new Intl.DateTimeFormat('en-CA', { timeZone: req.user.zona_horaria || 'America/Bogota', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(f.creado));
    // Pago parcial: se registra como un abono genérico, no como si se
    // hubiera vendido el pedido completo otra vez.
    const itemsVenta = completado
      ? (typeof f.items === 'string' ? f.items : JSON.stringify(f.items))
      : itemPagado
        ? JSON.stringify([{ item_id: itemPagado.item_id || null, nombre: itemPagado.nombre, precio: itemPagado.precio, qty: itemPagado.qty || 1 }])
        : JSON.stringify([{ item_id: null, nombre: `Abono deuda — ${f.cliente_nombre}`, precio: montoAbono, qty: 1 }]);

    await pool.query(
      `INSERT INTO ventas (id,negocio_id,tipo,mesa_id,mesa_num,cliente_nombre,cliente_id,items,
       subtotal,descuento,iva,total,metodo_pago,recibido,cambio,numero_factura,cajero_id,
       monto_efectivo,monto_tarjeta,monto_nequi,creado)
       VALUES (${ph(1)},${ph(2)},'bar',${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},
       ${ph(8)},${ph(9)},0,${ph(10)},${ph(11)},${ph(12)},0,${ph(13)},${ph(14)},${ph(15)},${ph(16)},${ph(17)},${ph(18)})`,
      [ventaId, nid(req), f.mesa_id, f.mesa_num, f.cliente_nombre, f.cliente_id,
       itemsVenta,
       montoAbono, 0, montoAbono, metodo, montoAbono, numero_factura, req.user.id,
       metodo==='efectivo'?montoAbono:0, metodo==='tarjeta'?montoAbono:0, metodo==='nequi'?montoAbono:0, f.creado]
    );
    if (itemPagado && !completado) {
      itemPagado.pagado = true;
      await pool.query(`UPDATE fiados SET items=${ph(1)} WHERE id=${ph(2)}`, [JSON.stringify(items), f.id]);
    }
    await pool.query(
      `UPDATE fiados SET pagado_monto=${ph(1)}, venta_id=${ph(2)}, pagado_metodo=${ph(3)}, descuento=${ph(4)}, total=${ph(5)}${completado ? `, estado='pagada', pagado_en=NOW()` : ''} WHERE id=${ph(6)}`,
      [nuevoPagado, ventaId, metodo, descuentoAcumulado, total, f.id]
    );
    // Afecta la caja de ESE día (esté abierta o ya cerrada) — no la de hoy.
    await pool.query(`
      UPDATE cajas SET total_ventas=total_ventas+${ph(1)},
        total_efectivo=total_efectivo+${ph(2)},
        total_tarjeta=total_tarjeta+${ph(3)},
        total_nequi=total_nequi+${ph(4)}
      WHERE negocio_id=${ph(5)} AND fecha=${ph(6)}
    `, [montoAbono, metodo==='efectivo'?montoAbono:0, metodo==='tarjeta'?montoAbono:0, metodo==='nequi'?montoAbono:0, nid(req), fechaDeuda]);
    req.app.locals.broadcast?.(nid(req), 'fiados_actualizado', { id: f.id });
    req.app.locals.broadcast?.(nid(req), 'caja_actualizada', {});
    res.json({ ok: true, venta_id: ventaId, numero_factura, fecha_afectada: fechaDeuda, completado, saldo: Math.max(0, total - nuevoPagado) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/fiados/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM fiados WHERE id=${ph(1)} AND negocio_id=${ph(2)}`, [req.params.id, nid(req)]);
    const f = rows[0];
    if (!f) return res.status(404).json({ error: 'No encontrado' });
    if (f.estado === 'pagada') return res.status(400).json({ error: 'No se puede cancelar una deuda ya pagada' });
    // Devolver el stock descontado
    const items = typeof f.items === 'string' ? JSON.parse(f.items) : f.items;
    for (const item of (items||[])) {
      if (!item.item_id) continue;
      const qty = item.qty || item.cantidad || 1;
      const { rows: receta } = await pool.query(
        `SELECT inventario_id, cantidad FROM menu_item_recetas WHERE menu_item_id=${ph(1)} AND negocio_id=${ph(2)}`,
        [item.item_id, nid(req)]
      );
      if (receta.length > 0) {
        for (const ing of receta) {
          await pool.query(`UPDATE inventario SET stock=stock+${ph(1)}, actualizado=NOW() WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
            [ing.cantidad * qty, ing.inventario_id, nid(req)]);
        }
      } else {
        const { rows: mi } = await pool.query(`SELECT inventario_id FROM menu_items WHERE id=${ph(1)} AND negocio_id=${ph(2)} LIMIT 1`,
          [item.item_id, nid(req)]);
        const invId = mi[0]?.inventario_id;
        if (invId) await pool.query(`UPDATE inventario SET stock=stock+${ph(1)} WHERE id=${ph(2)} AND negocio_id=${ph(3)}`, [qty, invId, nid(req)]);
        else await pool.query(`UPDATE menu_items SET stock=stock+${ph(1)} WHERE id=${ph(2)} AND negocio_id=${ph(3)} AND stock IS NOT NULL`, [qty, item.item_id, nid(req)]);
      }
    }
    await pool.query(`DELETE FROM fiados WHERE id=${ph(1)}`, [f.id]);
    req.app.locals.broadcast?.(nid(req), 'fiados_actualizado', { id: f.id });
    req.app.locals.broadcast?.(nid(req), 'inventario_actualizado', {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/clientes', async (req, res) => {
  try {
    const { q } = req.query;
    let sql = `SELECT id, nombre, telefono, email, documento, notas FROM clientes WHERE negocio_id=${ph(1)} AND activo=1`;
    const params = [nid(req)];
    if (q) { params.push(`%${q}%`); sql += ` AND (nombre LIKE ${ph(params.length)} OR documento LIKE ${ph(params.length)})`; }
    sql += ' ORDER BY nombre LIMIT 100';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/clientes', async (req, res) => {
  try {
    const { nombre, telefono, email, documento } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
    if (!documento?.trim()) return res.status(400).json({ error: 'Número de documento requerido' });
    const exist = await pool.query(
      `SELECT id FROM clientes WHERE negocio_id=${ph(1)} AND LOWER(TRIM(nombre))=LOWER(TRIM(${ph(2)})) AND activo=1 LIMIT 1`,
      [nid(req), nombre]
    );
    if (exist.rows[0]) return res.json({ id: exist.rows[0].id, nombre, nuevo: false });
    const id = uuid();
    await pool.query(
      `INSERT INTO clientes (id,negocio_id,nombre,telefono,email,documento) VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)})`,
      [id, nid(req), nombre.trim(), telefono||null, email||null, documento.trim()]
    );
    res.status(201).json({ id, nombre: nombre.trim(), nuevo: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Limpia solo la nota de un cliente (no toca el resto de sus datos) — se usa
// al "activar" una deuda anotada a mano, para que no quede duplicada junto
// con el fiado real recién creado.
router.put('/clientes/:id/notas', async (req, res) => {
  try {
    const { notas } = req.body;
    await pool.query(`UPDATE clientes SET notas=${ph(1)} WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
      [notas || null, req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/ventas', async (req, res) => {
  try {
    const { desde, hasta, tipo } = req.query;
    const d = desde || localDate(req.user.zona_horaria);
    const h = hasta  || d;
    const unDia = d === h;
    const ventana = unDia ? await ventanaDelDia(nid(req), d, req.user.zona_horaria) : null;
    const condV = unDia ? `creado >= ${ph(2)} AND creado <= ${ph(3)}` : `DATE(creado) BETWEEN ${ph(2)} AND ${ph(3)}`;
    let sql = `SELECT * FROM ventas WHERE negocio_id=${ph(1)} AND ${condV}`;
    const params = [nid(req), unDia ? ventana.inicio : d, unDia ? ventana.fin : h];
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
    const d = desde || localDate(req.user.zona_horaria);
    const h = hasta  || d;
    const unDia = d === h;
    const ventana = unDia ? await ventanaDelDia(nid(req), d, req.user.zona_horaria) : null;
    const condVi = unDia ? `vi.creado >= ${ph(2)} AND vi.creado <= ${ph(3)}` : `DATE(vi.creado) BETWEEN ${ph(2)} AND ${ph(3)}`;
    let sql = `
      SELECT vi.nombre, CAST(SUM(vi.cantidad) AS UNSIGNED) AS vendidos, SUM(vi.subtotal_item) AS total
      FROM venta_items vi
      JOIN ventas v ON v.id = vi.venta_id
      WHERE vi.negocio_id=${ph(1)} AND ${condVi}`;
    const params = [nid(req), unDia ? ventana.inicio : d, unDia ? ventana.fin : h];
    if (tipo)        { params.push(tipo);        sql += ` AND v.tipo=${ph(params.length)}`; }
    if (metodo_pago) { params.push(metodo_pago); sql += ` AND v.metodo_pago=${ph(params.length)}`; }
    sql += ' GROUP BY vi.nombre ORDER BY vendidos DESC LIMIT 15';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
