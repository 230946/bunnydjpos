/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
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
const domiciliosRouter  = require('./routes/domicilios');
const publicoRouter     = require('./routes/publico');
// const hotelRouter       = require('./routes/hotel'); // módulo Hotel aún sin terminar/commitear

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3001;

// ── Middlewares ───────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(process.env.UPLOADS_DIR || './uploads'));
// Ningún GET de página/API se cachea — cubre las rutas con res.sendFile
// (login, pos, cocina, menu, etc.) que no pasan por express.static.
app.use((req, res, next) => {
  if (req.method === 'GET') res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

// ── Servir frontend desde el servidor (evita problema file://) ────
const frontendPath = path.join(__dirname, '..', 'frontend');
app.disable('etag');  // sin cache en desarrollo
app.use(express.static(frontendPath, { etag: false, lastModified: false }));
// Rutas directas para cada panel
app.get('/',                 (_, res) => res.sendFile(path.join(frontendPath, 'inicio.html')));
app.get('/login',            (_, res) => res.sendFile(path.join(frontendPath, 'login.html')));
// POS
app.get('/pos',              (_, res) => res.sendFile(path.join(frontendPath, 'pos-restaurante.html')));
app.get('/minimercado',      (_, res) => res.sendFile(path.join(frontendPath, 'pos-minimercado.html')));
app.get('/peluqueria',       (_, res) => res.sendFile(path.join(frontendPath, 'pos-peluqueria.html')));
app.get('/cocina',           (_, res) => res.sendFile(path.join(frontendPath, 'cocina.html')));
app.get('/menu',             (_, res) => res.sendFile(path.join(frontendPath, 'menu-cliente.html')));
// Domicilios
app.get('/domicilios',       (_, res) => res.sendFile(path.join(frontendPath, 'domicilios.html')));
app.get('/domiciliario',     (_, res) => res.sendFile(path.join(frontendPath, 'domiciliario.html')));
app.get('/rider',            (_, res) => res.sendFile(path.join(frontendPath, 'rider.html')));
// Admin
app.get('/admin',            (_, res) => res.sendFile(path.join(frontendPath, 'admin-restaurante.html')));
app.get('/minimercado-admin',(_, res) => res.sendFile(path.join(frontendPath, 'admin-minimercado.html')));
app.get('/peluqueria-admin', (_, res) => res.sendFile(path.join(frontendPath, 'admin-peluqueria.html')));
// app.get('/hotel-admin',      (_, res) => res.sendFile(path.join(frontendPath, 'admin-hotel.html'))); // módulo Hotel aún sin terminar/commitear
app.get('/superadmin',       (_, res) => res.sendFile(path.join(frontendPath, 'superadmin.html')));
// Portales
app.get('/portal',           (_, res) => res.sendFile(path.join(frontendPath, 'portal.html')));
app.get('/portal-empleado',  (_, res) => res.sendFile(path.join(frontendPath, 'portal-empleado.html')));
app.get('/reservas',         (_, res) => res.sendFile(path.join(frontendPath, 'reservas-peluqueria.html')));

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
app.use('/api/domicilios', domiciliosRouter);
app.use('/api/publico',   publicoRouter);
// app.use('/api/hotel',     hotelRouter); // módulo Hotel aún sin terminar/commitear

// ── Info pública de negocio (para mostrar nombre en login) ────────
app.get('/api/negocio-pub/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT nombre, tipo, logo_url, nit, direccion, ciudad, telefono, departamento, idiomas, color_primario, moneda, zona_horaria FROM negocios WHERE id=? AND activo=1 LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });

    // Incluir info del contrato vigente (si existe la tabla)
    let contrato = null;
    try {
      const { rows: cr } = await pool.query(
        `SELECT id, estado, fecha_inicio, fecha_fin, tipo, valor FROM neg_contratos
         WHERE negocio_id=?
         ORDER BY FIELD(estado,'activo','pendiente','vencido','cancelado'), fecha_fin DESC
         LIMIT 1`,
        [req.params.id]
      );
      if (cr[0]) {
        let { id: cid, estado, fecha_fin, fecha_inicio, tipo, valor } = cr[0];
        const hoy = new Date();
        // Auto-activar: pendiente → activo si fecha_inicio llegó y fecha_fin no ha pasado aún
        if (estado === 'pendiente' && fecha_inicio) {
          const inicio = new Date(String(fecha_inicio).slice(0,10)+'T12:00:00');
          const fin2 = fecha_fin ? new Date(String(fecha_fin).slice(0,10)+'T12:00:00') : null;
          if (inicio <= hoy && (!fin2 || fin2 >= hoy)) {
            await pool.query(`UPDATE neg_contratos SET estado='activo', actualizado=NOW() WHERE id=?`, [cid]);
            estado = 'activo';
          }
        }
        // Auto-vencer: activo → pendiente (renovación) si fecha_fin ya pasó
        let renovacion = false;
        if (estado === 'activo' && fecha_fin) {
          const fin2 = new Date(String(fecha_fin).slice(0,10)+'T12:00:00');
          if (fin2 < hoy) {
            await pool.query(`UPDATE neg_contratos SET estado='pendiente', actualizado=NOW() WHERE id=?`, [cid]);
            estado = 'pendiente';
            renovacion = true;
          }
        }
        const fin = fecha_fin;
        let dias = null;
        if (fin) {
          const ms = new Date(String(fin).slice(0,10)+'T12:00:00') - hoy;
          dias = Math.ceil(ms / (1000*60*60*24));
        }
        contrato = {
          estado,
          fecha_fin: fin ? String(fin).slice(0,10) : null,
          dias_para_vencer: dias,
          renovacion,
          tipo: tipo || 'mensual',
          valor: parseFloat(valor) || 0
        };
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

// ── Migraciones automáticas ───────────────────────────────────────
async function runMigrations() {
  const migrations = [
    { table: 'inventario', column: 'iva_pct',      sql: `ALTER TABLE inventario ADD COLUMN iva_pct DECIMAL(5,2) NOT NULL DEFAULT 0` },
    { table: 'inventario', column: 'codigo_barras', sql: `ALTER TABLE inventario ADD COLUMN codigo_barras VARCHAR(50) NULL` },
    { table: 'negocios',   column: 'departamento', sql: `ALTER TABLE negocios ADD COLUMN departamento VARCHAR(100) NULL` },
    { table: 'negocios',   column: 'idiomas',      sql: `ALTER TABLE negocios ADD COLUMN idiomas VARCHAR(255) NULL DEFAULT '["es"]'` },
    { table: 'negocios',   column: 'color_primario', sql: `ALTER TABLE negocios ADD COLUMN color_primario VARCHAR(20) NULL` },
    { table: 'negocios',   column: 'moneda',       sql: `ALTER TABLE negocios ADD COLUMN moneda VARCHAR(3) NOT NULL DEFAULT 'COP'` },
    { table: 'negocios',   column: 'zona_horaria', sql: `ALTER TABLE negocios ADD COLUMN zona_horaria VARCHAR(50) NOT NULL DEFAULT 'America/Bogota'` },
    { table: 'comandas',   column: 'es_adicion',   sql: `ALTER TABLE comandas ADD COLUMN es_adicion TINYINT(1) NOT NULL DEFAULT 0` },
    { table: 'menu_items', column: 'nombre_zh',    sql: `ALTER TABLE menu_items ADD COLUMN nombre_zh VARCHAR(200) NULL` },
    { table: 'menu_items', column: 'descripcion_zh', sql: `ALTER TABLE menu_items ADD COLUMN descripcion_zh TEXT NULL` },
    { table: 'domicilios_pedidos', column: 'pago_estado', sql: `ALTER TABLE domicilios_pedidos ADD COLUMN pago_estado VARCHAR(20) NOT NULL DEFAULT 'pendiente'` },
    { table: 'domicilios_pedidos', column: 'venta_id',    sql: `ALTER TABLE domicilios_pedidos ADD COLUMN venta_id VARCHAR(36) NULL` },
    { table: 'empleados', column: 'lat',    sql: `ALTER TABLE empleados ADD COLUMN lat DECIMAL(10,7) NULL` },
    { table: 'empleados', column: 'lng',    sql: `ALTER TABLE empleados ADD COLUMN lng DECIMAL(10,7) NULL` },
    { table: 'empleados', column: 'gps_at', sql: `ALTER TABLE empleados ADD COLUMN gps_at TIMESTAMP NULL` },
    { table: 'empleados', column: 'foto_url', sql: `ALTER TABLE empleados ADD COLUMN foto_url VARCHAR(300) NULL` },
    { table: 'empleados', column: 'vehiculo', sql: `ALTER TABLE empleados ADD COLUMN vehiculo VARCHAR(20) NULL` },
    { table: 'empleados', column: 'placa',    sql: `ALTER TABLE empleados ADD COLUMN placa VARCHAR(20) NULL` },
    { table: 'empleados', column: 'color_vehiculo', sql: `ALTER TABLE empleados ADD COLUMN color_vehiculo VARCHAR(40) NULL` },
    { table: 'ventas', column: 'monto_efectivo', sql: `ALTER TABLE ventas ADD COLUMN monto_efectivo DECIMAL(10,2) NOT NULL DEFAULT 0` },
    { table: 'ventas', column: 'monto_tarjeta',  sql: `ALTER TABLE ventas ADD COLUMN monto_tarjeta  DECIMAL(10,2) NOT NULL DEFAULT 0` },
    { table: 'ventas', column: 'monto_nequi',    sql: `ALTER TABLE ventas ADD COLUMN monto_nequi    DECIMAL(10,2) NOT NULL DEFAULT 0` },
    { table: 'ventas', column: 'anulado_en',        sql: `ALTER TABLE ventas ADD COLUMN anulado_en TIMESTAMP NULL` },
    { table: 'ventas', column: 'anulado_por',       sql: `ALTER TABLE ventas ADD COLUMN anulado_por VARCHAR(36) NULL` },
    { table: 'ventas', column: 'motivo_anulacion',  sql: `ALTER TABLE ventas ADD COLUMN motivo_anulacion VARCHAR(255) NULL` },
    { table: 'menu_items', column: 'foto_url', sql: `ALTER TABLE menu_items ADD COLUMN foto_url VARCHAR(255) NULL` },
    { table: 'domicilios_pedidos', column: 'calificacion',      sql: `ALTER TABLE domicilios_pedidos ADD COLUMN calificacion TINYINT NULL` },
    { table: 'domicilios_pedidos', column: 'calificacion_nota', sql: `ALTER TABLE domicilios_pedidos ADD COLUMN calificacion_nota VARCHAR(255) NULL` },
    { table: 'domicilios_pedidos', column: 'metodo_pago',    sql: `ALTER TABLE domicilios_pedidos ADD COLUMN metodo_pago VARCHAR(20) NOT NULL DEFAULT 'efectivo'` },
    { table: 'domicilios_pedidos', column: 'monto_efectivo', sql: `ALTER TABLE domicilios_pedidos ADD COLUMN monto_efectivo DECIMAL(10,2) NOT NULL DEFAULT 0` },
    { table: 'domicilios_pedidos', column: 'monto_tarjeta',  sql: `ALTER TABLE domicilios_pedidos ADD COLUMN monto_tarjeta  DECIMAL(10,2) NOT NULL DEFAULT 0` },
    { table: 'domicilios_pedidos', column: 'monto_nequi',    sql: `ALTER TABLE domicilios_pedidos ADD COLUMN monto_nequi    DECIMAL(10,2) NOT NULL DEFAULT 0` },
    { table: 'domicilios_pedidos', column: 'llego_en',       sql: `ALTER TABLE domicilios_pedidos ADD COLUMN llego_en TIMESTAMP NULL` },
    { table: 'domicilios_pedidos', column: 'tipo_entrega',   sql: `ALTER TABLE domicilios_pedidos ADD COLUMN tipo_entrega VARCHAR(20) NOT NULL DEFAULT 'domicilio'` },
    { table: 'mesa_estado', column: 'sesion_token', sql: `ALTER TABLE mesa_estado ADD COLUMN sesion_token VARCHAR(36) NULL` },
    { table: 'menu_items', column: 'promo_activo',    sql: `ALTER TABLE menu_items ADD COLUMN promo_activo TINYINT(1) NOT NULL DEFAULT 0` },
    { table: 'menu_items', column: 'promo_precio',    sql: `ALTER TABLE menu_items ADD COLUMN promo_precio DECIMAL(10,2) NULL` },
    { table: 'menu_items', column: 'promo_desde',     sql: `ALTER TABLE menu_items ADD COLUMN promo_desde DATE NULL` },
    { table: 'menu_items', column: 'promo_hasta',     sql: `ALTER TABLE menu_items ADD COLUMN promo_hasta DATE NULL` },
    { table: 'menu_items', column: 'destacado',       sql: `ALTER TABLE menu_items ADD COLUMN destacado TINYINT(1) NOT NULL DEFAULT 0` },
    { table: 'menu_items', column: 'destacado_texto', sql: `ALTER TABLE menu_items ADD COLUMN destacado_texto VARCHAR(100) NULL` },
    {
      table: 'domicilios_pedidos', column: '__create__',
      createSql: `CREATE TABLE IF NOT EXISTS domicilios_pedidos (
        id VARCHAR(36) PRIMARY KEY,
        negocio_id VARCHAR(36) NOT NULL,
        tipo VARCHAR(20) NOT NULL DEFAULT 'restaurante',
        cliente_nombre VARCHAR(100) NOT NULL,
        cliente_tel VARCHAR(30) NOT NULL,
        cliente_dir TEXT NOT NULL,
        items JSON NOT NULL,
        notas TEXT,
        estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        domiciliario_id VARCHAR(36),
        pago_estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        venta_id VARCHAR(36) NULL,
        calificacion TINYINT NULL,
        calificacion_nota VARCHAR(255) NULL,
        metodo_pago VARCHAR(20) NOT NULL DEFAULT 'efectivo',
        monto_efectivo DECIMAL(10,2) NOT NULL DEFAULT 0,
        monto_tarjeta DECIMAL(10,2) NOT NULL DEFAULT 0,
        monto_nequi DECIMAL(10,2) NOT NULL DEFAULT 0,
        subtotal DECIMAL(12,2) DEFAULT 0,
        total DECIMAL(12,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        actualizado TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_negocio (negocio_id),
        INDEX idx_estado (estado)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    },
    {
      table: 'empleados', column: '__create__',
      createSql: `CREATE TABLE IF NOT EXISTS empleados (
        id VARCHAR(36) PRIMARY KEY,
        negocio_id VARCHAR(36) NOT NULL,
        nombre VARCHAR(100) NOT NULL,
        documento VARCHAR(30) NOT NULL,
        celular VARCHAR(30) NOT NULL,
        rol VARCHAR(30) NOT NULL DEFAULT 'domiciliario',
        activo TINYINT(1) DEFAULT 1,
        token VARCHAR(80) UNIQUE NOT NULL,
        lat DECIMAL(10,7) NULL,
        lng DECIMAL(10,7) NULL,
        gps_at TIMESTAMP NULL,
        foto_url VARCHAR(300) NULL,
        vehiculo VARCHAR(20) NULL,
        placa VARCHAR(20) NULL,
        color_vehiculo VARCHAR(40) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_negocio (negocio_id),
        UNIQUE KEY uk_neg_doc (negocio_id, documento)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    },
    {
      table: 'domicilios_riders', column: '__create__',
      createSql: `CREATE TABLE IF NOT EXISTS domicilios_riders (
        id VARCHAR(36) PRIMARY KEY,
        negocio_id VARCHAR(36) NOT NULL,
        nombre VARCHAR(100) NOT NULL,
        telefono VARCHAR(30),
        token VARCHAR(80) UNIQUE NOT NULL,
        activo TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_negocio (negocio_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    },
    {
      table: 'menu_item_recetas', column: '__create__',
      createSql: `CREATE TABLE IF NOT EXISTS menu_item_recetas (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        menu_item_id  VARCHAR(36) NOT NULL,
        negocio_id    VARCHAR(36) NOT NULL,
        inventario_id VARCHAR(36) NOT NULL,
        cantidad      DECIMAL(12,3) NOT NULL DEFAULT 1,
        FOREIGN KEY (menu_item_id)  REFERENCES menu_items(id)  ON DELETE CASCADE,
        FOREIGN KEY (negocio_id)    REFERENCES negocios(id)    ON DELETE CASCADE,
        FOREIGN KEY (inventario_id) REFERENCES inventario(id)  ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    },
    {
      table: 'pedidos_cliente', column: '__create__',
      createSql: `CREATE TABLE IF NOT EXISTS pedidos_cliente (
        id VARCHAR(36) PRIMARY KEY,
        negocio_id VARCHAR(36) NOT NULL,
        mesa_id VARCHAR(36) NOT NULL,
        mesa_num INT,
        mesa_nombre VARCHAR(60),
        cliente_nombre VARCHAR(100),
        items JSON NOT NULL,
        notas TEXT,
        estado VARCHAR(20) NOT NULL DEFAULT 'pendiente_aprobacion',
        motivo_rechazo VARCHAR(255),
        comanda_id VARCHAR(36),
        creado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        actualizado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE,
        FOREIGN KEY (mesa_id) REFERENCES mesas(id) ON DELETE CASCADE,
        INDEX idx_negocio_estado (negocio_id, estado),
        INDEX idx_mesa (mesa_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    { table: 'pedidos_cliente', column: 'cliente_nombre', sql: `ALTER TABLE pedidos_cliente ADD COLUMN cliente_nombre VARCHAR(100) NULL` },
    { table: 'pedidos_cliente', column: 'cliente_celular', sql: `ALTER TABLE pedidos_cliente ADD COLUMN cliente_celular VARCHAR(30) NULL` },
  ];
  for (const m of migrations) {
    try {
      if (m.createSql) {
        // Migración tipo CREATE TABLE IF NOT EXISTS
        await pool.query(m.createSql);
        console.log(`✅ Tabla ${m.table} OK`);
      } else {
        // Migración tipo ADD COLUMN
        const { rows } = await pool.query(
          `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
          [m.table, m.column]
        );
        if (!rows[0] || parseInt(rows[0].cnt) === 0) {
          await pool.query(m.sql);
          console.log(`✅ Migración ${m.table}.${m.column} OK`);
        }
      }
    } catch (e) {
      console.error(`Error migración ${m.table}:`, e.message);
    }
  }
}

// ── Arrancar ──────────────────────────────────────────────────────
server.listen(PORT, async () => {
  console.log(`\n🐰 BUNNYDJPOS API → http://localhost:${PORT}`);
  console.log(`   WebSocket   → ws://localhost:${PORT}?negocio_id=<id>`);
  await seedSuperadmin();
  await runMigrations();
});
