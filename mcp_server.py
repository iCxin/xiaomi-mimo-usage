"""MCP server exposing MiMo token usage to an agent.

Speaks the Model Context Protocol over stdio (newline-delimited JSON-RPC 2.0),
implemented directly so the project keeps its "no dependencies" promise — the
official SDK is not installed anywhere on a stock MiMo Desktop.

Reads the engine's SQLite database the same way the dashboard does, so answers
match what the dashboard shows.

Register it in the MiMoCode config (Settings -> MCP edits the same file):

    "mcp": {
      "mimo-usage": {
        "type": "local",
        "command": ["<python>", "E:\\\\path\\\\to\\\\mcp_server.py"],
        "enabled": true
      }
    }

Self-test without a client:

    python mcp_server.py --selftest
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta

# Keep the folder clean: this imports export_tokens, which would otherwise drop
# a __pycache__ next to the dashboard.
sys.dont_write_bytecode = True

import export_tokens

PROTOCOL_VERSION = "2024-11-05"
SERVER_NAME = "mimo-usage"
SERVER_VERSION = "1.0.0"

# ---------------------------------------------------------------- tool defs

TOOLS = [
    {
        "name": "usage_summary",
        "description": (
            "Totals for MiMo Desktop token usage: cumulative tokens, the busiest "
            "day, the longest chat, and current/longest daily streaks. Use for "
            "questions like 'how many tokens have I used' or 'how many days in a "
            "row have I used MiMo'. Note: no monetary cost is available — the "
            "database's cost field is always 0."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "days": {
                    "type": "integer",
                    "description": "Only count the last N days. Omit for all time.",
                }
            },
        },
    },
    {
        "name": "usage_by_model",
        "description": (
            "Per-model token breakdown: input, output, reasoning, cache reads, "
            "total tokens and request counts, merged across providers. Use for "
            "'which model do I use most' or 'how much did model X cost me in "
            "tokens'. Counts are tokens, never currency."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "days": {
                    "type": "integer",
                    "description": "Only count the last N days. Omit for all time.",
                }
            },
        },
    },
    {
        "name": "usage_by_session",
        "description": (
            "Token usage per conversation, heaviest first, with the session "
            "title and working directory. Use to find which chats consumed the "
            "most tokens."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "days": {
                    "type": "integer",
                    "description": "Only count the last N days. Omit for all time.",
                },
                "limit": {
                    "type": "integer",
                    "description": "How many sessions to return (default 10, max 50).",
                },
            },
        },
    },
    {
        "name": "usage_timeline",
        "description": (
            "Daily token totals as a time series. Use for 'how much did I use "
            "each day', trend questions, or to find the busiest day."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "days": {
                    "type": "integer",
                    "description": "How many days back to include (default 14, max 366).",
                }
            },
        },
    },
]

# ---------------------------------------------------------------- data access


def load(days=None):
    """Read usage, optionally windowed to N days.

    Goes through the accumulator rather than the database directly: deleting a
    conversation cascades its message rows away, so a raw read would quietly
    under-report.
    """
    db, tried = export_tokens.find_db()
    if not db:
        raise RuntimeError(
            "mimocode.db not found. Looked in: %s. Run MiMo Desktop at least "
            "once, or set the %s environment variable."
            % (", ".join(tried), export_tokens.ENV_DB)
        )

    # Imported here because usage_store imports export_tokens.
    import usage_store

    store_path = usage_store.default_store_path()
    summary = usage_store.sync(db, store_path)
    sessions, events, _ = usage_store.load(store_path)

    if days:
        cutoff = (datetime.now().astimezone() - timedelta(days=days - 1)).strftime("%Y-%m-%d")
        events = [e for e in events if e["day"] and e["day"] >= cutoff]

    payload = export_tokens.build_payload(sessions, events, summary.get("skipped", 0), {
        "firstSyncAt": export_tokens.local_iso(summary.get("firstSyncAt")),
        "deletedSessions": summary.get("deletedSessions", 0),
    })
    payload["dbPath"] = db
    return payload


def fmt_int(n):
    return "{:,}".format(int(n or 0))


def fmt_tokens(n):
    n = int(n or 0)
    if n >= 1_000_000_000:
        return "%.2fB" % (n / 1_000_000_000)
    if n >= 1_000_000:
        return "%.2fM" % (n / 1_000_000)
    if n >= 1_000:
        return "%.1fK" % (n / 1_000)
    return str(n)


def fmt_duration(ms):
    if not ms:
        return "0 min"
    minutes = round(ms / 60000)
    if minutes >= 1440:
        return "%d d %d h" % (minutes // 1440, (minutes % 1440) // 60)
    if minutes >= 60:
        return "%d h %d min" % (minutes // 60, minutes % 60)
    return "%d min" % minutes


def window_note(payload, days):
    r = payload.get("range") or {}
    if days:
        return "window: last %d days" % days
    return "window: all time (%s to %s)" % (
        (r.get("from") or "?")[:10], (r.get("to") or "?")[:10])


# ---------------------------------------------------------------- formatters


def tool_summary(args):
    days = args.get("days")
    p = load(days)
    t, s = p["totals"], p["stats"]

    lines = [
        "# MiMo token usage",
        "",
        window_note(p, days),
        "",
        "| metric | value |",
        "| --- | --- |",
        "| Total tokens (all types) | %s (%s) |" % (fmt_tokens(t["all"]), fmt_int(t["all"])),
        "| Input | %s |" % fmt_int(t["input"]),
        "| Output | %s |" % fmt_int(t["output"]),
        "| Reasoning | %s |" % fmt_int(t["reasoning"]),
        "| Cache read | %s |" % fmt_int(t["cacheRead"]),
        "| Cache write | %s |" % fmt_int(t["cacheWrite"]),
        "| Billed (in + out + cache write) | %s |" % fmt_int(
            t["input"] + t["output"] + t["cacheWrite"]),
        "| Requests | %s |" % fmt_int(t["messages"]),
        "| Active days | %s |" % s["activeDays"],
        "| Peak day | %s (%s tokens) |" % (s["peakDay"] or "-", fmt_int(s["peakDailyTokens"])),
        "| Current streak | %d days |" % s["currentStreak"],
        "| Longest streak | %d days |" % s["longestStreak"],
        "| Longest chat | %s |" % fmt_duration(s["longestSessionMs"]),
        "",
        "Monetary cost is not available: MiMo Desktop writes 0 into the database's",
        "`cost` field, so any currency figure would be invented. These are token",
        "counts only.",
    ]
    return "\n".join(lines)


def tool_by_model(args):
    days = args.get("days")
    p = load(days)
    models = p["models"]
    if not models:
        return "No usage recorded%s." % (" in that window" if days else "")

    total = sum(m["all"] for m in models)
    lines = [
        "# Usage by model",
        "",
        window_note(p, days),
        "",
        "| model | share | total | input | output | reasoning | cache read | requests | providers |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for m in models:
        share = ("%.1f%%" % (m["all"] / total * 100)) if total else "-"
        lines.append("| %s | %s | %s | %s | %s | %s | %s | %d | %s |" % (
            m["model"], share, fmt_int(m["all"]), fmt_int(m["input"]),
            fmt_int(m["output"]), fmt_int(m["reasoning"]), fmt_int(m["cacheRead"]),
            m["messages"], ", ".join(m.get("providers") or []) or "-"))
    lines += [
        "",
        "Models are merged by model ID: the same model reached through two",
        "providers counts once, not twice.",
        "Usage from deleted conversations is still counted — the engine cascades",
        "message rows away on session delete, so this reads an accumulator.",
    ]
    return "\n".join(lines)


def tool_by_session(args):
    days = args.get("days")
    limit = min(int(args.get("limit") or 10), 50)
    p = load(days)
    sessions = p["sessions"][:limit]
    if not sessions:
        return "No sessions recorded%s." % (" in that window" if days else "")

    lines = [
        "# Usage by session",
        "",
        window_note(p, days),
        "",
        "| # | session | billed | total | requests | duration | directory |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for i, s in enumerate(sessions, 1):
        billed = s["input"] + s["output"] + s["cacheWrite"]
        title = (s["title"] or "(untitled)").replace("|", "\\|")
        lines.append("| %d | %s | %s | %s | %d | %s | %s |" % (
            i, title, fmt_int(billed), fmt_int(s["all"]), s["messages"],
            fmt_duration(s["durationMs"]), (s["directory"] or "-").replace("|", "\\|")))
    return "\n".join(lines)


def tool_timeline(args):
    days = min(int(args.get("days") or 14), 366)
    p = load(days)

    by_day = {}
    for e in p["events"]:
        if not e["day"]:
            continue
        b = by_day.setdefault(e["day"], {"all": 0, "messages": 0})
        b["all"] += e["all"]
        b["messages"] += 1

    if not by_day:
        return "No usage recorded in the last %d days." % days

    lines = [
        "# Daily token usage",
        "",
        "window: last %d days" % days,
        "",
        "| date | tokens | requests |",
        "| --- | --- | --- |",
    ]
    for day in sorted(by_day):
        b = by_day[day]
        lines.append("| %s | %s | %d |" % (day, fmt_int(b["all"]), b["messages"]))

    busiest = max(by_day.items(), key=lambda kv: kv[1]["all"])
    lines += ["", "Busiest day: %s with %s tokens." % (busiest[0], fmt_int(busiest[1]["all"]))]
    return "\n".join(lines)


HANDLERS = {
    "usage_summary": tool_summary,
    "usage_by_model": tool_by_model,
    "usage_by_session": tool_by_session,
    "usage_timeline": tool_timeline,
}

# ---------------------------------------------------------------- transport


def send(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def configure_stdio():
    """MCP speaks UTF-8 over stdio, but Python on Windows encodes pipes with the
    ANSI code page unless told otherwise. Session titles are arbitrary Chinese
    text, so relying on the environment would corrupt the stream — pin it.

    (MiMo's own shell happens to set PYTHONIOENCODING=utf-8, but a server it
    spawns is not guaranteed to inherit that.)"""
    for stream in (sys.stdin, sys.stdout):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    # Keep the framing byte-exact: no \\r\\n translation on the wire.
    try:
        sys.stdout.reconfigure(newline="\n")
    except (AttributeError, ValueError):
        pass
    try:
        sys.stderr.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass


def send_result(req_id, result):
    send({"jsonrpc": "2.0", "id": req_id, "result": result})


def send_error(req_id, code, message):
    send({"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}})


def log(msg):
    """Anything on stdout would corrupt the protocol, so diagnostics go to stderr."""
    sys.stderr.write("[%s] %s\n" % (SERVER_NAME, msg))
    sys.stderr.flush()


def handle(req):
    method = req.get("method")
    req_id = req.get("id")

    # Notifications carry no id and must not be answered.
    if req_id is None and method != "initialize":
        if method == "notifications/initialized":
            log("client initialised")
        return

    if method == "initialize":
        client_version = (req.get("params") or {}).get("protocolVersion")
        send_result(req_id, {
            # Echo the client's version when we know it, so a newer client is
            # not forced down to ours.
            "protocolVersion": client_version or PROTOCOL_VERSION,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
        })
        return

    if method == "ping":
        send_result(req_id, {})
        return

    if method == "tools/list":
        send_result(req_id, {"tools": TOOLS})
        return

    if method == "tools/call":
        params = req.get("params") or {}
        name = params.get("name")
        args = params.get("arguments") or {}
        handler = HANDLERS.get(name)
        if not handler:
            send_error(req_id, -32602, "unknown tool: %s" % name)
            return
        try:
            text = handler(args)
            send_result(req_id, {"content": [{"type": "text", "text": text}], "isError": False})
        except Exception as exc:
            log("tool %s failed: %s" % (name, exc))
            send_result(req_id, {
                "content": [{"type": "text", "text": "Error: %s" % exc}],
                "isError": True,
            })
        return

    if req_id is not None:
        send_error(req_id, -32601, "method not found: %s" % method)


def serve():
    configure_stdio()
    log("listening on stdio")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError as exc:
            log("bad JSON on stdin: %s" % exc)
            continue
        try:
            handle(req)
        except Exception as exc:  # never let one bad request kill the server
            log("handler error: %s" % exc)
            if isinstance(req, dict) and req.get("id") is not None:
                send_error(req["id"], -32603, "internal error: %s" % exc)


def selftest():
    """Exercise every tool without a client."""
    print("database:", export_tokens.find_db()[0])
    for name, handler in HANDLERS.items():
        print("\n" + "=" * 70)
        print("## " + name)
        print("=" * 70)
        args = {"days": 30} if name != "usage_by_session" else {"days": 30, "limit": 3}
        try:
            print(handler(args))
        except Exception as exc:
            print("FAILED: %s" % exc)
            return 1
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--selftest", action="store_true",
                    help="run every tool once and print the output, then exit")
    opts = ap.parse_args()
    if opts.selftest:
        sys.exit(selftest())
    serve()
