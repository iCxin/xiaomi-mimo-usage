"""Generate a plausible demo payload for the README screenshots.

The real data.js contains session titles and working directories from the
maintainer's own machine, which must not end up in a public repository. This
builds a same-shaped payload from invented content so the screenshots show a
realistic dashboard without leaking anything.

Usage:
    python make_demo_data.py --out data.js
"""

import argparse
import json
import os
import random
from datetime import datetime, timedelta, timezone

# Invented but realistic sessions. Paths are deliberately generic.
SESSIONS = [
    ("Set up the CI pipeline", "~/projects/example-app"),
    ("Refactor the auth module", "~/projects/example-app"),
    ("Debug the flaky upload test", "~/projects/api-server"),
    ("Write the schema migration", "~/projects/api-server"),
    ("Review the public API design", "~/projects/docs"),
    ("Investigate the memory leak", "~/projects/worker"),
]

MODELS = [
    ("deepseek-flash", "jiyuanc"),
    ("glm-5.3-flash", "jiyuanc"),
    ("kimi-k2.6", "jiyuanc"),
]

# Roughly how much of the traffic each model takes.
MODEL_WEIGHT = [0.78, 0.16, 0.06]


def local_iso(dt):
    return dt.astimezone().isoformat()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.js"))
    ap.add_argument("--seed", type=int, default=20260923)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    today = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)

    # Two weeks of activity, with a couple of quiet days so the heatmap and the
    # trend chart have some shape to them.
    day_weights = [0.0, 0.15, 0.55, 0.9, 0.4, 1.0, 0.7, 0.2, 0.0, 0.35, 0.8, 1.0, 0.6, 0.45]

    events = []
    session_span = {}
    for offset, weight in enumerate(day_weights):
        day = today - timedelta(days=len(day_weights) - 1 - offset)
        if weight <= 0:
            continue
        calls = max(1, int(round(weight * 26)))
        for _ in range(calls):
            sid = rng.randrange(len(SESSIONS))
            sid_key = "demo_s%d" % sid
            model, provider = rng.choices(MODELS, weights=MODEL_WEIGHT)[0]
            ts = day + timedelta(hours=rng.randint(9, 22), minutes=rng.randint(0, 59))
            cache_read = rng.randint(18_000, 140_000)
            inp = rng.randint(400, 6_000)
            out = rng.randint(120, 2_400)
            reasoning = rng.randint(0, 1_800) if model != "glm-5.3-flash" else rng.randint(0, 400)
            events.append({
                "id": "demo_%04d" % len(events),
                "sessionId": sid_key,
                "provider": provider,
                "model": model,
                "input": inp,
                "output": out,
                "reasoning": reasoning,
                "cacheRead": cache_read,
                "cacheWrite": 0,
                "all": inp + out + reasoning + cache_read,
                "cost": 0.0,
                "createdAt": local_iso(ts),
                "day": ts.strftime("%Y-%m-%d"),
                "createdMs": int(ts.timestamp() * 1000),
                "agent": "build",
                "mode": "build",
            })
            lo, hi = session_span.get(sid_key, (ts, ts))
            session_span[sid_key] = (min(lo, ts), max(hi, ts))

    events.sort(key=lambda e: e["createdMs"])

    # --- aggregate ---------------------------------------------------------
    fields = ("input", "output", "reasoning", "cacheRead", "cacheWrite", "all")

    def blank():
        return dict.fromkeys(fields, 0) | {"cost": 0.0, "messages": 0}

    by_session, by_model, by_day = {}, {}, {}
    totals = blank()
    providers_by_model = {}
    for e in events:
        for table, key in ((by_session, e["sessionId"]), (by_model, e["model"]),
                           (by_day, e["day"])):
            b = table.setdefault(key, blank())
            for f in fields:
                b[f] += e[f]
            b["messages"] += 1
        for f in fields:
            totals[f] += e[f]
        totals["messages"] += 1
        providers_by_model.setdefault(e["model"], set()).add(e["provider"])

    sessions = []
    for sid, (title, directory) in enumerate(SESSIONS):
        key = "demo_s%d" % sid
        agg = by_session.get(key)
        if not agg:
            continue
        lo, hi = session_span[key]
        sessions.append({
            "id": key,
            "title": title,
            "directory": directory,
            "createdAt": local_iso(lo),
            "durationMs": int((hi - lo).total_seconds() * 1000),
            "archived": False,
            "exists": True,
            **agg,
        })
    sessions.sort(key=lambda s: -(s["input"] + s["output"] + s["cacheWrite"]))

    models = [
        {"model": name, "providers": sorted(providers_by_model.get(name, [])), **by_model[name]}
        for name in by_model
    ]
    models.sort(key=lambda m: -m["all"])

    peak_day = max(by_day.items(), key=lambda kv: kv[1]["all"])
    longest = max(sessions, key=lambda s: s["durationMs"])

    active = sorted(by_day.keys())
    streak = 0
    cursor = today
    while cursor.strftime("%Y-%m-%d") in by_day:
        streak += 1
        cursor -= timedelta(days=1)
    longest_streak = run = 1
    for i in range(1, len(active)):
        prev = datetime.strptime(active[i - 1], "%Y-%m-%d")
        cur = datetime.strptime(active[i], "%Y-%m-%d")
        run = run + 1 if (cur - prev).days == 1 else 1
        longest_streak = max(longest_streak, run)

    payload = {
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(),
        "source": "mimocode.db / message.data",
        "range": {"from": events[0]["createdAt"], "to": events[-1]["createdAt"]},
        "totals": totals,
        "stats": {
            "cumulativeTokens": totals["all"],
            "peakDailyTokens": peak_day[1]["all"],
            "peakDay": peak_day[0],
            "longestSessionMs": longest["durationMs"],
            "longestSessionTitle": longest["title"],
            "currentStreak": streak,
            "longestStreak": longest_streak,
            "activeDays": len(by_day),
        },
        "sessions": sessions,
        "models": models,
        "skippedMessages": 0,
        "events": events,
        "demo": True,
    }

    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("// Demo snapshot for screenshots - generated by make_demo_data.py.\n")
        fh.write("window.MIMO_TOKEN_DATA = ")
        json.dump(payload, fh, ensure_ascii=False, indent=1)
        fh.write(";\n")

    print("wrote %s" % args.out)
    print("  %d events, %d sessions, %d models, %d active days"
          % (len(events), len(sessions), len(models), len(by_day)))
    print("  total=%d  peak=%d on %s  streak=%d/%d"
          % (totals["all"], peak_day[1]["all"], peak_day[0], streak, longest_streak))


if __name__ == "__main__":
    main()
