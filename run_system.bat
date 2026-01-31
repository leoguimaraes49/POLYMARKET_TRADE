@echo off
echo Starting Polymarket Assistant System...

REM Start Foreman in a new MINIMIZED window
start "Foreman (Coordinator)" /min cmd /k "npm run foreman"

REM Start Worker in a new MINIMIZED window
start "Worker (Trader)" /min cmd /k "npm run worker"

REM Wait a few seconds for initialization
timeout /t 3

REM Start Dashboard in the MAIN window
echo Launching Dashboard...
npm run dashboard
