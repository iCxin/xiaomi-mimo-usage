#!/bin/sh
# Locates a usable Python 3 and prints its path.
# Sourced by start.sh and stop.sh; not meant to be run directly.

find_python() {
  # 1) Explicit override, for installs we would never guess.
  if [ -n "${MIMO_PYTHON:-}" ] && [ -x "${MIMO_PYTHON}" ]; then
    printf '%s\n' "${MIMO_PYTHON}"
    return 0
  fi

  # 2) A real Python 3 on PATH. Check for sqlite3 too: some minimal builds ship
  #    without it, and the failure would otherwise be a confusing traceback.
  for candidate in python3 python; do
    if command -v "${candidate}" >/dev/null 2>&1 &&
       "${candidate}" -c 'import sqlite3' >/dev/null 2>&1; then
      command -v "${candidate}"
      return 0
    fi
  done

  # 3) The runtime MiMo Desktop bundles, wherever the app was installed.
  for root in \
    "/Applications/Xiaomi MiMo.app/Contents/Resources" \
    "${HOME}/Applications/Xiaomi MiMo.app/Contents/Resources" \
    "/opt/Xiaomi MiMo/resources" \
    "/usr/lib/Xiaomi MiMo/resources" \
    "${HOME}/.local/share/Xiaomi MiMo/resources" \
    "${HOME}/.local/opt/Xiaomi MiMo/resources"
  do
    [ -d "${root}/runtimes" ] || continue
    found=$(find "${root}/runtimes" -maxdepth 4 -type f \
      \( -name python3 -o -name python \) 2>/dev/null | head -n 1)
    if [ -n "${found}" ] && [ -x "${found}" ]; then
      printf '%s\n' "${found}"
      return 0
    fi
  done

  return 1
}

# Prints the standard "install Python" guidance to stderr.
explain_missing_python() {
  {
    echo "Python 3 was not found."
    echo
    echo "  macOS: brew install python3"
    echo "  Linux: install python3 with your package manager"
    echo
    echo "Or point MIMO_PYTHON at an interpreter, e.g."
    echo "  MIMO_PYTHON=/usr/bin/python3 ./start.sh"
  } >&2
}
