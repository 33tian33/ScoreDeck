@echo off
setlocal
cd /d "%~dp0"
tasklist /FI "IMAGENAME eq ts3client_win64.exe" /NH 2>nul | find /I "ts3client_win64.exe" >nul
if not errorlevel 1 (
  echo Close TeamSpeak 3 completely, then run this installer again.
  pause
  exit /b 1
)
if not exist "plugin\voicebridge_win64.dll" (
  echo Plugin missing. Extract the entire ZIP first.
  pause
  exit /b 1
)
set "VB_PLUGIN_DIR=%APPDATA%\TS3Client\plugins"
if not "%~1"=="" set "VB_PLUGIN_DIR=%~1"
if not exist "%VB_PLUGIN_DIR%" mkdir "%VB_PLUGIN_DIR%"
if errorlevel 1 (
  echo Cannot create the plugin directory.
  pause
  exit /b 1
)
if exist "%VB_PLUGIN_DIR%\voicebridge_win64.dll" (
  copy /y "%VB_PLUGIN_DIR%\voicebridge_win64.dll" "%VB_PLUGIN_DIR%\voicebridge_win64.dll.backup-%RANDOM%" >nul
  if errorlevel 1 (
    echo Failed to back up the old plugin. No replacement was made.
    pause
    exit /b 1
  )
)
copy /y "plugin\voicebridge_win64.dll" "%VB_PLUGIN_DIR%\voicebridge_win64.dll" >nul
if errorlevel 1 (
  echo Copy failed. Check that TeamSpeak is closed and the folder is writable.
  pause
  exit /b 1
)
echo Installed to "%VB_PLUGIN_DIR%\voicebridge_win64.dll"
echo Open TeamSpeak 3 and enable VoiceBridge 0.5.0 in Addons.
pause
