-- Control de Personal — esquema completo
-- Ejecutar contra una base de datos vacía (ej. CREATE DATABASE control_personal;)

CREATE TABLE IF NOT EXISTS usuarios (
  id CHAR(36) PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  documento VARCHAR(30),
  codigo_qr CHAR(36) UNIQUE,
  email VARCHAR(150) UNIQUE,
  username VARCHAR(80) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  rol ENUM('admin','empleado') NOT NULL DEFAULT 'empleado',
  cargo VARCHAR(100),
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS turnos (
  id CHAR(36) PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  color VARCHAR(7) DEFAULT '#0B8457',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS horario_asignado (
  id CHAR(36) PRIMARY KEY,
  usuario_id CHAR(36) NOT NULL,
  fecha DATE NOT NULL,
  turno_id CHAR(36) NULL,
  pausa_tipo ENUM('almuerzo','cena') NULL,
  pausa_inicio TIME NULL,
  pausa_fin TIME NULL,
  actualizado DATETIME DEFAULT NOW() ON UPDATE NOW(),
  UNIQUE KEY uq_horario_usuario_fecha (usuario_id, fecha),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (turno_id) REFERENCES turnos(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fichajes (
  id CHAR(36) PRIMARY KEY,
  usuario_id CHAR(36) NOT NULL,
  fecha DATE NOT NULL,
  turno_id CHAR(36) NULL,
  hora_entrada_real DATETIME NULL,
  pausa_inicio_real DATETIME NULL,
  pausa_fin_real DATETIME NULL,
  duracion_pausa_min INT NULL,
  hora_salida_real DATETIME NULL,
  tardanza TINYINT(1) NOT NULL DEFAULT 0,
  horas_trabajadas DECIMAL(5,2) NULL,
  UNIQUE KEY uq_fichaje_usuario_fecha (usuario_id, fecha),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (turno_id) REFERENCES turnos(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS solicitudes_permiso (
  id CHAR(36) PRIMARY KEY,
  usuario_id CHAR(36) NOT NULL,
  tipo ENUM('vacaciones','personal','enfermedad','otro') NOT NULL DEFAULT 'personal',
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  motivo TEXT,
  estado ENUM('pendiente','aprobado','rechazado') NOT NULL DEFAULT 'pendiente',
  respondido_por CHAR(36) NULL,
  respondido_en DATETIME NULL,
  notas_admin TEXT,
  creado DATETIME DEFAULT NOW(),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (respondido_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notificaciones (
  id CHAR(36) PRIMARY KEY,
  usuario_id CHAR(36) NOT NULL,
  mensaje VARCHAR(255) NOT NULL,
  leido TINYINT(1) NOT NULL DEFAULT 0,
  creado DATETIME DEFAULT NOW(),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  INDEX idx_notif_usuario (usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
