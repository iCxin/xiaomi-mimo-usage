#!/bin/sh
# MiMo Token dashboard launcher (macOS / Linux).
#
# Refreshes data.js, starts the background watcher detached, then opens the
# dashboard in your browser. Stop the watcher with ./stop.sh.

set -u
cd "$(dirname "$0")" || exit 1
. ./find-python.sh

PY=$(find_python) || { explain_missing_python; exit 1; }

# Refresh once up front so the page opens on current numbers. The watcher is
# then told to skip its own startup export, avoiding a duplicate write.
"${PY}" watch_tokens.py --once >/dev/null 2>&1 || true

# Detach so this script can exit without taking the watcher with it.
nohup "${PY}" watch_tokens.py --no-initial >/dev/null 2>&1 &
disown 2>/dev/null || true

TARGET="$(pwd)/index.html"
if command -v open >/dev/null 2>&1; then
  open "${TARGET}"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "${TARGET}" >/dev/null 2>&1 &
else
  echo "Open this file in your browser: ${TARGET}"
fi
