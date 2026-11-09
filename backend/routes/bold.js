/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * routes/bold.js
 * Pagos digitales con Bold (link de pago + webhook), comunes a todas las cajas.
 *
 * Flujo:
 *   1. La caja crea un pago (POST /api/bold/pagos) y muestra el QR.
 *   2. El cliente paga. Bold avisa por webhook; además la caja consulta el
 *      estado, que cuando hace falta se pregunta directo a Bold, porque el
 *      webhook de un link puede tardar hasta 10 minutos.
 *   3. Ya PAGADA, la caja registra la venta (POST /api/pos/ventas con
 *      bold_pago_id), que reclama el pago una sola vez (reclamarPago).
 *
 * Un pago aprobado siempre cuenta, aunque llegue después de que el link venció
 * o el cajero canceló: queda PAGADA sin venta y la caja lo ofrece al cobrar de
 * nuevo ese monto, para que el cliente no pague dos veces.
 */
const crypto = require('crypto');
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const QRCode = require('qrcode');
const { pool, ph } = require('../db');
const { authMiddleware, requirePermiso } = require('../middleware/auth');

const BOLD_API = process.env.BOLD_API_URL || 'https://integrations.api.bold.co';
const MINUTOS_VIGENCIA = 15;
const MONTO_MINIMO = 1000; // mínimo de Bold por transacción (COP)
const SEGUNDOS_ENTRE_CONSULTAS = 10;

const nid = req => req.user.negocio_id;

async function leerConfig(negocioId) {
  const { rows } = await pool.query(`SELECT * FROM bold_config WHERE negocio_id=${ph(1)}`, [negocioId]);
  return rows[0] || null;
}

