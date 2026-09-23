@echo off
rem  Stops the background watcher started by start.cmd.
setlocal
cd /d "%~dp0"

call "%~dp0find-python.cmd"
if errorlevel 1 exit /b 1

"%PY%" watch_tokens.py --stop
ping -n 3 127.0.0.1 >nul
endlocal
exit /b 0
