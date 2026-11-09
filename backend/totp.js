/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
/**
 * totp.js — códigos de 6 dígitos de una app autenticadora (RFC 6238),
 * compatibles con Google Authenticator, Microsoft Authenticator, Authy, etc.
 */
const crypto = require('crypto');

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PASO_MS = 30 * 1000;

function aBase32(buf) {
  let bits = 0, valor = 0, out = '';
  for (const b of buf) {
    valor = ((valor << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) { out += ALFABETO[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALFABETO[(valor << (5 - bits)) & 31];
  return out;
}

function deBase32(texto) {
  let bits = 0, valor = 0;
  const out = [];
  for (const c of String(texto).toUpperCase().replace(/[\s=]/g, '')) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) continue;
    valor = ((valor << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) { out.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function codigoEnPaso(clave, paso) {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));
  const h = crypto.createHmac('sha1', clave).update(contador).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

function generarSecreto() {
  return aBase32(crypto.randomBytes(20));
}

// Devuelve el paso aceptado (para no aceptar el mismo código dos veces) o null.
// Admite un paso de diferencia por relojes desfasados.
function verificar(secreto, codigo, ultimoPaso, ahora = Date.now()) {
  if (!/^\d{6}$/.test(String(codigo || ''))) return null;
  const clave = deBase32(secreto);
  const actual = Math.floor(ahora / PASO_MS);
  for (const paso of [actual - 1, actual, actual + 1]) {
    if (ultimoPaso != null && paso <= Number(ultimoPaso)) continue;
    const esperado = Buffer.from(codigoEnPaso(clave, paso));
    if (crypto.timingSafeEqual(esperado, Buffer.from(String(codigo)))) return paso;
  }
  return null;
}

function urlOtpauth(secreto, cuenta) {
  const emisor = 'DJPOS';
  return `otpauth://totp/${encodeURIComponent(emisor)}:${encodeURIComponent(cuenta)}` +
    `?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = { generarSecreto, verificar, urlOtpauth, codigoEnPaso, deBase32, aBase32 };
