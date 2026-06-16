"""Internal (scheduler-only) routes.

1.1.36 A4 — the **settle job**: pre-generate teacher-report narratives once a session
has gone idle (~20 min), so a researcher reviewing a finished class gets the summary
**instantly** instead of waiting on the LLM at open time.

Idempotent: ``resolve_narrative``'s cache-gating no-ops already-warm sessions, so a
re-run is cheap and the scan is self-healing. Internal-only: guarded by a shared token
(``X-Internal-Token``). In production this sits behind an OIDC-authenticated Cloud
Scheduler job hitting it every ~10 min; the token is the fail-closed gate — no token
configured -> 503.
"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Header, HTTPException

from db.firestore import query_documents
from reports.narrative import resolve_narrative
from reports.session_summary import resolve_session_summary

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/internal", tags=["internal"])

_SETTLE_MINUTES = int(os.getenv("SUMMARY_SETTLE_MINUTES", "20"))
_MAX_PER_RUN = int(os.getenv("SUMMARY_WARM_MAX_PER_RUN", "25"))
_SCAN_LIMIT = int(os.getenv("SUMMARY_WARM_SCAN_LIMIT", "200"))


def _require_internal(token: str | None) -> None:
    expected = os.getenv("WARM_SUMMARIES_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="warm-summaries not configured")
    if not token or token != expected:
        raise HTTPException(status_code=403, detail="forbidden")


def _parse_dt(value) -> datetime | None:
    """Parse ``lastMessageAt`` whether Firestore handed back a datetime or an ISO
    string — robust to storage type so the settled filter can't silently no-op."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    try:
        ts = datetime.fromisoformat(str(value))
        return ts if ts.tzinfo else ts.replace(tzinfo=UTC)
    except (ValueError, TypeError):
        return None


@router.post("/warm-summaries")
async def warm_summaries(x_internal_token: str | None = Header(default=None)) -> dict:
    """Pre-generate narratives for settled, not-yet-summarised sessions. Returns the
    scan counts. Each warm runs ``resolve_session_summary`` + ``resolve_narrative``;
    the cache-gating means already-warm sessions are skipped cheaply."""
    _require_internal(x_internal_token)
    cutoff = datetime.now(UTC) - timedelta(minutes=_SETTLE_MINUTES)
    docs = query_documents(
        "chat_sessions",
        order_by="lastMessageAt",
        order_direction="DESCENDING",
        limit=_SCAN_LIMIT,
    )
    scanned = warmed = 0
    for d in docs:
        if warmed >= _MAX_PER_RUN:
            break
        last = _parse_dt(d.get("lastMessageAt"))
        if last is None or last >= cutoff:
            continue  # not settled yet
        if (d.get("summaryText") or "").strip():
            continue  # already warmed
        session_id = d.get("sessionId") or d.get("__id")
        if not session_id:
            continue
        scanned += 1
        try:
            summary = await resolve_session_summary(session_id)
            if summary is not None and await resolve_narrative(summary):
                warmed += 1
        except Exception as exc:
            log.warning("warm-summaries: failed for %s: %s", session_id, exc)
    return {"settleMinutes": _SETTLE_MINUTES, "scanned": scanned, "warmed": warmed}
