@echo off
echo ========================================
echo POLYMARKET BOT DIAGNOSTIC
echo ========================================
echo.

echo [1] Checking if Node processes are running...
tasklist /FI "IMAGENAME eq node.exe" 2>NUL | find /I "node.exe" >NUL
if %ERRORLEVEL%==0 (
    echo    Result: Node.exe IS running
) else (
    echo    Result: Node.exe NOT running - start run_system.bat first!
    pause
    exit
)

echo.
echo [2] Current orders.json:
echo ----------------------------------------
type orders.json 2>NUL || echo    ERROR: orders.json not found
echo ----------------------------------------

echo.
echo [3] Current worker_state.json:
echo ----------------------------------------
type data\worker_state.json 2>NUL || echo    ERROR: worker_state.json not found
echo ----------------------------------------

echo.
echo [4] Last 10 Worker logs:
echo ----------------------------------------
powershell -Command "Get-Content 'logs\worker_*.jsonl' -Tail 10" 2>NUL || echo    No worker logs found
echo ----------------------------------------

echo.
echo [5] Last 5 Shadow Exchange logs:
echo ----------------------------------------
powershell -Command "Get-Content 'logs\shadow-exchange_*.jsonl' -Tail 5" 2>NUL || echo    No exchange logs found
echo ----------------------------------------

echo.
echo [6] Checking for errors...
powershell -Command "Select-String -Path 'logs\*.jsonl' -Pattern 'ERROR' | Select-Object -Last 5" 2>NUL
echo ----------------------------------------

echo.
echo Diagnostic complete!
pause
