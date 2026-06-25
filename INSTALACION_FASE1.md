# BUNNYDJPOS — Fase 1: SuperAdmin + Autenticación

## Qué incluye

- Base de datos multi-tenant (negocios independientes)
- SuperAdmin: crear/editar negocios (restaurantes o minimercados)
- Activar/desactivar módulos por negocio con toggle
- Sistema de roles y permisos
- Creación de personal con usuario y contraseña
- Login con JWT (8h de sesión)
- Registro automático de entrada/salida
- Horarios de empleados por día de semana
- WebSocket listo para cocina en tiempo real
- Panel SuperAdmin web (superadmin.html)

## Instalación

### 1. Crear la base de datos

PostgreSQL:
  psql -U postgres -c "CREATE DATABASE bunnydjpos;"
  psql -U postgres -d bunnydjpos -f backend/schema.sql

MySQL:
  mysql -u root -p -e "CREATE DATABASE bunnydjpos CHARACTER SET utf8mb4;"
  mysql -u root -p bunnydjpos < backend/schema.sql

### 2. Configurar entorno

  cd backend
  cp .env.example .env
  # Edita .env con tus datos de BD y cambia JWT_SECRET

### 3. Instalar y arrancar

  cd backend
  npm install
  npm start

### 4. Abrir el panel

Abre frontend/superadmin.html en el navegador:
  Email:      superadmin@bunnydjpos.com
  Contraseña: Admin123!

IMPORTANTE: Cambia la contraseña en producción.

## Estructura

bunnydjpos/
  backend/
    server.js         Servidor principal + WebSocket
    db.js             Conexion MySQL/PostgreSQL
    schema.sql        Tablas de la BD
    .env.example      Variables de entorno
    package.json
    middleware/
      auth.js         JWT + permisos
    routes/
      auth.js         Login, logout, perfil
      superadmin.js   Negocios y modulos
      usuarios.js     Personal, roles, horarios
  frontend/
    superadmin.html   Panel SuperAdmin web

## Fase 2 incluirá

- Panel Administrativo por negocio
- Caja diaria y relacion de gastos
- Configuracion de factura + logo + impresora
- Modulo de proveedores
