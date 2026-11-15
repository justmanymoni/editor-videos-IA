@echo off
rem Verticut: abre la app y la mantiene actualizada. Haz doble clic en este archivo.
title Verticut
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo No se encuentra Node.js. Instalalo desde https://nodejs.org y vuelve a abrir este archivo.
  pause
  exit /b 1
)
node scripts\start.mjs %*
if errorlevel 1 pause
