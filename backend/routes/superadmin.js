/**
 * routes/superadmin.js
 * Solo accesible por usuarios con es_superadmin = 1
 */
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { pool, ph } = require('../db');
const { authMiddleware, superadminOnly } = require('../middleware/auth');
const multer  = require('multer');
const path    = require('path');

const logoStorage = multer.diskStorage({
  destination: process.env.UPLOADS_DIR || './uploads',
  filename: (_, file, cb) => cb(null, 'logo-' + uuid() + path.extname(file.originalname))
});
const uploadLogo = multer({ storage: logoStorage, limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authMiddleware, superadminOnly);

// ── Auto-migrate ──────────────────────────────────────────────
const _runDDL = async (sql) => {
  try { await pool.query(sql); } catch(e) { console.error('DDL Error:', e.message); }
};
(async () => {
  await _runDDL(`CREATE TABLE IF NOT EXISTS neg_planes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    negocio_id VARCHAR(36) NOT NULL COLLATE utf8mb4_unicode_ci,
    plan ENUM('free','basic','premium') DEFAULT 'free',
    precio DECIMAL(10,2) DEFAULT 0,
    fecha_inicio DATE,
    fecha_fin DATE,
    notas TEXT,
    creado DATETIME DEFAULT NOW(),
    actualizado DATETIME DEFAULT NOW() ON UPDATE NOW(),
    UNIQUE KEY uq_np_neg (negocio_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await _runDDL(`ALTER TABLE neg_planes CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await _runDDL(`CREATE TABLE IF NOT EXISTS platform_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    negocio_id VARCHAR(36) COLLATE utf8mb4_unicode_ci,
    negocio_nombre VARCHAR(200),
    usuario_id VARCHAR(36) COLLATE utf8mb4_unicode_ci,
    usuario_nombre VARCHAR(200),
    accion VARCHAR(100),
    detalle TEXT,
    ip VARCHAR(45),
    creado DATETIME DEFAULT NOW(),
    INDEX idx_pl_creado (creado),
    INDEX idx_pl_neg (negocio_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await _runDDL(`ALTER TABLE platform_log CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await _runDDL(`CREATE TABLE IF NOT EXISTS neg_contratos (
    id VARCHAR(36) PRIMARY KEY,
    negocio_id VARCHAR(36) NOT NULL COLLATE utf8mb4_unicode_ci,
    numero VARCHAR(50),
    tipo ENUM('mensual','trimestral','semestral','anual') DEFAULT 'mensual',
    plan VARCHAR(50) DEFAULT 'basic',
    valor DECIMAL(10,2) DEFAULT 0,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE,
    estado ENUM('pendiente','activo','vencido','cancelado') DEFAULT 'pendiente',
    notas TEXT,
    creado DATETIME DEFAULT NOW(),
    actualizado DATETIME DEFAULT NOW() ON UPDATE NOW(),
    INDEX idx_nc_neg (negocio_id),
    INDEX idx_nc_estado (estado)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
})();

async function logAct(negocio_id, negocio_nombre, usuario_id, usuario_nombre, accion, detalle, ip) {
  try {
    await pool.query(
      `INSERT INTO platform_log (negocio_id,negocio_nombre,usuario_id,usuario_nombre,accion,detalle,ip) VALUES (?,?,?,?,?,?,?)`,
      [negocio_id||null, negocio_nombre||null, usuario_id||null, usuario_nombre||null, accion, detalle||null, ip||null]
    );
  } catch {}
}

// ════════════════════════════════════════════════════════════════
// NEGOCIOS
// ════════════════════════════════════════════════════════════════

router.get('/negocios', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT n.*,
        (SELECT COUNT(*) FROM usuarios u WHERE u.negocio_id = n.id) AS total_usuarios,
        (SELECT COUNT(*) FROM negocio_modulos nm WHERE nm.negocio_id = n.id AND nm.activo=1) AS modulos_activos
      FROM negocios n ORDER BY n.creado DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/negocios', async (req, res) => {
  try {
    const { nombre, tipo='restaurante', nit, direccion, ciudad, telefono, email } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const id = uuid();
    await pool.query(
      `INSERT INTO negocios (id,nombre,tipo,nit,direccion,ciudad,telefono,email)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, nombre, tipo, nit||null, direccion||null, ciudad||null, telefono||null, email||null]
    );
    // Crear rol admin por defecto
    const rolId = uuid();
    const permisos = JSON.stringify({
      pos_mesas:true,pos_menu:true,pos_cocina:true,pos_cobro:true,
      inventario:true,reportes:true,gastos:true,horarios:true,
      personal:true,minimercado:true,proveedores:true,facturacion:true
    });
    await pool.query(
      `INSERT INTO roles (id,negocio_id,nombre,descripcion,es_sistema,permisos)
       VALUES (?,?,'Administrador','Acceso completo al negocio',1,?)`,
      [rolId, id, permisos]
    );
    const { rows } = await pool.query(`SELECT * FROM negocios WHERE id=?`, [id]);
    logAct(id, nombre, req.user?.id, req.user?.nombre, 'negocio_creado', `${nombre} (${tipo})`, req.ip);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/negocios/:id', async (req, res) => {
  try {
    const { nombre, tipo, nit, direccion, ciudad, telefono, email, activo } = req.body;
    await pool.query(
      `UPDATE negocios SET nombre=?,tipo=?,nit=?,direccion=?,ciudad=?,telefono=?,email=?,activo=?,actualizado=NOW()
       WHERE id=?`,
      [nombre, tipo, nit, direccion, ciudad, telefono, email, activo?1:0, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/negocios/:id/logo', uploadLogo.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const url = `/uploads/${req.file.filename}`;
    await pool.query(`UPDATE negocios SET logo_url=?, actualizado=NOW() WHERE id=?`, [url, req.params.id]);
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/negocios/:id', async (req, res) => {
  try {
    await pool.query(`UPDATE negocios SET activo=0 WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// MÓDULOS POR NEGOCIO
// ════════════════════════════════════════════════════════════════

router.get('/negocios/:id/modulos', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.*, COALESCE(nm.activo, 0) AS habilitado, nm.activado_en
      FROM modulos m
      LEFT JOIN negocio_modulos nm ON nm.modulo_id = m.id AND nm.negocio_id = ?
      ORDER BY m.orden
    `, [req.params.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/negocios/:id/modulos', async (req, res) => {
  try {
    const { modulo_id, activo } = req.body;
    const activoInt = activo ? 1 : 0;
    await pool.query(`
      INSERT INTO negocio_modulos (negocio_id, modulo_id, activo)
      VALUES (?,?,?)
      ON DUPLICATE KEY UPDATE activo=?, activado_en=NOW()
    `, [req.params.id, modulo_id, activoInt, activoInt]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// CREAR ADMIN DE NEGOCIO (desde SuperAdmin)
// ════════════════════════════════════════════════════════════════

router.post('/negocios/:id/crear-admin', async (req, res) => {
  try {
    const { nombre, email, username, password } = req.body;
    if (!nombre || !password) return res.status(400).json({ error: 'nombre y password requeridos' });
    // Obtener rol admin del negocio
    const { rows: roles } = await pool.query(
      `SELECT id FROM roles WHERE negocio_id=? AND es_sistema=1 LIMIT 1`, [req.params.id]
    );
    const rol_id = roles[0]?.id || null;
    const hash = await bcrypt.hash(password, 12);
    const id = uuid();
    await pool.query(
      `INSERT INTO usuarios (id,negocio_id,rol_id,nombre,email,username,password_hash)
       VALUES (?,?,?,?,?,?,?)`,
      [id, req.params.id, rol_id, nombre, email||null, username||null, hash]
    );
    logAct(req.params.id, null, req.user?.id, req.user?.nombre, 'admin_creado', `${nombre} (login: ${username||email})`, req.ip);
    res.status(201).json({ id, mensaje: `Admin creado. Login: ${username||email}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// MÓDULOS CATÁLOGO
// ════════════════════════════════════════════════════════════════

router.get('/modulos', async (_, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM modulos ORDER BY orden');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/modulos', async (req, res) => {
  try {
    const { clave, nombre, descripcion, icono, orden } = req.body;
    if (!clave || !nombre) return res.status(400).json({ error: 'clave y nombre requeridos' });
    const id = uuid();
    await pool.query(
      `INSERT INTO modulos (id, clave, nombre, descripcion, icono, orden)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)})`,
      [id, clave, nombre, descripcion||null, icono||null, orden||0]
    );
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/modulos/:id', async (req, res) => {
  try {
    const { clave, nombre, descripcion, icono, orden } = req.body;
    if (!clave || !nombre) return res.status(400).json({ error: 'clave y nombre requeridos' });
    await pool.query(
      `UPDATE modulos SET clave=${ph(1)}, nombre=${ph(2)}, descripcion=${ph(3)}, icono=${ph(4)}, orden=${ph(5)} WHERE id=${ph(6)}`,
      [clave, nombre, descripcion||null, icono||null, orden||0, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/modulos/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM modulos WHERE id=${ph(1)}`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// ════════════════════════════════════════════════════════════════
// USUARIOS GLOBALES
// ════════════════════════════════════════════════════════════════

router.get('/usuarios', async (_, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.nombre, u.email, u.username, u.negocio_id,
             u.es_superadmin, u.activo, u.creado, u.numero_empleado,
             n.nombre AS negocio_nombre, r.nombre AS rol_nombre
      FROM usuarios u
      LEFT JOIN negocios n ON n.id = u.negocio_id
      LEFT JOIN roles r    ON r.id = u.rol_id
      ORDER BY u.creado ASC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// REPORTES DE FACTURACIÓN POR NEGOCIO
// ════════════════════════════════════════════════════════════════
router.get('/reportes', async (req, res) => {
  try {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
    const today = now.toISOString().slice(0,10);
    const desde = req.query.desde || firstDay;
    const hasta = req.query.hasta || today;
    const { rows } = await pool.query(`
      SELECT n.id AS negocio_id, n.nombre, n.tipo,
        COUNT(v.id) AS total_ventas,
        COALESCE(SUM(v.total),0) AS ingresos,
        COALESCE(AVG(v.total),0) AS promedio,
        MAX(v.creado) AS ultima_venta
      FROM negocios n
      LEFT JOIN ventas v ON v.negocio_id = n.id AND DATE(v.creado) BETWEEN ? AND ?
      WHERE n.activo = 1
      GROUP BY n.id, n.nombre, n.tipo
      ORDER BY ingresos DESC
    `, [desde, hasta]);
    const totalIngresos = rows.reduce((s,r) => s + parseFloat(r.ingresos||0), 0);
    const totalVentas   = rows.reduce((s,r) => s + parseInt(r.total_ventas||0), 0);
    const conVentas     = rows.filter(r => parseInt(r.total_ventas||0) > 0).length;
    res.json({ rows, totalIngresos, totalVentas, conVentas, desde, hasta });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// PLANES / LICENCIAS
// ════════════════════════════════════════════════════════════════
router.get('/planes', async (_, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT n.id AS negocio_id, n.nombre, n.tipo, n.activo AS neg_activo,
             COALESCE(p.plan,'free') AS plan,
             COALESCE(p.precio,0) AS precio,
             p.fecha_inicio, p.fecha_fin, p.notas, p.actualizado
      FROM negocios n
      LEFT JOIN neg_planes p ON p.negocio_id = n.id
      ORDER BY n.nombre
    `);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/planes/:negocio_id', async (req, res) => {
  try {
    const { plan, precio, fecha_inicio, fecha_fin, notas } = req.body;
    const nid = req.params.negocio_id;
    await pool.query(`
      INSERT INTO neg_planes (negocio_id,plan,precio,fecha_inicio,fecha_fin,notas)
      VALUES (?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE plan=VALUES(plan),precio=VALUES(precio),
        fecha_inicio=VALUES(fecha_inicio),fecha_fin=VALUES(fecha_fin),
        notas=VALUES(notas),actualizado=NOW()
    `, [nid, plan||'free', parseFloat(precio)||0, fecha_inicio||null, fecha_fin||null, notas||null]);
    const { rows: neg } = await pool.query(`SELECT nombre FROM negocios WHERE id=?`, [nid]);
    logAct(nid, neg[0]?.nombre, req.user?.id, req.user?.nombre, 'plan_cambiado',
      `Plan → ${plan}, precio: ${precio}`, req.ip);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// LOG DE ACTIVIDAD GLOBAL
// ════════════════════════════════════════════════════════════════
router.get('/actividad', async (req, res) => {
  try {
    const limite = Math.min(parseInt(req.query.limite)||200, 500);
    const nid = req.query.negocio_id;
    let q = `SELECT * FROM platform_log`;
    const params = [];
    if (nid) { q += ` WHERE negocio_id = ?`; params.push(nid); }
    q += ` ORDER BY creado DESC LIMIT ${limite}`;
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// CONTRATOS
// ════════════════════════════════════════════════════════════════
router.get('/contratos', async (_, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*, n.nombre AS negocio_nombre, n.tipo AS negocio_tipo
      FROM neg_contratos c
      JOIN negocios n ON n.id = c.negocio_id
      ORDER BY c.creado DESC
    `);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/contratos', async (req, res) => {
  try {
    const { negocio_id, numero, tipo, plan, valor, fecha_inicio, fecha_fin, estado, notas } = req.body;
    if (!negocio_id || !fecha_inicio) return res.status(400).json({ error: 'negocio_id y fecha_inicio requeridos' });
    const id = uuid();
    const year = new Date().getFullYear();
    const { rows: cnt } = await pool.query(`SELECT COUNT(*)+1 AS n FROM neg_contratos WHERE YEAR(creado)=?`, [year]);
    const autoNum = numero || `CONT-${year}-${String(cnt[0].n).padStart(3,'0')}`;
    await pool.query(
      `INSERT INTO neg_contratos (id,negocio_id,numero,tipo,plan,valor,fecha_inicio,fecha_fin,estado,notas)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, negocio_id, autoNum, tipo||'mensual', plan||'basic', parseFloat(valor)||0,
       fecha_inicio, fecha_fin||null, estado||'pendiente', notas||null]
    );
    const { rows: neg } = await pool.query(`SELECT nombre FROM negocios WHERE id=?`, [negocio_id]);
    logAct(negocio_id, neg[0]?.nombre, req.user?.id, req.user?.nombre, 'contrato_creado', `N° ${autoNum}`, req.ip);
    res.status(201).json({ id, numero: autoNum });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/contratos/:id', async (req, res) => {
  try {
    const { negocio_id, numero, tipo, plan, valor, fecha_inicio, fecha_fin, estado, notas } = req.body;
    await pool.query(
      `UPDATE neg_contratos SET negocio_id=?,numero=?,tipo=?,plan=?,valor=?,
       fecha_inicio=?,fecha_fin=?,estado=?,notas=?,actualizado=NOW() WHERE id=?`,
      [negocio_id, numero, tipo||'mensual', plan||'basic', parseFloat(valor)||0,
       fecha_inicio, fecha_fin||null, estado||'pendiente', notas||null, req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/contratos/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM neg_contratos WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
