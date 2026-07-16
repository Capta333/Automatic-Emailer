@echo off
title Email Campaigner
cd /d "%~dp0"

rem --- Local desktop use: skip the login screen (the hosted build leaves this on) ---
set AUTH_DISABLED=1

rem --- If the server is already up, just open the browser ---
netstat -ano | findstr ":4787" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo Email Campaigner is already running. Opening browser...
  start "" http://localhost:4787
  exit /b
)

rem --- First run: install dependencies if missing ---
if not exist "node_modules" (
  echo First run - installing dependencies, please wait...
  call npm install
)

echo Starting Email Campaigner server...
start "Email Campaigner Server" /min cmd /k node src/server.js

echo Waiting for the server to come up...
timeout /t 3 /nobreak >nul

start "" http://localhost:4787
exit /b
