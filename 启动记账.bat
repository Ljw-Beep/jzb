@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\server.ps1" %*
if errorlevel 1 (
  echo.
  echo Server exited with an error. Press any key to close.
  pause >nul
)
