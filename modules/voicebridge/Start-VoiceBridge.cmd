@echo off
setlocal
cd /d "%~dp0"
if not exist "bin\node.exe" (
  echo Missing bin\node.exe. Extract the entire ZIP before starting.
  pause
  exit /b 1
)
if not exist .env (
  copy /y .env.example .env >nul
  echo First run: configure your API keys, save the file and close Notepad.
  notepad .env
)
echo Starting VoiceBridge 0.6.0 CN. Keep this window open while recording.
"%~dp0bin\node.exe" scripts\launch-portable.mjs
pause
