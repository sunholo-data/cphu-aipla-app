"""Backfill 1.1.139 M0's structured concepts for one class's past sessions.

Design: docs/design/aipla/v1.1.0-feedback/class-lesson-overview.md (M0, M4)

WHY THIS EXISTS

    M0 makes the report narrative's call also return the session's concepts as
    data, stored on the summary cache doc (``chat_sessions/{id}``: ``concepts``,
    ``conceptsModel``, ``conceptsVersion``). Sessions summarised before M0 have
    a narrative and no concepts, so the lesson overview lists them as "not
    summarised yet". This re-runs that ONE call for a class, so a past lesson
    (JB's experienced-teacher session, M4) can be read at class level.

WHAT IT WRITES

    Only the concept fields — the narrative a teacher may already have read is
    left as it is, unless the session had none (then the new one is written
    too, exactly as opening the report would have). A session with no index
    row is reported and skipped: there is nowhere to cache the result.

SAFETY

    * Dry run by default — lists every session it would run, and the model
      calls that costs. ``--go`` runs them.
    * ``--class`` is required. ``--max`` caps the calls (default 60).
    * Idempotent: a session already on the current ``conceptsVersion`` is
      skipped unless ``--redo``.

USAGE
    make backfill-lesson-concepts ENV=prod CLASS=<id>            # dry run
    make backfill-lesson-concepts ENV=prod CLASS=<id> GO=1
    make backfill-lesson-concepts ENV=prod CLASS=<id> DATE=2026-09-29 GO=1
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from datetime import UTC, datetime
from typing import Any

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("backfill_lesson_concepts")

ENV_PROJECTS = {
    "dev": "aipla-dev-2026",
    "test": "aipla-test-2026",
    "prod": "aipla-prod-2026",
}


def plan(
    sessions: list[dict[str, Any]],
    index_for,
    *,
    version: str,
    day: str | None,
    redo: bool,
) -> tuple[list[dict[str, Any]], list[str], list[str]]:
    """Pure: ``(to_run, already_done, no_index)``. ``index_for(session_id)``
    returns the ChatSessionIndex or None."""
    from insights.lessons import lesson_date

    todo: list[dict[str, Any]] = []
    done: list[str] = []
    no_index: list[str] = []
    for s in sessions:
        if day and lesson_date(s.get("startedAt")) != day:
            continue
        idx = index_for(s["sessionId"])
        if idx is None:
            no_index.append(s["sessionId"])
            continue
        if not redo and idx.concepts is not None and idx.concepts_version == version:
            done.append(s["sessionId"])
            continue
        todo.append({**s, "hasNarrative": bool((idx.summary_text or "").strip())})
    return todo, done, no_index


async def run_one(row: dict[str, Any]) -> bool:
    from db.chat_sessions import update_session_fields
    from reports.narrative import concept_cache_fields, generate_report
    from reports.session_summary import resolve_session_summary

    summary = await resolve_session_summary(row["sessionId"])
    if summary is None:
        log.warning("  %s: no summary (no turns readable) — skipped", row["sessionId"])
        return False
    result = await generate_report(summary)
    fields = concept_cache_fields(result.concepts)
    if not fields:
        log.warning("  %s: the model returned no structured concepts — nothing written", row["sessionId"])
        return False
    if not row["hasNarrative"] and result.text:
        fields.update(
            {
                "summaryText": result.text,
                "summaryGeneratedAt": datetime.now(UTC).isoformat(),
                "summaryBasedOnTurnCount": summary.message_count,
                "summaryBasedOnVoiceChars": len((summary.voice_transcript or "").strip()),
            }
        )
    await asyncio.to_thread(update_session_fields, row["sessionId"], fields)
    log.info("  %s: %d concept(s) written", row["sessionId"], len(fields["concepts"]))
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--env", required=True, choices=sorted(ENV_PROJECTS))
    parser.add_argument("--class", dest="class_id", required=True)
    parser.add_argument("--date", default=None, help="one lesson day only (YYYY-MM-DD, Copenhagen)")
    parser.add_argument("--go", action="store_true", help="run the model calls and write (default: dry run)")
    parser.add_argument("--redo", action="store_true", help="re-run sessions already on the current version")
    parser.add_argument("--max", type=int, default=60, help="cap on model calls (default 60)")
    args = parser.parse_args(argv)

    # Bind every client to the chosen env BEFORE any db module resolves a project.
    os.environ["GOOGLE_CLOUD_PROJECT"] = ENV_PROJECTS[args.env]

    from db.chat_sessions import get_session_index
    from db.classes import get_class
    from insights.lessons import LESSONS_WINDOW, class_sessions
    from reports.narrative import CONCEPTS_VERSION

    cls = get_class(args.class_id)
    if cls is None:
        log.error("class %s not found on %s", args.class_id, args.env)
        return 2
    sessions = class_sessions(list(cls.group_codes), datetime.now(UTC) - LESSONS_WINDOW)
    todo, done, no_index = plan(sessions, get_session_index, version=CONCEPTS_VERSION, day=args.date, redo=args.redo)
    log.info(
        "env=%s class=%s (%s) date=%s mode=%s — %d session(s): %d to run, %d already on %s, %d without an index row",
        args.env,
        args.class_id,
        cls.name,
        args.date or "ALL",
        "GO" if args.go else "dry run",
        len(todo) + len(done) + len(no_index),
        len(todo),
        len(done),
        CONCEPTS_VERSION,
        len(no_index),
    )
    for row in todo[: args.max]:
        log.info("  would run %s group=%s activity=%s", row["sessionId"], row["groupCode"], row.get("activityId"))
    if len(todo) > args.max:
        log.info("  … %d more beyond --max %d", len(todo) - args.max, args.max)
    if not args.go:
        log.info("dry run: %d model call(s) would be made. Re-run with --go (GO=1).", min(len(todo), args.max))
        return 0

    async def _all() -> int:
        ok = 0
        for row in todo[: args.max]:
            try:
                ok += int(await run_one(row))
            except Exception as exc:
                log.warning("  %s: failed (%s)", row["sessionId"], type(exc).__name__)
        return ok

    ok = asyncio.run(_all())
    log.info("done: %d of %d written", ok, min(len(todo), args.max))
    return 0


if __name__ == "__main__":
    sys.exit(main())
