@echo off
title Finboard Local Server
echo Avvio del server locale di Finboard...
powershell.exe -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
