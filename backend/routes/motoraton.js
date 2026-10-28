/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * Moto Ratón — API de viajes en moto (pasajeros y conductores).
 * Plataforma independiente de los negocios: tablas mr_*.
 *
 * Tiempo real: reutiliza el WebSocket del servidor con canales propios
 *   ws://host:3001?negocio_id=mr-viaje-<viajeId>   → el pasajero sigue su viaje
 *   ws://host:3001?negocio_id=mr-conductor-<id>    → el conductor recibe solicitudes
 */
const express = require('express');
const bcrypt  = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { pool } = require('../db');

const router = express.Router();

// ── Tarifas (COP) — valores de ejemplo, ajustables por .env ──────
const TARIFA = {
  base:        parseFloat(process.env.MR_TARIFA_BASE    || 2500),
  porKm:       parseFloat(process.env.MR_TARIFA_KM      || 900),
  porMin:      parseFloat(process.env.MR_TARIFA_MIN     || 150),
  minima:      parseFloat(process.env.MR_TARIFA_MINIMA  || 4500),
  express:     parseFloat(process.env.MR_RECARGO_EXPRESS || 1.25),
  comisionPct: parseFloat(process.env.MR_COMISION_PCT   || 15),
};
const FACTOR_VIA     = 1.3;  // la ruta real es más larga que la línea recta
const VEL_MOTO_KMH   = 25;   // velocidad promedio urbana en moto
const RADIO_SOLICITUD_KM = 5;
const GPS_VIGENTE_MIN    = 3; // un conductor sin GPS reciente no cuenta como disponible
const AUTOVERIFICAR = process.env.MR_AUTOVERIFICAR !== '0';

const SERVICIOS = ['estandar', 'express'];
const METODOS_PAGO = ['efectivo', 'nequi', 'tarjeta'];

// ── Helpers ────────────────────────────────────────────────────────

