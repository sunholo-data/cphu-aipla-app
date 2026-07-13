"""Rubric run store (RUBRIC-2 M3) — the provenance record for every score.

One ``rubric_runs`` document per (session x rubric x version): what was scored,
by which prompt version, whether that version was live at the time, and the
profile it produced. This is the layer that answers "which prompt generated
this live score?" and lets a researcher compare experiments after the fact.

Two sinks, both best-effort (a failure never breaks scoring):
  * **Firestore** ``rubric_runs/{run_id}`` — the durable, immediately-queryable
    record (the CLI ``rubric runs`` reads it).
  * **BigQuery** via the ``aipla_rubric_run`` Cloud Logging sink — the analysis
    mirror, queryable next to the chat turns it scored.

``run_id`` is deterministic — ``{session}__{rubric}__{version}`` — so re-scoring
the same version over the same session UPDATES one record rather than piling up
duplicates (the backfill relies on this).
"""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from db.firestore import query_documents, set_document

if TYPE_CHECKING:
    from analytics.session_rubric import RubricResult

logger = logging.getLogger(__name__)

_COLLECTION = "rubric_runs"


def _run_id(session_id: str, rubric_id: str, version: str) -> str:
    raw = f"{session_id}__{rubric_id}__{version}"
    return re.sub(r"[^A-Za-z0-9_.:-]", "_", raw)  # Firestore-safe doc id (no '/')


def record_rubric_run(result: RubricResult, *, group_id: str | None, is_live: bool) -> str:
    """Persist one result to ``rubric_runs`` + mirror it to BigQuery. Best-effort.

    Returns the ``run_id`` (deterministic, idempotent). Never raises — a store
    failure logs and returns the id so the caller's scoring result is untouched.
    """
    run_id = _run_id(result.session_id, result.lens_id, result.prompt_version)
    doc = {
        "run_id": run_id,
        "rubric_id": result.lens_id,
        "rubric_version": result.prompt_version,
        "session_id": result.session_id,
        "group_id": group_id or "",
        "activity_id": result.activity_id,
        "model": result.model,
        "abstained": result.abstained,
        "abstain_reason": result.abstain_reason,
        "is_live": is_live,
        "profile": result.profile,
        "partition_summary": result.partition_summary,
        "evidence_refs": result.evidence_refs,
        "created_at": datetime.now(UTC).isoformat(),
    }
    try:
        set_document(_COLLECTION, run_id, doc)
    except Exception as exc:
        logger.warning("rubric_runs: firestore write failed for %s (suppressed): %s", run_id, exc)

    try:
        from observability.chat_log import emit_rubric_run

        part = result.partition_summary or {}
        emit_rubric_run(
            run_id=run_id,
            rubric_id=result.lens_id,
            rubric_version=result.prompt_version,
            session_id=result.session_id,
            group_id=group_id or "",
            activity_id=result.activity_id,
            model=result.model,
            abstained=result.abstained,
            is_live=is_live,
            evidence_count=len(result.evidence_refs),
            student_initiated=int(part.get("student_initiated", 0)),
            tutor_prompted=int(part.get("tutor_prompted", 0)),
            profile_json=json.dumps(result.profile, ensure_ascii=False),
        )
    except Exception as exc:
        logger.warning("rubric_runs: BQ mirror failed for %s (suppressed): %s", run_id, exc)

    return run_id


def list_rubric_runs(
    *, group_code: str | None = None, rubric_id: str | None = None, limit: int = 50
) -> list[dict[str, Any]]:
    """Recent runs, newest-first, optionally filtered by group and/or rubric."""
    filters: list[tuple[str, str, Any]] = []
    if group_code:
        filters.append(("group_id", "==", group_code))
    if rubric_id:
        filters.append(("rubric_id", "==", rubric_id))
    rows = query_documents(_COLLECTION, filters=filters or None, limit=max(limit * 4, limit))
    rows.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return rows[:limit]


__all__ = ["list_rubric_runs", "record_rubric_run"]
