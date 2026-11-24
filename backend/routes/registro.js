/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * routes/registro.js — autorregistro de negocios desde djmpos.com (/registro).
 *
 * POST /api/registro crea, en una sola transacción, lo mismo que hoy hace el
 * superadmin a mano: el negocio, su rol Administrador, el usuario administrador,
 * el plan elegido y un contrato de PRUEBA GRATIS (activo, DIAS_PRUEBA días).
 *
 * El bloqueo no necesita código nuevo: las pantallas ya leen el contrato desde
 * /api/negocio-pub. Durante los últimos 5 días muestran el aviso de vencimiento,
 * y al vencer el contrato pasa a "pendiente por renovación" y la pantalla se
 * bloquea. Para activar el negocio, el superadmin le registra un contrato real.
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { pool } = require('../db');
const { limitePorIp } = require('../middleware/limites');
const { enviarBienvenidaRegistro } = require('../mailer');

const DIAS_PRUEBA = 15;
const TIPOS  = ['restaurante', 'bar', 'minimercado', 'peluqueria'];
const PLANES = ['basic', 'plus', 'premium'];

// Marca los contratos de prueba para que la pantalla no hable de "factura".
let migrado = false;
async function migrar() {
  if (migrado) return;
  try {
    await pool.query(`ALTER TABLE neg_contratos ADD COLUMN prueba TINYINT(1) NOT NULL DEFAULT 0`, [], { silent: true });
  } catch (e) {
    if (e.code !== 'ER_DUP_FIELDNAME') throw e;
  }
  migrado = true;
}
setTimeout(() => migrar().catch(() => {}), 5000);   // neg_contratos la crea superadmin.js al arrancar

