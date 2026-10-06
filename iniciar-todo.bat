@echo off
setlocal enabledelayedexpansion
title BUNNYDJPOS - Lanzador de servicios
color 0A

echo =======================================
echo   BUNNYDJPOS - Iniciando servicios locales
echo =======================================
echo.

set "ROOT=%~dp0"

:: 1) MariaDB (servicio de Windows, ya no XAMPP)
echo [1/3] Verificando MariaDB...
sc query MariaDB | findstr /I "RUNNING" >nul
if %errorlevel%==0 (
    echo       MariaDB ya esta corriendo.
) else (
    echo       MariaDB no esta corriendo. Intentando iniciar el servicio...
    net start MariaDB >nul 2>&1
    if !errorlevel!==0 (
        echo       MariaDB iniciado.
    ) else (
        echo       [AVISO] No se pudo iniciar MariaDB automaticamente ^(hace falta
        echo       ejecutar este .bat como Administrador^). Si el panel de abajo
        echo       no carga datos, abri services.msc e inicia "MariaDB" a mano.
    )
)
echo.

:: 2) Backend principal BUNNYDJPOS - puerto 3001
echo [2/3] Backend principal ^(puerto 3001^)...
netstat -ano | findstr ":3001" | findstr "LISTENING" >nul
if %errorlevel%==0 (
    echo       Ya estaba corriendo.
) else (
    start "BUNNYDJPOS - Backend (3001)" cmd /k "cd /d %ROOT%backend && node server.js"
    echo       Lanzado en una ventana nueva.
)
echo.

:: 3) Backend Control de Personal - puerto 3002
echo [3/3] Backend Control de Personal ^(puerto 3002^)...
netstat -ano | findstr ":3002" | findstr "LISTENING" >nul
if %errorlevel%==0 (
    echo       Ya estaba corriendo.
) else (
    start "Control Personal - Backend (3002)" cmd /k "cd /d %ROOT%control-personal\backend && node server.js"
    echo       Lanzado en una ventana nueva.
)
echo.
echo =======================================
echo   Esperando a que el backend conteste...
echo =======================================

set /a intentos=0
:esperar
curl -s -o nul -w "%%{http_code}" http://localhost:3001/api/health > "%TEMP%\bunny_health.txt" 2>nul
set /p HCODE=<"%TEMP%\bunny_health.txt"
if "!HCODE!"=="200" goto listo
set /a intentos+=1
if !intentos! GEQ 25 goto listo
timeout /t 1 /nobreak >nul
goto esperar

:listo
del "%TEMP%\bunny_health.txt" >nul 2>&1
echo.
echo =======================================
echo   Accesos directos:
echo   Portal / Login    -^> http://localhost:3001/portal
echo   Superadmin        -^> http://localhost:3001/superadmin
echo   Tarjeta cumpleanos-^> http://localhost:3001/cumpleanos
echo   Control Personal  -^> http://localhost:3002
echo =======================================
echo.

start "" "http://localhost:3001/portal"

echo Esta ventana se puede cerrar; los backends siguen corriendo en sus
echo propias ventanas. Para apagarlos todos usa detener-todo.bat
echo.
pause
