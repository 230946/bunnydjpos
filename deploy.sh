#!/bin/bash
# Despliegue en el servidor. Ejecutar como el usuario dueño del proyecto (bunnyburgerdj):
#   sudo -u bunnyburgerdj -i bash ~/bunnydjpos/deploy.sh
set -e

# Node puede estar instalado con nvm (solo se carga en shells interactivos)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
command -v npm >/dev/null || { echo "❌ Node/npm no está instalado"; exit 1; }
command -v pm2 >/dev/null || npm install -g pm2

cd ~/bunnydjpos
git pull origin main

cd backend
npm install --omit=dev
pm2 restart bunnydjpos || pm2 start server.js --name bunnydjpos
pm2 save

sleep 3
curl -s http://localhost:3001/api/health && echo && echo "✅ Deploy completado"
