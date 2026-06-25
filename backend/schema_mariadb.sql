-- ================================================================
-- BUNNYDJPOS — Schema COMPLETO para MariaDB / MySQL (XAMPP)
-- Ejecutar este único archivo — reemplaza los 3 schemas anteriores
-- ================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ── FASE 1 ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS negocios (
  id            VARCHAR(36)   PRIMARY KEY,
  nombre        VARCHAR(120)  NOT NULL,
  tipo          VARCHAR(30)   NOT NULL DEFAULT 'restaurante',
  nit           VARCHAR(30),
  direccion     VARCHAR(200),
  ciudad        VARCHAR(80),
  telefono      VARCHAR(30),
  email         VARCHAR(120),
  logo_url      VARCHAR(300),
  activo        TINYINT(1)    NOT NULL DEFAULT 1,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS modulos (
  id            VARCHAR(36)   PRIMARY KEY,
  clave         VARCHAR(50)   NOT NULL UNIQUE,
  nombre        VARCHAR(80)   NOT NULL,
  descripcion   VARCHAR(200),
  icono         VARCHAR(30),
  orden         INT           NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
  id            VARCHAR(36)   PRIMARY KEY,
  negocio_id    VARCHAR(36),
  nombre        VARCHAR(60)   NOT NULL,
  descripcion   VARCHAR(200),
  es_sistema    TINYINT(1)    NOT NULL DEFAULT 0,
  permisos      JSON,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS usuarios (
  id            VARCHAR(36)   PRIMARY KEY,
  negocio_id    VARCHAR(36),
  rol_id        VARCHAR(36),
  nombre        VARCHAR(120)  NOT NULL,
  email         VARCHAR(120)  NOT NULL UNIQUE,
  username      VARCHAR(60)   UNIQUE,
  password_hash VARCHAR(255)  NOT NULL,
  es_superadmin TINYINT(1)    NOT NULL DEFAULT 0,
  activo        TINYINT(1)    NOT NULL DEFAULT 1,
  avatar_url    VARCHAR(300),
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE,
  FOREIGN KEY (rol_id)     REFERENCES roles(id)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS negocio_modulos (
  negocio_id    VARCHAR(36)   NOT NULL,
  modulo_id     VARCHAR(36)   NOT NULL,
  activo        TINYINT(1)    NOT NULL DEFAULT 1,
  activado_en   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (negocio_id, modulo_id),
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE,
  FOREIGN KEY (modulo_id)  REFERENCES modulos(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS horarios (
  id            VARCHAR(36)   PRIMARY KEY,
  usuario_id    VARCHAR(36)   NOT NULL,
  negocio_id    VARCHAR(36)   NOT NULL,
  dia_semana    INT           NOT NULL,
  hora_entrada  TIME          NOT NULL,
  hora_salida   TIME          NOT NULL,
  activo        TINYINT(1)    NOT NULL DEFAULT 1,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asistencia (
  id            VARCHAR(36)   PRIMARY KEY,
  usuario_id    VARCHAR(36)   NOT NULL,
  negocio_id    VARCHAR(36)   NOT NULL,
  entrada       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  salida        TIMESTAMP     NULL DEFAULT NULL,
  nota          VARCHAR(200),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sesiones (
  id            VARCHAR(36)   PRIMARY KEY,
  usuario_id    VARCHAR(36)   NOT NULL,
  token_hash    VARCHAR(255)  NOT NULL,
  dispositivo   VARCHAR(200),
  ip            VARCHAR(45),
  expira        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS config_factura (
  negocio_id    VARCHAR(36)   PRIMARY KEY,
  datos         JSON          NOT NULL,
  actualizado   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed módulos
INSERT IGNORE INTO modulos (id, clave, nombre, descripcion, icono, orden) VALUES
  ('mod-01', 'pos_mesas',   'Mesas POS',    'Gestión de mesas del restaurante',    'layout-grid',   1),
  ('mod-02', 'pos_menu',    'Menú POS',     'Carta digital con fotos y categorías', 'book',          2),
  ('mod-03', 'pos_cocina',  'Cocina',       'Comandas en tiempo real',              'chef-hat',      3),
  ('mod-04', 'pos_cobro',   'Cobro',        'Cobro con efectivo, tarjeta y QR',     'credit-card',   4),
  ('mod-05', 'inventario',  'Inventario',   'Control de stock e ingredientes',      'box',           5),
  ('mod-06', 'minimercado', 'Minimercado',  'POS para minimercado / tienda',        'shopping-cart', 6),
  ('mod-07', 'proveedores', 'Proveedores',  'Gestión de proveedores y pedidos',     'truck',         7),
  ('mod-08', 'facturacion', 'Facturación',  'Factura electrónica con QR',           'file-invoice',  8),
  ('mod-09', 'reportes',    'Reportes',     'Ventas, caja diaria y estadísticas',   'chart-bar',     9),
  ('mod-10', 'gastos',      'Gastos',       'Relación de gastos del negocio',       'receipt',       10),
  ('mod-11', 'horarios',    'Horarios',     'Turnos y asistencia de empleados',     'clock',         11),
  ('mod-12', 'personal',    'Personal',     'Gestión de empleados y roles',         'users',         12);


CREATE INDEX idx_usuarios_email ON usuarios(email);




-- ── FASE 2 ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gasto_categorias (
  id          VARCHAR(36)   PRIMARY KEY,
  negocio_id  VARCHAR(36)   NOT NULL,
  nombre      VARCHAR(80)   NOT NULL,
  color       VARCHAR(20)   DEFAULT '#378ADD',
  creado      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gastos (
  id            VARCHAR(36)   PRIMARY KEY,
  negocio_id    VARCHAR(36)   NOT NULL,
  categoria_id  VARCHAR(36),
  usuario_id    VARCHAR(36),
  descripcion   VARCHAR(200)  NOT NULL,
  monto         DECIMAL(12,2) NOT NULL DEFAULT 0,
  metodo_pago   VARCHAR(20)   NOT NULL DEFAULT 'efectivo',
  comprobante   VARCHAR(300),
  fecha         DATE          NOT NULL DEFAULT (CURRENT_DATE),
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (negocio_id)   REFERENCES negocios(id)          ON DELETE CASCADE,
  FOREIGN KEY (categoria_id) REFERENCES gasto_categorias(id)  ON DELETE SET NULL,
  FOREIGN KEY (usuario_id)   REFERENCES usuarios(id)          ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cajas (
  id              VARCHAR(36)   PRIMARY KEY,
  negocio_id      VARCHAR(36)   NOT NULL,
  usuario_id      VARCHAR(36),
  fecha           DATE          NOT NULL DEFAULT (CURRENT_DATE),
  monto_apertura  DECIMAL(12,2) NOT NULL DEFAULT 0,
  monto_cierre    DECIMAL(12,2),
  total_ventas    DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_gastos    DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_efectivo  DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_tarjeta   DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_nequi     DECIMAL(12,2) NOT NULL DEFAULT 0,
  estado          VARCHAR(20)   NOT NULL DEFAULT 'abierta',
  notas           TEXT,
  apertura_en     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cierre_en       TIMESTAMP     NULL DEFAULT NULL,
  UNIQUE KEY uq_caja_fecha (negocio_id, fecha),
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS config_impresora (
  negocio_id      VARCHAR(36)   PRIMARY KEY,
  tipo            VARCHAR(30)   NOT NULL DEFAULT 'termica',
  nombre          VARCHAR(120),
  ancho_papel     INT           NOT NULL DEFAULT 80,
  ip_impresora    VARCHAR(60),
  puerto          INT           DEFAULT 9100,
  copias          INT           NOT NULL DEFAULT 1,
  imprimir_logo   TINYINT(1)    NOT NULL DEFAULT 1,
  imprimir_cocina TINYINT(1)    NOT NULL DEFAULT 1,
  actualizado     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS proveedores (
  id          VARCHAR(36)   PRIMARY KEY,
  negocio_id  VARCHAR(36)   NOT NULL,
  nombre      VARCHAR(120)  NOT NULL,
  nit         VARCHAR(30),
  contacto    VARCHAR(100),
  telefono    VARCHAR(30),
  email       VARCHAR(120),
  direccion   VARCHAR(200),
  ciudad      VARCHAR(80),
  activo      TINYINT(1)    NOT NULL DEFAULT 1,
  notas       TEXT,
  creado      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pedidos_proveedor (
  id            VARCHAR(36)   PRIMARY KEY,
  negocio_id    VARCHAR(36)   NOT NULL,
  proveedor_id  VARCHAR(36)   NOT NULL,
  usuario_id    VARCHAR(36),
  estado        VARCHAR(20)   NOT NULL DEFAULT 'pendiente',
  items         JSON          NOT NULL,
  total         DECIMAL(12,2) NOT NULL DEFAULT 0,
  notas         TEXT,
  fecha_pedido  DATE          NOT NULL DEFAULT (CURRENT_DATE),
  fecha_entrega DATE,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (negocio_id)   REFERENCES negocios(id)   ON DELETE CASCADE,
  FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id)   REFERENCES usuarios(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_gastos_negocio ON gastos(negocio_id, fecha);
CREATE INDEX idx_cajas_negocio ON cajas(negocio_id, fecha);


-- ── FASE 3 ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mesas (
  id            VARCHAR(36)   PRIMARY KEY,
  negocio_id    VARCHAR(36)   NOT NULL,
  numero        INT           NOT NULL,
  nombre        VARCHAR(60),
  capacidad     INT           NOT NULL DEFAULT 4,
  zona          VARCHAR(60),
  activa        TINYINT(1)    NOT NULL DEFAULT 1,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mesa_num (negocio_id, numero),
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mesa_estado (
  mesa_id       VARCHAR(36)   PRIMARY KEY,
  ocupada       TINYINT(1)    NOT NULL DEFAULT 0,
  pedido        JSON          NOT NULL,
  mesero_id     VARCHAR(36),
  actualizado   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (mesa_id)   REFERENCES mesas(id)    ON DELETE CASCADE,
  FOREIGN KEY (mesero_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menu_categorias (
  id            VARCHAR(36)   PRIMARY KEY,
  negocio_id    VARCHAR(36)   NOT NULL,
  nombre        VARCHAR(80)   NOT NULL,
  descripcion   VARCHAR(200),
  icono         VARCHAR(10),
  orden         INT           NOT NULL DEFAULT 0,
  activa        TINYINT(1)    NOT NULL DEFAULT 1,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menu_items (
  id            VARCHAR(36)   PRIMARY KEY,
  negocio_id    VARCHAR(36)   NOT NULL,
  categoria_id  VARCHAR(36),
  nombre        VARCHAR(120)  NOT NULL,
  descripcion   VARCHAR(300),
  precio        DECIMAL(12,2) NOT NULL DEFAULT 0,
  foto_url      VARCHAR(300),
  emoji         VARCHAR(10)   DEFAULT '🍽️',
  disponible    TINYINT(1)    NOT NULL DEFAULT 1,
  tiempo_prep   INT           DEFAULT 15,
  orden         INT           NOT NULL DEFAULT 0,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (negocio_id)   REFERENCES negocios(id)       ON DELETE CASCADE,
  FOREIGN KEY (categoria_id) REFERENCES menu_categorias(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comandas (
  id            VARCHAR(36)   PRIMARY KEY,
  negocio_id    VARCHAR(36)   NOT NULL,
  mesa_id       VARCHAR(36),
  mesa_num      INT,
  mesa_nombre   VARCHAR(60),
  mesero_id     VARCHAR(36),
  items         JSON          NOT NULL,
  estado        VARCHAR(20)   NOT NULL DEFAULT 'nuevo',
  prioridad     INT           NOT NULL DEFAULT 0,
  notas         TEXT,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE,
  FOREIGN KEY (mesa_id)    REFERENCES mesas(id)    ON DELETE SET NULL,
  FOREIGN KEY (mesero_id)  REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventario (
  id            VARCHAR(36)   PRIMARY KEY,
  negocio_id    VARCHAR(36)   NOT NULL,
  codigo        VARCHAR(60),
  nombre        VARCHAR(120)  NOT NULL,
  categoria     VARCHAR(80)   NOT NULL DEFAULT 'General',
  stock         DECIMAL(12,3) NOT NULL DEFAULT 0,
  stock_min     DECIMAL(12,3) NOT NULL DEFAULT 0,
  stock_max     DECIMAL(12,3),
  unidad        VARCHAR(20)   NOT NULL DEFAULT 'unidades',
  costo         DECIMAL(12,2) NOT NULL DEFAULT 0,
  precio_venta  DECIMAL(12,2) NOT NULL DEFAULT 0,
  proveedor_id  VARCHAR(36),
  foto_url      VARCHAR(300),
  es_producto   TINYINT(1)    NOT NULL DEFAULT 0,
  activo        TINYINT(1)    NOT NULL DEFAULT 1,
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (negocio_id)  REFERENCES negocios(id)   ON DELETE CASCADE,
  FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventario_movimientos (
  id            INT           AUTO_INCREMENT PRIMARY KEY,
  inventario_id VARCHAR(36)   NOT NULL,
  negocio_id    VARCHAR(36)   NOT NULL,
  tipo          VARCHAR(20)   NOT NULL,
  cantidad      DECIMAL(12,3) NOT NULL,
  stock_antes   DECIMAL(12,3) NOT NULL DEFAULT 0,
  stock_despues DECIMAL(12,3) NOT NULL DEFAULT 0,
  referencia    VARCHAR(100),
  nota          VARCHAR(200),
  usuario_id    VARCHAR(36),
  creado        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inventario_id) REFERENCES inventario(id) ON DELETE CASCADE,
  FOREIGN KEY (negocio_id)    REFERENCES negocios(id)   ON DELETE CASCADE,
  FOREIGN KEY (usuario_id)    REFERENCES usuarios(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ventas (
  id              VARCHAR(36)   PRIMARY KEY,
  negocio_id      VARCHAR(36)   NOT NULL,
  tipo            VARCHAR(20)   NOT NULL DEFAULT 'pos',
  mesa_id         VARCHAR(36),
  mesa_num        INT,
  cliente_nombre  VARCHAR(100),
  items           JSON          NOT NULL,
  subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0,
  descuento       DECIMAL(12,2) NOT NULL DEFAULT 0,
  iva             DECIMAL(12,2) NOT NULL DEFAULT 0,
  total           DECIMAL(12,2) NOT NULL DEFAULT 0,
  metodo_pago     VARCHAR(20)   NOT NULL DEFAULT 'efectivo',
  recibido        DECIMAL(12,2) NOT NULL DEFAULT 0,
  cambio          DECIMAL(12,2) NOT NULL DEFAULT 0,
  numero_factura  VARCHAR(30),
  qr_data         TEXT,
  mesero_id       VARCHAR(36),
  cajero_id       VARCHAR(36),
  estado          VARCHAR(20)   NOT NULL DEFAULT 'pagada',
  creado          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE,
  FOREIGN KEY (mesa_id)    REFERENCES mesas(id)    ON DELETE SET NULL,
  FOREIGN KEY (mesero_id)  REFERENCES usuarios(id) ON DELETE SET NULL,
  FOREIGN KEY (cajero_id)  REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS venta_items (
  id              INT           AUTO_INCREMENT PRIMARY KEY,
  venta_id        VARCHAR(36)   NOT NULL,
  negocio_id      VARCHAR(36)   NOT NULL,
  inventario_id   VARCHAR(36),
  nombre          VARCHAR(120)  NOT NULL,
  cantidad        DECIMAL(12,3) NOT NULL DEFAULT 1,
  precio_unit     DECIMAL(12,2) NOT NULL DEFAULT 0,
  subtotal_item   DECIMAL(12,2) NOT NULL DEFAULT 0,
  creado          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (venta_id)      REFERENCES ventas(id)     ON DELETE CASCADE,
  FOREIGN KEY (negocio_id)    REFERENCES negocios(id)   ON DELETE CASCADE,
  FOREIGN KEY (inventario_id) REFERENCES inventario(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Índices Fase 3 (ignorar si ya existen)
DROP PROCEDURE IF EXISTS ci3;
DELIMITER //
CREATE PROCEDURE ci3(p_i VARCHAR(64), p_t VARCHAR(64), p_c VARCHAR(200))
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=p_t AND index_name=p_i) THEN
    SET @s=CONCAT('CREATE INDEX ',p_i,' ON ',p_t,'(',p_c,')'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //
DELIMITER ;
CALL ci3('idx_mesas_negocio','mesas','negocio_id');
CALL ci3('idx_menu_items_negocio','menu_items','negocio_id');
CALL ci3('idx_comandas_negocio','comandas','negocio_id,estado');
CALL ci3('idx_inventario_negocio','inventario','negocio_id');
CALL ci3('idx_ventas_negocio','ventas','negocio_id,creado');
CALL ci3('idx_venta_items_neg','venta_items','negocio_id,creado');
DROP PROCEDURE IF EXISTS ci3;

SET FOREIGN_KEY_CHECKS = 1;

-- ── MÓDULO BAR ───────────────────────────────────────────────────
INSERT IGNORE INTO modulos (id, clave, nombre, descripcion, icono, orden) VALUES
  ('mod-13', 'bar', 'Bar', 'Gestión de bar: cócteles, bebidas y comandas', 'glass-cocktail', 13);

-- Categorías especiales de menú para bar (se crean por negocio desde el admin)
-- Las comandas de bar usan la misma tabla comandas con campo tipo='bar'

-- Agregar tipo a comandas para distinguir cocina/bar
-- Agregar columna tipo a comandas (si no existe)
DROP PROCEDURE IF EXISTS add_col_tipo;
DELIMITER //
CREATE PROCEDURE add_col_tipo()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='comandas' AND column_name='tipo') THEN
    ALTER TABLE comandas ADD COLUMN tipo VARCHAR(20) NOT NULL DEFAULT 'cocina';
  END IF;
END //
DELIMITER ;
CALL add_col_tipo();
DROP PROCEDURE IF EXISTS add_col_tipo;
