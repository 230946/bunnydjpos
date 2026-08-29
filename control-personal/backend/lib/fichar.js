const { v4: uuid } = require('uuid');
const { pool } = require('../db');

// Fecha/hora "de hoy" en America/Bogota (UTC-5), consistente con el resto
// del backend (misma técnica de desplazar el reloj del servidor 5h).
function ahoraBogota() { return new Date(Date.now() - 5 * 60 * 60 * 1000); }
function hoyStr() {
  const d = ahoraBogota();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

const ACCIONES = ['entrada', 'pausa_inicio', 'pausa_fin', 'salida'];

// Usada tanto por el fichaje autenticado (el propio empleado, /fichajes/marcar)
// como por el kiosco de QR (/kiosco/marcar, sin login — identifica al empleado
// por su codigo_qr en vez de por el JWT). Secuencia de un día:
// entrada → (opcional) pausa_inicio → pausa_fin → salida.
async function registrarFichaje(usuario_id, accion) {
  if (!ACCIONES.includes(accion)) { const e = new Error(`accion debe ser una de: ${ACCIONES.join(', ')}`); e.status = 400; throw e; }

  const fecha = hoyStr();
  const { rows: existentes } = await pool.query(
    `SELECT * FROM fichajes WHERE usuario_id=? AND fecha=?`, [usuario_id, fecha]
  );
  const fichaje = existentes[0];

  if (accion === 'entrada') {
    if (fichaje?.hora_entrada_real) { const e = new Error('Ya marcó la entrada hoy'); e.status = 409; throw e; }

    const { rows: h } = await pool.query(
      `SELECT turno_id FROM horario_asignado WHERE usuario_id=? AND fecha=?`, [usuario_id, fecha]
    );
    const turno_id = h[0]?.turno_id || null;

    let tardanza = 0;
    if (turno_id) {
      const { rows: t } = await pool.query(`SELECT hora_inicio FROM turnos WHERE id=?`, [turno_id]);
      if (t[0]) {
        const horaActual = ahoraBogota().toISOString().slice(11, 19);
        tardanza = horaActual > t[0].hora_inicio ? 1 : 0;
      }
    }

    if (fichaje) {
      await pool.query(`UPDATE fichajes SET hora_entrada_real=NOW(), turno_id=?, tardanza=? WHERE id=?`, [turno_id, tardanza, fichaje.id]);
    } else {
      await pool.query(
        `INSERT INTO fichajes (id, usuario_id, fecha, turno_id, hora_entrada_real, tardanza) VALUES (?,?,?,?,NOW(),?)`,
        [uuid(), usuario_id, fecha, turno_id, tardanza]
      );
    }
    return { tardanza: !!tardanza };
  }

  if (accion === 'pausa_inicio') {
    if (!fichaje?.hora_entrada_real) { const e = new Error('Aún no ha marcado la entrada hoy'); e.status = 409; throw e; }
    if (fichaje.hora_salida_real) { const e = new Error('Ya marcó la salida hoy'); e.status = 409; throw e; }
    if (fichaje.pausa_inicio_real && !fichaje.pausa_fin_real) { const e = new Error('Ya está en su pausa'); e.status = 409; throw e; }
    if (fichaje.pausa_fin_real) { const e = new Error('Ya registró su pausa de hoy'); e.status = 409; throw e; }

    const { rows: h } = await pool.query(
      `SELECT pausa_tipo FROM horario_asignado WHERE usuario_id=? AND fecha=?`, [usuario_id, fecha]
    );
    await pool.query(`UPDATE fichajes SET pausa_inicio_real=NOW() WHERE id=?`, [fichaje.id]);
    return { pausa_tipo: h[0]?.pausa_tipo || null };
  }

  if (accion === 'pausa_fin') {
    if (!fichaje?.pausa_inicio_real) { const e = new Error('Aún no ha marcado el inicio de su pausa'); e.status = 409; throw e; }
    if (fichaje.pausa_fin_real) { const e = new Error('Ya marcó el regreso de su pausa'); e.status = 409; throw e; }

    await pool.query(
      `UPDATE fichajes SET pausa_fin_real=NOW(),
         duracion_pausa_min = TIMESTAMPDIFF(MINUTE, pausa_inicio_real, NOW())
       WHERE id=?`,
      [fichaje.id]
    );
    const { rows: actualizado } = await pool.query(`SELECT duracion_pausa_min FROM fichajes WHERE id=?`, [fichaje.id]);
    const { rows: h } = await pool.query(
      `SELECT pausa_tipo FROM horario_asignado WHERE usuario_id=? AND fecha=?`, [usuario_id, fecha]
    );
    return { duracion_pausa_min: actualizado[0]?.duracion_pausa_min, pausa_tipo: h[0]?.pausa_tipo || null };
  }

  // accion === 'salida'
  if (!fichaje?.hora_entrada_real) { const e = new Error('Aún no ha marcado la entrada hoy'); e.status = 409; throw e; }
  if (fichaje.hora_salida_real) { const e = new Error('Ya marcó la salida hoy'); e.status = 409; throw e; }
  if (fichaje.pausa_inicio_real && !fichaje.pausa_fin_real) { const e = new Error('Aún no ha marcado el regreso de su pausa'); e.status = 409; throw e; }

  await pool.query(
    `UPDATE fichajes SET hora_salida_real=NOW(),
       horas_trabajadas = ROUND((TIMESTAMPDIFF(MINUTE, hora_entrada_real, NOW()) - COALESCE(duracion_pausa_min,0))/60, 2)
     WHERE id=?`,
    [fichaje.id]
  );
  const { rows: actualizado } = await pool.query(`SELECT horas_trabajadas FROM fichajes WHERE id=?`, [fichaje.id]);
  return { horas_trabajadas: actualizado[0]?.horas_trabajadas };
}

// Para el kiosco (un solo escaneo, sin elegir acción de entrada): decide la
// siguiente acción lógica. Solo es ambigua justo después de la entrada, ya
// que ahí no se puede saber si la persona va a salir a pausa o a terminar su
// jornada — en ese caso se devuelven las opciones para que el kiosco pregunte.
async function siguienteAccion(usuario_id) {
  const { rows } = await pool.query(
    `SELECT hora_entrada_real, pausa_inicio_real, pausa_fin_real, hora_salida_real
     FROM fichajes WHERE usuario_id=? AND fecha=?`,
    [usuario_id, hoyStr()]
  );
  const f = rows[0];
  if (!f || !f.hora_entrada_real) return { accion: 'entrada' };
  if (f.hora_salida_real) return { accion: null };
  if (f.pausa_inicio_real && !f.pausa_fin_real) return { accion: 'pausa_fin' };
  if (!f.pausa_inicio_real) {
    const { rows: h } = await pool.query(
      `SELECT pausa_tipo FROM horario_asignado WHERE usuario_id=? AND fecha=?`, [usuario_id, hoyStr()]
    );
    return { accion: null, opciones: ['pausa_inicio', 'salida'], pausa_tipo: h[0]?.pausa_tipo || null };
  }
  return { accion: 'salida' };
}

module.exports = { registrarFichaje, siguienteAccion, hoyStr, ahoraBogota };
