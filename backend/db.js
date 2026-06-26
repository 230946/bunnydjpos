/**
 * db.js — Conexión para MariaDB / MySQL (XAMPP)
 * Compatible también con PostgreSQL si DB_TYPE=pg
 */
require('dotenv').config();
const DB_TYPE = (process.env.DB_TYPE || 'mysql').toLowerCase();
let pool;

if (DB_TYPE === 'mysql' || DB_TYPE === 'mariadb') {
  const mysql = require('mysql2/promise');
  const _pool = mysql.createPool({
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     parseInt(process.env.DB_PORT || '3306'),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASS     || '',
    database: process.env.DB_NAME     || 'bunnydjpos',
    waitForConnections: true,
    connectionLimit: 10,
    // MariaDB/MySQL: parsear JSON automáticamente
    typeCast: function(field, next) {
      // Convertir TINYINT(1) a boolean JS
      if (field.type === 'TINY' && field.length === 1) {
        return field.string() === '1';
      }
      // Parsear campos JSON automáticamente
      if (field.type === 'JSON') {
        const val = field.string();
        if (val === null) return null;
        try { return JSON.parse(val); } catch { return val; }
      }
      return next();
    }
  });

  // Fijar zona horaria Colombia (UTC-5) en cada nueva conexión
  _pool.on('connection', (conn) => {
    conn.query("SET time_zone = '-05:00'");
  });

  pool = {
    query: async (sql, params, { silent = false } = {}) => {
      try {
        const [rows] = await _pool.query(sql, params || []);
        return { rows: Array.isArray(rows) ? rows : [] };
      } catch (e) {
        if (!silent) console.error('DB Error:', e.message, '\nSQL:', sql.slice(0,120));
        throw e;
      }
    }
  };

  // Migración de collation: convierte tablas con utf8mb4_0900_ai_ci → utf8mb4_unicode_ci
  // MySQL 8 usa 0900_ai_ci por defecto; nuestras tablas esperan unicode_ci.
  ;(async () => {
    try {
      const [tables] = await _pool.query(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA=DATABASE() AND TABLE_COLLATION='utf8mb4_0900_ai_ci'`
      );
      for (const t of tables) {
        await _pool.query(
          `ALTER TABLE \`${t.TABLE_NAME}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
        console.log(`[collation] Convertida tabla: ${t.TABLE_NAME}`);
      }
      if (tables.length) console.log('[collation] Todas las tablas unificadas a utf8mb4_unicode_ci');
    } catch (e) { console.error('[collation fix]', e.message); }
  })();

} else {
  // PostgreSQL
  const { Pool } = require('pg');
  pool = new Pool({
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5432'),
    user:     process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'bunnydjpos',
    max: 10,
  });
}

// Placeholders: MySQL usa ?  |  PostgreSQL usa $1 $2...
function ph(n) { return (DB_TYPE === 'pg') ? `$${n}` : '?'; }

module.exports = { pool, ph, dbType: DB_TYPE };
