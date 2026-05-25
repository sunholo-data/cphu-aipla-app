"""Session-report REST endpoints (teacher-facing).

Phase 2 (1.G-Ph2) scope:
  GET /api/reports/sessions/{session_id}   — direct lookup by session id
  GET /api/reports/groups/{group_code}     — most-recent session for an
                                              anonymous group

Both endpoints return a 404 when no session matches. Phase 3 layers
on teacher ownership of the parent Class entity (today every
authenticated user can read every report — fine for LOCAL_MODE's
single-teacher world).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Path

from auth import User, get_current_user
from reports.session_summary import (
    SessionSummary,
    find_latest_session_for_group,
    summarize_session,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _serialize(summary: SessionSummary) -> dict:
    return summary.model_dump(by_alias=True, mode="json")


@router.get("/sessions/{session_id}")
async def get_session_report(
    session_id: str = Path(...),
    _user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Return the session summary for ``session_id``. 404 if missing."""
    summary = await summarize_session(session_id)
    if summary is None:
        raise HTTPException(status_code=404, detail="session not found")
    return _serialize(summary)


@router.get("/groups/{group_code}")
async def get_group_latest_report(
    group_code: str = Path(...),
    _user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Return the most-recently active session summary for an anonymous group.

    404 when the group has no sessions yet (frontend renders an empty
    state). Phase 3 will accept a ``?session_id=`` query param to pick a
    specific past session rather than only the latest.
    """
    idx = find_latest_session_for_group(group_code)
    if idx is None:
        raise HTTPException(status_code=404, detail="no sessions for this group yet")
    summary = await summarize_session(idx.session_id)
    if summary is None:
        # Race: index existed, ADK session gone. Same UX as "no sessions".
        raise HTTPException(status_code=404, detail="no sessions for this group yet")
    return _serialize(summary)
