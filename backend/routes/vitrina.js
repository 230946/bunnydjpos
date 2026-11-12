/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * routes/vitrina.js
 * Vitrina: página pública tipo anuncio con los productos del negocio
 * (/vitrina?n=NEGOCIO_ID). Solo para los planes Plus y Premium.
 *  - GET  /api/vitrina/publica/:negocioId   datos de la página (sin login)
 *  - GET  /api/vitrina/admin                configuración (administradores)
 *  - PUT  /api/vitrina/admin                guardar configuración
 *  - POST /api/vitrina/admin/banner         subir la imagen de portada
 * Las promociones son las de cada producto del menú (precio de promo con
 * vigencia), así que la vitrina muestra el mismo precio que cobra la caja.
 */
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const multer = require('multer');
const { pool } = require('../db');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { obtenerMenuData } = require('./domicilios');

const PLANES_VITRINA = ['plus', 'premium', 'personalizado'];
const ESTILOS = ['elegante', 'promo', 'claro'];
const TIPOS = ['restaurante', 'bar', 'minimercado'];

(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS vitrina_config (
      negocio_id VARCHAR(36) NOT NULL PRIMARY KEY,
      activo TINYINT(1) NOT NULL DEFAULT 0,
      estilo VARCHAR(20) NOT NULL DEFAULT 'claro',
      eslogan VARCHAR(160) NULL,
      banner_url VARCHAR(255) NULL,
      horario VARCHAR(160) NULL,
      whatsapp VARCHAR(30) NULL,
      instagram VARCHAR(120) NULL,
      facebook VARCHAR(200) NULL,
      actualizado TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } catch (e) { console.error('DDL vitrina_config:', e.message); }
})();

