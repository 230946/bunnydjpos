/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * middleware/limites.js
 * Límites de intentos en memoria, para rutas públicas de autenticación.
 */
const MAX_REGISTROS = 10000;
const MSG_LIMITE = 'Demasiados intentos. Espera unos minutos e intenta de nuevo.';

// Detrás del proxy, la conexión directa llega desde localhost y la IP real es
// el último valor de X-Forwarded-For. Solo se le cree en ese caso: si la
// conexión llega directa, el encabezado lo pudo escribir el propio cliente.
function ipCliente(req) {
  const directa = req.socket.remoteAddress || '';
  if (/^(::ffff:)?127\.|^::1$/.test(directa)) {
    const reenviada = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (reenviada) return reenviada;
  }
  return directa;
}

function crearContador(ventanaMs) {
  const registros = new Map(); // clave → { n, hasta }
  function limpiar(ahora) {
    if (registros.size < MAX_REGISTROS) return;
    for (const [k, v] of registros) if (v.hasta < ahora) registros.delete(k);
    for (const k of registros.keys()) {
      if (registros.size < MAX_REGISTROS) break;
      registros.delete(k);
    }
  }
  return {
    sumar(clave) {
      const ahora = Date.now();
      limpiar(ahora);
      let r = registros.get(clave);
      if (!r || r.hasta < ahora) { r = { n: 0, hasta: ahora + ventanaMs }; registros.set(clave, r); }
      return ++r.n;
    },
    restar(clave) {
      const r = registros.get(clave);
      if (r && r.n > 0) r.n--;
    },
    borrar(clave) { registros.delete(clave); },
  };
}

// Limita todas las peticiones a una ruta por IP.
function limitePorIp(max, ventanaMs) {
  const contador = crearContador(ventanaMs);
  return (req, res, next) => {
    if (contador.sumar(`${req.path}|${ipCliente(req)}`) > max) {
      return res.status(429).json({ error: MSG_LIMITE, message: MSG_LIMITE });
    }
    next();
  };
}

// Limita intentos fallidos de login por cuenta+IP y por IP.
// No hay tope por cuenta sola: permitiría que cualquiera bloqueara a su dueño.
// El intento se cuenta antes de comprobar la clave para que varias peticiones
// simultáneas no se salten el límite, y exito() lo descuenta si era correcta.
function crearLimiteLogin({ maxCuenta = 8, maxIp = 30, ventanaMs = 15 * 60 * 1000 } = {}) {
  const contador = crearContador(ventanaMs);
  // MySQL compara sin distinguir mayúsculas ni espacios finales: "Ana" y "ana "
  // son la misma cuenta y deben sumar en el mismo contador.
  const claves = (req, cuenta) => {
    const ip = ipCliente(req);
    return { ip: `ip|${ip}`, cuenta: `c|${ip}|${String(cuenta).trim().toLowerCase().slice(0, 200)}` };
  };
  return {
    MSG: MSG_LIMITE,
    registrar(req, cuenta) {
      const k = claves(req, cuenta);
      const nCuenta = contador.sumar(k.cuenta);
      const nIp = contador.sumar(k.ip);
      return nCuenta <= maxCuenta && nIp <= maxIp;
    },
    exito(req, cuenta) {
      const k = claves(req, cuenta);
      contador.borrar(k.cuenta);
      contador.restar(k.ip);
    },
  };
}

module.exports = { ipCliente, limitePorIp, crearLimiteLogin };
