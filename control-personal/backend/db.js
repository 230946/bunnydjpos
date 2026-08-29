/**
 * db.js — Conexión MySQL/MariaDB para Control de Personal
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const _pool = mysql.createPool({
  host:     process.env.DB_HOST || '127.0.0.1',
  port:     parseInt(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'control_personal',
  waitForConnections: true,
  connectionLimit: 10,
  timezone: '-05:00',
  typeCast: function(field, next) {
    if (field.type === 'TINY' && field.length === 1) {
      return field.string() === '1';
    }
    return next();
  }
});

_pool.on('connection', (conn) => {
  conn.query("SET time_zone = '-05:00'");
});

const pool = {
  query: async (sql, params) => {
    try {
      const [result] = await _pool.query(sql, params || []);
      if (Array.isArray(result)) return { rows: result };
      const rows = [];
      rows.affectedRows = result.affectedRows;
      rows.insertId = result.insertId;
      return { rows };
    } catch (e) {
      console.error('DB Error:', e.message, '\nSQL:', sql.slice(0, 120));
      throw e;
    }
  }
};

module.exports = { pool };
