/**
 * BUNNYDJPOS — server.js
 * Servidor principal API REST + WebSocket para cocina en tiempo real
 */
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const http       = require('http');
const { WebSocketServer } = require('ws');
const bcrypt     = require('bcryptjs');
const { v4: uuid } = require('uuid');
const path       = require('path');
const multer     = require('multer');
const { pool, ph } = require('./db');

// ── Routers ──────────────────────────────────────────────────────
const authRouter       = require('./routes/auth');
const superadminRouter = require('./routes/superadmin');
const usuariosRouter   = require('./routes/usuarios');
const adminRouter      = require('./routes/admin');
const posRouter        = require('./routes/pos');
const inventarioRouter = require('./routes/inventario');
const clientesRouter    = require('./routes/clientes');
const peluqueriaRouter  = require('./routes/peluqueria');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3001;

// ── Middlewares ───────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(process.env.UPLOADS_DIR || './uploads'));

// ── Servir frontend desde el servidor (evita problema file://) ────
const frontendPath = path.join(__dirname, '..', 'frontend');
app.disable('etag');  // sin cache en desarrollo
app.use(express.static(frontendPath, { etag: false, lastModified: false }));
// Rutas directas para cada panel
app.get('/',             (_, res) => res.sendFile(path.join(frontendPath, 'restaurante-pos.html')));
app.get('/superadmin',   (_, res) => res.sendFile(path.join(frontendPath, 'superadmin.html')));
app.get('/admin',        (_, res) => res.sendFile(path.join(frontendPath, 'admin-restaurante.html')));
app.get('/pos',          (_, res) => res.sendFile(path.join(frontendPath, 'restaurante-pos.html')));
app.get('/app',          (_, res) => res.sendFile(path.join(frontendPath, 'app.html')));

