@echo off
setlocal
cd /d "%~dp0"
"%~dp0bin\node.exe" scripts\verify-package.mjs
pause
