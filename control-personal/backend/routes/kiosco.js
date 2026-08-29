/**
 * routes/kiosco.js — Endpoint público (sin login) para el dispositivo/tablet
 * de la entrada. El código QR personal de cada empleado hace las veces de
 * credencial (es un valor aleatorio, no su documento), igual que un carné físico.
 */
const router = require('express').Router();
const { pool } = require('../db');
const { registrarFichaje, siguienteAccion } = require('../lib/fichar');

// Un solo escaneo: el kiosco no pregunta "entrada o salida", lo decide el
// backend según lo que ya tenga registrado el empleado hoy. El único punto
// ambiguo es justo después de la entrada (¿sale a pausa o ya se va?) — ahí
// se devuelven `opciones` para que el kiosco muestre dos botones; la segunda
// llamada incluye `accion` explícita para confirmar cuál eligió la persona.
router.post('/marcar', async (req, res) => {
  try {
    const { codigo_qr, accion: accionElegida } = req.body;
    if (!codigo_qr) return res.status(400).json({ error: 'codigo_qr requerido' });

    const { rows } = await pool.query(
      `SELECT id, nombre FROM usuarios WHERE codigo_qr=? AND activo=1`, [codigo_qr]
    );
    const usuario = rows[0];
    if (!usuario) return res.status(404).json({ error: 'Código no reconocido' });

    const siguiente = await siguienteAccion(usuario.id);

    if (accionElegida) {
      // Confirmando una elección: debe coincidir con una de las opciones vigentes.
      if (!siguiente.opciones?.includes(accionElegida)) {
        return res.status(409).json({ error: 'Esa opción ya no es válida, vuelve a escanear' });
      }
      const resultado = await registrarFichaje(usuario.id, accionElegida);
      return res.json({ ok: true, accion: accionElegida, nombre: usuario.nombre, ...resultado });
    }

    if (siguiente.opciones) {
      return res.json({ eleccion: true, nombre: usuario.nombre, opciones: siguiente.opciones, pausa_tipo: siguiente.pausa_tipo });
    }
    if (!siguiente.accion) return res.status(409).json({ error: `${usuario.nombre} ya completó su jornada de hoy` });

    const resultado = await registrarFichaje(usuario.id, siguiente.accion);
    res.json({ ok: true, accion: siguiente.accion, nombre: usuario.nombre, ...resultado });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

module.exports = router;
