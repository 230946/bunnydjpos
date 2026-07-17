/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * routes/clientes.js
 * Gestión de clientes por negocio.
 * - Buscar / crear: cualquier usuario autenticado (para uso desde el POS)
 * - Listar / editar / desactivar: requiere permiso 'clientes' (admin)
 */
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { pool, ph } = require('../db');
const { authMiddleware, requirePermiso, requireAdmin } = require('../middleware/auth');

router.use(authMiddleware);

// ── Migración: tipo de documento (necesario para facturación electrónica —
// DIAN exige saber si el número es NIT, cédula, cédula de extranjería, etc.) ──
;(async () => {
  try { await pool.query(`ALTER TABLE clientes ADD COLUMN tipo_documento VARCHAR(20) DEFAULT NULL`, [], { silent: true }); } catch {}
})();

// ── Facturación electrónica: registro de cada documento enviado a un
// proveedor tecnológico (ej. NumRot) por venta. Todavía no se usa — queda
// lista para cuando se conecte el envío real; guarda la respuesta cruda del
// proveedor completa (respuesta_proveedor) por si se necesita algo no
// contemplado en las columnas de arriba.
;(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS facturas_electronicas (
      id                  VARCHAR(36)   PRIMARY KEY,
      negocio_id          VARCHAR(36)   NOT NULL,
      venta_id            VARCHAR(36)   NOT NULL,
      proveedor           VARCHAR(30)   NOT NULL DEFAULT 'numrot',
      estado              ENUM('pendiente','enviada','aceptada','rechazada','error') NOT NULL DEFAULT 'pendiente',
      prefijo             VARCHAR(10)   DEFAULT NULL,
      numero              VARCHAR(30)   DEFAULT NULL,
      cufe                VARCHAR(120)  DEFAULT NULL,
      xml_url             VARCHAR(500)  DEFAULT NULL,
      pdf_url             VARCHAR(500)  DEFAULT NULL,
      qr_data             TEXT          DEFAULT NULL,
      error_mensaje       TEXT          DEFAULT NULL,
      respuesta_proveedor JSON          DEFAULT NULL,
      enviado_en          DATETIME      DEFAULT NULL,
      creado              DATETIME      DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_fe_negocio (negocio_id),
      INDEX idx_fe_venta (venta_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  } catch (e) { console.error('facturas_electronicas DDL:', e.message); }
})();

// Buscar clientes (POS y admin)
router.get('/clientes/buscar', async (req, res) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    const { rows } = await pool.query(
      `SELECT id, nombre, telefono, email, documento, tipo_documento, direccion, departamento, ciudad
       FROM clientes
       WHERE negocio_id=${ph(1)} AND activo=1
         AND (nombre LIKE ${ph(2)} OR telefono LIKE ${ph(3)} OR documento LIKE ${ph(4)})
       ORDER BY nombre LIMIT 10`,
      [req.user.negocio_id, q, q, q]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Obtener uno (POS y admin — necesario para validar completitud antes de facturar)
router.get('/clientes/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, telefono, email, documento, tipo_documento, direccion FROM clientes
       WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, req.user.negocio_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Listar todos (solo admin)
router.get('/clientes', requirePermiso('clientes'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM clientes WHERE negocio_id=${ph(1)} ORDER BY nombre`,
      [req.user.negocio_id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Crear (POS y admin)
router.post('/clientes', async (req, res) => {
  try {
    const { nombre, telefono, email, documento, tipo_documento, direccion, notas, departamento, ciudad } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const id = uuid();
    await pool.query(
      `INSERT INTO clientes (id, negocio_id, nombre, telefono, email, documento, tipo_documento, direccion, notas, departamento, ciudad)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},${ph(9)},${ph(10)},${ph(11)})`,
      [id, req.user.negocio_id, nombre, telefono||null, email||null,
       documento||null, tipo_documento||null, direccion||null, notas||null, departamento||null, ciudad||null]
    );
    res.status(201).json({ id, nombre, telefono: telefono||null, email: email||null, documento: documento||null, tipo_documento: tipo_documento||null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Actualizar (solo administrador)
router.put('/clientes/:id', requireAdmin, async (req, res) => {
  try {
    const { nombre, telefono, email, documento, tipo_documento, direccion, notas, activo, departamento, ciudad } = req.body;
    await pool.query(
      `UPDATE clientes SET nombre=${ph(1)}, telefono=${ph(2)}, email=${ph(3)},
       documento=${ph(4)}, tipo_documento=${ph(5)}, direccion=${ph(6)}, notas=${ph(7)}, activo=${ph(8)},
       departamento=${ph(9)}, ciudad=${ph(10)}
       WHERE id=${ph(11)} AND negocio_id=${ph(12)}`,
      [nombre, telefono||null, email||null, documento||null, tipo_documento||null, direccion||null, notas||null,
       activo !== undefined ? activo : 1, departamento||null, ciudad||null,
       req.params.id, req.user.negocio_id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Eliminar / desactivar (solo administrador)
router.delete('/clientes/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query(
      `UPDATE clientes SET activo=0 WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, req.user.negocio_id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
