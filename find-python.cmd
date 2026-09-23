@echo off
rem  Locates a usable Python 3 and sets PY (interpreter) and PYW (windowless
rem  twin, for the background watcher).
rem
rem  Called by start.cmd and stop.cmd. Deliberately has no setlocal, so the
rem  variables land in the caller's scope. Assumes the caller has cd'd to the
rem  project directory.
rem
rem  ASCII only on purpose: a .cmd file is read in the OEM codepage, and
rem  non-ASCII bytes there are a reliable source of broken parsing.

set "PY="

rem Everything that will be referenced inside a parenthesised block is computed
rem here first. cmd expands %VAR% when it PARSES a block, not when each line
rem runs, so a variable set on one line of a block is still empty on the next.
set "PROBE=%TEMP%\mimo_python_probe.txt"
set "PF=%ProgramFiles%"
set "PF86=%ProgramFiles(x86)%"

rem 1) Explicit override, for installs we would never guess.
if defined MIMO_PYTHON if exist "%MIMO_PYTHON%" set "PY=%MIMO_PYTHON%"

rem 2) A real Python on PATH. The Microsoft Store alias is a stub that exits
rem    non-zero, so test it rather than trusting `where`.
if not defined PY python --version >nul 2>nul && set "PY=python"
if not defined PY py --version >nul 2>nul && set "PY=py"

rem 3) The runtime MiMo Desktop bundles, located through its uninstall registry
rem    entry. Written to a temp file rather than captured with for/f, because
rem    nesting PowerShell quotes inside a for/f backtick command is a quoting
rem    minefield.
if not defined PY (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$roots = @(); foreach ($k in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) { Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*MiMo*' } | ForEach-Object { if ($_.DisplayIcon) { $roots += (Split-Path ($_.DisplayIcon -replace ',\d+$','')) } } }; foreach ($r in $roots) { $base = Join-Path $r 'resources\runtimes'; if (Test-Path $base) { Get-ChildItem $base -Recurse -Filter 'python.exe' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName } }" > "%PROBE%" 2>nul
  if exist "%PROBE%" for /f "usebackq delims=" %%i in ("%PROBE%") do if not defined PY set "PY=%%i"
  if exist "%PROBE%" del "%PROBE%" >nul 2>nul
)

rem 4) Common install locations, in case the registry entry is missing.
rem    ProgramFiles can be undefined in a trimmed-down environment, so guard it
rem    rather than letting it expand into a bogus relative path.
if not defined PY if defined PF call :try_root "%PF%\Xiaomi MiMo"
if not defined PY if defined PF86 call :try_root "%PF86%\Xiaomi MiMo"
if not defined PY call :try_root "%LOCALAPPDATA%\Programs\Xiaomi MiMo"
if not defined PY call :try_root "%LOCALAPPDATA%\Xiaomi MiMo"
if not defined PY call :try_root "C:\Mimo\Xiaomi MiMo"
if not defined PY call :try_root "D:\Mimo\Xiaomi MiMo"

if not defined PY (
  echo.
  echo   Python 3 was not found.
  echo.
  echo   Install Python 3 from https://www.python.org/downloads/
  echo   or set MIMO_PYTHON to a python.exe path.
  echo.
  pause
  exit /b 1
)

rem The windowless twin, so the background watcher gets no console.
set "PYW=%PY:python.exe=pythonw.exe%"
if /i "%PY%"=="python" set "PYW=pythonw"
if /i "%PY%"=="py" set "PYW=pyw"
exit /b 0

rem --- helpers ---------------------------------------------------------------
rem Kept below the exit so a normal run never falls into them.

:try_root
if not defined PY if exist "%~1\resources\runtimes" (
  for /f "delims=" %%p in ('dir /b /s "%~1\resources\runtimes\python.exe" 2^>nul') do (
    if not defined PY set "PY=%%p"
  )
)
exit /b 0
