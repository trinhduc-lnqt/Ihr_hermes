@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "TASK_NAME=IHR Telegram Bot Boot"
set "SCRIPT_PATH=%~dp0src\index.js"

echo ========================================
echo IHR Telegram Bot - Restart Boot Task
echo ========================================
echo.

schtasks /end /tn "%TASK_NAME%" >nul 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "$needle = $env:SCRIPT_PATH.ToLowerInvariant(); Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($needle) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul

schtasks /run /tn "%TASK_NAME%"
if errorlevel 1 (
  echo.
  echo [LOI] Khong restart duoc task %TASK_NAME%.
  pause
  exit /b 1
)

echo.
echo [OK] Da restart task %TASK_NAME%.
echo.
schtasks /query /tn "%TASK_NAME%" /fo LIST /v
echo.
pause
