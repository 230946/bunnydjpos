/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * routes/inventario.js
 * Inventario: CRUD, movimientos, importar/exportar Excel, alertas
 */
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { pool, ph } = require('../db');
const { authMiddleware, requirePermiso } = require('../middleware/auth');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const XLSX   = require('xlsx');

router.use(authMiddleware);
const nid = req => req.user.negocio_id;

// Multer en memoria para Excel
const memStorage = multer.memoryStorage();
const uploadExcel = multer({ storage: memStorage, limits: { fileSize: 10*1024*1024 } });

// Multer para fotos de producto
const diskStorage = multer.diskStorage({
  destination: process.env.UPLOADS_DIR || './uploads',
  filename: (_, file, cb) => cb(null, uuid() + path.extname(file.originalname))
});
const uploadFoto = multer({ storage: diskStorage, limits: { fileSize: 5*1024*1024 } });

// ════════════════════════════════════════════════════════════════
// INVENTARIO CRUD
// ════════════════════════════════════════════════════════════════

router.get('/', async (req, res) => {
  try {
    const { categoria, bajo_stock, es_producto, modulo, q, proveedor_id } = req.query;
    let sql = `SELECT i.*, p.nombre AS proveedor_nombre
               FROM inventario i LEFT JOIN proveedores p ON p.id = i.proveedor_id
               WHERE i.negocio_id=${ph(1)} AND i.activo=1`;
    const params = [nid(req)];
    if (categoria)    { params.push(categoria);          sql += ` AND i.categoria=${ph(params.length)}`; }
    if (modulo)       { params.push(modulo);             sql += ` AND i.modulo=${ph(params.length)}`; }
    if (proveedor_id) { params.push(proveedor_id);       sql += ` AND i.proveedor_id=${ph(params.length)}`; }
    if (es_producto !== undefined) { params.push(es_producto==='true'); sql += ` AND i.es_producto=${ph(params.length)}`; }
    if (bajo_stock === 'true') sql += ' AND i.stock > 0 AND i.stock < i.stock_min';
    if (q) { params.push(`%${q}%`, `%${q}%`, `%${q}%`); sql += ` AND (i.nombre LIKE ${ph(params.length-2)} OR i.codigo LIKE ${ph(params.length-1)} OR i.codigo_barras LIKE ${ph(params.length)})`; }
    sql += ' ORDER BY i.categoria, i.nombre';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/categorias', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT categoria FROM inventario WHERE negocio_id=${ph(1)} AND activo=1 ORDER BY categoria`,
      [nid(req)]
    );
    res.json(rows.map(r => r.categoria));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/next-codigo', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT codigo FROM inventario WHERE negocio_id=${ph(1)} AND codigo REGEXP '^COD-[0-9]+$'
       ORDER BY CAST(SUBSTRING(codigo, 5) AS UNSIGNED) DESC LIMIT 1`,
      [nid(req)]
    );
    let next = 1;
    if (rows[0]) {
      const num = parseInt(rows[0].codigo.replace('COD-', ''), 10);
      if (!isNaN(num)) next = num + 1;
    }
    res.json({ codigo: `COD-${String(next).padStart(3, '0')}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM inventario WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, nid(req)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', requirePermiso('inventario'), async (req, res) => {
  try {
    const { codigo, codigo_barras, nombre, categoria, stock, stock_min, stock_max,
            unidad, unidad_compra, costo, precio_venta, proveedor_id, es_producto,
            descripcion, margen, es_paquete, cantidad_paquete, modulo, iva_pct } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const id = uuid();
    await pool.query(
      `INSERT INTO inventario (id,negocio_id,codigo,codigo_barras,nombre,categoria,stock,stock_min,stock_max,
       unidad,unidad_compra,costo,precio_venta,proveedor_id,es_producto,descripcion,margen,es_paquete,cantidad_paquete,modulo,iva_pct)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},${ph(9)},
       ${ph(10)},${ph(11)},${ph(12)},${ph(13)},${ph(14)},${ph(15)},${ph(16)},${ph(17)},${ph(18)},${ph(19)},${ph(20)},${ph(21)})`,
      [id, nid(req), codigo||null, codigo_barras||null, nombre, categoria||'General',
       stock||0, stock_min||0, stock_max||null, unidad||'unidades', unidad_compra||null,
       costo||0, precio_venta||0, proveedor_id||null, es_producto||false,
       descripcion||null, margen||null, es_paquete||false, cantidad_paquete||null,
       modulo||'restaurante', parseFloat(iva_pct)||0]
    );
    // Registrar movimiento inicial
    if (stock > 0) {
      await pool.query(
        `INSERT INTO inventario_movimientos (inventario_id,negocio_id,tipo,cantidad,stock_antes,stock_despues,nota,usuario_id)
         VALUES (${ph(1)},${ph(2)},'entrada',${ph(3)},0,${ph(4)},'Stock inicial',${ph(5)})`,
        [id, nid(req), stock, stock, req.user.id]
      );
    }
    res.status(201).json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', requirePermiso('inventario'), async (req, res) => {
  try {
    const { codigo, codigo_barras, nombre, categoria, stock, stock_min, stock_max,
            unidad, unidad_compra, costo, precio_venta, proveedor_id, es_producto, activo,
            descripcion, margen, es_paquete, cantidad_paquete, modulo } = req.body;
    // Si viene stock en el body, crear movimiento de ajuste para mantener trazabilidad
    if (stock !== undefined && stock !== null) {
      const { rows: cur } = await pool.query(
        `SELECT stock FROM inventario WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
        [req.params.id, nid(req)]
      );
      if (cur[0] && parseFloat(cur[0].stock) !== parseFloat(stock)) {
        await pool.query(
          `INSERT INTO inventario_movimientos (inventario_id,negocio_id,tipo,cantidad,stock_antes,stock_despues,nota,usuario_id)
           VALUES (${ph(1)},${ph(2)},'ajuste',${ph(3)},${ph(4)},${ph(5)},'Ajuste desde formulario',${ph(6)})`,
          [req.params.id, nid(req), Math.abs(parseFloat(stock)-parseFloat(cur[0].stock)),
           parseFloat(cur[0].stock), parseFloat(stock), req.user.id]
        );
        await pool.query(
          `UPDATE inventario SET stock=${ph(1)} WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
          [parseFloat(stock), req.params.id, nid(req)]
        );
      }
    }
    await pool.query(
      `UPDATE inventario SET codigo=${ph(1)},codigo_barras=${ph(2)},nombre=${ph(3)},categoria=${ph(4)},stock_min=${ph(5)},
       stock_max=${ph(6)},unidad=${ph(7)},unidad_compra=${ph(8)},costo=${ph(9)},precio_venta=${ph(10)},
       proveedor_id=${ph(11)},es_producto=${ph(12)},activo=${ph(13)},
       descripcion=${ph(14)},margen=${ph(15)},es_paquete=${ph(16)},cantidad_paquete=${ph(17)},
       modulo=${ph(18)},actualizado=NOW()
       WHERE id=${ph(19)} AND negocio_id=${ph(20)}`,
      [codigo||null, codigo_barras||null, nombre, categoria||'General', stock_min||0, stock_max||null,
       unidad||'unidades', unidad_compra||null, costo||0, precio_venta||0, proveedor_id||null,
       es_producto||false, activo!==false,
       descripcion||null, margen||null, es_paquete||false, cantidad_paquete||null,
       modulo||'restaurante', req.params.id, nid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', requirePermiso('inventario_borrar'), async (req, res) => {
  try {
    await pool.query(`UPDATE inventario SET activo=0 WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, nid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Foto de producto
router.post('/:id/foto', uploadFoto.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const url = `/uploads/${req.file.filename}`;
    await pool.query(`UPDATE inventario SET foto_url=${ph(1)} WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
      [url, req.params.id, nid(req)]);
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// MOVIMIENTOS DE STOCK
// ════════════════════════════════════════════════════════════════

router.post('/:id/movimiento', requirePermiso('inventario'), async (req, res) => {
  try {
    const { tipo, cantidad, nota, referencia } = req.body;
    // Obtener stock actual
    const { rows } = await pool.query(
      `SELECT stock FROM inventario WHERE id=${ph(1)} AND negocio_id=${ph(2)}`,
      [req.params.id, nid(req)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });
    const stock_antes = parseFloat(rows[0].stock);
    let stock_despues;
    if (tipo === 'entrada') stock_despues = stock_antes + parseFloat(cantidad);
    else if (tipo === 'salida') stock_despues = Math.max(0, stock_antes - parseFloat(cantidad));
    else stock_despues = parseFloat(cantidad); // ajuste directo

    await pool.query(
      `UPDATE inventario SET stock=${ph(1)}, actualizado=NOW() WHERE id=${ph(2)} AND negocio_id=${ph(3)}`,
      [stock_despues, req.params.id, nid(req)]
    );
    await pool.query(
      `INSERT INTO inventario_movimientos
       (inventario_id,negocio_id,tipo,cantidad,stock_antes,stock_despues,nota,referencia,usuario_id)
       VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},${ph(9)})`,
      [req.params.id, nid(req), tipo, Math.abs(parseFloat(cantidad)),
       stock_antes, stock_despues, nota||null, referencia||null, req.user.id]
    );
    res.json({ ok: true, stock_despues });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/movimientos', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT im.*, u.nombre AS usuario_nombre
      FROM inventario_movimientos im LEFT JOIN usuarios u ON u.id = im.usuario_id
      WHERE im.inventario_id=${ph(1)} AND im.negocio_id=${ph(2)}
      ORDER BY im.creado DESC LIMIT 100
    `, [req.params.id, nid(req)]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Alertas de stock bajo
router.get('/alertas/bajo-stock', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM inventario WHERE negocio_id=${ph(1)} AND activo=1 AND stock>0 AND stock<stock_min ORDER BY nombre`,
      [nid(req)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// EXPORTAR EXCEL
// ════════════════════════════════════════════════════════════════

router.get('/exportar/excel', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT codigo,codigo_barras,nombre,categoria,stock,stock_min,stock_max,unidad,costo,precio_venta,
              es_producto,activo FROM inventario WHERE negocio_id=${ph(1)} AND activo=1 ORDER BY categoria,nombre`,
      [nid(req)]
    );
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows.map(r => ({
      'Código':          r.codigo||'',
      'Código de barras': r.codigo_barras||'',
      'Nombre':         r.nombre,
      'Categoría':      r.categoria,
      'Stock actual':   r.stock,
      'Stock mínimo':   r.stock_min,
      'Stock máximo':   r.stock_max||'',
      'Unidad':         r.unidad,
      'Costo':          r.costo,
      'Precio venta':   r.precio_venta,
      'Es producto':    r.es_producto?'Sí':'No',
    })));
    // Ancho de columnas
    ws['!cols'] = [8,16,30,20,14,14,14,12,14,14,12].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="inventario.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// IMPORTAR EXCEL
// ════════════════════════════════════════════════════════════════

router.post('/importar/excel', requirePermiso('inventario'), uploadExcel.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    let creados = 0, actualizados = 0, errores = [];

    for (const row of rows) {
      try {
        const nombre = row['Nombre'] || row['nombre'];
        if (!nombre) continue;
        const data = {
          codigo:       row['Código']       || row['codigo']       || null,
          codigo_barras: row['Código de barras'] || row['codigo_barras'] || null,
          nombre,
          categoria:    row['Categoría']    || row['categoria']    || 'General',
          stock:        parseFloat(row['Stock actual']  || row['stock']      || 0),
          stock_min:    parseFloat(row['Stock mínimo']  || row['stock_min']  || 0),
          stock_max:    row['Stock máximo'] || row['stock_max']  ? parseFloat(row['Stock máximo']||row['stock_max']) : null,
          unidad:       row['Unidad']       || row['unidad']       || 'unidades',
          costo:        parseFloat(row['Costo']         || row['costo']      || 0),
          precio_venta: parseFloat(row['Precio venta']  || row['precio_venta']|| 0),
          es_producto:  (row['Es producto']||row['es_producto']||'').toLowerCase()==='sí'||
                        (row['Es producto']||'').toLowerCase()==='si'||row['es_producto']===true,
        };
        // Buscar por código o nombre
        const existing = data.codigo
          ? await pool.query(`SELECT id,stock FROM inventario WHERE negocio_id=${ph(1)} AND codigo=${ph(2)}`, [nid(req), data.codigo])
          : await pool.query(`SELECT id,stock FROM inventario WHERE negocio_id=${ph(1)} AND nombre=${ph(2)}`, [nid(req), nombre]);

        if (existing.rows[0]) {
          const ex = existing.rows[0];
          await pool.query(
            `UPDATE inventario SET stock=${ph(1)},stock_min=${ph(2)},stock_max=${ph(3)},
             costo=${ph(4)},precio_venta=${ph(5)},categoria=${ph(6)},unidad=${ph(7)},
             es_producto=${ph(8)},codigo_barras=${ph(9)},actualizado=NOW() WHERE id=${ph(10)}`,
            [data.stock, data.stock_min, data.stock_max, data.costo, data.precio_venta,
             data.categoria, data.unidad, data.es_producto, data.codigo_barras, ex.id]
          );
          actualizados++;
        } else {
          const id = uuid();
          await pool.query(
            `INSERT INTO inventario (id,negocio_id,codigo,codigo_barras,nombre,categoria,stock,stock_min,stock_max,
             unidad,costo,precio_venta,es_producto)
             VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},
             ${ph(9)},${ph(10)},${ph(11)},${ph(12)},${ph(13)})`,
            [id, nid(req), data.codigo, data.codigo_barras, nombre, data.categoria, data.stock,
             data.stock_min, data.stock_max, data.unidad, data.costo, data.precio_venta, data.es_producto]
          );
          creados++;
        }
      } catch (rowErr) {
        errores.push({ fila: row['Nombre']||'?', error: rowErr.message });
      }
    }
    res.json({ ok: true, creados, actualizados, errores });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
