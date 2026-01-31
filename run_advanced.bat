@echo off
title Bot Avançado Polymarket
color 0A
echo.
echo  =====================================================
echo    BOT POLYMARKET - ESTRATEGIA AVANCADA
echo    Dual-Profit Lock (BTC, SOL, XRP)
echo  =====================================================
echo.

REM Encerrar processos anteriores
echo [1/5] Parando processos existentes...
taskkill /F /IM node.exe 2>NUL

REM Criar pasta data se não existir
if not exist "data" mkdir data

REM Aguardar
timeout /t 2 /nobreak >NUL

REM Iniciar Foreman Avançado em background
echo [2/5] Iniciando Foreman Avançado...
start /MIN "Foreman" cmd /c "node src/foreman/advanced_foreman.js"

REM Aguardar foreman inicializar
timeout /t 3 /nobreak >NUL

REM Iniciar Worker Avançado em background
echo [3/5] Iniciando Worker Avançado...
start /MIN "Worker" cmd /c "node src/trader/advanced_worker.js"

REM Aguardar worker inicializar
timeout /t 2 /nobreak >NUL

echo [4/5] Todos os serviços iniciados!
echo.
echo [5/5] Iniciando Dashboard...
echo.

REM Iniciar Dashboard na janela principal
node src/dashboard/clean_dashboard.js
