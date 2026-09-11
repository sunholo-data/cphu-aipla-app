"""Researcher chat-log lens API (1.1.109) — conversations by teaching approach.

RESEARCHER-ONLY. Every route asserts the ``role:researcher`` claim, because
these payloads carry **student conversation text** across every class and every
teacher — the widest read in the product. Students are anonymous groups
(ADR-001) so the text carries no names, but it is still what a student wrote.

⚠️ **A failed BigQuery read is reported, never rendered as "no data".** This is
the footgun the deploy-status incident named: a read failure that falls into the
same bucket as a real value produces the *reassuring* answer — here, "no
conversations ran under ESRU", which is a research conclusion. So the query
layer's exceptions surface as ``503`` with ``reason``, and the UI shows that a
read failed rather than an empty tab. The established
"callers wrap BQ in try/except and degrade" contract in ``db/bigquery.py`` is
right for a spend dashboard and wrong for evidence.
"""

from __future__ import annotations

import csv
import io
import json
import logging
from datetime import UTC, date, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import StreamingResponse

from analytics import research_logs
from auth import User, get_current_user
from auth.guards import assert_researcher

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/research/logs", tags=["research", "chat-logs"])


def _jsonable(value: Any) -> Any:
    """BigQuery hands back ``datetime``/``date``; JSON does not take them."""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{k: _jsonable(v) for k, v in row.items()} for row in rows]


def _read(fn, *args, **kwargs):
    """Run a query-layer call, converting a BQ failure into a loud 503.

    Never returns an empty result to stand in for an unreadable one — see the
    module docstring.
    """
    try:
        return fn(*args, **kwargs)
    except Exception as exc:
        log.warning("research_logs: query failed (%s): %s", type(exc).__name__, exc)
        raise HTTPException(
            status_code=503,
            detail=f"chat-log store unreadable ({type(exc).__name__}) — this is a failed read, not an empty result",
        ) from exc


@router.get("/tabs")
async def tabs_route(user: User = Depends(get_current_user)) -> dict:  # noqa: B008
    """Counts per teaching approach — the tab strip.

    Returns only frameworks that actually appear in the logs, plus the
    unassigned bucket. The caller merges against the framework catalogue so a
    framework nobody has been assigned still shows, at zero.
    """
    assert_researcher(user)
    return {"tabs": _rows(_read(research_logs.framework_tabs)), "unassignedKey": research_logs.UNASSIGNED}


@router.get("/sessions")
async def sessions_route(
    framework: str | None = Query(default=None, max_length=64),
    classId: str | None = Query(default=None, max_length=128),
    activityId: str | None = Query(default=None, max_length=128),
    limit: int = Query(default=50, ge=1, le=research_logs.MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Session rollup for one tab."""
    assert_researcher(user)
    rows = _read(
        research_logs.list_sessions,
        framework=framework,
        class_id=classId,
        activity_id=activityId,
        limit=limit,
        offset=offset,
    )
    return {"sessions": _rows(rows), "limit": limit, "offset": offset}


@router.get("/sessions/{session_id}")
async def transcript_route(
    session_id: str = Path(..., max_length=128),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """The full transcript of one conversation."""
    assert_researcher(user)
    turns = _read(research_logs.session_transcript, session_id)
    if not turns:
        raise HTTPException(status_code=404, detail="no turns recorded for that session")
    return {"sessionId": session_id, "turns": _rows(turns)}


@router.get("/export")
async def export_route(
    format: str = Query(default="csv", pattern="^(csv|jsonl)$"),
    framework: str | None = Query(default=None, max_length=64),
    classId: str | None = Query(default=None, max_length=128),
    activityId: str | None = Query(default=None, max_length=128),
    limit: int = Query(default=research_logs.MAX_LIMIT, ge=1, le=research_logs.MAX_LIMIT),
    user: User = Depends(get_current_user),  # noqa: B008
) -> StreamingResponse:
    """CSV / JSONL of the turns the current filter shows.

    Turn-level, with the text — a session rollup exports nothing codeable.
    """
    assert_researcher(user)
    rows = _rows(
        _read(
            research_logs.export_turns,
            framework=framework,
            class_id=classId,
            activity_id=activityId,
            limit=limit,
        )
    )
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    label = (framework or "all").replace(research_logs.UNASSIGNED, "unassigned")
    filename = f"aipla-chat-turns-{label}-{stamp}.{format}"

    if format == "jsonl":
        body = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows)
        media = "application/x-ndjson"
    else:
        buf = io.StringIO()
        cols = list(rows[0].keys()) if rows else ["ts", "session_id", "role", "content", "framework_id"]
        writer = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
        body = buf.getvalue()
        media = "text/csv"

    return StreamingResponse(
        iter([body]),
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
