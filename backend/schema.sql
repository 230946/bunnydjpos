-- ================================================================
-- BUNNYDJPOS — Schema Fase 1
-- SuperAdmin · Negocios · Usuarios · Roles · Módulos
-- Compatible con PostgreSQL y MySQL 8+
-- ================================================================

-- ── NEGOCIOS (restaurantes / minimercados) ───────────────────────
CREATE TABLE IF NOT EXISTS negocios (
  id            VARCHAR(36)   PRIMARY KEY,
  nombre        VARCHAR(120)  NOT NULL,
  tipo          VARCHAR(30)   NOT NULL DEFAULT 'restaurante', -- restaurante | minimercado
  nit           VARCHAR(30),
  direccion     VARCHAR(200),
  ciudad        VARCHAR(80),
  telefono      VARCHAR(30),
  email         VARCHAR(120),
  logo_url      VARCHAR(300),
  activo        BOOLEAN       NOT NULL DEFAULT TRUE,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── MÓDULOS DISPONIBLES ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS modulos (
  id            VARCHAR(36)   PRIMARY KEY,
  clave         VARCHAR(50)   NOT NULL UNIQUE, -- pos_mesas, pos_menu, minimercado, inventario, etc.
  nombre        VARCHAR(80)   NOT NULL,
  descripcion   VARCHAR(200),
  icono         VARCHAR(30),
  orden         INT           NOT NULL DEFAULT 0
);

-- ── MÓDULOS HABILITADOS POR NEGOCIO ─────────────────────────────
CREATE TABLE IF NOT EXISTS negocio_modulos (
  negocio_id    VARCHAR(36)   NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  modulo_id     VARCHAR(36)   NOT NULL REFERENCES modulos(id)  ON DELETE CASCADE,
  activo        BOOLEAN       NOT NULL DEFAULT TRUE,
  activado_en   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (negocio_id, modulo_id)
);

-- ── ROLES ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id            VARCHAR(36)   PRIMARY KEY,
  negocio_id    VARCHAR(36)   REFERENCES negocios(id) ON DELETE CASCADE,
  nombre        VARCHAR(60)   NOT NULL,
  descripcion   VARCHAR(200),
  es_sistema    BOOLEAN       NOT NULL DEFAULT FALSE, -- superadmin, admin, etc.
  permisos      JSON,         -- {"pos_mesas": true, "cobro": true, ...}
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── USUARIOS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id            VARCHAR(36)   PRIMARY KEY,
  negocio_id    VARCHAR(36)   REFERENCES negocios(id) ON DELETE CASCADE,
  rol_id        VARCHAR(36)   REFERENCES roles(id)    ON DELETE SET NULL,
  nombre        VARCHAR(120)  NOT NULL,
  email         VARCHAR(120)  NOT NULL UNIQUE,
  username      VARCHAR(60)   UNIQUE,
  password_hash VARCHAR(255)  NOT NULL,
  es_superadmin BOOLEAN       NOT NULL DEFAULT FALSE,
  activo        BOOLEAN       NOT NULL DEFAULT TRUE,
  avatar_url    VARCHAR(300),
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── HORARIOS DE EMPLEADOS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS horarios (
  id            VARCHAR(36)   PRIMARY KEY,
  usuario_id    VARCHAR(36)   NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  negocio_id    VARCHAR(36)   NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  dia_semana    INT           NOT NULL, -- 0=Dom, 1=Lun, ... 6=Sab
  hora_entrada  TIME          NOT NULL,
  hora_salida   TIME          NOT NULL,
  activo        BOOLEAN       NOT NULL DEFAULT TRUE,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── REGISTRO DE ENTRADAS/SALIDAS ─────────────────────────────────
CREATE TABLE IF NOT EXISTS asistencia (
  id            VARCHAR(36)   PRIMARY KEY,
  usuario_id    VARCHAR(36)   NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  negocio_id    VARCHAR(36)   NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  entrada       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  salida        TIMESTAMP,
  nota          VARCHAR(200)
);

-- ── SESIONES / REFRESH TOKENS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS sesiones (
  id            VARCHAR(36)   PRIMARY KEY,
  usuario_id    VARCHAR(36)   NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash    VARCHAR(255)  NOT NULL,
  dispositivo   VARCHAR(200),
  ip            VARCHAR(45),
  expira        TIMESTAMP     NOT NULL,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── CONFIGURACIÓN DE FACTURA POR NEGOCIO ─────────────────────────
CREATE TABLE IF NOT EXISTS config_factura (
  negocio_id    VARCHAR(36)   PRIMARY KEY REFERENCES negocios(id) ON DELETE CASCADE,
  datos         JSON          NOT NULL,
  actualizado   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── MÓDULOS SEED ─────────────────────────────────────────────────
INSERT IGNORE INTO modulos (id, clave, nombre, descripcion, icono, orden) VALUES
  ('mod-01', 'pos_mesas',     'Mesas POS',         'Gestión de mesas del restaurante',   'layout-grid',   1),
  ('mod-02', 'pos_menu',      'Menú POS',          'Carta digital con fotos y categorías','book',          2),
  ('mod-03', 'pos_cocina',    'Cocina',            'Comandas en tiempo real',             'chef-hat',      3),
  ('mod-04', 'pos_cobro',     'Cobro',             'Cobro con efectivo, tarjeta y QR',    'credit-card',   4),
  ('mod-05', 'inventario',    'Inventario',        'Control de stock e ingredientes',     'box',           5),
  ('mod-06', 'minimercado',   'Minimercado',       'POS para minimercado / tienda',       'shopping-cart', 6),
  ('mod-07', 'proveedores',   'Proveedores',       'Gestión de proveedores y pedidos',    'truck',         7),
  ('mod-08', 'facturacion',   'Facturación',       'Factura electrónica con QR',          'file-invoice',  8),
  ('mod-09', 'reportes',      'Reportes',          'Ventas, caja diaria y estadísticas',  'chart-bar',     9),
  ('mod-10', 'gastos',        'Gastos',            'Relación de gastos del negocio',      'receipt',       10),
  ('mod-11', 'horarios',      'Horarios',          'Turnos y asistencia de empleados',    'clock',         11),
  ('mod-12', 'personal',      'Personal',          'Gestión de empleados y roles',        'users',         12);

-- ── ÍNDICES ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_usuarios_negocio  ON usuarios(negocio_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_email    ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_horarios_usuario  ON horarios(usuario_id);
CREATE INDEX IF NOT EXISTS idx_asistencia_fecha  ON asistencia(entrada);
CREATE INDEX IF NOT EXISTS idx_sesiones_usuario  ON sesiones(usuario_id);
