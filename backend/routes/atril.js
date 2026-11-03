/**
 * BUNNYDJPOS — routes/atril.js
 * Almacén de PDFs y notas del lector Atril, para verlos en todos los dispositivos.
 * Montado bajo /atril/api, así queda cubierto por el Basic Auth de Atril
 * (ATRIL_USER / ATRIL_PASS). Guarda en disco (ATRIL_DIR), fuera de /uploads
 * para que los PDFs no queden públicos: <id>.pdf + <id>.json con las notas.
 */
const express = require('express');
const fs      = require('fs');
const fsp     = fs.promises;
const path    = require('path');
const router  = express.Router();

const DIR = process.env.ATRIL_DIR || path.join(__dirname, '..', 'atril-data');
const MAX_BYTES = 300 * 1024 * 1024;
fs.mkdirSync(DIR, { recursive: true });

const rutaPdf  = id => path.join(DIR, id + '.pdf');
const rutaMeta = id => path.join(DIR, id + '.json');

router.param('id', (req, res, next, id) =>
  /^[a-z0-9]{6,40}$/.test(id) ? next() : res.status(400).json({ error: 'id inválido' }));

// GET /atril/api/docs  ->  [meta, ...] de los PDFs que ya terminaron de subir
router.get('/docs', async (_req, res) => {
  try {
    const out = [];
    for (const n of await fsp.readdir(DIR)) {
      if (!n.endsWith('.json')) continue;
      const id = n.slice(0, -5);
      try {
        await fsp.access(rutaPdf(id));
        out.push(JSON.parse(await fsp.readFile(rutaMeta(id), 'utf8')));
      } catch { /* sin PDF o JSON dañado: se omite */ }
    }
    res.json(out);
  } catch (e) {
    console.error('[atril] GET /docs', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/docs/:id/meta', async (req, res) => {
  try { res.json(JSON.parse(await fsp.readFile(rutaMeta(req.params.id), 'utf8'))); }
  catch { res.status(404).json({ error: 'no existe' }); }
});

// PUT /atril/api/docs/:id/meta   body: meta completo (notas, resaltados, progreso)
router.put('/docs/:id/meta', async (req, res) => {
  const { id } = req.params;
  const m = req.body;
  if (!m || typeof m !== 'object' || m.id !== id) return res.status(400).json({ error: 'meta inválido' });
  try {
    await fsp.access(rutaPdf(id));
  } catch {
    return res.status(409).json({ error: 'primero se debe subir el PDF' });
  }
  try {
    const tmp = rutaMeta(id) + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(m));
    await fsp.rename(tmp, rutaMeta(id));
    res.json({ ok: true });
  } catch (e) {
    console.error('[atril] PUT meta', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /atril/api/docs/:id/file?parte=N&total=M&desde=BYTES   body: trozo binario
// Se sube por partes (< 1 MB) para no chocar con el límite de cuerpo de Nginx.
// `desde` hace que reintentar una parte sea seguro: se recorta el archivo ahí.
router.put('/docs/:id/file', async (req, res) => {
  const { id } = req.params;
  const parte = Number(req.query.parte), total = Number(req.query.total), desde = Number(req.query.desde);
  if (![parte, total, desde].every(Number.isInteger) || parte < 0 || parte >= total || total > 1000 || desde < 0) {
    return res.status(400).json({ error: 'parte inválida' });
  }
  const tmp = rutaPdf(id) + '.parcial';
  try {
    if (parte > 0) {
      const st = await fsp.stat(tmp);
      if (st.size < desde) return res.status(409).json({ error: 'faltan partes anteriores' });
      if (st.size > desde) await fsp.truncate(tmp, desde);
    }
    if (desde + Number(req.headers['content-length'] || 0) > MAX_BYTES) {
      return res.status(413).json({ error: 'el PDF supera 300 MB' });
    }
    await new Promise((ok, fail) => {
      const out = fs.createWriteStream(tmp, { flags: parte === 0 ? 'w' : 'a' });
      req.pipe(out);
      out.on('finish', ok);
      out.on('error', fail);
      req.on('error', fail);
    });
    if (parte === total - 1) {
      const fh = await fsp.open(tmp, 'r');
      const { buffer } = await fh.read(Buffer.alloc(5), 0, 5, 0);
      await fh.close();
      if (buffer.toString('latin1') !== '%PDF-') {
        await fsp.unlink(tmp).catch(() => {});
        return res.status(400).json({ error: 'el archivo no es un PDF' });
      }
      await fsp.rename(tmp, rutaPdf(id));
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[atril] PUT file', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/docs/:id/file', (req, res) => {
  res.sendFile(rutaPdf(req.params.id), { headers: { 'Content-Type': 'application/pdf' } }, err => {
    if (err && !res.headersSent) res.status(404).json({ error: 'no existe' });
  });
});

router.delete('/docs/:id', async (req, res) => {
  const { id } = req.params;
  for (const f of [rutaPdf(id), rutaMeta(id), rutaPdf(id) + '.parcial']) {
    await fsp.unlink(f).catch(() => {});
  }
  res.json({ ok: true });
});

module.exports = router;