function distanciaKm(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function cotizar(origen, destino) {
  const km  = distanciaKm(origen, destino) * FACTOR_VIA;
  const min = Math.max(3, Math.round(km / VEL_MOTO_KMH * 60));
  const redondear = n => Math.ceil(n / 100) * 100;
  const estandar = redondear(Math.max(TARIFA.minima, TARIFA.base + km * TARIFA.porKm + min * TARIFA.porMin));
  const express  = redondear(estandar * TARIFA.express);
  return { distancia_km: Math.round(km * 10) / 10, minutos: min, tarifas: { estandar, express } };
}

function punto(p) {
  if (!p || p.lat == null || p.lng == null) return null;
  const lat = parseFloat(p.lat), lng = parseFloat(p.lng);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

const limpiarCel = c => String(c || '').replace(/[\s\-()+]/g, '');

function emitir(req, canal, tipo, data) {
  req.app.locals.broadcast?.(canal, tipo, data);
}

// Viaje con los datos públicos del conductor (lo que ve el pasajero)
async function cargarViaje(id) {
  const { rows } = await pool.query(
    `SELECT v.*, c.nombre AS conductor_nombre, c.celular AS conductor_celular,
            c.placa, c.moto, c.color_moto, c.calificacion_prom, c.lat AS conductor_lat, c.lng AS conductor_lng,
            p.nombre AS pasajero_nombre, p.celular AS pasajero_celular
     FROM mr_viajes v
     LEFT JOIN mr_conductores c ON c.id = v.conductor_id
     JOIN mr_pasajeros p ON p.id = v.pasajero_id
     WHERE v.id=? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function notificarViaje(req, viajeId, tipo) {
  const v = await cargarViaje(viajeId);
  if (v) emitir(req, `mr-viaje-${viajeId}`, tipo, v);
  return v;
}

// Conductores en línea, verificados, sin viaje activo y con GPS reciente,
// ordenados por cercanía al punto.
async function conductoresCercanos(origen, radioKm = RADIO_SOLICITUD_KM) {
  const { rows } = await pool.query(
    `SELECT c.id, c.lat, c.lng FROM mr_conductores c
     WHERE c.activo=1 AND c.verificado=1 AND c.en_linea=1
       AND c.lat IS NOT NULL AND c.gps_at >= NOW() - INTERVAL ${GPS_VIGENTE_MIN} MINUTE
       AND NOT EXISTS (SELECT 1 FROM mr_viajes v WHERE v.conductor_id=c.id AND v.estado IN ('aceptado','llego','en_curso'))`
  );
  return rows
    .map(c => ({ ...c, km: distanciaKm(origen, { lat: +c.lat, lng: +c.lng }) }))
    .filter(c => c.km <= radioKm)
    .sort((a, b) => a.km - b.km);
}

// ── Autenticación ────────────────────────────────────────────────
// Pasajeros y conductores se identifican con celular + PIN y reciben un
// token opaco que viaja en el header x-mr-token (mismo esquema que el
// token de domiciliario).

function requireRol(tabla) {
  return async (req, res, next) => {
    const token = req.headers['x-mr-token'];
    if (!token) return res.status(401).json({ error: 'Token requerido' });
    try {
      const { rows } = await pool.query(`SELECT * FROM ${tabla} WHERE token=? AND activo=1 LIMIT 1`, [token]);
      if (!rows[0]) return res.status(401).json({ error: 'Sesión inválida o cuenta inactiva' });
      delete rows[0].pin_hash;
      req.usuario = rows[0];
      next();
    } catch (e) { res.status(500).json({ error: e.message }); }
  };
}
const requirePasajero  = requireRol('mr_pasajeros');
const requireConductor = requireRol('mr_conductores');

function perfilConductor(c) {
  const { pin_hash, ...p } = c;
  return p;
}

// POST /api/motoraton/pasajero/registro
router.post('/pasajero/registro', async (req, res) => {
  const { nombre, celular, pin } = req.body;
  const cel = limpiarCel(celular);
  if (!nombre?.trim() || cel.length < 7 || !/^\d{4,6}$/.test(String(pin || '')))
    return res.status(400).json({ error: 'Nombre, celular y PIN de 4 a 6 dígitos son obligatorios' });
  try {
    const { rows: existe } = await pool.query(`SELECT id FROM mr_pasajeros WHERE celular=? LIMIT 1`, [cel]);
    if (existe[0]) return res.status(409).json({ error: 'Ese celular ya está registrado, inicia sesión' });
    const id = uuid(), token = uuid() + uuid().slice(0, 8);
    await pool.query(
      `INSERT INTO mr_pasajeros (id, nombre, celular, pin_hash, token) VALUES (?,?,?,?,?)`,
      [id, nombre.trim(), cel, await bcrypt.hash(String(pin), 10), token]
    );
    res.json({ ok: true, token, rol: 'pasajero', perfil: { id, nombre: nombre.trim(), celular: cel } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/motoraton/conductor/registro
router.post('/conductor/registro', async (req, res) => {
  const { nombre, documento, celular, pin, placa, moto, color_moto, soat_vence } = req.body;
  const cel = limpiarCel(celular);
  if (!nombre?.trim() || !documento?.trim() || cel.length < 7 || !placa?.trim() || !/^\d{4,6}$/.test(String(pin || '')))
    return res.status(400).json({ error: 'Nombre, documento, celular, placa y PIN de 4 a 6 dígitos son obligatorios' });
  try {
    const { rows: existe } = await pool.query(
      `SELECT id FROM mr_conductores WHERE celular=? OR documento=? LIMIT 1`, [cel, documento.trim()]
    );
    if (existe[0]) return res.status(409).json({ error: 'Ya existe un conductor con ese celular o documento' });
    const id = uuid(), token = uuid() + uuid().slice(0, 8);
    await pool.query(
      `INSERT INTO mr_conductores (id, nombre, documento, celular, pin_hash, token, placa, moto, color_moto, soat_vence, verificado)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, nombre.trim(), documento.trim(), cel, await bcrypt.hash(String(pin), 10), token,
       placa.trim().toUpperCase(), moto?.trim() || null, color_moto?.trim() || null, soat_vence || null, AUTOVERIFICAR ? 1 : 0]
    );
    const { rows } = await pool.query(`SELECT * FROM mr_conductores WHERE id=?`, [id]);
    res.json({ ok: true, token, rol: 'conductor', perfil: perfilConductor(rows[0]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/motoraton/login  { rol: 'pasajero'|'conductor', celular, pin }
router.post('/login', async (req, res) => {
  const { rol, celular, pin } = req.body;
  const tabla = rol === 'conductor' ? 'mr_conductores' : rol === 'pasajero' ? 'mr_pasajeros' : null;
  if (!tabla) return res.status(400).json({ error: 'Rol inválido' });
  try {
    const { rows } = await pool.query(`SELECT * FROM ${tabla} WHERE celular=? AND activo=1 LIMIT 1`, [limpiarCel(celular)]);
    if (!rows[0] || !(await bcrypt.compare(String(pin || ''), rows[0].pin_hash)))
      return res.status(401).json({ error: 'Celular o PIN incorrectos' });
    res.json({ ok: true, token: rows[0].token, rol, perfil: perfilConductor(rows[0]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Cotización (pública) ─────────────────────────────────────────

// POST /api/motoraton/cotizar  { origen:{lat,lng}, destino:{lat,lng} }
router.post('/cotizar', async (req, res) => {
  const origen = punto(req.body.origen), destino = punto(req.body.destino);
  if (!origen || !destino) return res.status(400).json({ error: 'Origen y destino requeridos' });
  try {
    const cercanos = await conductoresCercanos(origen);
    res.json({
      ...cotizar(origen, destino),
      conductores_cerca: cercanos.length,
      llegada_min: cercanos[0] ? Math.max(1, Math.round(cercanos[0].km * FACTOR_VIA / VEL_MOTO_KMH * 60)) : null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Pasajero ─────────────────────────────────────────────────────

// POST /api/motoraton/viajes — pedir un viaje
// Estándar: se ofrece a todos los conductores cercanos y lo toma el primero.
// Express: se asigna directo al conductor disponible más cercano.
router.post('/viajes', requirePasajero, async (req, res) => {
  const origen = punto(req.body.origen), destino = punto(req.body.destino);
  const servicio = SERVICIOS.includes(req.body.servicio) ? req.body.servicio : 'estandar';
  const metodo_pago = METODOS_PAGO.includes(req.body.metodo_pago) ? req.body.metodo_pago : 'efectivo';
  if (!origen || !destino) return res.status(400).json({ error: 'Origen y destino requeridos' });
  try {
    const { rows: activo } = await pool.query(
      `SELECT id FROM mr_viajes WHERE pasajero_id=? AND estado IN ('buscando','aceptado','llego','en_curso') LIMIT 1`,
      [req.usuario.id]
    );
    if (activo[0]) return res.status(409).json({ error: 'Ya tienes un viaje en curso', viaje_id: activo[0].id });

    const cot = cotizar(origen, destino);
    const tarifa = cot.tarifas[servicio];
    const comision = Math.round(tarifa * TARIFA.comisionPct / 100);
    const id = uuid();
    await pool.query(
      `INSERT INTO mr_viajes (id, pasajero_id, servicio, metodo_pago,
         origen_lat, origen_lng, origen_dir, destino_lat, destino_lng, destino_dir,
         distancia_km, minutos_est, tarifa, comision)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.usuario.id, servicio, metodo_pago,
       origen.lat, origen.lng, String(req.body.origen_dir || '').slice(0, 255),
       destino.lat, destino.lng, String(req.body.destino_dir || '').slice(0, 255),
       cot.distancia_km, cot.minutos, tarifa, comision]
    );

    const cercanos = await conductoresCercanos(origen);
    if (servicio === 'express' && cercanos[0]) {
      // Cerrojo: solo se asigna si el viaje sigue sin conductor
      const { rows: upd } = await pool.query(
        `UPDATE mr_viajes SET conductor_id=?, estado='aceptado', aceptado_en=NOW() WHERE id=? AND conductor_id IS NULL`,
        [cercanos[0].id, id]
      );
      if (upd.affectedRows) emitir(req, `mr-conductor-${cercanos[0].id}`, 'viaje_asignado', await cargarViaje(id));
    } else {
      const v = await cargarViaje(id);
      cercanos.forEach(c => emitir(req, `mr-conductor-${c.id}`, 'solicitud_nueva', v));
    }
    res.json({ ok: true, viaje: await cargarViaje(id), conductores_notificados: cercanos.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/motoraton/pasajero/actual — viaje activo (para retomar al abrir la app)
router.get('/pasajero/actual', requirePasajero, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM mr_viajes WHERE pasajero_id=?
         AND (estado IN ('buscando','aceptado','llego','en_curso')
              OR (estado='finalizado' AND calificacion IS NULL AND finalizado_en >= NOW() - INTERVAL 1 DAY))
       ORDER BY creado DESC LIMIT 1`,
      [req.usuario.id]
    );
    res.json({ viaje: rows[0] ? await cargarViaje(rows[0].id) : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/motoraton/pasajero/historial
router.get('/pasajero/historial', requirePasajero, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT v.id, v.estado, v.servicio, v.origen_dir, v.destino_dir, v.tarifa, v.metodo_pago,
              v.calificacion, v.creado, c.nombre AS conductor_nombre, c.placa
       FROM mr_viajes v LEFT JOIN mr_conductores c ON c.id=v.conductor_id
       WHERE v.pasajero_id=? ORDER BY v.creado DESC LIMIT 50`,
      [req.usuario.id]
    );
    res.json({ viajes: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/motoraton/viajes/:id — estado del viaje (pasajero dueño o conductor asignado)
router.get('/viajes/:id', async (req, res) => {
  const token = req.headers['x-mr-token'];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const v = await cargarViaje(req.params.id);
    if (!v) return res.status(404).json({ error: 'Viaje no encontrado' });
    const { rows } = await pool.query(
      `SELECT id FROM mr_pasajeros WHERE token=? AND id=?
       UNION SELECT id FROM mr_conductores WHERE token=? AND (id=? OR ?='buscando')`,
      [token, v.pasajero_id, token, v.conductor_id, v.estado]
    );
    if (!rows[0]) return res.status(403).json({ error: 'No tienes acceso a este viaje' });
    res.json({ viaje: v });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/motoraton/viajes/:id/cancelar — pasajero (antes de iniciar) o conductor asignado
router.post('/viajes/:id/cancelar', async (req, res) => {
  const token = req.headers['x-mr-token'];
  try {
    const v = await cargarViaje(req.params.id);
    if (!v) return res.status(404).json({ error: 'Viaje no encontrado' });
    const { rows: pas } = await pool.query(`SELECT id FROM mr_pasajeros WHERE token=? AND id=?`, [token, v.pasajero_id]);
    const { rows: con } = await pool.query(`SELECT id FROM mr_conductores WHERE token=? AND id=?`, [token, v.conductor_id]);
    if (!pas[0] && !con[0]) return res.status(403).json({ error: 'No puedes cancelar este viaje' });
    if (!['buscando', 'aceptado', 'llego'].includes(v.estado))
      return res.status(400).json({ error: 'El viaje ya no se puede cancelar' });

    if (con[0]) {
      // El conductor suelta el viaje: vuelve a quedar buscando para otro
      await pool.query(
        `UPDATE mr_viajes SET conductor_id=NULL, estado='buscando', aceptado_en=NULL, llego_en=NULL WHERE id=?`, [v.id]
      );
      const cercanos = await conductoresCercanos({ lat: +v.origen_lat, lng: +v.origen_lng });
      const nuevo = await notificarViaje(req, v.id, 'viaje_actualizado');
      cercanos.filter(c => c.id !== v.conductor_id).forEach(c => emitir(req, `mr-conductor-${c.id}`, 'solicitud_nueva', nuevo));
    } else {
      await pool.query(
        `UPDATE mr_viajes SET estado='cancelado', cancelado_por='pasajero', cancelado_en=NOW() WHERE id=?`, [v.id]
      );
      const nuevo = await notificarViaje(req, v.id, 'viaje_actualizado');
      if (v.conductor_id) emitir(req, `mr-conductor-${v.conductor_id}`, 'viaje_cancelado', nuevo);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/motoraton/viajes/:id/calificar  { estrellas: 1-5, nota }
router.post('/viajes/:id/calificar', requirePasajero, async (req, res) => {
  const estrellas = parseInt(req.body.estrellas);
  if (!(estrellas >= 1 && estrellas <= 5)) return res.status(400).json({ error: 'Calificación de 1 a 5' });
  try {
    const { rows: upd } = await pool.query(
      `UPDATE mr_viajes SET calificacion=?, calificacion_nota=?
       WHERE id=? AND pasajero_id=? AND estado='finalizado' AND calificacion IS NULL`,
      [estrellas, String(req.body.nota || '').slice(0, 255) || null, req.params.id, req.usuario.id]
    );
    if (!upd.affectedRows) return res.status(400).json({ error: 'Este viaje no se puede calificar' });
    await pool.query(
      `UPDATE mr_conductores c SET calificacion_prom = (
         SELECT ROUND(AVG(calificacion), 2) FROM mr_viajes WHERE conductor_id=c.id AND calificacion IS NOT NULL)
       WHERE c.id = (SELECT conductor_id FROM mr_viajes WHERE id=?)`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Conductor ────────────────────────────────────────────────────

// GET /api/motoraton/conductor/perfil
router.get('/conductor/perfil', requireConductor, (req, res) => res.json({ perfil: req.usuario }));

// PUT /api/motoraton/conductor/en-linea  { en_linea: true|false }
router.put('/conductor/en-linea', requireConductor, async (req, res) => {
  try {
    if (req.body.en_linea && !req.usuario.verificado)
      return res.status(403).json({ error: 'Tu cuenta aún no ha sido verificada' });
    await pool.query(`UPDATE mr_conductores SET en_linea=? WHERE id=?`, [req.body.en_linea ? 1 : 0, req.usuario.id]);
    res.json({ ok: true, en_linea: !!req.body.en_linea });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/motoraton/conductor/ubicacion  { lat, lng } — también avisa al pasajero del viaje activo
router.post('/conductor/ubicacion', requireConductor, async (req, res) => {
  const p = punto(req.body);
  if (!p) return res.status(400).json({ error: 'lat/lng requeridos' });
  try {
    await pool.query(`UPDATE mr_conductores SET lat=?, lng=?, gps_at=NOW() WHERE id=?`, [p.lat, p.lng, req.usuario.id]);
    const { rows } = await pool.query(
      `SELECT id FROM mr_viajes WHERE conductor_id=? AND estado IN ('aceptado','llego','en_curso') LIMIT 1`,
      [req.usuario.id]
    );
    if (rows[0]) emitir(req, `mr-viaje-${rows[0].id}`, 'conductor_ubicacion', { viaje_id: rows[0].id, ...p });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/motoraton/conductor/solicitudes — viajes buscando conductor cerca de su posición
router.get('/conductor/solicitudes', requireConductor, async (req, res) => {
  try {
    const c = req.usuario;
    if (c.lat == null) return res.json({ solicitudes: [] });
    const { rows } = await pool.query(
      `SELECT v.id, v.servicio, v.metodo_pago, v.origen_lat, v.origen_lng, v.origen_dir,
              v.destino_lat, v.destino_lng, v.destino_dir, v.distancia_km, v.minutos_est, v.tarifa, v.comision, v.creado,
              p.nombre AS pasajero_nombre
       FROM mr_viajes v JOIN mr_pasajeros p ON p.id=v.pasajero_id
       WHERE v.estado='buscando' AND v.creado >= NOW() - INTERVAL 30 MINUTE
       ORDER BY v.creado ASC`
    );
    const yo = { lat: +c.lat, lng: +c.lng };
    const solicitudes = rows
      .map(v => ({ ...v, km_al_origen: Math.round(distanciaKm(yo, { lat: +v.origen_lat, lng: +v.origen_lng }) * 10) / 10 }))
      .filter(v => v.km_al_origen <= RADIO_SOLICITUD_KM)
      .sort((a, b) => a.km_al_origen - b.km_al_origen);
    res.json({ solicitudes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/motoraton/conductor/actual — viaje activo del conductor
router.get('/conductor/actual', requireConductor, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM mr_viajes WHERE conductor_id=? AND estado IN ('aceptado','llego','en_curso') LIMIT 1`,
      [req.usuario.id]
    );
    res.json({ viaje: rows[0] ? await cargarViaje(rows[0].id) : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/motoraton/viajes/:id/aceptar — el primero que acepta se lo queda
router.post('/viajes/:id/aceptar', requireConductor, async (req, res) => {
  try {
    if (!req.usuario.en_linea) return res.status(400).json({ error: 'Debes estar en línea para aceptar viajes' });
    const { rows: ocupado } = await pool.query(
      `SELECT id FROM mr_viajes WHERE conductor_id=? AND estado IN ('aceptado','llego','en_curso') LIMIT 1`,
      [req.usuario.id]
    );
    if (ocupado[0]) return res.status(409).json({ error: 'Ya tienes un viaje activo' });
    const { rows: upd } = await pool.query(
      `UPDATE mr_viajes SET conductor_id=?, estado='aceptado', aceptado_en=NOW()
       WHERE id=? AND estado='buscando' AND conductor_id IS NULL`,
      [req.usuario.id, req.params.id]
    );
    if (!upd.affectedRows) return res.status(409).json({ error: 'Otro conductor ya tomó este viaje' });
    res.json({ ok: true, viaje: await notificarViaje(req, req.params.id, 'viaje_actualizado') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/motoraton/viajes/:id/estado  { estado: 'llego'|'en_curso'|'finalizado' }
const SIGUIENTE = { llego: 'aceptado', en_curso: 'llego', finalizado: 'en_curso' };
const COLUMNA_HORA = { llego: 'llego_en', en_curso: 'iniciado_en', finalizado: 'finalizado_en' };
router.put('/viajes/:id/estado', requireConductor, async (req, res) => {
  const { estado } = req.body;
  if (!SIGUIENTE[estado]) return res.status(400).json({ error: 'Estado inválido' });
  try {
    const { rows: upd } = await pool.query(
      `UPDATE mr_viajes SET estado=?, ${COLUMNA_HORA[estado]}=NOW() WHERE id=? AND conductor_id=? AND estado=?`,
      [estado, req.params.id, req.usuario.id, SIGUIENTE[estado]]
    );
    if (!upd.affectedRows) return res.status(400).json({ error: 'El viaje no está en el paso anterior' });
    res.json({ ok: true, viaje: await notificarViaje(req, req.params.id, 'viaje_actualizado') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/motoraton/conductor/ganancias — resumen de hoy
router.get('/conductor/ganancias', requireConductor, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS viajes, COALESCE(SUM(tarifa),0) AS bruto, COALESCE(SUM(comision),0) AS comision,
              COALESCE(SUM(tarifa - comision),0) AS neto
       FROM mr_viajes WHERE conductor_id=? AND estado='finalizado' AND DATE(finalizado_en)=CURDATE()`,
      [req.usuario.id]
    );
    res.json({ hoy: rows[0], calificacion_prom: req.usuario.calificacion_prom });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.cotizar = cotizar;