// Plan vigente: el del contrato activo o, si no hay, el de neg_planes.
async function planDe(negocioId) {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(
         (SELECT c.plan FROM neg_contratos c WHERE c.negocio_id=? AND c.estado='activo' ORDER BY c.fecha_fin DESC LIMIT 1),
         (SELECT np.plan FROM neg_planes np WHERE np.negocio_id=? LIMIT 1),
         'free') AS plan`,
      [negocioId, negocioId]
    );
    return String(rows[0]?.plan || 'free').toLowerCase();
  } catch { return 'free'; }
}

async function configDe(negocioId) {
  const { rows } = await pool.query(`SELECT * FROM vitrina_config WHERE negocio_id=? LIMIT 1`, [negocioId]);
  return rows[0] || { negocio_id: negocioId, activo: 0, estilo: 'claro' };
}

const texto = (v, max) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

// ── Pública ───────────────────────────────────────────────────────
router.get('/publica/:negocioId', async (req, res) => {
  try {
    const nidPub = req.params.negocioId;
    const data = await obtenerMenuData(nidPub);
    if (!data) return res.status(404).json({ error: 'Negocio no encontrado' });
    const plan = await planDe(nidPub);
    const cfg = await configDe(nidPub);
    if (!PLANES_VITRINA.includes(plan) || !cfg.activo) {
      return res.status(404).json({ error: 'Este negocio todavía no tiene su vitrina publicada.' });
    }
    const n = data.negocio;
    const productos = data.productos
      .filter(p => !p.agotado)
      .map(p => ({
        id: p.id,
        nombre: p.nombre,
        descripcion: p.descripcion || null,
        categoria: p.categoria || 'General',
        imagen: p.imagen_url || null,
        precio: parseFloat(p.precio) || 0,
        precio_promo: p.promo_vigente ? parseFloat(p.precio_efectivo) || null : null,
        promo_hasta: p.promo_vigente && p.promo_hasta ? String(p.promo_hasta).slice(0, 10) : null,
        destacado: !!p.destacado,
        destacado_texto: p.destacado_texto || null,
      }));
    res.set('Cache-Control', 'no-store');
    res.json({
      negocio: {
        id: n.id, nombre: n.nombre, tipo: n.tipo, logo_url: n.logo_url, telefono: n.telefono,
        direccion: n.direccion, ciudad: n.ciudad, color: n.color_primario,
      },
      vitrina: {
        estilo: ESTILOS.includes(cfg.estilo) ? cfg.estilo : 'claro',
        eslogan: cfg.eslogan, banner_url: cfg.banner_url, horario: cfg.horario,
        whatsapp: cfg.whatsapp || n.telefono, instagram: cfg.instagram, facebook: cfg.facebook,
      },
      domicilios: TIPOS.includes(n.tipo),
      productos,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Administración ────────────────────────────────────────────────
const adm = require('express').Router();
adm.use(authMiddleware, requireAdmin);
// El superadmin no tiene negocio propio: indica cuál con ?n=
const nid = req => req.user.negocio_id || (req.user.es_superadmin ? req.query.n : null);

adm.get('/', async (req, res) => {
  try {
    const id = nid(req);
    if (!id) return res.status(400).json({ error: 'Falta el negocio' });
    const plan = await planDe(id);
    res.json({ config: await configDe(id), plan, plan_ok: PLANES_VITRINA.includes(plan), url: `/vitrina?n=${id}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

adm.put('/', async (req, res) => {
  try {
    const id = nid(req);
    if (!id) return res.status(400).json({ error: 'Falta el negocio' });
    const b = req.body || {};
    const activo = b.activo ? 1 : 0;
    if (activo && !PLANES_VITRINA.includes(await planDe(id))) {
      return res.status(403).json({ error: 'La vitrina está incluida en los planes Plus y Premium.' });
    }
    const estilo = ESTILOS.includes(b.estilo) ? b.estilo : 'claro';
    const vals = [activo, estilo, texto(b.eslogan, 160), texto(b.horario, 160),
      texto(String(b.whatsapp || '').replace(/[^\d+]/g, ''), 30),
      texto(String(b.instagram || '').replace(/^@/, ''), 120), texto(b.facebook, 200)];
    await pool.query(
      `INSERT INTO vitrina_config (negocio_id, activo, estilo, eslogan, horario, whatsapp, instagram, facebook)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE activo=VALUES(activo), estilo=VALUES(estilo), eslogan=VALUES(eslogan),
         horario=VALUES(horario), whatsapp=VALUES(whatsapp), instagram=VALUES(instagram), facebook=VALUES(facebook)`,
      [id, ...vals]
    );
    res.json({ ok: true, config: await configDe(id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const IMG_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const uploadBanner = multer({
  storage: multer.diskStorage({
    destination: process.env.UPLOADS_DIR || './uploads',
    filename: (_, file, cb) => cb(null, 'vitrina-' + uuid() + IMG_EXT[file.mimetype]),
  }),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, !!IMG_EXT[file.mimetype]),
});

adm.post('/banner', uploadBanner.single('banner'), async (req, res) => {
  try {
    const id = nid(req);
    if (!id) return res.status(400).json({ error: 'Falta el negocio' });
    if (!req.file) return res.status(400).json({ error: 'Sube una imagen JPG, PNG o WEBP de hasta 6 MB' });
    const url = `/uploads/${req.file.filename}`;
    await pool.query(
      `INSERT INTO vitrina_config (negocio_id, banner_url) VALUES (?,?)
       ON DUPLICATE KEY UPDATE banner_url=VALUES(banner_url)`,
      [id, url]
    );
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

adm.delete('/banner', async (req, res) => {
  try {
    const id = nid(req);
    if (!id) return res.status(400).json({ error: 'Falta el negocio' });
    await pool.query(`UPDATE vitrina_config SET banner_url=NULL WHERE negocio_id=?`, [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.use('/admin', adm);

module.exports = router;
module.exports.planDe = planDe;
module.exports.configDe = configDe;
module.exports.PLANES_VITRINA = PLANES_VITRINA;
