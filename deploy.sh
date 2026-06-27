#!/bin/bash
cd ~/bunnydjpos
git pull origin main
pm2 restart all
echo "✅ Deploy completado"
