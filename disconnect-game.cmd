@echo off
rem Keep Playing: takes back what connect-game.cmd did (its line in the hosts file,
rem and the certificate Windows was asked to trust).
title Keep Playing
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Keep Playing needs Node.js to do this. Install it from https://nodejs.org ^(the LTS button^), then double-click this file again.
  echo.
  pause
  exit /b 1
)
node tools\connect.js --undo
echo.
pause
