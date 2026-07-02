# Manual de Despliegue — BunnyDJPOS

## Datos del servidor

| Dato | Valor |
|------|-------|
| IP del servidor | `34.63.16.136` |
| URL de la app | `http://34.63.16.136` |
| Proveedor | Google Cloud (proyecto: bunnydjpos-prod) |
| Sistema operativo | Ubuntu 26.04 |
| Base de datos | MariaDB 11.x |
| Proceso | PM2 (bunnydjpos) |

---

## Credenciales de base de datos (servidor)

| Dato | Valor |
|------|-------|
| Usuario DB | `bunnyapp` |
| Contraseña DB | `Bunny2026!` |
| Base de datos | `bunnydjpos` |
| Host | `localhost` |

---

## Acceder al servidor

1. Ir a [console.cloud.google.com](https://console.cloud.google.com)
2. Menú → **Compute Engine → Instancias de VM**
3. Proyecto: **bunnydjpos-prod**
4. Clic en el botón **SSH** de la VM `bunnydjpos-prod`

---

## Flujo de desarrollo y actualización

### Paso 1 — Hacer cambios en VS Code (tu PC)

Edita los archivos del proyecto normalmente en VS Code.

### Paso 2 — Subir cambios a GitHub

Abre la terminal de VS Code (`Ctrl + ñ`) y ejecuta:

```powershell
cd "C:\Users\Manuel Franco\Desktop\CARPETA\bunnydjpos"
git add .
git commit -m "descripción del cambio"
git push
```

### Paso 3 — Actualizar el servidor

Conéctate por SSH al servidor y ejecuta:

```bash
cd ~/bunnydjpos && git pull && pm2 restart bunnydjpos
```

---

## Comandos útiles en el servidor

### Ver estado de la app
```bash
pm2 status
```

### Ver logs en tiempo real
```bash
pm2 logs bunnydjpos
```

### Reiniciar la app
```bash
pm2 restart bunnydjpos
```

### Detener la app
```bash
pm2 stop bunnydjpos
```

### Verificar que la API responde
```bash
curl http://localhost:3001/api/health
```

### Ver estado de Nginx
```bash
sudo systemctl status nginx
```

### Reiniciar Nginx
```bash
sudo systemctl restart nginx
```

---

## Archivos importantes en el servidor

| Archivo | Ruta |
|---------|------|
| Código del proyecto | `~/bunnydjpos/` |
| Backend | `~/bunnydjpos/backend/` |
| Frontend | `~/bunnydjpos/frontend/` |
| Variables de entorno | `~/bunnydjpos/backend/.env` |
| Logs de PM2 | `~/.pm2/logs/` |
| Config de Nginx | `/etc/nginx/sites-available/bunnydjpos` |

---

## Archivo .env del servidor

Ubicación: `~/bunnydjpos/backend/.env`

```
PORT=3001
DB_HOST=localhost
DB_USER=bunnyapp
DB_PASS=Bunny2026!
DB_NAME=bunnydjpos
JWT_SECRET=bunnydjpos_secret_2026_xK9mP3qR
UPLOADS_DIR=./uploads
```

Para editar: `nano ~/bunnydjpos/backend/.env`

---

## URLs de la aplicación

| Página | URL |
|--------|-----|
| Login principal | `http://34.63.16.136/` |
| Portal de acceso | `http://34.63.16.136/portal.html?n=ID_NEGOCIO` |
| Superadmin | `http://34.63.16.136/superadmin.html` |
| Admin restaurante | `http://34.63.16.136/admin-restaurante.html?n=ID` |
| POS restaurante | `http://34.63.16.136/pos-restaurante.html?n=ID` |
| Admin peluquería | `http://34.63.16.136/admin-peluqueria.html?n=ID` |
| POS peluquería | `http://34.63.16.136/pos-peluqueria.html?n=ID` |
| Admin minimercado | `http://34.63.16.136/admin-minimercado.html?n=ID` |
| POS minimercado | `http://34.63.16.136/pos-minimercado.html?n=ID` |
| Reservas peluquería | `http://34.63.16.136/reservas-peluqueria.html?n=ID` |
| Portal empleado | `http://34.63.16.136/portal-empleado.html?n=ID` |
| Health check | `http://34.63.16.136/api/health` |

---

## Si el servidor se reinicia

La app arranca automáticamente con PM2. Si no arranca, conectarse por SSH y ejecutar:

```bash
cd ~/bunnydjpos/backend
pm2 start server.js --name bunnydjpos
pm2 save
```

---

## Próximos pasos opcionales

1. **Dominio propio**: Apuntar un dominio (ej: `bunnydjpos.com`) a la IP `34.63.16.136`
2. **SSL/HTTPS**: Instalar Certbot para el certificado gratuito de Let's Encrypt
3. **Backups**: Programar backups automáticos de la base de datos
