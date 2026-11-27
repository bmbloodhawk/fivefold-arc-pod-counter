@echo off
setlocal
cd /d "%~dp0.."
node qa\open-premium-studio.mjs
if errorlevel 1 pause