// ── Multer para logos ─────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: process.env.UPLOADS_DIR || './uploads',
  filename: (_, file, cb) => cb(null, uuid() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ── WebSocket (cocina en tiempo real) ─────────────────────────────
const wss = new WebSocketServer({ server });
const clients = new Map(); // negocio_id → Set<ws>

wss.on('connection', (ws, req) => {
  const url    = new URL(req.url, `http://localhost`);
  const negocio = url.searchParams.get('negocio_id') || 'global';
  if (!clients.has(negocio)) clients.set(negocio, new Set());
  clients.get(negocio).add(ws);
  ws.on('close', () => clients.get(negocio)?.delete(ws));
});

function broadcast(negocio_id, tipo, data) {
  const msg = JSON.stringify({ tipo, data, ts: Date.now() });
  clients.get(negocio_id)?.forEach(ws => {
    if (ws.readyState === 1) ws.send(msg);
  });
}
app.locals.broadcast = broadcast;

// ── Rutas ─────────────────────────────────────────────────────────
app.get('/api/health', async (_, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, version: '1.0.0', name: 'BUNNYDJPOS' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use('/api/auth',       authRouter);
app.use('/api/superadmin', superadminRouter);
app.use('/api/admin',      usuariosRouter);
app.use('/api/admin',      adminRouter);
app.use('/api/admin',      clientesRouter);
app.use('/api/pos',        posRouter);
app.use('/api/inventario', inventarioRouter);
app.use('/api/peluqueria', peluqueriaRouter);

// ── Info pública de negocio (para mostrar nombre en login) ────────
app.get('/api/negocio-pub/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT nombre, tipo, logo_url, nit, direccion, ciudad, telefono FROM negocios WHERE id=? AND activo=1 LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });

    // Incluir info del contrato vigente (si existe la tabla)
    let contrato = null;
    try {
      const { rows: cr } = await pool.query(
        `SELECT id, estado, fecha_inicio, fecha_fin FROM neg_contratos
         WHERE negocio_id=?
         ORDER BY FIELD(estado,'activo','pendiente','vencido','cancelado'), fecha_fin DESC
         LIMIT 1`,
        [req.params.id]
      );
      if (cr[0]) {
        let { id: cid, estado, fecha_fin, fecha_inicio } = cr[0];
        // Auto-activar si está pendiente y la fecha de inicio ya llegó
        if (estado === 'pendiente' && fecha_inicio) {
          const hoy = new Date();
          const inicio = new Date(String(fecha_inicio).slice(0,10)+'T12:00:00');
          if (inicio <= hoy) {
            await pool.query(`UPDATE neg_contratos SET estado='activo', actualizado=NOW() WHERE id=?`, [cid]);
            estado = 'activo';
          }
        }
        const fin = fecha_fin;
        let dias = null;
        if (fin) {
          const ms = new Date(String(fin).slice(0,10)+'T12:00:00') - new Date();
          dias = Math.ceil(ms / (1000*60*60*24));
        }
        contrato = { estado, fecha_fin: fin ? String(fin).slice(0,10) : null, dias_para_vencer: dias };
      }
    } catch (_) {}

    let plan = 'free';
    try {
      const { rows: planRows } = await pool.query(
        `SELECT COALESCE(
           (SELECT c.plan FROM neg_contratos c WHERE c.negocio_id=? AND c.estado='activo' ORDER BY c.fecha_fin DESC LIMIT 1),
           np.plan, 'free'
         ) AS plan
         FROM negocios n LEFT JOIN neg_planes np ON np.negocio_id=n.id WHERE n.id=? LIMIT 1`,
        [req.params.id, req.params.id]
      );
      plan = planRows[0]?.plan || 'free';
    } catch (_) {}

    res.json({ ...rows[0], contrato, plan });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Subir logo de negocio ─────────────────────────────────────────
app.post('/api/negocios/:id/logo', upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const url = `/uploads/${req.file.filename}`;
    await pool.query(`UPDATE negocios SET logo_url=${ph(1)} WHERE id=${ph(2)}`, [url, req.params.id]);
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Subir foto de empleado peluquería ─────────────────────────────
app.post('/api/peluqueria/empleados/:id/foto', upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const url = `/uploads/${req.file.filename}`;
    await pool.query(`UPDATE pel_empleados SET foto_url=${ph(1)} WHERE id=${ph(2)}`, [url, req.params.id]);
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Configuración de factura por negocio ──────────────────────────
app.get('/api/config-factura', async (req, res) => {
  try {
    const nid = req.query.negocio_id;
    const { rows } = await pool.query(`SELECT datos FROM config_factura WHERE negocio_id=${ph(1)}`, [nid]);
    res.json(rows[0] ? JSON.parse(rows[0].datos) : {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/config-factura', async (req, res) => {
  try {
    const { negocio_id, ...datos } = req.body;
    await pool.query(`
      INSERT INTO config_factura (negocio_id, datos)
      VALUES (?,?)
      ON DUPLICATE KEY UPDATE datos=VALUES(datos), actualizado=NOW()
    `, [negocio_id, JSON.stringify(datos)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Seed: crear superadmin si no existe ───────────────────────────
async function seedSuperadmin() {
  try {
    const email = process.env.SUPERADMIN_EMAIL || 'superadmin@bunnydjpos.com';
    const pass  = process.env.SUPERADMIN_PASS  || 'Admin123!';
    const { rows } = await pool.query(`SELECT id FROM usuarios WHERE es_superadmin=1 LIMIT 1`);
    if (rows.length) return console.log('✅ Superadmin ya existe');
    const hash = await bcrypt.hash(pass, 12);
    await pool.query(
      `INSERT INTO usuarios (id,nombre,email,username,password_hash,es_superadmin)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},1)`,
      [uuid(), 'Super Admin', email, 'superadmin', hash]
    );
    console.log(`✅ Superadmin creado: ${email} / ${pass}`);
    console.log('   ⚠️  Cambia la contraseña en producción');
  } catch (e) {
    console.error('Error creando superadmin:', e.message);
  }
}

// ── Arrancar ──────────────────────────────────────────────────────
server.listen(PORT, async () => {
  console.log(`\n🐰 BUNNYDJPOS API → http://localhost:${PORT}`);
  console.log(`   WebSocket   → ws://localhost:${PORT}?negocio_id=<id>`);
  await seedSuperadmin();
});
