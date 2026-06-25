# 🐰 BUNNYDJPOS — Guía de instalación completa

## Lo que necesitas instalar antes

1. Node.js 18+  →  https://nodejs.org  (descarga la versión LTS)
2. PostgreSQL 16 →  https://www.postgresql.org/download/
   (o MySQL 8+   →  https://dev.mysql.com/downloads/mysql/)

---

## PASO 1 — Descargar y descomprimir el proyecto

Descomprime el archivo bunnydjpos-fase3.zip en una carpeta, por ejemplo:
  C:\bunnydjpos\        (Windows)
  /home/tu-usuario/bunnydjpos/   (Linux / Mac)

Estructura que verás:
  bunnydjpos/
    backend/
      server.js
      db.js
      schema.sql
      schema_fase2.sql
      schema_fase3.sql
      package.json
      .env.example
      middleware/
      routes/
    frontend/
      superadmin.html
      admin.html
      pos.html

---

## PASO 2 — Crear la base de datos

### Con PostgreSQL (recomendado):

Abre una terminal y escribe:

  psql -U postgres

Dentro de psql:
  CREATE DATABASE bunnydjpos;
  \q

Luego ejecuta los 3 schemas en orden:
  psql -U postgres -d bunnydjpos -f backend/schema.sql
  psql -U postgres -d bunnydjpos -f backend/schema_fase2.sql
  psql -U postgres -d bunnydjpos -f backend/schema_fase3.sql

### Con MySQL:

  mysql -u root -p
  CREATE DATABASE bunnydjpos CHARACTER SET utf8mb4;
  exit

  mysql -u root -p bunnydjpos < backend/schema.sql
  mysql -u root -p bunnydjpos < backend/schema_fase2.sql
  mysql -u root -p bunnydjpos < backend/schema_fase3.sql

---

## PASO 3 — Configurar el archivo .env

Entra a la carpeta backend y copia el archivo de ejemplo:

  cd backend
  cp .env.example .env     (Linux/Mac)
  copy .env.example .env   (Windows)

Abre .env con cualquier editor de texto (Notepad, VSCode, etc.)
y edita estas líneas con tus datos:

  DB_TYPE=pg               # 'pg' para PostgreSQL | 'mysql' para MySQL
  DB_HOST=localhost
  DB_PORT=5432             # PostgreSQL: 5432  |  MySQL: 3306
  DB_USER=postgres         # tu usuario de base de datos
  DB_PASS=tu_contraseña    # tu contraseña de base de datos
  DB_NAME=bunnydjpos

  JWT_SECRET=pon_aqui_cualquier_texto_largo_y_secreto_2024

  SUPERADMIN_EMAIL=superadmin@bunnydjpos.com
  SUPERADMIN_PASS=Admin123!

Guarda el archivo.

---

## PASO 4 — Instalar dependencias Node.js

Desde la carpeta backend, ejecuta:

  npm install

Esto descarga todas las librerías necesarias (Express, JWT, etc.)
Tarda 1-2 minutos la primera vez.

---

## PASO 5 — Iniciar el servidor

  npm start

Deberías ver en la pantalla:

  🐰 BUNNYDJPOS API → http://localhost:3001
     WebSocket   → ws://localhost:3001?negocio_id=<id>
  ✅ Superadmin creado: superadmin@bunnydjpos.com / Admin123!

Si ves ese mensaje, el servidor está funcionando correctamente.

Para verificar, abre en tu navegador:
  http://localhost:3001/api/health

Deberías ver:  {"ok":true,"version":"1.0.0","name":"BUNNYDJPOS"}

---

## PASO 6 — Abrir los paneles

Abre los archivos HTML directamente en tu navegador:

  frontend/superadmin.html  →  Panel SuperAdmin (gestionar negocios)
  frontend/admin.html       →  Panel Administrativo (cajero, gastos, config)
  frontend/pos.html         →  Punto de venta (mesas, menú, cocina, cobro)

### Credenciales iniciales SuperAdmin:
  Email:      superadmin@bunnydjpos.com
  Contraseña: Admin123!

---

## PASO 7 — Configuración inicial (en orden)

1. Entra al SuperAdmin → crea tu primer negocio (restaurante o minimercado)
2. Activa los módulos que necesitas con los toggles
3. Entra al Admin → crea al menos un usuario con rol Administrador
4. En Admin → Configuración de factura → llena los datos de tu negocio
5. En Admin → Personal → crea los usuarios para meseros y cajeros
6. En POS → Editar menú → crea categorías y artículos del menú
7. En POS → Mesas → crea las mesas de tu restaurante

---

## Para que el servidor arranque automáticamente (PC siempre encendida)

Instala PM2 (gestor de procesos):

  npm install -g pm2
  pm2 start backend/server.js --name bunnydjpos
  pm2 startup
  pm2 save

Con esto el servidor se reinicia automáticamente si se apaga el PC.

Ver logs en tiempo real:
  pm2 logs bunnydjpos

Detener:
  pm2 stop bunnydjpos

---

## Acceso desde celulares y tablets (red WiFi local)

1. El PC servidor debe estar encendido y con el servidor corriendo
2. Conecta los celulares a la misma red WiFi del restaurante
3. Busca la IP del servidor:
     Windows:  ipconfig  (busca "Dirección IPv4", ej: 192.168.1.100)
     Linux/Mac: ip a      (busca inet, ej: 192.168.1.100)
4. En cada celular abre Chrome y entra a:
     http://192.168.1.100:3001/api/health
   Si ves {"ok":true} funciona correctamente
5. Copia los archivos HTML al celular (por WhatsApp, Drive, USB)
   y abre pos.html en Chrome
6. Antes de abrirlo, edita pos.html con un editor de texto
   y cambia la línea:
     const API = 'http://localhost:3001/api';
   por:
     const API = 'http://192.168.1.100:3001/api';
   (usa la IP de tu servidor)

---

## Solución de problemas frecuentes

Error: "ECONNREFUSED" o "no se puede conectar"
  → El servidor no está corriendo. Ejecuta: npm start

Error: "password authentication failed"
  → La contraseña en .env no coincide con la de tu BD

Error: "relation does not exist"
  → No se ejecutaron los schemas SQL. Repite el PASO 2

Error: "Cannot find module"
  → No se instalaron las dependencias. Repite: npm install

Puerto 3001 ocupado
  → Cambia PORT=3002 en el .env y actualiza la URL en los HTML

El navegador dice "ERR_CONNECTION_REFUSED" desde el celular
  → Verifica que el firewall de Windows permita el puerto 3001:
    Panel de control → Firewall → Reglas de entrada → Puerto 3001 TCP

---

## Resumen de comandos

  # Crear BD (PostgreSQL)
  psql -U postgres -c "CREATE DATABASE bunnydjpos;"
  psql -U postgres -d bunnydjpos -f backend/schema.sql
  psql -U postgres -d bunnydjpos -f backend/schema_fase2.sql
  psql -U postgres -d bunnydjpos -f backend/schema_fase3.sql

  # Instalar y arrancar
  cd backend
  npm install
  npm start

  # Producción con PM2
  npm install -g pm2
  pm2 start server.js --name bunnydjpos
  pm2 save
