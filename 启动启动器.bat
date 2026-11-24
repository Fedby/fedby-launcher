@echo off
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
"node_modules\electron\dist\electron.exe" .
if errorlevel 1 goto failed
exit /b 0
:failed
echo Failed to start. Please run npm install first.
pause
