"""1.1.141 M0: which real sessions ran on an activity whose goal carries pedagogy?

Selects tutor-taught sessions from ``chat_logs.chat_turns`` on --env (default
prod, READ-ONLY), reads each distinct activity's teaching goal from that env's
Firestore (READ-ONLY), and plans the M2 lint over those goals: one
analysis-model call per distinct (goal, approach) pair.

    make goal-lint-sessions ARGS="--dry-run --since 2026-09-26 --until 2026-09-30"

--dry-run prints the selection, the lint call count and a cost estimate, and
makes ZERO model calls. --go runs the lint (costs money; needs M's go-ahead) and
writes research/goal-lint-sessions/<UTC>/sessions.jsonl: one row per session
with ``carriesPedagogy``, span kinds and conflicting constructs — no goal text,
no group id (ADR-001). That file is the label M0 joins onto the 1.1.140 M3
fidelity run (``make bench-tutor-sessions``) by session id.

Without --go it refuses to call any model.

Auth: Application Default Credentials with BigQuery + Firestore read on the
chosen project (``gcloud auth application-default login``).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
BACKEND = REPO / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

DEFAULT_OUT_ROOT = REPO / "research" / "goal-lint-sessions"


def _date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--dry-run", action="store_true", help="selection + plan + cost; make no model calls")
    p.add_argument("--go", action="store_true", help="actually run the lint (costs money)")
    p.add_argument("--env", default="prod", choices=["dev", "test", "prod"], help="environment to read (read-only)")
    p.add_argument("--since", type=_date, required=True, help="first day, YYYY-MM-DD (UTC)")
    p.add_argument("--until", type=_date, default=None, help="last day INCLUSIVE (default today)")
    p.add_argument("--min-turns", type=int, default=None, help="minimum tutor turns per session (default 6)")
    p.add_argument("--out", type=Path, default=None, help="output dir for --go (default: timestamped)")
    return p.parse_args(argv)


def main(argv: list[str] | None = None, *, query: Any = None, read_goal: Any = None, lint: Any = None) -> int:
    args = _parse_args(argv)
    from analytics import goal_lint_sessions as gls

    project = f"aipla-{args.env}-2026"
    os.environ["GOOGLE_CLOUD_PROJECT"] = project
    until = args.until or datetime.now(UTC).date()
    min_turns = args.min_turns if args.min_turns is not None else gls.DEFAULT_MIN_TUTOR_TURNS
    if query is None:
        from db.bigquery import run_query as query
    if read_goal is None:
        read_goal = gls.firestore_goal_reader()
    from config.models import analysis_model

    model = analysis_model()
    view = f"`{project}.chat_logs.chat_turns`"

    sel = gls.select_sessions(query, view, since=args.since, until=until, min_turns=min_turns)
    plan = gls.plan_lint(sel, read_goal)
    print(
        "\n".join(
            [
                "1.1.141 M0 — sessions whose activity goal carries pedagogy (read-only selection)",
                f"  project       : {project} · view {view}",
                f"  window        : {args.since} .. {until} (inclusive, UTC) · min tutor turns {min_turns}",
                gls.render_plan(plan, model=model),
            ]
        )
    )
    if args.dry_run:
        print("\n--dry-run: no model was called (one BigQuery selection + Firestore goal reads only).")
        return 0
    if not args.go:
        print("\nRefusing to call any model without --go. Get M's go-ahead first.")
        return 2
    if not plan.pairs:
        print("\nNothing to lint.")
        return 0

    os.environ.setdefault("GOOGLE_CLOUD_LOCATION", "global")
    rows = asyncio.run(gls.run_lint(plan, lint))
    out = args.out or DEFAULT_OUT_ROOT / datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    out.mkdir(parents=True, exist_ok=True)
    with (out / "sessions.jsonl").open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    flagged = sum(1 for r in rows if r["carriesPedagogy"])
    print(f"\n{flagged} of {len(rows)} sessions ran on a goal carrying pedagogy -> {out / 'sessions.jsonl'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
