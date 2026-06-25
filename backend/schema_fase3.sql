-- ================================================================
-- BUNNYDJPOS — Schema Fase 3
-- Mesas · Menú · Pedidos · Cocina · Inventario · Minimercado
-- Ejecutar DESPUÉS de schema_fase2.sql
-- ================================================================

-- ── MESAS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mesas (
  id            VARCHAR(36)   PRIMARY KEY,
  negocio_id    VARCHAR(36)   NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  numero        INT           NOT NULL,
  nombre        VARCHAR(60),
  capacidad     INT           NOT NULL DEFAULT 4,
  zona          VARCHAR(60),   -- Terraza, Interior, Bar, etc.
  activa        BOOLEAN       NOT NULL DEFAULT TRUE,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (negocio_id, numero)
);

-- ── ESTADO DE MESA (en tiempo real) ─────────────────────────────
CREATE TABLE IF NOT EXISTS mesa_estado (
  mesa_id       VARCHAR(36)   PRIMARY KEY REFERENCES mesas(id) ON DELETE CASCADE,
  ocupada       BOOLEAN       NOT NULL DEFAULT FALSE,
  pedido        JSON          NOT NULL DEFAULT '[]',
  mesero_id     VARCHAR(36)   REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── CATEGORÍAS DE MENÚ ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_categorias (
  id            VARCHAR(36)   PRIMARY KEY,
  negocio_id    VARCHAR(36)   NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  nombre        VARCHAR(80)   NOT NULL,
  descripcion   VARCHAR(200),
  icono         VARCHAR(10),
  orden         INT           NOT NULL DEFAULT 0,
  activa        BOOLEAN       NOT NULL DEFAULT TRUE,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── ARTÍCULOS DE MENÚ ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_items (
  id            VARCHAR(36)   PRIMARY KEY,
  negocio_id    VARCHAR(36)   NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  categoria_id  VARCHAR(36)   REFERENCES menu_categorias(id) ON DELETE SET NULL,
  nombre        VARCHAR(120)  NOT NULL,
  descripcion   VARCHAR(300),
  precio        DECIMAL(12,2) NOT NULL DEFAULT 0,
  foto_url      VARCHAR(300),
  emoji         VARCHAR(8)    DEFAULT '🍽️',
  disponible    BOOLEAN       NOT NULL DEFAULT TRUE,
  tiempo_prep   INT           DEFAULT 15, -- minutos
  orden         INT           NOT NULL DEFAULT 0,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── COMANDAS DE COCINA ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comandas (
  id            VARCHAR(36)   PRIMARY KEY,
  negocio_id    VARCHAR(36)   NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  mesa_id       VARCHAR(36)   REFERENCES mesas(id) ON DELETE SET NULL,
  mesa_num      INT,
  mesa_nombre   VARCHAR(60),
  mesero_id     VARCHAR(36)   REFERENCES usuarios(id) ON DELETE SET NULL,
  items         JSON          NOT NULL DEFAULT '[]',
  estado        VARCHAR(20)   NOT NULL DEFAULT 'nuevo', -- nuevo|cocinando|listo|entregado
  prioridad     INT           NOT NULL DEFAULT 0,
  notas         TEXT,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── INVENTARIO ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventario (
  id            VARCHAR(36)   PRIMARY KEY,
  negocio_id    VARCHAR(36)   NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  codigo        VARCHAR(60),
  nombre        VARCHAR(120)  NOT NULL,
  categoria     VARCHAR(80)   NOT NULL DEFAULT 'General',
  stock         DECIMAL(12,3) NOT NULL DEFAULT 0,
  stock_min     DECIMAL(12,3) NOT NULL DEFAULT 0,
  stock_max     DECIMAL(12,3),
  unidad        VARCHAR(20)   NOT NULL DEFAULT 'unidades',
  costo         DECIMAL(12,2) NOT NULL DEFAULT 0,
  precio_venta  DECIMAL(12,2) NOT NULL DEFAULT 0, -- para minimercado
  proveedor_id  VARCHAR(36)   REFERENCES proveedores(id) ON DELETE SET NULL,
  foto_url      VARCHAR(300),
  es_producto   BOOLEAN       NOT NULL DEFAULT FALSE, -- true = venta directa minimercado
  activo        BOOLEAN       NOT NULL DEFAULT TRUE,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── MOVIMIENTOS DE INVENTARIO ────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventario_movimientos (
  id            SERIAL        PRIMARY KEY,
  inventario_id VARCHAR(36)   NOT NULL REFERENCES inventario(id) ON DELETE CASCADE,
  negocio_id    VARCHAR(36)   NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  tipo          VARCHAR(20)   NOT NULL, -- entrada|salida|ajuste|venta
  cantidad      DECIMAL(12,3) NOT NULL,
  stock_antes   DECIMAL(12,3) NOT NULL DEFAULT 0,
  stock_despues DECIMAL(12,3) NOT NULL DEFAULT 0,
  referencia    VARCHAR(100), -- id de venta, pedido proveedor, etc.
  nota          VARCHAR(200),
  usuario_id    VARCHAR(36)   REFERENCES usuarios(id) ON DELETE SET NULL,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── VENTAS (actualizada con negocio_id, mesa, mesero) ────────────
CREATE TABLE IF NOT EXISTS ventas (
  id              VARCHAR(36)   PRIMARY KEY,
  negocio_id      VARCHAR(36)   NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  tipo            VARCHAR(20)   NOT NULL DEFAULT 'pos', -- pos | minimercado
  mesa_id         VARCHAR(36)   REFERENCES mesas(id) ON DELETE SET NULL,
  mesa_num        INT,
  cliente_nombre  VARCHAR(100),
  items           JSON          NOT NULL DEFAULT '[]',
  subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0,
  descuento       DECIMAL(12,2) NOT NULL DEFAULT 0,
  iva             DECIMAL(12,2) NOT NULL DEFAULT 0,
  total           DECIMAL(12,2) NOT NULL DEFAULT 0,
  metodo_pago     VARCHAR(20)   NOT NULL DEFAULT 'efectivo',
  recibido        DECIMAL(12,2) NOT NULL DEFAULT 0,
  cambio          DECIMAL(12,2) NOT NULL DEFAULT 0,
  numero_factura  VARCHAR(30),
  qr_data         TEXT,
  mesero_id       VARCHAR(36)   REFERENCES usuarios(id) ON DELETE SET NULL,
  cajero_id       VARCHAR(36)   REFERENCES usuarios(id) ON DELETE SET NULL,
  estado          VARCHAR(20)   NOT NULL DEFAULT 'pagada', -- pagada|anulada
  creado          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── ITEMS DE VENTA (para top-platos sin parsear JSON) ────────────
CREATE TABLE IF NOT EXISTS venta_items (
  id              SERIAL        PRIMARY KEY,
  venta_id        VARCHAR(36)   NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  negocio_id      VARCHAR(36)   NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  inventario_id   VARCHAR(36)   REFERENCES inventario(id) ON DELETE SET NULL,
  nombre          VARCHAR(120)  NOT NULL,
  cantidad        DECIMAL(12,3) NOT NULL DEFAULT 1,
  precio_unit     DECIMAL(12,2) NOT NULL DEFAULT 0,
  subtotal_item   DECIMAL(12,2) NOT NULL DEFAULT 0,
  creado          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── ÍNDICES ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mesas_negocio       ON mesas(negocio_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_negocio  ON menu_items(negocio_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_cat      ON menu_items(categoria_id);
CREATE INDEX IF NOT EXISTS idx_comandas_negocio    ON comandas(negocio_id, estado);
CREATE INDEX IF NOT EXISTS idx_inventario_negocio  ON inventario(negocio_id);
CREATE INDEX IF NOT EXISTS idx_inventario_codigo   ON inventario(codigo);
CREATE INDEX IF NOT EXISTS idx_ventas_negocio      ON ventas(negocio_id, creado);
CREATE INDEX IF NOT EXISTS idx_venta_items_negocio ON venta_items(negocio_id, creado);
CREATE INDEX IF NOT EXISTS idx_inv_mov_negocio     ON inventario_movimientos(negocio_id, creado);
