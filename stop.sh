#!/bin/sh
# Stops the background watcher started by ./start.sh.

set -u
cd "$(dirname "$0")" || exit 1
. ./find-python.sh

PY=$(find_python) || { explain_missing_python; exit 1; }

exec "${PY}" watch_tokens.py --stop
