/**
 * BUNNYDJPOS — Domicilios API
 * Rutas públicas (clientes / riders) y protegidas (admin).
 */
const express = require('express');
const { v4: uuid } = require('uuid');
const { pool, ph } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const verifyToken = authMiddleware;

const router = express.Router();

// ── Helpers ────────────────────────────────────────────────────────
function fmtMoney(n) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n);
}

// Confirma entrega y cierra el ciclo: marca pago_estado='pagado' e inserta en ventas.
// Usa venta_id como cerrojo atómico (AND venta_id IS NULL en el UPDATE) para que solo
// un llamado concurrente gane la carrera y cree la venta.
async function confirmarPagoEntrega(pedidoId, negocioId) {
  const { rows: current } = await pool.query(
    `SELECT pago_estado, venta_id, cliente_nombre, items, subtotal, total,
            metodo_pago, monto_efectivo, monto_tarjeta, monto_nequi
     FROM domicilios_pedidos WHERE id=? AND negocio_id=? LIMIT 1`,
    [pedidoId, negocioId]
  );
  if (!current[0]) return null;
  if (current[0].venta_id) return null; // ya tiene venta registrada
  if (current[0].pago_estado === 'pagado') return null;

  // Generar venta_id antes del UPDATE para usarlo como cerrojo atómico
  const ventaId = uuid();
  await pool.query(
    `UPDATE domicilios_pedidos SET pago_estado='pagado', venta_id=?
     WHERE id=? AND negocio_id=? AND pago_estado='pendiente' AND venta_id IS NULL`,
    [ventaId, pedidoId, negocioId]
  );

  // Verificar que este llamado fue el que fijó el venta_id (ganó la carrera)
  const { rows: verify } = await pool.query(
    `SELECT venta_id FROM domicilios_pedidos WHERE id=? AND negocio_id=? LIMIT 1`,
    [pedidoId, negocioId]
  );
  if (!verify[0] || verify[0].venta_id !== ventaId) return null;

  const ped = current[0];
  const items = typeof ped.items === 'string' ? JSON.parse(ped.items) : (ped.items || []);
  const iva = items.reduce((acc, it) => acc + (parseFloat(it.subtotal) || 0) * ((parseFloat(it.iva_pct) || 0) / 100), 0);

  const { rows: cfg } = await pool.query(
    `SELECT datos FROM config_factura WHERE negocio_id=? LIMIT 1`, [negocioId]
  );
  let prefijo = 'DOM-', consec = 1;
  if (cfg[0]) {
    const d = typeof cfg[0].datos === 'string' ? JSON.parse(cfg[0].datos) : cfg[0].datos;
    prefijo = d.prefijo || 'FAC-';
    consec  = d.consecutivo || 1;
  }
  const numero_factura = `${prefijo}${String(consec).padStart(4, '0')}`;

  try {
    await pool.query(
      `INSERT INTO ventas (id,negocio_id,tipo,mesa_id,mesa_num,cliente_nombre,items,
       subtotal,descuento,iva,total,metodo_pago,recibido,cambio,numero_factura,cajero_id,mesero_id,
       monto_efectivo,monto_tarjeta,monto_nequi)
       VALUES (${ph(1)},${ph(2)},'domicilio',NULL,NULL,${ph(3)},${ph(4)},
       ${ph(5)},0,${ph(6)},${ph(7)},${ph(8)},${ph(9)},0,${ph(10)},NULL,NULL,${ph(11)},${ph(12)},${ph(13)})`,
      [ventaId, negocioId, ped.cliente_nombre, JSON.stringify(items),
       ped.subtotal, iva, ped.total, ped.metodo_pago || 'efectivo', ped.total, numero_factura,
       ped.monto_efectivo || 0, ped.monto_tarjeta || 0, ped.monto_nequi || 0]
    );
    if (cfg[0]) {
      const d = typeof cfg[0].datos === 'string' ? JSON.parse(cfg[0].datos) : cfg[0].datos;
      d.consecutivo = consec + 1;
      await pool.query(`UPDATE config_factura SET datos=? WHERE negocio_id=?`, [JSON.stringify(d), negocioId]);
    }
  } catch (e) {
    console.error('[confirmarPagoEntrega] Error al insertar venta:', e.message);
  }

  return { ventaId, numero_factura };
}

