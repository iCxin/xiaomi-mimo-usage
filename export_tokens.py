"""Export MiMo Desktop local token usage from mimocode.db into data.js.

MiMo Desktop keeps no history of token usage in its UI — only a context-window
ring beside the composer. The numbers live in the engine's SQLite database, in
the `message` table: every assistant row carries a `tokens` object.

This reads that database (read-only, via a temp copy so a running app never sees
a lock) and emits a self-contained dataset consumed by index.html.

Usage:
    python export_tokens.py                 # auto-detect the database
    python export_tokens.py --db PATH       # use a specific database
    python export_tokens.py --out PATH      # write somewhere else
    python export_tokens.py --print-db      # show what was detected and exit
"""

import argparse
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone

# `MIMO_DB` wins over everything, for users whose data lives somewhere unusual.
ENV_DB = "MIMO_DB"

# The engine stores its database in the platform's data directory. The path is
# XDG-shaped on every platform, which is why the same relative form works for
# Linux and macOS.
def candidate_db_paths():
    home = os.path.expanduser("~")
    out = []

    override = os.environ.get(ENV_DB)
    if override:
        out.append(os.path.expanduser(override))

    xdg = os.environ.get("XDG_DATA_HOME") or os.path.join(home, ".local", "share")
    out.append(os.path.join(xdg, "mimocode", "mimocode.db"))
    out.append(os.path.join(home, ".local", "share", "mimocode", "mimocode.db"))

    if sys.platform == "darwin":
        out.append(os.path.join(home, "Library", "Application Support",
                                "mimocode", "mimocode.db"))
        out.append(os.path.join(home, "Library", "Application Support",
                                "Xiaomi MiMo", "mimocode", "mimocode.db"))

    if os.name == "nt":
        for env in ("APPDATA", "LOCALAPPDATA"):
            base = os.environ.get(env)
            if base:
                out.append(os.path.join(base, "Xiaomi MiMo", "mimocode", "mimocode.db"))
                out.append(os.path.join(base, "mimocode", "mimocode.db"))

    # Preserve order but drop duplicates.
    seen, unique = set(), []
    for p in out:
        if p not in seen:
            seen.add(p)
            unique.append(p)
    return unique


def find_db(explicit=None):
    """First existing candidate, or None. Returns (path, tried)."""
    tried = []
    if explicit:
        p = os.path.expanduser(explicit)
        return (p if os.path.exists(p) else None), [p]
    for p in candidate_db_paths():
        tried.append(p)
        if os.path.exists(p):
            return p, tried
    return None, tried


def default_out():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.js")


def open_readonly(db_path):
    """Copy db (+ wal/shm) to temp so we read a consistent snapshot without
    taking a lock on a database the desktop app is actively writing."""
    tmp = os.path.join(tempfile.gettempdir(), "mimo_token_export.db")
    for suffix in ("", "-wal", "-shm"):
        if os.path.exists(tmp + suffix):
            try:
                os.remove(tmp + suffix)
            except OSError:
                pass
    shutil.copyfile(db_path, tmp)
    for ext in ("-wal", "-shm"):
        side = db_path + ext
        if os.path.exists(side):
            try:
                shutil.copyfile(side, tmp + ext)
            except OSError:
                pass  # a sidecar we cannot copy is not fatal
    con = sqlite3.connect(tmp)
    con.row_factory = sqlite3.Row
    return con


def to_ms(value):
    try:
        value = int(value)
    except (TypeError, ValueError):
        return 0
    return value if value > 0 else 0


def local_dt(ms):
    if not ms:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone()


def local_iso(ms):
    dt = local_dt(ms)
    return dt.isoformat() if dt else None


def local_day(ms):
    dt = local_dt(ms)
    return dt.strftime("%Y-%m-%d") if dt else None


def as_int(value):
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def table_exists(con, name):
    row = con.execute(
        "select 1 from sqlite_master where type='table' and name=?", (name,)
    ).fetchone()
    return row is not None


def columns_of(con, table):
    try:
        return {r["name"] for r in con.execute("pragma table_info(%s)" % table)}
    except sqlite3.Error:
        return set()


