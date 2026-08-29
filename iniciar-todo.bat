@echo off
title BUNNYDJPOS - Lanzador de servicios
color 0A

echo =======================================
echo   BUNNYDJPOS - Iniciando todos los servicios
echo =======================================
echo.

set "ROOT=%~dp0"
set "XAMPP_MYSQL_START=C:\xampp\mysql_start.bat"

:: 1) MySQL (XAMPP)
echo [1/3] Iniciando MySQL (XAMPP)...
if exist "%XAMPP_MYSQL_START%" (
    start "MySQL - XAMPP" cmd /k "%XAMPP_MYSQL_START%"
) else (
    echo [AVISO] No se encontro %XAMPP_MYSQL_START%. Inicia MySQL manualmente desde el panel de XAMPP.
)
timeout /t 3 /nobreak >nul

:: 2) Backend principal (BUNNYDJPOS) - puerto 3001
echo [2/3] Iniciando backend principal (puerto 3001)...
start "BUNNYDJPOS - Backend (3001)" cmd /k "cd /d %ROOT%backend && node server.js"
timeout /t 2 /nobreak >nul

:: 3) Backend Control de Personal - puerto 3002
echo [3/3] Iniciando backend Control de Personal (puerto 3002)...
start "Control Personal - Backend (3002)" cmd /k "cd /d %ROOT%control-personal\backend && node server.js"
timeout /t 2 /nobreak >nul

echo.
echo =======================================
echo   Todos los servicios fueron lanzados.
echo   BUNNYDJPOS       -^> http://localhost:3001
echo   Control Personal -^> http://localhost:3002
echo =======================================
echo.

start "" "http://localhost:3001/portal"

pause
