@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo IHR Telegram Bot - Boot Task Installer
echo ========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_boot_task.ps1"
if errorlevel 1 (
  echo.
  echo [LOI] Khong tao duoc Scheduled Task boot.
  echo Hay mo CMD/PowerShell bang Run as administrator roi chay lai.
  echo.
  pause
  exit /b 1
)

echo.
echo [OK] Da tao Scheduled Task chay bot luc boot truoc khi logon Windows.
echo Task name: IHR Telegram Bot Boot
echo Bot dang do PM2 giu trong phien hien tai, task moi se co hieu luc o lan reboot tiep theo.
echo.
pause
