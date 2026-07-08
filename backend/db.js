/**
 * BUNNYDJPOS / DJPOS
 * © 2026 Juan Manuel Franco Rodríguez. Todos los derechos reservados.
 * Software de uso propietario y registrado. Prohibida su reproducción,
 * distribución o modificación sin autorización expresa del autor.
 */
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
    // Sin esto, mysql2 interpreta las fechas que MySQL ya devuelve en -05:00
    // (por el SET time_zone de abajo) como si fueran hora LOCAL DEL SERVIDOR
    // NODE (normalmente UTC en la nube) y les resta 5 horas de más al
    // convertirlas a objeto Date — dejando todas las horas mostradas
    // desfasadas. Debe coincidir con el SET time_zone de la conexión.
    timezone: '-05:00',
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
        const [result] = await _pool.query(sql, params || []);
        if (Array.isArray(result)) return { rows: result };
        // INSERT/UPDATE/DELETE devuelven un ResultSetHeader (no un array).
        // Se exponen affectedRows/insertId como props del array vacío para
        // que `const { rows } = await pool.query(...); rows.affectedRows`
        // siga funcionando en los call sites existentes.
        const rows = [];
        rows.affectedRows = result.affectedRows;
        rows.insertId = result.insertId;
        rows.changedRows = result.changedRows;
        return { rows };
      } catch (e) {
        if (!silent) console.error('DB Error:', e.message, '\nSQL:', sql.slice(0,120));
        throw e;
      }
    }
  };

  // Migración de collation: convierte cualquier tabla que no esté en utf8mb4_unicode_ci
  // (ej. utf8mb4_0900_ai_ci de MySQL 8, o utf8mb4_uca1400_ai_ci de MariaDB 10.10+)
  // a utf8mb4_unicode_ci, que es lo que esperan todas las comparaciones del código.
  // Mezclar collations entre tablas (ej. empleados vs domicilios_pedidos creadas en
  // momentos distintos) rompe cualquier WHERE que compare esas columnas con
  // "Illegal mix of collations".
  ;(async () => {
    try {
      const [tables] = await _pool.query(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA=DATABASE() AND TABLE_COLLATION LIKE 'utf8mb4%' AND TABLE_COLLATION != 'utf8mb4_unicode_ci'`
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
