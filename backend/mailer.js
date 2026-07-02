const nodemailer = require('nodemailer');

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || SMTP_USER.includes('tucorreo')) {
    return null;
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587'),
    secure: parseInt(SMTP_PORT || '587') === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

const MONEDA_LOCALE = { COP: 'es-CO', CRC: 'es-CR', USD: 'en-US', MXN: 'es-MX', PEN: 'es-PE' };

function buildReciboHtml(v, cf, moneda = 'COP') {
  const fmt = n => new Intl.NumberFormat(MONEDA_LOCALE[moneda] || 'es-CO', { style: 'currency', currency: moneda, minimumFractionDigits: 0 }).format(Math.round(+n) || 0);
  const items = Array.isArray(v.items) ? v.items : [];
  const ef = +v.monto_efectivo || 0, ta = +v.monto_tarjeta || 0, ne = +v.monto_nequi || 0;
  const labels = { efectivo: '💵 Efectivo', tarjeta: '💳 Tarjeta', nequi: '📱 QR/Nequi' };
  const activos = [[ef,'efectivo'],[ta,'tarjeta'],[ne,'nequi']].filter(([v])=>v>0);
  const metStr = activos.length === 1
    ? labels[activos[0][1]]
    : activos.map(([val,k]) => `${labels[k]}: ${fmt(val)}`).join(' / ');
  const dt = new Date(v.creado);
  const fecha = dt.toLocaleDateString('es-CO', { day:'2-digit', month:'2-digit', year:'numeric' });
  const hora  = dt.toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' });
  const tipoDoc = (cf.tipoDoc || 'Factura').charAt(0).toUpperCase() + (cf.tipoDoc || 'Factura').slice(1);
  const total = +v.total, recibido = +v.recibido || 0, cambio = +v.cambio || 0;
  const mostrarIva = cf.togIva !== false && +v.iva > 0;

  const row = (l, r) => `<tr><td style="padding:4px 8px;color:#666">${l}</td><td style="padding:4px 8px;text-align:right;font-weight:500">${r}</td></tr>`;
  const hr = () => `<tr><td colspan="2"><hr style="border:none;border-top:1px dashed #ccc;margin:6px 0"></td></tr>`;

  let rows = '';

  // Cliente primero
  if (v.cliente_nombre) {
    rows += row('Cliente', v.cliente_nombre);
    if (v.cliente_doc)   rows += row('Doc.',   v.cliente_doc);
    if (v.cliente_tel)   rows += row('Tel.',   v.cliente_tel);
    if (v.cliente_email) rows += row('Email',  v.cliente_email);
    if (v.cliente_dir)   rows += row('Dir.',   v.cliente_dir);
    const loc = [v.cliente_ciudad, v.cliente_depto].filter(Boolean).join(', ');
    if (loc) rows += row('Ciudad', loc);
    rows += hr();
  }

  // Datos de factura
  rows += `<tr><td style="padding:4px 8px;font-weight:700">${tipoDoc}</td><td style="padding:4px 8px;text-align:right;font-weight:700">${v.numero_factura || '—'}</td></tr>`;
  rows += row(fecha, hora);
  if (v.mesa_num) rows += row('Mesa', v.mesa_num);
  rows += row('Pago', metStr);
  if (v.cajero_nombre) rows += `<tr><td style="padding:4px 8px;color:#999">Cajero</td><td style="padding:4px 8px;text-align:right;color:#999">${v.cajero_nombre}</td></tr>`;
  rows += hr();

  // Items
  items.forEach(i => {
    const sub = fmt((+i.precio) * (+i.qty));
    rows += `<tr><td style="padding:4px 8px">${i.nombre}${+i.qty > 1 ? ` <span style="color:#999;font-size:11px">(${i.qty}×${fmt(+i.precio)})</span>` : ''}</td><td style="padding:4px 8px;text-align:right">${sub}</td></tr>`;
  });
  rows += hr();

  if (mostrarIva) {
    rows += row('Subtotal', fmt(+v.subtotal));
    rows += `<tr><td style="padding:4px 8px;color:#666">IVA ${cf.iva}%</td><td style="padding:4px 8px;text-align:right;color:#666">${fmt(+v.iva)}</td></tr>`;
  }
  rows += `<tr style="font-size:15px"><td style="padding:6px 8px;font-weight:700">TOTAL</td><td style="padding:6px 8px;text-align:right;font-weight:700">${fmt(total)}</td></tr>`;
  if (ef > 0 && recibido > 0) {
    rows += hr();
    rows += row('Recibido ef.', fmt(recibido));
    rows += `<tr><td style="padding:4px 8px;color:#1D9E75;font-weight:600">Cambio</td><td style="padding:4px 8px;text-align:right;color:#1D9E75;font-weight:600">${fmt(cambio)}</td></tr>`;
  }
  if (cf.gracias) rows += `<tr><td colspan="2" style="text-align:center;padding:10px 8px 4px;font-style:italic;color:#666">${cf.gracias}</td></tr>`;
  if (cf.footer)  rows += `<tr><td colspan="2" style="text-align:center;padding:2px 8px 8px;font-size:11px;color:#999">${cf.footer}</td></tr>`;

  const negocioNombre = cf.nombre || 'BUNNYDJPOS';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0">
  <tr><td align="center">
    <table width="360" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
      <tr style="background:#C0392B"><td style="padding:18px;text-align:center;color:#fff">
        <div style="font-size:18px;font-weight:700">${negocioNombre}</div>
        ${cf.togNit !== false && cf.nit ? `<div style="font-size:12px;opacity:.85">NIT: ${cf.nit}</div>` : ''}
        ${cf.direccion ? `<div style="font-size:12px;opacity:.85">${cf.direccion}${cf.ciudad ? ', ' + cf.ciudad : ''}</div>` : ''}
        ${cf.telefono  ? `<div style="font-size:12px;opacity:.85">Tel: ${cf.telefono}</div>` : ''}
      </td></tr>
      <tr><td>
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">${rows}</table>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

async function enviarFactura({ to, v, cf, moneda }) {
  const transporter = getTransporter();
  if (!transporter) throw new Error('SMTP no configurado. Completa las variables SMTP_HOST, SMTP_USER y SMTP_PASS en el archivo .env');

  const html = buildReciboHtml(v, cf || {}, moneda);
  const subject = `${cf?.nombre || 'Factura'} — ${v.numero_factura || ''}`;
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
  });
}

module.exports = { enviarFactura };
