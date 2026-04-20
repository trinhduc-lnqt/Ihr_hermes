@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "TASK_NAME=IHR Telegram Bot Boot"
set "SCRIPT_PATH=%~dp0src\index.js"

echo ========================================
echo IHR Telegram Bot - Boot Status
echo ========================================
echo.

schtasks /query /tn "%TASK_NAME%" /fo LIST /v
echo.
echo Process dang chay:
powershell -NoProfile -ExecutionPolicy Bypass -Command "$needle = $env:SCRIPT_PATH.ToLowerInvariant(); Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($needle) } | Select-Object ProcessId, CreationDate, CommandLine | Format-List"
echo.
pause
