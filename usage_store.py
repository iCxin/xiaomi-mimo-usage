"""A durable record of token usage that survives conversation deletion.

Why this exists
---------------
The engine's `message` table declares

    session_id -> session.id ON DELETE CASCADE

so deleting a conversation hard-deletes its messages. The usage numbers go with
them, and the dashboard can only ever report what is still in the database —
which is why totals drift downwards as chats are cleaned up.

This keeps our own copy. Every sync reads the database and upserts each
usage-bearing message into a local SQLite file keyed by message id, so a message
that later disappears from the database is still counted. Sessions are tracked
separately so a deleted one keeps its title and directory.

Idempotent: syncing repeatedly, or after the store is deleted, is safe. The one
thing it cannot do is recover usage that was already deleted before the first
sync — `first_sync_at` records when coverage begins.

Usage:
    python usage_store.py --sync      # fold the database into the store
    python usage_store.py --stats     # what the store holds
"""

import argparse
import os
import sqlite3
import sys
from datetime import datetime, timezone

sys.dont_write_bytecode = True

import export_tokens

STORE_NAME = "usage_history.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS usage (
    message_id  TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    model       TEXT,
    provider    TEXT,
    input       INTEGER NOT NULL DEFAULT 0,
    output      INTEGER NOT NULL DEFAULT 0,
    reasoning   INTEGER NOT NULL DEFAULT 0,
    cache_read  INTEGER NOT NULL DEFAULT 0,
    cache_write INTEGER NOT NULL DEFAULT 0,
    created_ms  INTEGER NOT NULL DEFAULT 0,
    day         TEXT
);
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage(session_id);
CREATE INDEX IF NOT EXISTS idx_usage_day     ON usage(day);

CREATE TABLE IF NOT EXISTS session_meta (
    session_id   TEXT PRIMARY KEY,
    title        TEXT,
    directory    TEXT,
    created_ms   INTEGER NOT NULL DEFAULT 0,
    updated_ms   INTEGER NOT NULL DEFAULT 0,
    duration_ms  INTEGER NOT NULL DEFAULT 0,
    first_seen_ms INTEGER NOT NULL DEFAULT 0,
    last_seen_ms  INTEGER NOT NULL DEFAULT 0,
    archived     INTEGER NOT NULL DEFAULT 0,
    deleted      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS store_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


def default_store_path():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), STORE_NAME)


