/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * routes/admin.js
 * Panel Administrativo: gastos, caja diaria, config factura, impresora
 */
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { pool, ph } = require('../db');
const { authMiddleware, requirePermiso } = require('../middleware/auth');
const { enviarFactura } = require('../mailer');
const multer = require('multer');
const path = require('path');

const empFotoStorage = multer.diskStorage({
  destination: process.env.UPLOADS_DIR || './uploads',
  filename: (_, file, cb) => cb(null, 'empleado-' + uuid() + path.extname(file.originalname))
});
const uploadEmpFoto = multer({ storage: empFotoStorage, limits: { fileSize: 5 * 1024 * 1024 } });

const provCatalogoStorage = multer.diskStorage({
  destination: process.env.UPLOADS_DIR || './uploads',
  filename: (_, file, cb) => cb(null, 'catalogo-' + uuid() + path.extname(file.originalname))
});
const uploadProvCatalogo = multer({
  storage: provCatalogoStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, file.mimetype === 'application/pdf'),
});

router.use(authMiddleware);
const nid = req => req.user.negocio_id;
const localDate = (tz = 'America/Bogota') => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());

// Para un solo día (desde===hasta), usa la ventana real de la caja de ese
// día (apertura_en → cierre_en, o "ahora" si sigue abierta) en vez de
// medianoche a medianoche — así un turno que cruza la madrugada (ej. 6pm a
// 3am) no se reparte entre "ayer" y "hoy" en el dashboard y los reportes.
async function ventanaDelDia(negocioId, fecha, zonaHoraria) {
  const { rows } = await pool.query(
    `SELECT apertura_en, cierre_en, estado FROM cajas WHERE negocio_id=${ph(1)} AND fecha=${ph(2)} ORDER BY apertura_en ASC LIMIT 1`,
    [negocioId, fecha]
  );
  const caja = rows[0];
  const medianoche = `${fecha} 00:00:00`;
  let inicio = caja ? caja.apertura_en : medianoche;

  if (!caja) {
    // Todavía no se abrió caja hoy — puede ser que la de un día anterior
    // siga corriendo pasada la medianoche; mientras tanto el "día" de
    // reportes de hoy no empezó de verdad, así que se excluye esa franja
    // (que ya le pertenece al día anterior) en vez de contarla dos veces.
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

// Todos los endpoints de admin requieren negocio_id en el token
router.use((req, res, next) => {
  if (!req.user.negocio_id) {
    return res.status(400).json({
      error: 'Tu usuario no tiene un negocio asignado. Pide al superadmin que te asigne uno.'
    });
  }
  next();
});

// Si todos los artículos dados (ids de inventario) son de la misma
// categoría, devuelve el id de la categoría de gasto con ese nombre
// (creándola si no existe todavía) — null si no hay una única categoría.
async function resolverCategoriaPorArticulos(negocioId, idsItems) {
  if (!idsItems.length) return null;
  const { rows: invRows } = await pool.query(
    `SELECT DISTINCT categoria FROM inventario WHERE negocio_id=${ph(1)} AND id IN (${idsItems.map((_,i)=>ph(i+2)).join(',')}) AND categoria IS NOT NULL AND categoria != ''`,
    [negocioId, ...idsItems]
  );
  if (invRows.length !== 1) return null;
  const nombreCat = invRows[0].categoria;
  const { rows: catRows } = await pool.query(
    `SELECT id FROM gasto_categorias WHERE negocio_id=${ph(1)} AND LOWER(nombre)=LOWER(${ph(2)}) LIMIT 1`,
    [negocioId, nombreCat]
  );
  if (catRows[0]) return catRows[0].id;
  const nuevoId = uuid();
  await pool.query(
    `INSERT INTO gasto_categorias (id, negocio_id, nombre, color) VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)})`,
    [nuevoId, negocioId, nombreCat, '#378ADD']
  );
  return nuevoId;
}

// Crea (una sola vez — ver pp.gasto_id) el gasto a crédito que representa la
// plata de un pedido a proveedor, sin tocar stock. La usan tanto "marcar
// Recibido" (que además sube el stock) como "Registrar como gasto" (que no
// lo toca, para pedidos ya contabilizados antes en el inventario).
async function crearGastoPedidoProveedor(req, pp, items) {
  const categoriaId = await resolverCategoriaPorArticulos(nid(req), items.map(it => it.id).filter(Boolean));
  const gastoId = uuid();
  await pool.query(
    `INSERT INTO gastos (id,negocio_id,usuario_id,descripcion,monto,metodo_pago,fecha,proveedor_id,categoria_id)
     VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},'credito',${ph(6)},${ph(7)},${ph(8)})`,
    [gastoId, nid(req), req.user.id,
     `Pedido a proveedor — ${pp.proveedor_nombre} (${items.length} artículo${items.length===1?'':'s'})`,
     pp.total, localDate(req.user.zona_horaria), pp.proveedor_id, categoriaId]
  );
  await pool.query(`UPDATE pedidos_proveedor SET gasto_id=${ph(1)} WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
    [gastoId, pp.id, nid(req)]);
  return gastoId;
}

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
router.get('/gastos', requirePermiso('gastos'), async (req, res) => {
  try {
    const { desde, hasta, categoria_id } = req.query;
    const d = desde || localDate(req.user.zona_horaria);
    const h = hasta  || localDate(req.user.zona_horaria);
    let sql = `
      SELECT g.*, gc.nombre AS categoria_nombre, gc.color AS categoria_color,
             u.nombre AS usuario_nombre, p.nombre AS proveedor_nombre
      FROM gastos g
      LEFT JOIN gasto_categorias gc ON gc.id = g.categoria_id
      LEFT JOIN usuarios u ON u.id = g.usuario_id
      LEFT JOIN proveedores p ON p.id = g.proveedor_id
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
    const { descripcion, monto, metodo_pago, categoria_id, fecha, comprobante, proveedor_id } = req.body;
    if (!descripcion || !monto) return res.status(400).json({ error: 'descripcion y monto requeridos' });
    const metodo = metodo_pago || 'efectivo';
    const id = uuid();
    await pool.query(
      `INSERT INTO gastos (id,negocio_id,usuario_id,categoria_id,descripcion,monto,metodo_pago,fecha,comprobante,proveedor_id)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},${ph(9)},${ph(10)})`,
      [id, nid(req), req.user.id, categoria_id||null, descripcion, monto,
       metodo, fecha||localDate(req.user.zona_horaria), comprobante||null, metodo === 'credito' ? (proveedor_id||null) : null]
    );
    // Un gasto "a crédito" todavía no salió de la caja — no se descuenta hasta
    // que se pague de verdad, así que no afecta total_gastos acá.
    if (metodo !== 'credito') {
      await pool.query(
        `UPDATE cajas SET total_gastos = total_gastos + ${ph(1)}
         WHERE negocio_id=${ph(2)} AND usuario_id=${ph(3)} AND estado='abierta'`,
        [monto, nid(req), req.user.id]
      );
      req.app.locals.broadcast?.(nid(req), 'caja_actualizada', {});
    }
    req.app.locals.broadcast?.(nid(req), 'gastos_actualizado', { id });
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Saldo consolidado a crédito por proveedor — para pagar "a la cuenta" en
// vez de factura por factura. Registrado antes de /gastos/:id para que no
// quede tapado por ese comodín.
router.get('/gastos/cuentas-proveedor', requirePermiso('gastos'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT g.proveedor_id, p.nombre AS proveedor_nombre,
             SUM(g.monto - g.pagado_monto) AS saldo, COUNT(*) AS facturas
      FROM gastos g JOIN proveedores p ON p.id = g.proveedor_id
      WHERE g.negocio_id=${ph(1)} AND g.metodo_pago='credito' AND g.pagado_en IS NULL AND g.proveedor_id IS NOT NULL
      GROUP BY g.proveedor_id, p.nombre
      HAVING saldo > 0
      ORDER BY saldo DESC
    `, [nid(req)]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Abona un monto a la cuenta de un proveedor, repartiéndolo entre sus
// facturas a crédito pendientes (la más vieja primero) hasta agotarlo —
// alternativa a pagar factura por factura desde /gastos/:id/pagar. También
// va antes de /gastos/:id por el mismo motivo de orden de rutas.
router.put('/gastos/abonar-proveedor', requirePermiso('gastos'), async (req, res) => {
  try {
    const { proveedor_id, monto, metodo_pago } = req.body;
    const metodo = ['efectivo','tarjeta','transferencia'].includes(metodo_pago) ? metodo_pago : 'efectivo';
    if (!proveedor_id) return res.status(400).json({ error: 'proveedor_id requerido' });
    let montoRestante = +monto || 0;
    if (montoRestante <= 0) return res.status(400).json({ error: 'Monto inválido' });

    const { rows: pendientes } = await pool.query(
      `SELECT * FROM gastos WHERE negocio_id=${ph(1)} AND proveedor_id=${ph(2)} AND metodo_pago='credito' AND pagado_en IS NULL ORDER BY creado ASC`,
      [nid(req), proveedor_id]
    );
    const saldoTotal = pendientes.reduce((a,g) => a + (+g.monto - (+g.pagado_monto||0)), 0);
    if (montoRestante > saldoTotal + 0.01) return res.status(400).json({ error: `El monto supera el saldo de la cuenta (${saldoTotal})`, tipo: 'monto_excede_saldo', saldo: saldoTotal });

    const aplicadoTotal = montoRestante;
    for (const g of pendientes) {
      if (montoRestante <= 0) break;
      const yaPagado = +g.pagado_monto || 0;
      const saldoFactura = +g.monto - yaPagado;
      const aplicar = Math.min(saldoFactura, montoRestante);
      const nuevoPagado = yaPagado + aplicar;
      const completado = nuevoPagado >= +g.monto - 0.01;
      await pool.query(
        `UPDATE gastos SET pagado_monto=${ph(1)}, pagado_metodo=${ph(2)}, pagado_en=${completado ? 'NOW()' : 'NULL'}
         WHERE id=${ph(3)} AND negocio_id=${ph(4)}`,
        [nuevoPagado, metodo, g.id, nid(req)]
      );
      montoRestante -= aplicar;
    }
    // Igual que en /gastos/:id/pagar: se suma a la caja abierta si hay una
    // (sea de hoy o quedó abierta de un día anterior), pero no se bloquea
    // el pago si no la hay.
    await pool.query(
      `UPDATE cajas SET total_gastos = total_gastos + ${ph(1)}
       WHERE negocio_id=${ph(2)} AND estado='abierta'`,
      [aplicadoTotal, nid(req)]
    );
    req.app.locals.broadcast?.(nid(req), 'gastos_actualizado', { proveedor_id });
    req.app.locals.broadcast?.(nid(req), 'caja_actualizada', {});
    res.json({ ok: true, aplicado: aplicadoTotal, saldo: Math.max(0, saldoTotal - aplicadoTotal) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/gastos/:id', requirePermiso('gastos'), async (req, res) => {
  try {
    const { descripcion, monto, metodo_pago, categoria_id, fecha, proveedor_id } = req.body;
    await pool.query(
      `UPDATE gastos SET descripcion=${ph(1)},monto=${ph(2)},metodo_pago=${ph(3)},
       categoria_id=${ph(4)},fecha=${ph(5)},proveedor_id=${ph(6)} WHERE id=${ph(7)} AND negocio_id=${ph(8)}`,
      [descripcion, monto, metodo_pago, categoria_id||null, fecha,
       metodo_pago === 'credito' ? (proveedor_id||null) : null, req.params.id, nid(req)]
    );
    req.app.locals.broadcast?.(nid(req), 'gastos_actualizado', { id: req.params.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Pago (total o parcial/abono) de un gasto a crédito. Sin `monto` en el
// body, paga el saldo completo de una — con `monto`, abona esa parte y deja
// el resto pendiente (misma mecánica que el abono de pedidos de mesa).
router.put('/gastos/:id/pagar', requirePermiso('gastos'), async (req, res) => {
  try {
    const { metodo_pago, monto } = req.body;
    const metodo = ['efectivo','tarjeta','transferencia'].includes(metodo_pago) ? metodo_pago : 'efectivo';
    const { rows } = await pool.query(`SELECT * FROM gastos WHERE id=${ph(1)} AND negocio_id=${ph(2)}`, [req.params.id, nid(req)]);
    const g = rows[0];
    if (!g) return res.status(404).json({ error: 'Gasto no encontrado' });
    if (g.metodo_pago !== 'credito') return res.status(400).json({ error: 'Este gasto no es a crédito' });
    if (g.pagado_en) return res.status(400).json({ error: 'Ya está pagado' });

    const yaPagado = +g.pagado_monto || 0;
    const saldo = +g.monto - yaPagado;
    const montoAbono = monto != null ? +monto : saldo;
    if (!montoAbono || montoAbono <= 0) return res.status(400).json({ error: 'Monto inválido' });
    if (montoAbono > saldo + 0.01) return res.status(400).json({ error: `El monto supera el saldo pendiente (${saldo})`, tipo: 'monto_excede_saldo', saldo });

    const nuevoPagado = yaPagado + montoAbono;
    const completado = nuevoPagado >= +g.monto - 0.01;
    await pool.query(
      `UPDATE gastos SET pagado_monto=${ph(1)}, pagado_metodo=${ph(2)}, pagado_en=${completado ? 'NOW()' : 'NULL'}
       WHERE id=${ph(3)} AND negocio_id=${ph(4)}`,
      [nuevoPagado, metodo, g.id, nid(req)]
    );
    // Pagarle a un proveedor no depende de si la caja de ventas del día está
    // abierta — se suma al cierre del día si hay una caja abierta (para que
    // cuadre), pero no se bloquea el pago si no la hay.
    await pool.query(
      `UPDATE cajas SET total_gastos = total_gastos + ${ph(1)}
       WHERE negocio_id=${ph(2)} AND estado='abierta'`,
      [montoAbono, nid(req)]
    );
    req.app.locals.broadcast?.(nid(req), 'gastos_actualizado', { id: g.id });
    req.app.locals.broadcast?.(nid(req), 'caja_actualizada', {});
    res.json({ ok: true, saldo: Math.max(0, +g.monto - nuevoPagado), completado });
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
router.get('/gastos/resumen', requirePermiso('gastos'), async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const d = desde || localDate(req.user.zona_horaria);
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

// Nota: sin requirePermiso — cualquier usuario autenticado consulta SU PROPIA
// caja (filtrada por usuario_id) como parte de la inicialización normal del POS.
router.get('/caja', async (req, res) => {
  try {
    const { fecha } = req.query;
    if (fecha) {
      // Consulta histórica de una fecha puntual (reportes, etc.)
      const { rows } = await pool.query(
        `SELECT c.*, u.nombre AS usuario_nombre
         FROM cajas c LEFT JOIN usuarios u ON u.id = c.usuario_id
         WHERE c.negocio_id=${ph(1)} AND c.fecha=${ph(2)} AND c.usuario_id=${ph(3)}`,
        [nid(req), fecha, req.user.id]
      );
      return res.json(rows[0] || null);
    }
    // "Mi caja actual": si quedó una abierta de un día anterior sin cerrar,
    // es esa la que sigue operativa (un bar que trabaja hasta la madrugada
    // no tiene por qué cerrarla justo a medianoche) — se prioriza sobre la
    // de hoy. Si no hay ninguna abierta, se cae a la de hoy (p.ej. para
    // poder ofrecer "reabrir" si ya se cerró).
    const { rows: abierta } = await pool.query(
      `SELECT c.*, u.nombre AS usuario_nombre
       FROM cajas c LEFT JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.negocio_id=${ph(1)} AND c.usuario_id=${ph(2)} AND c.estado='abierta'
       ORDER BY c.fecha ASC LIMIT 1`,
      [nid(req), req.user.id]
    );
    if (abierta.length) return res.json(abierta[0]);
    const hoy = localDate(req.user.zona_horaria);
    const { rows } = await pool.query(
      `SELECT c.*, u.nombre AS usuario_nombre
       FROM cajas c LEFT JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.negocio_id=${ph(1)} AND c.fecha=${ph(2)} AND c.usuario_id=${ph(3)}`,
      [nid(req), hoy, req.user.id]
    );
    res.json(rows[0] || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Caja abierta de un día anterior que el usuario dejó sin cerrar — bloquea
// la facturación en el POS hasta que se cierre manualmente (ver /caja/cerrar).
router.get('/caja/pendiente', async (req, res) => {
  try {
    const hoy = localDate(req.user.zona_horaria);
    const { rows } = await pool.query(
      `SELECT id, fecha FROM cajas
       WHERE negocio_id=${ph(1)} AND usuario_id=${ph(2)} AND estado='abierta' AND fecha<${ph(3)}
       ORDER BY fecha ASC LIMIT 1`,
      [nid(req), req.user.id, hoy]
    );
    res.json(rows[0] || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Resumen de todas las cajas del día (para panel admin)
router.get('/caja/resumen', requirePermiso('pos_cobro'), async (req, res) => {
  try {
    const { fecha } = req.query;
    const f = fecha || localDate(req.user.zona_horaria);
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

router.get('/caja/historial', requirePermiso('pos_cobro'), async (req, res) => {
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
    const fecha = localDate(req.user.zona_horaria);
    // Bloquear si quedó una caja de un día anterior sin cerrar
    const { rows: pendiente } = await pool.query(
      `SELECT fecha FROM cajas WHERE negocio_id=${ph(1)} AND usuario_id=${ph(2)} AND estado='abierta' AND fecha<${ph(3)}
       ORDER BY fecha ASC LIMIT 1`,
      [nid(req), req.user.id, fecha]
    );
    if (pendiente.length) {
      const fPend = new Intl.DateTimeFormat('en-CA', { timeZone: req.user.zona_horaria || 'America/Bogota', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(pendiente[0].fecha));
      return res.status(400).json({ error: `Tienes una caja abierta del ${fPend} sin cerrar. Ciérrala antes de abrir una nueva.` });
    }
    // Verificar si ya hay caja para este usuario hoy
    const { rows: existe } = await pool.query(
      `SELECT id, estado FROM cajas WHERE negocio_id=${ph(1)} AND fecha=${ph(2)} AND usuario_id=${ph(3)}`,
      [nid(req), fecha, req.user.id]
    );
    if (existe.length) {
      if (existe[0].estado === 'abierta') return res.status(400).json({ error: 'Ya tienes una caja abierta hoy' });
      return res.status(400).json({ error: 'Ya tienes una caja para hoy. Usa "Reabrir" para continuar.' });
    }
    // Solo puede existir una caja por negocio y día (es un registro compartido,
    // no uno por cajero) — si otro usuario ya la abrió, avisar con su nombre
    // en vez de dejar que el INSERT choque contra la restricción UNIQUE.
    const { rows: otraCaja } = await pool.query(
      `SELECT c.estado, u.nombre AS usuario_nombre FROM cajas c LEFT JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.negocio_id=${ph(1)} AND c.fecha=${ph(2)} LIMIT 1`,
      [nid(req), fecha]
    );
    if (otraCaja.length) {
      const otro = otraCaja[0];
      return res.status(400).json({ error: otro.estado === 'abierta'
        ? `${otro.usuario_nombre || 'Otro usuario'} ya abrió la caja de hoy.`
        : `La caja de hoy ya fue abierta y cerrada por ${otro.usuario_nombre || 'otro usuario'}.` });
    }
    const id = uuid();
    await pool.query(
      `INSERT INTO cajas (id,negocio_id,usuario_id,fecha,monto_apertura)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)})`,
      [id, nid(req), req.user.id, fecha, monto_apertura || 0]
    );
    req.app.locals.broadcast?.(nid(req), 'caja_actualizada', { id });
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reabrir caja cerrada del mismo usuario (cambio de turno)
router.post('/caja/reabrir', async (req, res) => {
  try {
    const fecha = localDate(req.user.zona_horaria);
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
    req.app.locals.broadcast?.(nid(req), 'caja_actualizada', {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cerrar caja — cierra la caja abierta más antigua de este usuario (hoy o
// atrasada de un día anterior), no asume que siempre es la de hoy.
router.post('/caja/cerrar', async (req, res) => {
  try {
    const { monto_cierre, notas } = req.body;
    const { rows: abiertas } = await pool.query(
      `SELECT * FROM cajas WHERE negocio_id=${ph(1)} AND usuario_id=${ph(2)} AND estado='abierta' ORDER BY fecha ASC LIMIT 1`,
      [nid(req), req.user.id]
    );
    if (!abiertas.length) return res.status(400).json({ error: 'No tienes ninguna caja abierta' });
    const caja = abiertas[0];
    // Se suma todo lo ocurrido desde que se abrió esta caja hasta ahora (no
    // solo "el día de su fecha") — así, si quedó abierta pasada la
    // medianoche, las ventas/gastos de después también quedan incluidos en
    // el cierre en vez de perderse.
    const { rows: ventas } = await pool.query(`
      SELECT
        COALESCE(SUM(total),0) AS total_ventas,
        COALESCE(SUM(CASE WHEN monto_efectivo>0 THEN monto_efectivo WHEN metodo_pago='efectivo' THEN total ELSE 0 END),0) AS efectivo,
        COALESCE(SUM(CASE WHEN monto_tarjeta>0  THEN monto_tarjeta  WHEN metodo_pago='tarjeta'  THEN total ELSE 0 END),0) AS tarjeta,
        COALESCE(SUM(CASE WHEN monto_nequi>0    THEN monto_nequi    WHEN metodo_pago='nequi'    THEN total ELSE 0 END),0) AS nequi
      FROM ventas WHERE negocio_id=${ph(1)} AND creado>=${ph(2)} AND cajero_id=${ph(3)} AND estado!='anulada'
    `, [nid(req), caja.apertura_en, req.user.id]);
    const { rows: gastos } = await pool.query(
      `SELECT COALESCE(SUM(monto),0) AS total FROM gastos WHERE negocio_id=${ph(1)} AND creado>=${ph(2)} AND usuario_id=${ph(3)}`,
      [nid(req), caja.apertura_en, req.user.id]
    );
    const v = ventas[0];
    await pool.query(`
      UPDATE cajas SET
        estado='cerrada', monto_cierre=${ph(1)}, notas=${ph(2)},
        total_ventas=${ph(3)}, total_gastos=${ph(4)},
        total_efectivo=${ph(5)}, total_tarjeta=${ph(6)}, total_nequi=${ph(7)},
        cierre_en=NOW()
      WHERE id=${ph(8)}
    `, [monto_cierre||0, notas||'', v.total_ventas, gastos[0].total,
        v.efectivo, v.tarjeta, v.nequi, caja.id]);
    req.app.locals.broadcast?.(nid(req), 'caja_actualizada', { id: caja.id });
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

router.get('/config/domicilios', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT costo_domicilio FROM negocios WHERE id=${ph(1)}`, [nid(req)]
    );
    res.json({ costo_domicilio: rows[0]?.costo_domicilio ?? 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/config/domicilios', requirePermiso('personal'), async (req, res) => {
  try {
    const costo = Math.max(0, +req.body.costo_domicilio || 0);
    await pool.query(`UPDATE negocios SET costo_domicilio=${ph(1)} WHERE id=${ph(2)}`, [costo, nid(req)]);
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

router.post('/proveedores/:id/catalogo', requirePermiso('proveedores'), uploadProvCatalogo.single('catalogo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Subí un archivo PDF' });
    const url = `/uploads/${req.file.filename}`;
    await pool.query(`UPDATE proveedores SET catalogo_url=${ph(1)} WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
      [url, req.params.id, nid(req)]);
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/proveedores/:id/catalogo', requirePermiso('proveedores'), async (req, res) => {
  try {
    await pool.query(`UPDATE proveedores SET catalogo_url=NULL WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, nid(req)]);
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

// Artículos más comprados a proveedores (solo pedidos ya recibidos — lo que
// de verdad entró, no lo pendiente ni lo cancelado), con el valor gastado.
router.get('/pedidos-proveedor/top-articulos', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const d = desde || '2000-01-01';
    const h = hasta  || localDate(req.user.zona_horaria);
    const { rows } = await pool.query(`
      SELECT items FROM pedidos_proveedor
      WHERE negocio_id=${ph(1)} AND estado='recibido' AND fecha_pedido BETWEEN ${ph(2)} AND ${ph(3)}
    `, [nid(req), d, h]);
    const acum = {};
    for (const row of rows) {
      const items = typeof row.items === 'string' ? JSON.parse(row.items||'[]') : (row.items||[]);
      for (const it of items) {
        const nombre = it.nombre || 'Sin nombre';
        const cantidad = +it.cantidad || 0;
        const total = +it.total || (+it.cantidad||0) * (+it.costo_unitario||0);
        if (!acum[nombre]) acum[nombre] = { nombre, cantidad: 0, total: 0 };
        acum[nombre].cantidad += cantidad;
        acum[nombre].total += total;
      }
    }
    const resultado = Object.values(acum).sort((a,b) => b.total - a.total).slice(0, 15);
    res.json(resultado);
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

router.put('/pedidos-proveedor/:id', requirePermiso('proveedores'), async (req, res) => {
  try {
    const { proveedor_id, items, total, notas, fecha_entrega } = req.body;
    if (!proveedor_id) return res.status(400).json({ error: 'proveedor_id requerido' });
    await pool.query(
      `UPDATE pedidos_proveedor SET proveedor_id=${ph(1)}, items=${ph(2)}, total=${ph(3)}, notas=${ph(4)}, fecha_entrega=${ph(5)}
       WHERE id=${ph(6)} AND negocio_id=${ph(7)}`,
      [proveedor_id, JSON.stringify(items || []), total || 0, notas || null, fecha_entrega || null, req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/pedidos-proveedor/:id/estado', requirePermiso('proveedores'), async (req, res) => {
  try {
    const { estado } = req.body;
    const { rows: cur } = await pool.query(
      `SELECT pp.id, pp.estado, pp.items, pp.total, pp.proveedor_id, pp.gasto_id, p.nombre AS proveedor_nombre
       FROM pedidos_proveedor pp JOIN proveedores p ON p.id = pp.proveedor_id
       WHERE pp.id=${ph(1)} AND pp.negocio_id=${ph(2)}`,
      [req.params.id, nid(req)]
    );
    if (!cur[0]) return res.status(404).json({ error: 'Pedido no encontrado' });
    const yaRecibido = cur[0].estado === 'recibido';
    await pool.query(
      `UPDATE pedidos_proveedor SET estado=${ph(1)} WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
      [estado, req.params.id, nid(req)]
    );
    // Al marcar como recibido, sumar lo pedido al stock existente (una sola vez por
    // transición — si ya estaba en recibido no se vuelve a sumar en un reintento).
    if (estado === 'recibido' && !yaRecibido) {
      const items = typeof cur[0].items === 'string' ? JSON.parse(cur[0].items) : (cur[0].items || []);
      for (const it of items) {
        const { rows: inv } = await pool.query(
          `SELECT stock, cantidad_paquete FROM inventario WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
          [it.id, nid(req)]
        );
        if (!inv[0]) continue;
        const factor = inv[0].cantidad_paquete > 1 ? inv[0].cantidad_paquete : 1;
        const cantidadBase = (it.cantidad ?? it.qty ?? 0) * factor;
        if (cantidadBase <= 0) continue;
        const stockAntes = parseFloat(inv[0].stock) || 0;
        const stockDespues = stockAntes + cantidadBase;
        await pool.query(
          `UPDATE inventario SET stock=${ph(1)}, actualizado=NOW() WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
          [stockDespues, it.id, nid(req)]
        );
        await pool.query(
          `INSERT INTO inventario_movimientos (inventario_id,negocio_id,tipo,cantidad,stock_antes,stock_despues,nota,usuario_id)
           VALUES (${ph(1)},${ph(2)},'entrada',${ph(3)},${ph(4)},${ph(5)},'Recepción de pedido a proveedor',${ph(6)})`,
          [it.id, nid(req), cantidadBase, stockAntes, stockDespues, req.user.id]
        );
      }
      // El stock ya subió — ahora se deja registrada la plata que costó,
      // como gasto "a crédito" (se marca pagado después, desde Gastos, en el
      // momento en que de verdad se le paga al proveedor). Guardado por
      // gasto_id en vez de por el estado, para no duplicarlo si el pedido
      // se pasa de "recibido" a otro estado y se vuelve a marcar recibido.
      if (+cur[0].total > 0 && !cur[0].gasto_id) {
        await crearGastoPedidoProveedor(req, cur[0], items);
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Registra el gasto a crédito de un pedido SIN tocar el stock — para pedidos
// anteriores que ya se contaron en el inventario por otro lado (ajuste
// manual, etc.) y solo faltan quedar anotados del lado de la plata.
router.put('/pedidos-proveedor/:id/registrar-gasto', requirePermiso('proveedores'), async (req, res) => {
  try {
    const { rows: cur } = await pool.query(
      `SELECT pp.id, pp.items, pp.total, pp.proveedor_id, pp.gasto_id, p.nombre AS proveedor_nombre
       FROM pedidos_proveedor pp JOIN proveedores p ON p.id = pp.proveedor_id
       WHERE pp.id=${ph(1)} AND pp.negocio_id=${ph(2)}`,
      [req.params.id, nid(req)]
    );
    if (!cur[0]) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (cur[0].gasto_id) return res.status(400).json({ error: 'Este pedido ya tiene un gasto registrado' });
    if (!(+cur[0].total > 0)) return res.status(400).json({ error: 'El pedido no tiene total para registrar' });
    const items = typeof cur[0].items === 'string' ? JSON.parse(cur[0].items) : (cur[0].items || []);
    const gastoId = await crearGastoPedidoProveedor(req, cur[0], items);
    res.json({ ok: true, gasto_id: gastoId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// REPORTES ADMINISTRATIVOS
// ════════════════════════════════════════════════════════════════

router.get('/reportes/resumen', requirePermiso('reportes'), async (req, res) => {
  try {
    const { desde, hasta, tipo } = req.query;
    const d = desde || localDate(req.user.zona_horaria);
    const h = hasta  || d;
    // Para un solo día se usa la ventana real de la caja (ver ventanaDelDia)
    // en vez de medianoche a medianoche, para no partir un turno nocturno.
    const unDia = d === h;
    const ventana = unDia ? await ventanaDelDia(nid(req), d, req.user.zona_horaria) : null;
    const condV = unDia ? `v.creado >= ${ph(2)} AND v.creado <= ${ph(3)}` : `DATE(v.creado) BETWEEN ${ph(2)} AND ${ph(3)}`;
    const condPlain = unDia ? `creado >= ${ph(2)} AND creado <= ${ph(3)}` : `DATE(creado) BETWEEN ${ph(2)} AND ${ph(3)}`;
    const rango = unDia ? [ventana.inicio, ventana.fin] : [d, h];
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
          FROM ventas WHERE estado!='anulada'
          UNION ALL
          SELECT pv.id, pv.negocio_id, pv.total, pv.fecha AS creado, 'servicio' AS tipo,
                 COALESCE((SELECT SUM(p.monto) FROM pel_venta_pagos p WHERE p.venta_id=pv.id AND LOWER(p.metodo)='efectivo'),0),
                 COALESCE((SELECT SUM(p.monto) FROM pel_venta_pagos p WHERE p.venta_id=pv.id AND LOWER(p.metodo)='tarjeta'),0),
                 COALESCE((SELECT SUM(p.monto) FROM pel_venta_pagos p WHERE p.venta_id=pv.id AND LOWER(p.metodo) IN ('nequi','qr','nequi/qr')),0),
                 'efectivo',
                 NULL AS vid
          FROM pel_ventas pv WHERE pv.estado='completada'
        ) v
        LEFT JOIN (SELECT venta_id, SUM(cantidad) AS cant FROM venta_items GROUP BY venta_id) vi_s ON vi_s.venta_id=v.vid
        WHERE v.negocio_id=${ph(1)} AND ${condV}`;
    const vParams = [nid(req), ...rango];
    if (tipo) { vParams.push(tipo); vSql += ` AND v.tipo=${ph(vParams.length)}`; }
    const [ventas, gastos, cajas, breakdown] = await Promise.all([
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
      pool.query(`
        SELECT tipo, COUNT(*) AS pedidos, COALESCE(SUM(total),0) AS total
        FROM ventas
        WHERE negocio_id=${ph(1)} AND ${condPlain} AND estado!='anulada'
        GROUP BY tipo
      `, [nid(req), ...rango]),
    ]);
    res.json({
      ventas:    ventas.rows[0],
      gastos:    gastos.rows[0],
      cajas:     cajas.rows,
      utilidad:  (ventas.rows[0].total_ventas || 0) - (gastos.rows[0].total_gastos || 0),
      breakdown: breakdown.rows,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ventas por hora del día
router.get('/reportes/ventas-por-hora', requirePermiso('reportes'), async (req, res) => {
  try {
    const { desde, hasta, metodo_pago, tipo } = req.query;
    const d = desde || localDate(req.user.zona_horaria);
    const h = hasta || d;
    const unDia = d === h;
    const ventana = unDia ? await ventanaDelDia(nid(req), d, req.user.zona_horaria) : null;
    const condV = unDia ? `v.creado >= ${ph(2)} AND v.creado <= ${ph(3)}` : `DATE(v.creado) BETWEEN ${ph(2)} AND ${ph(3)}`;
    const rango = unDia ? [ventana.inicio, ventana.fin] : [d, h];
    let sql = `SELECT HOUR(v.creado) AS hora, COUNT(*) AS pedidos, COALESCE(SUM(v.total),0) AS total
               FROM (
                 SELECT negocio_id, total, creado, tipo, metodo_pago FROM ventas WHERE estado!='anulada'
                 UNION ALL
                 SELECT negocio_id, total, fecha AS creado, 'servicio', 'efectivo' FROM pel_ventas WHERE estado='completada'
               ) v
               WHERE v.negocio_id=${ph(1)} AND ${condV}`;
    const params = [nid(req), ...rango];
    if (tipo)        { params.push(tipo);        sql += ` AND v.tipo=${ph(params.length)}`; }
    if (metodo_pago) { params.push(metodo_pago); sql += ` AND v.metodo_pago=${ph(params.length)}`; }
    sql += ' GROUP BY hora ORDER BY hora';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ventas por día (gráfica de tendencia últimos N días)
router.get('/reportes/ventas-por-dia', requirePermiso('reportes'), async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const h = hasta || localDate(req.user.zona_horaria);
    const d = desde || new Intl.DateTimeFormat('en-CA', { timeZone: req.user.zona_horaria, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(Date.now() - 6*86400000));

    // Un día por consulta (en vez de un solo GROUP BY por DATE(creado)):
    // así cada barra usa la ventana real de su caja — si la caja de ayer
    // siguió abierta pasada la medianoche, esas horas de la madrugada
    // siguen sumando para ayer, no se le pegan de más al día de hoy.
    const dias = [];
    for (let cursor = new Date(`${d}T12:00:00Z`), fin = new Date(`${h}T12:00:00Z`); cursor <= fin; cursor.setUTCDate(cursor.getUTCDate()+1)) {
      dias.push(new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year:'numeric', month:'2-digit', day:'2-digit' }).format(cursor));
    }

    const rows = [];
    for (const fecha of dias) {
      const ventana = await ventanaDelDia(nid(req), fecha, req.user.zona_horaria);
      const { rows: r } = await pool.query(`
        SELECT COUNT(*) AS pedidos, COALESCE(SUM(total),0) AS total
        FROM (
          SELECT negocio_id, total, creado FROM ventas WHERE estado!='anulada'
          UNION ALL
          SELECT negocio_id, total, fecha AS creado FROM pel_ventas WHERE estado='completada'
        ) v
        WHERE v.negocio_id=${ph(1)} AND v.creado >= ${ph(2)} AND v.creado <= ${ph(3)}
      `, [nid(req), ventana.inicio, ventana.fin]);
      rows.push({ fecha, pedidos: +r[0].pedidos, total: +r[0].total });
    }
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Ventas recientes del período (últimas 30)
// Nota: sin requirePermiso — también lo usa la pestaña "Caja diaria" del POS
// (cualquier usuario cierra su turno viendo las ventas recientes del negocio).
router.get('/ventas/recientes', async (req, res) => {
  try {
    const { tipo, desde, hasta } = req.query;
    const d = desde || localDate(req.user.zona_horaria);
    const h = hasta  || d;
    const unDia = d === h;
    const ventana = unDia ? await ventanaDelDia(nid(req), d, req.user.zona_horaria) : null;
    const condV = unDia ? `v.creado >= ${ph(2)} AND v.creado <= ${ph(3)}` : `DATE(v.creado) BETWEEN ${ph(2)} AND ${ph(3)}`;
    const rango = unDia ? [ventana.inicio, ventana.fin] : [d, h];
    let sql = `
      SELECT v.id, v.tipo, v.mesa_id, v.mesa_num,
             COALESCE(m.nombre, CASE WHEN v.tipo='domicilio' THEN '🛵 Domicilio'
               WHEN v.mesa_num IS NOT NULL THEN CONCAT('Mesa ',v.mesa_num)
               ELSE 'Mostrador' END) AS lugar,
             v.total, v.metodo_pago, v.numero_factura, v.items, v.creado,
             u.nombre AS usuario_nombre
      FROM ventas v
      LEFT JOIN usuarios u ON u.id = v.cajero_id
      LEFT JOIN mesas m ON m.id = v.mesa_id
      WHERE v.negocio_id=${ph(1)} AND ${condV} AND v.estado!='anulada'
    `;
    const params = [nid(req), ...rango];
    if (tipo) { params.push(tipo); sql += ` AND v.tipo=${ph(params.length)}`; }
    sql += ' ORDER BY v.creado DESC LIMIT 30';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Lista completa de ventas por período (para exportar)
router.get('/ventas', requirePermiso('reportes'), async (req, res) => {
  try {
    const { desde, hasta, metodo_pago, tipo } = req.query;
    const d = desde || localDate(req.user.zona_horaria);
    const h = hasta  || d;
    const unDia = d === h;
    const ventana = unDia ? await ventanaDelDia(nid(req), d, req.user.zona_horaria) : null;
    const condV = unDia ? `v.creado >= ${ph(2)} AND v.creado <= ${ph(3)}` : `DATE(v.creado) BETWEEN ${ph(2)} AND ${ph(3)}`;
    let sql = `
      SELECT v.id, DATE_FORMAT(DATE(v.creado),'%Y-%m-%d') AS fecha,
             TIME_FORMAT(v.creado,'%H:%i') AS hora,
             COALESCE(m.nombre, CASE WHEN v.tipo='domicilio' THEN '🛵 Domicilio'
               WHEN v.mesa_num IS NOT NULL THEN CONCAT('Mesa ',v.mesa_num)
               ELSE 'Mostrador' END) AS lugar,
             v.tipo, v.metodo_pago, v.total,
             v.monto_efectivo, v.monto_tarjeta, v.monto_nequi,
             COALESCE(v.cliente_nombre,'') AS cliente,
             u.nombre AS cajero,
             v.numero_factura
      FROM ventas v
      LEFT JOIN usuarios u ON u.id = v.cajero_id
      LEFT JOIN mesas m ON m.id = v.mesa_id
      WHERE v.negocio_id=${ph(1)} AND ${condV} AND v.estado!='anulada'`;
    const params = [nid(req), unDia ? ventana.inicio : d, unDia ? ventana.fin : h];
    if (metodo_pago) { params.push(metodo_pago); sql += ` AND v.metodo_pago=${ph(params.length)}`; }
    if (tipo)        { params.push(tipo);         sql += ` AND v.tipo=${ph(params.length)}`; }
    sql += ' ORDER BY v.creado DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// EMPLEADOS (domiciliarios y otros roles operativos)
// ════════════════════════════════════════════════════════════════

router.get('/empleados', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, documento, celular, rol, activo, created_at, foto_url, vehiculo, placa, color_vehiculo FROM empleados
       WHERE negocio_id=? ORDER BY nombre`,
      [nid(req)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/empleados', async (req, res) => {
  try {
    const { nombre, documento, celular, rol = 'domiciliario', vehiculo, placa, color_vehiculo } = req.body;
    if (!nombre || !documento || !celular) return res.status(400).json({ error: 'Nombre, documento y celular son requeridos' });
    const id    = uuid();
    const token = uuid().replace(/-/g,'') + uuid().replace(/-/g,'').slice(0,8);
    const cel   = String(celular).replace(/[\s\-()]/g, '');
    await pool.query(
      `INSERT INTO empleados (id, negocio_id, nombre, documento, celular, rol, token, vehiculo, placa, color_vehiculo)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},${ph(9)},${ph(10)})`,
      [id, nid(req), nombre.trim(), documento.trim(), cel, rol, token, vehiculo||null, placa||null, color_vehiculo||null]
    );
    res.status(201).json({ ok: true, id });
  } catch (e) {
    if (e.message?.includes('Duplicate')) return res.status(409).json({ error: 'Ya existe un empleado con ese documento' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/empleados/:id', async (req, res) => {
  try {
    const { nombre, documento, celular, rol, activo, vehiculo, placa, color_vehiculo } = req.body;
    const cel = celular ? String(celular).replace(/[\s\-()]/g, '') : null;
    await pool.query(
      `UPDATE empleados SET nombre=COALESCE(?,nombre), documento=COALESCE(?,documento),
       celular=COALESCE(?,celular), rol=COALESCE(?,rol), activo=COALESCE(?,activo),
       vehiculo=?, placa=?, color_vehiculo=?
       WHERE id=? AND negocio_id=?`,
      [nombre||null, documento||null, cel||null, rol||null, activo!=null?activo:null,
       vehiculo||null, placa||null, color_vehiculo||null, req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/empleados/:id/foto', uploadEmpFoto.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const url = `/uploads/${req.file.filename}`;
    await pool.query(`UPDATE empleados SET foto_url=? WHERE id=? AND negocio_id=?`, [url, req.params.id, nid(req)]);
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/empleados/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM empleados WHERE id=? AND negocio_id=?`, [req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    const d = desde || localDate(req.user.zona_horaria);
    const h = hasta  || d;
    const unDia = d === h;
    const ventana = unDia ? await ventanaDelDia(nid(req), d, req.user.zona_horaria) : null;
    const params = [nid(req), unDia ? ventana.inicio : d, unDia ? ventana.fin : h];
    const condV = unDia ? `v.creado >= ${ph(2)} AND v.creado <= ${ph(3)}` : `DATE(v.creado) BETWEEN ${ph(2)} AND ${ph(3)}`;
    let where = `v.negocio_id=${ph(1)} AND ${condV}`;
    if (q && q.trim()) {
      params.push(`%${q.trim()}%`);
      const n = params.length;
      where += ` AND (v.numero_factura LIKE ${ph(n)} OR v.cliente_nombre LIKE ${ph(n)})`;
    }
    const { rows } = await pool.query(`
      SELECT v.id, v.numero_factura, v.creado, v.mesa_num, v.cliente_nombre,
             v.metodo_pago, v.monto_efectivo, v.monto_tarjeta, v.monto_nequi,
             v.subtotal, v.iva, v.total, v.recibido, v.cambio, v.estado,
             v.anulado_en, v.motivo_anulacion,
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

// Anula una factura ya cobrada: mantiene el número de factura y el registro
// visible en Reimprimir, pero revierte al inventario exactamente lo que esa
// venta había descontado (misma lógica de /pos/ventas, en reversa).
router.patch('/facturas/:id/anular', requirePermiso('reportes'), async (req, res) => {
  try {
    const { motivo } = req.body || {};
    const { rows } = await pool.query(
      `SELECT * FROM ventas WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, nid(req)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Factura no encontrada' });
    const venta = rows[0];
    if (venta.estado === 'anulada') return res.status(400).json({ error: 'Esta factura ya fue anulada' });

    let items = venta.items;
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch { items = []; } }

    // Si la venta vino de un pedido de mesa/barra, el stock ya se había
    // descontado al pasar ese pedido (no acá) — no hay nada que reponer; si
    // además se quiere reabrir el pedido, eso se hace aparte reactivando la
    // comanda, no devolviendo stock desde la factura.
    for (const item of (venta.comanda_id ? [] : (items || []))) {
      if (item.item_id) {
        const qty = item.qty || item.cantidad || 1;
        const { rows: receta } = await pool.query(
          `SELECT inventario_id, cantidad FROM menu_item_recetas WHERE menu_item_id=${ph(1)} AND negocio_id=${ph(2)}`,
          [item.item_id, nid(req)]
        );
        if (receta.length > 0) {
          for (const ing of receta) {
            await pool.query(
              `UPDATE inventario SET stock=stock+${ph(1)}, actualizado=NOW() WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
              [ing.cantidad * qty, ing.inventario_id, nid(req)]
            );
          }
        } else {
          const { rows: mi } = await pool.query(
            `SELECT inventario_id FROM menu_items WHERE id=${ph(1)} AND negocio_id=${ph(2)} LIMIT 1`,
            [item.item_id, nid(req)]
          );
          const invId = mi[0]?.inventario_id;
          if (invId) {
            await pool.query(
              `UPDATE inventario SET stock=stock+${ph(1)}, actualizado=NOW() WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
              [qty, invId, nid(req)]
            );
          } else {
            await pool.query(
              `UPDATE menu_items SET stock=stock+${ph(1)} WHERE id=${ph(2)} AND negocio_id=${ph(3)} AND stock IS NOT NULL`,
              [qty, item.item_id, nid(req)]
            );
          }
        }
      } else if (item.inventario_id) {
        await pool.query(
          `UPDATE inventario SET stock=stock+${ph(1)}, actualizado=NOW() WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
          [item.qty || 1, item.inventario_id, nid(req)]
        );
      }
    }

    await pool.query(
      `UPDATE ventas SET estado='anulada', anulado_en=NOW(), anulado_por=${ph(1)}, motivo_anulacion=${ph(2)} WHERE id=${ph(3)}`,
      [req.user.id, motivo || null, req.params.id]
    );
    res.json({ ok: true });
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

    await enviarFactura({ to: email, v, cf, moneda: req.user.moneda });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