async function pedirABold(cfg, ruta, opciones = {}) {
  const r = await fetch(`${BOLD_API}${ruta}`, {
    ...opciones,
    headers: { Authorization: `x-api-key ${cfg.identity_key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

// Un pago aprobado le gana a cualquier estado salvo los ya definitivos. Si el
// monto no coincide queda REVISAR y no se puede usar para registrar una venta.
async function aprobarPago(pago, total, paymentId, metodo) {
  const coincide = Math.round(Number(total)) === Math.round(Number(pago.monto));
  if (!coincide) console.warn(`[bold] Monto distinto en pago ${pago.id}: esperado ${pago.monto}, recibido ${total}`);
  await pool.query(
    `UPDATE bold_pagos SET estado=${ph(1)}, payment_id=COALESCE(${ph(2)},payment_id), metodo=COALESCE(${ph(3)},metodo),
       pagado_en=COALESCE(pagado_en,NOW())
     WHERE id=${ph(4)} AND estado NOT IN ('PAGADA','REVISAR','ANULADA')`,
    [coincide ? 'PAGADA' : 'REVISAR', paymentId || null, metodo || null, pago.id]
  );
}

async function cambiarSiPendiente(pagoId, estado) {
  await pool.query(`UPDATE bold_pagos SET estado=${ph(1)} WHERE id=${ph(2)} AND estado='PENDIENTE'`, [estado, pagoId]);
}

// Le pregunta a Bold cómo va un link pendiente, sin esperar al webhook.
async function sincronizarConBold(pago, cfg) {
  await pool.query(`UPDATE bold_pagos SET ultima_consulta=NOW() WHERE id=${ph(1)}`, [pago.id]);
  let d = null;
  try {
    const r = await pedirABold(cfg, `/online/link/v1/${encodeURIComponent(pago.link)}`);
    if (r.ok) d = r.data;
  } catch (e) {
    console.warn('[bold] No se pudo consultar el link:', e.message);
  }
  // Un link de pruebas no puede marcar como pagada una venta real
  if (d && d.is_sandbox && !cfg.modo_pruebas) d = null;

  if (d?.status === 'PAID') return aprobarPago(pago, d.total, d.transaction_id, d.payment_method);
  if (d?.status === 'REJECTED') return cambiarSiPendiente(pago.id, 'RECHAZADA');
  if (d?.status === 'CANCELLED') return cambiarSiPendiente(pago.id, 'CANCELADA');
  if (d?.status === 'EXPIRED') return cambiarSiPendiente(pago.id, 'EXPIRADA');
  // Vencido por reloj: no se deja a la caja esperando si Bold no responde, y
  // si el pago sí entró, el webhook igual lo marca PAGADA después.
  if (pago.vencido && d?.status !== 'PROCESSING') return cambiarSiPendiente(pago.id, 'EXPIRADA');
}

const SELECT_PAGO = `SELECT p.*, p.vence_en < DATE_SUB(NOW(), INTERVAL 1 MINUTE) AS vencido,
    (p.ultima_consulta IS NULL OR TIMESTAMPDIFF(SECOND, p.ultima_consulta, NOW()) >= ${SEGUNDOS_ENTRE_CONSULTAS}) AS consultar
  FROM bold_pagos p`;

async function leerPago(negocioId, id) {
  const { rows } = await pool.query(`${SELECT_PAGO} WHERE p.id=${ph(1)} AND p.negocio_id=${ph(2)}`, [id, negocioId]);
  return rows[0] || null;
}

const respuestaPago = p => ({
  id: p.id, estado: p.estado, monto: +p.monto, metodo: p.metodo || null, venta_id: p.venta_id || null,
});

/* ── Webhook ───────────────────────────────────────────────────────
 * Va montado en server.js ANTES de express.json: la firma se calcula sobre los
 * bytes exactos del cuerpo. Cada negocio tiene su cuenta y su llave de Bold, y
 * por eso registra su propia URL. */
async function webhook(req, res) {
  try {
    const cfg = await leerConfig(req.params.negocioId);
    if (!cfg) return res.status(404).json({ message: 'Negocio sin Bold configurado' });
    // En modo pruebas Bold firma con llave vacía. Fuera de ese modo, una llave
    // vacía permitiría falsificar pagos, así que se rechaza.
    if (!cfg.modo_pruebas && !cfg.secret_key) return res.status(400).json({ message: 'Falta la llave secreta' });
    const secreta = cfg.modo_pruebas ? '' : cfg.secret_key;

    const cuerpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const esperada = Buffer.from(crypto.createHmac('sha256', secreta).update(cuerpo.toString('base64')).digest('hex'));
    const recibida = Buffer.from(req.get('x-bold-signature') || '');
    if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida))
      return res.status(400).json({ message: 'Firma inválida' });

    let evento;
    try { evento = JSON.parse(cuerpo.toString('utf8')); }
    catch { return res.status(400).json({ message: 'Cuerpo inválido' }); }

    const d = evento.data || {};
    const referencia = d.metadata?.reference;
    const { rows } = await pool.query(
      `SELECT id, monto FROM bold_pagos WHERE negocio_id=${ph(1)} AND (referencia=${ph(2)} OR link=${ph(3)}) LIMIT 1`,
      [req.params.negocioId, referencia || '', referencia || '']
    );
    const pago = rows[0];
    if (!pago) {
      // Bold también avisa de ventas que no salieron de la caja (datáfono, otros links)
      console.warn('[bold] Evento sin pago asociado:', evento.type, referencia);
      return res.status(200).json({ message: 'ok' });
    }

    // Todas las escrituras son condicionales: un aviso repetido no cambia nada.
    // Se guarda antes de responder (es una sola escritura, muy por debajo de
    // los 2 s de Bold) para que un fallo de BD dé 500 y Bold reintente.
    if (evento.type === 'SALE_APPROVED') await aprobarPago(pago, d.amount?.total, d.payment_id, d.payment_method);
    else if (evento.type === 'SALE_REJECTED') await cambiarSiPendiente(pago.id, 'RECHAZADA');
    else if (evento.type === 'VOID_APPROVED') await pool.query(`UPDATE bold_pagos SET estado='ANULADA' WHERE id=${ph(1)}`, [pago.id]);

    res.status(200).json({ message: 'ok' });
  } catch (e) {
    console.error('[bold] Error en webhook:', e.message);
    res.status(500).json({ message: 'Error interno' });
  }
}

/* ── Usados por POST /api/pos/ventas y el pago parcial ─────────────
 * Cerrojo atómico: un pago Bold respalda una sola venta, por su monto exacto. */
async function reclamarPago(negocioId, pagoId, ventaId, monto) {
  const { rows } = await pool.query(
    `UPDATE bold_pagos SET venta_id=${ph(1)}
     WHERE id=${ph(2)} AND negocio_id=${ph(3)} AND estado='PAGADA' AND venta_id IS NULL AND ROUND(monto)=ROUND(${ph(4)})`,
    [ventaId, pagoId || '', negocioId, monto]
  );
  return rows.affectedRows > 0;
}
async function liberarPago(negocioId, pagoId, ventaId) {
  await pool.query(
    `UPDATE bold_pagos SET venta_id=NULL WHERE id=${ph(1)} AND negocio_id=${ph(2)} AND venta_id=${ph(3)}`,
    [pagoId, negocioId, ventaId]
  );
}

/* ── Rutas con sesión ──────────────────────────────────────────── */
router.use(authMiddleware);

// Lo que necesita saber cualquier cajero: si puede ofrecer Bold
router.get('/estado', async (req, res) => {
  try {
    const cfg = await leerConfig(nid(req));
    res.json({ activo: !!(cfg && cfg.activo && cfg.identity_key) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Las llaves nunca vuelven al navegador: solo se indica si ya están guardadas
router.get('/config', requirePermiso('personal'), async (req, res) => {
  try {
    const cfg = await leerConfig(nid(req));
    const base = `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;
    res.json({
      activo: !!cfg?.activo,
      modo_pruebas: !!cfg?.modo_pruebas,
      tiene_identidad: !!cfg?.identity_key,
      tiene_secreta: !!cfg?.secret_key,
      webhook_url: `${base}/api/webhooks/bold/${nid(req)}`,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Una llave en blanco conserva la que ya estaba guardada
router.put('/config', requirePermiso('personal'), async (req, res) => {
  try {
    const { identity_key, secret_key, activo, modo_pruebas } = req.body;
    const previa = await leerConfig(nid(req));
    const identidad = (identity_key || '').trim() || previa?.identity_key || null;
    const secreta = (secret_key || '').trim() || previa?.secret_key || null;
    if (activo && !identidad) return res.status(400).json({ error: 'Falta la llave de identidad' });
    if (activo && !modo_pruebas && !secreta) return res.status(400).json({ error: 'Falta la llave secreta' });
    await pool.query(
      `INSERT INTO bold_config (negocio_id, identity_key, secret_key, activo, modo_pruebas)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)})
       ON DUPLICATE KEY UPDATE identity_key=VALUES(identity_key), secret_key=VALUES(secret_key),
         activo=VALUES(activo), modo_pruebas=VALUES(modo_pruebas)`,
      [nid(req), identidad, secreta, activo ? 1 : 0, modo_pruebas ? 1 : 0]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/pagos', async (req, res) => {
  try {
    const monto = req.body.monto;
    if (!Number.isInteger(monto) || monto < MONTO_MINIMO)
      return res.status(400).json({ error: `El monto debe ser un número entero desde $${MONTO_MINIMO}` });
    const cfg = await leerConfig(nid(req));
    if (!cfg?.activo || !cfg.identity_key) return res.status(400).json({ error: 'Bold no está activado en este negocio' });

    const id = uuid();
    const referencia = `DJM-${id.replace(/-/g, '')}`; // Bold: letras, números, _ y -, máx. 60
    const descripcion = String(req.body.descripcion || `Venta ${referencia.slice(0, 12)}`).slice(0, 100);
    let r;
    try {
      r = await pedirABold(cfg, '/online/link/v1', {
        method: 'POST',
        body: JSON.stringify({
          amount_type: 'CLOSE',
          amount: { currency: 'COP', total_amount: monto, tip_amount: 0 },
          reference: referencia,
          description: descripcion.length >= 2 ? descripcion : 'Venta',
          expiration_date: (Date.now() + MINUTOS_VIGENCIA * 60 * 1000) * 1e6, // nanosegundos
        }),
      });
    } catch (e) {
      console.warn('[bold] No se pudo crear el link:', e.message);
      return res.status(502).json({ error: 'No se pudo conectar con Bold' });
    }
    const link = r.data?.payload?.payment_link;
    const url = r.data?.payload?.url;
    if (!r.ok || !link || !url) {
      console.warn('[bold] Bold rechazó el link:', r.status, JSON.stringify(r.data?.errors || r.data));
      return res.status(502).json({ error: 'Bold rechazó el cobro. Revisá las llaves en la configuración.' });
    }

    await pool.query(
      `INSERT INTO bold_pagos (id,negocio_id,referencia,link,url,monto,estado,creado_por,vence_en)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},'PENDIENTE',${ph(7)},DATE_ADD(NOW(), INTERVAL ${MINUTOS_VIGENCIA} MINUTE))`,
      [id, nid(req), referencia, link, url, monto, req.user.id]
    );
    const qr = await QRCode.toDataURL(url, { width: 320, margin: 1 });
    res.status(201).json({ id, estado: 'PENDIENTE', monto, url, qr, minutos: MINUTOS_VIGENCIA, modo_pruebas: !!cfg.modo_pruebas });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Pagos aprobados que no alcanzaron a quedar en una venta (cajero canceló,
// se cerró la pestaña, o el aviso llegó tarde)
router.get('/pagos/sin-usar', async (req, res) => {
  try {
    const params = [nid(req)];
    let sql = `SELECT id, monto, estado, metodo, pagado_en FROM bold_pagos
      WHERE negocio_id=${ph(1)} AND estado='PAGADA' AND venta_id IS NULL`;
    if (req.query.monto) { params.push(+req.query.monto); sql += ` AND ROUND(monto)=ROUND(${ph(params.length)})`; }
    const { rows } = await pool.query(`${sql} ORDER BY pagado_en DESC LIMIT 20`, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/pagos/:id', async (req, res) => {
  try {
    let pago = await leerPago(nid(req), req.params.id);
    if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });
    if (pago.estado === 'PENDIENTE' && pago.consultar) {
      const cfg = await leerConfig(nid(req));
      if (cfg) { await sincronizarConBold(pago, cfg); pago = await leerPago(nid(req), req.params.id); }
    }
    res.json(respuestaPago(pago));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// El link no se puede apagar desde aquí: si el cliente ya alcanzó a pagar,
// el pago vuelve a PAGADA y se ofrece al cobrar de nuevo.
router.post('/pagos/:id/cancelar', async (req, res) => {
  try {
    let pago = await leerPago(nid(req), req.params.id);
    if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });
    if (pago.estado === 'PENDIENTE') {
      const cfg = await leerConfig(nid(req));
      if (cfg) await sincronizarConBold(pago, cfg);
      await cambiarSiPendiente(pago.id, 'CANCELADA');
      pago = await leerPago(nid(req), req.params.id);
    }
    res.json(respuestaPago(pago));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.webhook = webhook;
module.exports.reclamarPago = reclamarPago;
module.exports.liberarPago = liberarPago;
