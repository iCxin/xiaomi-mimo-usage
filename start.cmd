@echo off
rem  MiMo Token dashboard launcher (Windows).
rem
rem  Refreshes data.js, starts the background watcher with no console window,
rem  opens the dashboard, then closes this window immediately.
rem
rem  Stop the watcher with stop.cmd. Its log is watch.log.
setlocal
cd /d "%~dp0"

call "%~dp0find-python.cmd"
if errorlevel 1 exit /b 1

rem Refresh once up front so the page opens on current numbers. The watcher is
rem then told to skip its own startup export, avoiding a duplicate write.
"%PY%" watch_tokens.py --once >nul 2>nul

rem A bare command name must not be quoted, or start would look for a file
rem literally named "python". The nul handles keep the detached process from
rem inheriting the caller's std handles.
if /i "%PY%"=="python" goto bare
if /i "%PY%"=="py" goto bare
start "" "%PYW%" watch_tokens.py --no-initial >nul 2>nul <nul
goto openpage

:bare
start "" %PYW% watch_tokens.py --no-initial >nul 2>nul <nul

:openpage
start "" "index.html"

rem No pause and no countdown: this window closes as soon as the page is open.
endlocal
exit /b 0
