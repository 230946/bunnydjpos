-- ============================================================
-- LIMPIEZA DE DATOS TRANSACCIONALES - BUNNYDJPOS
-- ============================================================
-- Borra: ventas, cajas, gastos, asistencia, comandas
-- Conserva: usuarios, roles, menú, mesas, negocios, módulos
--
-- EJECUTAR EN: phpMyAdmin > pestaña SQL
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE venta_items;       -- items de cada venta
TRUNCATE TABLE ventas;            -- historial de ventas
TRUNCATE TABLE cajas;             -- aperturas y cierres de caja
TRUNCATE TABLE gastos;            -- registro de gastos
TRUNCATE TABLE asistencia;        -- registros de entrada/salida
TRUNCATE TABLE comandas;          -- órdenes de cocina/bar (quedarían huérfanas)
TRUNCATE TABLE mesa_estado;       -- estado activo de mesas (quedarían bloqueadas)

SET FOREIGN_KEY_CHECKS = 1;

-- Verificar que las tablas principales quedaron intactas
SELECT 'usuarios'      AS tabla, COUNT(*) AS registros FROM usuarios
UNION ALL
SELECT 'roles',        COUNT(*) FROM roles
UNION ALL
SELECT 'menu_items',   COUNT(*) FROM menu_items
UNION ALL
SELECT 'menu_categorias', COUNT(*) FROM menu_categorias
UNION ALL
SELECT 'mesas',        COUNT(*) FROM mesas
UNION ALL
SELECT 'negocios',     COUNT(*) FROM negocios;
