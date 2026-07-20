/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * BUNNYDJPOS — Domicilios API
 * Rutas públicas (clientes / riders) y protegidas (admin).
 */
const express = require('express');
const { v4: uuid } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');
const { pool, ph } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const verifyToken = authMiddleware;

const router = express.Router();
const anthropic = new Anthropic();
const CHAT_MODEL = 'claude-haiku-4-5';

// ── Helpers ────────────────────────────────────────────────────────

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

function fmtMoney(n) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n);
}

// "Hoy" / "hace N días" en la zona horaria del negocio (default Bogotá)
function localDate(tz = 'America/Bogota') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function localDateHaceDias(dias, tz = 'America/Bogota') {
  const d = new Date(Date.now() - dias * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
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
  if (pedido.costo_domicilio > 0) lines.push(`  • Domicilio = ${fmtMoney(pedido.costo_domicilio)}`);
  lines.push(`\n💰 *Total: ${fmtMoney(pedido.total)}*`);
  lines.push(`\nID: ${pedido.id.slice(0, 8).toUpperCase()}`);
  return encodeURIComponent(lines.join('\n'));
}

// ══════════════════════════════════════════════════════════════════
// RUTAS PÚBLICAS (sin JWT)
// ══════════════════════════════════════════════════════════════════

// Info del negocio + catálogo disponible. Usado por GET /menu/:negocioId y por
// el chatbot (para construir el system prompt con el menú real).
async function obtenerMenuData(nid) {
  const { rows: neg } = await pool.query(
    `SELECT id, nombre, tipo, logo_url, telefono, direccion, ciudad, color_primario, moneda, costo_domicilio FROM negocios WHERE id=? AND activo=1 LIMIT 1`,
    [nid]
  );
  if (!neg[0]) return null;

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
              mi.promo_activo, mi.destacado, mi.destacado_texto,
              ${PROMO_VIGENTE_SQL} AS promo_vigente,
              ${PRECIO_EFECTIVO_SQL} AS precio_efectivo,
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

  return { negocio: neg[0], productos };
}

// GET /api/domicilios/menu/:negocioId
// Retorna productos disponibles para mostrar al cliente
router.get('/menu/:negocioId', async (req, res) => {
  try {
    const data = await obtenerMenuData(req.params.negocioId);
    if (!data) return res.status(404).json({ error: 'Negocio no encontrado' });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Valida precios/stock desde DB e inserta el pedido. Usado tanto por
// POST /pedido (formulario manual) como por el chatbot (tool crear_pedido) —
// misma lógica de verificación de precios en ambos caminos.
async function crearPedidoValidado({ negocio_id, cliente_nombre, cliente_tel, cliente_dir, items, notas, metodo_pago, monto_efectivo, monto_tarjeta, monto_nequi, tipo_entrega, broadcast }) {
  tipo_entrega = tipo_entrega === 'recoge_tienda' ? 'recoge_tienda' : 'domicilio';

  if (!negocio_id || !cliente_nombre || !cliente_tel || !items?.length)
    return { error: 'Faltan datos requeridos', status: 400 };
  if (tipo_entrega === 'domicilio' && !cliente_dir)
    return { error: 'Falta la dirección de entrega', status: 400 };

  if (!['efectivo', 'tarjeta', 'nequi', 'mixto'].includes(metodo_pago)) metodo_pago = 'efectivo';
  monto_efectivo = parseFloat(monto_efectivo) || 0;
  monto_tarjeta  = parseFloat(monto_tarjeta) || 0;
  monto_nequi    = parseFloat(monto_nequi) || 0;

  const { rows: neg } = await pool.query(
    `SELECT id, nombre, tipo, telefono, direccion, costo_domicilio FROM negocios WHERE id=? AND activo=1 LIMIT 1`,
    [negocio_id]
  );
  if (!neg[0]) return { error: 'Negocio no encontrado', status: 404 };

  const dirFinal = tipo_entrega === 'recoge_tienda'
    ? (neg[0].direccion ? `Recoge en tienda — ${neg[0].direccion}` : 'Recoge en tienda')
    : cliente_dir.trim();

  let subtotal = 0, totalIva = 0;
  const itemsValidados = [];
  const esRestaurante = ['restaurante','bar'].includes(neg[0].tipo);

  for (const it of items) {
    let prod = null;
    if (esRestaurante) {
      const { rows } = await pool.query(
        `SELECT id, nombre, nombre_zh, mi.precio AS precio_original, ${PRECIO_EFECTIVO_SQL} AS precio, 0 AS iva_pct FROM menu_items mi WHERE id=? AND negocio_id=? AND disponible=1 LIMIT 1`,
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
    itemsValidados.push({ id: prod.id, nombre: prod.nombre, nombre_zh: prod.nombre_zh || null, precio,
      precio_original: prod.precio_original != null ? parseFloat(prod.precio_original) : precio,
      qty, subtotal: sub, iva_pct: ivaPct });
  }

  if (!itemsValidados.length) return { error: 'Ningún producto válido', status: 400 };

  // El costo de domicilio solo aplica cuando de verdad hay que llevarlo —
  // "recoge en tienda" no tiene envío que cobrar.
  const costoDomicilio = tipo_entrega === 'domicilio' ? (parseFloat(neg[0].costo_domicilio) || 0) : 0;
  const total = subtotal + totalIva + costoDomicilio;
  const id    = uuid();
  const tipo  = neg[0].tipo || 'restaurante';

  if (metodo_pago === 'mixto') {
    if (Math.round((monto_efectivo + monto_tarjeta + monto_nequi) * 100) !== Math.round(total * 100))
      return { error: 'El pago mixto debe sumar el total del pedido', status: 400 };
  } else {
    monto_efectivo = metodo_pago === 'efectivo' ? total : 0;
    monto_tarjeta  = metodo_pago === 'tarjeta'  ? total : 0;
    monto_nequi    = metodo_pago === 'nequi'    ? total : 0;
  }

  await pool.query(
    `INSERT INTO domicilios_pedidos (id, negocio_id, tipo, tipo_entrega, cliente_nombre, cliente_tel, cliente_dir, items, notas, subtotal, costo_domicilio, total, estado, metodo_pago, monto_efectivo, monto_tarjeta, monto_nequi)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pendiente',?,?,?,?)`,
    [id, negocio_id, tipo, tipo_entrega, cliente_nombre.trim(), cliente_tel.trim(), dirFinal,
     JSON.stringify(itemsValidados), notas?.trim() || null, subtotal, costoDomicilio, total,
     metodo_pago, monto_efectivo, monto_tarjeta, monto_nequi]
  );

  const telNegocio = (neg[0].telefono || '').replace(/\D/g, '');
  const waLink = telNegocio
    ? `https://wa.me/${telNegocio.startsWith('57') ? '' : '57'}${telNegocio}?text=${buildWhatsAppText({ id, cliente_nombre, cliente_tel, cliente_dir: dirFinal, notas, items: itemsValidados, costo_domicilio: costoDomicilio, total }, neg[0])}`
    : null;

  if (broadcast) {
    broadcast(negocio_id, 'domicilio_nuevo', {
      id, cliente_nombre: cliente_nombre.trim(), cliente_tel: cliente_tel.trim(),
      cliente_dir: dirFinal, tipo_entrega, notas: notas?.trim() || null,
      items: itemsValidados, costo_domicilio: costoDomicilio, total, negocio_nombre: neg[0].nombre
    });
  }

  return { ok: true, id, subtotal, costo_domicilio: costoDomicilio, total, wa_link: waLink, tipo_entrega };
}

// POST /api/domicilios/pedido
// Crear nuevo pedido de domicilio (cliente, formulario manual)
router.post('/pedido', async (req, res) => {
  try {
    const result = await crearPedidoValidado({ ...req.body, broadcast: req.app?.locals?.broadcast });
    if (result.error) return res.status(result.status || 500).json({ error: result.error });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Chatbot de pedidos (alternativa al formulario manual) ──────────

// a,b,c...z,aa,ab... (mismo esquema de letras que usa el catálogo visual)
function letraItem(n) {
  let s = '';
  while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}

function buildChatSystemPrompt(negocio, productos, clienteTel) {
  const disponibles = productos.filter(p => !p.agotado);
  const categorias = [...new Set(disponibles.map(p => p.categoria || 'General'))];
  let contadorItem = 0;
  const menuFormateado = categorias.map((cat, catIdx) => {
    const items = disponibles.filter(p => (p.categoria || 'General') === cat);
    const lineasCat = items.map(p => {
      contadorItem++;
      const precio = p.precio_efectivo != null ? p.precio_efectivo : p.precio;
      const promoTag = p.promo_vigente ? ` (EN PROMOCIÓN, antes ${fmtMoney(p.precio)})` : '';
      return `${letraItem(contadorItem)}. id:${p.id} | ${p.nombre} | ${fmtMoney(precio)}${promoTag}${p.descripcion ? ' | ' + p.descripcion : ''}`;
    });
    return `${catIdx + 1}. ${cat.toUpperCase()}\n${lineasCat.join('\n')}`;
  }).join('\n\n');
  const destacados = disponibles.filter(p => p.destacado);
  const costoDomicilio = parseFloat(negocio.costo_domicilio) || 0;
  let prompt = `Eres el asistente de pedidos a domicilio de "${negocio.nombre}". Ayudas al cliente a armar su pedido conversando por chat, en español, de forma breve, cálida y directa.

MENÚ DISPONIBLE (usa el "id" EXACTO al llamar la herramienta; nunca inventes ids ni precios; el "id" es solo para ti, nunca lo muestres al cliente):
${menuFormateado}`;
  if (costoDomicilio > 0) {
    prompt += `\n\nCOSTO DE DOMICILIO: ${fmtMoney(costoDomicilio)}. Este valor se suma automáticamente al total SOLO si el pedido es "a domicilio" (nunca si es "recoger en tienda"). Cuando confirmes el resumen y el total con el cliente, si es a domicilio inclúyelo como una línea aparte ("Domicilio: ${fmtMoney(costoDomicilio)}") y súmalo al total que le muestres — el total final que cobra el sistema ya lo incluye automáticamente, tú solo debes anunciarlo para que no le tome por sorpresa.`;
  }

  if (destacados.length) {
    prompt += `\n\nPRODUCTOS DESTACADOS/SUGERIDOS (recomiéndalos con gusto cuando el cliente pregunte qué le recomiendas, qué hay de especial, o no sepa qué pedir):
${destacados.map(p => `- ${p.nombre}: ${p.destacado_texto || 'recomendado'}`).join('\n')}`;
  }

  prompt += `

Reglas:
- Solo puedes ofrecer productos de esta lista. Si piden algo que no está, dilo y sugiere algo parecido del menú.
- Cuando le muestres el menú (completo o por categoría) al cliente en texto, usa EXACTAMENTE este formato, igual al de arriba: cada categoría numerada en mayúsculas ("**1.** ENTRADAS") y cada producto debajo con letra ("**a.** Empanadas Papa Carne: $3.000"). Las letras son ÚNICAS para todo el menú (no se repiten por categoría, siguen a, b, c... de corrido) — así "a" siempre identifica un solo producto sin ambigüedad. Nunca muestres el "id".
- Marca en negrilla con **así** ÚNICAMENTE el numeral o la letra de cada etiqueta, nada más — ni el nombre de la categoría, ni el nombre del producto, ni el nombre del negocio, ni ninguna otra palabra. Ejemplo EXACTO de cómo debe verse una línea: "**1.** ENTRADAS" (no "**1. ENTRADAS**") y "**a.** Empanadas Papa Carne: $3.000" (no "**a. Empanadas Papa Carne**: $3.000"). Es la única negrilla permitida en todo el chat — en el resto del texto nunca uses markdown (nada de **negrita** en frases normales, guiones de lista, #, etc.).
- Si el cliente responde solo con una letra (ej. "la a", "quiero b"), identifica exactamente el producto de esa letra en el listado del menú de arriba.
- Si el cliente quiere ver el menú de forma general (saluda, pregunta "qué tienen", o no menciona un producto o categoría concreta), NO le muestres todos los productos de una vez. Sigue este flujo de navegación por categorías:
  1. Muéstrale primero solo las CATEGORÍAS como botones (mostrar_opciones, un botón por categoría, SIN producto_id, mensaje tipo "Quiero ver Platos Principales").
  2. Cuando el cliente elija una categoría (toque el botón o la escriba), muéstrale TODOS los productos de esa categoría como tarjetas (mostrar_opciones, un botón por producto, cada uno CON su producto_id).
  3. Cuando agregue lo que quiera de ahí, pregúntale "¿Quieres pedir algo más?" y vuelve a mostrarle las CATEGORÍAS de nuevo (mostrar_opciones) para que siga explorando otra o decida terminar.
  4. Si dice que no quiere nada más, continúa pidiendo lo que falte para completar el pedido (nombre, tipo de entrega, etc.).
  Si el cliente ya pide un producto concreto por su nombre desde el inicio, ve directo a confirmarlo — no lo obligues a pasar por las categorías.
- En cuanto sepas qué quiere pedir el cliente, pregúntale pronto si es para domicilio o si va a recoger en tienda — usa mostrar_opciones con exactamente estas dos alternativas: "🛵 A domicilio" (mensaje: "Es para domicilio") y "🏪 Recoger en tienda" (mensaje: "Voy a recoger en tienda").
- Si es a domicilio, necesitas además la dirección de entrega completa. Si es para recoger en tienda, NO pidas dirección.
- Antes de crear el pedido necesitas: productos y cantidades, nombre del cliente, tipo de entrega (y dirección si es a domicilio), y método de pago (efectivo, tarjeta o nequi).
- Confirma el resumen (productos, cantidades, tipo de entrega y total) con el cliente antes de llamar a la herramienta crear_pedido.
- Cuando el cliente confirme, llama a crear_pedido con los datos exactos, incluyendo tipo_entrega.
- No hables de temas ajenos al pedido.
- Usa SIEMPRE la herramienta mostrar_opciones cuando le des al cliente una lista corta para elegir: categorías, productos del menú, sabores/tamaños, cantidades sugeridas, tipo de entrega, método de pago, o continuar/finalizar. Así el cliente toca un botón en vez de escribir. No la uses para pedir texto libre (nombre, dirección). Cuando la opción sea un producto puntual del menú, incluye siempre su "producto_id" (el id exacto) para que se muestre con foto y precio, como una tarjeta de producto.
- Toda opción que NO sea un producto puntual (categorías, sí/no, continuar/finalizar, método de pago, tipo de entrega, etc.) debe numerarse igual que el menú: en el campo "label" de mostrar_opciones escribe el número primero, ej. "1. Platos Principales", "2. Super Combos" — y en tu texto de respuesta presenta esas mismas opciones numeradas con negrilla solo en el número, ej. "**1.** Platos Principales" / "**2.** Super Combos", en el mismo orden que los botones. Los productos puntuales (con producto_id) no llevan número, ya se muestran como tarjeta con foto.
- Si el cliente dice que no quiere nada, que cancela, que quiere cerrar el chat, o que ya no necesita ayuda (y no hay un pedido a medias que confirmar), llama a la herramienta finalizar_chat y despídete brevemente y con calidez.
- Si el cliente ya confirmó un pedido en esta conversación y luego dice que se arrepintió, que quiere cancelarlo o cambiarlo, llama a la herramienta cancelar_pedido. Si funciona, avísale que quedó cancelado. Si da error porque ya fue aceptado por el negocio, dile con calidez que ya no se puede cancelar desde el chat y que debe contactar directamente al negocio.`;
  if (clienteTel) prompt += `\n\nEl teléfono del cliente ya se conoce: ${clienteTel}. No se lo vuelvas a preguntar, úsalo directamente en la herramienta.`;
  return prompt;
}

const CREAR_PEDIDO_TOOL = {
  name: 'crear_pedido',
  description: 'Crea el pedido de domicilio una vez el cliente confirmó productos, nombre, dirección y método de pago.',
  input_schema: {
    type: 'object',
    properties: {
      cliente_nombre: { type: 'string', description: 'Nombre del cliente' },
      cliente_tel: { type: 'string', description: 'Teléfono/WhatsApp del cliente (10 dígitos)' },
      tipo_entrega: { type: 'string', enum: ['domicilio', 'recoge_tienda'], description: 'Si el cliente quiere que se lo lleven (domicilio) o si va a recogerlo en tienda' },
      cliente_dir: { type: 'string', description: 'Dirección de entrega completa. Solo requerida si tipo_entrega es "domicilio"; omite este campo si es "recoge_tienda"' },
      items: {
        type: 'array',
        description: 'Productos del pedido, usando el id exacto del menú',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, qty: { type: 'integer', minimum: 1 } },
          required: ['id', 'qty'],
        },
      },
      notas: { type: 'string', description: 'Notas u observaciones del pedido (opcional)' },
      metodo_pago: { type: 'string', enum: ['efectivo', 'tarjeta', 'nequi'] },
    },
    required: ['cliente_nombre', 'cliente_tel', 'tipo_entrega', 'items', 'metodo_pago'],
  },
};

const MOSTRAR_OPCIONES_TOOL = {
  name: 'mostrar_opciones',
  description: 'Muestra botones táctiles para que el cliente elija con un toque en vez de escribir. Llámala SIEMPRE que le presentes al cliente una lista de productos o alternativas para elegir (categorías, o todos los productos de una categoría, hasta 12). Después de llamarla, continúa tu respuesta normal en texto explicando esas opciones.',
  input_schema: {
    type: 'object',
    properties: {
      opciones: {
        type: 'array',
        maxItems: 12,
        description: 'Opciones para mostrar como botones',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Texto corto del botón, ej: "Empanadas Papa Carne"' },
            mensaje: { type: 'string', description: 'Lo que el cliente "dice" al tocar el botón, ej: "Quiero Empanadas Papa Carne"' },
            producto_id: { type: 'string', description: 'Si la opción es un producto puntual del menú, su "id" EXACTO — así se muestra con foto y precio. Omite este campo para opciones que no son un producto (método de pago, cantidades, sí/no, etc.)' },
          },
          required: ['label', 'mensaje'],
        },
      },
    },
    required: ['opciones'],
  },
};

const FINALIZAR_CHAT_TOOL = {
  name: 'finalizar_chat',
  description: 'Llama esta herramienta cuando el cliente diga explícitamente que no quiere nada, que quiere cancelar, cerrar el chat, o que ya no necesita más ayuda — y no hay un pedido a medias que confirmar. Después de llamarla, despídete brevemente y con calidez en tu respuesta de texto.',
  input_schema: { type: 'object', properties: {}, required: [] },
};

const CANCELAR_PEDIDO_TOOL = {
  name: 'cancelar_pedido',
  description: 'Cancela el pedido que se creó hace un momento en esta misma conversación, cuando el cliente se arrepiente justo después de confirmarlo. Solo funciona si el negocio aún no lo ha aceptado — si ya lo aceptó o está en preparación, esta herramienta devolverá un error; en ese caso dile al cliente que contacte al negocio directamente.',
  input_schema: { type: 'object', properties: {}, required: [] },
};

// Busca, en el historial crudo de la conversación, el id del último pedido
// creado exitosamente (tool_use "crear_pedido" + su tool_result con ok:true).
// Permite que "cancelar_pedido" sepa a cuál pedido se refiere el cliente sin
// necesitar estado en el servidor (cada request re-procesa el historial).
function buscarPedidoPrevioEnHistorial(messages) {
  let pedidoId = null;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if (block.type !== 'tool_use' || block.name !== 'crear_pedido') continue;
      const next = messages[i + 1];
      const result = Array.isArray(next?.content)
        ? next.content.find(b => b.type === 'tool_result' && b.tool_use_id === block.id)
        : null;
      if (!result) continue;
      try {
        const parsed = JSON.parse(typeof result.content === 'string' ? result.content : JSON.stringify(result.content));
        if (parsed?.ok && parsed.id) pedidoId = parsed.id;
      } catch { /* ignora resultados no parseables */ }
    }
  }
  return pedidoId;
}

// POST /api/domicilios/chat
// Turno de chat con Claude para armar el pedido conversacionalmente.
// Sin estado en el servidor: el frontend reenvía el historial completo (raw,
// incluye bloques tool_use/tool_result) en cada turno.
router.post('/chat', async (req, res) => {
  try {
    const { negocio_id, messages, cliente_tel } = req.body;
    if (!negocio_id || !Array.isArray(messages) || !messages.length)
      return res.status(400).json({ error: 'Faltan datos' });

    const data = await obtenerMenuData(negocio_id);
    if (!data) return res.status(404).json({ error: 'Negocio no encontrado' });

    const system = buildChatSystemPrompt(data.negocio, data.productos, cliente_tel);
    const apiMessages = messages.map(m => ({ role: m.role, content: m.content }));

    let pedidoCreado = null;
    let opcionesSugeridas = null;
    let chatFinalizado = false;
    let pedidoCancelado = null;
    let response;
    let vueltas = 0;
    const textosAcumulados = [];
    const pedidoPrevioId = buscarPedidoPrevioEnHistorial(apiMessages);

    do {
      response = await anthropic.messages.create({
        model: CHAT_MODEL,
        max_tokens: 1024,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: [CREAR_PEDIDO_TOOL, MOSTRAR_OPCIONES_TOOL, FINALIZAR_CHAT_TOOL, CANCELAR_PEDIDO_TOOL],
        messages: apiMessages,
      });

      // Claude a veces incluye texto explicativo en el MISMO turno donde llama
      // a una herramienta (no solo en el turno final) — se acumula de todos
      // los turnos para no perder esa explicación.
      const textoTurno = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      if (textoTurno) textosAcumulados.push(textoTurno);

      if (response.stop_reason !== 'tool_use') break;

      apiMessages.push({ role: 'assistant', content: response.content });
      const toolUses = response.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const toolUse of toolUses) {
        let toolResult;
        if (toolUse.name === 'crear_pedido' && !pedidoCreado) {
          const args = toolUse.input || {};
          const result = await crearPedidoValidado({
            negocio_id, cliente_nombre: args.cliente_nombre, cliente_tel: args.cliente_tel,
            cliente_dir: args.cliente_dir, items: args.items, notas: args.notas,
            metodo_pago: args.metodo_pago, tipo_entrega: args.tipo_entrega,
            monto_efectivo: 0, monto_tarjeta: 0, monto_nequi: 0,
            broadcast: req.app?.locals?.broadcast,
          });
          if (result.error) toolResult = { error: result.error };
          else {
            pedidoCreado = { id: result.id, total: result.total, cliente_nombre: args.cliente_nombre, cliente_tel: args.cliente_tel };
            toolResult = { ok: true, id: result.id, total: result.total };
          }
        } else if (toolUse.name === 'mostrar_opciones') {
          opcionesSugeridas = toolUse.input?.opciones || [];
          toolResult = { ok: true };
        } else if (toolUse.name === 'finalizar_chat') {
          chatFinalizado = true;
          toolResult = { ok: true };
        } else if (toolUse.name === 'cancelar_pedido') {
          if (!pedidoPrevioId) {
            toolResult = { error: 'No hay ningún pedido creado en esta conversación para cancelar' };
          } else {
            const { rows } = await pool.query(
              `SELECT estado FROM domicilios_pedidos WHERE id=? AND negocio_id=? LIMIT 1`,
              [pedidoPrevioId, negocio_id]
            );
            if (!rows[0]) {
              toolResult = { error: 'Pedido no encontrado' };
            } else if (rows[0].estado !== 'pendiente') {
              toolResult = { error: 'El pedido ya fue aceptado por el negocio y no se puede cancelar desde aquí — debe contactar al negocio directamente' };
            } else {
              await pool.query(
                `UPDATE domicilios_pedidos SET estado='cancelado' WHERE id=? AND negocio_id=? AND estado='pendiente'`,
                [pedidoPrevioId, negocio_id]
              );
              pedidoCancelado = pedidoPrevioId;
              toolResult = { ok: true };
            }
          }
        } else {
          toolResult = pedidoCreado ? { error: 'Ya se creó este pedido, no lo repitas' } : { error: 'Herramienta desconocida' };
        }
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(toolResult) });
      }

      apiMessages.push({ role: 'user', content: toolResults });
      vueltas++;
    } while (vueltas < 4);

    apiMessages.push({ role: 'assistant', content: response.content });
    const textoFinal = textosAcumulados.join('\n\n');

    res.json({ reply: textoFinal, messages: apiMessages, pedido: pedidoCreado, opciones: opcionesSugeridas, finalizar: chatFinalizado, cancelado: pedidoCancelado });
  } catch (e) {
    console.error('[domicilios/chat] Error:', e.message);
    res.status(500).json({ error: 'No se pudo procesar el mensaje. Intenta de nuevo.' });
  }
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
      `SELECT p.id, p.estado, p.negocio_id, p.cliente_nombre, p.items, p.subtotal, p.total, p.created_at, p.llego_en, p.tipo_entrega,
              COALESCE(r.nombre, e.nombre) AS rider_nombre,
              COALESCE(r.telefono, e.celular) AS rider_tel,
              e.lat AS rider_lat, e.lng AS rider_lng, e.gps_at AS rider_gps_at,
              e.foto_url AS rider_foto, e.vehiculo AS rider_vehiculo,
              e.placa AS rider_placa, e.color_vehiculo AS rider_color_vehiculo
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
  if (!documento || !celular) return res.status(400).json({ error: 'Faltan datos' });
  try {
    const cel = String(celular).replace(/[\s\-()]/g, '');
    const doc = String(documento).trim();
    // Sin negocio_id (app compartida entre negocios): busca al empleado solo
    // por documento+celular, que ya son únicos por persona real.
    const { rows } = negocio_id
      ? await pool.query(
          `SELECT id, nombre, rol, token, negocio_id, foto_url, vehiculo, placa, color_vehiculo FROM empleados
           WHERE negocio_id=? AND documento=? AND celular=? AND activo=1 LIMIT 1`,
          [negocio_id, doc, cel]
        )
      : await pool.query(
          `SELECT id, nombre, rol, token, negocio_id, foto_url, vehiculo, placa, color_vehiculo FROM empleados
           WHERE documento=? AND celular=? AND activo=1 LIMIT 1`,
          [doc, cel]
        );
    if (!rows[0]) return res.status(401).json({ error: 'Credenciales incorrectas o cuenta inactiva' });
    const { id, nombre, rol, token, foto_url, vehiculo, placa, color_vehiculo } = rows[0];
    res.json({ ok: true, token, id, nombre, rol, negocio_id: rows[0].negocio_id, foto_url, vehiculo, placa, color_vehiculo });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Middleware: verifica token de empleado
async function requireEmpleado(req, res, next) {
  const token = req.headers['x-rider-token'] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.nombre, e.rol, e.negocio_id, COALESCE(n.zona_horaria,'America/Bogota') AS zona_horaria
       FROM empleados e LEFT JOIN negocios n ON n.id = e.negocio_id
       WHERE e.token=? AND e.activo=1 LIMIT 1`,
      [token]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Token inválido o cuenta inactiva' });
    req.empleado = rows[0];
    next();
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// GET /api/domicilios/rider/disponibles — pedidos sin domiciliario asignado
// Solo se muestran los que ya están facturados: el ciclo es cocina→listo,
// caja lo factura (pago_estado='pagado'), y recién ahí se habilita para
// que un domiciliario lo tome — así no sale a la calle nada sin cobrar.
router.get('/rider/disponibles', requireEmpleado, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, cliente_nombre, cliente_dir, cliente_tel, total, estado, items, notas, created_at
       FROM domicilios_pedidos
       WHERE negocio_id=? AND domiciliario_id IS NULL
         AND estado='listo' AND pago_estado='pagado' AND tipo_entrega='domicilio'
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
      `SELECT id, cliente_nombre, cliente_dir, cliente_tel, total, estado, items, notas, created_at, llego_en
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

// PUT /api/domicilios/rider/mis-entregas/:id/llegue — el domiciliario marca que
// llegó a la dirección del cliente; dispara la alerta visual/sonora en la
// página de seguimiento del cliente hasta que se marque "entregado".
router.put('/rider/mis-entregas/:id/llegue', requireEmpleado, async (req, res) => {
  try {
    const { rows: check } = await pool.query(
      `SELECT id FROM domicilios_pedidos WHERE id=? AND domiciliario_id=? AND negocio_id=? LIMIT 1`,
      [req.params.id, req.empleado.id, req.empleado.negocio_id]
    );
    if (!check[0]) return res.status(404).json({ error: 'Pedido no encontrado' });
    await pool.query(
      `UPDATE domicilios_pedidos SET llego_en=NOW(), actualizado=NOW()
       WHERE id=? AND domiciliario_id=? AND negocio_id=?`,
      [req.params.id, req.empleado.id, req.empleado.negocio_id]
    );
    res.json({ ok: true });
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
    const tz = req.empleado.zona_horaria || 'America/Bogota';
    const hoy = localDate(tz);
    const hace6 = localDateHaceDias(6, tz);
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
    let sql = `SELECT p.id, p.cliente_nombre, p.cliente_tel, p.cliente_dir, p.tipo_entrega,
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
    const hoy = localDate(req.user.zona_horaria);
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

    // Nota: el aviso al domiciliario NO se dispara aquí — el pedido "listo"
    // todavía debe pasar por caja (facturarse) antes de estar disponible
    // para que un domiciliario lo tome. Ver POST /pos/ventas, que es donde
    // se marca pago_estado='pagado' y se notifica.

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domicilios/pedidos/:id/reenviar-aviso — vuelve a avisar a los
// domiciliarios de un pedido que ya está "listo" (ej. quedó pendiente porque
// el domiciliario no vio la notificación, o estaba desconectado/sin la app
// abierta). No cambia ningún dato, solo repite el broadcast.
router.post('/pedidos/:id/reenviar-aviso', verifyToken, async (req, res) => {
  try {
    const nid = req.user.negocio_id;
    const { rows } = await pool.query(
      `SELECT cliente_nombre, cliente_dir, total, estado, pago_estado, domiciliario_id FROM domicilios_pedidos WHERE id=? AND negocio_id=?`,
      [req.params.id, nid]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (rows[0].estado !== 'listo') return res.status(400).json({ error: 'El pedido no está en estado "listo"' });
    if (rows[0].pago_estado !== 'pagado') return res.status(400).json({ error: 'El pedido aún no se ha facturado en caja' });
    if (rows[0].domiciliario_id) return res.status(400).json({ error: 'Este pedido ya fue tomado por un domiciliario' });
    req.app.locals.broadcast?.(nid, 'pedido_listo_domicilio', {
      id: req.params.id,
      cliente_nombre: rows[0].cliente_nombre,
      cliente_dir: rows[0].cliente_dir,
      total: rows[0].total,
    });
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
