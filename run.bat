@echo off
setlocal EnableExtensions
title Glaze Music - Dev

rem Always run from the folder this file lives in, so a shortcut or a
rem "Run as administrator" started from C:\Windows still finds package.json.
cd /d "%~dp0"

echo ==========================================
echo   Glaze Music  -  development launcher
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js was not found on PATH.
  echo     Install it from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\electron\package.json" (
  echo [*] Dependencies are missing. Running npm install once...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [X] npm install failed. Fix the errors above, then retry.
    pause
    exit /b 1
  )
  echo.
)

rem A previous session left Vite on 5173 and/or Electron alive. Without this,
rem the new Electron hits the single-instance lock, quits immediately, and the
rem window you expected never appears.
echo [*] Closing any previous Glaze Music dev session...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%P >nul 2>&1
)
taskkill /F /IM electron.exe >nul 2>&1

echo [*] Starting Vite + Electron...
echo     Leave this window open while you use the app.
echo.
call npm run dev

echo.
echo [!] The dev server has stopped.
echo     If this was a crash, the log is at:
echo     %%APPDATA%%\glaze-music\logs\main.log
echo.
pause
