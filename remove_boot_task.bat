@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo IHR Telegram Bot - Remove Boot Task
echo ========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0remove_boot_task.ps1"
if errorlevel 1 (
  echo.
  echo [LOI] Khong xoa duoc Scheduled Task boot.
  echo Hay mo CMD/PowerShell bang Run as administrator roi chay lai.
  echo.
  pause
  exit /b 1
)

echo.
echo [OK] Da go Scheduled Task boot.
echo.
pause