def open_store(path):
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def now_ms():
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def get_meta(con, key, default=None):
    row = con.execute("select value from store_meta where key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_meta(con, key, value):
    con.execute(
        "insert into store_meta(key, value) values(?, ?) "
        "on conflict(key) do update set value = excluded.value",
        (key, str(value)),
    )


def sync(db_path, store_path):
    """Fold everything currently in the database into the store.

    Returns a summary dict. Safe to call repeatedly.
    """
    live = export_tokens.open_readonly(db_path)
    try:
        sessions, events, skipped = export_tokens.collect(live)
    finally:
        live.close()

    con = open_store(store_path)
    try:
        stamp = now_ms()
        first_sync = get_meta(con, "first_sync_at")
        if not first_sync:
            set_meta(con, "first_sync_at", stamp)

        before_usage = con.execute("select count(*) from usage").fetchone()[0]
        before_sessions = con.execute("select count(*) from session_meta").fetchone()[0]

        # --- sessions -------------------------------------------------------
        for sid, meta in sessions.items():
            row = con.execute(
                "select first_seen_ms from session_meta where session_id = ?", (sid,)
            ).fetchone()
            first_seen = row["first_seen_ms"] if row else stamp
            con.execute(
                """insert into session_meta
                     (session_id, title, directory, created_ms, updated_ms,
                      duration_ms, first_seen_ms, last_seen_ms, archived, deleted)
                   values (?,?,?,?,?,?,?,?,?,0)
                   on conflict(session_id) do update set
                     title       = excluded.title,
                     directory   = excluded.directory,
                     created_ms  = excluded.created_ms,
                     updated_ms  = excluded.updated_ms,
                     duration_ms = excluded.duration_ms,
                     last_seen_ms = excluded.last_seen_ms,
                     archived    = excluded.archived,
                     deleted     = 0""",
                (sid, meta.get("title") or "", meta.get("directory") or "",
                 meta.get("createdMs") or 0,
                 _iso_to_ms(meta.get("updatedAt")),
                 meta.get("durationMs") or 0, first_seen, stamp,
                 1 if meta.get("archived") else 0),
            )

        # Anything we have on record that the database no longer knows about was
        # deleted; keep its usage, just mark it.
        newly_deleted = 0
        for row in con.execute(
            "select session_id from session_meta where deleted = 0"
        ).fetchall():
            if row["session_id"] not in sessions:
                con.execute(
                    "update session_meta set deleted = 1 where session_id = ?",
                    (row["session_id"],),
                )
                newly_deleted += 1

        # --- usage ----------------------------------------------------------
        for e in events:
            con.execute(
                """insert into usage
                     (message_id, session_id, model, provider, input, output,
                      reasoning, cache_read, cache_write, created_ms, day)
                   values (?,?,?,?,?,?,?,?,?,?,?)
                   on conflict(message_id) do update set
                     input       = excluded.input,
                     output      = excluded.output,
                     reasoning   = excluded.reasoning,
                     cache_read  = excluded.cache_read,
                     cache_write = excluded.cache_write,
                     model       = excluded.model,
                     provider    = excluded.provider,
                     day         = excluded.day""",
                (e["id"], e["sessionId"], e["model"], e["provider"],
                 e["input"], e["output"], e["reasoning"], e["cacheRead"],
                 e["cacheWrite"], e["createdMs"], e["day"]),
            )

        set_meta(con, "last_sync_at", stamp)
        set_meta(con, "db_path", db_path)
        con.commit()

        after_usage = con.execute("select count(*) from usage").fetchone()[0]
        after_sessions = con.execute("select count(*) from session_meta").fetchone()[0]
        return {
            "newMessages": after_usage - before_usage,
            "newSessions": after_sessions - before_sessions,
            "newlyDeleted": newly_deleted,
            "totalMessages": after_usage,
            "totalSessions": after_sessions,
            "deletedSessions": con.execute(
                "select count(*) from session_meta where deleted = 1").fetchone()[0],
            "skipped": skipped,
            "firstSyncAt": int(get_meta(con, "first_sync_at")),
        }
    finally:
        con.close()


def _iso_to_ms(iso):
    if not iso:
        return 0
    try:
        return int(datetime.fromisoformat(iso).timestamp() * 1000)
    except (TypeError, ValueError):
        return 0


def load(store_path):
    """Return (sessions, events) in the same shape export_tokens produces.

    Sessions come back including deleted ones, flagged so the UI can say so.
    """
    con = open_store(store_path)
    try:
        sessions = {}
        for r in con.execute("select * from session_meta"):
            sessions[r["session_id"]] = {
                "id": r["session_id"],
                "title": r["title"] or "",
                "directory": r["directory"] or "",
                "createdMs": r["created_ms"],
                "createdAt": export_tokens.local_iso(r["created_ms"]),
                "durationMs": r["duration_ms"],
                "archived": bool(r["archived"]),
                "deleted": bool(r["deleted"]),
            }

        events = []
        for r in con.execute("select * from usage order by created_ms"):
            events.append({
                "id": r["message_id"],
                "sessionId": r["session_id"],
                "provider": r["provider"] or "unknown",
                "model": r["model"] or "unknown",
                "input": r["input"],
                "output": r["output"],
                "reasoning": r["reasoning"],
                "cacheRead": r["cache_read"],
                "cacheWrite": r["cache_write"],
                "all": (r["input"] + r["output"] + r["reasoning"]
                        + r["cache_read"] + r["cache_write"]),
                "cost": 0.0,
                "createdAt": export_tokens.local_iso(r["created_ms"]),
                "day": r["day"],
                "createdMs": r["created_ms"],
                "agent": "main",
                "mode": "",
            })

        meta = {r["key"]: r["value"] for r in con.execute("select * from store_meta")}
        return sessions, events, meta
    finally:
        con.close()


def stats(store_path):
    con = open_store(store_path)
    try:
        def one(sql):
            return con.execute(sql).fetchone()[0]
        return {
            "messages": one("select count(*) from usage"),
            "sessions": one("select count(*) from session_meta"),
            "deletedSessions": one("select count(*) from session_meta where deleted = 1"),
            "firstSyncAt": int(get_meta(con, "first_sync_at") or 0),
            "lastSyncAt": int(get_meta(con, "last_sync_at") or 0),
            "firstDay": one("select min(day) from usage"),
            "lastDay": one("select max(day) from usage"),
        }
    finally:
        con.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--store", default=default_store_path())
    ap.add_argument("--db", default=None, help="database to fold in (auto-detected)")
    ap.add_argument("--sync", action="store_true")
    ap.add_argument("--stats", action="store_true")
    args = ap.parse_args()

    if args.sync:
        db, tried = export_tokens.find_db(args.db)
        if not db:
            print("database not found. looked in:\n  " + "\n  ".join(tried), file=sys.stderr)
            return 1
        r = sync(db, args.store)
        print("store: %s" % args.store)
        print("  +%d messages, +%d sessions, %d newly deleted"
              % (r["newMessages"], r["newSessions"], r["newlyDeleted"]))
        print("  total %d messages across %d sessions (%d deleted, usage retained)"
              % (r["totalMessages"], r["totalSessions"], r["deletedSessions"]))
        if r["skipped"]:
            print("  skipped %d unparseable rows" % r["skipped"])
        return 0

    if args.stats:
        s = stats(args.store)
        print("store: %s" % args.store)
        print("  messages        : %d" % s["messages"])
        print("  sessions        : %d (%d deleted, usage retained)"
              % (s["sessions"], s["deletedSessions"]))
        print("  days covered    : %s .. %s" % (s["firstDay"], s["lastDay"]))
        for label, key in (("first sync", "firstSyncAt"), ("last sync", "lastSyncAt")):
            v = s[key]
            print("  %-15s : %s" % (label, export_tokens.local_iso(v) if v else "-"))
        return 0

    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