const txt = (v, max) => String(v ?? '').trim().slice(0, max);
const fechaBogota = (dias = 0) =>
  new Date(Date.now() + dias * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

// 10 intentos por hora por IP: suficiente para un humano con errores, corta los bots.
router.post('/', limitePorIp(10, 60 * 60 * 1000), async (req, res) => {
  try {
    const b = req.body || {};
    if (b.sitio) return res.status(400).json({ error: 'No se pudo completar el registro.' }); // campo trampa

    const negocio = {
      nombre:   txt(b.negocio?.nombre, 120),
      tipo:     txt(b.negocio?.tipo, 30),
      ciudad:   txt(b.negocio?.ciudad, 80),
      telefono: txt(b.negocio?.telefono, 30),
      nit:      txt(b.negocio?.nit, 30),
    };
    const admin = {
      nombre:   txt(b.admin?.nombre, 120),
      email:    txt(b.admin?.email, 120).toLowerCase(),
      username: txt(b.admin?.username, 40).toLowerCase(),
      password: String(b.admin?.password ?? ''),
    };
    const plan = txt(b.plan, 20);

    const err = m => res.status(400).json({ error: m });
    if (!TIPOS.includes(negocio.tipo))  return err('Elige el tipo de negocio.');
    if (!PLANES.includes(plan))         return err('Elige un plan.');
    if (negocio.nombre.length < 2)      return err('Escribe el nombre del negocio.');
    if (!/^[0-9+ ()-]{7,30}$/.test(negocio.telefono)) return err('Escribe un teléfono válido.');
    if (admin.nombre.length < 2)        return err('Escribe tu nombre.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(admin.email)) return err('Escribe un correo válido.');
    if (admin.username && !/^[a-z0-9._-]{3,40}$/.test(admin.username))
      return err('El usuario solo puede tener letras, números, punto, guion y guion bajo (3 a 40).');
    if (admin.password.length < 8 || !/[a-zA-Z]/.test(admin.password) || !/\d/.test(admin.password))
      return err('La contraseña debe tener al menos 8 caracteres, con letras y números.');
    if (b.acepta !== true) return err('Debes aceptar los términos para continuar.');

    const { rows: ya } = await pool.query(
      `SELECT email, username FROM usuarios WHERE email=? OR username=? OR (? <> '' AND (username=? OR email=?)) LIMIT 1`,
      [admin.email, admin.email, admin.username, admin.username, admin.username]);
    if (ya.length) {
      return res.status(409).json({
        error: ya[0].email === admin.email
          ? 'Ese correo ya tiene una cuenta en DJPOS. Ingresa con él o usa "¿Olvidaste tu contraseña?".'
          : 'Ese usuario ya existe. Elige otro.',
      });
    }

    await migrar();
    const hash = await bcrypt.hash(admin.password, 12);
    const negocioId = uuid(), rolId = uuid(), usuarioId = uuid(), contratoId = uuid();
    const hoy = fechaBogota(), fin = fechaBogota(DIAS_PRUEBA);
    const permisos = JSON.stringify({
      pos_mesas: true, pos_menu: true, pos_cocina: true, pos_cobro: true,
      inventario: true, reportes: true, gastos: true, horarios: true,
      personal: true, minimercado: true, proveedores: true, facturacion: true,
    });
    const nota = `Prueba gratis de ${DIAS_PRUEBA} días (autorregistro desde djmpos.com)`;

    await pool.transaction(async q => {
      await q(`INSERT INTO negocios (id,nombre,tipo,nit,ciudad,telefono,email,idiomas,moneda,zona_horaria)
               VALUES (?,?,?,?,?,?,?,'["es"]','COP','America/Bogota')`,
        [negocioId, negocio.nombre, negocio.tipo, negocio.nit || null, negocio.ciudad || null, negocio.telefono, admin.email]);
      await q(`INSERT INTO roles (id,negocio_id,nombre,descripcion,es_sistema,permisos)
               VALUES (?,?,'Administrador','Acceso completo al negocio',1,?)`, [rolId, negocioId, permisos]);
      await q(`INSERT INTO usuarios (id,negocio_id,rol_id,nombre,email,username,password_hash)
               VALUES (?,?,?,?,?,?,?)`,
        [usuarioId, negocioId, rolId, admin.nombre, admin.email, admin.username || null, hash]);
      await q(`INSERT INTO neg_contratos (id,negocio_id,numero,tipo,plan,valor,fecha_inicio,fecha_fin,estado,notas,prueba)
               VALUES (?,?,?,'mensual',?,0,?,?,'activo',?,1)`,
        [contratoId, negocioId, 'PRUEBA-' + negocioId.slice(0, 8).toUpperCase(), plan, hoy, fin, nota]);
      await q(`INSERT INTO neg_planes (negocio_id,plan,precio,fecha_inicio,fecha_fin,notas) VALUES (?,?,0,?,?,?)
               ON DUPLICATE KEY UPDATE plan=VALUES(plan),fecha_inicio=VALUES(fecha_inicio),fecha_fin=VALUES(fecha_fin),notas=VALUES(notas)`,
        [negocioId, plan, hoy, fin, nota]);
    });

    pool.query(
      `INSERT INTO platform_log (negocio_id,negocio_nombre,usuario_id,usuario_nombre,accion,detalle,ip) VALUES (?,?,?,?,?,?,?)`,
      [negocioId, negocio.nombre, usuarioId, admin.nombre, 'autorregistro',
       `${negocio.nombre} (${negocio.tipo}, plan ${plan}) — ${admin.email} — prueba hasta ${fin}`, req.ip]
    ).catch(() => {});

    const login = admin.username || admin.email;
    enviarBienvenidaRegistro({ to: admin.email, nombre: admin.nombre, negocio: negocio.nombre, login, diasPrueba: DIAS_PRUEBA })
      .catch(e => console.error('[registro] correo de bienvenida:', e.message));

    res.status(201).json({ ok: true, negocio_id: negocioId, tipo: negocio.tipo, login, prueba_hasta: fin, dias_prueba: DIAS_PRUEBA });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ese correo o usuario ya existe. Elige otro.' });
    console.error('[registro]', e.message);
    res.status(500).json({ error: 'No se pudo crear el negocio. Intenta de nuevo en unos minutos.' });
  }
});

router.get('/info', (_, res) => res.json({ dias_prueba: DIAS_PRUEBA }));

module.exports = router;