function buildWhatsAppText(pedido, negocio) {
  const items = (typeof pedido.items === 'string' ? JSON.parse(pedido.items) : pedido.items) || [];
  let lines = [`🛵 *NUEVO PEDIDO DOMICILIO* — ${negocio.nombre || ''}\n`];
  lines.push(`👤 *Cliente:* ${pedido.cliente_nombre}`);
  lines.push(`📱 *Tel:* ${pedido.cliente_tel}`);
  lines.push(`📍 *Dirección:* ${pedido.cliente_dir}`);
  if (pedido.notas) lines.push(`📝 *Notas:* ${pedido.notas}`);
  lines.push(`\n🧾 *Productos:*`);
  items.forEach(it => {
    lines.push(`  • ${it.nombre} x${it.qty} = ${fmtMoney(it.subtotal)}`);
  });
  lines.push(`\n💰 *Total: ${fmtMoney(pedido.total)}*`);
  lines.push(`\nID: ${pedido.id.slice(0, 8).toUpperCase()}`);
  return encodeURIComponent(lines.join('\n'));
}

// ══════════════════════════════════════════════════════════════════
// RUTAS PÚBLICAS (sin JWT)
// ══════════════════════════════════════════════════════════════════

// GET /api/domicilios/menu/:negocioId
// Retorna productos disponibles para mostrar al cliente
router.get('/menu/:negocioId', async (req, res) => {
  try {
    const nid = req.params.negocioId;

    // Info del negocio
    const { rows: neg } = await pool.query(
      `SELECT id, nombre, tipo, logo_url, telefono, direccion, ciudad, color_primario FROM negocios WHERE id=? AND activo=1 LIMIT 1`,
      [nid]
    );
    if (!neg[0]) return res.status(404).json({ error: 'Negocio no encontrado' });

    // Color corporativo: campo explícito o default por tipo de negocio
    const COLOR_TIPO = {
      restaurante: '#e65c00', bar: '#7c1f3e', minimercado: '#0B8457',
      peluqueria: '#0B8457', veterinaria: '#0ea5e9', farmacia: '#dc2626',
      taller: '#374151', lavanderia: '#0284c7', gimnasio: '#7c3aed',
    };
    neg[0].color_primario = neg[0].color_primario || COLOR_TIPO[neg[0].tipo] || '#6c4ff6';

    const tipo = neg[0].tipo;
    let productos = [];

    if (tipo === 'restaurante' || tipo === 'bar') {
      // Restaurante/bar → menu_items con verificación de stock de receta e inventario
      const { rows } = await pool.query(
        `SELECT mi.id, mi.nombre, mi.nombre_zh, mi.descripcion, mi.descripcion_zh,
                mi.precio, COALESCE(mi.foto_url, mi.emoji) AS imagen_url,
                COALESCE(mc.nombre, 'General') AS categoria, 0 AS iva_pct, NULL AS unidad,
                mi.disponible, mi.stock AS item_stock,
                inv.stock AS inv_stock,
                (SELECT COUNT(*) FROM menu_item_recetas r WHERE r.menu_item_id = mi.id) AS receta_count,
                (SELECT FLOOR(MIN(inv2.stock / r2.cantidad))
                 FROM menu_item_recetas r2
                 JOIN inventario inv2 ON inv2.id = r2.inventario_id
                 WHERE r2.menu_item_id = mi.id) AS receta_porciones
         FROM menu_items mi
         LEFT JOIN menu_categorias mc ON mc.id = mi.categoria_id
         LEFT JOIN inventario inv ON inv.id = mi.inventario_id
         WHERE mi.negocio_id=?
         ORDER BY mc.nombre, mi.orden, mi.nombre`,
        [nid]
      );
      productos = rows.map(r => {
        let agotado = !r.disponible;
        if (!agotado) {
          if (r.receta_count > 0) agotado = (r.receta_porciones === null || r.receta_porciones <= 0);
          else if (r.inv_stock !== null && r.inv_stock !== undefined) agotado = r.inv_stock <= 0;
          else if (r.item_stock !== null && r.item_stock !== undefined) agotado = r.item_stock <= 0;
        }
        return { ...r, agotado };
      });
    } else {
      // Minimercado y otros → inventario (incluye inactivos como agotados)
      const { rows } = await pool.query(
        `SELECT id, nombre, descripcion, precio_venta AS precio, categoria,
                NULL AS imagen_url, COALESCE(iva_pct,0) AS iva_pct, unidad, activo
         FROM inventario
         WHERE negocio_id=? AND es_producto=1
         ORDER BY categoria, nombre`,
        [nid]
      );
      productos = rows.map(r => ({ ...r, agotado: !r.activo }));
    }

    res.json({ negocio: neg[0], productos });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domicilios/pedido
// Crear nuevo pedido de domicilio (cliente)
router.post('/pedido', async (req, res) => {
  try {
    const { negocio_id, cliente_nombre, cliente_tel, cliente_dir, items, notas } = req.body;
    let { metodo_pago, monto_efectivo, monto_tarjeta, monto_nequi } = req.body;

    if (!negocio_id || !cliente_nombre || !cliente_tel || !cliente_dir || !items?.length)
      return res.status(400).json({ error: 'Faltan datos requeridos' });

    if (!['efectivo', 'tarjeta', 'nequi', 'mixto'].includes(metodo_pago)) metodo_pago = 'efectivo';
    monto_efectivo = parseFloat(monto_efectivo) || 0;
    monto_tarjeta  = parseFloat(monto_tarjeta) || 0;
    monto_nequi    = parseFloat(monto_nequi) || 0;

    // Verificar negocio existe
    const { rows: neg } = await pool.query(
      `SELECT id, nombre, tipo, telefono FROM negocios WHERE id=? AND activo=1 LIMIT 1`,
      [negocio_id]
    );
    if (!neg[0]) return res.status(404).json({ error: 'Negocio no encontrado' });

    // Calcular totales verificando precios desde DB
    let subtotal = 0, totalIva = 0;
    const itemsValidados = [];
    const esRestaurante = ['restaurante','bar'].includes(neg[0].tipo);

    for (const it of items) {
      let prod = null;
      if (esRestaurante) {
        const { rows } = await pool.query(
          `SELECT id, nombre, nombre_zh, precio, 0 AS iva_pct FROM menu_items WHERE id=? AND negocio_id=? AND disponible=1 LIMIT 1`,
          [it.id, negocio_id]
        );
        prod = rows[0];
      } else {
        const { rows } = await pool.query(
          `SELECT id, nombre, NULL AS nombre_zh, precio_venta AS precio, COALESCE(iva_pct,0) AS iva_pct FROM inventario WHERE id=? AND negocio_id=? AND es_producto=1 AND activo=1 LIMIT 1`,
          [it.id, negocio_id]
        );
        prod = rows[0];
      }
      if (!prod) continue;
      const precio = parseFloat(prod.precio) || 0;
      const qty    = parseInt(it.qty) || 1;
      const ivaPct = parseFloat(prod.iva_pct) || 0;
      const sub    = precio * qty;
      const iva    = sub * (ivaPct / 100);
      subtotal += sub;
      totalIva += iva;
      itemsValidados.push({ id: prod.id, nombre: prod.nombre, nombre_zh: prod.nombre_zh || null, precio, qty, subtotal: sub, iva_pct: ivaPct });
    }

    if (!itemsValidados.length) return res.status(400).json({ error: 'Ningún producto válido' });

    const total = subtotal + totalIva;
    const id    = uuid();
    const tipo  = neg[0].tipo || 'restaurante';

    if (metodo_pago === 'mixto') {
      if (Math.round((monto_efectivo + monto_tarjeta + monto_nequi) * 100) !== Math.round(total * 100))
        return res.status(400).json({ error: 'El pago mixto debe sumar el total del pedido' });
    } else {
      monto_efectivo = metodo_pago === 'efectivo' ? total : 0;
      monto_tarjeta  = metodo_pago === 'tarjeta'  ? total : 0;
      monto_nequi    = metodo_pago === 'nequi'    ? total : 0;
    }

    await pool.query(
      `INSERT INTO domicilios_pedidos (id, negocio_id, tipo, cliente_nombre, cliente_tel, cliente_dir, items, notas, subtotal, total, estado, metodo_pago, monto_efectivo, monto_tarjeta, monto_nequi)
       VALUES (?,?,?,?,?,?,?,?,?,?,'pendiente',?,?,?,?)`,
      [id, negocio_id, tipo, cliente_nombre.trim(), cliente_tel.trim(), cliente_dir.trim(),
       JSON.stringify(itemsValidados), notas?.trim() || null, subtotal, total,
       metodo_pago, monto_efectivo, monto_tarjeta, monto_nequi]
    );

    // Construir link WhatsApp para el negocio (se usará en el panel admin)
    const telNegocio = (neg[0].telefono || '').replace(/\D/g, '');
    const waLink = telNegocio
      ? `https://wa.me/${telNegocio.startsWith('57') ? '' : '57'}${telNegocio}?text=${buildWhatsAppText({ id, cliente_nombre, cliente_tel, cliente_dir, notas, items: itemsValidados, total }, neg[0])}`
      : null;

    // Notificar cocina y caja via WebSocket
    if (req.app?.locals?.broadcast) {
      req.app.locals.broadcast(negocio_id, 'domicilio_nuevo', {
        id, cliente_nombre: cliente_nombre.trim(), cliente_tel: cliente_tel.trim(),
        cliente_dir: cliente_dir.trim(), notas: notas?.trim() || null,
        items: itemsValidados, total, negocio_nombre: neg[0].nombre
      });
    }

    res.json({ ok: true, id, total, wa_link: waLink });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/domicilios/pedido/:id
// Estado del pedido para que el cliente haga tracking
router.get('/pedido/:id', async (req, res) => {
  try {
    const negocioId = req.query.n || null;
    const params = [req.params.id];
    let whereExtra = '';
    if (negocioId) { whereExtra = ' AND p.negocio_id=?'; params.push(negocioId); }
    const { rows } = await pool.query(
      `SELECT p.id, p.estado, p.negocio_id, p.cliente_nombre, p.items, p.subtotal, p.total, p.created_at,
              COALESCE(r.nombre, e.nombre) AS rider_nombre,
              COALESCE(r.telefono, e.celular) AS rider_tel,
              e.lat AS rider_lat, e.lng AS rider_lng, e.gps_at AS rider_gps_at
       FROM domicilios_pedidos p
       LEFT JOIN domicilios_riders r ON r.id = p.domiciliario_id
       LEFT JOIN empleados e ON e.id = p.domiciliario_id AND r.id IS NULL
       WHERE p.id=?${whereExtra} LIMIT 1`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'Pedido no encontrado' });
    const p = rows[0];
    if (typeof p.items === 'string') p.items = JSON.parse(p.items);
    res.json(p);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Domiciliario (empleado con rol domiciliario) ──────────────────

// POST /api/domicilios/empleado-login
router.post('/empleado-login', async (req, res) => {
  const { negocio_id, documento, celular } = req.body;
  if (!negocio_id || !documento || !celular) return res.status(400).json({ error: 'Faltan datos' });
  try {
    const cel = String(celular).replace(/[\s\-()]/g, '');
    const doc = String(documento).trim();
    const { rows } = await pool.query(
      `SELECT id, nombre, rol, token, negocio_id FROM empleados
       WHERE negocio_id=? AND documento=? AND celular=? AND activo=1 LIMIT 1`,
      [negocio_id, doc, cel]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Credenciales incorrectas o cuenta inactiva' });
    const { id, nombre, rol, token } = rows[0];
    res.json({ ok: true, token, id, nombre, rol, negocio_id: rows[0].negocio_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Middleware: verifica token de empleado
async function requireEmpleado(req, res, next) {
  const token = req.headers['x-rider-token'] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, rol, negocio_id FROM empleados WHERE token=? AND activo=1 LIMIT 1`,
      [token]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Token inválido o cuenta inactiva' });
    req.empleado = rows[0];
    next();
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// GET /api/domicilios/rider/disponibles — pedidos sin domiciliario asignado
router.get('/rider/disponibles', requireEmpleado, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, cliente_nombre, cliente_dir, cliente_tel, total, estado, items, notas, created_at
       FROM domicilios_pedidos
       WHERE negocio_id=? AND domiciliario_id IS NULL
         AND estado='listo'
       ORDER BY created_at ASC`,
      [req.empleado.negocio_id]
    );
    rows.forEach(r => { if (typeof r.items === 'string') r.items = JSON.parse(r.items); });
    res.json({ pedidos: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domicilios/rider/disponibles/:id/tomar — domiciliario toma un pedido
router.post('/rider/disponibles/:id/tomar', requireEmpleado, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, domiciliario_id, estado FROM domicilios_pedidos WHERE id=? AND negocio_id=? LIMIT 1`,
      [req.params.id, req.empleado.negocio_id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (rows[0].domiciliario_id) return res.status(409).json({ error: 'Este pedido ya fue tomado por otro domiciliario' });
    if (rows[0].estado !== 'listo') return res.status(400).json({ error: 'El pedido aún no está listo para despacho' });
    await pool.query(
      `UPDATE domicilios_pedidos SET domiciliario_id=?, estado='en_camino', actualizado=NOW() WHERE id=? AND negocio_id=?`,
      [req.empleado.id, req.params.id, req.empleado.negocio_id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/domicilios/rider/mis-entregas — pedidos activos del domiciliario
router.get('/rider/mis-entregas', requireEmpleado, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, cliente_nombre, cliente_dir, cliente_tel, total, estado, items, notas, created_at
       FROM domicilios_pedidos
       WHERE negocio_id=? AND domiciliario_id=? AND estado NOT IN ('entregado','cancelado')
       ORDER BY created_at DESC`,
      [req.empleado.negocio_id, req.empleado.id]
    );
    rows.forEach(r => { if (typeof r.items === 'string') r.items = JSON.parse(r.items); });
    res.json({ pedidos: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/domicilios/rider/mis-entregas/:id/estado — actualizar estado de entrega
router.put('/rider/mis-entregas/:id/estado', requireEmpleado, async (req, res) => {
  try {
    const { estado } = req.body;
    if (!['en_camino','entregado'].includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
    const { rows: check } = await pool.query(
      `SELECT id FROM domicilios_pedidos WHERE id=? AND domiciliario_id=? AND negocio_id=? LIMIT 1`,
      [req.params.id, req.empleado.id, req.empleado.negocio_id]
    );
    if (!check[0]) return res.status(404).json({ error: 'Pedido no encontrado' });
    await pool.query(
      `UPDATE domicilios_pedidos SET estado=?, actualizado=NOW()
       WHERE id=? AND domiciliario_id=? AND negocio_id=?`,
      [estado, req.params.id, req.empleado.id, req.empleado.negocio_id]
    );
    let ventaInfo = null;
    if (estado === 'entregado') {
      ventaInfo = await confirmarPagoEntrega(req.params.id, req.empleado.negocio_id);
    }
    res.json({ ok: true, ...(ventaInfo || {}) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domicilios/rider/ubicacion — domiciliario envía su posición GPS
router.post('/rider/ubicacion', requireEmpleado, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (lat == null || lng == null) return res.status(400).json({ error: 'lat/lng requeridos' });
    await pool.query(
      `UPDATE empleados SET lat=?, lng=?, gps_at=NOW() WHERE id=?`,
      [parseFloat(lat), parseFloat(lng), req.empleado.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/domicilios/rider/ubicaciones — posiciones de todos los repartidores activos (admin)
router.get('/rider/ubicaciones', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.nombre, e.lat, e.lng, e.gps_at,
              COUNT(p.id) AS pedidos_activos
       FROM empleados e
       LEFT JOIN domicilios_pedidos p ON p.domiciliario_id=e.id AND p.estado NOT IN ('entregado','cancelado')
       WHERE e.negocio_id=? AND e.activo=1 AND e.rol='domiciliario' AND e.lat IS NOT NULL
       GROUP BY e.id
       ORDER BY e.gps_at DESC`,
      [req.user.negocio_id]
    );
    res.json({ riders: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/domicilios/rider/historial?desde=&hasta= — entregas del domiciliario
// en el rango de fechas, más la tendencia diaria para la gráfica
router.get('/rider/historial', requireEmpleado, async (req, res) => {
  try {
    const hoy = new Date(Date.now() - 5*60*60*1000).toISOString().slice(0,10);
    const hace6 = new Date(Date.now() - 5*60*60*1000 - 6*86400000).toISOString().slice(0,10);
    const desde = req.query.desde || hace6;
    const hasta = req.query.hasta || hoy;

    const [{ rows: pedidos }, { rows: tendencia }] = await Promise.all([
      pool.query(
        `SELECT id, cliente_nombre, cliente_dir, cliente_tel, total, estado, created_at, actualizado
         FROM domicilios_pedidos
         WHERE negocio_id=? AND domiciliario_id=? AND estado IN ('entregado','cancelado')
           AND DATE(actualizado) BETWEEN ? AND ?
         ORDER BY actualizado DESC LIMIT 200`,
        [req.empleado.negocio_id, req.empleado.id, desde, hasta]
      ),
      pool.query(
        `SELECT DATE(actualizado) AS fecha, COUNT(*) AS entregas
         FROM domicilios_pedidos
         WHERE negocio_id=? AND domiciliario_id=? AND estado='entregado'
           AND DATE(actualizado) BETWEEN ? AND ?
         GROUP BY DATE(actualizado)
         ORDER BY fecha`,
        [req.empleado.negocio_id, req.empleado.id, desde, hasta]
      ),
    ]);
    res.json({ pedidos, tendencia });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/domicilios/mis-pedidos?n=negocio_id&tel=phone
// Permite al cliente ver sus pedidos activos por teléfono
router.get('/mis-pedidos', async (req, res) => {
  const { n: negocioId, tel } = req.query;
  if (!negocioId || !tel) return res.status(400).json({ error: 'Faltan parámetros' });
  try {
    const { rows } = await pool.query(
      `SELECT id, estado, total, created_at, items FROM domicilios_pedidos
       WHERE negocio_id=? AND cliente_tel=? AND estado NOT IN ('entregado','cancelado')
       ORDER BY created_at DESC LIMIT 5`,
      [negocioId, tel]
    );
    rows.forEach(r => { if (typeof r.items === 'string') r.items = JSON.parse(r.items); });
    res.json({ pedidos: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Rider (domiciliario) ──────────────────────────────────────────

// GET /api/domicilios/rider/:token
// Info del rider y sus pedidos asignados
router.get('/rider/:token', async (req, res) => {
  try {
    const { rows: riderRows } = await pool.query(
      `SELECT id, nombre, telefono, negocio_id FROM domicilios_riders WHERE token=? AND activo=1 LIMIT 1`,
      [req.params.token]
    );
    if (!riderRows[0]) return res.status(404).json({ error: 'Token inválido' });
    const rider = riderRows[0];

    const { rows: pedidos } = await pool.query(
      `SELECT id, cliente_nombre, cliente_tel, cliente_dir, items, notas, total, estado, created_at, actualizado
       FROM domicilios_pedidos
       WHERE domiciliario_id=? AND estado NOT IN ('entregado','cancelado')
       ORDER BY created_at DESC`,
      [rider.id]
    );
    pedidos.forEach(p => { if (typeof p.items === 'string') p.items = JSON.parse(p.items); });

    res.json({ rider, pedidos });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/domicilios/rider/:token/pedido/:pedidoId
// Rider actualiza estado del pedido
router.put('/rider/:token/pedido/:pedidoId', async (req, res) => {
  try {
    const { estado } = req.body;
    const permitidos = ['recogido', 'en_camino', 'entregado'];
    if (!permitidos.includes(estado)) return res.status(400).json({ error: 'Estado no válido' });

    const { rows: riderRows } = await pool.query(
      `SELECT id FROM domicilios_riders WHERE token=? AND activo=1 LIMIT 1`,
      [req.params.token]
    );
    if (!riderRows[0]) return res.status(404).json({ error: 'Token inválido' });

    const { rows } = await pool.query(
      `UPDATE domicilios_pedidos SET estado=?, actualizado=NOW()
       WHERE id=? AND domiciliario_id=?`,
      [estado, req.params.pedidoId, riderRows[0].id]
    );
    if (!rows.affectedRows) return res.status(404).json({ error: 'Pedido no encontrado' });

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// RUTAS PROTEGIDAS (JWT admin)
// ══════════════════════════════════════════════════════════════════

// GET /api/domicilios/pedidos?estado=pendiente&desde=2024-01-01
router.get('/pedidos', verifyToken, async (req, res) => {
  try {
    const nid   = req.user.negocio_id;
    const { estado, desde, q } = req.query;
    let sql = `SELECT p.id, p.cliente_nombre, p.cliente_tel, p.cliente_dir,
                      p.items, p.notas, p.subtotal, p.total, p.estado,
                      COALESCE(p.pago_estado,'pendiente') AS pago_estado,
                      p.metodo_pago, p.monto_efectivo, p.monto_tarjeta, p.monto_nequi,
                      p.created_at, p.actualizado,
                      COALESCE(r.nombre, e.nombre) AS rider_nombre,
                      COALESCE(r.id, e.id) AS rider_id
               FROM domicilios_pedidos p
               LEFT JOIN domicilios_riders r ON r.id = p.domiciliario_id
               LEFT JOIN empleados e ON e.id = p.domiciliario_id AND r.id IS NULL
               WHERE p.negocio_id=?`;
    const params = [nid];

    if (estado && estado !== 'todos') { sql += ` AND p.estado=?`; params.push(estado); }
    if (desde) { sql += ` AND DATE(p.created_at) >= ?`; params.push(desde); }
    if (q) { sql += ` AND (p.cliente_nombre LIKE ? OR p.cliente_tel LIKE ?)`; params.push(`%${q}%`, `%${q}%`); }

    sql += ` ORDER BY p.created_at DESC LIMIT 200`;

    const { rows } = await pool.query(sql, params);
    rows.forEach(p => { if (typeof p.items === 'string') p.items = JSON.parse(p.items); });

    // Contar pendientes para badge
    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*) AS n FROM domicilios_pedidos WHERE negocio_id=? AND estado='pendiente'`, [nid]
    );

    res.json({ pedidos: rows, pendientes: parseInt(cnt[0]?.n) || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/domicilios/reportes/resumen?desde=&hasta= — para la card del dashboard:
// total de domicilios entregados, calificación promedio y desglose por domiciliario
router.get('/reportes/resumen', verifyToken, async (req, res) => {
  try {
    const nid = req.user.negocio_id;
    const hoy = new Date(Date.now() - 5*60*60*1000).toISOString().slice(0,10);
    const d = req.query.desde || hoy;
    const h = req.query.hasta || d;

    const [{ rows: totales }, { rows: enCurso }, { rows: porRider }] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS entregados,
                AVG(calificacion) AS promedio_calificacion,
                SUM(CASE WHEN calificacion IS NOT NULL THEN 1 ELSE 0 END) AS calificados
         FROM domicilios_pedidos
         WHERE negocio_id=? AND estado='entregado' AND DATE(actualizado) BETWEEN ? AND ?`,
        [nid, d, h]
      ),
      pool.query(
        `SELECT COUNT(*) AS en_curso
         FROM domicilios_pedidos
         WHERE negocio_id=? AND estado NOT IN ('entregado','cancelado') AND DATE(created_at) BETWEEN ? AND ?`,
        [nid, d, h]
      ),
      pool.query(
        `SELECT COALESCE(r.nombre, e.nombre, 'Sin asignar') AS domiciliario,
                COUNT(*) AS entregas,
                AVG(p.calificacion) AS promedio_calificacion,
                SUM(CASE WHEN p.calificacion IS NOT NULL THEN 1 ELSE 0 END) AS calificados
         FROM domicilios_pedidos p
         LEFT JOIN domicilios_riders r ON r.id = p.domiciliario_id
         LEFT JOIN empleados e ON e.id = p.domiciliario_id AND r.id IS NULL
         WHERE p.negocio_id=? AND p.estado='entregado' AND DATE(p.actualizado) BETWEEN ? AND ?
         GROUP BY COALESCE(r.id, e.id, 'sin_asignar'), domiciliario
         ORDER BY entregas DESC`,
        [nid, d, h]
      ),
    ]);

    res.json({
      entregados: parseInt(totales[0]?.entregados) || 0,
      en_curso: parseInt(enCurso[0]?.en_curso) || 0,
      promedio_calificacion: totales[0]?.promedio_calificacion ? parseFloat(totales[0].promedio_calificacion) : null,
      calificados: parseInt(totales[0]?.calificados) || 0,
      por_domiciliario: porRider.map(r => ({
        nombre: r.domiciliario,
        entregas: parseInt(r.entregas) || 0,
        promedio_calificacion: r.promedio_calificacion ? parseFloat(r.promedio_calificacion) : null,
        calificados: parseInt(r.calificados) || 0,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/domicilios/pedidos/:id/prefactura — datos para imprimir pre-factura
router.get('/pedidos/:id/prefactura', verifyToken, async (req, res) => {
  try {
    const nid = req.user.negocio_id;
    const [{ rows: pRows }, { rows: negRows }] = await Promise.all([
      pool.query(
        `SELECT id, cliente_nombre, cliente_tel, cliente_dir, items, notas, subtotal, total, estado, pago_estado,
                metodo_pago, monto_efectivo, monto_tarjeta, monto_nequi, created_at
         FROM domicilios_pedidos WHERE id=? AND negocio_id=? LIMIT 1`,
        [req.params.id, nid]
      ),
      pool.query(
        `SELECT nombre, telefono, direccion, ciudad FROM negocios WHERE id=? LIMIT 1`, [nid]
      ),
    ]);
    if (!pRows[0]) return res.status(404).json({ error: 'Pedido no encontrado' });
    const p = pRows[0];
    if (typeof p.items === 'string') p.items = JSON.parse(p.items);
    res.json({ pedido: p, negocio: negRows[0] || {} });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/domicilios/pedidos/:id — admin actualiza estado / asigna rider
router.put('/pedidos/:id', verifyToken, async (req, res) => {
  try {
    const nid = req.user.negocio_id;
    const { estado, domiciliario_id } = req.body;
    const permitidos = ['pendiente','aceptado','en_preparacion','listo','en_camino','entregado','cancelado'];
    if (!permitidos.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });

    await pool.query(
      `UPDATE domicilios_pedidos SET estado=?, domiciliario_id=COALESCE(?,domiciliario_id), actualizado=NOW()
       WHERE id=? AND negocio_id=?`,
      [estado, domiciliario_id || null, req.params.id, nid]
    );

    if (estado === 'entregado') {
      await confirmarPagoEntrega(req.params.id, nid);
    }

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/domicilios/pendientes-count — polling ligero para badge
router.get('/pendientes-count', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS n FROM domicilios_pedidos WHERE negocio_id=? AND estado='pendiente'`,
      [req.user.negocio_id]
    );
    res.json({ n: parseInt(rows[0]?.n) || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Riders (admin) ────────────────────────────────────────────────

// GET /api/domicilios/riders
router.get('/riders', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, telefono, token, activo FROM domicilios_riders WHERE negocio_id=? ORDER BY nombre`,
      [req.user.negocio_id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domicilios/riders
router.post('/riders', verifyToken, async (req, res) => {
  try {
    const { nombre, telefono } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const id    = uuid();
    const token = uuid().replace(/-/g, '') + uuid().replace(/-/g, '').slice(0, 8); // 40-char token
    await pool.query(
      `INSERT INTO domicilios_riders (id, negocio_id, nombre, telefono, token) VALUES (?,?,?,?,?)`,
      [id, req.user.negocio_id, nombre.trim(), telefono?.trim() || null, token]
    );
    res.json({ ok: true, id, token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/domicilios/riders/:id
router.put('/riders/:id', verifyToken, async (req, res) => {
  try {
    const { nombre, telefono, activo } = req.body;
    await pool.query(
      `UPDATE domicilios_riders SET nombre=COALESCE(?,nombre), telefono=COALESCE(?,telefono),
       activo=COALESCE(?,activo) WHERE id=? AND negocio_id=?`,
      [nombre || null, telefono || null, activo != null ? activo : null, req.params.id, req.user.negocio_id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/domicilios/riders/:id
router.delete('/riders/:id', verifyToken, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM domicilios_riders WHERE id=? AND negocio_id=?`,
      [req.params.id, req.user.negocio_id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/domicilios/link/:negocioId — genera link público de la tienda
router.get('/link/:negocioId', verifyToken, async (req, res) => {
  try {
    const host = req.headers.host || 'localhost:3001';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const link = `${proto}://${host}/domicilios?n=${req.params.negocioId}`;
    res.json({ link });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domicilios/pedido/:id/calificar — cliente califica el servicio (1-5 estrellas)
router.post('/pedido/:id/calificar', async (req, res) => {
  try {
    const { calificacion, nota } = req.body;
    const cal = parseInt(calificacion);
    if (!cal || cal < 1 || cal > 5) return res.status(400).json({ error: 'Calificación inválida (1-5)' });
    await pool.query(
      `UPDATE domicilios_pedidos SET calificacion=?, calificacion_nota=? WHERE id=? LIMIT 1`,
      [cal, nota?.trim() || null, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
