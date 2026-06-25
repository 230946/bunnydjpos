@echo off
title BUNNYDJPOS - Servidor
color 0A

echo =======================================
echo   BUNNYDJPOS - Reiniciando servidor
echo =======================================
echo.

:: Matar proceso node.exe si ya esta corriendo
taskkill /F /IM node.exe >nul 2>&1
if %errorlevel% == 0 (
    echo [OK] Servidor anterior detenido.
) else (
    echo [INFO] No habia servidor corriendo.
)

timeout /t 1 /nobreak >nul

:: Iniciar el servidor
echo.
echo [OK] Iniciando servidor...
echo.
cd /d "%~dp0backend"
"C:\Program Files\nodejs\node.exe" server.js

pause