def collect(con):
    """Read sessions and token-bearing assistant messages.

    Written defensively: the engine's schema and its message payload have both
    changed across MiMo releases, so every field is treated as optional and a
    row that does not parse is skipped rather than aborting the export.
    """
    if not table_exists(con, "message"):
        raise SystemExit(
            "the database has no `message` table - it does not look like a "
            "MiMo/MiMoCode database"
        )

    msg_cols = columns_of(con, "message")
    sessions = {}
    if table_exists(con, "session"):
        sess_cols = columns_of(con, "session")
        wanted = [c for c in ("id", "title", "time_created", "time_updated",
                              "time_archived", "directory") if c in sess_cols]
        if "id" in wanted:
            for row in con.execute("select %s from session" % ", ".join(wanted)):
                r = dict(row)
                sid = r.get("id")
                if not sid:
                    continue
                sessions[sid] = {
                    "id": sid,
                    "title": (r.get("title") or "").strip(),
                    "directory": r.get("directory") or "",
                    "createdAt": local_iso(to_ms(r.get("time_created"))),
                    "updatedAt": local_iso(to_ms(r.get("time_updated"))),
                    "archived": bool(r.get("time_archived")),
                    "createdMs": to_ms(r.get("time_created")),
                }

    # Session span uses every message, not just the ones reporting usage, so a
    # chat that ends on a plain user turn still counts its full duration.
    spans = {}
    if "session_id" in msg_cols:
        span_cols = [c for c in ("session_id", "time_created", "time_updated")
                     if c in msg_cols]
        if len(span_cols) >= 2:
            for row in con.execute("select %s from message" % ", ".join(span_cols)):
                r = dict(row)
                sid = r.get("session_id")
                if not sid:
                    continue
                c = to_ms(r.get("time_created"))
                u = to_ms(r.get("time_updated")) or c
                span = spans.get(sid)
                if span is None:
                    spans[sid] = [c, u]
                else:
                    if c:
                        span[0] = min(span[0], c) if span[0] else c
                    if u:
                        span[1] = max(span[1], u)

    for sid, (first, last) in spans.items():
        if sid in sessions:
            sessions[sid]["firstMs"] = first
            sessions[sid]["lastMs"] = last
            sessions[sid]["durationMs"] = max(0, last - first)

    events = []
    skipped = 0
    for row in con.execute("select id, session_id, data from message"):
        try:
            obj = json.loads(row["data"])
        except (TypeError, ValueError):
            skipped += 1
            continue
        if not isinstance(obj, dict) or obj.get("role") != "assistant":
            continue

        tokens = obj.get("tokens")
        if not isinstance(tokens, dict):
            continue
        cache = tokens.get("cache") if isinstance(tokens.get("cache"), dict) else {}

        inp = as_int(tokens.get("input"))
        out = as_int(tokens.get("output"))
        reasoning = as_int(tokens.get("reasoning"))
        cache_read = as_int(cache.get("read"))
        cache_write = as_int(cache.get("write"))
        if inp == out == reasoning == cache_read == cache_write == 0:
            continue

        created = to_ms((obj.get("time") or {}).get("created")) \
            if isinstance(obj.get("time"), dict) else 0

        provider = obj.get("providerID") or "unknown"
        model = obj.get("modelID") or "unknown"
        events.append({
            "id": row["id"],
            "sessionId": row["session_id"],
            "provider": provider,
            # Statistics are keyed by the bare model id: the same model reached
            # through two providers is one model, not two.
            "model": model,
            "input": inp,
            "output": out,
            "reasoning": reasoning,
            "cacheRead": cache_read,
            "cacheWrite": cache_write,
            "all": inp + out + reasoning + cache_read + cache_write,
            "cost": float(obj.get("cost") or 0),
            "createdAt": local_iso(created),
            "day": local_day(created),
            "createdMs": created,
            "agent": obj.get("agent") or "main",
            "mode": obj.get("mode") or "",
        })

    events.sort(key=lambda e: e["createdMs"])
    return sessions, events, skipped


