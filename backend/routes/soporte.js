/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * routes/soporte.js — Suite de soporte técnico por negocio (estilo Zoho Desk).
 *
 *  · Portal público (sin login): abrir/consultar tickets, centro de ayuda
 *    (base de conocimientos) y academia de cursos. El solicitante se
 *    identifica con su código + token de ticket; el alumno de la academia
 *    con un identificador local (email o id de dispositivo).
 *  · Panel de agentes (JWT + permiso 'soporte' | 'personal'): tickets con
 *    SLA y asignación automática, respuestas predefinidas, editor del centro
 *    de ayuda, editor de la academia, y un dashboard de métricas.
 *
 * Todo aislado por negocio_id del token / de la URL pública.
 */
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { pool } = require('../db');
const { authMiddleware, requirePermiso } = require('../middleware/auth');

const ESTADOS     = ['abierto', 'en_progreso', 'resuelto', 'cerrado'];
const PRIORIDADES  = ['baja', 'media', 'alta', 'urgente'];
const CATEGORIAS   = ['hardware', 'software', 'red', 'cuenta', 'facturacion', 'otro'];
const AUDIENCIAS   = ['agentes', 'clientes', 'ambos'];

// SLA por defecto en minutos: { primera respuesta, resolución }
const SLA_DEFAULT = {
  urgente: { fr: 30,   res: 240 },
  alta:    { fr: 120,  res: 480 },
  media:   { fr: 480,  res: 1440 },
  baja:    { fr: 1440, res: 4320 },
};

// Código legible para consultar el ticket (sin O/0, I/1). Ej: SOP-4F7KQ2
function nuevoCodigo() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return `SOP-${s}`;
}

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 120) || 'item';
}

const limpiar = (s, max) => (s == null ? null : String(s).trim().slice(0, max) || null);
const parseJSON = (s, fb) => { try { return typeof s === 'string' ? JSON.parse(s) : (s || fb); } catch { return fb; } };

