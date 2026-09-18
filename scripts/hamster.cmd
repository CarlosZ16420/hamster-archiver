@echo off
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0HamsterArchiver.exe" "%~dp0resources\app\src\core\hamster-cli.js" %* --disable-crash-reporter --disable-breakpad
exit /b %errorlevel%