def streaks(active_days):
    """Return (current streak ending today, longest streak) over day strings."""
    days = sorted(set(d for d in active_days if d))
    if not days:
        return 0, 0

    longest = run = 1
    for i in range(1, len(days)):
        prev = datetime.strptime(days[i - 1], "%Y-%m-%d")
        cur = datetime.strptime(days[i], "%Y-%m-%d")
        run = run + 1 if (cur - prev).days == 1 else 1
        longest = max(longest, run)

    active = set(days)
    cursor = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    current = 0
    while cursor.strftime("%Y-%m-%d") in active:
        current += 1
        cursor -= timedelta(days=1)
    return current, longest


def build_stats(events, sessions):
    by_day = defaultdict(int)
    for e in events:
        if e["day"]:
            by_day[e["day"]] += e["all"]

    peak_day, peak_tokens = None, 0
    for day, total in by_day.items():
        if total > peak_tokens:
            peak_day, peak_tokens = day, total

    longest = None
    for s in sessions.values():
        dur = s.get("durationMs")
        if dur and (longest is None or dur > longest["durationMs"]):
            longest = {"durationMs": dur, "title": s["title"], "id": s["id"]}

    current, best = streaks(by_day.keys())

    return {
        "cumulativeTokens": sum(e["all"] for e in events),
        "peakDailyTokens": peak_tokens,
        "peakDay": peak_day,
        "longestSessionMs": longest["durationMs"] if longest else 0,
        "longestSessionTitle": longest["title"] if longest else None,
        "currentStreak": current,
        "longestStreak": best,
        "activeDays": len(by_day),
    }


def _blank_bucket():
    return {
        "input": 0, "output": 0, "reasoning": 0,
        "cacheRead": 0, "cacheWrite": 0, "all": 0, "cost": 0.0, "messages": 0,
    }


def build_payload(sessions, events, skipped=0, coverage=None):
    by_session = defaultdict(_blank_bucket)
    by_model = defaultdict(_blank_bucket)
    providers_by_model = defaultdict(set)
    totals = _blank_bucket()
    fields = ("input", "output", "reasoning", "cacheRead", "cacheWrite", "all")

    for e in events:
        for bucket in (by_session[e["sessionId"]], by_model[e["model"]]):
            for f in fields:
                bucket[f] += e[f]
            bucket["cost"] += e["cost"]
            bucket["messages"] += 1
        providers_by_model[e["model"]].add(e["provider"])
        for f in fields:
            totals[f] += e[f]
        totals["cost"] += e["cost"]
        totals["messages"] += 1

    session_list = []
    for sid, agg in by_session.items():
        meta = sessions.get(sid, {})
        session_list.append({
            "id": sid,
            "title": meta.get("title") or "",
            "directory": meta.get("directory", ""),
            "createdAt": meta.get("createdAt"),
            "durationMs": meta.get("durationMs", 0),
            "archived": meta.get("archived", False),
            # True when the conversation is gone from the database but its usage
            # is still counted from the accumulator.
            "deleted": meta.get("deleted", False),
            "exists": sid in sessions,
            **agg,
        })
    session_list.sort(key=lambda s: -(s["input"] + s["output"] + s["cacheWrite"]))

    model_list = [
        {"model": k, "providers": sorted(providers_by_model[k]), **v}
        for k, v in by_model.items()
    ]
    model_list.sort(key=lambda m: -m["all"])

    return {
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(),
        "source": "mimocode.db / message.data",
        "range": {
            "from": events[0]["createdAt"] if events else None,
            "to": events[-1]["createdAt"] if events else None,
        },
        "totals": totals,
        "stats": build_stats(events, sessions),
        "sessions": session_list,
        "models": model_list,
        "skippedMessages": skipped,
        "coverage": coverage or {},
        "events": events,
    }


def write_payload(payload, out_path):
    """Write atomically: the page may be polling data.js while we regenerate,
    and a half-written file would parse as broken JSON."""
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write("// Generated by export_tokens.py - do not edit by hand.\n")
        fh.write("window.MIMO_TOKEN_DATA = ")
        json.dump(payload, fh, ensure_ascii=False, indent=1)
        fh.write(";\n")
    os.replace(tmp, out_path)


