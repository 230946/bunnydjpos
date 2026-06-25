-- ================================================================
-- BUNNYDJPOS — Schema Fase 2
-- Gastos · Caja diaria · Config factura · Impresora · Proveedores
-- Ejecutar DESPUÉS de schema.sql de Fase 1
-- ================================================================

-- ── CATEGORÍAS DE GASTOS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gasto_categorias (
  id          VARCHAR(36)   PRIMARY KEY,
  negocio_id  VARCHAR(36)   NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  nombre      VARCHAR(80)   NOT NULL,
  color       VARCHAR(20)   DEFAULT '#378ADD',
  creado      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── GASTOS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gastos (
  id            VARCHAR(36)   PRIMARY KEY,
  negocio_id    VARCHAR(36)   NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  categoria_id  VARCHAR(36)   REFERENCES gasto_categorias(id) ON DELETE SET NULL,
  usuario_id    VARCHAR(36)   REFERENCES usuarios(id) ON DELETE SET NULL,
  descripcion   VARCHAR(200)  NOT NULL,
  monto         DECIMAL(12,2) NOT NULL DEFAULT 0,
  metodo_pago   VARCHAR(20)   NOT NULL DEFAULT 'efectivo',
  comprobante   VARCHAR(300), -- URL del comprobante subido
  fecha         DATE          NOT NULL DEFAULT CURRENT_DATE,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── CAJA DIARIA ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cajas (
  id              VARCHAR(36)   PRIMARY KEY,
  negocio_id      VARCHAR(36)   NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  usuario_id      VARCHAR(36)   REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha           DATE          NOT NULL DEFAULT CURRENT_DATE,
  monto_apertura  DECIMAL(12,2) NOT NULL DEFAULT 0,
  monto_cierre    DECIMAL(12,2),
  total_ventas    DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_gastos    DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_efectivo  DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_tarjeta   DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_nequi     DECIMAL(12,2) NOT NULL DEFAULT 0,
  estado          VARCHAR(20)   NOT NULL DEFAULT 'abierta', -- abierta | cerrada
  notas           TEXT,
  apertura_en     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cierre_en       TIMESTAMP,
  UNIQUE (negocio_id, fecha)
);

-- ── CONFIGURACIÓN DE IMPRESORA ───────────────────────────────────
CREATE TABLE IF NOT EXISTS config_impresora (
  negocio_id      VARCHAR(36)   PRIMARY KEY REFERENCES negocios(id) ON DELETE CASCADE,
  tipo            VARCHAR(30)   NOT NULL DEFAULT 'termica', -- termica | laser | pdf
  nombre          VARCHAR(120),
  ancho_papel     INT           NOT NULL DEFAULT 80,  -- mm: 58 | 80
  ip_impresora    VARCHAR(60),
  puerto          INT           DEFAULT 9100,
  copias          INT           NOT NULL DEFAULT 1,
  imprimir_logo   BOOLEAN       NOT NULL DEFAULT TRUE,
  imprimir_cocina BOOLEAN       NOT NULL DEFAULT TRUE,
  actualizado     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── PROVEEDORES ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proveedores (
  id          VARCHAR(36)   PRIMARY KEY,
  negocio_id  VARCHAR(36)   NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  nombre      VARCHAR(120)  NOT NULL,
  nit         VARCHAR(30),
  contacto    VARCHAR(100),
  telefono    VARCHAR(30),
  email       VARCHAR(120),
  direccion   VARCHAR(200),
  ciudad      VARCHAR(80),
  activo      BOOLEAN       NOT NULL DEFAULT TRUE,
  notas       TEXT,
  creado      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── SOLICITUDES DE PEDIDO A PROVEEDOR ───────────────────────────
CREATE TABLE IF NOT EXISTS pedidos_proveedor (
  id            VARCHAR(36)   PRIMARY KEY,
  negocio_id    VARCHAR(36)   NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  proveedor_id  VARCHAR(36)   NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  usuario_id    VARCHAR(36)   REFERENCES usuarios(id) ON DELETE SET NULL,
  estado        VARCHAR(20)   NOT NULL DEFAULT 'pendiente', -- pendiente | enviado | recibido | cancelado
  items         JSON          NOT NULL DEFAULT '[]',
  total         DECIMAL(12,2) NOT NULL DEFAULT 0,
  notas         TEXT,
  fecha_pedido  DATE          NOT NULL DEFAULT CURRENT_DATE,
  fecha_entrega DATE,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── VENTAS (si no existe de Fase anterior) ───────────────────────
CREATE TABLE IF NOT EXISTS ventas (
  id            VARCHAR(36)   PRIMARY KEY,
  negocio_id    VARCHAR(36)   REFERENCES negocios(id) ON DELETE SET NULL,
  mesa_num      INT,
  items         JSON          NOT NULL DEFAULT '[]',
  subtotal      DECIMAL(12,2) NOT NULL DEFAULT 0,
  iva           DECIMAL(12,2) NOT NULL DEFAULT 0,
  total         DECIMAL(12,2) NOT NULL DEFAULT 0,
  metodo_pago   VARCHAR(20)   NOT NULL DEFAULT 'efectivo',
  recibido      DECIMAL(12,2) NOT NULL DEFAULT 0,
  cambio        DECIMAL(12,2) NOT NULL DEFAULT 0,
  numero_factura VARCHAR(30),
  usuario_id    VARCHAR(36)   REFERENCES usuarios(id) ON DELETE SET NULL,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── ÍNDICES ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_gastos_negocio  ON gastos(negocio_id, fecha);
CREATE INDEX IF NOT EXISTS idx_cajas_negocio   ON cajas(negocio_id, fecha);
CREATE INDEX IF NOT EXISTS idx_ventas_negocio  ON ventas(negocio_id, creado);
CREATE INDEX IF NOT EXISTS idx_proveedores_neg ON proveedores(negocio_id);

-- ── CATEGORÍAS DE GASTO POR DEFECTO ─────────────────────────────
-- Se insertan dinámicamente al crear cada negocio desde el backend
