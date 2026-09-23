"""Add the mimo-usage server to the MiMoCode `mcp` section of mimocode.jsonc.

The file is JSONC and hand-formatted, so this does a targeted text insertion
rather than a parse-and-redump, which would strip comments and reformat
everything. Braces inside strings and comments are skipped when locating the
end of the `mcp` object.

Usage:
    python register_mcp.py --config PATH --server PATH_TO_mcp_server.py [--python PATH]
    python register_mcp.py --config PATH --remove
"""

import argparse
import json
import os
import re
import shutil
import sys
from datetime import datetime

ENTRY_KEY = "mimo-usage"


def strip_jsonc(text):
    """Remove // and /* */ comments plus trailing commas, for validation only."""
    out, i, n = [], 0, len(text)
    in_str = False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == "\\":
                if i + 1 < n:
                    out.append(text[i + 1])
                    i += 2
                    continue
            elif c == '"':
                in_str = False
            i += 1
            continue
        if c == '"':
            in_str = True
            out.append(c)
            i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(c)
        i += 1
    cleaned = "".join(out)
    return re.sub(r",(\s*[}\]])", r"\1", cleaned)


def find_object(text, start):
    """Given the index of a '{', return the index just past its matching '}'."""
    depth = 0
    i = start
    n = len(text)
    in_str = False
    while i < n:
        c = text[i]
        if in_str:
            if c == "\\":
                i += 2
                continue
            if c == '"':
                in_str = False
            i += 1
            continue
        if c == '"':
            in_str = True
            i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise SystemExit("could not find the end of the object starting at %d" % start)


def mcp_section(text):
    m = re.search(r'"mcp"\s*:\s*\{', text)
    if not m:
        raise SystemExit('no top-level "mcp" object found')
    open_brace = text.index("{", m.start())
    return open_brace, find_object(text, open_brace)


def indent_of(text, index):
    line_start = text.rfind("\n", 0, index) + 1
    return re.match(r"[ \t]*", text[line_start:]).group(0)


def remove_entry(text):
    m = re.search(r'"%s"\s*:\s*\{' % re.escape(ENTRY_KEY), text)
    if not m:
        return text, False
    open_brace = text.index("{", m.start())
    close_brace = find_object(text, open_brace)
    line_start = text.rfind("\n", 0, m.start()) + 1
    line_end = text.find("\n", close_brace) + 1
    if line_end == 0:
        line_end = len(text)
    # Also swallow a trailing comma on the line before, if this was the last entry.
    before = text[:line_start].rstrip()
    if before.endswith(","):
        line_start = len(before) - 1
    return text[:line_start] + text[line_end:], True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--server")
    ap.add_argument("--python")
    ap.add_argument("--remove", action="store_true")
    args = ap.parse_args()

    path = os.path.expanduser(args.config)
    if not os.path.exists(path):
        raise SystemExit("config not found: %s" % path)

    with open(path, encoding="utf-8") as fh:
        original = fh.read()

    backup = "%s.bak-%s" % (path, datetime.now().strftime("%Y%m%d-%H%M%S"))
    shutil.copyfile(path, backup)
    print("backup: %s" % backup)

    if args.remove:
        text, removed = remove_entry(original)
        if not removed:
            raise SystemExit("no %s entry to remove" % ENTRY_KEY)
    else:
        if not args.server or not args.python:
            raise SystemExit("--server and --python are required unless --remove")
        text, _ = remove_entry(original)  # idempotent: drop any previous copy
        open_brace, close_brace = mcp_section(text)
        inner = text[open_brace + 1:close_brace]
        entry_indent = indent_of(text, open_brace) + "  "
        body_indent = entry_indent + "  "

        py = args.python.replace("\\", "\\\\")
        srv = os.path.abspath(args.server).replace("\\", "\\\\")
        entry = (
            "\n" + entry_indent + '"%s": {\n' % ENTRY_KEY +
            body_indent + '"type": "local",\n' +
            body_indent + '"command": ["%s", "%s"],\n' % (py, srv) +
            body_indent + '"enabled": true\n' +
            entry_indent + "}"
        )
        # Add a separating comma only if the object already has entries.
        if inner.strip():
            entry = "," + entry
        text = text[:close_brace] + entry + "\n" + indent_of(text, close_brace) + text[close_brace:]

    # Validate before writing: a broken config would stop the engine starting.
    try:
        json.loads(strip_jsonc(text))
    except ValueError as exc:
        raise SystemExit("result is not valid JSON, refusing to write: %s" % exc)

    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("wrote %s" % path)

    parsed = json.loads(strip_jsonc(text))
    print("mcp servers now: %s" % ", ".join(sorted((parsed.get("mcp") or {}).keys())))


if __name__ == "__main__":
    main()