// ── Auto-migración ──────────────────────────────────────────────
async function _ddl(sql) {
  try { await pool.query(sql); } catch (e) { console.error('soporte DDL:', e.message); }
}
async function _addCol(table, col, definition) {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`, [table, col]);
    if (!rows[0] || Number(rows[0].n) === 0) await pool.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  } catch (e) { console.error(`soporte addCol ${table}.${col}:`, e.message); }
}

(async () => {
  await _ddl(`CREATE TABLE IF NOT EXISTS sop_tickets (
    id                 VARCHAR(36)  PRIMARY KEY,
    negocio_id         VARCHAR(36)  NOT NULL,
    codigo             VARCHAR(16)  NOT NULL,
    token              VARCHAR(40)  NOT NULL,
    asunto             VARCHAR(160) NOT NULL,
    descripcion        TEXT         NOT NULL,
    categoria          VARCHAR(30)  NOT NULL DEFAULT 'otro',
    prioridad          ENUM('baja','media','alta','urgente') NOT NULL DEFAULT 'media',
    estado             ENUM('abierto','en_progreso','resuelto','cerrado') NOT NULL DEFAULT 'abierto',
    solicitante_nombre VARCHAR(120) NOT NULL,
    solicitante_email  VARCHAR(160),
    solicitante_tel    VARCHAR(40),
    agente_id          VARCHAR(36),
    agente_nombre      VARCHAR(120),
    creado             DATETIME     DEFAULT CURRENT_TIMESTAMP,
    actualizado        DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    cerrado_en         DATETIME,
    UNIQUE KEY uk_sop_codigo (codigo),
    INDEX idx_sop_neg_estado (negocio_id, estado),
    INDEX idx_sop_neg_creado (negocio_id, creado)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await _addCol('sop_tickets', 'tags',                  `tags VARCHAR(300) NULL`);
  await _addCol('sop_tickets', 'sla_fr_at',             `sla_fr_at DATETIME NULL`);
  await _addCol('sop_tickets', 'sla_res_at',            `sla_res_at DATETIME NULL`);
  await _addCol('sop_tickets', 'primera_respuesta_en',  `primera_respuesta_en DATETIME NULL`);
  await _addCol('sop_tickets', 'resuelto_en',           `resuelto_en DATETIME NULL`);
  await _addCol('sop_tickets', 'csat_score',            `csat_score TINYINT NULL`);
  await _addCol('sop_tickets', 'csat_comentario',       `csat_comentario VARCHAR(500) NULL`);
  await _addCol('sop_tickets', 'csat_en',               `csat_en DATETIME NULL`);

  await _ddl(`CREATE TABLE IF NOT EXISTS sop_comentarios (
    id           VARCHAR(36) PRIMARY KEY,
    ticket_id    VARCHAR(36) NOT NULL,
    negocio_id   VARCHAR(36) NOT NULL,
    autor_tipo   ENUM('cliente','agente') NOT NULL,
    autor_id     VARCHAR(36),
    autor_nombre VARCHAR(120) NOT NULL,
    cuerpo       TEXT NOT NULL,
    interno      TINYINT(1) NOT NULL DEFAULT 0,
    creado       DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sop_com_ticket (ticket_id),
    INDEX idx_sop_com_neg (negocio_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await _ddl(`CREATE TABLE IF NOT EXISTS sop_config (
    negocio_id   VARCHAR(36) PRIMARY KEY,
    sla_json     LONGTEXT,
    auto_asignar VARCHAR(20) NOT NULL DEFAULT 'off',
    agentes_rr   LONGTEXT,
    rr_cursor    INT NOT NULL DEFAULT 0,
    actualizado  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await _ddl(`CREATE TABLE IF NOT EXISTS sop_respuestas (
    id          VARCHAR(36) PRIMARY KEY,
    negocio_id  VARCHAR(36) NOT NULL,
    titulo      VARCHAR(120) NOT NULL,
    atajo       VARCHAR(40),
    cuerpo      TEXT NOT NULL,
    creado      DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sop_resp_neg (negocio_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await _ddl(`CREATE TABLE IF NOT EXISTS sop_kb_categorias (
    id          VARCHAR(36) PRIMARY KEY,
    negocio_id  VARCHAR(36) NOT NULL,
    nombre      VARCHAR(120) NOT NULL,
    slug        VARCHAR(140) NOT NULL,
    descripcion VARCHAR(300),
    icono       VARCHAR(30) DEFAULT '📄',
    orden       INT NOT NULL DEFAULT 0,
    creado      DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sop_kbcat_neg (negocio_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await _ddl(`CREATE TABLE IF NOT EXISTS sop_kb_articulos (
    id           VARCHAR(36) PRIMARY KEY,
    negocio_id   VARCHAR(36) NOT NULL,
    categoria_id VARCHAR(36),
    titulo       VARCHAR(200) NOT NULL,
    slug         VARCHAR(220) NOT NULL,
    resumen      VARCHAR(300),
    cuerpo       MEDIUMTEXT NOT NULL,
    publicado    TINYINT(1) NOT NULL DEFAULT 0,
    vistas       INT NOT NULL DEFAULT 0,
    util_si      INT NOT NULL DEFAULT 0,
    util_no      INT NOT NULL DEFAULT 0,
    creado       DATETIME DEFAULT CURRENT_TIMESTAMP,
    actualizado  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sop_kbart_neg (negocio_id),
    INDEX idx_sop_kbart_cat (categoria_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await _ddl(`CREATE TABLE IF NOT EXISTS sop_cursos (
    id          VARCHAR(36) PRIMARY KEY,
    negocio_id  VARCHAR(36) NOT NULL,
    titulo      VARCHAR(160) NOT NULL,
    descripcion VARCHAR(400),
    icono       VARCHAR(30) DEFAULT '🎓',
    color       VARCHAR(20) DEFAULT '#6C4FF6',
    audiencia   ENUM('agentes','clientes','ambos') NOT NULL DEFAULT 'agentes',
    publicado   TINYINT(1) NOT NULL DEFAULT 0,
    orden       INT NOT NULL DEFAULT 0,
    creado      DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sop_curso_neg (negocio_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await _ddl(`CREATE TABLE IF NOT EXISTS sop_lecciones (
    id         VARCHAR(36) PRIMARY KEY,
    curso_id   VARCHAR(36) NOT NULL,
    negocio_id VARCHAR(36) NOT NULL,
    titulo     VARCHAR(160) NOT NULL,
    nivel      VARCHAR(20) DEFAULT 'Básico',
    orden      INT NOT NULL DEFAULT 0,
    contenido  LONGTEXT NOT NULL,
    creado     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sop_lecc_curso (curso_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await _ddl(`CREATE TABLE IF NOT EXISTS sop_progreso (
    id           VARCHAR(36) PRIMARY KEY,
    negocio_id   VARCHAR(36) NOT NULL,
    curso_id     VARCHAR(36) NOT NULL,
    leccion_id   VARCHAR(36) NOT NULL,
    alumno_ref   VARCHAR(120) NOT NULL,
    alumno_nombre VARCHAR(120),
    puntaje      INT NOT NULL DEFAULT 0,
    xp           INT NOT NULL DEFAULT 0,
    completado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_sop_prog (leccion_id, alumno_ref),
    INDEX idx_sop_prog_curso (curso_id, alumno_ref),
    INDEX idx_sop_prog_neg (negocio_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await _ddl(`INSERT IGNORE INTO modulos (id, clave, nombre, descripcion, icono, orden)
    VALUES ('mod-soporte', 'soporte', 'Soporte técnico', 'Mesa de ayuda, centro de ayuda y academia', 'life-buoy', 20)`);
})();

// ── Config / SLA / asignación ──────────────────────────────────
async function _getConfig(negocioId) {
  const { rows } = await pool.query(`SELECT * FROM sop_config WHERE negocio_id=? LIMIT 1`, [negocioId]);
  const c = rows[0] || {};
  return {
    sla: { ...SLA_DEFAULT, ...(parseJSON(c.sla_json, {}) || {}) },
    auto_asignar: c.auto_asignar || 'off',
    agentes_rr: parseJSON(c.agentes_rr, []) || [],
    rr_cursor: Number(c.rr_cursor) || 0,
    _exists: !!rows[0],
  };
}

function _slaFechas(cfg, prioridad) {
  const s = cfg.sla[prioridad] || SLA_DEFAULT[prioridad] || SLA_DEFAULT.media;
  const now = Date.now();
  return {
    fr: new Date(now + (Number(s.fr) || 0) * 60000),
    res: new Date(now + (Number(s.res) || 0) * 60000),
  };
}
const toSql = d => d.toISOString().slice(0, 19).replace('T', ' ');

async function _autoAsignar(negocioId, cfg) {
  if (cfg.auto_asignar !== 'round_robin' || !cfg.agentes_rr.length) return null;
  // Validar que sigan activos
  const { rows } = await pool.query(
    `SELECT id, nombre FROM usuarios WHERE negocio_id=? AND activo=1 AND id IN (${cfg.agentes_rr.map(() => '?').join(',')})`,
    [negocioId, ...cfg.agentes_rr]
  );
  if (!rows.length) return null;
  const ordenados = cfg.agentes_rr.map(id => rows.find(r => r.id === id)).filter(Boolean);
  if (!ordenados.length) return null;
  const idx = cfg.rr_cursor % ordenados.length;
  const elegido = ordenados[idx];
  await pool.query(
    `INSERT INTO sop_config (negocio_id, rr_cursor) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE rr_cursor=VALUES(rr_cursor)`,
    [negocioId, cfg.rr_cursor + 1]
  );
  return elegido;
}

// Marca de SLA calculada al vuelo (sin cron)
function _slaEstado(t) {
  const now = Date.now();
  const frDate = t.sla_fr_at ? new Date(String(t.sla_fr_at).replace(' ', 'T')) : null;
  const resDate = t.sla_res_at ? new Date(String(t.sla_res_at).replace(' ', 'T')) : null;
  const cerrado = t.estado === 'resuelto' || t.estado === 'cerrado';
  return {
    fr_vencido: !t.primera_respuesta_en && frDate && frDate.getTime() < now && !cerrado,
    res_vencido: !cerrado && resDate && resDate.getTime() < now,
    fr_at: t.sla_fr_at || null,
    res_at: t.sla_res_at || null,
  };
}

// ════════════════════════════════════════════════════════════════
// PORTAL PÚBLICO — sin login
// ════════════════════════════════════════════════════════════════

router.get('/pub/:negocioId/info', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT nombre, logo_url, color_primario, telefono, email FROM negocios WHERE id=? AND activo=1 LIMIT 1`,
      [req.params.negocioId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Negocio no encontrado' });
    res.json({ ...rows[0], categorias: CATEGORIAS });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Centro de ayuda (KB) público ──────────────────────────────
router.get('/pub/:negocioId/kb', async (req, res) => {
  try {
    const { rows: cats } = await pool.query(
      `SELECT id, nombre, slug, descripcion, icono FROM sop_kb_categorias WHERE negocio_id=? ORDER BY orden, nombre`,
      [req.params.negocioId]
    );
    const { rows: arts } = await pool.query(
      `SELECT id, categoria_id, titulo, slug, resumen FROM sop_kb_articulos
        WHERE negocio_id=? AND publicado=1 ORDER BY vistas DESC, titulo`,
      [req.params.negocioId]
    );
    res.json({
      categorias: cats.map(c => ({ ...c, articulos: arts.filter(a => a.categoria_id === c.id) })),
      sueltos: arts.filter(a => !cats.some(c => c.id === a.categoria_id)),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/pub/:negocioId/kb/buscar', async (req, res) => {
  try {
    const q = limpiar(req.query.q, 80);
    if (!q || q.length < 2) return res.json([]);
    const like = `%${q}%`;
    const { rows } = await pool.query(
      `SELECT id, titulo, slug, resumen FROM sop_kb_articulos
        WHERE negocio_id=? AND publicado=1 AND (titulo LIKE ? OR resumen LIKE ? OR cuerpo LIKE ?)
        ORDER BY (titulo LIKE ?) DESC, vistas DESC LIMIT 8`,
      [req.params.negocioId, like, like, like, like]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/pub/:negocioId/kb/articulo/:slug', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.titulo, a.cuerpo, a.resumen, a.util_si, a.util_no, a.actualizado, c.nombre AS categoria
         FROM sop_kb_articulos a LEFT JOIN sop_kb_categorias c ON c.id=a.categoria_id
        WHERE a.negocio_id=? AND a.slug=? AND a.publicado=1 LIMIT 1`,
      [req.params.negocioId, req.params.slug]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Artículo no encontrado' });
    pool.query(`UPDATE sop_kb_articulos SET vistas=vistas+1 WHERE id=?`, [rows[0].id]).catch(() => {});
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/pub/:negocioId/kb/articulo/:id/util', async (req, res) => {
  try {
    const col = req.body.util ? 'util_si' : 'util_no';
    await pool.query(
      `UPDATE sop_kb_articulos SET ${col}=${col}+1 WHERE id=? AND negocio_id=? AND publicado=1`,
      [req.params.id, req.params.negocioId]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Academia pública ──────────────────────────────────────────
router.get('/pub/:negocioId/academia', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cu.id, cu.titulo, cu.descripcion, cu.icono, cu.color, cu.audiencia,
              (SELECT COUNT(*) FROM sop_lecciones l WHERE l.curso_id=cu.id) AS lecciones
         FROM sop_cursos cu
        WHERE cu.negocio_id=? AND cu.publicado=1 AND cu.audiencia IN ('clientes','ambos')
        ORDER BY cu.orden, cu.titulo`,
      [req.params.negocioId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/pub/:negocioId/academia/curso/:id', async (req, res) => {
  try {
    const { rows: cu } = await pool.query(
      `SELECT id, titulo, descripcion, icono, color FROM sop_cursos
        WHERE id=? AND negocio_id=? AND publicado=1 AND audiencia IN ('clientes','ambos') LIMIT 1`,
      [req.params.id, req.params.negocioId]
    );
    if (!cu[0]) return res.status(404).json({ error: 'Curso no encontrado' });
    const { rows: lecc } = await pool.query(
      `SELECT id, titulo, nivel, orden, contenido FROM sop_lecciones WHERE curso_id=? ORDER BY orden, titulo`,
      [req.params.id]
    );
    res.json({ curso: cu[0], lecciones: lecc.map(l => ({ ...l, contenido: parseJSON(l.contenido, []) })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/pub/:negocioId/academia/progreso', async (req, res) => {
  try {
    const ref = limpiar(req.query.alumno, 120);
    if (!ref) return res.json([]);
    const { rows } = await pool.query(
      `SELECT curso_id, leccion_id, puntaje, xp, completado_en FROM sop_progreso
        WHERE negocio_id=? AND alumno_ref=?`,
      [req.params.negocioId, `cli:${ref}`]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/pub/:negocioId/academia/progreso', async (req, res) => {
  try {
    const ref = limpiar(req.body.alumno, 110);
    const nombre = limpiar(req.body.alumno_nombre, 120);
    const leccionId = limpiar(req.body.leccion_id, 36);
    if (!ref || !leccionId) return res.status(400).json({ error: 'Datos incompletos' });
    const { rows: l } = await pool.query(
      `SELECT id, curso_id FROM sop_lecciones WHERE id=? AND negocio_id=? LIMIT 1`,
      [leccionId, req.params.negocioId]
    );
    if (!l[0]) return res.status(404).json({ error: 'Lección no encontrada' });
    await pool.query(
      `INSERT INTO sop_progreso (id, negocio_id, curso_id, leccion_id, alumno_ref, alumno_nombre, puntaje, xp)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE puntaje=GREATEST(puntaje, VALUES(puntaje)), xp=GREATEST(xp, VALUES(xp)),
                               alumno_nombre=VALUES(alumno_nombre), completado_en=NOW()`,
      [uuid(), req.params.negocioId, l[0].curso_id, leccionId, `cli:${ref}`, nombre,
       Math.min(100, Math.max(0, parseInt(req.body.puntaje) || 0)),
       Math.max(0, parseInt(req.body.xp) || 0)]
    );
    res.status(201).json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Tickets públicos ──────────────────────────────────────────
router.post('/pub/:negocioId/tickets', async (req, res) => {
  try {
    const { negocioId } = req.params;
    const asunto      = limpiar(req.body.asunto, 160);
    const descripcion = limpiar(req.body.descripcion, 5000);
    const nombre      = limpiar(req.body.solicitante_nombre, 120);
    const email       = limpiar(req.body.solicitante_email, 160);
    const tel         = limpiar(req.body.solicitante_tel, 40);
    let categoria     = limpiar(req.body.categoria, 30) || 'otro';
    let prioridad     = limpiar(req.body.prioridad, 20) || 'media';
    if (!CATEGORIAS.includes(categoria)) categoria = 'otro';
    if (!PRIORIDADES.includes(prioridad)) prioridad = 'media';

    if (!asunto || !descripcion || !nombre)
      return res.status(400).json({ error: 'Asunto, descripción y nombre son obligatorios' });
    if (!email && !tel)
      return res.status(400).json({ error: 'Indica un correo o un teléfono de contacto' });

    const { rows: ng } = await pool.query(`SELECT id FROM negocios WHERE id=? AND activo=1 LIMIT 1`, [negocioId]);
    if (!ng[0]) return res.status(404).json({ error: 'Negocio no encontrado' });

    let codigo, intento = 0;
    while (intento++ < 5) {
      codigo = nuevoCodigo();
      const { rows: dup } = await pool.query(`SELECT 1 FROM sop_tickets WHERE codigo=? LIMIT 1`, [codigo]);
      if (!dup[0]) break;
    }
    const id = uuid();
    const token = uuid().replace(/-/g, '');

    const cfg = await _getConfig(negocioId);
    const sla = _slaFechas(cfg, prioridad);
    const asignado = await _autoAsignar(negocioId, cfg);

    await pool.query(
      `INSERT INTO sop_tickets
        (id, negocio_id, codigo, token, asunto, descripcion, categoria, prioridad,
         solicitante_nombre, solicitante_email, solicitante_tel,
         sla_fr_at, sla_res_at, agente_id, agente_nombre)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, negocioId, codigo, token, asunto, descripcion, categoria, prioridad,
       nombre, email, tel, toSql(sla.fr), toSql(sla.res),
       asignado ? asignado.id : null, asignado ? asignado.nombre : null]
    );

    try { req.app.locals.broadcast?.(negocioId, 'soporte_ticket_nuevo', { id, codigo, asunto, prioridad }); } catch {}
    res.status(201).json({ codigo, token, mensaje: 'Ticket creado. Guarda tu código para consultar el estado.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function _ticketPublico(codigo, token) {
  if (!codigo || !token) return null;
  const { rows } = await pool.query(
    `SELECT * FROM sop_tickets WHERE codigo=? AND token=? LIMIT 1`,
    [String(codigo).trim().toUpperCase(), String(token).trim()]
  );
  return rows[0] || null;
}

function _ticketPub(t) {
  return {
    codigo: t.codigo, asunto: t.asunto, descripcion: t.descripcion,
    categoria: t.categoria, prioridad: t.prioridad, estado: t.estado,
    solicitante_nombre: t.solicitante_nombre, agente_nombre: t.agente_nombre,
    creado: t.creado, actualizado: t.actualizado,
    csat_score: t.csat_score || null,
    puede_calificar: (t.estado === 'resuelto' || t.estado === 'cerrado') && !t.csat_score,
  };
}

router.get('/pub/ticket', async (req, res) => {
  try {
    const t = await _ticketPublico(req.query.codigo, req.query.token);
    if (!t) return res.status(404).json({ error: 'No encontramos ningún ticket con ese código' });
    const { rows: coms } = await pool.query(
      `SELECT autor_tipo, autor_nombre, cuerpo, creado FROM sop_comentarios
        WHERE ticket_id=? AND interno=0 ORDER BY creado ASC`,
      [t.id]
    );
    res.json({ ticket: _ticketPub(t), comentarios: coms });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/pub/ticket/comentario', async (req, res) => {
  try {
    const t = await _ticketPublico(req.body.codigo, req.body.token);
    if (!t) return res.status(404).json({ error: 'No encontramos ningún ticket con ese código' });
    if (t.estado === 'cerrado')
      return res.status(409).json({ error: 'Este ticket está cerrado. Abre uno nuevo si necesitas ayuda.' });
    const cuerpo = limpiar(req.body.cuerpo, 5000);
    if (!cuerpo) return res.status(400).json({ error: 'Escribe un mensaje' });

    await pool.query(
      `INSERT INTO sop_comentarios (id, ticket_id, negocio_id, autor_tipo, autor_nombre, cuerpo)
       VALUES (?,?,?, 'cliente', ?, ?)`,
      [uuid(), t.id, t.negocio_id, t.solicitante_nombre, cuerpo]
    );
    const nuevoEstado = t.estado === 'resuelto' ? 'abierto' : t.estado;
    await pool.query(
      `UPDATE sop_tickets SET estado=?, resuelto_en=${nuevoEstado === 'abierto' ? 'NULL' : 'resuelto_en'}, actualizado=NOW() WHERE id=?`,
      [nuevoEstado, t.id]
    );
    try { req.app.locals.broadcast?.(t.negocio_id, 'soporte_ticket_actividad', { id: t.id, codigo: t.codigo }); } catch {}
    res.status(201).json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/pub/ticket/csat', async (req, res) => {
  try {
    const t = await _ticketPublico(req.body.codigo, req.body.token);
    if (!t) return res.status(404).json({ error: 'No encontramos ningún ticket con ese código' });
    if (t.estado !== 'resuelto' && t.estado !== 'cerrado')
      return res.status(409).json({ error: 'Podrás calificar cuando el ticket esté resuelto' });
    if (t.csat_score) return res.status(409).json({ error: 'Ya calificaste este ticket. ¡Gracias!' });
    const score = parseInt(req.body.score);
    if (!(score >= 1 && score <= 5)) return res.status(400).json({ error: 'Calificación de 1 a 5' });
    await pool.query(
      `UPDATE sop_tickets SET csat_score=?, csat_comentario=?, csat_en=NOW() WHERE id=?`,
      [score, limpiar(req.body.comentario, 500), t.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// PANEL DE AGENTES — JWT + permiso 'soporte' (o 'personal')
// ════════════════════════════════════════════════════════════════
router.use(authMiddleware);
router.use(requirePermiso(['soporte', 'personal']));
const nid = req => req.user.negocio_id;
const esAdmin = req => req.user.es_superadmin || req.user?.permisos?.personal;

router.get('/resumen', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT estado, COUNT(*) AS n FROM sop_tickets WHERE negocio_id=? GROUP BY estado`, [nid(req)]);
    const out = { abierto: 0, en_progreso: 0, resuelto: 0, cerrado: 0 };
    rows.forEach(r => { out[r.estado] = Number(r.n); });
    out.activos = out.abierto + out.en_progreso;
    const { rows: v } = await pool.query(
      `SELECT COUNT(*) AS n FROM sop_tickets
        WHERE negocio_id=? AND estado IN ('abierto','en_progreso')
          AND ((primera_respuesta_en IS NULL AND sla_fr_at < NOW()) OR sla_res_at < NOW())`,
      [nid(req)]);
    out.vencidos = Number(v[0]?.n || 0);
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/agentes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre FROM usuarios WHERE negocio_id=? AND activo=1 ORDER BY nombre`, [nid(req)]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Dashboard ─────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || '') ? req.query.desde : null;
    const hasta = /^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || '') ? req.query.hasta : null;
    const rango = [], filtro = ['negocio_id=?']; const p = [nid(req)];
    if (desde) { filtro.push('creado >= ?'); p.push(desde + ' 00:00:00'); }
    if (hasta) { filtro.push('creado <= ?'); p.push(hasta + ' 23:59:59'); }
    const W = filtro.join(' AND ');

    const [porEstado, porPrioridad, porDia, porAgente, tiempos, csat, sla] = await Promise.all([
      pool.query(`SELECT estado, COUNT(*) n FROM sop_tickets WHERE ${W} GROUP BY estado`, p),
      pool.query(`SELECT prioridad, COUNT(*) n FROM sop_tickets WHERE ${W} GROUP BY prioridad`, p),
      pool.query(`SELECT DATE(creado) d, COUNT(*) n FROM sop_tickets WHERE ${W} GROUP BY DATE(creado) ORDER BY d`, p),
      pool.query(`SELECT COALESCE(agente_nombre,'Sin asignar') a, COUNT(*) n,
                         SUM(estado IN ('resuelto','cerrado')) resueltos
                  FROM sop_tickets WHERE ${W} GROUP BY agente_nombre ORDER BY n DESC`, p),
      pool.query(`SELECT
                    AVG(CASE WHEN primera_respuesta_en IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, creado, primera_respuesta_en) END) fr_min,
                    AVG(CASE WHEN resuelto_en IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, creado, resuelto_en) END) res_min
                  FROM sop_tickets WHERE ${W}`, p),
      pool.query(`SELECT csat_score s, COUNT(*) n FROM sop_tickets WHERE ${W} AND csat_score IS NOT NULL GROUP BY csat_score`, p),
      pool.query(`SELECT
                    SUM(primera_respuesta_en IS NOT NULL AND primera_respuesta_en <= sla_fr_at) fr_ok,
                    SUM(primera_respuesta_en IS NOT NULL) fr_total,
                    SUM(resuelto_en IS NOT NULL AND resuelto_en <= sla_res_at) res_ok,
                    SUM(resuelto_en IS NOT NULL) res_total
                  FROM sop_tickets WHERE ${W}`, p),
    ]);

    const csatRows = csat.rows;
    const csatTotal = csatRows.reduce((a, r) => a + Number(r.n), 0);
    const csatProm = csatTotal ? csatRows.reduce((a, r) => a + r.s * Number(r.n), 0) / csatTotal : null;

    res.json({
      total: porEstado.rows.reduce((a, r) => a + Number(r.n), 0),
      por_estado: porEstado.rows,
      por_prioridad: porPrioridad.rows,
      por_dia: porDia.rows.map(r => ({ d: String(r.d).slice(0, 10), n: Number(r.n) })),
      por_agente: porAgente.rows.map(r => ({ a: r.a, n: Number(r.n), resueltos: Number(r.resueltos) })),
      tiempo_primera_respuesta_min: tiempos.rows[0]?.fr_min != null ? Math.round(tiempos.rows[0].fr_min) : null,
      tiempo_resolucion_min: tiempos.rows[0]?.res_min != null ? Math.round(tiempos.rows[0].res_min) : null,
      sla_fr_pct: sla.rows[0]?.fr_total ? Math.round(100 * sla.rows[0].fr_ok / sla.rows[0].fr_total) : null,
      sla_res_pct: sla.rows[0]?.res_total ? Math.round(100 * sla.rows[0].res_ok / sla.rows[0].res_total) : null,
      csat_promedio: csatProm != null ? Math.round(csatProm * 100) / 100 : null,
      csat_total: csatTotal,
      csat_distribucion: csatRows.map(r => ({ s: r.s, n: Number(r.n) })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Tickets (agente) ──────────────────────────────────────────
router.get('/tickets', async (req, res) => {
  try {
    const where = ['t.negocio_id=?']; const params = [nid(req)];
    const { estado, prioridad, agente_id, q, tag, vencidos } = req.query;
    if (estado && ESTADOS.includes(estado))            { where.push('t.estado=?');    params.push(estado); }
    if (prioridad && PRIORIDADES.includes(prioridad))   { where.push('t.prioridad=?'); params.push(prioridad); }
    if (agente_id === 'sin')                            { where.push('t.agente_id IS NULL'); }
    else if (agente_id === 'yo')                        { where.push('t.agente_id=?'); params.push(req.user.id); }
    else if (agente_id)                                 { where.push('t.agente_id=?'); params.push(agente_id); }
    if (tag) { where.push('t.tags LIKE ?'); params.push(`%${String(tag).trim()}%`); }
    if (vencidos === '1') {
      where.push(`(t.estado IN ('abierto','en_progreso') AND ((t.primera_respuesta_en IS NULL AND t.sla_fr_at < NOW()) OR t.sla_res_at < NOW()))`);
    }
    if (q) {
      where.push('(t.asunto LIKE ? OR t.codigo LIKE ? OR t.solicitante_nombre LIKE ?)');
      const like = `%${String(q).trim()}%`; params.push(like, like, like);
    }
    const { rows } = await pool.query(
      `SELECT t.id, t.codigo, t.asunto, t.categoria, t.prioridad, t.estado, t.tags,
              t.solicitante_nombre, t.solicitante_email, t.solicitante_tel,
              t.agente_id, t.agente_nombre, t.creado, t.actualizado,
              t.sla_fr_at, t.sla_res_at, t.primera_respuesta_en, t.csat_score,
              (SELECT COUNT(*) FROM sop_comentarios c WHERE c.ticket_id=t.id) AS respuestas
         FROM sop_tickets t WHERE ${where.join(' AND ')}
        ORDER BY FIELD(t.estado,'abierto','en_progreso','resuelto','cerrado'),
                 FIELD(t.prioridad,'urgente','alta','media','baja'), t.creado DESC
        LIMIT 400`, params);
    res.json(rows.map(t => ({ ...t, sla: _slaEstado(t), tags: t.tags ? t.tags.split(',').filter(Boolean) : [] })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/tickets/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM sop_tickets WHERE id=? AND negocio_id=? LIMIT 1`, [req.params.id, nid(req)]);
    if (!rows[0]) return res.status(404).json({ error: 'Ticket no encontrado' });
    const { rows: coms } = await pool.query(
      `SELECT id, autor_tipo, autor_nombre, cuerpo, interno, creado
         FROM sop_comentarios WHERE ticket_id=? ORDER BY creado ASC`, [req.params.id]);
    const t = rows[0];
    res.json({
      ticket: { ...t, tags: t.tags ? t.tags.split(',').filter(Boolean) : [], sla: _slaEstado(t) },
      comentarios: coms,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/tickets/:id/comentario', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, negocio_id, estado, primera_respuesta_en FROM sop_tickets WHERE id=? AND negocio_id=? LIMIT 1`,
      [req.params.id, nid(req)]);
    if (!rows[0]) return res.status(404).json({ error: 'Ticket no encontrado' });
    const cuerpo = limpiar(req.body.cuerpo, 5000);
    if (!cuerpo) return res.status(400).json({ error: 'Escribe un mensaje' });
    const interno = req.body.interno ? 1 : 0;
    const t = rows[0];

    await pool.query(
      `INSERT INTO sop_comentarios (id, ticket_id, negocio_id, autor_tipo, autor_id, autor_nombre, cuerpo, interno)
       VALUES (?,?,?, 'agente', ?, ?, ?, ?)`,
      [uuid(), t.id, t.negocio_id, req.user.id, req.user.nombre || 'Agente', cuerpo, interno]);

    const sets = ['actualizado=NOW()'];
    if (!interno && !t.primera_respuesta_en) sets.push('primera_respuesta_en=NOW()');
    if (!interno && t.estado === 'abierto') sets.push(`estado='en_progreso'`);
    await pool.query(`UPDATE sop_tickets SET ${sets.join(', ')} WHERE id=?`, [t.id]);

    try { req.app.locals.broadcast?.(t.negocio_id, 'soporte_ticket_actividad', { id: t.id }); } catch {}
    res.status(201).json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/tickets/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, estado FROM sop_tickets WHERE id=? AND negocio_id=? LIMIT 1`, [req.params.id, nid(req)]);
    if (!rows[0]) return res.status(404).json({ error: 'Ticket no encontrado' });

    const sets = [], params = [];
    if (req.body.estado !== undefined) {
      if (!ESTADOS.includes(req.body.estado)) return res.status(400).json({ error: 'Estado no válido' });
      sets.push('estado=?'); params.push(req.body.estado);
      sets.push('cerrado_en=' + (req.body.estado === 'cerrado' ? 'NOW()' : 'cerrado_en'));
      if (req.body.estado === 'resuelto' || req.body.estado === 'cerrado') {
        sets.push('resuelto_en=COALESCE(resuelto_en, NOW())');
      } else {
        sets.push('resuelto_en=NULL');
      }
    }
    if (req.body.prioridad !== undefined) {
      if (!PRIORIDADES.includes(req.body.prioridad)) return res.status(400).json({ error: 'Prioridad no válida' });
      sets.push('prioridad=?'); params.push(req.body.prioridad);
    }
    if (req.body.categoria !== undefined) {
      sets.push('categoria=?'); params.push(CATEGORIAS.includes(req.body.categoria) ? req.body.categoria : 'otro');
    }
    if (req.body.tags !== undefined) {
      const tags = (Array.isArray(req.body.tags) ? req.body.tags : String(req.body.tags).split(','))
        .map(x => slugify(x)).filter(Boolean).slice(0, 12);
      sets.push('tags=?'); params.push(tags.join(',') || null);
    }
    if (req.body.agente_id !== undefined) {
      if (!req.body.agente_id) sets.push('agente_id=NULL', 'agente_nombre=NULL');
      else {
        const { rows: ag } = await pool.query(
          `SELECT nombre FROM usuarios WHERE id=? AND negocio_id=? LIMIT 1`, [req.body.agente_id, nid(req)]);
        if (!ag[0]) return res.status(400).json({ error: 'Agente no válido' });
        sets.push('agente_id=?', 'agente_nombre=?'); params.push(req.body.agente_id, ag[0].nombre);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.params.id);
    await pool.query(`UPDATE sop_tickets SET ${sets.join(', ')}, actualizado=NOW() WHERE id=?`, params);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Respuestas predefinidas ──────────────────────────────────
router.get('/respuestas', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, titulo, atajo, cuerpo FROM sop_respuestas WHERE negocio_id=? ORDER BY titulo`, [nid(req)]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/respuestas', async (req, res) => {
  try {
    const titulo = limpiar(req.body.titulo, 120), cuerpo = limpiar(req.body.cuerpo, 4000);
    if (!titulo || !cuerpo) return res.status(400).json({ error: 'Título y cuerpo requeridos' });
    const id = uuid();
    await pool.query(`INSERT INTO sop_respuestas (id, negocio_id, titulo, atajo, cuerpo) VALUES (?,?,?,?,?)`,
      [id, nid(req), titulo, limpiar(req.body.atajo, 40), cuerpo]);
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/respuestas/:id', async (req, res) => {
  try {
    const titulo = limpiar(req.body.titulo, 120), cuerpo = limpiar(req.body.cuerpo, 4000);
    if (!titulo || !cuerpo) return res.status(400).json({ error: 'Título y cuerpo requeridos' });
    const { rows } = await pool.query(
      `UPDATE sop_respuestas SET titulo=?, atajo=?, cuerpo=? WHERE id=? AND negocio_id=?`,
      [titulo, limpiar(req.body.atajo, 40), cuerpo, req.params.id, nid(req)]);
    if (!rows.affectedRows) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/respuestas/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM sop_respuestas WHERE id=? AND negocio_id=?`, [req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Configuración (SLA + asignación) — solo admin ─────────────
router.get('/config', async (req, res) => {
  try {
    const cfg = await _getConfig(nid(req));
    res.json({ sla: cfg.sla, auto_asignar: cfg.auto_asignar, agentes_rr: cfg.agentes_rr });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/config', async (req, res) => {
  try {
    if (!esAdmin(req)) return res.status(403).json({ error: 'Solo administradores' });
    const sla = {};
    for (const p of PRIORIDADES) {
      const s = req.body.sla?.[p] || {};
      sla[p] = {
        fr: Math.max(1, parseInt(s.fr) || SLA_DEFAULT[p].fr),
        res: Math.max(1, parseInt(s.res) || SLA_DEFAULT[p].res),
      };
    }
    const auto = ['off', 'round_robin'].includes(req.body.auto_asignar) ? req.body.auto_asignar : 'off';
    const rr = Array.isArray(req.body.agentes_rr) ? req.body.agentes_rr.filter(x => typeof x === 'string').slice(0, 50) : [];
    await pool.query(
      `INSERT INTO sop_config (negocio_id, sla_json, auto_asignar, agentes_rr)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE sla_json=VALUES(sla_json), auto_asignar=VALUES(auto_asignar),
                               agentes_rr=VALUES(agentes_rr), actualizado=NOW()`,
      [nid(req), JSON.stringify(sla), auto, JSON.stringify(rr)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Centro de ayuda (editor) ─────────────────────────────────
router.get('/kb/categorias', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, (SELECT COUNT(*) FROM sop_kb_articulos a WHERE a.categoria_id=c.id) AS articulos
         FROM sop_kb_categorias c WHERE c.negocio_id=? ORDER BY c.orden, c.nombre`, [nid(req)]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/kb/categorias', async (req, res) => {
  try {
    const nombre = limpiar(req.body.nombre, 120);
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const id = uuid();
    await pool.query(
      `INSERT INTO sop_kb_categorias (id, negocio_id, nombre, slug, descripcion, icono, orden)
       VALUES (?,?,?,?,?,?,?)`,
      [id, nid(req), nombre, slugify(nombre), limpiar(req.body.descripcion, 300),
       limpiar(req.body.icono, 30) || '📄', parseInt(req.body.orden) || 0]);
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/kb/categorias/:id', async (req, res) => {
  try {
    const nombre = limpiar(req.body.nombre, 120);
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    await pool.query(
      `UPDATE sop_kb_categorias SET nombre=?, slug=?, descripcion=?, icono=?, orden=? WHERE id=? AND negocio_id=?`,
      [nombre, slugify(nombre), limpiar(req.body.descripcion, 300), limpiar(req.body.icono, 30) || '📄',
       parseInt(req.body.orden) || 0, req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/kb/categorias/:id', async (req, res) => {
  try {
    await pool.query(`UPDATE sop_kb_articulos SET categoria_id=NULL WHERE categoria_id=? AND negocio_id=?`, [req.params.id, nid(req)]);
    await pool.query(`DELETE FROM sop_kb_categorias WHERE id=? AND negocio_id=?`, [req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/kb/articulos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.titulo, a.slug, a.resumen, a.publicado, a.vistas, a.util_si, a.util_no,
              a.categoria_id, c.nombre AS categoria, a.actualizado
         FROM sop_kb_articulos a LEFT JOIN sop_kb_categorias c ON c.id=a.categoria_id
        WHERE a.negocio_id=? ORDER BY a.actualizado DESC`, [nid(req)]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/kb/articulos/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM sop_kb_articulos WHERE id=? AND negocio_id=? LIMIT 1`, [req.params.id, nid(req)]);
    if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
async function _slugArticulo(negocioId, titulo, excluirId) {
  let base = slugify(titulo), slug = base, i = 2;
  while (true) {
    const { rows } = await pool.query(
      `SELECT id FROM sop_kb_articulos WHERE negocio_id=? AND slug=? ${excluirId ? 'AND id<>?' : ''} LIMIT 1`,
      excluirId ? [negocioId, slug, excluirId] : [negocioId, slug]);
    if (!rows[0]) return slug;
    slug = `${base}-${i++}`;
  }
}
router.post('/kb/articulos', async (req, res) => {
  try {
    const titulo = limpiar(req.body.titulo, 200), cuerpo = limpiar(req.body.cuerpo, 40000);
    if (!titulo || !cuerpo) return res.status(400).json({ error: 'Título y contenido requeridos' });
    const id = uuid();
    await pool.query(
      `INSERT INTO sop_kb_articulos (id, negocio_id, categoria_id, titulo, slug, resumen, cuerpo, publicado)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, nid(req), limpiar(req.body.categoria_id, 36), titulo, await _slugArticulo(nid(req), titulo),
       limpiar(req.body.resumen, 300), cuerpo, req.body.publicado ? 1 : 0]);
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/kb/articulos/:id', async (req, res) => {
  try {
    const titulo = limpiar(req.body.titulo, 200), cuerpo = limpiar(req.body.cuerpo, 40000);
    if (!titulo || !cuerpo) return res.status(400).json({ error: 'Título y contenido requeridos' });
    const { rows } = await pool.query(
      `UPDATE sop_kb_articulos SET categoria_id=?, titulo=?, slug=?, resumen=?, cuerpo=?, publicado=?
        WHERE id=? AND negocio_id=?`,
      [limpiar(req.body.categoria_id, 36), titulo, await _slugArticulo(nid(req), titulo, req.params.id),
       limpiar(req.body.resumen, 300), cuerpo, req.body.publicado ? 1 : 0, req.params.id, nid(req)]);
    if (!rows.affectedRows) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/kb/articulos/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM sop_kb_articulos WHERE id=? AND negocio_id=?`, [req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Academia (editor) ────────────────────────────────────────
router.get('/academia/cursos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cu.*, (SELECT COUNT(*) FROM sop_lecciones l WHERE l.curso_id=cu.id) AS lecciones,
              (SELECT COUNT(DISTINCT alumno_ref) FROM sop_progreso pr WHERE pr.curso_id=cu.id) AS alumnos
         FROM sop_cursos cu WHERE cu.negocio_id=? ORDER BY cu.orden, cu.titulo`, [nid(req)]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/academia/cursos', async (req, res) => {
  try {
    const titulo = limpiar(req.body.titulo, 160);
    if (!titulo) return res.status(400).json({ error: 'Título requerido' });
    const id = uuid();
    await pool.query(
      `INSERT INTO sop_cursos (id, negocio_id, titulo, descripcion, icono, color, audiencia, publicado, orden)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, nid(req), titulo, limpiar(req.body.descripcion, 400), limpiar(req.body.icono, 30) || '🎓',
       limpiar(req.body.color, 20) || '#6C4FF6',
       AUDIENCIAS.includes(req.body.audiencia) ? req.body.audiencia : 'agentes',
       req.body.publicado ? 1 : 0, parseInt(req.body.orden) || 0]);
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/academia/cursos/:id', async (req, res) => {
  try {
    const titulo = limpiar(req.body.titulo, 160);
    if (!titulo) return res.status(400).json({ error: 'Título requerido' });
    await pool.query(
      `UPDATE sop_cursos SET titulo=?, descripcion=?, icono=?, color=?, audiencia=?, publicado=?, orden=?
        WHERE id=? AND negocio_id=?`,
      [titulo, limpiar(req.body.descripcion, 400), limpiar(req.body.icono, 30) || '🎓',
       limpiar(req.body.color, 20) || '#6C4FF6',
       AUDIENCIAS.includes(req.body.audiencia) ? req.body.audiencia : 'agentes',
       req.body.publicado ? 1 : 0, parseInt(req.body.orden) || 0, req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/academia/cursos/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM sop_progreso WHERE curso_id=? AND negocio_id=?`, [req.params.id, nid(req)]);
    await pool.query(`DELETE FROM sop_lecciones WHERE curso_id=? AND negocio_id=?`, [req.params.id, nid(req)]);
    await pool.query(`DELETE FROM sop_cursos WHERE id=? AND negocio_id=?`, [req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/academia/cursos/:id/lecciones', async (req, res) => {
  try {
    const { rows: cu } = await pool.query(`SELECT id FROM sop_cursos WHERE id=? AND negocio_id=?`, [req.params.id, nid(req)]);
    if (!cu[0]) return res.status(404).json({ error: 'Curso no encontrado' });
    const { rows } = await pool.query(
      `SELECT id, titulo, nivel, orden, contenido FROM sop_lecciones WHERE curso_id=? ORDER BY orden, titulo`,
      [req.params.id]);
    res.json(rows.map(l => ({ ...l, contenido: parseJSON(l.contenido, []) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/academia/cursos/:id/lecciones', async (req, res) => {
  try {
    const { rows: cu } = await pool.query(`SELECT id FROM sop_cursos WHERE id=? AND negocio_id=?`, [req.params.id, nid(req)]);
    if (!cu[0]) return res.status(404).json({ error: 'Curso no encontrado' });
    const titulo = limpiar(req.body.titulo, 160);
    if (!titulo) return res.status(400).json({ error: 'Título requerido' });
    const id = uuid();
    await pool.query(
      `INSERT INTO sop_lecciones (id, curso_id, negocio_id, titulo, nivel, orden, contenido)
       VALUES (?,?,?,?,?,?,?)`,
      [id, req.params.id, nid(req), titulo, limpiar(req.body.nivel, 20) || 'Básico',
       parseInt(req.body.orden) || 0, JSON.stringify(Array.isArray(req.body.contenido) ? req.body.contenido : [])]);
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/academia/lecciones/:id', async (req, res) => {
  try {
    const titulo = limpiar(req.body.titulo, 160);
    if (!titulo) return res.status(400).json({ error: 'Título requerido' });
    const { rows } = await pool.query(
      `UPDATE sop_lecciones SET titulo=?, nivel=?, orden=?, contenido=? WHERE id=? AND negocio_id=?`,
      [titulo, limpiar(req.body.nivel, 20) || 'Básico', parseInt(req.body.orden) || 0,
       JSON.stringify(Array.isArray(req.body.contenido) ? req.body.contenido : []), req.params.id, nid(req)]);
    if (!rows.affectedRows) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/academia/lecciones/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM sop_progreso WHERE leccion_id=? AND negocio_id=?`, [req.params.id, nid(req)]);
    await pool.query(`DELETE FROM sop_lecciones WHERE id=? AND negocio_id=?`, [req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cursos + progreso para el propio agente (formación interna)
router.get('/academia/mios', async (req, res) => {
  try {
    const ref = `agt:${req.user.id}`;
    const { rows: cursos } = await pool.query(
      `SELECT cu.id, cu.titulo, cu.descripcion, cu.icono, cu.color,
              (SELECT COUNT(*) FROM sop_lecciones l WHERE l.curso_id=cu.id) AS lecciones
         FROM sop_cursos cu
        WHERE cu.negocio_id=? AND cu.publicado=1 AND cu.audiencia IN ('agentes','ambos')
        ORDER BY cu.orden, cu.titulo`, [nid(req)]);
    const { rows: prog } = await pool.query(
      `SELECT curso_id, leccion_id, puntaje, xp FROM sop_progreso WHERE negocio_id=? AND alumno_ref=?`,
      [nid(req), ref]);
    res.json({ cursos, progreso: prog });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/academia/mios/:cursoId', async (req, res) => {
  try {
    const { rows: cu } = await pool.query(
      `SELECT id, titulo, descripcion, icono, color FROM sop_cursos
        WHERE id=? AND negocio_id=? AND publicado=1 AND audiencia IN ('agentes','ambos') LIMIT 1`,
      [req.params.cursoId, nid(req)]);
    if (!cu[0]) return res.status(404).json({ error: 'Curso no encontrado' });
    const { rows: lecc } = await pool.query(
      `SELECT id, titulo, nivel, orden, contenido FROM sop_lecciones WHERE curso_id=? ORDER BY orden, titulo`,
      [req.params.cursoId]);
    res.json({ curso: cu[0], lecciones: lecc.map(l => ({ ...l, contenido: parseJSON(l.contenido, []) })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/academia/mios/progreso', async (req, res) => {
  try {
    const leccionId = limpiar(req.body.leccion_id, 36);
    if (!leccionId) return res.status(400).json({ error: 'Falta la lección' });
    const { rows: l } = await pool.query(
      `SELECT id, curso_id FROM sop_lecciones WHERE id=? AND negocio_id=? LIMIT 1`, [leccionId, nid(req)]);
    if (!l[0]) return res.status(404).json({ error: 'Lección no encontrada' });
    await pool.query(
      `INSERT INTO sop_progreso (id, negocio_id, curso_id, leccion_id, alumno_ref, alumno_nombre, puntaje, xp)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE puntaje=GREATEST(puntaje, VALUES(puntaje)), xp=GREATEST(xp, VALUES(xp)), completado_en=NOW()`,
      [uuid(), nid(req), l[0].curso_id, leccionId, `agt:${req.user.id}`, req.user.nombre || null,
       Math.min(100, Math.max(0, parseInt(req.body.puntaje) || 0)), Math.max(0, parseInt(req.body.xp) || 0)]);
    res.status(201).json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