def report(payload, out_path):
    t, s = payload["totals"], payload["stats"]
    print("wrote %s" % out_path)
    print("  messages=%d  sessions=%d  models=%d  activeDays=%d"
          % (t["messages"], len(payload["sessions"]), len(payload["models"]),
             s["activeDays"]))
    print("  all=%(all)d input=%(input)d output=%(output)d reasoning=%(reasoning)d "
          "cacheRead=%(cacheRead)d cacheWrite=%(cacheWrite)d" % t)
    print("  peak/day=%d on %s  streaks=%d/%d  longest chat=%.0f min"
          % (s["peakDailyTokens"], s["peakDay"], s["currentStreak"],
             s["longestStreak"], s["longestSessionMs"] / 60000.0))
    cov = payload.get("coverage") or {}
    if cov.get("firstSyncAt"):
        print("  coverage from %s  (%d deleted conversation(s) still counted)"
              % (cov["firstSyncAt"][:19], cov.get("deletedSessions", 0)))
    if payload.get("skippedMessages"):
        print("  skipped %d unparseable message rows" % payload["skippedMessages"])


def run_export(db_path, out_path, quiet=False, use_store=True, store_path=None):
    """Build the snapshot.

    By default the numbers come from the accumulator in usage_store.py rather
    than straight from the database, because deleting a conversation cascades
    away its message rows and would otherwise erase its usage from the totals.
    Pass use_store=False for a raw database-only view.
    """
    if not os.path.exists(db_path):
        raise SystemExit("database not found: %s" % db_path)

    coverage = {}
    if use_store:
        # Imported here because usage_store imports this module.
        import usage_store
        store_path = store_path or usage_store.default_store_path()
        summary = usage_store.sync(db_path, store_path)
        sessions, events, meta = usage_store.load(store_path)
        skipped = summary.get("skipped", 0)
        coverage = {
            "store": os.path.basename(store_path),
            "firstSyncAt": local_iso(summary.get("firstSyncAt")),
            "deletedSessions": summary.get("deletedSessions", 0),
            # Usage deleted from the database before the first sync could not be
            # captured; the dashboard says so rather than implying full history.
            "since": local_iso(summary.get("firstSyncAt")),
        }
    else:
        con = open_readonly(db_path)
        try:
            sessions, events, skipped = collect(con)
        finally:
            con.close()

    payload = build_payload(sessions, events, skipped, coverage)
    write_payload(payload, out_path)
    if not quiet:
        report(payload, out_path)
    return payload


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=None, help="path to mimocode.db (auto-detected if omitted)")
    ap.add_argument("--out", default=default_out(), help="where to write data.js")
    ap.add_argument("--store", default=None,
                    help="path to the usage accumulator (default: usage_history.db "
                         "beside this script)")
    ap.add_argument("--no-store", action="store_true",
                    help="read the database directly, ignoring the accumulator. "
                         "Usage from deleted conversations is missing this way.")
    ap.add_argument("--print-db", action="store_true",
                    help="print the detected database path and exit")
    args = ap.parse_args()

    db, tried = find_db(args.db)
    if args.print_db:
        if db:
            print(db)
            return
        print("no database found. looked in:", file=sys.stderr)
        for p in tried:
            print("  " + p, file=sys.stderr)
        print("\nset %s to point at it explicitly." % ENV_DB, file=sys.stderr)
        raise SystemExit(1)

    if not db:
        print("Could not find mimocode.db. Looked in:", file=sys.stderr)
        for p in tried:
            print("  " + p, file=sys.stderr)
        print("\nMiMo Desktop must be run at least once first. If your data lives "
              "elsewhere,\npoint at it directly:\n"
              "  python export_tokens.py --db /path/to/mimocode.db\n"
              "or set the %s environment variable." % ENV_DB, file=sys.stderr)
        raise SystemExit(1)

    run_export(db, args.out, use_store=not args.no_store, store_path=args.store)


if __name__ == "__main__":
    main()
