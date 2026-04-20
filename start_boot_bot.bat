@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "TASK_NAME=IHR Telegram Bot Boot"

echo ========================================
echo IHR Telegram Bot - Start Boot Task
echo ========================================
echo.

schtasks /run /tn "%TASK_NAME%"
if errorlevel 1 (
  echo.
  echo [LOI] Khong start duoc task %TASK_NAME%.
  pause
  exit /b 1
)

echo.
echo [OK] Da gui lenh chay task %TASK_NAME%.
echo.
schtasks /query /tn "%TASK_NAME%" /fo LIST /v
echo.
pause
