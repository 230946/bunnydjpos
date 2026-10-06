@echo off
title BUNNYDJPOS - Detener servicios
color 0C

echo =======================================
echo   BUNNYDJPOS - Deteniendo servicios locales
echo =======================================
echo.

echo Cerrando backend principal (puerto 3001)...
set "found3001="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%p >nul 2>&1
    set "found3001=1"
)
if defined found3001 (echo   Detenido.) else (echo   No estaba corriendo.)

echo Cerrando backend Control de Personal (puerto 3002)...
set "found3002="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3002" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%p >nul 2>&1
    set "found3002=1"
)
if defined found3002 (echo   Detenido.) else (echo   No estaba corriendo.)

echo.
echo MariaDB se deja corriendo (es un servicio de Windows compartido).
echo Si de verdad queres pararlo: net stop MariaDB  (como Administrador)
echo.
pause
