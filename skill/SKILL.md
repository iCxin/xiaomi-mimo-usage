---
name: mimo-usage
description: Open the local MiMo token usage dashboard, or refresh the usage snapshot it reads. Use whenever the user asks to see their MiMo usage, token consumption, activity history, streaks, which model they use most, or a usage dashboard — including phrasings like "打开用量看板", "看看我的 token 用量", "这个月用了多少", "usage dashboard", "how many tokens have I used". Also use when they ask to refresh or restart the usage data collector.
---

# MiMo Usage Dashboard

A local dashboard for the token usage MiMo Desktop never surfaces. It reads the
engine's own SQLite database and renders everything offline — no network, no
data leaving the machine.

## Finding the dashboard

Locate the directory that holds `export_tokens.py`, `watch_tokens.py` and
`index.html` together — that is the install. It is usually a clone of
`iCxin/xiaomi-mimo-usage`, but ask the user rather than guessing if a search of
the obvious places turns up nothing.

## Opening the dashboard

1. Make sure `data.js` is current:

   ```sh
   "<python>" export_tokens.py
   ```

   Use `$MIMO_PYTHON` when it is set; otherwise the project's launchers find a
   suitable interpreter. If the watcher is already running the snapshot is
   current and this is a no-op.

2. Present the entry file so it opens in the preview panel:

   ```
   present_files(files=["<dir>/index.html"], cwd="<dir>",
                 related_files=["app.js", "i18n.js", "styles.css", "data.js"])
   ```

   The page renders entirely from local files, so it works in the panel as-is.

## Keeping it live

The dashboard polls `data.js` every 20 seconds. A watcher keeps that file in
sync with the database:

- Windows: run `start.cmd` (windowless), stop with `stop.cmd`
- macOS / Linux: `./start.sh`, stop with `./stop.sh`

Check before starting a second one:

```sh
"<python>" watch_tokens.py --status
```

## Answering questions about the numbers

For questions about actual usage figures, prefer the `mimo-usage` MCP server if
it is connected — it exposes `usage_summary`, `usage_by_model`,
`usage_by_session` and `usage_timeline`, and reads the database directly. If it
is not available, run `export_tokens.py` and read the generated `data.js`.

## Things to get right when reporting

- **No money.** The database has a `cost` field but MiMo Desktop always writes
  `0` into it, so no spend figure can be derived. Never invent one, and correct
  the user if they assume the dashboard shows currency.
- **Two different totals.** The headline figures and the donut count *all*
  tokens (input + output + reasoning + cache read + cache write). The tables'
  "billed" column is input + output + cache write, with cache reads broken out
  because they are heavily discounted. Do not mix the two.
- **Models are merged by model ID.** The same model reached through two
  providers is one model, not two.
- **It is unofficial.** Not affiliated with Xiaomi.

## Language

The dashboard follows the browser language and can be switched in its header.
Its own UI is Chinese and English; keep your replies in the user's language.
