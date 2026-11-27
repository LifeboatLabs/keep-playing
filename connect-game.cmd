@echo off
rem Keep Playing: sends a game's PlayFab calls to Keep Playing on this computer,
rem without changing the game's files. disconnect-game.cmd takes it all back.
rem tools\connect.js does the work, and says what each step is for.
title Keep Playing
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Keep Playing needs Node.js, and it isn't installed.
  echo Install it from https://nodejs.org ^(the LTS button^), then double-click this file again.
  echo.
  pause
  exit /b 1
)
node tools\connect.js %*
echo.
pause
