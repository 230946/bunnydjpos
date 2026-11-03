/**
 * BUNNYDJPOS — routes/atril.js
 * Almacén de PDFs y notas del lector Atril, para verlos en todos los dispositivos.
 * Se entra con el login de DJMPOS (JWT) y cada usuario tiene su propia carpeta
 * en disco (ATRIL_DIR/<usuario_id>), fuera de /uploads para que los PDFs no
 * queden públicos: <id>.pdf + <id>.json con las notas. También genera con
 * Claude la conclusión de lo leído (POST /docs/:id/conclusion).
 */
const express = require('express');
const fs      = require('fs');
const fsp     = fs.promises;
const path    = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { authMiddleware } = require('../middleware/auth');
const router  = express.Router();
const anthropic = new Anthropic();

const DIR = process.env.ATRIL_DIR || path.join(__dirname, '..', 'atril-data');
const MAX_BYTES = 300 * 1024 * 1024;

router.use(authMiddleware);
router.use(async (req, res, next) => {
  const carpeta = String(req.user?.id || '').replace(/[^a-zA-Z0-9-]/g, '');
  if (!carpeta) return res.status(401).json({ error: 'Usuario inválido' });
  req.dirAtril = path.join(DIR, carpeta);
  try { await fsp.mkdir(req.dirAtril, { recursive: true }); next(); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

const rutaPdf  = (req, id) => path.join(req.dirAtril, id + '.pdf');
const rutaMeta = (req, id) => path.join(req.dirAtril, id + '.json');

router.param('id', (req, res, next, id) =>
  /^[a-z0-9]{6,40}$/.test(id) ? next() : res.status(400).json({ error: 'id inválido' }));

// GET /atril/api/docs  ->  [meta, ...] de los PDFs que ya terminaron de subir
router.get('/docs', async (req, res) => {
  try {
    const out = [];
    for (const n of await fsp.readdir(req.dirAtril)) {
      if (!n.endsWith('.json')) continue;
      const id = n.slice(0, -5);
      try {
        await fsp.access(rutaPdf(req, id));
        out.push(JSON.parse(await fsp.readFile(rutaMeta(req, id), 'utf8')));
      } catch { /* sin PDF o JSON dañado: se omite */ }
    }
    res.json(out);
  } catch (e) {
    console.error('[atril] GET /docs', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/docs/:id/meta', async (req, res) => {
  try { res.json(JSON.parse(await fsp.readFile(rutaMeta(req, req.params.id), 'utf8'))); }
  catch { res.status(404).json({ error: 'no existe' }); }
});

// PUT /atril/api/docs/:id/meta   body: meta completo (notas, resaltados, progreso)
router.put('/docs/:id/meta', async (req, res) => {
  const { id } = req.params;
  const m = req.body;
  if (!m || typeof m !== 'object' || m.id !== id) return res.status(400).json({ error: 'meta inválido' });
  try {
    await fsp.access(rutaPdf(req, id));
  } catch {
    return res.status(409).json({ error: 'primero se debe subir el PDF' });
  }
  try {
    const tmp = rutaMeta(req, id) + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(m));
    await fsp.rename(tmp, rutaMeta(req, id));
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
  const tmp = rutaPdf(req, id) + '.parcial';
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
      await fsp.rename(tmp, rutaPdf(req, id));
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[atril] PUT file', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/docs/:id/file', (req, res) => {
  res.sendFile(rutaPdf(req, req.params.id), { headers: { 'Content-Type': 'application/pdf' } }, err => {
    if (err && !res.headersSent) res.status(404).json({ error: 'no existe' });
  });
});

// POST /atril/api/docs/:id/conclusion   body: { nombre, desde, hasta, texto, resaltados: [{page, text, note}] }
// Claude lee el texto de las páginas leídas (lo extrae el navegador con pdf.js)
// y devuelve las ideas más importantes y una conclusión. El navegador puede
// mandar el cuerpo comprimido con gzip; express.json lo descomprime.
const MAX_TEXTO = 600000;   // ~150 mil tokens
const enCurso = new Set();   // una conclusión a la vez por usuario
router.post('/docs/:id/conclusion', async (req, res) => {
  const { nombre, desde, hasta, texto, resaltados } = req.body || {};
  if (typeof texto !== 'string' || !texto.trim()) return res.status(400).json({ error: 'No hay texto para analizar en esas páginas.' });
  if (texto.length > MAX_TEXTO) return res.status(413).json({ error: 'El rango es demasiado largo. Elige menos páginas.' });
  const usuario = req.dirAtril;
  if (enCurso.has(usuario)) return res.status(429).json({ error: 'Ya se está preparando una conclusión. Espera a que termine.' });
  enCurso.add(usuario);
  try {
    const notas = (Array.isArray(resaltados) ? resaltados : []).slice(0, 300)
      .map(h => `- (p. ${Number(h.page) + 1}) «${String(h.text || '').slice(0, 600)}»${h.note ? ` — nota del estudiante: ${String(h.note).slice(0, 600)}` : ''}`)
      .join('\n');
    const stream = anthropic.beta.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: 'Eres un tutor que ayuda a una persona a estudiar. Escribe en español latino, claro y directo, '
        + 'como en unos buenos apuntes. Basa todo solo en el texto que recibes; si algo no está en el texto, no lo inventes. '
        + 'Los resaltados y notas del estudiante muestran lo que le pareció importante: tenlos en cuenta.\n\n'
        + 'Responde con este formato exacto, sin nada antes ni después:\n'
        + '## Idea central\n(2 o 3 frases)\n'
        + '## Lo más importante\n(entre 4 y 8 viñetas que empiecen con "- ")\n'
        + '## Conceptos para recordar\n(viñetas "- Concepto: definición breve")\n'
        + '## Conclusión\n(un párrafo que integre todo)\n'
        + '## Preguntas de repaso\n(3 viñetas con preguntas para autoevaluarse)',
      messages: [{
        role: 'user',
        content: `Documento: ${String(nombre || 'PDF').slice(0, 200)}\nPáginas leídas: ${Number(desde) + 1} a ${Number(hasta) + 1}\n\n`
          + (notas ? `<resaltados>\n${notas}\n</resaltados>\n\n` : '')
          + `<texto>\n${texto}\n</texto>\n\nSaca la conclusión total de lo más importante de esta lectura.`,
      }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') return res.status(422).json({ error: 'No se pudo generar una conclusión para este texto.' });
    const conclusion = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!conclusion) return res.status(502).json({ error: 'La respuesta llegó vacía. Intenta de nuevo.' });
    res.json({ conclusion });
  } catch (e) {
    console.error('[atril] conclusion', e.status || '', e.message);
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'Hay mucha demanda en este momento. Intenta en un minuto.' });
    if (e instanceof Anthropic.AuthenticationError) return res.status(503).json({ error: 'El servidor no tiene configurada la clave de IA.' });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ error: 'El servicio de IA falló. Intenta de nuevo.' });
    res.status(500).json({ error: 'No se pudo generar la conclusión.' });
  } finally {
    enCurso.delete(usuario);
  }
});

router.delete('/docs/:id', async (req, res) => {
  const { id } = req.params;
  for (const f of [rutaPdf(req, id), rutaMeta(req, id), rutaPdf(req, id) + '.parcial']) {
    await fsp.unlink(f).catch(() => {});
  }
  res.json({ ok: true });
});

module.exports = router;
