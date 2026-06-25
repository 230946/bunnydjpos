-- ================================================================
-- BUNNYDJPOS — Schema Bar (Migración)
-- Agrega soporte completo para el módulo Bar vinculado al restaurante
-- Ejecutar DESPUÉS de schema_fase3.sql
-- Compatible con MySQL 8+ / MariaDB 10.0+
-- ================================================================

-- ── Columna modulo en categorías de menú ─────────────────────────
-- Permite distinguir categorías del restaurante de las del bar
ALTER TABLE menu_categorias
  ADD COLUMN IF NOT EXISTS modulo VARCHAR(30) DEFAULT NULL
  COMMENT 'NULL=todos | restaurante | bar | minimercado';

-- ── Índice para filtrado rápido por módulo ───────────────────────
CREATE INDEX IF NOT EXISTS idx_menu_cat_modulo
  ON menu_categorias(negocio_id, modulo);

-- ── Módulo Bar en catálogo de módulos ────────────────────────────
INSERT IGNORE INTO modulos (id, clave, nombre, descripcion, icono, orden) VALUES
  ('mod-13', 'bar', 'Bar', 'POS y administración de carta de bebidas', '🍹', 13);

-- ── Columna tipo en ventas (ya debe existir, por si no) ──────────
-- La columna tipo permite separar ventas de restaurante, bar, minimercado
ALTER TABLE ventas
  MODIFY COLUMN tipo VARCHAR(30) NOT NULL DEFAULT 'pos'
  COMMENT 'pos | bar | minimercado';

-- ── mesa_nombre en ventas para texto libre del bar ───────────────
-- El bar usa texto libre ("Barra", "Mesa 4", "Para llevar") sin FK a mesas
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS mesa_nombre VARCHAR(60) DEFAULT NULL;

-- ── Índice por tipo para reportes separados bar / restaurante ────
CREATE INDEX IF NOT EXISTS idx_ventas_tipo
  ON ventas(negocio_id, tipo, creado);

-- ================================================================
-- CATEGORÍAS DE BAR POR DEFECTO
-- Se insertan al crear/habilitar el módulo bar en cada negocio.
-- Estas son categorías de ejemplo; el administrador puede crear las suyas.
-- Para insertarlas en un negocio específico, reemplaza <NEGOCIO_ID>:
--
-- INSERT IGNORE INTO menu_categorias (id, negocio_id, nombre, icono, orden, modulo) VALUES
--   (UUID(), '<NEGOCIO_ID>', 'Cócteles',   '🍸', 1, 'bar'),
--   (UUID(), '<NEGOCIO_ID>', 'Cervezas',   '🍺', 2, 'bar'),
--   (UUID(), '<NEGOCIO_ID>', 'Vinos',      '🍷', 3, 'bar'),
--   (UUID(), '<NEGOCIO_ID>', 'Shots',      '🥃', 4, 'bar'),
--   (UUID(), '<NEGOCIO_ID>', 'Sin alcohol','🧃', 5, 'bar'),
--   (UUID(), '<NEGOCIO_ID>', 'Snacks bar', '🥜', 6, 'bar');
-- ================================================================
