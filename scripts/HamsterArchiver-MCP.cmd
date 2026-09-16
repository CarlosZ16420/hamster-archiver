@echo off
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0HamsterArchiver.exe" "%~dp0resources\app\src\core\mcp-client.js" %* --disable-crash-reporter --disable-breakpad --disable-gpu --disable-gpu-compositing
exit /b %errorlevel%
