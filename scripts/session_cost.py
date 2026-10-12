#!/usr/bin/env python3
"""Time and tokens spent in one stretch of a Claude Code session.

Measures what building something (a sim, an activity) cost, from the session
transcript Claude Code writes under ~/.claude/projects/<project>/<session>.jsonl.
The stretch runs from the first user message containing START to the first
transcript row whose text contains END (e.g. the commit subject that finished it).

    scripts/session_cost.py <transcript.jsonl> --start "anatomy a new sim" --end "English twin"

Subagent transcripts (<session>/subagents/*.jsonl) are counted when their rows
fall inside the stretch. Each API call is counted once (rows that share a
message id are one call). Read-only: prints a summary and writes nothing.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import pathlib

TOKEN_KEYS = ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")


def _text(row: dict) -> str:
    content = row.get("message", {}).get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(b.get("text", "") or json.dumps(b.get("input", "")) for b in content if isinstance(b, dict))
    return ""


def _when(row: dict) -> dt.datetime | None:
    ts = row.get("timestamp")
    return dt.datetime.fromisoformat(ts.replace("Z", "+00:00")) if ts else None


def _load(path: pathlib.Path) -> list[dict]:
    return [json.loads(line) for line in path.open() if line.strip()]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("transcript", type=pathlib.Path)
    ap.add_argument("--start", required=True, help="text of the user message that starts the stretch")
    ap.add_argument("--end", required=True, help="text of the row that ends it, e.g. a commit subject")
    args = ap.parse_args()

    rows = _load(args.transcript)
    start = next(
        (i for i, r in enumerate(rows) if r.get("type") == "user" and args.start in _text(r)),
        None,
    )
    if start is None:
        raise SystemExit(f"no user message contains {args.start!r}")
    end = next((i for i in range(start + 1, len(rows)) if args.end in json.dumps(rows[i])), None)
    if end is None:
        raise SystemExit(f"no row after the start contains {args.end!r}")
    t0, t1 = _when(rows[start]), _when(rows[end])

    pool = rows[start : end + 1]
    subdir = args.transcript.with_suffix("") / "subagents"
    for sub in sorted(subdir.glob("*.jsonl")) if subdir.is_dir() else []:
        pool += [r for r in _load(sub) if (w := _when(r)) and t0 <= w <= t1]

    seen: set[str] = set()
    tokens: collections.Counter[str] = collections.Counter()
    tools: collections.Counter[str] = collections.Counter()
    models: collections.Counter[str] = collections.Counter()
    for r in pool:
        if r.get("type") != "assistant":
            continue
        msg = r["message"]
        for block in msg.get("content", []):
            if isinstance(block, dict) and block.get("type") == "tool_use":
                tools[block["name"]] += 1
        if msg.get("id") in seen:
            continue
        seen.add(msg.get("id"))
        models[msg.get("model", "?")] += 1
        for k in TOKEN_KEYS:
            tokens[k] += (msg.get("usage") or {}).get(k) or 0

    calls = len(seen)
    print(f"from     {t0:%Y-%m-%d %H:%M:%S} UTC")
    print(f"to       {t1:%Y-%m-%d %H:%M:%S} UTC")
    print(f"elapsed  {(t1 - t0).total_seconds() / 60:.1f} min (wall clock)")
    print(f"calls    {calls}  models {dict(models)}")
    for k in TOKEN_KEYS:
        print(f"{k:<29}{tokens[k]:>12,}")
    if calls:
        context = (tokens["input_tokens"] + tokens["cache_creation_input_tokens"] + tokens["cache_read_input_tokens"]) / calls
        print(f"mean context per call        {context:>12,.0f}")
    print(f"tools    {dict(tools.most_common())}")


if __name__ == "__main__":
    main()
