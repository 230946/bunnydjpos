/**
 * BUNNYDJPOS — routes/cumpleanos.js
 * Almacén clave-valor para la app de tarjeta / lista de cumpleaños.
 * Montado bajo /cumpleanos/api, así queda cubierto por el Basic Auth
 * de la tarjeta (CUMPLEANOS_USER / CUMPLEANOS_PASS).
 */
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');

// Claves permitidas (evita que se llene la tabla de basura).
const CLAVES_OK = new Set([
  'empleados_LGF',
  'empleados_POSCO_CUL',
  'lista_mensual',
  'config',
]);

// GET /cumpleanos/api/kv  ->  { clave: valor, ... } con todo lo guardado
router.get('/kv', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT clave, valor FROM cumple_kv');
    const out = {};
    for (const r of rows) {
      try { out[r.clave] = JSON.parse(r.valor); }
      catch { out[r.clave] = r.valor; }
    }
    res.json(out);
  } catch (e) {
    console.error('[cumpleanos] GET /kv', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /cumpleanos/api/kv/:clave   body: cualquier JSON  ->  reemplaza el valor
router.put('/kv/:clave', async (req, res) => {
  try {
    const clave = String(req.params.clave || '');
    if (!CLAVES_OK.has(clave)) return res.status(400).json({ error: 'clave no permitida' });
    const valor = JSON.stringify(req.body === undefined ? null : req.body);
    await pool.query(
      `INSERT INTO cumple_kv (clave, valor) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
      [clave, valor]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[cumpleanos] PUT /kv', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
