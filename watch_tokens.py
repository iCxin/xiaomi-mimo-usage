"""Keep data.js in sync with the MiMo usage database.

Watches mimocode.db (and its WAL sidecar, which is what actually changes during
use) and re-runs the export whenever either is touched. The dashboard's own
auto-refresh picks the new numbers up within about 20 seconds.

Normally started by start.cmd / start.sh, which run it detached so no console
window lingers. Output then goes to watch.log next to this file.

Usage:
    python watch_tokens.py                 # auto-detect the database
    python watch_tokens.py --db PATH       # use a specific database
    python watch_tokens.py --interval 3    # poll faster
    python watch_tokens.py --once          # export once and exit
    python watch_tokens.py --no-initial    # skip the startup export
    python watch_tokens.py --status        # report whether a watcher is running
    python watch_tokens.py --stop          # stop a running watcher
"""

import argparse
import atexit
import os
import signal
import sys
import time
from datetime import datetime

# Keep the folder clean: the launcher imports this module, and a __pycache__
# directory next to the dashboard is just noise.
sys.dont_write_bytecode = True

import export_tokens

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PID_PATH = os.path.join(BASE_DIR, "watch.pid")
LOG_PATH = os.path.join(BASE_DIR, "watch.log")
LOG_MAX_BYTES = 512 * 1024


def attach_output():
    """pythonw.exe (Windows) and a detached nohup run (POSIX) may have no usable
    stdout, where every print() would raise. Send output to a log file instead
    so the watcher stays quiet but still leaves a trail."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    # The watcher logs a line per export, so over weeks this would grow without
    # bound. Start fresh once it gets large.
    try:
        if os.path.getsize(LOG_PATH) > LOG_MAX_BYTES:
            os.replace(LOG_PATH, LOG_PATH + ".1")
    except OSError:
        pass
    try:
        handle = open(LOG_PATH, "a", encoding="utf-8", buffering=1)
    except OSError:
        return
    if sys.stdout is None:
        sys.stdout = handle
    if sys.stderr is None:
        sys.stderr = handle


def log(msg):
    try:
        print("[%s] %s" % (datetime.now().strftime("%H:%M:%S"), msg), flush=True)
    except (OSError, ValueError, AttributeError):
        pass


def process_alive(pid):
    """Liveness probe. os.kill(pid, 0) would *terminate* the process on Windows,
    so ask the kernel to open a handle instead."""
    if os.name != "nt":
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True  # exists, just not ours
        except OSError:
            return False
    import ctypes
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    handle = ctypes.windll.kernel32.OpenProcess(
        PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return False
    ctypes.windll.kernel32.CloseHandle(handle)
    return True


def read_pid():
    try:
        with open(PID_PATH, encoding="utf-8") as fh:
            return int(fh.read().strip())
    except (OSError, ValueError):
        return None


def release_pid_file():
    try:
        if read_pid() == os.getpid():
            os.remove(PID_PATH)
    except OSError:
        pass


def running_pid():
    """PID of a live watcher, or None. Cleans up a stale pid file."""
    pid = read_pid()
    if pid and process_alive(pid):
        return pid
    if pid:
        try:
            os.remove(PID_PATH)
        except OSError:
            pass
    return None


def claim_pid_file():
    """Returns the PID of a watcher already running, or None if we took the slot."""
    existing = running_pid()
    if existing:
        return existing
    with open(PID_PATH, "w", encoding="utf-8") as fh:
        fh.write(str(os.getpid()))
    atexit.register(release_pid_file)
    return None


def stop_running():
    pid = running_pid()
    if not pid:
        print("No watcher is running.")
        return 0
    try:
        if os.name == "nt":
            import subprocess
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            os.kill(pid, signal.SIGTERM)
    except OSError as exc:
        print("Could not stop PID %d: %s" % (pid, exc))
        return 1
    for _ in range(20):
        if not process_alive(pid):
            break
        time.sleep(0.1)
    try:
        os.remove(PID_PATH)
    except OSError:
        pass
    print("Stopped watcher (PID %d). The dashboard keeps showing the last snapshot." % pid)
    return 0


def stamp(path):
    try:
        st = os.stat(path)
        return (st.st_mtime_ns, st.st_size)
    except OSError:
        return None


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=None, help="path to mimocode.db (auto-detected if omitted)")
    ap.add_argument("--out", default=export_tokens.default_out())
    ap.add_argument("--interval", type=float, default=3.0,
                    help="seconds between database checks (default 3)")
    ap.add_argument("--settle", type=float, default=0.6,
                    help="seconds to wait after a change before exporting, so a "
                         "burst of writes coalesces into one export")
    ap.add_argument("--min-gap", type=float, default=10.0,
                    help="minimum seconds between exports. The database is touched "
                         "continuously while the app is in use, and the page only "
                         "polls every 20s, so exporting faster than this is wasted "
                         "work (default 10)")
    ap.add_argument("--once", action="store_true", help="export once and exit")
    ap.add_argument("--no-initial", action="store_true",
                    help="skip the export on startup (the launcher already did one)")
    ap.add_argument("--status", action="store_true", help="report watcher state and exit")
    ap.add_argument("--stop", action="store_true", help="stop a running watcher and exit")
    args = ap.parse_args()

    attach_output()

    if args.status:
        pid = running_pid()
        if pid:
            print("watching (PID %d)" % pid)
        else:
            print("not running")
        return 0

    if args.stop:
        return stop_running()

    db, tried = export_tokens.find_db(args.db)
    if not db:
        log("database not found. looked in: %s" % ", ".join(tried))
        log("run MiMo Desktop at least once, or pass --db PATH / set %s"
            % export_tokens.ENV_DB)
        return 1

    if args.once:
        export_tokens.run_export(db, args.out)
        return 0

    already = claim_pid_file()
    if already:
        log("a watcher is already running (PID %d); exiting" % already)
        return 0

    if not args.no_initial:
        log("exporting initial snapshot...")
        export_tokens.run_export(db, args.out, quiet=True)

    # The WAL is the file that moves while the app is running; the main db file
    # can sit untouched for a long time.
    watched = [db, db + "-wal"]
    last = {p: stamp(p) for p in watched}
    log("watching %s (every %.1fs, PID %d)" % (db, args.interval, os.getpid()))

    last_export = time.monotonic()
    try:
        while True:
            time.sleep(args.interval)

            changed = False
            for p in watched:
                s = stamp(p)
                if s != last[p]:
                    last[p] = s
                    changed = True
            if not changed:
                continue

            # Let a burst of writes settle, then re-baseline so we do not
            # immediately export again for the same burst.
            time.sleep(args.settle)
            for p in watched:
                last[p] = stamp(p)

            # Hold off if we exported very recently. Changes that arrive during
            # the wait are not lost: the next poll sees them.
            gap = args.min_gap - (time.monotonic() - last_export)
            if gap > 0:
                time.sleep(gap)

            try:
                payload = export_tokens.run_export(db, args.out, quiet=True)
            except SystemExit as exc:
                log("skipped: %s" % exc)
                continue
            except Exception as exc:  # a locked or mid-write db should not kill the watcher
                log("export failed (%s); will retry on next change" % exc)
                continue

            last_export = time.monotonic()
            t = payload["totals"]
            log("updated data.js - %d requests, %d sessions, %d models"
                % (t["messages"], len(payload["sessions"]), len(payload["models"])))
    except KeyboardInterrupt:
        log("stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
