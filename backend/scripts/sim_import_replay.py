"""Replay an outside-made sim through the Sim workshop: import it, then talk to the assistant.

Measures what a teacher waits for and what it costs, so a change to the
assistant (context caching, pruning old reads) can be compared on the SAME sim:

    make sim-author-local                       # terminal 1 (ADK_CONTEXT_CACHE=1 to compare)
    make sim-import-replay [LABEL=cache-on]     # terminal 2

For each turn it prints seconds to the first thought / first reply text, the tool
calls, and the draft's usage afterwards (input, cached, thinking, cost). One JSON
line per run is appended to ``--out`` for side-by-side reading.

It COSTS MONEY: real Gemini calls on the dev project (the 2026-11-19 prod
session of this kind ran 39 calls and $1.60). Default turn is the request the
workshop now sends after every import, which tells the assistant not to edit.
Local only: LOCAL_MODE's stub token, in-memory store.
"""

from __future__ import annotations

import argparse
import json
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

import httpx

BACKEND = Path(__file__).resolve().parents[1]
DEFAULT_FIXTURE = BACKEND / "tests" / "fixtures" / "sim_imports" / "bohr-spektrum" / "portable.html"
# The workshop's own words (frontend/messages/en/teacher-sims.json, importCheckAsk).
DEFAULT_TURN = (
    "I have just imported this sim, made outside AIPLA. Check it before I use it with students: run the "
    "browser check, then tell me briefly what works and anything a student would trip over (fit in the "
    "workspace, scrolling, what reaches the tutor). Do not change anything yet: tell me what you would fix "
    "and ask first."
)


def _turn(client: httpx.Client, api: str, skill_id: str, thread: str, text: str) -> dict:
    body = {
        "threadId": thread,
        "runId": f"r-{uuid.uuid4().hex[:8]}",
        "messages": [{"id": f"m-{uuid.uuid4().hex[:8]}", "role": "user", "content": f"[ui_language=en] {text}"}],
        "state": {},
        "tools": [],
        "context": [],
        "forwardedProps": {},
    }
    t0 = time.monotonic()
    first: dict[str, float] = {}
    calls: list[str] = []
    reply: list[str] = []
    error = None
    # (seconds, what): a tool starting or returning. The gaps between a tool
    # returning and the next one starting are the MODEL's time; the rest is tools.
    timeline: list[tuple[float, str]] = []
    with client.stream(
        "POST", f"{api}/api/skill/{skill_id}/stream", json=body, headers={"Accept": "text/event-stream"}, timeout=1800
    ) as res:
        res.raise_for_status()
        for line in res.iter_lines():
            if not line.startswith("data:"):
                continue
            try:
                ev = json.loads(line[5:].strip())
            except ValueError:
                continue
            kind = str(ev.get("type", ""))
            first.setdefault(kind, round(time.monotonic() - t0, 1))
            now = round(time.monotonic() - t0, 1)
            if kind == "TOOL_CALL_START":
                calls.append(ev.get("toolCallName") or "?")
                timeline.append((now, f"start {calls[-1]}"))
            elif kind == "TOOL_CALL_RESULT":
                timeline.append((now, "result"))
            elif kind == "TEXT_MESSAGE_CONTENT":
                reply.append(ev.get("delta", ""))
            elif kind == "RUN_ERROR":
                error = ev
    total = round(time.monotonic() - t0, 1)
    tool_s, last = 0.0, 0.0
    model_gaps: list[float] = []
    for at, what in timeline:
        if what.startswith("start"):
            model_gaps.append(round(at - last, 1))
            last = at
        else:
            tool_s += at - last
            last = at
    model_gaps.append(round(total - last, 1))  # the final answer
    return {
        "seconds": total,
        "model_s": round(sum(model_gaps), 1),
        "tool_s": round(tool_s, 1),
        "model_gaps_s": model_gaps,
        "first_thought_s": first.get("REASONING_MESSAGE_CONTENT"),
        "first_text_s": first.get("TEXT_MESSAGE_CONTENT"),
        "tool_calls": calls,
        "error": error,
        "reply": "".join(reply).strip(),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default="http://localhost:1966")
    ap.add_argument("--token", default="local-mode-stub-token")
    ap.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    ap.add_argument("--turn", action="append", help="a teacher turn (repeatable); default: the import check")
    ap.add_argument("--label", default="run")
    ap.add_argument(
        "--out", type=Path, default=BACKEND.parent / "research" / "sim-bench" / "runs" / "import-replay.jsonl"
    )
    args = ap.parse_args()

    client = httpx.Client(headers={"Authorization": f"Bearer {args.token}"}, timeout=120)
    skill = client.get(f"{args.api}/api/skills/by-slug/aipla-platform/sim-author")
    skill.raise_for_status()
    skill_id = skill.json().get("skillId") or skill.json().get("skill_id")

    t0 = time.monotonic()
    imp = client.post(f"{args.api}/api/sim-drafts/import", json={"html": args.fixture.read_text(encoding="utf-8")})
    imp.raise_for_status()
    imported = imp.json()
    draft = imported["draftId"]
    print(f"imported {args.fixture.parent.name} as {draft}: level {imported['level']} in {time.monotonic() - t0:.0f} s")

    turns = []
    for text in args.turn or [DEFAULT_TURN]:
        print(f"turn: {text[:80]}…")
        r = _turn(client, args.api, skill_id, draft, text)
        turns.append(r)
        print(
            f"  {r['seconds']} s (model {r['model_s']} s, tools {r['tool_s']} s) · first thought"
            f" {r['first_thought_s']} s · first text {r['first_text_s']} s\n  model gaps {r['model_gaps_s']}\n"
            f" · tools {r['tool_calls']}" + (f" · ERROR {r['error']}" if r["error"] else "")
        )
        print("  reply: " + r["reply"].replace("\n", " ")[:400])

    usage = (client.get(f"{args.api}/api/sim-drafts/{draft}").json().get("usage")) or {}
    tin, cached = int(usage.get("tokensIn") or 0), int(usage.get("tokensCached") or 0)
    print(
        f"usage: {usage.get('calls')} calls · in {tin:,} (cached {cached:,}, {100 * cached / tin if tin else 0:.0f}%)"
        f" · thinking {int(usage.get('tokensThinking') or 0):,} · ${usage.get('costUsd')}"
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("a", encoding="utf-8") as f:
        row = {"at": datetime.now(UTC).isoformat(), "label": args.label, "fixture": args.fixture.parent.name}
        f.write(json.dumps(row | {"draft": draft, "turns": turns, "usage": usage}) + "\n")
    print(f"appended to {args.out}")
    return 1 if any(t["error"] for t in turns) else 0


if __name__ == "__main__":
    raise SystemExit(main())
