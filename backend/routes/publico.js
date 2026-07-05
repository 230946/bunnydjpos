/**
 * routes/publico.js
 * Endpoints públicos (sin login) para el autopedido por QR desde la mesa.
 * Sin authMiddleware a propósito — el cliente que escanea el QR no tiene cuenta.
 */
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { pool, ph } = require('../db');

// GET /api/publico/menu/:negocio_id — menú público para armar el pedido
router.get('/menu/:negocio_id', async (req, res) => {
  try {
    const { negocio_id } = req.params;
    const { rows: neg } = await pool.query(
      `SELECT id FROM negocios WHERE id=${ph(1)} AND activo=1 LIMIT 1`, [negocio_id]
    );
    if (!neg.length) return res.status(404).json({ error: 'Negocio no encontrado' });

    const { rows: categorias } = await pool.query(
      `SELECT id, nombre, icono, orden FROM menu_categorias
       WHERE negocio_id=${ph(1)} AND activa=1 AND (modulo IS NULL OR modulo='pos')
       ORDER BY orden, nombre`,
      [negocio_id]
    );
    const { rows: items } = await pool.query(
      `SELECT mi.id, mi.categoria_id, mi.nombre, mi.nombre_zh, mi.descripcion, mi.descripcion_zh,
              mi.precio, mi.foto_url, mi.emoji
       FROM menu_items mi
       LEFT JOIN menu_categorias mc ON mc.id = mi.categoria_id
       WHERE mi.negocio_id=${ph(1)} AND mi.disponible=1 AND (mc.modulo IS NULL OR mc.modulo='pos')
       ORDER BY mi.orden, mi.nombre`,
      [negocio_id]
    );
    res.json({ categorias, items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/publico/mesa/:mesa_id?n=<negocio_id> — valida que el QR apunte a una mesa real
// y devuelve el sesion_token vigente: se lo lleva el cliente y hay que
// mandarlo de vuelta al confirmar el pedido (ver POST /pedidos).
router.get('/mesa/:mesa_id', async (req, res) => {
  try {
    const { mesa_id } = req.params;
    const { n } = req.query;
    if (!n) return res.status(400).json({ error: 'Falta negocio' });
    const { rows } = await pool.query(
      `SELECT m.id, m.numero, m.nombre, me.sesion_token
       FROM mesas m LEFT JOIN mesa_estado me ON me.mesa_id = m.id
       WHERE m.id=${ph(1)} AND m.negocio_id=${ph(2)} AND m.activa=1 LIMIT 1`,
      [mesa_id, n]
    );
    if (!rows.length) return res.status(404).json({ error: 'Mesa no encontrada' });
    const mesa = rows[0];
    // Mesas creadas antes de esta funcionalidad no tienen sesion_token — se
    // le asigna uno la primera vez que alguien la consulta (auto-reparación).
    if (!mesa.sesion_token) {
      mesa.sesion_token = uuid();
      await pool.query(
        `INSERT INTO mesa_estado (mesa_id, pedido, sesion_token) VALUES (${ph(1)}, '[]', ${ph(2)})
         ON DUPLICATE KEY UPDATE sesion_token=VALUES(sesion_token)`,
        [mesa_id, mesa.sesion_token]
      );
    }
    res.json(mesa);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/publico/pedidos — el cliente confirma su pedido desde la mesa
router.post('/pedidos', async (req, res) => {
  try {
    const { negocio_id, mesa_id, items, notas, cliente_nombre, cliente_celular, sesion_token } = req.body;
    if (!negocio_id || !mesa_id || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'Faltan datos del pedido' });
    }
    if (!cliente_nombre || !cliente_nombre.trim()) {
      return res.status(400).json({ error: 'Indica el nombre del cliente' });
    }
    if (!cliente_celular || cliente_celular.replace(/\D/g, '').length < 7) {
      return res.status(400).json({ error: 'Indica un número de celular válido' });
    }

    const { rows: neg } = await pool.query(
      `SELECT id FROM negocios WHERE id=${ph(1)} AND activo=1 LIMIT 1`, [negocio_id]
    );
    if (!neg.length) return res.status(404).json({ error: 'Negocio no encontrado' });

    const { rows: mesas } = await pool.query(
      `SELECT m.id, m.numero, m.nombre, me.sesion_token
       FROM mesas m LEFT JOIN mesa_estado me ON me.mesa_id = m.id
       WHERE m.id=${ph(1)} AND m.negocio_id=${ph(2)} AND m.activa=1 LIMIT 1`,
      [mesa_id, negocio_id]
    );
    if (!mesas.length) return res.status(404).json({ error: 'Mesa no encontrada' });
    const mesa = mesas[0];
    // La mesa ya fue cobrada/liberada (o limpiada) desde que el cliente cargó
    // el menú: su sesión quedó invalidada y no puede seguir pidiendo sin
    // volver a escanear el QR físico de la mesa.
    if (mesa.sesion_token && sesion_token !== mesa.sesion_token) {
      return res.status(409).json({ error: 'Esta mesa ya fue cerrada. Escanea el código QR de la mesa nuevamente para pedir.', codigo: 'sesion_invalida' });
    }

    // Evita que la misma mesa mande varios pedidos mientras uno ya espera aprobación
    const { rows: pendientes } = await pool.query(
      `SELECT id FROM pedidos_cliente WHERE mesa_id=${ph(1)} AND estado='pendiente_aprobacion' LIMIT 1`,
      [mesa_id]
    );
    if (pendientes.length) {
      return res.status(409).json({ error: 'Ya hay un pedido esperando confirmación en esta mesa' });
    }

    // No confiar en nombre/precio que mande el cliente: se releen del menú
    const itemsFinal = [];
    for (const it of items) {
      const qty = parseInt(it.qty) || 0;
      if (!it.item_id || qty <= 0) continue;
      const { rows: mi } = await pool.query(
        `SELECT id, nombre, nombre_zh, precio, emoji, disponible FROM menu_items
         WHERE id=${ph(1)} AND negocio_id=${ph(2)} LIMIT 1`,
        [it.item_id, negocio_id]
      );
      if (!mi.length || !mi[0].disponible) {
        return res.status(400).json({ error: `"${mi[0]?.nombre || 'Artículo'}" ya no está disponible` });
      }
      itemsFinal.push({
        item_id: mi[0].id, nombre: mi[0].nombre, nombre_zh: mi[0].nombre_zh,
        precio: parseFloat(mi[0].precio) || 0, emoji: mi[0].emoji, qty
      });
    }
    if (!itemsFinal.length) return res.status(400).json({ error: 'Agrega al menos un artículo' });

    const id = uuid();
    await pool.query(
      `INSERT INTO pedidos_cliente (id, negocio_id, mesa_id, mesa_num, mesa_nombre, cliente_nombre, cliente_celular, items, notas)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},${ph(9)})`,
      [id, negocio_id, mesa_id, mesa.numero, mesa.nombre, cliente_nombre.trim(), cliente_celular.trim(), JSON.stringify(itemsFinal), notas || null]
    );

    req.app.locals.broadcast?.(negocio_id, 'pedido_cliente_nuevo', {
      id, mesa_id, mesa_num: mesa.numero, mesa_nombre: mesa.nombre, cliente_nombre: cliente_nombre.trim(), cliente_celular: cliente_celular.trim(), items: itemsFinal, notas: notas || null
    });

    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/publico/pedidos/:id — respaldo por si el cliente pierde el WebSocket
router.get('/pedidos/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT estado, motivo_rechazo FROM pedidos_cliente WHERE id=${ph(1)} LIMIT 1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
